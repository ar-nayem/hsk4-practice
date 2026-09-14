'use strict';
// Outgoing email over SMTP (Gmail app password on the VPS). MAIL_DEV=1 prints mail to the console instead.
const nodemailer = require('nodemailer');

let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(SMTP_PORT) || 465;
  transporter = nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  return transporter;
}

async function sendMail({ to, subject, text, html, attachments }) {
  if (process.env.MAIL_DEV === '1') {
    console.log(`[mail:dev] to=${to} | ${subject}\n${text}`);
    return;
  }
  const t = getTransport();
  if (!t) throw new Error('SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS)');
  const from = `"${process.env.MAIL_FROM_NAME || 'HSK 4 Prep'}" <${process.env.SMTP_USER}>`;
  await t.sendMail({ from, to, subject, text, html, attachments });
}

// Logs in to the SMTP server without sending anything — used to check the config.
async function verifyMail() {
  const t = getTransport();
  if (!t) throw new Error('SMTP is not configured');
  return t.verify();
}

module.exports = { sendMail, verifyMail };
