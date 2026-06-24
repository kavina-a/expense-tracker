const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'expenses.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    amount       REAL    NOT NULL,
    type         TEXT    NOT NULL,
    category     TEXT    NOT NULL,
    description  TEXT,
    date         TEXT    NOT NULL,
    created_at   TEXT    NOT NULL,
    raw_message  TEXT
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category      TEXT    NOT NULL UNIQUE,
    monthly_limit REAL    NOT NULL,
    created_at    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    icon       TEXT,
    color      TEXT,
    created_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS savings_goals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    target      REAL    NOT NULL,
    saved       REAL    NOT NULL DEFAULT 0,
    deadline    TEXT,
    icon        TEXT    DEFAULT '🎯',
    color       TEXT    DEFAULT '#6B8F71',
    created_at  TEXT    NOT NULL
  );
`);

// Add type column if it doesn't exist yet (safe migration)
try {
  db.exec("ALTER TABLE categories ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'");
} catch { /* already exists */ }

const DEFAULT_CATEGORIES = [
  // ── Income ──────────────────────────────────────────────────────────────────
  { name: 'Arimac',                 icon: '💼', color: '#14b8a6', type: 'income' },
  { name: 'Tutopiya',               icon: '🎓', color: '#3b82f6', type: 'income' },
  { name: 'Pocket Money',           icon: '💵', color: '#22c55e', type: 'income' },
  { name: 'Class (Thaminah)',       icon: '📚', color: '#6366f1', type: 'income' },
  { name: 'Icloud (Shakthi)',       icon: '☁️',  color: '#0ea5e9', type: 'income' },
  { name: 'Birthday Money',         icon: '🎂', color: '#ec4899', type: 'income' },
  { name: 'Class (Zaiden)',         icon: '📖', color: '#8b5cf6', type: 'income' },
  { name: 'Stock Exchange - DIV',   icon: '📈', color: '#10b981', type: 'income' },
  { name: 'Money from rand places', icon: '💰', color: '#eab308', type: 'income' },
  { name: 'Bottles',                icon: '🍶', color: '#f59e0b', type: 'income' },
  // ── Expense ─────────────────────────────────────────────────────────────────
  { name: 'Uber Eats',              icon: '🛵', color: '#f97316', type: 'expense' },
  { name: 'Uber',                   icon: '🚗', color: '#64748b', type: 'expense' },
  { name: 'Coffee Shop',            icon: '☕', color: '#a16207', type: 'expense' },
  { name: 'Out w Friends',          icon: '👥', color: '#a855f7', type: 'expense' },
  { name: "Kavina's Athal",         icon: '🍜', color: '#ef4444', type: 'expense' },
  { name: 'Barista',                icon: '🫖', color: '#92400e', type: 'expense' },
  { name: 'Fast Food',              icon: '🍟', color: '#ca8a04', type: 'expense' },
  { name: 'AI Tools',               icon: '🤖', color: '#6366f1', type: 'expense' },
  { name: 'Groceries',              icon: '🛒', color: '#16a34a', type: 'expense' },
  { name: 'Concert',                icon: '🎵', color: '#7c3aed', type: 'expense' },
  { name: 'Good Deeds',             icon: '🤲', color: '#f43f5e', type: 'expense' },
  { name: 'Birthday Gifts',         icon: '🎁', color: '#db2777', type: 'expense' },
  { name: 'Data Card',              icon: '📱', color: '#0284c7', type: 'expense' },
  { name: 'Gym',                    icon: '🏋️', color: '#dc2626', type: 'expense' },
  { name: 'Uber to/from class',     icon: '🚌', color: '#475569', type: 'expense' },
  { name: 'Stocks',                 icon: '📊', color: '#2563eb', type: 'expense' },
  { name: 'Dates',                  icon: '💑', color: '#e11d48', type: 'expense' },
  { name: 'Drinking',               icon: '🍺', color: '#d97706', type: 'expense' },
  // ── Catch-all ────────────────────────────────────────────────────────────────
  { name: 'Other',                  icon: '📦', color: '#6b7280', type: 'expense' },
];

function seedCategories() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO categories (name, icon, color, type, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const updateType = db.prepare(
    "UPDATE categories SET type = ? WHERE name = ? AND type = 'expense'"
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const cat of DEFAULT_CATEGORIES) {
      insert.run(cat.name, cat.icon, cat.color, cat.type, now);
      // Backfill type for already-existing categories
      if (cat.type === 'income') updateType.run('income', cat.name);
    }
  })();
}
seedCategories();

// ─── Transactions ─────────────────────────────────────────────────────────────

function insertTransaction({ amount, type, category, description, date, raw_message }) {
  const result = db.prepare(`
    INSERT INTO transactions (amount, type, category, description, date, created_at, raw_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(amount, type, category, description || null, date, new Date().toISOString(), raw_message || null);
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
}

// Sentinel pattern used by budget alert deduplication — never expose these
const SENTINEL_FILTER = "AND (raw_message IS NULL OR raw_message NOT LIKE '__budget_alert_%')";

function getTransactions({ month, category, type, limit = 500 } = {}) {
  let query = `SELECT * FROM transactions WHERE 1=1 ${SENTINEL_FILTER}`;
  const params = [];
  if (month)    { query += " AND strftime('%Y-%m', date) = ?"; params.push(month); }
  if (category) { query += ' AND category = ?'; params.push(category); }
  if (type)     { query += ' AND type = ?'; params.push(type); }
  query += ' ORDER BY date DESC, created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(query).all(...params);
}

function updateTransaction(id, { amount, type, category, description, date }) {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!tx) return null;
  db.prepare(`
    UPDATE transactions
    SET amount = COALESCE(?, amount),
        type = COALESCE(?, type),
        category = COALESCE(?, category),
        description = ?,
        date = COALESCE(?, date)
    WHERE id = ?
  `).run(
    amount != null ? amount : null,
    type || null,
    category || null,
    description !== undefined ? description : tx.description,
    date || null,
    id
  );
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
}

function bulkDeleteTransactions(ids) {
  if (!ids?.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const { changes } = db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...ids);
  return changes;
}

function bulkRecategorize(ids, newCategory) {
  if (!ids?.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const { changes } = db.prepare(
    `UPDATE transactions SET category = ? WHERE id IN (${placeholders})`
  ).run(newCategory, ...ids);
  return changes;
}

function deleteTransaction(id) {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (tx) db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  return tx;
}

function deleteLastTransaction() {
  const tx = db.prepare(
    `SELECT * FROM transactions WHERE 1=1 ${SENTINEL_FILTER} ORDER BY created_at DESC LIMIT 1`
  ).get();
  if (tx) db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.id);
  return tx;
}

function getLastNTransactions(n = 5) {
  return db.prepare(
    `SELECT * FROM transactions WHERE 1=1 ${SENTINEL_FILTER} ORDER BY date DESC, created_at DESC LIMIT ?`
  ).all(n);
}

function getSummaryByMonth(month) {
  const rows = db.prepare(`
    SELECT type, category, SUM(amount) as total
    FROM transactions
    WHERE strftime('%Y-%m', date) = ? ${SENTINEL_FILTER}
    GROUP BY type, category
    ORDER BY total DESC
  `).all(month);

  const counts = db.prepare(`
    SELECT type, COUNT(*) as cnt
    FROM transactions
    WHERE strftime('%Y-%m', date) = ? ${SENTINEL_FILTER}
    GROUP BY type
  `).all(month);

  const expenses = rows.filter(r => r.type === 'expense');
  const incomes  = rows.filter(r => r.type === 'income');
  const totalSpent  = expenses.reduce((s, r) => s + r.total, 0);
  const totalEarned = incomes.reduce((s, r) => s + r.total, 0);
  const expenseCount = counts.find(c => c.type === 'expense')?.cnt || 0;
  const incomeCount  = counts.find(c => c.type === 'income')?.cnt  || 0;

  return {
    month, totalSpent, totalEarned,
    net: totalEarned - totalSpent,
    expenses, incomes,
    expenseCount, incomeCount,
    txCount: expenseCount + incomeCount,
  };
}

function getDailyTotals(month) {
  return db.prepare(`
    SELECT date, type, SUM(amount) as total
    FROM transactions
    WHERE strftime('%Y-%m', date) = ? ${SENTINEL_FILTER}
    GROUP BY date, type
    ORDER BY date ASC
  `).all(month);
}

function getMonthlyTrends(months = 6) {
  return db.prepare(`
    SELECT strftime('%Y-%m', date) as month, type, SUM(amount) as total
    FROM transactions
    WHERE date >= date('now', '-' || ? || ' months') ${SENTINEL_FILTER}
    GROUP BY month, type
    ORDER BY month ASC
  `).all(months);
}

// ─── Categories ───────────────────────────────────────────────────────────────

function getCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY type ASC, name ASC').all();
}

function insertCategory({ name, icon, color, type = 'expense' }) {
  const result = db.prepare(
    'INSERT INTO categories (name, icon, color, type, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(name, icon || '📦', color || '#6b7280', type, new Date().toISOString());
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
}

function updateCategory(id, { name, icon, color, type }) {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!existing) return null;

  const newName = name || existing.name;

  db.transaction(() => {
    if (newName !== existing.name) {
      db.prepare('UPDATE transactions SET category = ? WHERE category = ?').run(newName, existing.name);
      db.prepare('UPDATE budgets SET category = ? WHERE category = ?').run(newName, existing.name);
    }
    db.prepare(
      'UPDATE categories SET name = ?, icon = COALESCE(?, icon), color = COALESCE(?, color), type = COALESCE(?, type) WHERE id = ?'
    ).run(newName, icon || null, color || null, type || null, id);
  })();

  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function getCategoryUsage(id) {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!cat) return null;
  const txCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM transactions WHERE category = ? ${SENTINEL_FILTER}`
  ).get(cat.name).cnt;
  const budgetCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM budgets WHERE category = ?'
  ).get(cat.name).cnt;
  const recentTx = db.prepare(
    `SELECT date, amount, type, description FROM transactions WHERE category = ? ${SENTINEL_FILTER} ORDER BY date DESC, created_at DESC LIMIT 5`
  ).all(cat.name);
  return { cat, txCount, budgetCount, recentTx };
}

function deleteCategory(id) {
  const usage = getCategoryUsage(id);
  if (!usage) return null;
  if (usage.txCount > 0 || usage.budgetCount > 0) {
    return { blocked: true, ...usage };
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return { deleted: true, cat: usage.cat };
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

function getBudgets() {
  return db.prepare('SELECT * FROM budgets ORDER BY category ASC').all();
}

function getBudgetsWithSpend(month) {
  return db.prepare(`
    SELECT b.id, b.category, b.monthly_limit,
           COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) as spent
    FROM budgets b
    LEFT JOIN transactions t
      ON t.category = b.category
      AND strftime('%Y-%m', t.date) = ?
    GROUP BY b.id
    ORDER BY b.category ASC
  `).all(month);
}

function upsertBudget(category, monthly_limit) {
  db.prepare(`
    INSERT INTO budgets (category, monthly_limit, created_at) VALUES (?, ?, ?)
    ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit
  `).run(category, monthly_limit, new Date().toISOString());
  return db.prepare('SELECT * FROM budgets WHERE category = ?').get(category);
}

function deleteBudget(id) {
  const budget = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id);
  if (budget) db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
  return budget;
}

// Alert thresholds — each fires at most once per category per month per tier
const ALERT_TIERS = [
  { key: 'over',    min: 1.00 },
  { key: 'danger',  min: 0.90 },
  { key: 'warning', min: 0.75 },
  { key: 'half',    min: 0.50 },
];

function checkBudgetAlert(category, month) {
  const budget = db.prepare('SELECT * FROM budgets WHERE category = ?').get(category);
  if (!budget || !budget.monthly_limit) return null;

  const { spent } = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as spent
    FROM transactions
    WHERE category = ? AND type = 'expense' AND strftime('%Y-%m', date) = ?
  `).get(category, month);

  const pct = spent / budget.monthly_limit;
  const remaining = Math.max(0, budget.monthly_limit - spent);

  // Find the highest tier the user has crossed
  const tier = ALERT_TIERS.find(t => pct >= t.min);
  if (!tier) return null;

  // Only fire once per tier per month — track in a lightweight in-memory set
  // Use a sentinel transaction tag to detect if this tier already alerted this month
  const sentinelTag = `__budget_alert_${category}_${month}_${tier.key}`;
  const alreadyFired = db.prepare(
    "SELECT 1 FROM transactions WHERE raw_message = ? LIMIT 1"
  ).get(sentinelTag);
  if (alreadyFired) return null;

  // Record sentinel so this tier doesn't fire again this month
  db.prepare(`
    INSERT INTO transactions (amount, type, category, description, date, created_at, raw_message)
    VALUES (0, 'expense', ?, NULL, ?, ?, ?)
  `).run(category, `${month}-01`, new Date().toISOString(), sentinelTag);

  return { category, spent, limit: budget.monthly_limit, pct, remaining, tier: tier.key };
}

// ─── Yearly Overview ──────────────────────────────────────────────────────────

function getYearlyOverview(year) {
  const monthlyRows = db.prepare(`
    SELECT strftime('%Y-%m', date) as month, type, SUM(amount) as total
    FROM transactions
    WHERE strftime('%Y', date) = ? ${SENTINEL_FILTER}
    GROUP BY month, type
    ORDER BY month ASC
  `).all(year);

  const categoryRows = db.prepare(`
    SELECT strftime('%Y-%m', date) as month, type, category, SUM(amount) as total
    FROM transactions
    WHERE strftime('%Y', date) = ? ${SENTINEL_FILTER}
    GROUP BY month, type, category
    ORDER BY month ASC
  `).all(year);

  // Build 12-month array
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, '0')}`;
    const income  = monthlyRows.find(r => r.month === m && r.type === 'income')?.total  || 0;
    const expense = monthlyRows.find(r => r.month === m && r.type === 'expense')?.total || 0;
    return { month: m, income, expense, net: income - expense };
  });

  const totalIncome  = months.reduce((s, m) => s + m.income,  0);
  const totalExpense = months.reduce((s, m) => s + m.expense, 0);
  const savingsRate  = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;

  // Per-category arrays (12 values each)
  const incomeMap  = {};
  const expenseMap = {};
  for (const row of categoryRows) {
    const idx = parseInt(row.month.split('-')[1]) - 1;
    if (row.type === 'income') {
      if (!incomeMap[row.category])  incomeMap[row.category]  = Array(12).fill(0);
      incomeMap[row.category][idx]  += row.total;
    } else {
      if (!expenseMap[row.category]) expenseMap[row.category] = Array(12).fill(0);
      expenseMap[row.category][idx] += row.total;
    }
  }

  const toList = (map) =>
    Object.entries(map)
      .map(([category, vals]) => ({ category, months: vals, total: vals.reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.total - a.total);

  return {
    year,
    months,
    totalIncome,
    totalExpense,
    net: totalIncome - totalExpense,
    savingsRate,
    incomeByCategory:  toList(incomeMap),
    expenseByCategory: toList(expenseMap),
  };
}

// ─── Category Trends ─────────────────────────────────────────────────────────

function getCategoryTrends(category, months = 6) {
  return db.prepare(`
    SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
    FROM transactions
    WHERE category = ? AND date >= date('now', '-' || ? || ' months') ${SENTINEL_FILTER}
    GROUP BY month
    ORDER BY month ASC
  `).all(category, months);
}

// ─── Savings Goals ────────────────────────────────────────────────────────────

function getSavingsGoals() {
  return db.prepare('SELECT * FROM savings_goals ORDER BY created_at DESC').all();
}

function insertSavingsGoal({ name, target, deadline, icon, color }) {
  const result = db.prepare(
    'INSERT INTO savings_goals (name, target, saved, deadline, icon, color, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)'
  ).run(name, target, deadline || null, icon || '🎯', color || '#6B8F71', new Date().toISOString());
  return db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(result.lastInsertRowid);
}

function updateSavingsGoal(id, { name, target, saved, deadline, icon, color }) {
  const existing = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare(`
    UPDATE savings_goals
    SET name = COALESCE(?, name), target = COALESCE(?, target), saved = COALESCE(?, saved),
        deadline = COALESCE(?, deadline), icon = COALESCE(?, icon), color = COALESCE(?, color)
    WHERE id = ?
  `).run(name || null, target ?? null, saved ?? null, deadline || null, icon || null, color || null, id);
  return db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(id);
}

function deleteSavingsGoal(id) {
  const goal = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(id);
  if (goal) db.prepare('DELETE FROM savings_goals WHERE id = ?').run(id);
  return goal;
}

// ─── Backup / Restore ─────────────────────────────────────────────────────────

function getFullBackup() {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    transactions: db.prepare(
      `SELECT * FROM transactions WHERE 1=1 ${SENTINEL_FILTER} ORDER BY date ASC, created_at ASC`
    ).all(),
    categories: db.prepare('SELECT * FROM categories ORDER BY id ASC').all(),
    budgets:    db.prepare('SELECT * FROM budgets ORDER BY id ASC').all(),
  };
}

function restoreFromBackup({ transactions = [], categories = [], budgets = [] }) {
  let txInserted = 0, catInserted = 0, budgetInserted = 0;

  db.transaction(() => {
    const insertTx = db.prepare(`
      INSERT OR IGNORE INTO transactions
        (id, amount, type, category, description, date, created_at, raw_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of transactions) {
      insertTx.run(t.id, t.amount, t.type, t.category, t.description, t.date, t.created_at, t.raw_message);
      txInserted++;
    }

    const insertCat = db.prepare(`
      INSERT OR IGNORE INTO categories (id, name, icon, color, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const c of categories) {
      insertCat.run(c.id, c.name, c.icon, c.color, c.type || 'expense', c.created_at);
      catInserted++;
    }

    const insertBudget = db.prepare(`
      INSERT OR IGNORE INTO budgets (id, category, monthly_limit, created_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const b of budgets) {
      insertBudget.run(b.id, b.category, b.monthly_limit, b.created_at);
      budgetInserted++;
    }
  })();

  return { txInserted, catInserted, budgetInserted };
}

module.exports = {
  insertTransaction,
  updateTransaction,
  getTransactions,
  deleteTransaction,
  bulkDeleteTransactions,
  bulkRecategorize,
  deleteLastTransaction,
  getLastNTransactions,
  getSummaryByMonth,
  getDailyTotals,
  getMonthlyTrends,
  getCategoryTrends,
  getCategories,
  insertCategory,
  updateCategory,
  getCategoryUsage,
  deleteCategory,
  getBudgets,
  getBudgetsWithSpend,
  upsertBudget,
  deleteBudget,
  checkBudgetAlert,
  getYearlyOverview,
  getSavingsGoals,
  insertSavingsGoal,
  updateSavingsGoal,
  deleteSavingsGoal,
  getFullBackup,
  restoreFromBackup,
};
