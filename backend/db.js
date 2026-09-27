const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const RAILWAY_VOLUME_DIR = '/app/data';

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (fs.existsSync(RAILWAY_VOLUME_DIR)) {
    return path.join(RAILWAY_VOLUME_DIR, 'expenses.db');
  }
  return path.join(__dirname, 'expenses.db');
}

function getDbInfo() {
  const dbPath = resolveDbPath();
  const onVolume = dbPath.startsWith(RAILWAY_VOLUME_DIR + path.sep);
  const volumeMounted = fs.existsSync(RAILWAY_VOLUME_DIR);
  const persistent =
    onVolume ||
    (!volumeMounted && !process.env.RAILWAY_ENVIRONMENT); // local dev
  return { dbPath, onVolume, volumeMounted, persistent };
}

const { dbPath: DB_PATH, onVolume, volumeMounted, persistent } = getDbInfo();

if (volumeMounted && !onVolume) {
  console.warn(
    `[db] WARNING: DB_PATH is "${DB_PATH}" but Railway volume is at ${RAILWAY_VOLUME_DIR}. ` +
    `Set DB_PATH=${path.join(RAILWAY_VOLUME_DIR, 'expenses.db')} or unset DB_PATH to use the volume.`
  );
}

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
console.log(`[db] Using ${DB_PATH}${onVolume ? ' (persistent volume)' : persistent ? '' : ' (ephemeral — will reset on redeploy!)'}`);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    amount         REAL    NOT NULL,
    type           TEXT    NOT NULL,
    category       TEXT    NOT NULL,
    description    TEXT,
    date           TEXT    NOT NULL,
    created_at     TEXT    NOT NULL,
    raw_message    TEXT,
    source         TEXT,
    status         TEXT    NOT NULL DEFAULT 'posted',
    merchant       TEXT,
    account_masked TEXT,
    balance_after  REAL,
    occurred_at    TEXT,
    reference      TEXT,
    dedupe_key     TEXT,
    bank           TEXT,
    direction      TEXT,
    note           TEXT,
    note_reviewed  INTEGER NOT NULL DEFAULT 0,
    telegram_notify_message_id INTEGER,
    category_reply_pending INTEGER NOT NULL DEFAULT 0,
    category_prompt_options TEXT,
    category_prompt_message_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS muted_merchants (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant  TEXT    NOT NULL UNIQUE,
    muted_at  TEXT    NOT NULL
  );

  -- Decline resets the "3 no-note taps" streak so the next tap does not ask again.
  CREATE TABLE IF NOT EXISTS merchant_note_streaks (
    merchant              TEXT PRIMARY KEY,
    reset_after_tx_id     INTEGER NOT NULL DEFAULT 0,
    last_suggested_tx_id  INTEGER
  );

  CREATE TABLE IF NOT EXISTS sms_raw (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    text         TEXT    NOT NULL,
    received_at  TEXT    NOT NULL,
    parsed       INTEGER NOT NULL DEFAULT 0,
    parser_match TEXT,
    created_at   TEXT    NOT NULL
  );

  -- Reversal / credit-confirmation events. transaction_id points at the
  -- original debit when linked. needs_review rows leave every candidate posted.
  CREATE TABLE IF NOT EXISTS sms_reversals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    sms_raw_id     INTEGER,
    dedupe_key     TEXT    UNIQUE,
    status         TEXT    NOT NULL,
    transaction_id INTEGER,
    candidate_ids  TEXT,
    bank           TEXT,
    merchant       TEXT,
    amount         REAL,
    account_masked TEXT,
    reference      TEXT,
    occurred_at    TEXT,
    raw_text       TEXT    NOT NULL,
    parser_match   TEXT,
    created_at     TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS category_rules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern    TEXT    NOT NULL UNIQUE,
    category   TEXT    NOT NULL,
    created_at TEXT    NOT NULL
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
    color       TEXT    DEFAULT '#525252',
    created_at  TEXT    NOT NULL
  );
`);

// Add type column if it doesn't exist yet (safe migration)
try {
  db.exec("ALTER TABLE categories ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'");
} catch { /* already exists */ }

// Mark income categories that represent investment returns (dividends, stock sales, etc.)
try {
  db.exec("ALTER TABLE categories ADD COLUMN is_return INTEGER NOT NULL DEFAULT 0");
} catch { /* already exists */ }

function addColumnIfMissing(table, name, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((col) => col.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

// Existing DBs created before SMS ingest. Fresh DBs already have these columns.
for (const [name, definition] of [
  ['source', 'TEXT'],
  ['status', "TEXT NOT NULL DEFAULT 'posted'"],
  ['merchant', 'TEXT'],
  ['account_masked', 'TEXT'],
  ['balance_after', 'REAL'],
  ['occurred_at', 'TEXT'],
  ['reference', 'TEXT'],
  ['dedupe_key', 'TEXT'],
  ['bank', 'TEXT'],
  ['direction', 'TEXT'],
  ['note', 'TEXT'],
  ['note_reviewed', 'INTEGER NOT NULL DEFAULT 0'],
  ['telegram_notify_message_id', 'INTEGER'],
  ['category_reply_pending', 'INTEGER NOT NULL DEFAULT 0'],
  ['category_prompt_options', 'TEXT'],
  ['category_prompt_message_id', 'INTEGER'],
]) {
  addColumnIfMissing('transactions', name, definition);
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_dedupe_key
    ON transactions(dedupe_key) WHERE dedupe_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_transactions_sms_match
    ON transactions(source, status, account_masked);
  CREATE INDEX IF NOT EXISTS idx_transactions_tg_notify
    ON transactions(telegram_notify_message_id)
    WHERE telegram_notify_message_id IS NOT NULL;
`);

const DEFAULT_CATEGORIES = [
  // ── Income ──────────────────────────────────────────────────────────────────
  { name: 'Arimac',                 icon: '💼', color: '#0A0A0A', type: 'income' },
  { name: 'Tutopiya',               icon: '🎓', color: '#262626', type: 'income' },
  { name: 'Pocket Money',           icon: '💵', color: '#404040', type: 'income' },
  { name: 'Class (Thaminah)',       icon: '📚', color: '#525252', type: 'income' },
  { name: 'Icloud (Shakthi)',       icon: '☁️',  color: '#737373', type: 'income' },
  { name: 'Birthday Money',         icon: '🎂', color: '#8A8A8A', type: 'income' },
  { name: 'Class (Zaiden)',         icon: '📖', color: '#A3A3A3', type: 'income' },
  { name: 'Stock Exchange - DIV',   icon: '📈', color: '#171717', type: 'income', is_return: 1 },
  { name: 'Money from rand places', icon: '💰', color: '#3D3D3D', type: 'income' },
  { name: 'Bottles',                icon: '🍶', color: '#5C5C5C', type: 'income' },
  // ── Expense ─────────────────────────────────────────────────────────────────
  { name: 'Uber Eats',              icon: '🛵', color: '#0A0A0A', type: 'expense' },
  { name: 'Uber',                   icon: '🚗', color: '#262626', type: 'expense' },
  { name: 'Coffee Shop',            icon: '☕', color: '#404040', type: 'expense' },
  { name: 'Out w Friends',          icon: '👥', color: '#525252', type: 'expense' },
  { name: "Kavina's Athal",         icon: '🍜', color: '#737373', type: 'expense' },
  { name: 'Barista',                icon: '🫖', color: '#8A8A8A', type: 'expense' },
  { name: 'Fast Food',              icon: '🍟', color: '#A3A3A3', type: 'expense' },
  { name: 'AI Tools',               icon: '🤖', color: '#171717', type: 'expense' },
  { name: 'Groceries',              icon: '🛒', color: '#3D3D3D', type: 'expense' },
  { name: 'Concert',                icon: '🎵', color: '#5C5C5C', type: 'expense' },
  { name: 'Good Deeds',             icon: '🤲', color: '#6B6B6B', type: 'expense' },
  { name: 'Birthday Gifts',         icon: '🎁', color: '#BDBDBD', type: 'expense' },
  { name: 'Data Card',              icon: '📱', color: '#D4D4D4', type: 'expense' },
  { name: 'Gym',                    icon: '🏋️', color: '#0A0A0A', type: 'expense' },
  { name: 'Uber to/from class',     icon: '🚌', color: '#404040', type: 'expense' },
  { name: 'Dates',                  icon: '💑', color: '#737373', type: 'expense' },
  { name: 'Drinking',               icon: '🍺', color: '#8A8A8A', type: 'expense' },
  // ── Investment ──────────────────────────────────────────────────────────────
  { name: 'Stocks',                 icon: '📊', color: '#8A6D3B', type: 'investment' },
  // ── Catch-all ────────────────────────────────────────────────────────────────
  { name: 'Other',                  icon: '📦', color: '#525252', type: 'expense' },
];

function seedCategories() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO categories (name, icon, color, type, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const updateType = db.prepare(
    "UPDATE categories SET type = ? WHERE name = ? AND type = 'expense'"
  );
  const markReturn = db.prepare(
    'UPDATE categories SET is_return = 1 WHERE name = ?'
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const cat of DEFAULT_CATEGORIES) {
      insert.run(cat.name, cat.icon, cat.color, cat.type, now);
      // Backfill type for already-existing categories (metadata only — never touches transactions)
      if (cat.type === 'income' || cat.type === 'investment') updateType.run(cat.type, cat.name);
      // Mark investment return categories (idempotent)
      if (cat.is_return) markReturn.run(cat.name);
    }
  })();
}
seedCategories();

const DEFAULT_CATEGORY_RULES = [
  { pattern: 'UBER EATS', category: 'Food' },
  { pattern: 'FOODPANDA', category: 'Food' },
  { pattern: 'PICKME FOOD', category: 'Food' },
  { pattern: 'UBER', category: 'Transport' },
];

function seedCategoryRules() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO category_rules (pattern, category, created_at) VALUES (?, ?, ?)'
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const rule of DEFAULT_CATEGORY_RULES) {
      insert.run(rule.pattern, rule.category, now);
    }
  })();
}
seedCategoryRules();

function matchCategoryRule(merchant) {
  if (!merchant) return null;
  const hay = String(merchant).toUpperCase();
  const rules = db.prepare('SELECT pattern, category FROM category_rules').all()
    .sort((a, b) => b.pattern.length - a.pattern.length);
  for (const rule of rules) {
    if (hay.includes(String(rule.pattern).toUpperCase())) return rule.category;
  }
  return null;
}

function resolveCategory(merchant) {
  return matchCategoryRule(merchant);
}

function upsertCategoryRule(pattern, category) {
  const key = String(pattern || '').trim().toUpperCase();
  const name = String(category || '').trim();
  if (!key || !name) return null;
  db.prepare(`
    INSERT INTO category_rules (pattern, category, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(pattern) DO UPDATE SET category = excluded.category
  `).run(key, name, new Date().toISOString());
  return db.prepare('SELECT * FROM category_rules WHERE pattern = ?').get(key);
}

function listCategoriesInUse() {
  const names = new Set();
  const add = (name) => {
    const text = String(name || '').trim();
    if (!text || text === 'pending_category' || text === 'Uncategorized') return;
    names.add(text);
  };
  for (const row of db.prepare(
    "SELECT name FROM categories WHERE type = 'expense' OR type IS NULL"
  ).all()) add(row.name);
  for (const row of db.prepare('SELECT DISTINCT category AS name FROM category_rules').all()) add(row.name);
  for (const row of db.prepare(`
    SELECT DISTINCT category AS name FROM transactions
    WHERE type = 'expense'
      AND (raw_message IS NULL OR raw_message NOT LIKE '__budget_alert_%')
  `).all()) add(row.name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

// ─── Transactions ─────────────────────────────────────────────────────────────

function insertTransaction({
  amount, type, category, description, date, raw_message,
  source = null, status = 'posted', merchant = null, account_masked = null,
  balance_after = null, occurred_at = null, reference = null, dedupe_key = null,
  bank = null, direction = null,
}) {
  const result = db.prepare(`
    INSERT INTO transactions (
      amount, type, category, description, date, created_at, raw_message,
      source, status, merchant, account_masked, balance_after, occurred_at,
      reference, dedupe_key, bank, direction
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    amount,
    type,
    category,
    description || null,
    date,
    new Date().toISOString(),
    raw_message || null,
    source || null,
    status || 'posted',
    merchant || null,
    account_masked || null,
    balance_after != null ? balance_after : null,
    occurred_at || null,
    reference || null,
    dedupe_key || null,
    bank || null,
    direction || null,
  );
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
}

function getTransactionById(id) {
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) || null;
}

function getTransactionsByIds(ids) {
  if (!ids?.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, amount, type, category, description, date, occurred_at, merchant, account_masked, status, source
     FROM transactions WHERE id IN (${placeholders})`
  ).all(...ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id) || { id, missing: true });
}

// Sentinel pattern used by budget alert deduplication — never expose these
const SENTINEL_FILTER = "AND (raw_message IS NULL OR raw_message NOT LIKE '__budget_alert_%')";
// Reversed SMS debits stay in the table but must not keep counting as spend.
const POSTED_FILTER = "AND COALESCE(status, 'posted') = 'posted'";
const VISIBLE_FILTER = SENTINEL_FILTER + ' ' + POSTED_FILTER;

function getTransactions({ month, category, type, limit = 500, includeReversed = false } = {}) {
  const statusSql = includeReversed ? '' : ` ${POSTED_FILTER}`;
  let query = `SELECT * FROM transactions WHERE 1=1 ${SENTINEL_FILTER}${statusSql}`;
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
    `SELECT * FROM transactions WHERE 1=1 ${VISIBLE_FILTER} ORDER BY created_at DESC LIMIT 1`
  ).get();
  if (tx) db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.id);
  return tx;
}

function getLastNTransactions(n = 5) {
  return db.prepare(
    `SELECT * FROM transactions WHERE 1=1 ${VISIBLE_FILTER} ORDER BY date DESC, created_at DESC LIMIT ?`
  ).all(n);
}

function buildSummary(rows, counts, month = null) {
  const expenses    = rows.filter(r => r.type === 'expense');
  const incomes     = rows.filter(r => r.type === 'income');
  const investments = rows.filter(r => r.type === 'investment');
  const totalSpent    = expenses.reduce((s, r) => s + r.total, 0);
  const totalEarned   = incomes.reduce((s, r) => s + r.total, 0);
  const totalInvested = investments.reduce((s, r) => s + r.total, 0);
  const expenseCount    = counts.find(c => c.type === 'expense')?.cnt    || 0;
  const incomeCount     = counts.find(c => c.type === 'income')?.cnt     || 0;
  const investmentCount = counts.find(c => c.type === 'investment')?.cnt || 0;

  return {
    ...(month ? { month } : {}),
    totalSpent, totalEarned, totalInvested,
    net: totalEarned - totalSpent - totalInvested,
    expenses, incomes, investments,
    expenseCount, incomeCount, investmentCount,
    txCount: expenseCount + incomeCount + investmentCount,
  };
}

function getSummaryByMonth(month) {
  const rows = db.prepare(`
    SELECT type, category, SUM(amount) as total
    FROM transactions
    WHERE strftime('%Y-%m', date) = ? ${VISIBLE_FILTER}
    GROUP BY type, category
    ORDER BY total DESC
  `).all(month);

  const counts = db.prepare(`
    SELECT type, COUNT(*) as cnt
    FROM transactions
    WHERE strftime('%Y-%m', date) = ? ${VISIBLE_FILTER}
    GROUP BY type
  `).all(month);

  return buildSummary(rows, counts, month);
}

function getSummaryOverall() {
  const rows = db.prepare(`
    SELECT type, category, SUM(amount) as total
    FROM transactions
    WHERE 1=1 ${VISIBLE_FILTER}
    GROUP BY type, category
    ORDER BY total DESC
  `).all();

  const counts = db.prepare(`
    SELECT type, COUNT(*) as cnt
    FROM transactions
    WHERE 1=1 ${VISIBLE_FILTER}
    GROUP BY type
  `).all();

  return buildSummary(rows, counts);
}

function getSummaryByYear(year) {
  const rows = db.prepare(`
    SELECT type, category, SUM(amount) as total
    FROM transactions
    WHERE strftime('%Y', date) = ? ${VISIBLE_FILTER}
    GROUP BY type, category
    ORDER BY total DESC
  `).all(year);

  const counts = db.prepare(`
    SELECT type, COUNT(*) as cnt
    FROM transactions
    WHERE strftime('%Y', date) = ? ${VISIBLE_FILTER}
    GROUP BY type
  `).all(year);

  return { ...buildSummary(rows, counts), year };
}

function getDailyTotals(month) {
  return db.prepare(`
    SELECT date, type, SUM(amount) as total
    FROM transactions
    WHERE strftime('%Y-%m', date) = ? ${VISIBLE_FILTER}
    GROUP BY date, type
    ORDER BY date ASC
  `).all(month);
}

function getMonthlyTrends(months = 6) {
  return db.prepare(`
    SELECT strftime('%Y-%m', date) as month, type, SUM(amount) as total
    FROM transactions
    WHERE date >= date('now', '-' || ? || ' months') ${VISIBLE_FILTER}
    GROUP BY month, type
    ORDER BY month ASC
  `).all(months);
}

// ─── Categories ───────────────────────────────────────────────────────────────

function getCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY type ASC, name ASC').all();
}

function insertCategory({ name, icon, color, type = 'expense', is_return = 0 }) {
  const result = db.prepare(
    'INSERT INTO categories (name, icon, color, type, is_return, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, icon || '📦', color || '#525252', type, is_return ? 1 : 0, new Date().toISOString());
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
}

function updateCategory(id, { name, icon, color, type, is_return }) {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!existing) return null;

  const newName = name || existing.name;
  const newIsReturn = is_return != null ? (is_return ? 1 : 0) : null;

  db.transaction(() => {
    if (newName !== existing.name) {
      db.prepare('UPDATE transactions SET category = ? WHERE category = ?').run(newName, existing.name);
      db.prepare('UPDATE budgets SET category = ? WHERE category = ?').run(newName, existing.name);
    }
    db.prepare(
      'UPDATE categories SET name = ?, icon = COALESCE(?, icon), color = COALESCE(?, color), type = COALESCE(?, type), is_return = COALESCE(?, is_return) WHERE id = ?'
    ).run(newName, icon || null, color || null, type || null, newIsReturn, id);
  })();

  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function getCategoryUsage(id) {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!cat) return null;
  const txCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM transactions WHERE category = ? ${VISIBLE_FILTER}`
  ).get(cat.name).cnt;
  const budgetCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM budgets WHERE category = ?'
  ).get(cat.name).cnt;
  const recentTx = db.prepare(
    `SELECT date, amount, type, description FROM transactions WHERE category = ? ${VISIBLE_FILTER} ORDER BY date DESC, created_at DESC LIMIT 5`
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
      AND COALESCE(t.status, 'posted') = 'posted'
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
      AND COALESCE(status, 'posted') = 'posted'
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
    WHERE strftime('%Y', date) = ? ${VISIBLE_FILTER}
    GROUP BY month, type
    ORDER BY month ASC
  `).all(year);

  const categoryRows = db.prepare(`
    SELECT strftime('%Y-%m', date) as month, type, category, SUM(amount) as total
    FROM transactions
    WHERE strftime('%Y', date) = ? ${VISIBLE_FILTER}
    GROUP BY month, type, category
    ORDER BY month ASC
  `).all(year);

  // Build 12-month array
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, '0')}`;
    const income     = monthlyRows.find(r => r.month === m && r.type === 'income')?.total     || 0;
    const expense    = monthlyRows.find(r => r.month === m && r.type === 'expense')?.total    || 0;
    const investment = monthlyRows.find(r => r.month === m && r.type === 'investment')?.total || 0;
    return { month: m, income, expense, investment, net: income - expense - investment };
  });

  const totalIncome     = months.reduce((s, m) => s + m.income,     0);
  const totalExpense    = months.reduce((s, m) => s + m.expense,    0);
  const totalInvestment = months.reduce((s, m) => s + m.investment, 0);
  const savingsRate     = totalIncome > 0 ? ((totalIncome - totalExpense - totalInvestment) / totalIncome) * 100 : 0;
  const investmentRate  = totalIncome > 0 ? (totalInvestment / totalIncome) * 100 : 0;

  // Per-category arrays (12 values each)
  const incomeMap     = {};
  const expenseMap    = {};
  const investmentMap = {};
  for (const row of categoryRows) {
    const idx = parseInt(row.month.split('-')[1]) - 1;
    const map = row.type === 'income' ? incomeMap : row.type === 'investment' ? investmentMap : expenseMap;
    if (!map[row.category]) map[row.category] = Array(12).fill(0);
    map[row.category][idx] += row.total;
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
    totalInvestment,
    net: totalIncome - totalExpense - totalInvestment,
    savingsRate,
    investmentRate,
    incomeByCategory:      toList(incomeMap),
    expenseByCategory:     toList(expenseMap),
    investmentByCategory:  toList(investmentMap),
  };
}

// ─── Category Trends ─────────────────────────────────────────────────────────

function getCategoryTrends(category, months = 6) {
  return db.prepare(`
    SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
    FROM transactions
    WHERE category = ? AND date >= date('now', '-' || ? || ' months') ${VISIBLE_FILTER}
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
  ).run(name, target, deadline || null, icon || '🎯', color || '#525252', new Date().toISOString());
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

// ─── Portfolio / Investment tracking ──────────────────────────────────────────

function getPortfolioSummary() {
  const SENTINEL = "AND (raw_message IS NULL OR raw_message NOT LIKE '__budget_alert_%') AND COALESCE(status, 'posted') = 'posted'";

  // Money put INTO investments (type = 'investment')
  const investRows = db.prepare(`
    SELECT category, SUM(amount) as total, COUNT(*) as cnt
    FROM transactions
    WHERE type = 'investment' ${SENTINEL}
    GROUP BY category
    ORDER BY total DESC
  `).all();

  // Money returned FROM investments (income where category.is_return = 1)
  const returnRows = db.prepare(`
    SELECT t.category, SUM(t.amount) as total, COUNT(*) as cnt
    FROM transactions t
    INNER JOIN categories c ON c.name = t.category AND c.is_return = 1
    WHERE t.type = 'income'
      AND (t.raw_message IS NULL OR t.raw_message NOT LIKE '__budget_alert_%')
      AND COALESCE(t.status, 'posted') = 'posted'
    GROUP BY t.category
    ORDER BY total DESC
  `).all();

  // Recent investment + return transactions (combined feed)
  const recentTx = db.prepare(`
    SELECT t.id, t.amount, t.type, t.category, t.description, t.date, t.created_at,
           COALESCE(c.is_return, 0) as is_return
    FROM transactions t
    LEFT JOIN categories c ON c.name = t.category
    WHERE (
      t.type = 'investment'
      OR (t.type = 'income' AND c.is_return = 1)
    )
    AND (t.raw_message IS NULL OR t.raw_message NOT LIKE '__budget_alert_%')
    AND COALESCE(t.status, 'posted') = 'posted'
    ORDER BY t.date DESC, t.created_at DESC
    LIMIT 50
  `).all();

  // Monthly breakdown for chart (last 24 months)
  const monthlyRows = db.prepare(`
    SELECT strftime('%Y-%m', t.date) as month,
           SUM(CASE WHEN t.type = 'investment' THEN t.amount ELSE 0 END) as invested,
           SUM(CASE WHEN t.type = 'income' AND c.is_return = 1 THEN t.amount ELSE 0 END) as returned
    FROM transactions t
    LEFT JOIN categories c ON c.name = t.category
    WHERE (t.type = 'investment' OR (t.type = 'income' AND c.is_return = 1))
      AND (t.raw_message IS NULL OR t.raw_message NOT LIKE '__budget_alert_%')
      AND COALESCE(t.status, 'posted') = 'posted'
      AND t.date >= date('now', '-24 months')
    GROUP BY month
    ORDER BY month ASC
  `).all();

  const totalInvested = investRows.reduce((s, r) => s + r.total, 0);
  const totalReturns  = returnRows.reduce((s, r) => s + r.total, 0);
  const netGain       = totalReturns - totalInvested;
  const roiPct        = totalInvested > 0 ? (netGain / totalInvested) * 100 : 0;

  return { totalInvested, totalReturns, netGain, roiPct, investRows, returnRows, recentTx, monthlyRows };
}

// ─── Backup / Restore ─────────────────────────────────────────────────────────

function getFullBackup() {
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    transactions: db.prepare(
      `SELECT * FROM transactions WHERE 1=1 ${SENTINEL_FILTER} ORDER BY date ASC, created_at ASC`
    ).all(),
    categories: db.prepare('SELECT * FROM categories ORDER BY id ASC').all(),
    budgets:    db.prepare('SELECT * FROM budgets ORDER BY id ASC').all(),
    category_rules: db.prepare('SELECT * FROM category_rules ORDER BY id ASC').all(),
    sms_raw: db.prepare('SELECT * FROM sms_raw ORDER BY id ASC').all(),
    sms_reversals: db.prepare('SELECT * FROM sms_reversals ORDER BY id ASC').all(),
  };
}

function restoreFromBackup({
  transactions = [], categories = [], budgets = [],
  category_rules = [], sms_raw = [], sms_reversals = [],
}) {
  let txInserted = 0, catInserted = 0, budgetInserted = 0;

  db.transaction(() => {
    const insertTx = db.prepare(`
      INSERT OR IGNORE INTO transactions (
        id, amount, type, category, description, date, created_at, raw_message,
        source, status, merchant, account_masked, balance_after, occurred_at,
        reference, dedupe_key, bank, direction,
        note, note_reviewed, telegram_notify_message_id,
        category_reply_pending, category_prompt_options, category_prompt_message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of transactions) {
      insertTx.run(
        t.id, t.amount, t.type, t.category, t.description, t.date, t.created_at, t.raw_message,
        t.source ?? null, t.status || 'posted', t.merchant ?? null, t.account_masked ?? null,
        t.balance_after ?? null, t.occurred_at ?? null, t.reference ?? null, t.dedupe_key ?? null,
        t.bank ?? null, t.direction ?? null,
        t.note ?? null, t.note_reviewed ? 1 : 0, t.telegram_notify_message_id ?? null,
        t.category_reply_pending ? 1 : 0, t.category_prompt_options ?? null,
        t.category_prompt_message_id ?? null,
      );
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

    const insertRule = db.prepare(`
      INSERT OR IGNORE INTO category_rules (id, pattern, category, created_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const rule of category_rules) {
      insertRule.run(rule.id, rule.pattern, rule.category, rule.created_at);
    }

    const insertRaw = db.prepare(`
      INSERT OR IGNORE INTO sms_raw (id, text, received_at, parsed, parser_match, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const row of sms_raw) {
      insertRaw.run(row.id, row.text, row.received_at, row.parsed ? 1 : 0, row.parser_match || null, row.created_at);
    }

    const insertReversal = db.prepare(`
      INSERT OR IGNORE INTO sms_reversals (
        id, sms_raw_id, dedupe_key, status, transaction_id, candidate_ids,
        bank, merchant, amount, account_masked, reference, occurred_at,
        raw_text, parser_match, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of sms_reversals) {
      insertReversal.run(
        row.id, row.sms_raw_id ?? null, row.dedupe_key ?? null, row.status, row.transaction_id ?? null,
        row.candidate_ids ?? null, row.bank ?? null, row.merchant ?? null, row.amount ?? null,
        row.account_masked ?? null, row.reference ?? null, row.occurred_at ?? null,
        row.raw_text, row.parser_match ?? null, row.created_at,
      );
    }
  })();

  return { txInserted, catInserted, budgetInserted };
}

// ─── SMS ingest ───────────────────────────────────────────────────────────────

function insertSmsRaw({ text, received_at, parsed, parser_match }) {
  const info = db.prepare(`
    INSERT INTO sms_raw (text, received_at, parsed, parser_match, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(text, received_at, parsed ? 1 : 0, parser_match || null, new Date().toISOString());
  return db.prepare('SELECT * FROM sms_raw WHERE id = ?').get(info.lastInsertRowid);
}

function getSmsRaw(id) {
  return db.prepare('SELECT * FROM sms_raw WHERE id = ?').get(id) || null;
}

function findTransactionByDedupeKey(dedupeKey) {
  if (!dedupeKey) return null;
  return db.prepare('SELECT * FROM transactions WHERE dedupe_key = ?').get(dedupeKey) || null;
}

function findSmsReversalByDedupeKey(dedupeKey) {
  if (!dedupeKey) return null;
  return db.prepare('SELECT * FROM sms_reversals WHERE dedupe_key = ?').get(dedupeKey) || null;
}

function amountsMatch(left, right) {
  return Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
}

function findSmsDebitCandidates({ account_masked, status, merchant, amount }) {
  const rows = db.prepare(`
    SELECT * FROM transactions
    WHERE source = 'sms'
      AND status = ?
      AND account_masked = ?
      AND direction = 'debit'
    ORDER BY date ASC, id ASC
  `).all(status, account_masked);
  const merchantKey = merchant ? String(merchant).toUpperCase() : null;
  return rows.filter((row) => {
    if (!amountsMatch(row.amount, amount)) return false;
    if (merchantKey && String(row.merchant || '').toUpperCase() !== merchantKey) return false;
    return true;
  });
}

function rememberReference(transactionId, reference) {
  if (!transactionId || !reference) return;
  db.prepare(`
    UPDATE transactions
    SET reference = COALESCE(NULLIF(reference, ''), ?)
    WHERE id = ?
  `).run(reference, transactionId);
}

function insertSmsReversal({
  sms_raw_id, dedupe_key, status, transaction_id = null, set_reversed = false,
  candidate_ids = null, bank = null, merchant = null, amount = null,
  account_masked = null, reference = null, occurred_at = null, raw_text, parser_match = null,
}) {
  const insert = db.prepare(`
    INSERT INTO sms_reversals (
      sms_raw_id, dedupe_key, status, transaction_id, candidate_ids,
      bank, merchant, amount, account_masked, reference, occurred_at,
      raw_text, parser_match, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const markReversed = db.prepare(
    `UPDATE transactions SET status = 'reversed' WHERE id = ? AND status = 'posted'`
  );

  return db.transaction(() => {
    if (set_reversed) {
      const updated = markReversed.run(transaction_id);
      if (updated.changes !== 1) {
        const err = new Error('debit_not_posted');
        err.code = 'DEBIT_NOT_POSTED';
        throw err;
      }
    }
    if (transaction_id) rememberReference(transaction_id, reference);
    const info = insert.run(
      sms_raw_id,
      dedupe_key,
      status,
      transaction_id,
      candidate_ids ? JSON.stringify(candidate_ids) : null,
      bank,
      merchant,
      amount,
      account_masked,
      reference,
      occurred_at,
      raw_text,
      parser_match,
      new Date().toISOString(),
    );
    return db.prepare('SELECT * FROM sms_reversals WHERE id = ?').get(info.lastInsertRowid);
  })();
}

function listOpenSmsReviews() {
  return db.prepare(
    `SELECT * FROM sms_reversals WHERE status = 'needs_review' ORDER BY created_at ASC, id ASC`
  ).all();
}

function getSmsReversal(id) {
  return db.prepare('SELECT * FROM sms_reversals WHERE id = ?').get(id) || null;
}

function listSmsReversalsForTransaction(transactionId) {
  return db.prepare(
    'SELECT * FROM sms_reversals WHERE transaction_id = ? ORDER BY id ASC'
  ).all(transactionId);
}

function resolveSmsReview(reviewId, transactionId) {
  return db.transaction(() => {
    const review = db.prepare('SELECT * FROM sms_reversals WHERE id = ?').get(reviewId);
    if (!review) return { error: 'not_found' };
    if (review.status !== 'needs_review') return { error: 'not_open', review };
    let ids = [];
    try { ids = JSON.parse(review.candidate_ids || '[]'); } catch { ids = []; }
    if (!ids.includes(transactionId)) return { error: 'not_candidate', review };
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
    if (!tx || tx.source !== 'sms') return { error: 'not_candidate', review };
    if (tx.status === 'posted') {
      const updated = db.prepare(
        `UPDATE transactions SET status = 'reversed' WHERE id = ? AND status = 'posted'`
      ).run(transactionId);
      if (updated.changes !== 1) return { error: 'not_posted', review };
    } else if (tx.status !== 'reversed') {
      return { error: 'not_posted', review };
    }
    rememberReference(transactionId, review.reference);
    db.prepare(
      `UPDATE sms_reversals SET status = 'linked', transaction_id = ? WHERE id = ?`
    ).run(transactionId, reviewId);
    return {
      review: db.prepare('SELECT * FROM sms_reversals WHERE id = ?').get(reviewId),
      transaction: db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId),
    };
  })();
}

function closeDb() {
  db.close();
}

function updateSmsExpense(id, fields) {
  const tx = getTransactionById(id);
  if (!tx) return null;
  const next = { ...tx, ...fields };
  db.prepare(`
    UPDATE transactions
    SET category = ?,
        note = ?,
        note_reviewed = ?,
        telegram_notify_message_id = ?,
        category_reply_pending = ?,
        category_prompt_options = ?,
        category_prompt_message_id = ?
    WHERE id = ?
  `).run(
    next.category,
    next.note ?? null,
    next.note_reviewed ? 1 : 0,
    next.telegram_notify_message_id ?? null,
    next.category_reply_pending ? 1 : 0,
    next.category_prompt_options ?? null,
    next.category_prompt_message_id ?? null,
    id,
  );
  return getTransactionById(id);
}

function findSmsExpenseByNotifyMessageId(messageId) {
  if (messageId == null) return null;
  return db.prepare(`
    SELECT * FROM transactions
    WHERE source = 'sms'
      AND (telegram_notify_message_id = ? OR category_prompt_message_id = ?)
    ORDER BY id DESC
    LIMIT 1
  `).get(messageId, messageId) || null;
}

function isMerchantMuted(merchant) {
  const key = String(merchant || '').trim().toUpperCase();
  if (!key) return false;
  return Boolean(db.prepare('SELECT 1 FROM muted_merchants WHERE merchant = ?').get(key));
}

function muteMerchant(merchant) {
  const key = String(merchant || '').trim().toUpperCase();
  if (!key) return null;
  db.prepare(`
    INSERT INTO muted_merchants (merchant, muted_at) VALUES (?, ?)
    ON CONFLICT(merchant) DO UPDATE SET muted_at = excluded.muted_at
  `).run(key, new Date().toISOString());
  return db.prepare('SELECT * FROM muted_merchants WHERE merchant = ?').get(key);
}

function getNoteStreak(merchant) {
  const key = String(merchant || '').trim().toUpperCase();
  return db.prepare('SELECT * FROM merchant_note_streaks WHERE merchant = ?').get(key)
    || { merchant: key, reset_after_tx_id: 0, last_suggested_tx_id: null };
}

function setNoteStreak(merchant, { reset_after_tx_id, last_suggested_tx_id } = {}) {
  const key = String(merchant || '').trim().toUpperCase();
  const current = getNoteStreak(key);
  const reset = reset_after_tx_id != null ? reset_after_tx_id : current.reset_after_tx_id;
  const suggested = last_suggested_tx_id !== undefined ? last_suggested_tx_id : current.last_suggested_tx_id;
  db.prepare(`
    INSERT INTO merchant_note_streaks (merchant, reset_after_tx_id, last_suggested_tx_id)
    VALUES (?, ?, ?)
    ON CONFLICT(merchant) DO UPDATE SET
      reset_after_tx_id = excluded.reset_after_tx_id,
      last_suggested_tx_id = excluded.last_suggested_tx_id
  `).run(key, reset || 0, suggested ?? null);
  return getNoteStreak(key);
}

function recentSmsDebits(merchant, afterId = 0, limit = 3) {
  const key = String(merchant || '').trim().toUpperCase();
  return db.prepare(`
    SELECT * FROM transactions
    WHERE source = 'sms' AND direction = 'debit' AND merchant = ? AND id > ?
    ORDER BY id DESC
    LIMIT ?
  `).all(key, afterId || 0, limit);
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
  getSummaryByYear,
  getSummaryOverall,
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
  getPortfolioSummary,
  getDbInfo,
  getTransactionById,
  getTransactionsByIds,
  insertSmsRaw,
  getSmsRaw,
  findTransactionByDedupeKey,
  findSmsReversalByDedupeKey,
  findSmsDebitCandidates,
  insertSmsReversal,
  listOpenSmsReviews,
  getSmsReversal,
  listSmsReversalsForTransaction,
  resolveSmsReview,
  closeDb,
  matchCategoryRule,
  resolveCategory,
  upsertCategoryRule,
  listCategoriesInUse,
  updateSmsExpense,
  findSmsExpenseByNotifyMessageId,
  isMerchantMuted,
  muteMerchant,
  getNoteStreak,
  setNoteStreak,
  recentSmsDebits,
};
