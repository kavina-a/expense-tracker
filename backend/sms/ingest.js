const db = require('../db');
const { log, preview } = require('../logger');
const { parseSms } = require('./parsers');
const { resolveSmsCategory, guessMerchantCategory } = require('./categorize');
const { notifySmsExpense } = require('./telegramNotify');

// Identity match only: source=sms, same canonical account, exact amount,
// and (when the message has one) the same normalized merchant.
// No time window — HNB refunds often land the next day or later.

function dedupeKey(parsed) {
  return [
    parsed.bank,
    parsed.type,
    parsed.account_masked,
    Number(parsed.amount).toFixed(2),
    parsed.occurred_at || '',
    parsed.reference || '',
  ].join('|');
}

function candidateView(row) {
  if (!row || row.missing) return row;
  return {
    id: row.id,
    amount: row.amount,
    merchant: row.merchant,
    category: row.category,
    date: row.date,
    occurred_at: row.occurred_at,
    account_masked: row.account_masked,
    description: row.description,
    status: row.status,
  };
}

function parseCandidateIds(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

function hydrateReversal(row) {
  if (!row) return null;
  const ids = parseCandidateIds(row.candidate_ids);
  return {
    id: row.id,
    status: row.status,
    transaction_id: row.transaction_id,
    sms_raw_id: row.sms_raw_id,
    amount: row.amount,
    merchant: row.merchant,
    account_masked: row.account_masked,
    reference: row.reference,
    occurred_at: row.occurred_at,
    parser_match: row.parser_match,
    raw_text: row.raw_text,
    created_at: row.created_at,
    candidates: db.getTransactionsByIds(ids).map(candidateView),
  };
}

function money(amount) {
  return Number(amount).toFixed(2);
}

function candidatesFor(parsed, status) {
  return db.findSmsDebitCandidates({
    account_masked: parsed.account_masked,
    status,
    merchant: parsed.merchant,
    amount: parsed.amount,
  });
}

function hasParserLink(transactionId, parserMatch) {
  return db.listSmsReversalsForTransaction(transactionId)
    .some((row) => row.status === 'linked' && row.parser_match === parserMatch);
}

function reversalPayload(parsed, raw, key, extra) {
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
    ...extra,
  };
}

function publicParsed(parsed) {
  return {
    bank: parsed.bank,
    type: parsed.type,
    account_masked: parsed.account_masked,
    merchant: parsed.merchant,
    amount: parsed.amount,
    direction: parsed.direction,
    balance_after: parsed.balance_after,
    occurred_at: parsed.occurred_at,
    reference: parsed.reference,
    parser_match: parsed.parser_match,
  };
}

function baseResult(raw, parsed) {
  return {
    sms_raw_id: raw.id,
    parser_match: parsed ? parsed.parser_match : null,
    parsed: parsed ? publicParsed(parsed) : null,
  };
}

function correlateReversal(parsed, raw, key) {
  const posted = candidatesFor(parsed, 'posted');
  const reversed = candidatesFor(parsed, 'reversed');

  // A credit confirmation that follows an already-linked TRANSACTION REVERSAL
  // must attach to that debit and must not open a second ambiguous review.
  if (parsed.type === 'credit_confirmation') {
    const awaiting = reversed.filter((tx) => !hasParserLink(tx.id, parsed.parser_match));
    if (awaiting.length === 1) return linkExisting(parsed, raw, key, awaiting[0]);
    if (awaiting.length > 1) return needsReview(parsed, raw, key, awaiting);
  }

  if (posted.length === 1) return reverseOne(parsed, raw, key, posted[0]);
  if (posted.length > 1) return needsReview(parsed, raw, key, posted);

  const awaitingReversed = reversed.filter((tx) => !hasParserLink(tx.id, parsed.parser_match));
  if (awaitingReversed.length === 1) return linkExisting(parsed, raw, key, awaitingReversed[0]);
  if (awaitingReversed.length > 1) return needsReview(parsed, raw, key, awaitingReversed);
  if (reversed.length === 1) return linkExisting(parsed, raw, key, reversed[0]);
  return orphan(parsed, raw, key);
}

function reverseOne(parsed, raw, key, debit) {
  const row = db.insertSmsReversal(reversalPayload(parsed, raw, key, {
    status: 'linked',
    transaction_id: debit.id,
    set_reversed: true,
  }));
  const message = `Reversed expense #${debit.id} (${debit.merchant || 'unknown'} ${money(debit.amount)} LKR). No second row.`;
  log('info', 'SmsIngest', 'reversed', { sms_raw_id: raw.id, transaction_id: debit.id, amount: debit.amount });
  return {
    ...baseResult(raw, parsed),
    action: 'reversed',
    message,
    transaction_id: debit.id,
    reversal_id: row.id,
    category: debit.category,
  };
}

function linkExisting(parsed, raw, key, debit) {
  const row = db.insertSmsReversal(reversalPayload(parsed, raw, key, {
    status: 'linked',
    transaction_id: debit.id,
    set_reversed: false,
  }));
  const message = `Already reversed expense #${debit.id}. Linked this SMS; no second row.`;
  log('info', 'SmsIngest', 'linked_existing', { sms_raw_id: raw.id, transaction_id: debit.id });
  return {
    ...baseResult(raw, parsed),
    action: 'linked_existing',
    message,
    transaction_id: debit.id,
    reversal_id: row.id,
    category: debit.category,
  };
}

function needsReview(parsed, raw, key, candidates) {
  const ids = candidates.map((tx) => tx.id);
  const row = db.insertSmsReversal(reversalPayload(parsed, raw, key, {
    status: 'needs_review',
    transaction_id: null,
    set_reversed: false,
    candidate_ids: ids,
  }));
  const label = parsed.merchant || 'matching';
  const message = `Needs review: ${ids.length} ${label} charges of ${money(parsed.amount)} LKR. None were changed.`;
  log('warn', 'SmsIngest', 'needs_review', { sms_raw_id: raw.id, candidate_ids: ids, amount: parsed.amount });
  return {
    ...baseResult(raw, parsed),
    action: 'needs_review',
    message,
    review_id: row.id,
    reversal_id: row.id,
    candidates: candidates.map(candidateView),
  };
}

function orphan(parsed, raw, key) {
  const row = db.insertSmsReversal(reversalPayload(parsed, raw, key, {
    status: 'orphan_reversal',
    transaction_id: null,
    set_reversed: false,
  }));
  const message = 'No matching posted expense. Logged as an orphan reversal; not counted as income.';
  log('warn', 'SmsIngest', 'orphan_reversal', { sms_raw_id: raw.id, amount: parsed.amount, merchant: parsed.merchant });
  return {
    ...baseResult(raw, parsed),
    action: 'orphan_reversal',
    status: 'orphan_reversal',
    message,
    reversal_id: row.id,
  };
}

async function finishPurchase(raw, parsed, transaction, options, action, message) {
  let current = transaction;
  let notified = false;
  if (options.notify !== false) {
    const delivery = await notifySmsExpense(current, options);
    notified = delivery.notified;
    current = db.getTransactionById(current.id) || current;
  }
  return {
    ...baseResult(raw, parsed),
    action,
    message,
    category: current.category,
    transaction_id: current.id,
    transaction: current,
    notified,
  };
}

async function insertPurchase(parsed, raw, key, text, options = {}) {
  const existing = db.findTransactionByDedupeKey(key);
  if (existing) {
    return finishPurchase(
      raw,
      parsed,
      existing,
      options,
      'duplicate',
      `Already processed expense #${existing.id}. No new row.`,
    );
  }

  const guess = options.guessCategory === undefined ? guessMerchantCategory : options.guessCategory;
  const resolved = await resolveSmsCategory(parsed.merchant, guess);
  const category = resolved.category;
  let transaction;
  try {
    transaction = db.insertTransaction({
      amount: parsed.amount,
      type: 'expense',
      category,
      description: parsed.merchant,
      date: parsed.occurred_at.slice(0, 10),
      raw_message: text,
      source: 'sms',
      status: 'posted',
      merchant: parsed.merchant,
      account_masked: parsed.account_masked,
      balance_after: parsed.balance_after,
      occurred_at: parsed.occurred_at,
      reference: parsed.reference,
      dedupe_key: key,
      bank: parsed.bank,
      direction: 'debit',
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return finishPurchase(
        raw,
        parsed,
        db.findTransactionByDedupeKey(key),
        options,
        'duplicate',
        'Already processed. No new row.',
      );
    }
    throw err;
  }

  const message = `Logged ${parsed.merchant || 'purchase'} ${money(parsed.amount)} LKR as ${category}.`;
  log('info', 'SmsIngest', 'inserted', {
    sms_raw_id: raw.id,
    transaction_id: transaction.id,
    merchant: parsed.merchant,
    amount: parsed.amount,
    category,
    category_via: resolved.via,
  });
  const result = await finishPurchase(raw, parsed, transaction, options, 'inserted', message);
  result.category_via = resolved.via;
  return result;
}

function duplicateReversal(raw, parsed, row) {
  const hydrated = hydrateReversal(row);
  return {
    ...baseResult(raw, parsed),
    action: 'duplicate',
    message: 'Already processed. No new row.',
    status: row.status,
    reversal_id: row.id,
    review_id: row.status === 'needs_review' ? row.id : null,
    transaction_id: row.transaction_id,
    candidates: hydrated.candidates,
  };
}

async function ingestSmsText({ text, receivedAt = null, guessCategory, notify, chatId, sendMessage } = {}) {
  const received_at = receivedAt || new Date().toISOString();
  const parsed = parseSms(text);
  const raw = db.insertSmsRaw({
    text,
    received_at,
    parsed: Boolean(parsed),
    parser_match: parsed ? parsed.parser_match : null,
  });

  if (!parsed) {
    log('warn', 'SmsIngest', 'unparsed', { sms_raw_id: raw.id, preview: preview(text, 140) });
    return {
      ...baseResult(raw, null),
      action: 'unparsed',
      message: 'SMS did not match a known bank format. Logged raw and not counted.',
    };
  }

  const key = dedupeKey(parsed);

  if (parsed.type === 'purchase') {
    return insertPurchase(parsed, raw, key, text, { guessCategory, notify, chatId, sendMessage });
  }

  if (parsed.type === 'reversal' || parsed.type === 'credit_confirmation') {
    const existing = db.findSmsReversalByDedupeKey(key);
    if (existing) return duplicateReversal(raw, parsed, existing);
    try {
      return correlateReversal(parsed, raw, key);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const again = db.findSmsReversalByDedupeKey(key);
        if (again) return duplicateReversal(raw, parsed, again);
      }
      throw err;
    }
  }

  log('warn', 'SmsIngest', 'unparsed', { sms_raw_id: raw.id, parser_match: parsed.parser_match });
  return {
    ...baseResult(raw, parsed),
    action: 'unparsed',
    message: 'Parsed SMS had no ingest handler. Logged raw and not counted.',
  };
}

function listSmsReviews() {
  return db.listOpenSmsReviews().map(hydrateReversal);
}

function resolveSmsReview(reviewId, transactionId) {
  const result = db.resolveSmsReview(reviewId, transactionId);
  if (result.error) return result;
  return {
    action: 'reversed',
    message: `Reversed expense #${result.transaction.id}.`,
    review_id: result.review.id,
    transaction_id: result.transaction.id,
    transaction: result.transaction,
    review: hydrateReversal(result.review),
  };
}

module.exports = {
  dedupeKey,
  ingestSmsText,
  listSmsReviews,
  resolveSmsReview,
};
