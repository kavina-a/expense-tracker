// The ledger rules: what an SMS does to the books.
//
// Everything here is deterministic. Amounts, dates and states are decided by rules;
// the language model is only ever asked for a category (and only through the
// injected `guessCategory`). Every link between two SMS is a symmetric matcher, so
// the result does not depend on which one arrived first:
//
//   reversal      <-> debit          (and the two SMS HNB sends for one reversal)
//   hold          <-> final fare
//   adjustment    <-> debit
//   transfer out  <-> transfer in
//   "You received" <-> credit
//
// Whichever side arrives first waits; the other side closes it. `reconcile()` is
// the catch-all that retries every open link, and `settle()` handles things that
// only become true with time (holds posting, unmatched items turning into questions).

const dbApi = require('../db');
const conn = dbApi.connection;
const { transition, recordEvent, normalizeState } = require('./states');
const notifyHub = require('../notify');
const { now, isoNow, fromColombo, colomboDateTime } = require('../time');
const { log } = require('../logger');
const { PENDING_CATEGORY, resolveSmsCategory } = require('../sms/categorize');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// A reversal older than this after the hold, with a new charge in the same minute,
// is a fare change. Cancellations in the recordings come 8-17 *minutes* after the hold.
const FINAL_FARE_MIN_HOURS = 8;
const PAIR_WINDOW_MS = 2 * MINUTE;
const REVIEW_AFTER_MS = 2 * MINUTE;
const NOTICE_MATCH_MS = 2 * HOUR;
const TRANSFER_WINDOW_MS = 2 * DAY;
const REFUND_WINDOW_DAYS = 60;

const cents = (value) => Math.round(Number(value) * 100);
const sameAmount = (a, b) => cents(a) === cents(b);
const minuteOf = (naive) => String(naive || '').slice(0, 16);
const instant = (naive) => fromColombo(naive).getTime();
const nowMs = () => now().getTime();

// ─── Transactions ─────────────────────────────────────────────────────────────

const TX_COLUMNS = [
  'amount', 'type', 'category', 'description', 'date', 'created_at', 'raw_message', 'source',
  'status', 'merchant', 'merchant_raw', 'account_masked', 'balance_after', 'occurred_at',
  'reference', 'dedupe_key', 'bank', 'direction', 'kind', 'sms_raw_id', 'final_of', 'linked_id',
  'settle_after', 'note', 'note_source', 'note_reviewed', 'recurring_candidate',
  'exclude_from_earned', 'needs_review',
];

function getTx(id) {
  return conn.prepare('SELECT * FROM transactions WHERE id = ?').get(id) || null;
}

function insertTx(fields) {
  const row = { created_at: isoNow(), status: 'posted', source: 'sms', ...fields };
  const cols = TX_COLUMNS.filter((c) => row[c] !== undefined && row[c] !== null);
  const info = conn.prepare(
    `INSERT INTO transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).run(...cols.map((c) => row[c]));
  const tx = getTx(info.lastInsertRowid);
  recordEvent(tx.id, { from: null, to: normalizeState(tx.status), actor: 'system', reason: 'created', data: { kind: tx.kind } });
  return tx;
}

function setFields(id, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return getTx(id);
  conn.prepare(`UPDATE transactions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => fields[c]), id);
  return getTx(id);
}

function holdWindowHours(merchantKey) {
  if (!merchantKey) return null;
  const row = conn.prepare('SELECT settle_window_hours AS h FROM hold_prone_merchants WHERE pattern = ?')
    .get(String(merchantKey).toUpperCase());
  return row ? row.h : null;
}

// ─── Questions ────────────────────────────────────────────────────────────────

function resolveQuestionByKey(dedupeKey, resolution = 'auto_resolved') {
  conn.prepare(`
    UPDATE questions SET resolution = ?, resolved_by = 'system', resolved_at = ?
    WHERE dedupe_key = ? AND resolution IS NULL
  `).run(resolution, isoNow(), dedupeKey);
}

function askAbout(tx, prompt, options, dedupeKey, priority = 2) {
  setFields(tx.id, { needs_review: 1 });
  return notifyHub.ask({ subject: 'txn', subjectId: tx.id, prompt, options, priority, dedupeKey }).question;
}

const money = (n) => `LKR ${Number(n).toFixed(2)}`;

// ─── Debits ───────────────────────────────────────────────────────────────────

// A card charge or bill payment. Hold-prone merchants (UBER) start provisional.
function createDebit({ parsed, raw, key, text, category }) {
  const isCard = parsed.kind === 'card_debit';
  const window = isCard ? holdWindowHours(parsed.merchant) : null;
  const finalOf = isCard && window ? findHoldReplacedBy(parsed) : null;

  let status = 'posted';
  let settleAfter = null;
  if (!finalOf && window) {
    status = 'provisional';
    settleAfter = new Date(instant(parsed.occurred_at) + window * HOUR).toISOString();
  }

  const held = finalOf ? getTx(finalOf) : null;
  const tx = insertTx({
    amount: parsed.amount,
    type: 'expense',
    category: held && held.category !== PENDING_CATEGORY ? held.category : category,
    description: parsed.merchant_raw || parsed.merchant,
    date: parsed.occurred_at.slice(0, 10),
    raw_message: text,
    status,
    merchant: parsed.merchant,
    merchant_raw: parsed.merchant_raw,
    account_masked: parsed.account_masked,
    balance_after: parsed.balance_after,
    occurred_at: parsed.occurred_at,
    reference: parsed.reference,
    dedupe_key: key,
    bank: parsed.bank,
    direction: 'debit',
    kind: parsed.kind,
    sms_raw_id: raw.id,
    final_of: finalOf,
    settle_after: settleAfter,
    note: held?.note || null,
    note_source: held?.note ? held.note_source : null,
    note_reviewed: held?.note_reviewed ? 1 : 0,
    recurring_candidate: parsed.kind === 'bill_payment' ? 1 : 0,
  });
  if (finalOf) recordEvent(tx.id, { from: null, to: 'posted', reason: 'final_fare', data: { replaces: finalOf } });

  // A reversal that arrived before this debit may be waiting for it.
  const adopted = adoptOrphanReversal(tx);
  reconcile();
  return { tx: getTx(tx.id), adopted };
}

// Reversal R voided hold H earlier, and this new charge lands in R's minute.
function findHoldReplacedBy(parsed) {
  const rows = conn.prepare(`
    SELECT r.occurred_at AS r_at, h.* FROM sms_reversals r
    JOIN transactions h ON h.id = r.transaction_id
    WHERE r.status = 'linked'
  `).all().filter((row) => row.account_masked === parsed.account_masked
    && row.merchant === parsed.merchant
    && minuteOf(row.r_at) === minuteOf(parsed.occurred_at)
    && instant(row.r_at) - instant(row.occurred_at) >= FINAL_FARE_MIN_HOURS * HOUR
    && !conn.prepare('SELECT 1 FROM transactions WHERE final_of = ?').get(row.id));
  const ids = [...new Set(rows.map((r) => r.id))];
  return ids.length === 1 ? ids[0] : null;
}

// After H is voided by a reversal at `reversalAt`: is there a same-minute charge
// that replaces it? Then it is the final fare and posts straight away.
function promoteFinalFor(hold, reversalAt) {
  if (!holdWindowHours(hold.merchant)) return null;
  if (!hold.occurred_at || instant(reversalAt) - instant(hold.occurred_at) < FINAL_FARE_MIN_HOURS * HOUR) return null;
  const finals = conn.prepare(`
    SELECT * FROM transactions
    WHERE account_masked = ? AND merchant = ? AND id <> ? AND final_of IS NULL
      AND kind = 'card_debit' AND status IN ('provisional', 'posted')
  `).all(hold.account_masked, hold.merchant, hold.id)
    .filter((f) => minuteOf(f.occurred_at) === minuteOf(reversalAt) && f.occurred_at >= hold.occurred_at);
  if (finals.length !== 1) return null;
  const final = finals[0];
  const inherit = {};
  if (final.category === PENDING_CATEGORY && hold.category && hold.category !== PENDING_CATEGORY) inherit.category = hold.category;
  if (!final.note && hold.note) Object.assign(inherit, { note: hold.note, note_source: hold.note_source, note_reviewed: hold.note_reviewed });
  setFields(final.id, { final_of: hold.id, settle_after: null, ...inherit });
  if (normalizeState(final.status) === 'provisional') {
    transition(final.id, 'posted', { reason: 'final_fare', data: { replaces: hold.id } });
  }
  return getTx(final.id);
}

// ─── Reversals ────────────────────────────────────────────────────────────────

function reversalRow(parsed, raw, key, extra) {
  return {
    sms_raw_id: raw.id,
    dedupe_key: key,
    bank: parsed.bank,
    merchant: parsed.merchant,
    amount: parsed.amount,
    account_masked: parsed.account_masked,
    reference: parsed.reference,
    occurred_at: parsed.occurred_at,
    raw_text: raw.text,
    parser_match: parsed.parser_match,
    kind: parsed.kind,
    ...extra,
  };
}

// HNB sends two SMS for one reversal (card alert + ECOM REV credit), either order.
function findReversalPair(parsed) {
  return conn.prepare(`
    SELECT * FROM sms_reversals
    WHERE account_masked = ? AND paired_with IS NULL AND status <> 'duplicate'
      AND kind IS NOT NULL AND kind <> ?
  `).all(parsed.account_masked, parsed.kind).find((row) => sameAmount(row.amount, parsed.amount)
    && Math.abs(instant(row.occurred_at) - instant(parsed.occurred_at)) <= PAIR_WINDOW_MS) || null;
}

function reversalCandidates(account, amount, merchant, reversalAt) {
  return conn.prepare(`
    SELECT * FROM transactions
    WHERE source = 'sms' AND direction = 'debit' AND account_masked = ?
      AND status IN ('provisional', 'posted') AND type = 'expense'
    ORDER BY occurred_at ASC, id ASC
  `).all(account).filter((tx) => sameAmount(tx.amount, amount)
    && (!merchant || String(tx.merchant || '').toUpperCase() === String(merchant).toUpperCase())
    && (!tx.occurred_at || instant(tx.occurred_at) <= instant(reversalAt) + MINUTE));
}

function voidDebit(debit, reversal, reason = 'reversal') {
  const voided = transition(debit.id, 'voided', {
    reason,
    data: { reversal_id: reversal.id, reversal_kind: reversal.kind, reversal_at: reversal.occurred_at },
  });
  const final = promoteFinalFor(voided, reversal.occurred_at);
  return { voided, final };
}

// Handles one reversal SMS. Returns { action, ... } describing what happened.
function bookReversal({ parsed, raw, key }) {
  const pair = findReversalPair(parsed);
  if (pair) {
    const row = dbApi.insertSmsReversal(reversalRow(parsed, raw, key, {
      status: 'duplicate',
      transaction_id: pair.transaction_id,
      paired_with: pair.id,
    }));
    conn.prepare('UPDATE sms_reversals SET paired_with = ?, merchant = COALESCE(merchant, ?) WHERE id = ?')
      .run(row.id, parsed.merchant, pair.id);
    return { action: 'duplicate_reversal', row, transaction_id: pair.transaction_id, pair };
  }

  const candidates = reversalCandidates(parsed.account_masked, parsed.amount, parsed.merchant, parsed.occurred_at);
  if (candidates.length === 1) {
    const row = dbApi.insertSmsReversal(reversalRow(parsed, raw, key, { status: 'linked', transaction_id: candidates[0].id }));
    const { voided, final } = voidDebit(candidates[0], row);
    return { action: 'reversed', row, transaction: voided, final };
  }
  if (candidates.length > 1) {
    const row = dbApi.insertSmsReversal(reversalRow(parsed, raw, key, {
      status: 'needs_review',
      candidate_ids: candidates.map((tx) => tx.id),
    }));
    return { action: 'needs_review', row, candidates };
  }
  const row = dbApi.insertSmsReversal(reversalRow(parsed, raw, key, { status: 'orphan_reversal' }));
  return { action: 'orphan_reversal', row };
}

// A debit has just arrived: does an orphan reversal belong to it?
function adoptOrphanReversal(debit) {
  if (debit.type !== 'expense' || debit.direction !== 'debit') return null;
  const orphans = conn.prepare(`
    SELECT * FROM sms_reversals WHERE status = 'orphan_reversal' AND account_masked = ?
  `).all(debit.account_masked).filter((r) => sameAmount(r.amount, debit.amount)
    && (!r.merchant || r.merchant === debit.merchant)
    && (!debit.occurred_at || !r.occurred_at || instant(debit.occurred_at) <= instant(r.occurred_at) + MINUTE));
  if (orphans.length !== 1) return null;
  const orphan = orphans[0];
  conn.prepare(`UPDATE sms_reversals SET status = 'linked', transaction_id = ? WHERE id = ?`).run(debit.id, orphan.id);
  const linked = conn.prepare('SELECT * FROM sms_reversals WHERE id = ?').get(orphan.id);
  return voidDebit(getTx(debit.id), linked, 'late_debit_matches_reversal');
}

function resolveReview(reviewId, transactionId) {
  const review = conn.prepare('SELECT * FROM sms_reversals WHERE id = ?').get(reviewId);
  if (!review) return { error: 'not_found' };
  if (review.status !== 'needs_review') return { error: 'not_open', review };
  let ids = [];
  try { ids = JSON.parse(review.candidate_ids || '[]'); } catch { ids = []; }
  if (!ids.includes(transactionId)) return { error: 'not_candidate', review };
  const tx = getTx(transactionId);
  if (!tx || tx.source !== 'sms') return { error: 'not_candidate', review };
  if (!['provisional', 'posted'].includes(normalizeState(tx.status))) return { error: 'not_posted', review };
  return conn.transaction(() => {
    conn.prepare(`UPDATE sms_reversals SET status = 'linked', transaction_id = ? WHERE id = ?`).run(transactionId, reviewId);
    const linked = conn.prepare('SELECT * FROM sms_reversals WHERE id = ?').get(reviewId);
    const { voided } = voidDebit(tx, linked, 'review_resolved');
    return { review: linked, transaction: voided };
  })();
}

// ─── Refunds and adjustments ──────────────────────────────────────────────────

function remainingOf(tx) {
  return Number(tx.amount) - Number(tx.refunded_amount || 0);
}

function applyRefund(txId, amount, { actor = 'system', reason = 'refund', data = null } = {}) {
  return conn.transaction(() => {
    const tx = getTx(txId);
    const refunded = Math.round((Number(tx.refunded_amount || 0) + Number(amount)) * 100) / 100;
    if (cents(refunded) > cents(tx.amount)) {
      const err = new Error('Refund is larger than the original');
      err.code = 'REFUND_TOO_LARGE';
      throw err;
    }
    setFields(txId, { refunded_amount: refunded });
    if (cents(refunded) === cents(tx.amount)) {
      transition(txId, 'refunded', { actor, reason, data: { refund: amount, ...data } });
    } else {
      recordEvent(txId, { from: tx.status, to: tx.status, actor, reason, data: { refund: amount, ...data } });
    }
    return getTx(txId);
  })();
}

// The largest still-unrefunded purchase that this refund can belong to.
function findRefundTarget({ account, merchant, amount, onDate = null, withinDays = null, asOf = null }) {
  const rows = conn.prepare(`
    SELECT * FROM transactions
    WHERE source = 'sms' AND type = 'expense' AND direction = 'debit' AND account_masked = ?
      AND status IN ('posted', 'refunded')
  `).all(account).filter((tx) => {
    if (merchant && String(tx.merchant || '').toUpperCase() !== String(merchant).toUpperCase()) return false;
    if (cents(remainingOf(tx)) < cents(amount)) return false;
    if (onDate && tx.date !== onDate) return false;
    if (withinDays != null && asOf) {
      const age = instant(asOf) - instant(tx.occurred_at || `${tx.date}T00:00:00`);
      if (age < 0 || age > withinDays * DAY) return false;
    }
    return true;
  });
  rows.sort((a, b) => remainingOf(b) - remainingOf(a) || b.id - a.id);
  return rows[0] || null;
}

function insertUnmatched(fields) {
  const info = conn.prepare(`
    INSERT INTO unmatched (kind, sms_raw_id, account_masked, amount, merchant, payer, original_txn_date,
                           occurred_at, status, dedupe_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(fields.kind, fields.sms_raw_id ?? null, fields.account_masked ?? null, fields.amount ?? null,
    fields.merchant ?? null, fields.payer ?? null, fields.original_txn_date ?? null,
    fields.occurred_at ?? null, fields.dedupe_key, isoNow());
  return conn.prepare('SELECT * FROM unmatched WHERE id = ?').get(info.lastInsertRowid);
}

function closeUnmatched(id, status, matchedTxId = null) {
  conn.prepare('UPDATE unmatched SET status = ?, matched_txn_id = ?, resolved_at = ? WHERE id = ?')
    .run(status, matchedTxId, isoNow(), id);
  const row = conn.prepare('SELECT * FROM unmatched WHERE id = ?').get(id);
  if (row.question_id) {
    conn.prepare(`UPDATE questions SET resolution = 'auto_matched', resolved_by = 'system', resolved_at = ?
                  WHERE id = ? AND resolution IS NULL`).run(isoNow(), row.question_id);
  }
  return row;
}

// ADJ FOR ECOM: a partial refund from the merchant. Never income.
function bookAdjustment({ parsed, raw, key }) {
  const existing = conn.prepare('SELECT * FROM unmatched WHERE dedupe_key = ?').get(key);
  if (existing) return { action: 'duplicate', unmatched: existing };
  const row = insertUnmatched({
    kind: 'adjustment',
    sms_raw_id: raw.id,
    account_masked: parsed.account_masked,
    amount: parsed.amount,
    merchant: parsed.merchant,
    original_txn_date: parsed.original_txn_date,
    occurred_at: parsed.occurred_at,
    dedupe_key: key,
  });
  const matched = tryMatchAdjustment(row);
  return matched
    ? { action: 'refunded', unmatched: conn.prepare('SELECT * FROM unmatched WHERE id = ?').get(row.id), transaction: matched }
    : { action: 'needs_review', unmatched: row };
}

function tryMatchAdjustment(row) {
  const target = findRefundTarget({
    account: row.account_masked, merchant: row.merchant, amount: row.amount, onDate: row.original_txn_date,
  });
  if (!target) return null;
  const updated = applyRefund(target.id, row.amount, {
    reason: 'merchant_adjustment', data: { unmatched_id: row.id },
  });
  closeUnmatched(row.id, 'matched', target.id);
  return updated;
}

// A plain refund credit (no sample SMS yet): same merchant, <= original, within 60 days.
function bookRefundCredit({ account, merchant, amount, occurredAt, reference = null }) {
  const target = findRefundTarget({ account, merchant, amount, withinDays: REFUND_WINDOW_DAYS, asOf: occurredAt });
  if (!target) return null;
  return applyRefund(target.id, amount, { reason: 'refund_credit', data: { reference } });
}

// ─── Credits and transfers ────────────────────────────────────────────────────

function bookSalary({ parsed, raw, key, text }) {
  return insertTx({
    amount: parsed.amount, type: 'income', category: 'Salary', description: null,
    date: parsed.occurred_at.slice(0, 10), raw_message: text, merchant: null,
    account_masked: parsed.account_masked, balance_after: parsed.balance_after,
    occurred_at: parsed.occurred_at, reference: parsed.reference, dedupe_key: key, bank: parsed.bank,
    direction: 'credit', kind: 'salary_credit', sms_raw_id: raw.id,
  });
}

function bookInterest({ parsed, raw, key, text }) {
  return insertTx({
    amount: parsed.amount, type: 'income', category: 'Interest', description: 'Interest',
    date: parsed.occurred_at.slice(0, 10), raw_message: text, merchant: null,
    account_masked: parsed.account_masked, balance_after: parsed.balance_after,
    occurred_at: parsed.occurred_at, reference: parsed.reference, dedupe_key: key, bank: parsed.bank,
    direction: 'credit', kind: 'interest_credit', sms_raw_id: raw.id, exclude_from_earned: 1,
  });
}

// A credit that is not salary, interest or a reversal. It waits as a transfer until
// it pairs with a debit on another of your accounts, or someone says what it is.
function bookAccountCredit({ parsed, raw, key, text }) {
  const tx = insertTx({
    amount: parsed.amount, type: 'transfer', category: 'Transfer', description: parsed.reason,
    date: parsed.occurred_at.slice(0, 10), raw_message: text, merchant: null,
    account_masked: parsed.account_masked, balance_after: parsed.balance_after,
    occurred_at: parsed.occurred_at, reference: parsed.reference, dedupe_key: key, bank: parsed.bank,
    direction: 'credit', kind: 'account_credit', sms_raw_id: raw.id,
  });
  reconcile();
  return getTx(tx.id);
}

// MB:<remark> debit. Booked as a transfer first; settle() decides what it was once
// it is clear no matching credit is coming from another of your accounts.
function bookMbDebit({ parsed, raw, key, text }) {
  const tx = insertTx({
    amount: parsed.amount, type: 'transfer', category: 'Transfer', description: parsed.user_note,
    date: parsed.occurred_at.slice(0, 10), raw_message: text, merchant: null,
    account_masked: parsed.account_masked, balance_after: parsed.balance_after,
    occurred_at: parsed.occurred_at, reference: parsed.reference, dedupe_key: key, bank: parsed.bank,
    direction: 'debit', kind: 'mb_transfer_debit', sms_raw_id: raw.id,
    note: parsed.user_note, note_source: 'bank_remark', note_reviewed: 1,
  });
  reconcile();
  return getTx(tx.id);
}

function isOwn(account) {
  const row = conn.prepare('SELECT own FROM accounts WHERE account_masked = ?').get(account);
  return Boolean(row && row.own);
}

function pairTransfers() {
  const debits = conn.prepare(`
    SELECT * FROM transactions
    WHERE kind IN ('mb_transfer_debit', 'atm_withdrawal') AND linked_id IS NULL AND direction = 'debit'
      AND status = 'posted' ORDER BY occurred_at, id
  `).all();
  let paired = 0;
  for (const debit of debits) {
    const credits = conn.prepare(`
      SELECT * FROM transactions
      WHERE kind IN ('account_credit', 'cash_in') AND linked_id IS NULL AND direction = 'credit'
        AND status = 'posted' AND account_masked <> ?
    `).all(debit.account_masked).filter((c) => sameAmount(c.amount, debit.amount)
      && isOwn(c.account_masked) && isOwn(debit.account_masked)
      && Math.abs(instant(c.occurred_at) - instant(debit.occurred_at)) <= TRANSFER_WINDOW_MS);
    if (!credits.length) continue;
    credits.sort((a, b) => Math.abs(instant(a.occurred_at) - instant(debit.occurred_at))
      - Math.abs(instant(b.occurred_at) - instant(debit.occurred_at)) || a.id - b.id);
    const credit = credits[0];
    conn.transaction(() => {
      if (debit.type !== 'transfer') {
        recordEvent(debit.id, { from: debit.status, to: debit.status, reason: 'paired_as_transfer', data: { type: [debit.type, 'transfer'] } });
      }
      setFields(debit.id, { type: 'transfer', category: 'Transfer', linked_id: credit.id, needs_review: 0 });
      setFields(credit.id, { linked_id: debit.id, needs_review: 0 });
      resolveQuestionByKey(`review:${debit.id}`, 'auto_paired');
      resolveQuestionByKey(`review:${credit.id}`, 'auto_paired');
    })();
    paired += 1;
  }
  return paired;
}

// "You received LKR 51,000 from X" waits for the credit it describes (2 hours).
function bookInboundNotice({ parsed, raw, key }) {
  const existing = conn.prepare('SELECT * FROM unmatched WHERE dedupe_key = ?').get(key);
  if (existing) return { action: 'duplicate', unmatched: existing };
  const row = insertUnmatched({
    kind: 'inbound_notice',
    sms_raw_id: raw.id,
    amount: parsed.amount,
    payer: parsed.payer,
    occurred_at: colomboDateTime(new Date(raw.received_at)),
    dedupe_key: key,
  });
  reconcile();
  return { action: 'pending', unmatched: conn.prepare('SELECT * FROM unmatched WHERE id = ?').get(row.id) };
}

function matchInboundNotices() {
  const notices = conn.prepare(`SELECT * FROM unmatched WHERE kind = 'inbound_notice' AND status = 'open' ORDER BY id`).all();
  let matched = 0;
  for (const notice of notices) {
    const credits = conn.prepare(`
      SELECT * FROM transactions
      WHERE kind = 'account_credit' AND direction = 'credit' AND status = 'posted'
        AND id NOT IN (SELECT matched_txn_id FROM unmatched WHERE matched_txn_id IS NOT NULL AND kind = 'inbound_notice')
    `).all().filter((c) => sameAmount(c.amount, notice.amount)
      && Math.abs(instant(c.occurred_at) - instant(notice.occurred_at)) <= NOTICE_MATCH_MS);
    if (credits.length !== 1) continue;
    const credit = credits[0];
    setFields(credit.id, {
      description: notice.payer,
      note: credit.note || `From ${notice.payer}`,
      note_source: credit.note ? credit.note_source : 'bank_remark',
    });
    closeUnmatched(notice.id, 'matched', credit.id);
    matched += 1;
  }
  return matched;
}

function reconcileAdjustments() {
  let matched = 0;
  for (const row of conn.prepare(`SELECT * FROM unmatched WHERE kind = 'adjustment' AND status = 'open'`).all()) {
    if (tryMatchAdjustment(row)) matched += 1;
  }
  return matched;
}

// Retry every open link. Safe to call as often as you like.
function reconcile() {
  const transfers = pairTransfers();
  const notices = matchInboundNotices();
  const adjustments = reconcileAdjustments();
  return { transfers, notices, adjustments };
}

// ATM withdrawal: money moves from the account to the Cash wallet. Ledger-level only;
// no SMS format for it has been seen yet, so no parser calls this.
function bookAtmWithdrawal({ account, amount, occurredAt, bank = 'hnb' }) {
  conn.prepare(`INSERT OR IGNORE INTO accounts (account_masked, bank, kind, nickname, own, first_seen_at)
                VALUES ('CASH', 'cash', 'cash', 'Cash', 1, ?)`).run(isoNow());
  return conn.transaction(() => {
    const date = occurredAt.slice(0, 10);
    const out = insertTx({
      amount, type: 'transfer', category: 'Transfer', description: 'ATM withdrawal', date, source: 'ledger',
      account_masked: account, occurred_at: occurredAt, bank, direction: 'debit', kind: 'atm_withdrawal',
    });
    const cash = insertTx({
      amount, type: 'transfer', category: 'Transfer', description: 'Cash from ATM', date, source: 'ledger',
      account_masked: 'CASH', occurred_at: occurredAt, bank: 'cash', direction: 'credit', kind: 'cash_in',
      linked_id: out.id,
    });
    setFields(out.id, { linked_id: cash.id });
    return { out: getTx(out.id), cash: getTx(cash.id) };
  })();
}

// ─── Settling ─────────────────────────────────────────────────────────────────

const REMARK_KEY = (remark) => String(remark || '').trim();

async function classifyRemark(remark, guessCategory) {
  const categories = dbApi.listCategoriesInUse().filter((c) => c !== 'Transfer');
  const rule = dbApi.matchCategoryRule(remark);
  if (rule) return rule;
  if (typeof guessCategory !== 'function' || !categories.length || !REMARK_KEY(remark)) return null;
  const guess = await guessCategory({ merchant: remark, categories });
  if (!guess?.confident) return null;
  return categories.find((c) => c.toLowerCase() === String(guess.category || '').toLowerCase()) || null;
}

async function settle({ notify = true, guessCategory, notifyExpense = null, chatId, sendMessage } = {}) {
  const result = { posted: [], classified: [], asked: [] };
  const t = now();
  const nowIso = t.toISOString();

  // 1. Holds whose window has passed post as they are.
  const due = conn.prepare(`
    SELECT * FROM transactions WHERE status = 'provisional' AND settle_after IS NOT NULL AND settle_after <= ? ORDER BY id
  `).all(nowIso);
  for (const hold of due) {
    const tx = transition(hold.id, 'posted', { reason: 'settle_window_passed' });
    setFields(tx.id, { settle_after: null });
    result.posted.push(tx.id);
    if (notify && notifyExpense) await notifyExpense(getTx(tx.id), { chatId, sendMessage });
  }

  reconcile();

  // 2. MB debits that no credit has claimed: spending, or an unexplained transfer out?
  const cutoff = new Date(t.getTime() - REVIEW_AFTER_MS).toISOString();
  const lone = conn.prepare(`
    SELECT * FROM transactions
    WHERE kind = 'mb_transfer_debit' AND linked_id IS NULL AND type = 'transfer' AND needs_review = 0
      AND status = 'posted' AND created_at <= ? ORDER BY id
  `).all(cutoff);
  for (const debit of lone) {
    if (conn.prepare('SELECT 1 FROM questions WHERE dedupe_key = ?').get(`review:${debit.id}`)) continue;
    const category = await classifyRemark(debit.note, guessCategory);
    if (category) {
      recordEvent(debit.id, { from: debit.status, to: debit.status, reason: 'remark_classified', data: { type: ['transfer', 'expense'], category } });
      setFields(debit.id, { type: 'expense', category });
      result.classified.push(debit.id);
    } else {
      askAbout(debit,
        `${money(debit.amount)} left ${debit.account_masked} with the note "${debit.note}". Was that spending, or money moved to someone?`,
        { kind: 'review', choices: ['expense', 'transfer'], remark: debit.note },
        `review:${debit.id}`);
      result.asked.push(debit.id);
    }
  }

  // 3. Credits that nothing explains.
  const credits = conn.prepare(`
    SELECT * FROM transactions
    WHERE kind = 'account_credit' AND linked_id IS NULL AND needs_review = 0 AND status = 'posted' AND created_at <= ?
    ORDER BY id
  `).all(cutoff);
  for (const credit of credits) {
    if (conn.prepare('SELECT 1 FROM questions WHERE dedupe_key = ?').get(`review:${credit.id}`)) continue;
    askAbout(credit,
      `${money(credit.amount)} arrived in ${credit.account_masked} with the reason "${credit.description}". What is it?`,
      { kind: 'review', choices: ['income', 'transfer', 'refund'], reason: credit.description },
      `review:${credit.id}`);
    result.asked.push(credit.id);
  }

  // 4. Adjustments and notices that stayed unmatched.
  for (const row of conn.prepare(`SELECT * FROM unmatched WHERE status = 'open' AND question_id IS NULL ORDER BY id`).all()) {
    const age = t.getTime() - Date.parse(row.created_at);
    if (row.kind === 'adjustment' && age >= REVIEW_AFTER_MS) {
      const { question } = notifyHub.ask({
        subject: 'txn', subjectId: null, priority: 2, dedupeKey: `unmatched:${row.id}`,
        prompt: `${row.merchant} refunded ${money(row.amount)} for a purchase on ${row.original_txn_date}, but I have no purchase to net it against. Which one was it?`,
        options: { kind: 'review', unmatched_id: row.id },
      });
      conn.prepare('UPDATE unmatched SET question_id = ? WHERE id = ?').run(question.id, row.id);
      result.asked.push(`unmatched:${row.id}`);
    } else if (row.kind === 'inbound_notice' && age >= NOTICE_MATCH_MS) {
      const { question } = notifyHub.ask({
        subject: 'payer', subjectId: null, priority: 2, dedupeKey: `unmatched:${row.id}`,
        prompt: `${row.payer} sent ${money(row.amount)} but it hasn't shown up in any account. Which account did it go to, and what was it for?`,
        options: { kind: 'review', unmatched_id: row.id },
      });
      conn.prepare('UPDATE unmatched SET question_id = ? WHERE id = ?').run(question.id, row.id);
      result.asked.push(`unmatched:${row.id}`);
    }
  }
  return result;
}

function openReviewSeqs() {
  // Everything currently waiting on a person, as sms_raw ids.
  const ids = new Set();
  for (const r of conn.prepare(`SELECT sms_raw_id FROM transactions WHERE needs_review = 1 AND sms_raw_id IS NOT NULL`).all()) ids.add(r.sms_raw_id);
  for (const r of conn.prepare(`SELECT sms_raw_id FROM unmatched WHERE status = 'open' AND question_id IS NOT NULL AND sms_raw_id IS NOT NULL`).all()) ids.add(r.sms_raw_id);
  for (const r of conn.prepare(`SELECT sms_raw_id FROM sms_reversals WHERE status = 'needs_review' AND sms_raw_id IS NOT NULL`).all()) ids.add(r.sms_raw_id);
  return [...ids];
}

module.exports = {
  FINAL_FARE_MIN_HOURS,
  getTx,
  insertTx,
  holdWindowHours,
  createDebit,
  bookReversal,
  resolveReview,
  bookAdjustment,
  bookRefundCredit,
  applyRefund,
  findRefundTarget,
  bookSalary,
  bookInterest,
  bookAccountCredit,
  bookMbDebit,
  bookInboundNotice,
  bookAtmWithdrawal,
  reconcile,
  settle,
  openReviewSeqs,
  resolveSmsCategory,
};
