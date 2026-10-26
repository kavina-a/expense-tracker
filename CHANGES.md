# Changes

Plain-English notes on each phase of the autonomy work.

## Phase 0 — Security and hygiene

**Before this phase:** anyone who knew the Railway URL could read, change or delete every transaction, and download or overwrite a full backup. Only the SMS and Telegram routes were protected.

**What changed**

- **Everything under `/api` now needs a login.** The dashboard uses a password and an httpOnly cookie, so no key sits in the browser. Ledger and the iOS Shortcut use API keys, which come in three scopes: `full`, `agent` (read-only) and `ingest` (SMS only). Keys are generated on your own machine (`npm run key:generate`), shown once, and only a hash is stored. You give Railway the hashes in one variable, `API_KEY_SEEDS`, so no server shell is needed. `npm run key:create` still works when you are on a shell. The old `X-SMS-Secret` still works for the SMS routes so the Shortcut doesn't break.
- **CORS is stricter.** The "any `*.vercel.app` site" rule is gone.
- **The offline cache of API responses is gone.** The app used to keep a copy of your transactions on the device for 5 minutes; it no longer does, and it deletes the old copy.
- **A committed database backup was removed** and `*.db*` is now ignored. It held 2 test transactions and the category list. The repo is public, so it stays visible in history until you purge it (see the end of this file).
- **Follow-up questions survive restarts.** "How much was it?" state moved from memory into the database, still expiring after 10 minutes.
- **A notification switch, `NOTIFY_CHANNEL`.** The default (`ledger`) turns every SMS prompt into a question Ledger can read at `GET /api/agent/inbox`. `telegram` keeps the old behaviour.
- **Dates now follow Colombo time.** The server runs in UTC, so between midnight and 05:30 in Colombo "today" and "this month" were wrong. Fixed everywhere, including the database's "last N months" queries.
- **A safety net for migrations.** Before the first new migration, a full copy of the database is written next to it and the path is logged. Existing data is never rewritten.

**New environment variables:** `DASHBOARD_PASSWORD`, `API_KEY_SEEDS`, `NOTIFY_CHANNEL`, `FRONTEND_URL` (now an exact match), and optionally `COOKIE_SECURE`.

**New tables (empty until used):** `api_keys`, `sessions`, `pending_clarifications`, `escalations`, `questions`, `schema_migrations`.

**Tests:** 105 pass, and none of them touch the network any more (a few existing tests were quietly sending merchant names to Groq with a fake key). New ones check that every `/api` route (found by walking Express's own route list, so future routes are covered automatically) answers `401` without credentials, each key scope, revoked keys, the login cookie and lockout, session expiry, the cross-site write guard, the Colombo date rollover, expiring follow-ups, the migration backup, and both notification channels.

## Phase 1 — Reading every kind of bank SMS

- **The parser now understands all 13 HNB message kinds** seen in your real messages, including the ones with odd spacing (`Location :`, `Avl Bal`, `credit ed`). It only uses shapes that appear in the recordings; anything else stays "unparsed" instead of being guessed.
- **OTPs are never kept.** The code is blanked before the message is stored.
- **Declined payments are never booked.** They raise at most one low-balance escalation per account per day.
- **Nothing is dropped silently.** A new `sms_skipped` table records every SMS that was received but not booked, with the reason. A message nothing can read raises a `parser_failure` escalation for Ledger.
- **Heartbeat.** If the SMS stop arriving for 72 hours (`HEARTBEAT_HOURS`) on an account that normally gets about one a day, Ledger is told once.
- **Adding a bank got easier:** a parser template, and a test that checks any `fixtures/<bank>/*.json` automatically.
- **The real SMS samples are gitignored** because the repo is public; the tests skip when they aren't there.

**New table:** `sms_skipped` (migration `002_sms_skipped`, additive; a database backup is written first as before).

**Tests:** per-kind unit tests, the fixture parser check, skip/heartbeat tests, and the first part of the 62-message replay (OTPs, declines, low-balance, duplicate reversal SMS and no unparsed messages all match what you recorded). Later phases extend the replay.

### To purge the old backup from git history (you run this; I haven't)

```bash
git clone --mirror git@github.com:kavina-a/expense-tracker.git && cd expense-tracker.git
git filter-repo --invert-paths --path backend/expenses.db.bak-1783863046
git push --force --mirror
```

GitHub keeps pull-request refs (for example `refs/pull/1/head`) and cached views, so ask GitHub Support to finish the purge. Forks and clones made earlier keep their copy.
