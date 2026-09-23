// Built-in SQLite (Node >= 22.13) — no native npm module to compile.
// On the VPS this runs under the nvm Node 24 install, not the system Node 20.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- one-time 6-digit codes for email verification and password reset (only the HMAC is stored)
CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS codes_user_kind ON codes(user_id, kind);
-- Leaderboard: per-user, per-day credited answers. Days are China Standard Time (UTC+8) calendar days.
CREATE TABLE IF NOT EXISTS activity (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS activity_day ON activity(day);
-- Totals seen at each user's previous save, plus a speed-limit token bucket; the difference between two
-- saves is what gets credited to the leaderboard (see creditActivity in server.js).
CREATE TABLE IF NOT EXISTS ledger (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_a INTEGER NOT NULL,
  total_c INTEGER NOT NULL,
  tokens REAL NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

// Columns added after the first deploy.
const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!cols.includes('email_verified')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  // Accounts created before verification existed keep working (grandfathered in, once).
  db.exec('UPDATE users SET email_verified = 1');
}
// Bumped on password reset so every older login cookie stops working.
if (!cols.includes('token_version')) db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
// Admin dashboard: who can see it, and a cheap "last active" timestamp (updated at most once a minute per user).
if (!cols.includes('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
if (!cols.includes('last_seen')) db.exec('ALTER TABLE users ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0');
// Leaderboard: users can hide themselves; lb_banned is an owner-only switch (scripts/admin.js lb-ban) for cheaters.
if (!cols.includes('lb_visible')) db.exec('ALTER TABLE users ADD COLUMN lb_visible INTEGER NOT NULL DEFAULT 1');
if (!cols.includes('lb_banned')) db.exec('ALTER TABLE users ADD COLUMN lb_banned INTEGER NOT NULL DEFAULT 0');

db.DB_PATH = DB_PATH;
module.exports = db;
