require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const db       = require('./db');
const { sendMessage, sendChartImage, downloadMedia } = require('./whatsapp');
const { parseTextMessage, parseImageMessage } = require('./parser');
const {
  formatSummary,
  formatTransactionList,
  formatConfirmation,
  formatComparison,
  formatBudgetStatus,
  formatBudgetAlert,
  formatCsvExport,
} = require('./summarizer');
const {
  generateChartImage,
  buildCategoryChartConfig,
  buildTrendChartConfig,
  buildDailyChartConfig,
  buildCategoryBarConfig,
} = require('./charts');

const app = express();
app.use(express.json());

// Allow requests from Vercel frontend (and localhost for dev)
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL, // e.g. https://expense-tracker.vercel.app
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, webhook calls)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Use local timezone (set TZ=Asia/Colombo in .env for Sri Lanka)
function todayStr()     { return new Date().toLocaleDateString('sv-SE'); }
function thisMonthStr() { return todayStr().slice(0, 7); }

function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function categoryIconsMap() {
  return Object.fromEntries(db.getCategories().map(c => [c.name, c.icon]));
}

// ─── WhatsApp Webhook ─────────────────────────────────────────────────────────

app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[Webhook] Verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // respond immediately — Meta requires it

  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    if (!process.env.MY_WHATSAPP_NUMBER) {
      console.error('[Webhook] MY_WHATSAPP_NUMBER is not set in .env — ignoring all messages');
      return;
    }
    if (from !== process.env.MY_WHATSAPP_NUMBER) return;

    console.log(`[Webhook] Message from ${from}: type=${msg.type}`);

    const today      = todayStr();
    const thisMonth  = thisMonthStr();
    const categories = db.getCategories();
    let parsed;

    if (msg.type === 'image') {
      const media = await downloadMedia(msg.image.id);
      if (!media) {
        await sendMessage(from, 'Could not download the image. Please try again.');
        return;
      }
      parsed = await parseImageMessage(media.buffer, media.mimeType || 'image/jpeg', categories);
    } else if (msg.type === 'text') {
      const text = msg.text.body.trim();
      if (!text) return;
      parsed = await parseTextMessage(text, categories);
    } else {
      await sendMessage(from, 'I can only process text messages and receipt images.');
      return;
    }

    if (parsed.isQuery) {
      await handleQuery(from, parsed, today, thisMonth);
    } else {
      await handleTransaction(from, parsed, msg, today, thisMonth);
    }
  } catch (err) {
    console.error('[Webhook] Error:', err);
    // Best-effort: try to notify the user something went wrong
    try {
      const from = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (from && from === process.env.MY_WHATSAPP_NUMBER) {
        await sendMessage(from, 'Something went wrong, try again');
      }
    } catch { /* ignore secondary error */ }
  }
});

async function handleTransaction(from, parsed, msg, today, thisMonth) {
  if (!parsed.amount) {
    await sendMessage(from, "How much was it? Try: 450 lunch");
    return;
  }

  const rawMsg = msg.type === 'text' ? msg.text.body : '[receipt image]';
  const tx = db.insertTransaction({
    amount:      parsed.amount,
    type:        parsed.type || 'expense',
    category:    parsed.category || 'Other',
    description: parsed.description || null,
    date:        parsed.date || today,
    raw_message: rawMsg,
  });

  let reply = formatConfirmation(tx);

  if (tx.type === 'expense') {
    const alert = db.checkBudgetAlert(tx.category, thisMonth);
    if (alert) reply += '\n\n' + formatBudgetAlert(alert);
  }

  await sendMessage(from, reply);
}

async function handleQuery(from, parsed, today, thisMonth) {
  const { queryType } = parsed;
  const iconsMap = categoryIconsMap();

  try {
    switch (queryType) {
      case 'summary': {
        const data = db.getSummaryByMonth(thisMonth);
        await sendMessage(from, formatSummary(data, iconsMap));
        break;
      }
      case 'today': {
        const txs = db.getTransactions({ limit: 500 }).filter(t => t.date === today);
        await sendMessage(from, formatTransactionList(txs, `📅 Today (${today})`));
        break;
      }
      case 'this_week': {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 6);
        const weekStart = weekAgo.toISOString().split('T')[0];
        const txs = db.getTransactions({ limit: 500 }).filter(t => t.date >= weekStart);
        const total = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const msg = formatTransactionList(txs, `📅 This Week`) +
          `\n\n💸 Total spent: Rs. ${total.toLocaleString('en-IN')}`;
        await sendMessage(from, msg);
        break;
      }
      case 'last_n': {
        const n = Math.min(parseInt(parsed.n) || 5, 20);
        const txs = db.getLastNTransactions(n);
        await sendMessage(from, formatTransactionList(txs, `🕐 Last ${n} transactions`));
        break;
      }
      case 'delete_last': {
        const deleted = db.deleteLastTransaction();
        if (deleted) {
          const label = deleted.description || deleted.category;
          await sendMessage(from,
            `🗑️ Deleted: ${label} — Rs. ${deleted.amount.toLocaleString('en-IN')} (${deleted.date})`
          );
        } else {
          await sendMessage(from, 'No transactions to delete.');
        }
        break;
      }
      case 'category_month': {
        const cat = parsed.category;
        if (!cat) {
          await sendMessage(from, 'Which category? Try: this month food');
          break;
        }
        const txs  = db.getTransactions({ month: thisMonth, category: cat });
        const total = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const msg  = formatTransactionList(txs, `📂 ${cat} — ${thisMonth}`) +
          `\n\n💸 Total: Rs. ${total.toLocaleString('en-IN')}`;
        await sendMessage(from, msg);
        break;
      }
      case 'compare': {
        const m1 = parsed.month1 || prevMonth(thisMonth);
        const m2 = parsed.month2 || thisMonth;
        const d1 = db.getSummaryByMonth(m1);
        const d2 = db.getSummaryByMonth(m2);
        await sendMessage(from, formatComparison(d1, d2));
        break;
      }
      case 'export': {
        const txs = db.getTransactions({ month: thisMonth });
        const csv = formatCsvExport(txs);
        const preview = csv.length > 3000 ? csv.slice(0, 2990) + '\n...(truncated)' : csv;
        await sendMessage(from, `📤 Export — ${thisMonth}\n\n${preview}`);
        break;
      }
      case 'budget_set': {
        const limit = parseFloat(parsed.budgetLimit);
        if (parsed.budgetCategory && limit > 0) {
          db.upsertBudget(parsed.budgetCategory, limit);
          const fmtd = `Rs. ${limit.toLocaleString('en-IN')}`;
          await sendMessage(from, `✅ Budget set!\n${parsed.budgetCategory} → ${fmtd}/month`);
        } else {
          await sendMessage(from, 'Try: budget food 5000');
        }
        break;
      }
      case 'budget_show': {
        const budgets = db.getBudgetsWithSpend(thisMonth);
        await sendMessage(from, formatBudgetStatus(budgets));
        break;
      }

      // ── Chart commands ──────────────────────────────────────────────────────

      case 'chart_summary': {
        await sendMessage(from, '⏳ Generating category chart…');
        const summary     = db.getSummaryByMonth(thisMonth);
        const enriched    = enrichWithColors(summary.expenses);
        if (!enriched.length) {
          await sendMessage(from, 'No expenses logged this month yet.');
          break;
        }
        const config = buildCategoryChartConfig({ ...summary, expenses: enriched });
        const image  = await generateChartImage(config, { width: 640, height: 420 });
        await sendChartImage(from, image);
        break;
      }

      case 'chart_trend': {
        await sendMessage(from, '⏳ Generating monthly trend chart…');
        const trends = db.getMonthlyTrends(6);
        if (!trends.length) {
          await sendMessage(from, 'Not enough data yet. Log some transactions first!');
          break;
        }
        const config = buildTrendChartConfig(trends);
        const image  = await generateChartImage(config, { width: 640, height: 380 });
        await sendChartImage(from, image);
        break;
      }

      case 'chart_daily': {
        await sendMessage(from, '⏳ Generating daily activity chart…');
        const daily  = db.getDailyTotals(thisMonth);
        if (!daily.length) {
          await sendMessage(from, 'No transactions logged this month yet.');
          break;
        }
        const config = buildDailyChartConfig(daily, thisMonth);
        const image  = await generateChartImage(config, { width: 640, height: 380 });
        await sendChartImage(from, image);
        break;
      }

      case 'stats': {
        // Full report: text summary first, then all three charts back-to-back
        await sendMessage(from, '⏳ Generating your full report…');

        const summary    = db.getSummaryByMonth(thisMonth);
        const enriched   = enrichWithColors(summary.expenses);
        const trends     = db.getMonthlyTrends(6);
        const daily      = db.getDailyTotals(thisMonth);

        // 1. Text summary
        await sendMessage(from, formatSummary({ ...summary, expenses: enriched }, iconsMap));

        // 2. Category donut (if there are expenses)
        if (enriched.length) {
          const img1 = await generateChartImage(
            buildCategoryChartConfig({ ...summary, expenses: enriched }),
            { width: 640, height: 420 }
          );
          await sendChartImage(from, img1);
        }

        // 3. Top categories bar
        if (enriched.length) {
          const img2 = await generateChartImage(
            buildCategoryBarConfig(enriched, thisMonth),
            { width: 640, height: 380 }
          );
          await sendChartImage(from, img2);
        }

        // 4. Monthly trend
        if (trends.length) {
          const img3 = await generateChartImage(
            buildTrendChartConfig(trends),
            { width: 640, height: 360 }
          );
          await sendChartImage(from, img3);
        }

        // 5. Daily activity
        if (daily.length) {
          const img4 = await generateChartImage(
            buildDailyChartConfig(daily, thisMonth),
            { width: 640, height: 360 }
          );
          await sendChartImage(from, img4);
        }
        break;
      }

      default: {
        await sendMessage(from,
          "I didn't understand that.\n\nTry:\n• 450 lunch\n• spent 1200 on petrol\n• received 5000 tuition\n• summary\n• chart  ← category pie chart\n• trend  ← 6-month bar chart\n• daily  ← this month's daily chart\n• stats  ← full report with all charts\n• today\n• this week\n• last 5\n• delete last\n• budget food 5000\n• compare may vs june"
        );
      }
    }
  } catch (err) {
    console.error('[Query] Error:', err);
    await sendMessage(from, 'Something went wrong, try again');
  }
}

function enrichWithColors(expenses) {
  const cats = db.getCategories();
  const colorMap = Object.fromEntries(cats.map(c => [c.name, c.color]));
  return expenses.map(e => ({ ...e, color: colorMap[e.category] || '#6b7280' }));
}

// ─── REST API ─────────────────────────────────────────────────────────────────

function safeId(param) {
  const id = parseInt(param, 10);
  return Number.isFinite(id) ? id : null;
}

function apiHandler(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      console.error('[API]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

app.get('/api/transactions', apiHandler((req, res) => {
  const { month, category, type } = req.query;
  res.json(db.getTransactions({ month, category, type }));
}));

app.delete('/api/transactions/:id', apiHandler((req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const deleted = db.deleteTransaction(id);
  deleted ? res.json(deleted) : res.status(404).json({ error: 'Not found' });
}));

app.get('/api/summary', apiHandler((req, res) => {
  const month = req.query.month || thisMonthStr();
  res.json(db.getSummaryByMonth(month));
}));

app.get('/api/trends', apiHandler((req, res) => {
  const months = Math.min(parseInt(req.query.months) || 6, 24);
  res.json(db.getMonthlyTrends(months));
}));

app.get('/api/daily', apiHandler((req, res) => {
  const month = req.query.month || thisMonthStr();
  res.json(db.getDailyTotals(month));
}));

// Categories
app.get('/api/categories', apiHandler((_req, res) => res.json(db.getCategories())));

app.post('/api/categories', apiHandler((req, res) => {
  const { name, icon, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    res.status(201).json(db.insertCategory({ name: name.trim(), icon, color }));
  } catch {
    res.status(409).json({ error: 'Category already exists' });
  }
}));

app.put('/api/categories/:id', apiHandler((req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const cat = db.updateCategory(id, req.body);
  cat ? res.json(cat) : res.status(404).json({ error: 'Not found' });
}));

app.delete('/api/categories/:id', apiHandler((req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const cat = db.deleteCategory(id);
  cat ? res.json(cat) : res.status(404).json({ error: 'Not found' });
}));

// Budgets
app.get('/api/budgets', apiHandler((req, res) => {
  const month = req.query.month || thisMonthStr();
  res.json(db.getBudgetsWithSpend(month));
}));

app.post('/api/budgets', apiHandler((req, res) => {
  const { category, monthly_limit } = req.body;
  const limit = parseFloat(monthly_limit);
  if (!category || !Number.isFinite(limit) || limit <= 0) {
    return res.status(400).json({ error: 'category and a positive monthly_limit are required' });
  }
  res.status(201).json(db.upsertBudget(category, limit));
}));

app.put('/api/budgets/:id', apiHandler((req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const limit = parseFloat(req.body.monthly_limit);
  if (!Number.isFinite(limit) || limit <= 0) {
    return res.status(400).json({ error: 'A positive monthly_limit is required' });
  }
  const budget = db.getBudgets().find(b => b.id === id);
  if (!budget) return res.status(404).json({ error: 'Not found' });
  res.json(db.upsertBudget(budget.category, limit));
}));

app.delete('/api/budgets/:id', apiHandler((req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const deleted = db.deleteBudget(id);
  deleted ? res.json(deleted) : res.status(404).json({ error: 'Not found' });
}));

// ─── Health check + Meta-required pages ──────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/privacy', (_req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Privacy Policy</title>
  <style>body{font-family:sans-serif;max-width:700px;margin:60px auto;padding:0 20px;color:#333}</style>
  </head><body>
  <h1>Privacy Policy</h1>
  <p><strong>Last updated:</strong> ${new Date().toDateString()}</p>
  <p>This is a personal expense tracking tool used solely by its owner. No data is shared with third parties.</p>
  <h2>Data collected</h2>
  <p>Transaction amounts, categories, and descriptions entered by the owner via WhatsApp.</p>
  <h2>Data storage</h2>
  <p>All data is stored in a private SQLite database on the owner's server. No personal data of third parties is collected.</p>
  <h2>Contact</h2>
  <p>For questions, contact the app owner directly.</p>
  </body></html>`);
});

app.get('/terms', (_req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Terms of Service</title>
  <style>body{font-family:sans-serif;max-width:700px;margin:60px auto;padding:0 20px;color:#333}</style>
  </head><body>
  <h1>Terms of Service</h1>
  <p>This is a private personal tool. By using this application you agree it is for personal use only.</p>
  </body></html>`);
});

// ─── Serve frontend (local only — in production Vercel serves the frontend) ───

const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');
const fs = require('fs');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (_req, res) => {
    const indexPath = path.join(FRONTEND_DIST, 'index.html');
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    res.status(404).send('Frontend not built. Run: npm run build');
  });
} else {
  app.get('/', (_req, res) => res.json({ status: 'ok', message: 'Expense Tracker API running' }));
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀  Expense Tracker running`);
  console.log(`📊  Dashboard: http://localhost:${PORT}`);
  console.log(`🔗  Webhook:   http://localhost:${PORT}/webhook\n`);
});
