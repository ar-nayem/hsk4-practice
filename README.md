# HSK4 Practice

A single self-contained offline exam-practice app for the HSK 4 Chinese
proficiency test, built from a plain-text question bank — plus a small
account server for cross-device progress sync and an Android build.

Live at [hsk.arnayem.top](https://hsk.arnayem.top).

## What it does

- **Practice content** — sentences (basic/core/L3/L4, plus an extended
  L1–L4 set), dialogues, reading passages, picture-description prompts,
  word-order exercises, and a vocabulary list, all from `data/*.txt`
  and `data/words.json`
- **Offline-first** — `build.py` compiles everything into one
  self-contained `HSK4_Exam_Practice.html` with no external dependencies
- **Accounts** — email-code signup verification, password reset, session
  cookies (`server/`)
- **Progress sync** — per-user progress persisted server-side and synced
  across devices via a beacon endpoint
- **Android app** — packaged from the same offline HTML (`android/`)

## Stack

Vanilla JS/HTML/CSS (offline app) · Node.js + Express (`server/`, Node ≥22) ·
SQLite · JWT sessions · Nodemailer (Gmail SMTP) · Python (build script)

## Getting started

```bash
# Rebuild the offline practice file from data/
python3 build.py

# Run the account/sync server
cd server
npm install
cp .env.example .env   # JWT secret, SMTP credentials
npm start
```

## Deploying

`deploy.sh` rsyncs `server/` to the VPS and restarts the pm2 process.
It reads the VPS SSH password from the `SSHPASS` environment variable —
export it yourself before running, it's never stored in the script.
