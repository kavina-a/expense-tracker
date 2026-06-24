/**
 * handler.js — shared message processing logic used by both WhatsApp and Telegram.
 *
 * Each channel passes a `sender` object with two async methods:
 *   sender.sendText(text)
 *   sender.sendImage(imageBuffer)
 *
 * This keeps all business logic channel-agnostic.
 */

const db = require('./db');
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

function enrichWithColors(expenses) {
  const cats = db.getCategories();
  const colorMap = Object.fromEntries(cats.map(c => [c.name, c.color]));
  return expenses.map(e => ({ ...e, color: colorMap[e.category] || '#6b7280' }));
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function processMessage({ type, text, imageBuffer, imageMimeType, rawText }, sender) {
  const today     = todayStr();
  const thisMonth = thisMonthStr();
  const categories = db.getCategories();

  let parsed;
  try {
    if (type === 'image') {
      parsed = await parseImageMessage(imageBuffer, imageMimeType || 'image/jpeg', categories);
    } else {
      parsed = await parseTextMessage(text.trim(), categories);
    }
  } catch (err) {
    console.error('[Handler] Parse error:', err.message);
    await sender.sendText('Something went wrong, try again');
    return;
  }

  if (parsed.isQuery) {
    await handleQuery(parsed, today, thisMonth, sender);
  } else {
    await handleTransaction(parsed, rawText || text || '[image]', today, thisMonth, sender);
  }
}

// ─── Transaction ──────────────────────────────────────────────────────────────

async function handleTransaction(parsed, rawText, today, thisMonth, sender) {
  if (!parsed.amount) {
    await sender.sendText("How much was it? Try: 450 lunch");
    return;
  }

  const tx = db.insertTransaction({
    amount:      parsed.amount,
    type:        parsed.type || 'expense',
    category:    parsed.category || 'Other',
    description: parsed.description || null,
    date:        parsed.date || today,
    raw_message: rawText,
  });

  let reply = formatConfirmation(tx);

  if (tx.type === 'expense') {
    const alert = db.checkBudgetAlert(tx.category, thisMonth);
    if (alert) reply += '\n\n' + formatBudgetAlert(alert);
  }

  await sender.sendText(reply);
}

// ─── Query ────────────────────────────────────────────────────────────────────

async function handleQuery(parsed, today, thisMonth, sender) {
  const { queryType } = parsed;
  const iconsMap = categoryIconsMap();

  try {
    switch (queryType) {
      case 'summary': {
        const data = db.getSummaryByMonth(thisMonth);
        await sender.sendText(formatSummary(data, iconsMap));
        break;
      }
      case 'today': {
        const txs = db.getTransactions({ limit: 500 }).filter(t => t.date === today);
        await sender.sendText(formatTransactionList(txs, `📅 Today (${today})`));
        break;
      }
      case 'this_week': {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 6);
        const weekStart = weekAgo.toLocaleDateString('sv-SE');
        const txs = db.getTransactions({ limit: 500 }).filter(t => t.date >= weekStart);
        const total = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        await sender.sendText(
          formatTransactionList(txs, `📅 This Week`) +
          `\n\n💸 Total spent: Rs. ${total.toLocaleString('en-IN')}`
        );
        break;
      }
      case 'last_n': {
        const n = Math.min(parseInt(parsed.n) || 5, 20);
        const txs = db.getLastNTransactions(n);
        await sender.sendText(formatTransactionList(txs, `🕐 Last ${n} transactions`));
        break;
      }
      case 'delete_last': {
        const deleted = db.deleteLastTransaction();
        if (deleted) {
          const label = deleted.description || deleted.category;
          await sender.sendText(
            `🗑️ Deleted: ${label} — Rs. ${deleted.amount.toLocaleString('en-IN')} (${deleted.date})`
          );
        } else {
          await sender.sendText('No transactions to delete.');
        }
        break;
      }
      case 'category_month': {
        const cat = parsed.category;
        if (!cat) {
          await sender.sendText('Which category? Try: this month food');
          break;
        }
        const txs   = db.getTransactions({ month: thisMonth, category: cat });
        const total = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        await sender.sendText(
          formatTransactionList(txs, `📂 ${cat} — ${thisMonth}`) +
          `\n\n💸 Total: Rs. ${total.toLocaleString('en-IN')}`
        );
        break;
      }
      case 'compare': {
        const m1 = parsed.month1 || prevMonth(thisMonth);
        const m2 = parsed.month2 || thisMonth;
        const d1 = db.getSummaryByMonth(m1);
        const d2 = db.getSummaryByMonth(m2);
        await sender.sendText(formatComparison(d1, d2));
        break;
      }
      case 'export': {
        const txs = db.getTransactions({ month: thisMonth });
        const csv = formatCsvExport(txs);
        const preview = csv.length > 3000 ? csv.slice(0, 2990) + '\n...(truncated)' : csv;
        await sender.sendText(`📤 Export — ${thisMonth}\n\n${preview}`);
        break;
      }
      case 'budget_set': {
        const limit = parseFloat(parsed.budgetLimit);
        if (parsed.budgetCategory && limit > 0) {
          db.upsertBudget(parsed.budgetCategory, limit);
          await sender.sendText(`✅ Budget set!\n${parsed.budgetCategory} → Rs. ${limit.toLocaleString('en-IN')}/month`);
        } else {
          await sender.sendText('Try: budget food 5000');
        }
        break;
      }
      case 'budget_show': {
        const budgets = db.getBudgetsWithSpend(thisMonth);
        await sender.sendText(formatBudgetStatus(budgets));
        break;
      }
      case 'chart_summary': {
        await sender.sendText('⏳ Generating category chart…');
        const summary  = db.getSummaryByMonth(thisMonth);
        const enriched = enrichWithColors(summary.expenses);
        if (!enriched.length) { await sender.sendText('No expenses logged this month yet.'); break; }
        const img = await generateChartImage(buildCategoryChartConfig({ ...summary, expenses: enriched }), { width: 640, height: 420 });
        await sender.sendImage(img);
        break;
      }
      case 'chart_trend': {
        await sender.sendText('⏳ Generating monthly trend chart…');
        const trends = db.getMonthlyTrends(6);
        if (!trends.length) { await sender.sendText('Not enough data yet. Log some transactions first!'); break; }
        const img = await generateChartImage(buildTrendChartConfig(trends), { width: 640, height: 380 });
        await sender.sendImage(img);
        break;
      }
      case 'chart_daily': {
        await sender.sendText('⏳ Generating daily activity chart…');
        const daily = db.getDailyTotals(thisMonth);
        if (!daily.length) { await sender.sendText('No transactions logged this month yet.'); break; }
        const img = await generateChartImage(buildDailyChartConfig(daily, thisMonth), { width: 640, height: 380 });
        await sender.sendImage(img);
        break;
      }
      case 'stats': {
        await sender.sendText('⏳ Generating your full report…');
        const summary  = db.getSummaryByMonth(thisMonth);
        const enriched = enrichWithColors(summary.expenses);
        const trends   = db.getMonthlyTrends(6);
        const daily    = db.getDailyTotals(thisMonth);

        await sender.sendText(formatSummary({ ...summary, expenses: enriched }, iconsMap));

        if (enriched.length) {
          await sender.sendImage(await generateChartImage(buildCategoryChartConfig({ ...summary, expenses: enriched }), { width: 640, height: 420 }));
          await sender.sendImage(await generateChartImage(buildCategoryBarConfig(enriched, thisMonth), { width: 640, height: 380 }));
        }
        if (trends.length) {
          await sender.sendImage(await generateChartImage(buildTrendChartConfig(trends), { width: 640, height: 360 }));
        }
        if (daily.length) {
          await sender.sendImage(await generateChartImage(buildDailyChartConfig(daily, thisMonth), { width: 640, height: 360 }));
        }
        break;
      }
      default: {
        await sender.sendText(
          "I didn't understand that.\n\nTry:\n• 450 lunch\n• spent 1200 on petrol\n• received 5000 tuition\n• summary\n• chart  ← category pie chart\n• trend  ← 6-month bar chart\n• daily  ← this month's daily chart\n• stats  ← full report with all charts\n• today\n• this week\n• last 5\n• delete last\n• budget food 5000\n• compare may vs june"
        );
      }
    }
  } catch (err) {
    console.error('[Handler] Query error:', err);
    await sender.sendText('Something went wrong, try again');
  }
}

module.exports = { processMessage };
