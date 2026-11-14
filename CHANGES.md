# Changes

Plain-English notes on each phase of the autonomy work.

## Mintpay is a payment method, not a shop

**Before this:** a Mintpay bank SMS was treated like any merchant. A leftover `category_rules` row, a Ledger mapping, a Groq guess, or one Telegram category tap could stamp **every** later Mintpay charge with the same category (for example Out w Friends), even though Mintpay is only the way the card was charged.

**What changed**

- Mintpay (`MINTPAY`, `MINTPAY PVT LTD`) is an **aggregator**. SMS ingest skips mappings, `category_rules`, and the model. The expense is still posted (`pending_category`, `needs_review`) so totals keep the amount; it does not disappear.
- Ledger is asked via the existing questions + `aggregator_unplanned` escalation (webhook when configured). The prompt asks for the **underlying shop** and **Pay Now vs instalments**, with those two choices only — no category grid.
- One answer applies to **that charge only**. `resolve_aggregator` (`POST /api/v1/agent/actions`) sets store / payment / optional category on that row and does not write `merchant_mappings` or `category_rules`. Telegram category taps and `upsertCategoryRule` are blocked for Mintpay the same way.
- `upsert_mapping` for Mintpay is rejected. Duplicate SMS reuse the same question (`dedupe_key`). Ordinary merchants (Uber rules, Groq for unknown shops) are unchanged.
- Existing mis-labelled Mintpay rows are **not** bulk-edited.

**Not in this change:** instalment-plan auto-link (`bnpl_plans` is not implemented). No production writes.

**Tests:** fictional Mintpay / Uber / Keells / cafe names only.

## Telegram category apply and Groq fallback

**Before this:** a reply to a `pending_category` SMS card was saved as a **note**, so the web still showed the slug `pending_category`. Category buttons mixed in ghost names (`Food`, `Transport`) from `category_rules`. Typing **Other** did not insert a row in `categories`, so the dashboard icon map missed it. Groq `json_validate_failed` on `sms_category` could fail the guess path. The Telegram webhook returned 200 before the category write finished.

**What changed**

- While an SMS row is `pending_category`, a reply-to or a category-button tap runs `applyCategory`. Notes are only attached after a category is set.
- Telegram (and Ledger category choices) list real expense names from the `categories` table, not rule ghosts.
- Seeded rules and additive migration `007_remap_food_transport_rules` point `UBER EATS` → Uber Eats, `FOODPANDA` / `PICKME FOOD` → Fast Food, `UBER` → Uber. Transaction rows are not bulk-edited.
- `applyCategory` matches names case-insensitively. An **Other**-typed new name is inserted as an expense category.
- The transactions page labels `pending_category` as **Needs category** and refetches on focus with a 5s `staleTime`.
- Category apply logs `SmsCategory telegram_applied` with `{ id, category }` only. The `/telegram` webhook waits for callback and reply writes before 200.
- Groq `json_validate_failed` / empty JSON / a thrown guess leaves the charge `pending_category` and asks. No blank or random category.
- Mintpay is never mapped, guessed, or learned as a global category. A reply names the shop on that charge only; it does not write a MINTPAY rule.
- Optional: if `TELEGRAM_WEBHOOK_URL` is HTTPS, boot calls `setWebhook` with `callback_query` (idempotent; failures are skipped).

**Tests:** fictional merchants and amounts only (NEWCAFE, ODD MERCHANT XYZ, PETS VET, …). No production writes, no secrets.

## Ledger income capture and corrections

**Before this:** agent capture only booked **expenses** on an exact date+amount match. Nearby SMS amounts could not be corrected, income (salary/tutoring) had no capture type, OpenAPI treated `payload` as an untyped object, and Cloudflare mapped to Taggy if the description contained **either** DOMAIN or TAGGY.

**What changed**

- **`capture_income`** (and `type: "income"` on batch items) using the same exact date+amount rule against income rows. Known income categories already in the app (Arimac, Tutopiya, …) work; new names go through `ensure_category` with `type: "income"`.
- **`correct_transaction`**: `{ transaction_id, expected: { date, amount, type?, category? }, set: { date, amount, type, category, … } }`. Optimistic concurrency: if the row no longer matches `expected`, the API returns `409` with the current public snapshot. SMS `raw_message`, source, account, and `occurred_at` stay put. Original date/amount/type/category are written to `transaction_events`.
- **`dry_run`**: on the action or payload; previews and does not consume `idempotency_key`.
- **OpenAPI 1.2.0** typed schemas: `CaptureItem`, `CorrectTransactionPayload`, `CaptureBatchPayload`, `AgentActionRequest`. `GET /api/v1/transactions/{id}` for expected originals (still no raw SMS).
- **No fuzzy match:** capture never picks a nearby amount or date. Merchant, when sent, is a constraint. Identified mismatches must go through `correct_transaction`.
- **Cloudflare mapping** now requires **both** DOMAIN and TAGGY (`DOMAIN+TAGGY`). A Cloudflare domain charge that is not for Taggy stays unmatched. Migration `006_cloudflare_domain_taggy` removes the old DOMAIN-or-TAGGY alternatives (mapping rows only).

**Out of scope here:** rows outside October 2026. This increment does not reclassify or import later months.

**Tests:** fictional October figures only.

## Ledger capture (agent v1 writes)

**Before this:** Ledger's documented API was `GET /openapi.json` and `GET /agent/inbox`. An agent key could not list a date range of transactions, create a category, save a merchant mapping, or record an expense annotation. Existing SMS rows could only be read through the undocumented dashboard `GET /api/transactions`.

**What changed**

- **v1 reads:** `GET /api/v1/transactions` (Colombo `from`/`to` or `month`), `GET /api/v1/categories`, `GET /api/v1/merchant-mappings`, `GET /api/v1/agent/actions`.
- **v1 writes:** `POST /api/v1/agent/actions` with a required `reason`. Types: `ensure_category`, `upsert_mapping`, `capture_expense`, `capture_batch`. Agent keys cannot POST the dashboard routes or touch backup/restore/delete.
- **Duplicate-safe capture:** match `expense` rows on date + amount. One hit is enriched (category/note/merchant filled in; amount, date and account are left alone). Several hits return `needs_review` and open an inbox question. No hit inserts `source=ledger` with `account_masked` null. A later matching bank SMS links onto that row instead of booking a second expense.
- **Mappings are conservative:** Cloudflare only becomes Taggy when the description contains **both** DOMAIN and TAGGY. Fashn.ai → Modelsnapper. Claude → the existing **AI Tools** category (`AI expenses` is an alias, not a second category).
- **CLI:** `npm run ledger:capture -- --file <json>` (`--dry-run` or `--local`, or `LEDGER_API_KEY` against `--base`). Personal amounts stay out of git; `backend/ledger/capture.example.json` uses fictional figures.

**New tables (additive migration `005_ledger_capture`):** `merchant_mappings`, `agent_actions`. Existing rows are not rewritten.

**Tests:** fictional merchants and amounts only (Acme Cloud / Northwind, Widget.ai / Gizmo, Brainbox, Tunes). No production call, no secrets.

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
