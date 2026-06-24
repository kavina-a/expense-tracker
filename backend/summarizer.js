function fmt(amount) {
  return `Rs. ${Number(amount).toLocaleString('en-IN')}`;
}

function formatMonth(monthStr) {
  const [year, month] = monthStr.split('-');
  return new Date(parseInt(year), parseInt(month) - 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });
}

function getCategoryIcon(name, categoriesMap) {
  if (categoriesMap && categoriesMap[name]) return categoriesMap[name];
  const FALLBACKS = {
    Food: '🍜', Transport: '⛽', Groceries: '🛒', Utilities: '💡',
    Entertainment: '🎬', Health: '💊', Education: '📚',
    'MathEase Income': '📐', 'Tutoring Income': '🎓', 'Other Income': '💰', Other: '📦',
  };
  return FALLBACKS[name] || '📌';
}

function formatSummary({ month, totalSpent, totalEarned, net, expenses, incomes }, iconsMap) {
  const sign = net >= 0 ? '+' : '';
  let msg = `📊 ${formatMonth(month)}\n─────────────\n`;
  msg += `💸 Spent: ${fmt(totalSpent)}\n`;
  msg += `💰 Earned: ${fmt(totalEarned)}\n`;
  msg += `📉 Net: ${sign}${fmt(net)}\n`;

  if (expenses.length) {
    msg += `\nBy category:\n`;
    for (const row of expenses) {
      const icon = getCategoryIcon(row.category, iconsMap);
      msg += `${icon} ${row.category} — ${fmt(row.total)}\n`;
    }
  }
  if (incomes.length) {
    msg += `\nIncome:\n`;
    for (const row of incomes) {
      const icon = getCategoryIcon(row.category, iconsMap);
      msg += `${icon} ${row.category} — ${fmt(row.total)}\n`;
    }
  }
  return msg.trim();
}

function formatTransactionList(transactions, title = '') {
  if (!transactions.length) {
    return title ? `${title}\n\nNo transactions found.` : 'No transactions found.';
  }
  let msg = title ? `${title}\n─────────────\n` : '';
  for (const t of transactions) {
    const sign = t.type === 'income' ? '➕' : '➖';
    const label = t.description || t.category;
    msg += `${sign} ${t.date} · ${label} · ${fmt(t.amount)} (${t.category})\n`;
  }
  return msg.trim();
}

function formatConfirmation(transaction) {
  const sign  = transaction.type === 'income' ? '✅ Income' : '✅ Expense';
  const label = transaction.description || transaction.category;
  return `${sign} logged!\n${label} — ${fmt(transaction.amount)}\n📂 ${transaction.category}\n📅 ${transaction.date}`;
}

function formatComparison(m1, m2) {
  const spendDiff  = m2.totalSpent  - m1.totalSpent;
  const earnDiff   = m2.totalEarned - m1.totalEarned;
  const spendSign  = spendDiff >= 0 ? '+' : '';
  const earnSign   = earnDiff  >= 0 ? '+' : '';
  const spendPct   = m1.totalSpent  ? `${((spendDiff / m1.totalSpent)  * 100).toFixed(1)}%` : '—';
  const earnPct    = m1.totalEarned ? `${((earnDiff  / m1.totalEarned) * 100).toFixed(1)}%` : '—';

  return (
    `📊 ${formatMonth(m1.month)} → ${formatMonth(m2.month)}\n─────────────\n` +
    `💸 Spent:  ${fmt(m1.totalSpent)}  →  ${fmt(m2.totalSpent)}  (${spendSign}${spendPct})\n` +
    `💰 Earned: ${fmt(m1.totalEarned)} →  ${fmt(m2.totalEarned)} (${earnSign}${earnPct})\n` +
    `📉 Net:    ${fmt(m1.net)} → ${fmt(m2.net)}`
  );
}

function formatBudgetStatus(budgets) {
  if (!budgets.length) return 'No budgets set.\nTry: budget food 5000';
  let msg = '📊 Budget Status\n─────────────\n';
  for (const b of budgets) {
    const pct   = Math.min(Math.round((b.spent / b.monthly_limit) * 100), 100);
    const bar   = progressBar(pct);
    const emoji = pct >= 90 ? '🔴' : pct >= 70 ? '🟡' : '🟢';
    msg += `${emoji} ${b.category}\n   ${fmt(b.spent)} / ${fmt(b.monthly_limit)} (${pct}%)\n   ${bar}\n\n`;
  }
  return msg.trim();
}

function progressBar(pct, width = 10) {
  const filled = Math.round((Math.min(pct, 100) / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function formatBudgetAlert(alert) {
  const pct       = Math.round(alert.pct * 100);
  const spent     = fmt(alert.spent);
  const limit     = fmt(alert.limit);
  const remaining = fmt(alert.remaining);
  const bar       = progressBar(pct, 12);

  const messages = {
    half: [
      `📊 Budget check — ${alert.category}`,
      `${bar} ${pct}%`,
      `Spent ${spent} of ${limit} this month.`,
      `You still have ${remaining} left — halfway through your budget.`,
    ],
    warning: [
      `⚠️ Budget warning — ${alert.category}`,
      `${bar} ${pct}%`,
      `Spent ${spent} of ${limit} this month.`,
      `Only ${remaining} remaining — consider slowing down here.`,
    ],
    danger: [
      `🚨 Budget danger — ${alert.category}`,
      `${bar} ${pct}%`,
      `Spent ${spent} of ${limit} this month.`,
      `Just ${remaining} left! You're almost at your limit.`,
    ],
    over: [
      `🔴 Budget exceeded — ${alert.category}`,
      `${bar} ${pct}%`,
      `Spent ${spent} — your ${limit} budget is blown by ${fmt(alert.spent - alert.limit)}.`,
      `Consider adjusting your budget for next month.`,
    ],
  };

  return (messages[alert.tier] || messages.warning).join('\n');
}

function formatCsvExport(transactions) {
  const header = 'Date,Type,Category,Description,Amount';
  const rows = transactions.map(t => {
    const desc = (t.description || '').replace(/"/g, '""');
    return `${t.date},${t.type},${t.category},"${desc}",${t.amount}`;
  });
  return [header, ...rows].join('\n');
}

module.exports = {
  formatSummary,
  formatTransactionList,
  formatConfirmation,
  formatComparison,
  formatBudgetStatus,
  formatBudgetAlert,
  formatCsvExport,
};
