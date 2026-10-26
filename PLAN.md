# PLAN — Autonomous ledger + "Ledger" agent

Status: **draft, waiting for approval.** Nothing has been changed except this file.

---

## 0. Before starting

### 0a. Where the source material is

The fixtures and the original brief are in `~/Downloads/suspense-prompt-pack/`, not in the repo:
- `backend/sms/fixtures/hnb/README.md`
- `backend/sms/fixtures/hnb/timeline_2026-10-18_to_26.json`
- `2_CLAUDE_CODE_PROMPT.md`

The pack's `backend/` folder contains exactly these two fixture files and nothing else. These are the versions this plan is based on (sha256):

- `README.md`: `0373fe6dbe35c6015b9d8f5805f8abddd79cf97c09a788fc3b74d92318f3a963`
- `timeline_2026-10-18_to_26.json`: `e62768648e7f376305986e61e9004d17b342792a68092268acdcbcc1b5549e21`

When the fixtures are brought into the repo, a test checks these hashes. That way the replay can't drift away from the reviewed data without anyone noticing.

I read all three as data. The original brief clears up the five passages that came through garbled in chat; I follow the original's wording:
- "Rent expense" followed by a separate MB BillPmt bullet;
- "source=auto";
- "date range";
- "options JSON";
- "CSV export" followed by a separate raw-SMS bullet.

The security scan flagged "invisible unicode" in the fixture. It's 5 zero-width joiners inside the Sinhala word රහස්‍ය in the trilingual OTP and "You received" trailers. That is normal Sinhala spelling, not an injection, but whitespace normalisation must not choke on it.

### 0b. ⚠️ The GitHub repo is public

`gh repo view` reports `kavina-a/expense-tracker` as **PUBLIC**. That has two consequences:

1. **`backend/expenses.db.bak-1783863046` has already been published.** Treat everything in it as exposed. Deleting it and purging history (Phase 0.3) limits further spread but can't take it back.
2. **The fixtures can't be committed as they are.** They contain your salary (95,975), every balance, the account tails, and spending with timestamps. See Q1 for the options. My recommendation is to make the repo private; option (b) in Q1 is the fallback.

### 0c. The local checkout is behind GitHub

Local `master` is one commit behind `origin/master` (PR #1, the real-HNB parser fix). I'll fast-forward before Phase 0. The baseline is 33/33 tests passing.

### 0d. I checked the fixture arithmetic

I walked every reported balance through each account's chain, using `scratchpad/chain.py`:
- There is **exactly one gap**: −106.56 on `2080***39`, between seq 16 and 17.
- End balances match `expected_end_state` on all 4 accounts.

This also confirms three design facts:
- Uber holds and their reversals **move the balance as they happen**.
- Only the first SMS of each reversal pair moves it.
- Declines move nothing.

So reconciliation runs over the stream of SMS events, not over settled ledger states.

---

## 1. Cross-cutting decisions

**Branch and commits.** Work happens on a `ledger-autonomy` branch, with one or more commits per phase. I stop after each phase. I don't push (Railway redeploys on push); you merge when you're ready.

**Timezone.**
- About 40 places compute "today" with `toLocaleDateString('sv-SE')`, which uses the server's timezone. Railway runs in UTC, so dates are wrong from 00:00 to 05:30 Colombo time.
- New `backend/time.js` adds Colombo-aware helpers and an injectable `now()` clock.
- `occurred_at` is stored with an explicit `+05:30`, as the fixtures expect. Legacy rows without an offset are read as Colombo time.

**Backup before migrating.** A small `schema_migrations(name, applied_at)` table records what has run. Before the first new migration, `db.backup()` writes `<db dir>/backups/expenses-pre-<name>-<ts>.db`, and that path is logged before any DDL runs. On Railway this lands on the `/app/data` volume. Changes are additive only; nothing is dropped or rewritten.

**Reconciliation runs over events, not arrival order.** Every link is a symmetric matcher inside one `reconcile()` pass, which runs after each ingest and in the settle job. Whichever side arrives first waits as "open", and the other side closes it. The links are:
- reversal ↔ debit
- the duplicate reversal SMS pair
- hold ↔ final fare
- ADJ ↔ debit
- refund ↔ debit
- transfer pairs
- "You received" ↔ credit
- orphan ↔ late debit

**Rules versus the LLM.** Groq is used only for three jobs:
- picking a category;
- cleaning up merchant display names (the raw text is always kept);
- wording notes.

It never sees balances and never sets state. In tests it is stubbed and deterministic.

**New backend dependencies.** All three are small and well-known:
- `ajv` validates request and response schemas, and the OpenAPI spec is generated from the same schemas;
- `pdfkit` produces the PDF statement;
- `cookie-parser`.

---

## 2. Phase 0 — Security and hygiene

### 0.1 API keys

- **Table `api_keys`:** `id, name, scope (full|ingest|agent), prefix, hash, created_at, revoked_at, last_used_at`.
- **Key format:** `stk_<prefix>_<secret>`. The prefix is public and used for lookup. The secret is 32 random bytes.
- **Storage:** only `sha256(secret)` is stored, which is fine because the secret is high-entropy. The check uses `crypto.timingSafeEqual`.
- **Header:** `Authorization: Bearer …`. `X-API-Key` is also accepted.
- **Commands:** `npm run key:create -- --name <n> --scope <s>` prints the key once. `key:list` and `key:revoke` cover the rest.
- **Public routes:** `/health`, `/privacy` and `/terms` stay public. `/webhook` and `/telegram` keep their own secrets.
- **SMS ingest:** `/api/sms-ingest` accepts an `ingest` key *or* the existing `X-SMS-Secret`, so the iOS Shortcut keeps working (Q2).
- **CORS:** the "any `*.vercel.app` origin" rule is removed.
- **Test:** walk Express's router stack, and fail if any `/api/*` route returns anything other than 401 without credentials. A future route can't ship without auth.

### 0.2 Dashboard access: single-user login with an httpOnly session cookie

Mechanics:
- `POST /api/auth/login` compares the password with `DASHBOARD_PASSWORD` in constant time.
- The session goes in a `sessions` table, so it survives restarts.
- The cookie is `HttpOnly; Secure; SameSite=Strict`, valid for 30 days.
- Logins are limited to 5 failures per 15 minutes.
- The frontend adds a `/login` page.

Why this instead of a Vercel serverless proxy that injects a server-held key:
1. **The proxy alone isn't secure.** If Vercel adds a full-scope key to every request, anyone who reaches the dashboard URL gets full access. You'd still need a login in front of it, so you'd build both.
2. **The login is simpler.** The browser already reaches Railway through Vercel's `/api/*` rewrite, so the cookie is same-origin. That means no CORS credentials and no third-party cookies. A proxy would add a function, a cold-start hop, and a second place where secrets live.
3. **CSRF:** `SameSite=Strict`, plus requiring `Content-Type: application/json` on writes.

Other notes:
- Local dev uses Vite's proxy to the local backend, because pointing `VITE_API_URL` at Railway would make the cookie cross-site.
- The PWA's 5-minute offline cache of `/api/*` responses (your financial data, on the device) is removed (Q7).

### 0.3 Remove the committed database backup

- `git rm backend/expenses.db.bak-1783863046`.
- Add `*.db*` to `.gitignore`.
- The purge for you to run (I won't rewrite history):

  ```bash
  git clone --mirror git@github.com:kavina-a/expense-tracker.git && cd expense-tracker.git
  git filter-repo --invert-paths --path backend/expenses.db.bak-1783863046
  git push --force --mirror
  ```

  GitHub keeps PR refs (`refs/pull/1/head`) and cached views, so ask GitHub Support to finish the purge. Forks and clones made before the purge keep the file.

### 0.4 Persist the clarification state

- New table `pending_clarifications(channel, chat_id, text, created_at, expires_at)`.
- Expired rows are ignored on read and cleaned up on write.
- `handler.js` keeps its function signatures.

### 0.5 `NOTIFY_CHANNEL=ledger|telegram` (default `ledger`)

- `backend/notify/` gets `escalate()` and `ask()`.
- The SMS prompt, category buttons, mute suggestion and "no note" flow all go through it.
- With `ledger`, items are written to `escalations` and `questions`. Both tables are created now with their final Phase 4 and 5 schemas.
- With `telegram`, behaviour is identical to today, and `notify.test.js` stays green.
- A read-only `GET /api/agent/inbox` ships now so that Ledger has something to read.

**Warning (Q3).** Ledger can't *answer* anything until Phase 5. With the default `ledger`, notes and categories would just pile up until then.

---

## 3. Phase 1 — HNB parser coverage

- **Fixtures.** Copied into `backend/sms/fixtures/hnb/`, subject to Q1. The fixture file is left exactly as written.
  - Its `expected_outcome` values are prose, so I'll add a sidecar `expected_outcomes.json`: a machine-checkable outcome per seq.
  - Where I disagree with a fixture value, the sidecar records my value and section 8 explains why.
- **Parser shape.** Each kind becomes a lenient field extractor instead of one anchored regex:
  - `Location ?:`;
  - `Av.Bal` or `Avl Bal`;
  - `Hot ?Line`;
  - `credit ?ed`;
  - extra spaces;
  - `Bal: ?LKR`;
  - comma thousands separators in some places and not others;
  - an optional `HNB ` prefix;
  - non-breaking spaces and zero-width joiners.
- **The 13 kinds:**
  1. card online debit
  2. card POS debit
  3. card reversal
  4. ECOM REV credit
  5. decline
  6. ADJ FOR ECOM credit
  7. MB transfer
  8. bill payment
  9. salary
  10. free-text account credit
  11. interest
  12. "You received" notice
  13. OTP

  Each matches only the signature given in the README.
- **Merchant names.** I'll store the merchant **as sent** in `merchant_raw` (e.g. `PickMe Ride`, `The Core 2.0`, which is what the fixtures expect) and an uppercase `merchant_key` for matching.
  - Today's code uppercases the stored merchant.
  - The existing `merchant` column keeps the uppercase key, so nothing downstream breaks.
- **Template.** `sms/parsers/_template.js` plus `fixtures/_template/`. A generic runner, `sms/parsers.test.js`, tests every `fixtures/<bank>/*.json` it finds, so a new bank is one parser file plus its fixtures.
- **`sms_skipped`:** `sms_raw_id, reason (otp|promo|declined|unparsed|duplicate_reversal), detail, flagged, created_at`. Unparsed messages are flagged and raise `parser_failure`.
- **OTP privacy.** OTP texts are stored with the code redacted (`Your verification code is ******…`). Storing live OTP codes in a database is a needless risk. See D9.
- **Heartbeat:** checked hourly. It raises `heartbeat_missing` when nothing has arrived for `HEARTBEAT_HOURS` (default 72) while the 30-day average is at least 1 per day. Only one is open at a time, and it closes on the next SMS.
- **Tests:**
  - one unit test per kind, from the fixture lines;
  - the replay of all 62 through `POST /api/sms-ingest`, on an ephemeral port with a temp database, a stubbed LLM, notifications disabled, and a fake clock set to each message's `occurred_at`;
  - assertions against `expected_end_state` plus the sidecar;
  - the same replay in 20 seeded random permutations, which must reach the same end state.

**No fixture yet.** The brief mentions four things the fixtures don't cover:
- `promo` messages;
- ATM withdrawals;
- credit-card bill payments;
- merchant-named refund credits other than ECOM REV and ADJ.

I'll build the ledger logic for them (with synthetic tests at the ledger layer, not the parser layer), but **no SMS matcher** until you supply a real sample.

---

## 4. Phase 2 — Transaction state machine

1. **States.**
   - Edges: `provisional→posted`, `provisional→voided`, `posted→voided`, `posted→refunded`.
   - A `refunded_amount` column handles partial refunds.
   - One `transition()` function enforces the edges and writes `transaction_events`.
   - One `counted_amount` SQL expression (`state='posted'`, net of refunds) replaces the roughly 8 copies of `POSTED_FILTER` used by totals, budgets, charts, trends, portfolio and chat.
   - Legacy `reversed` is read as `voided` (Q4).
2. **`transaction_events`** as specified, with actor `system`, `user` or `ledger`.
3. **Reversal pair.** A card alert and an ECOM REV credit with the same account, the same amount, and timestamps within 2 minutes are one reversal, whichever comes first. The second becomes `duplicate_reversal` in `sms_skipped`.
   - Fixture: seq 20, 27, 31, 33, 39, 45 and 51. Seq 32→33 and 38→39 arrive with the credit first.
   - The REV reference is stored as `ECOM REV/<n>`. **The data answers the open question in SMS_INGEST.md:** `ID:113007` is the same on all 7 messages, so it identifies the merchant or terminal, not the transaction.
4. **Uber holds.**
   - `hold_prone_merchants(pattern, settle_window_hours)`, seeded with `UBER` at 12 hours, matched against the exact `merchant_key`. `UBER EATS` must never count as `UBER`.
   - **A new debit in the same minute as a reversal of a hold is a final fare.** It posts immediately, with `final_of` set, and the note or thread moves across.
   - **The case where the final arrives first** (seq 18 before 19, 49 before 50, 37 before 38): at that moment it looks like a new hold, so it starts `provisional`. When the reversal arrives in the same minute, the final is promoted to `posted`.
   - **A reversal with no same-minute debit** voids the hold as a cancelled ride. The label can still be upgraded if a same-minute debit turns up later.
   - **Settle job:** runs at boot, every 15 minutes, and on each ingest. It posts holds older than the window.
   - **Extra guard (D5):** "final" requires the reversal to come at least 8 hours after the hold. In the data, cancellations come 8–17 *minutes* after the hold and finals come at +11 hours, so an unrelated new ride in the same minute as a cancellation isn't mistaken for a fare change.
5. **Two-way orphan matching.** A new debit checks open orphan reversals (same account, exact amount, merchant or no merchant). One match voids both; several go to needs_review.
6. **ADJ FOR ECOM.**
   - The pattern is `ADJ FOR ECOM/<merchant><MM>/<DD>`, split as the merchant followed by the last two digits before `/`.
   - The year comes from the SMS date, minus one if MM is later than the SMS month.
   - It links to that merchant's largest unrefunded debit on that date and adds to `refunded_amount`. No match → needs_review. Never income.
   - Seq 52 nets 8.87 against seq 23. Seq 24 has no match (D3).
7. **Refunds.** A credit with the same merchant or a REV reference, amount ≤ the original, within 60 days, marks the debit `refunded` or partly refunded. Never income.
8. **Transfers.**
   - **New `accounts` table:** `account_masked, bank, kind, nickname, purpose, own`. Existing `own_accounts` rows are copied in; the old table stays.
   - **Own accounts (D6):** any account that receives HNB alerts on your phone is yours, so ...64 and ...82 are marked `own=1`. Their purpose is "unconfirmed".
   - **Pairing:** opposite amounts across own accounts within ±2 days, exact-second matches first. Seq 3 and 4 are such a pair.
   - **`Reason:MB:<text>`:** the text becomes the note (`note_source=bank_remark`), with no prompt, and the category comes from the remark. The type depends on Q8 (D1).
   - **`MB BillPmt/<Biller>/…`:** the merchant is the biller (`Mobitel`, not today's `MOBITEL BILL PAYMENT`), with `recurring_candidate=1`.
   - Card bill payments and ATM withdrawals: ledger logic only, no matcher (see the Phase 1 "No fixture yet" note).
9. **Interest.** Seed the category `Interest` (income, `exclude_from_earned=1`). Seq 57–60 are booked on their own accounts. They're excluded from the "earned" headline and included in the balance chain.
10. **Declines.** They go to `sms_skipped` and are never booked. A `low_balance` escalation is raised at most once per day per account. The trigger is in D2.
11. **"You received".** Creates an `inbound_pending` row (D4). It auto-matches a credit of the same amount within 2 hours; after that the settle job turns it into a question. Seq 13 never matches, so it becomes a question.

---

## 5. Phase 3 — Smart layer

- **`merchant_profiles`:** updated on each posted transaction, excluding unrecalled and voided rows.
  - Fields: category, p25 and p75 (trusted from 5 samples), a weekday×hour histogram, the last 5 notes, `is_recurring`, `is_hold_prone`, `is_aggregator`.
- **Auto-notes:** same merchant within ±1 h, amount inside p25–p75, and the same note the last 3 times → `note_source=auto`, undoable through `transaction_events`. Otherwise up to 3 past notes go on the question as `options`. The streak and mute logic stay.
- **Recurring:** amount within ±10%, gaps of 28–31 days, seen 3 times. Predicts the next charge and flags it when missing (more than 3 days late) or when the price changes.
- **Anomalies:**
  - more than 2× the merchant's p75;
  - an unknown merchant whose country code isn't `LK`;
  - the same merchant and amount within 10 minutes.

  Hold/final pairs are excluded. Seq 40 and 41 (PickMe, 1 minute apart, different amounts) are **not** flagged.
- **Balance chain.** `account_balances` stores every reported balance, as one chain per account (card `Av.Bal` and `Bal:` together).
  - **Ordering problem found in the data.** Card alerts only have minute precision. Seq 18 (final debit 05:57) and seq 19 (reversal 05:57) only reconcile in arrival order. Sorted by timestamp, the tie could fall either way and produce false gaps.
  - **Fix:** order by minute, then inside a same-minute group choose the order that makes the reported balances consistent. A gap is raised only if *no* order within the minute reconciles. This keeps the check independent of arrival order.
  - **Result on the fixtures:** exactly one gap of −106.56 between seq 16 and 17. Its evidence lists seq 15 (the 670.59 Uber ride that settled inside that window) as the likely cause. 777.15 − 670.59 = 106.56, which matches the README's guess.

---

## 6. Phase 4 — API v1 and agent hooks

- **Route registry.** Each route is declared once with `defineRoute({method, path, scopes, summary, description, params, body, responses, examples, errors, handler})`.
  - Express mounting, ajv validation and `/api/v1/openapi.json` (3.1) all come from it.
  - Old `/api/*` paths become aliases.
  - A test fails if any mounted route is missing from the spec.
- **Endpoints:** as specified. Search covers text, amount range, date range, category, merchant, account and state. Split creates `split_of` children.
- **Agent scope:**
  - `GET /agent/inbox`
  - `POST /agent/actions`: typed actions, each requiring a `reason`
  - `POST /agent/notify`: 6 per Colombo day, counted in SQLite
- **Guards:** the agent gets `403 needs_approval` plus an approval request for deletes, edits to more than 5 rows, budget edits, and saving rules or facts.
- **Approvals:**
  - A quoted reply expires after 24 hours.
  - Deletes, restores and bulk edits over 20 rows need a one-time confirm link, which only a logged-in dashboard session can open.
  - Caveat: an approval made from a quote is only as trustworthy as Ledger, because the agent key both submits the quote and is the one being approved. The confirm link is the real control.
- **Escalation types:** as listed, each with a `dedupe_key` so detectors are idempotent.
- **Outbound webhook:**
  - `X-Signature: sha256=HMAC("<X-Timestamp>.<body>")`. Including the timestamp prevents replays.
  - At most once every 30 minutes, and only when there's something new.
  - Persisted retries at 1, 5 and 25 minutes.
  - Account numbers masked as `***39`.
  - Nothing is sent when `LEDGER_WEBHOOK_URL` is unset.
- **Per-key controls:** token-bucket rate limits, an `agent_audit` log with the before-image of each write, and `POST /api/v1/agent/actions/:id/undo`.

## 7. Phases 5 and 6

As specified in the brief, with these points:
- **`unrecalled`** keeps the item in totals, excludes it from learning and never asks again. An unrecalled gap gets an `Unreconciled` adjustment.
- **Arimac salary** is seeded *disabled*. The replay asserts seq 53 has no label while the source is disabled, and "Arimac October salary" once it's enabled, with the month taken from `SALARY_OCT_2026`.
- **Mintpay:** `aggregator_merchants` (seeded with `MINTPAY PVT LTD`) and `bnpl_plans`, with the four required tests. Seq 11 (683.00) has no plan, so it becomes a `pending_store` question.
- **Reports, dashboard pages, the PWA manifest fix, the README rewrite and `CHANGES.md`:** as specified.

---

## 8. Fixture discrepancies — where I'd differ, and why

| # | Seq | Fixture says | I'd do | Why |
|---|---|---|---|---|
| D1 | 14, 17, 62 | `posted` expenses (Rent, outing, Household) | **Depends on Q8.** The brief says "payee unknown → `transfer_out` unless I mark it as an expense". The fixture books all three as expenses. | Every MB transfer here goes to an unknown payee, so the brief's rule makes all three transfers. That contradicts the fixture. My recommendation: a remark that describes spending makes it an expense, with the category from the remark, and a question only when the LLM is unsure. |
| D2 | 54 | low-balance signal "while salary sits in …91" | Raise it | The brief's rule ("declined amount > available balance *including my other accounts*") **suppresses** seq 54: 1,687 < 729 + 95,975. But the README says this nudge exists precisely for money sitting in the salary account. I'd trigger on *this account's* available balance and put the other accounts' balances in the evidence ("move money from …91"). Result: seq 2, 46 and 54 raise one escalation each; seq 47 is the same day as 46, so it's deduped. |
| D3 | 24 | "refund linked to UBER ride on 16 Oct" | `needs_review` (orphan adjustment, never income), and it auto-links if the 16 Oct debit is ever imported | That debit happened before the recording, so it doesn't exist in a replay. `expected_end_state.needs_review` lists only `[13, 55]`; I'd make it `[13, 24, 55]`. |
| D4 | 13 | `direction: credit`; `received_at: "…T14:2x…"` | `direction: none` (a notice, not a ledger movement); replay `received_at` 14:25 | Counting it as a credit would double-count when it matches a real account credit. `14:2x` isn't a valid timestamp, and the text itself has no time. |
| D5 | 16/18, 21/25, 36/37, 43/49 | final = a same-minute debit | Same rule, plus the reversal must come ≥ 8 h after the hold | Without the guard, a cancellation at +8–17 minutes that coincides with your next booking in the same minute would be read as a fare change. The data shows a clear split: cancellations at minutes, finals at +11 h. |
| D6 | 3+4 | pair "own accounts …64→…39"; README says …64 "unconfirmed" | Mark …64 and …82 `own=1` automatically | HNB sends these alerts only for accounts registered to your number. Without own=1 the pair can't form. Their nicknames and purposes stay open questions. |
| D7 | 15 | final state `unknown` | `posted` at +12 h by the settle rule, and named as the suspect in the balance_gap evidence | "Unknown" isn't a ledger state. The gap escalation is where the doubt belongs, so a resolution ("yes, it was 777.15") can then add the missing adjustment. |
| D8 | all | `merchant` in mixed case (`PickMe Ride`) | Match on `merchant_raw` as sent; `merchant_key` uppercase | Today's code uppercases. Keeping both satisfies the fixture and keeps matching stable. |
| D9 | 6, 7, 12, 61 | four byte-identical OTP texts; 6 and 7 share the date `2026-10-18` | Never deduplicate OTPs by text; replay gives each a distinct `received_at`; store with the code redacted | Anonymising the codes to 123456 made 6 and 7 identical, and a text-based dedupe would drop one of them. Real codes differ, and storing them at all is a risk. |
| D10 | 10, 1, 9, 35, 62… | categories like "Phone bill", "Food delivery", "Coffee/Eating out", "Household", "Rent" | The replay asserts states, links, amounts and balances, **not LLM-chosen category names** | None of those category names exist in your categories table, and LLM output isn't deterministic. Rule-decided categories (Interest, salary) are asserted. |
| D11 | 17 | account …39 "inferred" (last digit hidden in the recording) | Accept it, and mark the replay's gap test as depending on that inference | The single expected gap rests on this transcription. The README already asks for 2–3 copy-pasted originals. |

---

## 9. Open questions

- **Q1. The public repo and the fixtures.** Pick one:
  - (a) make the repo **private** and commit the fixtures as they are (recommended);
  - (b) keep the repo public, gitignore `backend/sms/fixtures/hnb/`, and have the replay test load them from `SMS_FIXTURES_DIR` (skipped with a warning when absent, so CI on a public repo never sees them);
  - (c) commit an anonymised copy with amounts and balances scaled by one constant factor, so the arithmetic, including the −106.56 gap, still holds at a new scale. That changes "real data" into "derived data".
- **Q2. Old SMS secret.** Keep `X-SMS-Secret` permanently, or only until you switch the Shortcut to an `ingest` key?
- **Q3. Default channel.** The code default is `ledger`. Should Railway run `telegram` until Phase 5, when Ledger can actually answer questions?
- **Q4. `reversed` → `voided`.** Map at read time with no data rewrite (my default), or run a one-off `UPDATE`, backed up and logged as events?
- **Q5. Seeded category rules.** They point `UBER` → `Transport` and `UBER EATS` and friends → `Food`, categories that don't exist (yours are `Uber` and `Uber Eats`). Should I re-point the rules? Existing rows stay as they are unless you say otherwise.
- **Q6. Ledger itself.** The Grok-side bot is out of scope; I'll deliver the OpenAPI spec and an example tool manifest only. I noticed `1_LEDGER_PROMPT_for_Dr_Eggbot.md` in the same pack and haven't used it. Is that right?
- **Q7. Offline cache.** Drop the PWA's offline API cache (my default)?
- **Q8. MB transfers to unknown payees (D1).** Should a remark-described transfer be booked as an expense (my recommendation, matching the fixture), or as `transfer_out` until confirmed (the brief's wording)?
- **Q9. Low-balance trigger (D2).** Use this account's balance as the trigger, with the other balances as evidence (my recommendation)?
- **Q10. Branch.** OK to work on `ledger-autonomy` and leave merging and pushing to you?
- **Q11. The fixture's open items.** The answers belong in Phase 5 facts, but you can tell me now:
  - Seq 13: which account did the 51,000 from PERERA A B land in, and what was it?
  - Seq 55: what is the 19,000 "Oct-Nov"?
  - The −106.56 gap: was the seq 15 ride adjusted to 777.15?
  - Can you paste 2–3 original SMS so the exact spacing can be confirmed?
