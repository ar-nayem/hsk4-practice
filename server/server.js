'use strict';
const path = require('path');
const crypto = require('crypto');

// Load server/.env (JWT_SECRET, PORT, NODE_ENV, SMTP_*) if present; real env vars win.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { /* no .env — fine in dev */ }

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { sendMail } = require('./mail');

const PORT = process.env.PORT || 7800;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET is not set. Refusing to start (sessions would be invalid on every restart).');
  process.exit(1);
}
const COOKIE_NAME = 'hsk_token';
const TOKEN_DAYS = 30;
const IS_PROD = process.env.NODE_ENV === 'production';
const APP_URL = process.env.APP_URL || 'https://hsk.arnayem.top';
const CODE_TTL_MIN = 30;
const MAX_CODE_ATTEMPTS = 5;
const RESEND_COOLDOWN_S = 60;

const app = express();
app.set('trust proxy', 1); // behind nginx
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  // API answers depend on the login cookie. Without this, iOS Safari replays a cached
  // {"user":null} when it restores a tab after the app is closed, which looks like a logout.
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// ---------- helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_COLS = 'id, email, name, email_verified, token_version';
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function signToken(user) {
  // em ties the cookie to this exact account, so an id can never be re-used by someone else (e.g. after a restore).
  return jwt.sign({ uid: user.id, tv: user.token_version || 0, em: user.email }, JWT_SECRET, { expiresIn: `${TOKEN_DAYS}d` });
}
function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, signToken(user), {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: TOKEN_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, verified: !!u.email_verified };
}
function getUser(id) {
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id);
}
function userFromReq(req) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET);
    const u = getUser(p.uid);
    if (!u || p.em !== u.email || (p.tv || 0) !== u.token_version) return null; // a password reset signs out older sessions
    return u;
  } catch (e) {
    return null;
  }
}
function requireAuth(req, res, next) {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'not_authenticated' });
  req.user = u;
  next();
}
function requireVerified(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.email_verified) return res.status(403).json({ error: 'email_not_verified' });
    next();
  });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'too_many_attempts' },
});
// Anything that sends an email.
const mailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'too_many_attempts' },
});

// ---------- one-time codes ----------
const hashCode = code => crypto.createHmac('sha256', JWT_SECRET).update(String(code)).digest('hex');

function issueCode(userId, kind) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const now = Date.now();
  db.prepare('DELETE FROM codes WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM codes WHERE user_id = ? AND kind = ?').run(userId, kind);
  db.prepare('INSERT INTO codes (user_id, kind, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .run(userId, kind, hashCode(code), now + CODE_TTL_MIN * 60000, now);
  return code;
}
function cooldownLeft(userId, kind) {
  const row = db.prepare('SELECT created_at FROM codes WHERE user_id = ? AND kind = ?').get(userId, kind);
  if (!row) return 0;
  return Math.max(0, Math.ceil((row.created_at + RESEND_COOLDOWN_S * 1000 - Date.now()) / 1000));
}
function hasActiveCode(userId, kind) {
  return !!db.prepare('SELECT 1 FROM codes WHERE user_id = ? AND kind = ? AND expires_at > ?').get(userId, kind, Date.now());
}
// Returns 'ok' or an error key the client understands.
function consumeCode(userId, kind, code) {
  const row = db.prepare('SELECT * FROM codes WHERE user_id = ? AND kind = ?').get(userId, kind);
  if (!row) return 'no_code';
  if (row.expires_at < Date.now()) return 'expired_code';
  if (row.attempts >= MAX_CODE_ATTEMPTS) return 'code_locked';
  const a = Buffer.from(hashCode(String(code || '').trim()));
  const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    db.prepare('UPDATE codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return 'invalid_code';
  }
  db.prepare('DELETE FROM codes WHERE id = ?').run(row.id);
  return 'ok';
}
async function sendCode(user, kind) {
  const code = issueCode(user.id, kind);
  const reset = kind === 'reset';
  const subject = reset ? `${code} is your HSK 4 Prep password reset code` : `${code} is your HSK 4 Prep verification code`;
  const line = reset ? 'Use this code to reset your password:' : 'Use this code to verify your email and activate your account:';
  const text = `Hi ${user.name},\n\n${line}\n\n    ${code}\n\nThe code expires in ${CODE_TTL_MIN} minutes. If you didn't ask for this, you can ignore this email.\n\nHSK 4 Prep · ${APP_URL}\n`;
  const html = `<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;max-width:460px;margin:auto;padding:24px;color:#1f1c18">
<div style="font-size:18px;font-weight:700;margin-bottom:14px">HSK 4 Prep</div>
<p>Hi ${escHtml(user.name)},</p><p>${line}</p>
<div style="font-size:32px;font-weight:800;letter-spacing:8px;background:#f5f2ec;border-radius:10px;padding:16px;text-align:center;margin:18px 0">${code}</div>
<p style="color:#6e685f;font-size:13px">The code expires in ${CODE_TTL_MIN} minutes. If you didn't ask for this, you can ignore this email.</p>
<p style="color:#6e685f;font-size:13px"><a href="${APP_URL}" style="color:#b3302a">${APP_URL.replace(/^https?:\/\//, '')}</a></p></div>`;
  await sendMail({ to: user.email, subject, text, html });
}

// ---------- auth routes ----------
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  const { email, password, name } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  const n = String(name || '').trim().slice(0, 60) || e.split('@')[0];
  const p = String(password || '');
  if (!EMAIL_RE.test(e)) return res.status(400).json({ error: 'invalid_email' });
  if (p.length < 8) return res.status(400).json({ error: 'weak_password', message: 'Password must be at least 8 characters.' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(e)) return res.status(409).json({ error: 'email_taken' });

  const info = db.prepare('INSERT INTO users (email, name, password_hash, created_at, email_verified, token_version) VALUES (?, ?, ?, ?, 0, 0)')
    .run(e, n, bcrypt.hashSync(p, 10), Date.now());
  const user = getUser(info.lastInsertRowid);
  db.prepare('INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?)').run(user.id, '{}', Date.now());
  setAuthCookie(res, user);

  let mailFailed = false;
  try { await sendCode(user, 'verify'); } catch (err) { mailFailed = true; console.error('verify mail failed:', err.message); }
  res.json({ user: publicUser(user), mailFailed });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(e);
  if (!row || !bcrypt.compareSync(String(password || ''), row.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  setAuthCookie(res, row);
  // Unverified and no live code (e.g. it expired): send a fresh one so the verify screen is usable.
  if (!row.email_verified && !hasActiveCode(row.id, 'verify')) {
    try { await sendCode(row, 'verify'); } catch (err) { console.error('verify mail failed:', err.message); }
  }
  res.json({ user: publicUser(row) });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// 200 with user:null when signed out, so the page's startup check doesn't log a 401.
app.get('/api/auth/me', (req, res) => {
  const u = userFromReq(req);
  res.json({ user: u ? publicUser(u) : null });
});

app.post('/api/auth/verify', authLimiter, requireAuth, (req, res) => {
  if (req.user.email_verified) return res.json({ user: publicUser(req.user) });
  const r = consumeCode(req.user.id, 'verify', (req.body || {}).code);
  if (r !== 'ok') return res.status(400).json({ error: r });
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(req.user.id);
  res.json({ user: publicUser(getUser(req.user.id)) });
});

app.post('/api/auth/resend-verification', mailLimiter, requireAuth, async (req, res) => {
  if (req.user.email_verified) return res.json({ ok: true });
  const wait = cooldownLeft(req.user.id, 'verify');
  if (wait) return res.status(429).json({ error: 'cooldown', wait });
  try { await sendCode(req.user, 'verify'); res.json({ ok: true }); }
  catch (err) { console.error('verify mail failed:', err.message); res.status(502).json({ error: 'mail_failed' }); }
});

// Same answer whether or not the account exists; the email is sent in the background so timing doesn't leak it either.
app.post('/api/auth/forgot', mailLimiter, (req, res) => {
  const e = String((req.body || {}).email || '').trim().toLowerCase();
  const u = EMAIL_RE.test(e) ? db.prepare(`SELECT ${USER_COLS} FROM users WHERE email = ?`).get(e) : null;
  if (u && cooldownLeft(u.id, 'reset') === 0) {
    sendCode(u, 'reset').catch(err => console.error('reset mail failed:', err.message));
  }
  res.json({ ok: true });
});

app.post('/api/auth/reset', authLimiter, (req, res) => {
  const { email, code, password } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  const p = String(password || '');
  if (p.length < 8) return res.status(400).json({ error: 'weak_password', message: 'Password must be at least 8 characters.' });
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get(e);
  if (!u) return res.status(400).json({ error: 'invalid_code' });
  const r = consumeCode(u.id, 'reset', code);
  if (r !== 'ok') return res.status(400).json({ error: r });
  // Receiving the code also proves the email address, so this verifies it too.
  db.prepare('UPDATE users SET password_hash = ?, email_verified = 1, token_version = token_version + 1 WHERE id = ?')
    .run(bcrypt.hashSync(p, 10), u.id);
  db.prepare('DELETE FROM codes WHERE user_id = ?').run(u.id);
  const fresh = getUser(u.id);
  setAuthCookie(res, fresh);
  res.json({ user: publicUser(fresh) });
});

// Permanently removes the signed-in account and all its practice history (password required).
app.post('/api/auth/delete-account', authLimiter, requireAuth, (req, res) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !bcrypt.compareSync(String((req.body || {}).password || ''), row.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  db.prepare('DELETE FROM codes WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM progress WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// ---------- progress routes (verified accounts only) ----------
function saveProgress(userId, state) {
  db.prepare(`
    INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(userId, JSON.stringify(state), Date.now());
}

app.get('/api/progress', requireVerified, (req, res) => {
  const row = db.prepare('SELECT data, updated_at FROM progress WHERE user_id = ?').get(req.user.id);
  if (!row) return res.json({ state: {}, updatedAt: null });
  let state;
  try { state = JSON.parse(row.data); } catch (e) { state = {}; }
  res.json({ state, updatedAt: row.updated_at });
});

app.put('/api/progress', requireVerified, (req, res) => {
  const { state } = req.body || {};
  if (!state || typeof state !== 'object') return res.status(400).json({ error: 'invalid_state' });
  if (JSON.stringify(state).length > 1_800_000) return res.status(413).json({ error: 'too_large' });
  saveProgress(req.user.id, state);
  res.json({ ok: true, updatedAt: Date.now() });
});

// sendBeacon can only POST (used on page unload, where a normal PUT fetch may be cancelled)
app.post('/api/progress/beacon', requireVerified, (req, res) => {
  const { state } = req.body || {};
  if (!state || typeof state !== 'object') return res.status(400).end();
  if (JSON.stringify(state).length > 1_800_000) return res.status(413).end();
  saveProgress(req.user.id, state);
  res.status(204).end();
});

// ---------- static app ----------
const APP_FILE = path.join(__dirname, 'public', 'index.html');
const sendApp = (req, res) => res.sendFile(APP_FILE, { headers: { 'Cache-Control': 'no-cache' } }); // revalidate (cheap 304) so deploys show up
const PRIVACY_FILE = path.join(__dirname, 'public', 'privacy.html');
app.get(['/privacy', '/privacy.html'], (req, res) => res.sendFile(PRIVACY_FILE, { headers: { 'Cache-Control': 'no-cache' } }));
// Android app (sideloaded APK), built by android/build-apk.sh
const APK_FILE = path.join(__dirname, 'downloads', 'hsk4-prep.apk');
app.get(['/download/hsk4-prep.apk', '/app.apk'], (req, res) => {
  res.sendFile(APK_FILE, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="HSK4-Prep.apk"',
      'Cache-Control': 'no-cache',
    },
  }, err => { if (err && !res.headersSent) res.status(404).type('text').send('The Android app is not available yet.'); });
});
app.get('/', sendApp);
app.get('/index.html', sendApp);
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  sendApp(req, res);
});

app.listen(PORT, () => console.log(`hsk4-server listening on :${PORT}`));
