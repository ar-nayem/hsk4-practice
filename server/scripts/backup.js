'use strict';
// Nightly: consistent snapshot of data.db -> BACKUP_DIR/hsk4-YYYY-MM-DD-HH-MM.db.gz, keep the newest BACKUP_KEEP.
// Sundays (or with --email): also mail the snapshot to BACKUP_EMAIL so a copy lives off this server.
// Also purges accounts that were never verified within 7 days, and expired one-time codes.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (e) { /* no .env */ }
const db = require('../db');

const DIR = process.env.BACKUP_DIR || '/root/backups/hsk4';
const KEEP = Number(process.env.BACKUP_KEEP) || 14;
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const raw = path.join(DIR, `hsk4-${stamp}.db`);
if (fs.existsSync(raw)) fs.unlinkSync(raw);
db.exec(`VACUUM INTO '${raw.replace(/'/g, "''")}'`); // safe while the app is running (WAL)
const gz = `${raw}.gz`;
fs.writeFileSync(gz, zlib.gzipSync(fs.readFileSync(raw)), { mode: 0o600 });
fs.unlinkSync(raw);

const snaps = fs.readdirSync(DIR).filter(f => /^hsk4-.*\.db\.gz$/.test(f)).sort();
for (const f of snaps.slice(0, Math.max(0, snaps.length - KEEP))) fs.unlinkSync(path.join(DIR, f));

const purged = db.prepare('DELETE FROM users WHERE email_verified = 0 AND created_at < ?').run(Date.now() - 7 * 864e5).changes;
db.prepare('DELETE FROM codes WHERE expires_at < ?').run(Date.now());
const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

console.log(`${new Date().toISOString()} ${path.basename(gz)} ${fs.statSync(gz).size}B users=${users} purged_unverified=${purged} snapshots=${Math.min(snaps.length, KEEP)}`);

if (process.env.BACKUP_EMAIL && (new Date().getDay() === 0 || process.argv.includes('--email'))) {
  const { sendMail } = require('../mail');
  sendMail({
    to: process.env.BACKUP_EMAIL,
    subject: `HSK 4 Prep backup ${stamp} (${users} users)`,
    text: `Weekly off-server copy of the HSK 4 Prep accounts database (${users} users).\n\n` +
      `Restore: gunzip it, then on the server: pm2 stop hsk4, replace /var/www/hsk4-server/data.db with it ` +
      `(and delete data.db-wal / data.db-shm), pm2 start hsk4.\n\nPasswords inside are bcrypt hashes, not plain text.\n`,
    attachments: [{ filename: path.basename(gz), path: gz }],
  }).then(
    () => console.log(`emailed to ${process.env.BACKUP_EMAIL}`),
    err => { console.error('backup email failed:', err.message); process.exitCode = 1; },
  );
}
