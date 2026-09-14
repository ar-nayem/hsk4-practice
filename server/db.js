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

db.DB_PATH = DB_PATH;
module.exports = db;
