const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'expenses.db');
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
`);

const DEFAULT_CATEGORIES = [
  { name: 'Food',             icon: '🍜', color: '#f97316' },
  { name: 'Transport',        icon: '⛽', color: '#3b82f6' },
  { name: 'Groceries',        icon: '🛒', color: '#22c55e' },
  { name: 'Utilities',        icon: '💡', color: '#eab308' },
  { name: 'Entertainment',    icon: '🎬', color: '#a855f7' },
  { name: 'Health',           icon: '💊', color: '#ef4444' },
  { name: 'Education',        icon: '📚', color: '#06b6d4' },
  { name: 'MathEase Income',  icon: '📐', color: '#10b981' },
  { name: 'Tutoring Income',  icon: '🎓', color: '#14b8a6' },
  { name: 'Other Income',     icon: '💰', color: '#84cc16' },
  { name: 'Other',            icon: '📦', color: '#6b7280' },
];

function seedCategories() {
  const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
  if (cnt === 0) {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO categories (name, icon, color, created_at) VALUES (?, ?, ?, ?)'
    );
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const cat of DEFAULT_CATEGORIES) {
        insert.run(cat.name, cat.icon, cat.color, now);
      }
    })();
  }
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

function getTransactions({ month, category, type, limit = 500 } = {}) {
  let query = 'SELECT * FROM transactions WHERE 1=1';
  const params = [];
  if (month)    { query += " AND strftime('%Y-%m', date) = ?"; params.push(month); }
  if (category) { query += ' AND category = ?'; params.push(category); }
  if (type)     { query += ' AND type = ?'; params.push(type); }
  query += ' ORDER BY date DESC, created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(query).all(...params);
}

function deleteTransaction(id) {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (tx) db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  return tx;
}

function deleteLastTransaction() {
  const tx = db.prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 1').get();
  if (tx) db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.id);
  return tx;
}

function getLastNTransactions(n = 5) {
  return db.prepare(
    'SELECT * FROM transactions ORDER BY date DESC, created_at DESC LIMIT ?'
  ).all(n);
}

function getSummaryByMonth(month) {
  const rows = db.prepare(`
    SELECT type, category, SUM(amount) as total
    FROM transactions
    WHERE strftime('%Y-%m', date) = ?
    GROUP BY type, category
    ORDER BY total DESC
  `).all(month);

  const counts = db.prepare(`
    SELECT type, COUNT(*) as cnt
    FROM transactions
    WHERE strftime('%Y-%m', date) = ?
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
    WHERE strftime('%Y-%m', date) = ?
    GROUP BY date, type
    ORDER BY date ASC
  `).all(month);
}

function getMonthlyTrends(months = 6) {
  return db.prepare(`
    SELECT strftime('%Y-%m', date) as month, type, SUM(amount) as total
    FROM transactions
    WHERE date >= date('now', '-' || ? || ' months')
    GROUP BY month, type
    ORDER BY month ASC
  `).all(months);
}

// ─── Categories ───────────────────────────────────────────────────────────────

function getCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
}

function insertCategory({ name, icon, color }) {
  const result = db.prepare(
    'INSERT INTO categories (name, icon, color, created_at) VALUES (?, ?, ?, ?)'
  ).run(name, icon || '📦', color || '#6b7280', new Date().toISOString());
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
}

function updateCategory(id, { name, icon, color }) {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!existing) return null;

  const newName = name || existing.name;

  db.transaction(() => {
    // Cascade name change to all rows that reference this category
    if (newName !== existing.name) {
      db.prepare('UPDATE transactions SET category = ? WHERE category = ?').run(newName, existing.name);
      db.prepare('UPDATE budgets SET category = ? WHERE category = ?').run(newName, existing.name);
    }
    db.prepare(
      'UPDATE categories SET name = ?, icon = COALESCE(?, icon), color = COALESCE(?, color) WHERE id = ?'
    ).run(newName, icon || null, color || null, id);
  })();

  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function deleteCategory(id) {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!cat) return null;
  db.transaction(() => {
    db.prepare("UPDATE transactions SET category = 'Other' WHERE category = ?").run(cat.name);
    db.prepare("UPDATE budgets SET category = 'Other' WHERE category = ?").run(cat.name);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  })();
  return cat;
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

function checkBudgetAlert(category, month) {
  const budget = db.prepare('SELECT * FROM budgets WHERE category = ?').get(category);
  if (!budget || !budget.monthly_limit) return null;
  const { spent } = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as spent
    FROM transactions
    WHERE category = ? AND type = 'expense' AND strftime('%Y-%m', date) = ?
  `).get(category, month);
  const pct = spent / budget.monthly_limit;
  if (pct >= 0.9) return { category, spent, limit: budget.monthly_limit, pct };
  return null;
}

module.exports = {
  insertTransaction,
  getTransactions,
  deleteTransaction,
  deleteLastTransaction,
  getLastNTransactions,
  getSummaryByMonth,
  getDailyTotals,
  getMonthlyTrends,
  getCategories,
  insertCategory,
  updateCategory,
  deleteCategory,
  getBudgets,
  getBudgetsWithSpend,
  upsertBudget,
  deleteBudget,
  checkBudgetAlert,
};
