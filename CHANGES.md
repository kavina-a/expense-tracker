# Changes

Plain-English notes on each phase of the autonomy work.

## Phase 0 — Security and hygiene

**Before this phase:** anyone who knew the Railway URL could read, change or delete every transaction, and download or overwrite a full backup. Only the SMS and Telegram routes were protected.

**What changed**

- **Everything under `/api` now needs a login.** The dashboard uses a password and an httpOnly cookie, so no key sits in the browser. Ledger and the iOS Shortcut use API keys, which come in three scopes: `full`, `agent` (read-only) and `ingest` (SMS only). Keys are created from the command line, shown once, and only a hash is stored. The old `X-SMS-Secret` still works for the SMS routes so the Shortcut doesn't break.
- **CORS is stricter.** The "any `*.vercel.app` site" rule is gone.
- **The offline cache of API responses is gone.** The app used to keep a copy of your transactions on the device for 5 minutes; it no longer does, and it deletes the old copy.
- **A committed database backup was removed** and `*.db*` is now ignored. It held 2 test transactions and the category list. The repo is public, so it stays visible in history until you purge it (see the end of this file).
- **Follow-up questions survive restarts.** "How much was it?" state moved from memory into the database, still expiring after 10 minutes.
- **A notification switch, `NOTIFY_CHANNEL`.** The default (`ledger`) turns every SMS prompt into a question Ledger can read at `GET /api/agent/inbox`. `telegram` keeps the old behaviour.
- **Dates now follow Colombo time.** The server runs in UTC, so between midnight and 05:30 in Colombo "today" and "this month" were wrong. Fixed everywhere, including the database's "last N months" queries.
- **A safety net for migrations.** Before the first new migration, a full copy of the database is written next to it and the path is logged. Existing data is never rewritten.

**New tables (empty until used):** `api_keys`, `sessions`, `pending_clarifications`, `escalations`, `questions`, `schema_migrations`.

**Tests:** 97 pass. New ones check that every `/api` route (found by walking Express's own route list, so future routes are covered automatically) answers `401` without credentials, each key scope, revoked keys, the login cookie and lockout, session expiry, the cross-site write guard, the Colombo date rollover, expiring follow-ups, the migration backup, and both notification channels.

### To purge the old backup from git history (you run this; I haven't)

```bash
git clone --mirror git@github.com:kavina-a/expense-tracker.git && cd expense-tracker.git
git filter-repo --invert-paths --path backend/expenses.db.bak-1783863046
git push --force --mirror
```

GitHub keeps pull-request refs (for example `refs/pull/1/head`) and cached views, so ask GitHub Support to finish the purge. Forks and clones made earlier keep their copy.
