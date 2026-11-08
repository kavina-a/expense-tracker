# 💸 WhatsApp Expense Tracker
> **Status: Production-ready.** All 35 audit issues resolved. Zero build errors.

A personal, single-user expense tracker that lives in WhatsApp. Send a message describing what you spent or earned, and it gets logged instantly. A companion web dashboard gives you charts, category management, and budget tracking.

---

## Access and security

Every `/api/*` route needs credentials, except `/health`, `/privacy`, `/terms` and the two bot webhooks (`/webhook`, `/telegram`), which keep their own secrets. An unknown `/api` path also answers `401`, so nobody can probe which routes exist.

### Dashboard login

Set `DASHBOARD_PASSWORD` (in `backend/.env` locally, and in Railway variables). The dashboard shows a sign-in page; a correct password sets an `httpOnly`, `SameSite=Strict` cookie that lasts 30 days. No key is ever placed in the browser bundle. After 5 wrong passwords from one address (or 20 overall) sign-in is locked for 15 minutes. Without `DASHBOARD_PASSWORD` set, sign-in answers `503`. Profile → **Sign out** ends the session.

Behind Vercel the cookie is set over HTTPS and marked `Secure` automatically. Set `COOKIE_SECURE=true|false` only if you need to force it.

For local development, run the backend locally and leave `VITE_API_URL` unset, so the browser talks to the Vite proxy on the same origin. Pointing the dev server at a remote backend makes the cookie cross-site and sign-in won't stick.

### API keys (for Ledger and the SMS Shortcut)

Generate them on your own machine. Nothing needs to run on the server:

```bash
cd backend
npm run key:generate      # makes a "ledger" (agent) key and a "shortcut" (ingest) key
```

It prints each key once (save them in your password manager) and one line to paste into Railway → Variables:

```
API_KEY_SEEDS=ledger:agent:<prefix>:<hash>,shortcut:ingest:<prefix>:<hash>
```

That line holds only hashes, so it is safe to store. The server registers the keys when it boots; running it again changes nothing, and a key you revoked stays revoked. To add a key later, generate it and append its entry after a comma.

Send a key as `Authorization: Bearer stk_…` (or `X-API-Key`). Other commands, run where the database lives: `npm run key:create -- --name x --scope full` (creates a key directly in that database), `npm run key:list`, `npm run key:revoke -- --id 3`.

| Scope | Can do |
|---|---|
| `full` | Everything, including backup and restore |
| `agent` | All `GET`s except the full backup, plus `POST /api/v1/agent/actions` (categories, mappings, expense/income capture, ID corrections, one-off Mintpay aggregator answers). Cannot delete, restore, or use dashboard write routes. |
| `ingest` | The SMS routes only |

Ledger's contract is `GET /api/v1/openapi.json` (payload schemas under `components.schemas`). Besides the inbox it can search transactions by Colombo date range, fetch one row by id, list categories and merchant mappings, and POST typed actions: `ensure_category`, `upsert_mapping`, `capture_expense`, `capture_income`, `capture_batch`, `correct_transaction`, `resolve_aggregator`. Mintpay SMS is a payment method: it is not auto-categorised; Ledger is asked for the shop and Pay Now vs instalments, and one answer does not become a global Mintpay rule. Each action needs a `reason`. Capture matches the **same type** by exact date + amount (to the cent) — nearby amounts or dates are never chosen. A unique hit is annotated; several hits return `needs_review`; a miss inserts `source=ledger` with `account_masked` left empty. `correct_transaction` updates one existing row by id when `expected.date` and `expected.amount` still match; otherwise `409`. It does not rewrite SMS text, source, or account, and it does not invent fees. `dry_run: true` previews without writing. Replay the same `idempotency_key` to no-op. Reviewed JSON belongs in a gitignored file (see `backend/ledger/capture.example.json` and `correction.example.json` for fictional shape). Run corrections in a batch *before* capture items so an updated row can then exact-match instead of inserting a duplicate.

```bash
# Inspect without writing:
npm run ledger:capture -- --file ./october.capture.json --dry-run

# Apply to a running API. The key stays in the environment, never in git:
LEDGER_API_KEY=stk_... npm run ledger:capture -- --file ./october.capture.json --base https://kavina-expense-tracker.up.railway.app
```

User-approved mapping patterns (no amounts) ship with the app: Cloudflare domain for Taggy only (`DOMAIN+TAGGY`; a Cloudflare domain charge without TAGGY stays unmatched), Fashn.ai → Modelsnapper, Claude → AI Tools. Transaction rows are never seeded.

### Where prompts go

`NOTIFY_CHANNEL=ledger` (default) turns every prompt into a question or escalation for Ledger to read from `GET /api/agent/inbox`. `NOTIFY_CHANNEL=telegram` keeps the original Telegram flow. See `SMS_INGEST.md`.

### Environment variables added

| Variable | Purpose |
|---|---|
| `DASHBOARD_PASSWORD` | Dashboard sign-in |
| `API_KEY_SEEDS` | Hashes of keys made with `npm run key:generate` |
| `NOTIFY_CHANNEL` | `ledger` (default) or `telegram` |
| `HEARTBEAT_HOURS` | Hours of SMS silence before a `heartbeat_missing` escalation (default 72) |
| `SMS_FIXTURES_DIR` | Optional: where tests look for private bank SMS fixtures |
| `FRONTEND_URL` | Allowed CORS origin (exact match; no wildcards any more) |
| `COOKIE_SECURE` | Optional override for the cookie's `Secure` flag |

### Data safety and time

- Before the first new database migration runs, a full copy is written to `backups/` next to the database (on Railway: `/app/data/backups/`) and its path is logged. Migrations only add tables and columns.
- All dates and months use Asia/Colombo time, whatever timezone the server runs in.
- `npm test` runs the backend tests.

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo>
cd expense-tracker
npm install           # installs root (concurrently)
npm install --prefix backend
npm install --prefix frontend
```

### 2. Configure environment

```bash
cp .env.example backend/.env
```

Edit `backend/.env` with your credentials (see setup guide below).

### 3. Build frontend

```bash
npm run build
```

### 4. Start

```bash
# Production (serves dashboard + webhook from one port)
npm start

# Development (hot reload on both frontend + backend)
npm run dev
```

Dashboard available at: `http://localhost:3000`

---

## WhatsApp Setup (Meta Cloud API)

### Step 1 — Create a Meta Business Account
1. Go to [business.facebook.com](https://business.facebook.com) → Create account
2. Verify your account

### Step 2 — Create a Meta App
1. Go to [developers.facebook.com](https://developers.facebook.com/apps)
2. Click **Create App** → Choose **Business** → Fill name
3. Add product **WhatsApp** to the app

### Step 3 — Get your credentials
From the **WhatsApp > API Setup** section in your app dashboard:

- **WHATSAPP_PHONE_ID** — "Phone number ID" (shown under "From" phone number)
- **WHATSAPP_TOKEN** — Generate a permanent token:
  1. Go to your Business Settings → System Users
  2. Create a System User with Admin role
  3. Generate a token with `whatsapp_business_messaging` permission
  4. Copy the token (shown only once)

### Step 4 — Add your number as a test recipient
In **WhatsApp > API Setup**, add your personal number to the "To" field and click "Send test message" to verify it works.

### Step 5 — Configure the Webhook
> You need a public URL first — use ngrok locally.

**Local setup with ngrok:**
```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3000
# Copy the https URL, e.g. https://abc123.ngrok.io
```

1. In **WhatsApp > Configuration**, click **Edit** on the Webhook section
2. Set **Callback URL** to `https://abc123.ngrok.io/webhook`
3. Set **Verify Token** to the same value as your `WHATSAPP_VERIFY_TOKEN` env var
4. Click **Verify and Save**
5. Under **Webhook Fields**, subscribe to: `messages`

### Step 6 — Set environment variables

```env
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_VISION_MODEL=llama-3.2-90b-vision-preview
WHATSAPP_TOKEN=your_permanent_system_user_token
WHATSAPP_PHONE_ID=1234567890
WHATSAPP_VERIFY_TOKEN=my_secret_verify_string
MY_WHATSAPP_NUMBER=94771234567   # No + prefix
PORT=3000
```

---

## WhatsApp Commands

### Logging transactions
| Message | What it does |
|---------|-------------|
| `450 lunch` | Expense · LKR 450 · Food |
| `spent 1200 on petrol` | Expense · LKR 1200 · Transport |
| `800 groceries keells` | Expense · LKR 800 · Groceries |
| `received 5000 tuition fee` | Income · LKR 5000 · Tutoring Income |
| *(send a receipt photo)* | Receipt OCR — auto-parsed as expense |

### Queries
| Message | What it does |
|---------|-------------|
| `summary` | This month: total spent, earned, net + category breakdown (text) |
| `today` | Today's transactions |
| `this week` | This week's transactions + total |
| `last 5` | Last 5 transactions |
| `this month food` | Food expenses this month |
| `compare may vs june` | Month-over-month comparison |
| `export` | CSV of this month's transactions |

### Charts (image replies)
| Message | What you get |
|---------|-------------|
| `chart` | 📊 Category donut chart — % breakdown by category |
| `trend` | 📈 6-month grouped bar — income vs expense per month |
| `daily` | 📅 Daily activity bar chart — every day this month |
| `stats` | 🗂️ Full report: text summary + all three chart images |

### Budget management
| Message | What it does |
|---------|-------------|
| `budget food 5000` | Set LKR 5000/month Food limit |
| `budgets` | Show all limits + current spend with progress bars |
| `delete last` | Delete most recent transaction (with confirmation) |

---

## Dashboard Pages

| Page | URL | What you see |
|------|-----|-------------|
| Dashboard | `/` | Stat cards + daily activity chart + category donut + monthly bar chart + top categories |
| Transactions | `/transactions` | Filterable transaction table + CSV export |
| Categories | `/categories` | Add/edit/delete categories (name + icon + color) |
| Budgets | `/budgets` | Set monthly limits + live progress bars per category |

---

## Project Structure

```
expense-tracker/
├── backend/
│   ├── index.js        # Express server + webhook + REST API
│   ├── parser.js       # Groq text + vision (receipt OCR) parsing
│   ├── db.js           # SQLite schema + all queries (better-sqlite3)
│   ├── whatsapp.js     # Send messages + download media
│   ├── summarizer.js   # Format WhatsApp reply strings
│   └── expenses.db     # Auto-created SQLite database
├── frontend/
│   └── src/
│       ├── pages/      # Dashboard, Transactions, Categories, Budgets
│       └── components/ # StatCard, charts (4 types)
├── .env.example
└── package.json
```

---

## Default Categories

Food · Transport · Groceries · Utilities · Entertainment · Health · Education · MathEase Income · Tutoring Income · Other Income · Other

You can add, rename, and delete categories from the **Categories** page in the dashboard. The WhatsApp parser automatically uses your live category list.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| AI Parsing | Groq llama-3.3-70b (text) + llama-3.2-90b-vision (receipt images) |
| WhatsApp | Meta Cloud API (Webhook) |
| Frontend | React + Vite + Tailwind CSS |
| Charts | Recharts |
| Data fetching | TanStack Query |
