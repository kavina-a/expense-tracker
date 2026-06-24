require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const db       = require('./db');
const { sendMessage: waSend, sendChartImage: waSendChart, downloadMedia: waDownload } = require('./whatsapp');
const tg       = require('./telegram');
const { processMessage } = require('./handler');

const app = express();
app.use(express.json());

// Allow requests from Vercel frontend (and localhost for dev)
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o))) return true;
  // Vercel preview + production deployments
  if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

app.use(cors({
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  credentials: true,
}));

function thisMonthStr() { return new Date().toLocaleDateString('sv-SE').slice(0, 7); }

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

// ─── WhatsApp Webhook ─────────────────────────────────────────────────────────

app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Meta requires immediate 200

  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    if (!process.env.MY_WHATSAPP_NUMBER) {
      console.error('[WhatsApp] MY_WHATSAPP_NUMBER not set — ignoring');
      return;
    }
    if (from !== process.env.MY_WHATSAPP_NUMBER) return;

    console.log(`[WhatsApp] Message from ${from}: type=${msg.type}`);

    const waSender = {
      sendText:  (text)  => waSend(from, text),
      sendImage: (buf)   => waSendChart(from, buf),
    };

    if (msg.type === 'image') {
      const media = await waDownload(msg.image.id);
      if (!media) { await waSend(from, 'Could not download the image. Please try again.'); return; }
      await processMessage({ type: 'image', imageBuffer: media.buffer, imageMimeType: media.mimeType, rawText: '[receipt image]' }, waSender);
    } else if (msg.type === 'text') {
      const text = msg.text.body.trim();
      if (!text) return;
      await processMessage({ type: 'text', text, rawText: text }, waSender);
    } else {
      await waSend(from, 'I can only process text messages and receipt images.');
    }
  } catch (err) {
    console.error('[WhatsApp] Webhook error:', err);
    try {
      const from = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (from && from === process.env.MY_WHATSAPP_NUMBER) {
        await waSend(from, 'Something went wrong, try again');
      }
    } catch { /* ignore */ }
  }
});

// ─── Telegram Webhook ─────────────────────────────────────────────────────────

app.post('/telegram', async (req, res) => {
  // Validate secret token if set
  const secret = process.env.TELEGRAM_SECRET_TOKEN;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.sendStatus(403);
  }

  res.sendStatus(200); // Always ack immediately

  try {
    const update = req.body;
    const message = update?.message;
    if (!message) return;

    const chatId   = message.chat?.id;
    const fromId   = String(message.from?.id);

    // Guard: only respond to the owner
    if (!process.env.MY_TELEGRAM_CHAT_ID) {
      console.error('[Telegram] MY_TELEGRAM_CHAT_ID not set — ignoring all messages');
      return;
    }
    if (String(chatId) !== process.env.MY_TELEGRAM_CHAT_ID) return;

    console.log(`[Telegram] Message from chat ${chatId}: type=${message.photo ? 'image' : 'text'}`);

    const tgSender = {
      sendText:  (text) => tg.sendMessage(chatId, text),
      sendImage: (buf)  => tg.sendChartImage(chatId, buf),
    };

    if (message.photo) {
      // photos arrive as an array from smallest to largest; pick the last (best quality)
      const fileId = message.photo[message.photo.length - 1].file_id;
      const media  = await tg.downloadMedia(fileId);
      if (!media) { await tg.sendMessage(chatId, 'Could not download the image. Please try again.'); return; }
      await processMessage({ type: 'image', imageBuffer: media.buffer, imageMimeType: media.mimeType, rawText: '[receipt image]' }, tgSender);
    } else if (message.text) {
      const text = message.text.trim();
      if (!text) return;
      await processMessage({ type: 'text', text, rawText: text }, tgSender);
    } else {
      await tg.sendMessage(chatId, 'I can only process text messages and receipt images.');
    }
  } catch (err) {
    console.error('[Telegram] Webhook error:', err);
    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId && String(chatId) === process.env.MY_TELEGRAM_CHAT_ID) {
        await tg.sendMessage(chatId, 'Something went wrong, try again');
      }
    } catch { /* ignore */ }
  }
});

// ─── REST API ─────────────────────────────────────────────────────────────────

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
  const { name, icon, color, type } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    res.status(201).json(db.insertCategory({ name: name.trim(), icon, color, type }));
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

app.get('/api/categories/:id/usage', apiHandler((req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const usage = db.getCategoryUsage(id);
  usage ? res.json(usage) : res.status(404).json({ error: 'Not found' });
}));

app.delete('/api/categories/:id', apiHandler((req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const result = db.deleteCategory(id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.blocked) return res.status(409).json({ blocked: true, txCount: result.txCount, budgetCount: result.budgetCount, recentTx: result.recentTx, cat: result.cat });
  res.json(result.cat);
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
  <p>Transaction amounts, categories, and descriptions entered by the owner via WhatsApp or Telegram.</p>
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
  console.log(`📊  Dashboard:        http://localhost:${PORT}`);
  console.log(`🔗  WhatsApp webhook: http://localhost:${PORT}/webhook`);
  console.log(`📱  Telegram webhook: http://localhost:${PORT}/telegram\n`);
});
