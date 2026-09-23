'use strict';
// Manual support tool, run on the server:
//   node scripts/admin.js list
//   node scripts/admin.js verify <email>          mark an email as verified (if the code email never arrives)
//   node scripts/admin.js reset-password <email>  set a random temporary password and sign out all sessions
//   node scripts/admin.js delete <email>          remove the account and its history
//   node scripts/admin.js make-admin <email>      grant access to the in-app Admin dashboard (/api/admin/*)
//   node scripts/admin.js revoke-admin <email>    remove that access
//   node scripts/admin.js lb-ban <email>          remove someone from the leaderboards (cheating); lb-unban reverses it
const path = require('path');
const crypto = require('crypto');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (e) { /* no .env */ }
const bcrypt = require('bcryptjs');
const db = require('../db');

const [cmd, arg] = process.argv.slice(2);
const find = email => db.prepare('SELECT id, email, name, email_verified FROM users WHERE email = ?')
  .get(String(email || '').trim().toLowerCase());
function need(u) { if (!u) { console.error('No user with that email.'); process.exit(1); } }
const day = ms => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '—');

switch (cmd) {
  case 'list': {
    const rows = db.prepare(`SELECT u.id, u.email, u.name, u.email_verified AS v, u.is_admin AS a, u.created_at, p.updated_at
      FROM users u LEFT JOIN progress p ON p.user_id = u.id ORDER BY u.id`).all();
    for (const r of rows) {
      console.log(`${r.id}\t${r.v ? 'verified  ' : 'UNVERIFIED'}${r.a ? ' (admin)' : ''}\t${r.email}\t${r.name}\tjoined ${day(r.created_at)}\tlast save ${day(r.updated_at)}`);
    }
    console.log(`${rows.length} user(s)`);
    break;
  }
  case 'verify': {
    const u = find(arg); need(u);
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(u.id);
    console.log(`Verified ${u.email}`);
    break;
  }
  case 'reset-password': {
    const u = find(arg); need(u);
    const pw = crypto.randomBytes(9).toString('base64url');
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(pw, 10), u.id);
    console.log(`Temporary password for ${u.email}: ${pw}\nAll of their existing sessions were signed out.`);
    break;
  }
  case 'delete': {
    const u = find(arg); need(u);
    db.prepare('DELETE FROM codes WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM progress WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    console.log(`Deleted ${u.email}`);
    break;
  }
  case 'make-admin': {
    const u = find(arg); need(u);
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(u.id);
    console.log(`${u.email} can now see the Admin dashboard (Settings appears after they next sign in, or reload if already signed in).`);
    break;
  }
  case 'revoke-admin': {
    const u = find(arg); need(u);
    db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(u.id);
    console.log(`Revoked admin access for ${u.email}.`);
    break;
  }
  case 'lb-ban': {
    const u = find(arg); need(u);
    db.prepare('UPDATE users SET lb_banned = 1 WHERE id = ?').run(u.id);
    console.log(`${u.email} no longer appears on the leaderboards.`);
    break;
  }
  case 'lb-unban': {
    const u = find(arg); need(u);
    db.prepare('UPDATE users SET lb_banned = 0 WHERE id = ?').run(u.id);
    console.log(`${u.email} can appear on the leaderboards again.`);
    break;
  }
  default:
    console.log('Usage: node scripts/admin.js list | verify <email> | reset-password <email> | delete <email> | make-admin <email> | revoke-admin <email> | lb-ban <email> | lb-unban <email>');
}
