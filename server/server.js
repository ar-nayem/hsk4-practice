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
const USER_COLS = 'id, email, name, email_verified, token_version, is_admin, last_seen, lb_visible, lb_banned';
const LAST_SEEN_THROTTLE_MS = 60_000; // don't write to the DB on every single request
const ONLINE_WINDOW_MS = 5 * 60_000;

// ---- leaderboard: rules ----
// Points = correct answers, counted by the server from the difference between a user's consecutive saves.
// Speed limit (token bucket): at most one counted answer per MS_PER_ANSWER on average, with room to bank
// BUCKET_CAP answers (so a long offline session that syncs later isn't cut short), and a daily ceiling.
// Splitting a burst into many small saves does not help, because tokens are only refilled by elapsed time.
const LB_TZ = 'Asia/Shanghai'; // one fixed timezone so "today" means the same thing for everyone
const MS_PER_ANSWER = 1500;
const BUCKET_CAP = 600;
const BUCKET_START = 60;
const DAY_ANSWER_CAP = 2500;
const LB_LIMIT_DEFAULT = 50;
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: LB_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const lbDay = ms => dayFmt.format(new Date(ms)); // 'YYYY-MM-DD'
const addDays = (ds, n) => { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekStart = ds => addDays(ds, -((new Date(ds + 'T12:00:00Z').getUTCDay() + 6) % 7)); // Monday
const dayStartMs = ds => Date.parse(ds + 'T00:00:00+08:00'); // Asia/Shanghai has no DST
function lbRange(period, now) {
  const today = lbDay(now);
  if (period === 'today') return { from: today, to: today, resetsAt: dayStartMs(addDays(today, 1)) };
  const ws = weekStart(today);
  if (period === 'week') return { from: ws, to: addDays(ws, 6), resetsAt: dayStartMs(addDays(ws, 7)) };
  if (period === 'lastweek') { const ls = addDays(ws, -7); return { from: ls, to: addDays(ls, 6), resetsAt: null }; }
  return null;
}
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
  return { id: u.id, email: u.email, name: u.name, verified: !!u.email_verified, admin: !!u.is_admin, leaderboard: !!u.lb_visible };
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
    const now = Date.now();
    if (now - (u.last_seen || 0) > LAST_SEEN_THROTTLE_MS) {
      db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, u.id);
      u.last_seen = now;
    }
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
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'forbidden' });
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
  db.prepare('INSERT INTO ledger (user_id, total_a, total_c, tokens, updated_at) VALUES (?, 0, 0, ?, ?)').run(user.id, BUCKET_START, Date.now());
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

// ---------- admin (owner-only: who is using the app, and enough about each of them to reach out as a lead) ----------
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// Reads what the client already computes for itself (words/parts/mocks/days in the saved progress JSON)
// and reduces it to the numbers an admin actually wants, without trusting the shape too much.
function userInsights(dataJson) {
  let s;
  try { s = JSON.parse(dataJson || '{}'); } catch (e) { s = {}; }
  const words = Object.values(s.words || {});
  const parts = Object.values(s.parts || {});
  const answered = parts.reduce((a, p) => a + (p.a || 0), 0);
  const correct = parts.reduce((a, p) => a + (p.c || 0), 0);
  const mocks = Array.isArray(s.mocks) ? s.mocks : [];
  const lastMock = mocks.length ? mocks[mocks.length - 1] : null;
  return {
    wordsMastered: words.filter(w => (w.m || 0) >= 4).length,
    wordsPracticed: words.length,
    answered, correct,
    accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    mocksTaken: mocks.length,
    bestMock: mocks.length ? Math.max(...mocks.map(m => m.total || 0)) : null,
    lastMockDate: lastMock ? lastMock.d : null,
    daysActive: Object.keys(s.days || {}).length,
  };
}
function adminUserRows() {
  const rows = db.prepare(`
    SELECT u.id, u.email, u.name, u.created_at, u.email_verified, u.last_seen, p.data
    FROM users u LEFT JOIN progress p ON p.user_id = u.id
    ORDER BY u.created_at DESC
  `).all();
  return rows.map(r => ({
    id: r.id, email: r.email, name: r.name,
    joined: r.created_at, verified: !!r.email_verified,
    lastSeen: r.last_seen || null,
    ...userInsights(r.data),
  }));
}

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({ users: adminUserRows(), now: Date.now(), onlineWindowMs: ONLINE_WINDOW_MS });
});

// For pasting into a spreadsheet / email tool: every signed-up user as a lead, most recent first.
app.get('/api/admin/export.csv', requireAdmin, (req, res) => {
  const header = ['Email', 'Name', 'Joined', 'Verified', 'Last active', 'Words mastered', 'Words practiced',
    'Accuracy %', 'Mocks taken', 'Best mock score', 'Days practiced'];
  const lines = [header.join(',')];
  for (const u of adminUserRows()) {
    lines.push([
      u.email, u.name, new Date(u.joined).toISOString().slice(0, 10), u.verified ? 'yes' : 'no',
      u.lastSeen ? new Date(u.lastSeen).toISOString() : '',
      u.wordsMastered, u.wordsPracticed, u.accuracy, u.mocksTaken, u.bestMock ?? '', u.daysActive,
    ].map(csvCell).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="hsk4-users-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\r\n') + '\r\n');
});

// ---------- progress routes (verified accounts only) ----------
// Totals of answered/correct across every practice type, from the progress JSON the client keeps.
function progressTotals(state) {
  let a = 0, c = 0;
  const parts = state && typeof state === 'object' ? state.parts : null;
  if (parts && typeof parts === 'object') {
    for (const v of Object.values(parts)) {
      if (!v || typeof v !== 'object') continue;
      const va = Number(v.a), vc = Number(v.c);
      if (Number.isFinite(va) && va > 0) a += Math.min(va, 1e7);
      if (Number.isFinite(vc) && vc > 0) c += Math.min(vc, 1e7);
    }
  }
  return { a: Math.floor(a), c: Math.floor(c) };
}

// Credits what changed since this user's previous save to today's leaderboard row, within the speed limits.
function creditActivity(userId, state, now) {
  const t = progressTotals(state);
  const led = db.prepare('SELECT total_a, total_c, tokens, updated_at FROM ledger WHERE user_id = ?').get(userId);
  if (!led) { // first save we have ever seen for this user: start counting from here
    db.prepare('INSERT INTO ledger (user_id, total_a, total_c, tokens, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, t.a, t.c, BUCKET_START, now);
    return;
  }
  const realA = t.a - led.total_a;
  const realC = Math.max(0, Math.min(t.c - led.total_c, realA));
  let dA = realA, dC = realC;
  const tokens = Math.min(BUCKET_CAP, led.tokens + Math.max(0, now - led.updated_at) / MS_PER_ANSWER);
  let spent = 0;
  if (realA > 0) {
    dA = Math.min(dA, Math.floor(tokens)); // speed limit
    const day = lbDay(now);
    const used = db.prepare('SELECT answered FROM activity WHERE user_id = ? AND day = ?').get(userId, day);
    dA = Math.min(dA, Math.max(0, DAY_ANSWER_CAP - (used ? used.answered : 0))); // daily ceiling
    dC = Math.floor(realC * (dA / realA)); // when trimmed, keep the same accuracy instead of crediting extra correct answers
    if (dA > 0) {
      spent = dA;
      db.prepare(`
        INSERT INTO activity (user_id, day, answered, correct) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, day) DO UPDATE SET answered = answered + excluded.answered, correct = correct + excluded.correct
      `).run(userId, day, dA, dC);
    }
  }
  // Baseline always follows the client's totals (also after a reset/import, which makes the delta negative and earns nothing).
  db.prepare('UPDATE ledger SET total_a = ?, total_c = ?, tokens = ?, updated_at = ? WHERE user_id = ?')
    .run(t.a, t.c, tokens - spent, now, userId);
}

// Accounts that existed before the leaderboard: baseline them at what they had already saved.
function bootstrapLedger() {
  const rows = db.prepare(`
    SELECT u.id, p.data, p.updated_at FROM users u LEFT JOIN progress p ON p.user_id = u.id
    WHERE u.id NOT IN (SELECT user_id FROM ledger)`).all();
  for (const r of rows) {
    let s = {};
    try { s = JSON.parse(r.data || '{}'); } catch (e) { /* empty */ }
    const t = progressTotals(s);
    db.prepare('INSERT INTO ledger (user_id, total_a, total_c, tokens, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(r.id, t.a, t.c, BUCKET_CAP / 3, r.updated_at || Date.now());
  }
  if (rows.length) console.log(`leaderboard: baselined ${rows.length} existing account(s)`);
}
bootstrapLedger();

function saveProgress(userId, state) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(userId, JSON.stringify(state), now);
  creditActivity(userId, state, now);
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

// ---------- leaderboard (every verified user can see it) ----------
const lbLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_attempts' } });

app.get('/api/leaderboard', lbLimiter, requireVerified, (req, res) => {
  const now = Date.now();
  const period = String(req.query.period || 'today');
  const range = lbRange(period, now);
  if (!range) return res.status(400).json({ error: 'bad_period' });
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || LB_LIMIT_DEFAULT));

  const rows = db.prepare(`
    SELECT u.id, u.name, SUM(a.answered) AS answered, SUM(a.correct) AS correct
    FROM activity a JOIN users u ON u.id = a.user_id
    WHERE a.day BETWEEN ? AND ? AND u.lb_visible = 1 AND u.lb_banned = 0 AND u.email_verified = 1
    GROUP BY u.id HAVING SUM(a.answered) > 0
    ORDER BY correct DESC, answered ASC, u.id ASC
  `).all(range.from, range.to);

  let rank = 0, prev = null;
  rows.forEach((r, i) => { const key = r.correct + '/' + r.answered; if (key !== prev) { rank = i + 1; prev = key; } r.rank = rank; });
  const shape = r => ({ rank: r.rank, name: r.name, points: r.correct, answered: r.answered,
    accuracy: r.answered ? Math.round((r.correct / r.answered) * 100) : 0, you: r.id === req.user.id });

  const mine = rows.find(r => r.id === req.user.id);
  const me = mine ? shape(mine) : { rank: null, points: 0, answered: 0, accuracy: 0, you: true };
  me.hidden = !req.user.lb_visible || !!req.user.lb_banned;
  me.banned = !!req.user.lb_banned;
  res.json({ period, from: range.from, to: range.to, resetsAt: range.resetsAt, now, tz: 'UTC+8',
    participants: rows.length, entries: rows.slice(0, limit).map(shape), me });
});

// The user's own leaderboard name and visibility.
app.put('/api/profile', authLimiter, requireVerified, (req, res) => {
  const { name, leaderboard } = req.body || {};
  if (name !== undefined) {
    const n = String(name).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!n) return res.status(400).json({ error: 'invalid_name' });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(n, req.user.id);
  }
  if (leaderboard !== undefined) db.prepare('UPDATE users SET lb_visible = ? WHERE id = ?').run(leaderboard ? 1 : 0, req.user.id);
  res.json({ user: publicUser(getUser(req.user.id)) });
});

// ---------- static app ----------
const APP_FILE = path.join(__dirname, 'public', 'index.html');
const sendApp = (req, res) => res.sendFile(APP_FILE, { headers: { 'Cache-Control': 'no-cache' } }); // revalidate (cheap 304) so deploys show up
// Site icons (tab icon, iPhone home-screen icon, install manifest). Generated by tools/make_web_icons.py.
// Explicit list rather than a static-files mount, so /index.html can't be served with a day-long cache.
const ICON_FILES = {
  '/favicon.ico': 'favicon.ico', '/favicon-32.png': 'favicon-32.png',
  '/apple-touch-icon.png': 'apple-touch-icon.png', '/apple-touch-icon-precomposed.png': 'apple-touch-icon.png', // iOS Safari asks for both
  '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png', '/icon-512-maskable.png': 'icon-512-maskable.png',
  '/manifest.webmanifest': 'manifest.webmanifest',
};
app.get(Object.keys(ICON_FILES), (req, res) => {
  const file = ICON_FILES[req.path];
  const headers = { 'Cache-Control': 'public, max-age=86400' };
  if (file.endsWith('.webmanifest')) headers['Content-Type'] = 'application/manifest+json';
  res.sendFile(path.join(__dirname, 'public', file), { headers }, err => { if (err && !res.headersSent) res.status(404).end(); });
});
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
