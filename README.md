# 💸 WhatsApp Expense Tracker
> **Status: Production-ready.** All 35 audit issues resolved. Zero build errors.

A personal, single-user expense tracker that lives in WhatsApp. Send a message describing what you spent or earned, and it gets logged instantly. A companion web dashboard gives you charts, category management, and budget tracking.

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
OPENAI_API_KEY=sk-...
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
| `450 lunch` | Expense · Rs. 450 · Food |
| `spent 1200 on petrol` | Expense · Rs. 1200 · Transport |
| `800 groceries keells` | Expense · Rs. 800 · Groceries |
| `received 5000 tuition fee` | Income · Rs. 5000 · Tutoring Income |
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
| `budget food 5000` | Set Rs. 5000/month Food limit |
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
│   ├── parser.js       # OpenAI text + vision (receipt OCR) parsing
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
| AI Parsing | OpenAI gpt-4o-mini (text) + gpt-4o (receipt images) |
| WhatsApp | Meta Cloud API (Webhook) |
| Frontend | React + Vite + Tailwind CSS |
| Charts | Recharts |
| Data fetching | TanStack Query |
