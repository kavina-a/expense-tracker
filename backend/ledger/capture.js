// Duplicate-safe Ledger capture: look up by date+amount, enrich a unique match,
// park ambiguous matches for review, and insert only when nothing is there.
// Dates are Colombo calendar days. Missing account stays null (unassigned).

const crypto = require('crypto');
const dbApi = require('../db');
const db = dbApi.connection;
const { isoNow } = require('../time');
const { recordEvent } = require('./states');
const { ask } = require('../notify');
const mappings = require('./mappings');
const { isAggregatorMerchant } = require('../sms/aggregators');
const notifyHub = require('../notify');

const PENDING_CATEGORY = 'pending_category';

const ACTION_TYPES = [
  'ensure_category',
  'upsert_mapping',
  'capture_expense',
  'capture_income',
  'capture_batch',
  'correct_transaction',
  'resolve_aggregator',
];
const CAPTURE_TYPES = ['expense', 'income'];
const CORRECTION_TYPES = ['expense', 'income', 'investment', 'transfer'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNSET_CATEGORIES = new Set(['', PENDING_CATEGORY, 'uncategorized']);
const CATEGORY_ALIASES = new Map([
  ['ai expenses', 'AI Tools'],
  ['ai expense', 'AI Tools'],
  ['ai-expenses', 'AI Tools'],
]);

const cents = (value) => Math.round(Number(value) * 100);
const sameAmount = (a, b) => cents(a) === cents(b);

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

function isUnsetCategory(name) {
  return UNSET_CATEGORIES.has(String(name || '').trim().toLowerCase());
}

function publicTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    amount: row.amount,
    type: row.type,
    category: row.category,
    description: row.description,
    merchant: row.merchant,
    merchant_raw: row.merchant_raw,
    account_masked: row.account_masked ?? null,
    account_assigned: Boolean(row.account_masked),
    status: row.status,
    source: row.source,
    note: row.note,
    occurred_at: row.occurred_at,
    bank: row.bank,
    direction: row.direction,
    needs_review: row.needs_review ? 1 : 0,
  };
}

function candidateView(row) {
  const view = publicTransaction(row);
  if (!view) return row;
  return view;
}

function requireDate(value, field = 'date') {
  const text = String(value || '').trim();
  if (!DATE_RE.test(text)) throw httpError(400, `${field} must be YYYY-MM-DD`);
  const parsed = Date.parse(`${text}T00:00:00+05:30`);
  if (!Number.isFinite(parsed)) throw httpError(400, `${field} is not a valid calendar date`);
  return text;
}

function requireAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'A positive amount is required');
  return Math.round(amount * 100) / 100;
}

function requireReason(reason) {
  const text = String(reason || '').trim();
  if (!text) throw httpError(400, 'reason is required');
  return text;
}

function requireCurrency(value) {
  if (value == null || value === '') return 'LKR';
  const currency = String(value).trim().toUpperCase();
  if (currency !== 'LKR') throw httpError(400, 'currency must be LKR');
  return currency;
}

function findCategoryByName(name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  return dbApi.getCategories().find((row) => row.name.toLowerCase() === want) || null;
}

function resolveCategoryName(name, { createIfAbsent = false, icon, color, type = 'expense' } = {}) {
  const requested = String(name || '').trim();
  if (!requested) return null;
  const aliased = CATEGORY_ALIASES.get(requested.toLowerCase());
  const existing = findCategoryByName(aliased || requested);
  if (existing) return { category: existing, created: false, aliased: Boolean(aliased) };
  if (aliased) {
    const target = findCategoryByName(aliased);
    if (target) return { category: target, created: false, aliased: true };
  }
  if (!createIfAbsent) return { category: null, created: false, missing: requested };
  const created = dbApi.insertCategory({
    name: requested,
    icon: icon || '📦',
    color: color || '#525252',
    type: type || 'expense',
  });
  return { category: created, created: true };
}

function searchTransactions({
  from, to, month, q, merchant, category, amount, type, status, limit = 200,
} = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  let fromDate = from ? requireDate(from, 'from') : null;
  let toDate = to ? requireDate(to, 'to') : null;
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(String(month))) throw httpError(400, 'month must be YYYY-MM');
    fromDate = fromDate || `${month}-01`;
    toDate = toDate || `${month}-31`;
  }
  if (fromDate && toDate && fromDate > toDate) throw httpError(400, 'from must be on or before to');

  let sql = `
    SELECT * FROM transactions
    WHERE (raw_message IS NULL OR raw_message NOT LIKE '__budget_alert_%')
  `;
  const params = [];
  if (fromDate) { sql += ' AND date >= ?'; params.push(fromDate); }
  if (toDate) { sql += ' AND date <= ?'; params.push(toDate); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (status) { sql += ' AND COALESCE(status, \'posted\') = ?'; params.push(status); }
  if (amount != null && amount !== '') {
    sql += ' AND ROUND(amount * 100) = ?';
    params.push(cents(requireAmount(amount)));
  }
  sql += ' ORDER BY date ASC, id ASC LIMIT ?';
  params.push(take);

  let rows = db.prepare(sql).all(...params);
  const merchantNeedle = merchant ? String(merchant).trim().toUpperCase() : '';
  const qNeedle = q ? String(q).trim().toUpperCase() : '';
  if (merchantNeedle) {
    rows = rows.filter((row) => hayIncludes(row, merchantNeedle));
  }
  if (qNeedle) {
    rows = rows.filter((row) => hayIncludes(row, qNeedle));
  }
  return {
    ok: true,
    from: fromDate,
    to: toDate,
    count: rows.length,
    transactions: rows.map(publicTransaction),
  };
}

function hayIncludes(row, needle) {
  const hay = [
    row.merchant, row.merchant_raw, row.description, row.note, row.category,
  ].map((part) => String(part || '').toUpperCase()).join(' ');
  return hay.includes(needle);
}

function loadDateAmountCandidates(date, amount, type = 'expense') {
  return db.prepare(`
    SELECT * FROM transactions
    WHERE type = ?
      AND date = ?
      AND COALESCE(status, 'posted') NOT IN ('reversed', 'voided')
      AND (raw_message IS NULL OR raw_message NOT LIKE '__budget_alert_%')
    ORDER BY id ASC
  `).all(type, date).filter((row) => sameAmount(row.amount, amount));
}

function merchantTokenMatches(row, merchant) {
  const needle = String(merchant || '').trim().toUpperCase();
  if (!needle) return true;
  return hayIncludes(row, needle);
}

function findCaptureCandidates({ date, amount, merchant, type = 'expense' }) {
  const rows = loadDateAmountCandidates(date, amount, type);
  if (!merchant) return rows;
  // Merchant is a constraint, not a hint: do not fall back to other merchants
  // on the same date+amount (that would silently fuzzy-match plausible rows).
  return rows.filter((row) => merchantTokenMatches(row, merchant));
}

function captureDedupeKey(item) {
  if (item.client_key) return `ledger|capture|${String(item.client_key).trim()}`;
  return [
    'ledger',
    'capture',
    item.type || 'expense',
    item.date,
    cents(item.amount),
    String(item.merchant || '').trim().toUpperCase(),
    String(item.description || '').trim().toUpperCase(),
  ].join('|');
}

function snapshot(row) {
  if (!row) return null;
  return financialSnapshot(row);
}

function financialSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    amount: row.amount,
    type: row.type,
    category: row.category,
    description: row.description,
    merchant: row.merchant,
    note: row.note,
    account_masked: row.account_masked,
    source: row.source,
    status: row.status,
    needs_review: row.needs_review ? 1 : 0,
  };
}

function getPublicById(id) {
  const n = parseInt(id, 10);
  if (!Number.isFinite(n) || n <= 0) throw httpError(400, 'Invalid id');
  const row = dbApi.getTransactionById(n);
  if (!row) throw httpError(404, 'Not found');
  return { ok: true, transaction: publicTransaction(row) };
}

function applyAnnotation(row, item, { categoryName, overwriteCategory }) {
  const before = snapshot(row);
  const fields = {};
  if (overwriteCategory && categoryName && row.category !== categoryName) {
    fields.category = categoryName;
  }
  if (!row.merchant && item.merchant) {
    fields.merchant = String(item.merchant).trim().toUpperCase();
  }
  if (!row.merchant_raw && (item.merchant || item.description)) {
    fields.merchant_raw = String(item.merchant_raw || item.merchant || item.description).trim();
  }
  if (!row.description && item.description) {
    fields.description = String(item.description).trim();
  }
  const note = item.note || (isUnsetCategory(row.category) ? item.description : item.note);
  if (!row.note && note) {
    fields.note = String(note).trim();
    fields.note_source = 'ledger';
  }
  if (!Object.keys(fields).length) {
    return { row, before, changes: {} };
  }
  const cols = Object.keys(fields);
  db.prepare(`UPDATE transactions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => fields[c]), row.id);
  const updated = dbApi.getTransactionById(row.id);
  const changes = {};
  for (const col of cols) {
    if (before[col] !== updated[col]) changes[col] = { from: before[col], to: updated[col] };
  }
  recordEvent(row.id, {
    actor: 'ledger',
    reason: 'ledger_capture_enrich',
    data: { changes },
  });
  return { row: updated, before, changes };
}

function insertCapture(item, { categoryName }) {
  const merchant = item.merchant ? String(item.merchant).trim().toUpperCase() : null;
  const description = item.description ? String(item.description).trim() : (merchant || null);
  const note = item.note ? String(item.note).trim() : null;
  const category = categoryName || PENDING_CATEGORY;
  const account = item.account_masked ? String(item.account_masked).trim() : null;
  const type = item.type || 'expense';
  const direction = type === 'income' ? 'credit' : 'debit';
  const info = db.prepare(`
    INSERT INTO transactions (
      amount, type, category, description, date, created_at, source, status,
      merchant, merchant_raw, account_masked, occurred_at, note, note_source,
      direction, needs_review, dedupe_key
    ) VALUES (?, ?, ?, ?, ?, ?, 'ledger', 'posted', ?, ?, ?, NULL, ?, ?, ?, ?, ?)
  `).run(
    item.amount,
    type,
    category,
    description,
    item.date,
    isoNow(),
    merchant,
    item.merchant_raw || item.merchant || description,
    account || null,
    note,
    note ? 'ledger' : null,
    direction,
    category === PENDING_CATEGORY ? 1 : 0,
    captureDedupeKey(item),
  );
  const row = dbApi.getTransactionById(info.lastInsertRowid);
  recordEvent(row.id, {
    from: null,
    to: 'posted',
    actor: 'ledger',
    reason: 'ledger_capture_insert',
    data: { client_key: item.client_key || null, account_assigned: Boolean(account) },
  });
  if (category === PENDING_CATEGORY) {
    ask({
      subject: 'txn',
      subjectId: row.id,
      prompt: `Category still open for ${row.merchant || row.description || 'expense'} LKR ${Number(row.amount).toFixed(2)} on ${row.date}`,
      options: { kind: 'category', choices: [] },
      priority: 1,
      dedupeKey: `capture-category|${row.id}`,
    });
  }
  return row;
}

function captureIncome(rawItem = {}) {
  return captureEntry({ ...rawItem, type: 'income' });
}

function captureExpense(rawItem = {}) {
  return captureEntry({ ...rawItem, type: 'expense' });
}

function captureEntry(rawItem = {}) {
  requireCurrency(rawItem.currency);
  const type = String(rawItem.type || 'expense').trim().toLowerCase();
  if (!CAPTURE_TYPES.includes(type)) {
    throw httpError(400, 'type must be expense or income');
  }
  const dryRun = Boolean(rawItem.dry_run);
  const item = {
    date: requireDate(rawItem.date),
    amount: requireAmount(rawItem.amount),
    type,
    merchant: rawItem.merchant ? String(rawItem.merchant).trim() : '',
    description: rawItem.description ? String(rawItem.description).trim() : '',
    note: rawItem.note ? String(rawItem.note).trim() : '',
    client_key: rawItem.client_key ? String(rawItem.client_key).trim() : '',
    account_masked: rawItem.account_masked ? String(rawItem.account_masked).trim() : '',
    merchant_raw: rawItem.merchant_raw ? String(rawItem.merchant_raw).trim() : '',
    category: rawItem.category ? String(rawItem.category).trim() : '',
  };

  const existingKey = dbApi.findTransactionByDedupeKey(captureDedupeKey(item));
  if (existingKey) {
    return {
      ok: true,
      action: 'replayed',
      transaction_id: existingKey.id,
      transaction: publicTransaction(existingKey),
      candidates: [],
      changes: {},
    };
  }

  let categoryName = null;
  if (item.category) {
    const resolved = resolveCategoryName(item.category, { createIfAbsent: false });
    if (resolved.missing) {
      throw httpError(400, `Unknown category "${item.category}". Create it with ensure_category first.`);
    }
    categoryName = resolved.category.name;
  } else {
    const mapped = mappings.matchMerchantMapping(item.merchant, item.description || item.note);
    if (mapped) categoryName = mapped.category;
  }

  const candidates = findCaptureCandidates({
    date: item.date,
    amount: item.amount,
    merchant: item.merchant,
    type: item.type,
  });

  if (candidates.length > 1) {
    const views = candidates.map(candidateView);
    if (!dryRun) {
      ask({
        subject: 'txn',
        subjectId: candidates[0].id,
        prompt: `Ambiguous match for ${item.merchant || item.description || item.type} LKR ${item.amount.toFixed(2)} on ${item.date}: ${candidates.length} candidates`,
        options: { kind: 'capture_review', choices: views.map((row) => row.id) },
        priority: 2,
        dedupeKey: `capture-review|${item.type}|${item.date}|${cents(item.amount)}|${item.merchant.toUpperCase()}`,
      });
    }
    return {
      ok: true,
      action: 'needs_review',
      dry_run: dryRun,
      transaction_id: null,
      transaction: null,
      candidates: views,
      changes: {},
    };
  }

  if (candidates.length === 1) {
    if (dryRun) {
      return {
        ok: true,
        action: 'enriched',
        dry_run: true,
        transaction_id: candidates[0].id,
        transaction: publicTransaction(candidates[0]),
        candidates: [candidateView(candidates[0])],
        before_image: financialSnapshot(candidates[0]),
        changes: {},
      };
    }
    const overwriteCategory = Boolean(categoryName);
    const { row, before, changes } = applyAnnotation(candidates[0], item, { categoryName, overwriteCategory });
    return {
      ok: true,
      action: 'enriched',
      transaction_id: row.id,
      transaction: publicTransaction(row),
      candidates: [candidateView(row)],
      before_image: before,
      changes,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      action: 'inserted',
      dry_run: true,
      transaction_id: null,
      transaction: null,
      candidates: [],
      changes: {},
      preview: {
        date: item.date,
        amount: item.amount,
        type: item.type,
        category: categoryName || PENDING_CATEGORY,
        account_assigned: Boolean(item.account_masked),
      },
    };
  }

  const inserted = insertCapture(item, { categoryName });
  return {
    ok: true,
    action: 'inserted',
    transaction_id: inserted.id,
    transaction: publicTransaction(inserted),
    candidates: [],
    changes: {},
  };
}

function expectedMatches(row, expected = {}) {
  const mismatches = [];
  if (expected.date != null && String(expected.date) !== String(row.date)) {
    mismatches.push('date');
  }
  if (expected.amount != null && !sameAmount(expected.amount, row.amount)) {
    mismatches.push('amount');
  }
  if (expected.type != null && String(expected.type) !== String(row.type)) {
    mismatches.push('type');
  }
  if (expected.category != null && String(expected.category) !== String(row.category)) {
    mismatches.push('category');
  }
  return mismatches;
}

function correctTransaction(payload = {}) {
  const id = parseInt(payload.transaction_id, 10);
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, 'transaction_id is required');
  const expected = payload.expected;
  const patch = payload.set || payload.patch;
  if (!expected || typeof expected !== 'object') {
    throw httpError(400, 'expected originals (date and amount at minimum) are required');
  }
  if (expected.date == null || expected.amount == null) {
    throw httpError(400, 'expected.date and expected.amount are required');
  }
  requireDate(expected.date, 'expected.date');
  requireAmount(expected.amount);
  if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) {
    throw httpError(400, 'set must include at least one field to change');
  }

  const row = dbApi.getTransactionById(id);
  if (!row) throw httpError(404, 'Not found');

  const mismatches = expectedMatches(row, expected);
  if (mismatches.length) {
    throw httpError(409, 'Transaction has changed; refresh expected originals', {
      code: 'conflict',
      current: publicTransaction(row),
      expected,
      mismatches,
    });
  }

  const fields = {};
  if (patch.date != null) fields.date = requireDate(patch.date, 'set.date');
  if (patch.amount != null) fields.amount = requireAmount(patch.amount);
  if (patch.type != null) {
    const nextType = String(patch.type).trim().toLowerCase();
    if (!CORRECTION_TYPES.includes(nextType)) {
      throw httpError(400, 'set.type must be expense, income, investment, or transfer');
    }
    fields.type = nextType;
    if (nextType === 'income') fields.direction = 'credit';
    if (nextType === 'expense') fields.direction = 'debit';
  }
  if (patch.category != null) {
    const resolved = resolveCategoryName(String(patch.category).trim(), { createIfAbsent: false });
    if (resolved.missing) {
      throw httpError(400, `Unknown category "${patch.category}". Create it with ensure_category first.`);
    }
    fields.category = resolved.category.name;
  }
  if (patch.description != null) fields.description = String(patch.description).trim() || null;
  if (patch.note != null) {
    fields.note = String(patch.note).trim() || null;
    if (fields.note && !row.note_source) fields.note_source = 'ledger';
  }
  if (patch.merchant != null) fields.merchant = String(patch.merchant).trim().toUpperCase() || null;

  const before = financialSnapshot(row);
  const changes = {};
  for (const [col, value] of Object.entries(fields)) {
    if (col === 'amount') {
      if (!sameAmount(row[col], value)) changes[col] = { from: row[col], to: value };
    } else if (row[col] !== value) {
      changes[col] = { from: row[col], to: value };
    }
  }
  fields.needs_review = 0;

  if (payload.dry_run) {
    return {
      ok: true,
      action: 'corrected',
      dry_run: true,
      transaction_id: row.id,
      transaction: publicTransaction(row),
      before_image: before,
      changes,
    };
  }

  if (!Object.keys(changes).length) {
    return {
      ok: true,
      action: 'unchanged',
      transaction_id: row.id,
      transaction: publicTransaction(row),
      before_image: before,
      changes: {},
    };
  }

  const cols = Object.keys(fields);
  db.prepare(`UPDATE transactions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => fields[c]), row.id);
  const updated = dbApi.getTransactionById(row.id);
  recordEvent(row.id, {
    actor: 'ledger',
    reason: 'ledger_correction',
    data: {
      original: {
        date: before.date,
        amount: before.amount,
        type: before.type,
        category: before.category,
      },
      changes,
    },
  });
  return {
    ok: true,
    action: 'corrected',
    transaction_id: updated.id,
    transaction: publicTransaction(updated),
    before_image: before,
    changes,
  };
}

function parseAggregatorPayment(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw === 'pay_now' || raw === 'paynow') return 'pay_now';
  if (raw === 'instalments' || raw === 'installments' || raw === 'instalment' || raw === 'installment') {
    return 'instalments';
  }
  throw httpError(400, 'payment must be pay_now or instalments');
}

function resolveAggregator(payload = {}) {
  const id = parseInt(payload.transaction_id, 10);
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, 'transaction_id is required');
  const row = dbApi.getTransactionById(id);
  if (!row) throw httpError(404, 'Not found');
  if (!isAggregatorMerchant(row.merchant)) {
    throw httpError(400, 'transaction is not an aggregator payment');
  }

  const store = payload.store != null ? String(payload.store).trim() : '';
  const payment = parseAggregatorPayment(payload.payment);
  let categoryName = null;
  if (payload.category != null && String(payload.category).trim()) {
    const resolved = resolveCategoryName(String(payload.category).trim(), { createIfAbsent: false });
    if (resolved.missing) {
      throw httpError(400, `Unknown category "${payload.category}". Create it with ensure_category first.`);
    }
    categoryName = resolved.category.name;
  }
  if (!store && !payment && !categoryName) {
    throw httpError(400, 'set store, payment, or category for this charge only');
  }

  const fields = {};
  if (store) fields.description = store;
  if (payment) {
    const label = payment === 'pay_now' ? 'Pay Now' : 'Instalments';
    fields.note = label;
    if (!row.note_source) fields.note_source = 'ledger';
  }
  if (categoryName) fields.category = categoryName;
  if (store) fields.needs_review = 0;

  const before = financialSnapshot(row);
  if (payload.dry_run) {
    return {
      ok: true,
      action: 'resolved_aggregator',
      dry_run: true,
      transaction_id: row.id,
      transaction: publicTransaction(row),
      taught_mapping: false,
      before_image: before,
      set: fields,
    };
  }

  const cols = Object.keys(fields);
  if (cols.length) {
    db.prepare(`UPDATE transactions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => fields[c]), row.id);
  }
  const updated = dbApi.getTransactionById(row.id);
  const answer = [store, payment === 'pay_now' ? 'Pay Now' : payment === 'instalments' ? 'Instalments' : null, categoryName]
    .filter(Boolean)
    .join(' · ');
  notifyHub.resolveQuestionsForSubject('txn', row.id, {
    resolution: 'answered',
    answerText: answer,
    resolvedBy: 'ledger',
  });
  notifyHub.resolveEscalationByKey(`aggregator:${row.id}`, 'ledger');
  recordEvent(row.id, {
    actor: 'ledger',
    reason: 'aggregator_resolved',
    data: { store: store || null, payment, category: categoryName, taught_mapping: false },
  });
  return {
    ok: true,
    action: 'resolved_aggregator',
    transaction_id: updated.id,
    transaction: publicTransaction(updated),
    taught_mapping: false,
    before_image: before,
  };
}

function ensureCategoryAction(payload = {}) {
  const name = String(payload.name || '').trim();
  if (!name) throw httpError(400, 'name is required');
  const type = payload.type || 'expense';
  if (!['income', 'expense', 'investment'].includes(type)) {
    throw httpError(400, 'type must be income, expense, or investment');
  }
  try {
    const resolved = resolveCategoryName(name, {
      createIfAbsent: true,
      icon: payload.icon,
      color: payload.color,
      type,
    });
    return {
      ok: true,
      action: resolved.created ? 'created' : 'existing',
      category: resolved.category,
      aliased: resolved.aliased || false,
    };
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      const existing = findCategoryByName(name);
      return { ok: true, action: 'existing', category: existing, aliased: false };
    }
    throw err;
  }
}

function upsertMappingAction(payload = {}) {
  const categoryName = String(payload.category || '').trim();
  if (!payload.merchant_pattern || !categoryName) {
    throw httpError(400, 'merchant_pattern and category are required');
  }
  if (isAggregatorMerchant(payload.merchant_pattern)) {
    throw httpError(400, 'Mintpay is a payment method, not a shop; do not map it to a category');
  }
  const resolved = resolveCategoryName(categoryName, { createIfAbsent: false });
  if (resolved.missing) {
    throw httpError(400, `Unknown category "${categoryName}". Create it with ensure_category first.`);
  }
  const mapping = mappings.upsertMapping({
    merchant_pattern: payload.merchant_pattern,
    description_pattern: payload.description_pattern || '',
    category: resolved.category.name,
    note: payload.note || null,
    approved_by: payload.approved_by || 'user',
  });
  return { ok: true, action: 'upserted', mapping };
}

function captureBatch(payload = {}) {
  requireCurrency(payload.currency);
  const dryRun = Boolean(payload.dry_run);
  const categories = [];
  for (const spec of payload.categories || []) {
    if (dryRun) {
      categories.push({ ok: true, action: 'preview', name: spec.name, type: spec.type || 'expense' });
    } else {
      categories.push(ensureCategoryAction(spec));
    }
  }
  const mappingResults = [];
  for (const spec of payload.mappings || []) {
    if (dryRun) {
      mappingResults.push({
        ok: true,
        action: 'preview',
        merchant_pattern: spec.merchant_pattern,
        description_pattern: spec.description_pattern || '',
        category: spec.category,
      });
    } else {
      mappingResults.push(upsertMappingAction(spec));
    }
  }
  // Corrections first so later exact captures can enrich the corrected row
  // instead of inserting a duplicate.
  const corrections = [];
  for (const spec of payload.corrections || []) {
    corrections.push(correctTransaction({ ...spec, dry_run: dryRun || spec.dry_run }));
  }
  const items = [];
  for (const spec of payload.items || []) {
    const kind = spec.type === 'income' ? 'income' : 'expense';
    items.push(captureEntry({
      ...spec,
      type: kind,
      currency: spec.currency || payload.currency,
      dry_run: dryRun || spec.dry_run,
    }));
  }
  return {
    ok: true,
    action: 'batch',
    dry_run: dryRun,
    categories,
    mappings: mappingResults,
    corrections,
    items,
  };
}

function defaultIdempotencyKey(type, payload) {
  const body = JSON.stringify(payload || {});
  const digest = crypto.createHash('sha256').update(`${type}:${body}`).digest('hex').slice(0, 32);
  return `agent|${type}|${digest}`;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function hydrateAction(row) {
  if (!row) return null;
  return {
    id: row.id,
    key_id: row.key_id,
    actor: row.actor,
    type: row.type,
    reason: row.reason,
    idempotency_key: row.idempotency_key,
    request: parseJson(row.request, null),
    result: parseJson(row.result, null),
    before_image: parseJson(row.before_image, null),
    status: row.status,
    created_at: row.created_at,
  };
}

function listActions({ limit = 50 } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  return db.prepare(`
    SELECT * FROM agent_actions ORDER BY id DESC LIMIT ?
  `).all(take).map(hydrateAction);
}

function getActionByKey(key) {
  if (!key) return null;
  return hydrateAction(db.prepare('SELECT * FROM agent_actions WHERE idempotency_key = ?').get(key));
}

function logAction({ keyId, actor, type, reason, idempotencyKey, request, result, beforeImage, status }) {
  const info = db.prepare(`
    INSERT INTO agent_actions
      (key_id, actor, type, reason, idempotency_key, request, result, before_image, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    keyId || null,
    actor,
    type,
    reason,
    idempotencyKey,
    JSON.stringify(request ?? null),
    JSON.stringify(result ?? null),
    beforeImage == null ? null : JSON.stringify(beforeImage),
    status,
    isoNow(),
  );
  return hydrateAction(db.prepare('SELECT * FROM agent_actions WHERE id = ?').get(info.lastInsertRowid));
}

function runTypedAction(type, payload) {
  if (type === 'ensure_category') return ensureCategoryAction(payload);
  if (type === 'upsert_mapping') return upsertMappingAction(payload);
  if (type === 'capture_expense') return captureExpense(payload);
  if (type === 'capture_income') return captureIncome(payload);
  if (type === 'capture_batch') return captureBatch(payload);
  if (type === 'correct_transaction') return correctTransaction(payload);
  if (type === 'resolve_aggregator') return resolveAggregator(payload);
  throw httpError(400, `Unknown action type: ${type}`);
}

function dispatchAction({ type, reason, payload = {}, idempotency_key, auth, dry_run } = {}) {
  if (!ACTION_TYPES.includes(type)) throw httpError(400, `Unknown action type: ${type}`);
  const why = requireReason(reason);
  const dry = Boolean(dry_run || payload.dry_run);
  const workingPayload = dry ? { ...payload, dry_run: true } : payload;
  if (dry) {
    const result = runTypedAction(type, workingPayload);
    return {
      ok: true,
      dry_run: true,
      replayed: false,
      type,
      status: 'dry_run',
      result,
    };
  }
  const key = String(idempotency_key || payload.idempotency_key || defaultIdempotencyKey(type, payload));
  const existing = getActionByKey(key);
  if (existing) {
    return {
      ok: true,
      replayed: true,
      action_id: existing.id,
      type: existing.type,
      status: existing.status,
      result: existing.result,
    };
  }

  const actor = auth?.kind === 'session' ? 'user' : 'ledger';
  let result;
  try {
    result = runTypedAction(type, payload);
  } catch (err) {
    try {
      logAction({
        keyId: auth?.key?.id,
        actor,
        type,
        reason: why,
        idempotencyKey: `${key}|error|${Date.now()}`,
        request: { type, payload },
        result: { error: err.message },
        status: 'error',
      });
    } catch { /* logging must not hide the original error */ }
    throw err;
  }

  const status = result.action === 'needs_review' ? 'needs_review' : 'applied';
  let logged;
  try {
    logged = logAction({
      keyId: auth?.key?.id,
      actor,
      type,
      reason: why,
      idempotencyKey: key,
      request: { type, payload },
      result,
      beforeImage: result.before_image || null,
      status,
    });
  } catch (err) {
    if (String(err.code || '').includes('CONSTRAINT') || String(err.message || '').includes('UNIQUE')) {
      const raced = getActionByKey(key);
      if (raced) {
        return {
          ok: true,
          replayed: true,
          action_id: raced.id,
          type: raced.type,
          status: raced.status,
          result: raced.result,
        };
      }
    }
    throw err;
  }

  return {
    ok: true,
    replayed: false,
    action_id: logged.id,
    type,
    status: logged.status,
    result,
  };
}

function linkSmsToCapture({ parsed, raw, key, text, category }) {
  const date = String(parsed.occurred_at || '').slice(0, 10);
  if (!DATE_RE.test(date) || parsed.amount == null) return null;
  const type = parsed.direction === 'credit' ? 'income' : 'expense';
  const candidates = findCaptureCandidates({
    date,
    amount: parsed.amount,
    merchant: parsed.merchant,
    type,
  }).filter((row) => row.source === 'ledger');
  if (candidates.length !== 1) return null;

  const row = candidates[0];
  const keepCategory = !isUnsetCategory(row.category);
  const fields = {
    source: 'sms',
    raw_message: text,
    dedupe_key: key,
    merchant: parsed.merchant || row.merchant,
    merchant_raw: parsed.merchant_raw || row.merchant_raw,
    account_masked: parsed.account_masked || row.account_masked,
    balance_after: parsed.balance_after != null ? parsed.balance_after : row.balance_after,
    occurred_at: parsed.occurred_at || row.occurred_at,
    bank: parsed.bank || row.bank,
    direction: parsed.direction || row.direction,
    sms_raw_id: raw?.id ?? row.sms_raw_id,
    kind: parsed.kind || row.kind,
    reference: parsed.reference || row.reference,
  };
  if (!keepCategory && category) fields.category = category;
  const cols = Object.keys(fields);
  db.prepare(`UPDATE transactions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => fields[c]), row.id);
  recordEvent(row.id, {
    actor: 'system',
    reason: 'sms_linked_ledger_capture',
    data: { sms_raw_id: raw?.id || null, kept_category: keepCategory },
  });
  return dbApi.getTransactionById(row.id);
}

module.exports = {
  ACTION_TYPES,
  CATEGORY_ALIASES,
  publicTransaction,
  getPublicById,
  searchTransactions,
  findCaptureCandidates,
  captureExpense,
  captureIncome,
  captureBatch,
  correctTransaction,
  resolveAggregator,
  ensureCategoryAction,
  upsertMappingAction,
  dispatchAction,
  listActions,
  linkSmsToCapture,
  resolveCategoryName,
};
