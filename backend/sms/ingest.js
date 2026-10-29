const db = require('../db');
const { log, preview } = require('../logger');
const { parseSms } = require('./parsers');
const { canonicalizeAccount, accountTokensIn } = require('./account');
const { resolveSmsCategory, guessMerchantCategory } = require('./categorize');
const { notifySmsExpense } = require('./telegramNotify');
const notifyHub = require('../notify');
const engine = require('../ledger/engine');
const { isoNow } = require('../time');

// Identity match only: source=sms, same canonical account, exact amount,
// and (when the message has one) the same normalized merchant.
// No time window — HNB refunds often land the next day or later.

function dedupeKey(parsed, raw = null) {
  // Purchases and reversals keep their original key shape so SMS ingested before
  // the ledger rewrite are still recognised if they are sent again.
  const legacy = ['purchase', 'reversal', 'credit_confirmation'].includes(parsed.type);
  return [
    parsed.bank,
    legacy ? parsed.type : (parsed.kind || parsed.type),
    parsed.account_masked,
    Number(parsed.amount).toFixed(2),
    parsed.occurred_at || (raw ? raw.received_at : ''),
    parsed.reference || parsed.payer || '',
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

function rememberAccounts(accounts, bank = 'hnb') {
  for (const account of accounts) {
    if (account) db.rememberOwnAccount(account, bank);
  }
}

function mentionsOwnAccount(merchant) {
  for (const account of accountTokensIn(merchant)) {
    if (db.isOwnAccount(account)) return true;
  }
  const direct = canonicalizeAccount(merchant);
  return Boolean(direct && db.isOwnAccount(direct));
}

function ownTransfer(text) {
  const accounts = accountTokensIn(text);
  if (accounts.length < 2) return null;
  if (!accounts.every((account) => db.isOwnAccount(account))) return null;
  return {
    bank: 'hnb',
    type: 'ignore',
    ignore_reason: 'own_transfer',
    account_masked: accounts[0],
    merchant: null,
    amount: null,
    direction: null,
    balance_after: null,
    occurred_at: null,
    reference: accounts.join(','),
    parser_match: 'hnb_own_transfer',
  };
}

function skippedNotify(result, reason) {
  return { ...result, notified: false, notify_reason: reason };
}

function recordSkip(raw, reason, parsed = null, detail = null) {
  db.insertSmsSkipped({
    sms_raw_id: raw.id,
    reason,
    kind: parsed?.kind || null,
    detail,
    received_at: raw.received_at,
  });
}

function ignoredResult(raw, parsed, reason) {
  const label = reason === 'interest'
    ? 'Interest credit ignored. Not an expense.'
    : reason === 'merchant'
      ? `Charges from ${parsed.merchant} are ignored.`
      : 'Transfer between your own accounts ignored. Not an expense.';
  log('info', 'SmsIngest', 'ignored', { sms_raw_id: raw.id, reason, account: parsed.account_masked });
  return skippedNotify({
    ...baseResult(raw, parsed),
    action: 'ignored',
    ignore_reason: reason,
    message: label,
  }, 'ignored');
}

function money(amount) {
  return Number(amount).toFixed(2);
}

function publicParsed(parsed) {
  return {
    bank: parsed.bank,
    type: parsed.type,
    kind: parsed.kind || null,
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

async function finishPurchase(raw, parsed, transaction, options, action, message) {
  let current = transaction;
  let notified = false;
  let notify_reason = 'notify_disabled';
  // Holds are not asked about until they post; cancelled rides are never asked about.
  if (options.notify !== false && current.status === 'posted') {
    const delivery = await notifySmsExpense(current, options);
    notified = Boolean(delivery.notified);
    notify_reason = delivery.reason || (notified ? 'sent' : 'unknown');
    current = db.getTransactionById(current.id) || current;
  } else if (current.status === 'provisional') {
    notify_reason = 'provisional_hold';
  }
  return {
    ...baseResult(raw, parsed),
    action,
    message,
    category: current.category,
    transaction_id: current.id,
    transaction: current,
    notified,
    notify_reason,
  };
}

async function insertPurchase(parsed, raw, key, text, options = {}) {
  const existing = db.findTransactionByDedupeKey(key);
  if (existing) {
    return finishPurchase(raw, parsed, existing, options, 'duplicate',
      `Already processed expense #${existing.id}. No new row.`);
  }

  if (mentionsOwnAccount(parsed.merchant)) {
    return ignoredResult(raw, { ...parsed, ignore_reason: 'own_transfer' }, 'own_transfer');
  }
  if (db.isMerchantIgnored(parsed.merchant)) {
    return ignoredResult(raw, { ...parsed, ignore_reason: 'merchant' }, 'merchant');
  }

  const guess = options.guessCategory === undefined ? guessMerchantCategory : options.guessCategory;
  const resolved = await resolveSmsCategory(parsed.merchant, guess);
  let created;
  try {
    created = engine.createDebit({ parsed, raw, key, text, category: resolved.category });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return finishPurchase(raw, parsed, db.findTransactionByDedupeKey(key), options, 'duplicate',
        'Already processed. No new row.');
    }
    throw err;
  }

  const { tx, adopted } = created;
  const label = tx.status === 'provisional'
    ? `Held ${parsed.merchant} ${money(parsed.amount)} LKR. It posts after the settle window unless it is reversed.`
    : tx.status === 'voided'
      ? `Logged ${parsed.merchant} ${money(parsed.amount)} LKR, already reversed.`
      : `Logged ${parsed.merchant || 'purchase'} ${money(parsed.amount)} LKR as ${tx.category}.`;
  log('info', 'SmsIngest', 'inserted', {
    sms_raw_id: raw.id, transaction_id: tx.id, merchant: parsed.merchant, amount: parsed.amount,
    category: tx.category, status: tx.status, category_via: resolved.via,
  });
  const result = await finishPurchase(raw, parsed, tx, options, 'inserted', label);
  result.category_via = resolved.via;
  if (adopted?.final) result.final_transaction_id = adopted.final.id;
  await notifyFinal(adopted?.final, options);
  return result;
}

// A hold replaced by a final fare: the final posts immediately, so it is asked about now.
async function notifyFinal(final, options) {
  if (!final || options.notify === false || final.status !== 'posted') return;
  await notifySmsExpense(final, options);
}

async function reversalFlow(parsed, raw, key, options) {
  const existing = db.findSmsReversalByDedupeKey(key);
  if (existing) {
    recordSkip(raw, 'duplicate_reversal', parsed, `same as reversal #${existing.id}`);
    return skippedNotify({
      ...baseResult(raw, parsed), action: 'duplicate', message: 'Already processed. No new row.',
      status: existing.status, reversal_id: existing.id, transaction_id: existing.transaction_id,
    }, 'not_a_purchase');
  }

  let outcome;
  try {
    outcome = engine.bookReversal({ parsed, raw, key });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const again = db.findSmsReversalByDedupeKey(key);
      if (again) return skippedNotify({ ...baseResult(raw, parsed), action: 'duplicate', status: again.status }, 'not_a_purchase');
    }
    throw err;
  }

  const base = { ...baseResult(raw, parsed), reversal_id: outcome.row?.id };
  if (outcome.action === 'duplicate_reversal') {
    recordSkip(raw, 'duplicate_reversal', parsed, `second SMS for reversal #${outcome.pair.id}`);
    return skippedNotify({
      ...base, action: 'linked_existing',
      message: 'Second SMS for a reversal already recorded. No second row.',
      transaction_id: outcome.transaction_id,
    }, 'not_a_purchase');
  }
  if (outcome.action === 'reversed') {
    const debit = outcome.transaction;
    await notifyFinal(outcome.final, options);
    log('info', 'SmsIngest', 'reversed', { sms_raw_id: raw.id, transaction_id: debit.id, amount: debit.amount });
    return skippedNotify({
      ...base, action: 'reversed',
      message: `Reversed expense #${debit.id} (${debit.merchant || 'unknown'} ${money(debit.amount)} LKR). No second row.`,
      transaction_id: debit.id,
      final_transaction_id: outcome.final?.id || null,
      category: debit.category,
    }, 'not_a_purchase');
  }
  if (outcome.action === 'needs_review') {
    return skippedNotify({
      ...base, action: 'needs_review',
      message: `Reversal of ${money(parsed.amount)} LKR matches ${outcome.candidates.length} expenses. Pick which one.`,
      review_id: outcome.row.id,
      candidates: outcome.candidates.map(candidateView),
    }, 'not_a_purchase');
  }
  return skippedNotify({
    ...base, action: 'orphan_reversal', status: 'orphan_reversal',
    message: `Reversal of ${money(parsed.amount)} LKR has no matching expense yet. Held until one shows up.`,
  }, 'not_a_purchase');
}

function loggedResult(raw, parsed, action, message, extra = {}) {
  return skippedNotify({ ...baseResult(raw, parsed), action, message, ...extra }, action);
}

// Everything that is not a card purchase or a reversal.
async function ledgerFlow(parsed, raw, key, text) {
  const existing = db.findTransactionByDedupeKey(key);
  if (existing) {
    return loggedResult(raw, parsed, 'duplicate', `Already processed #${existing.id}. No new row.`, { transaction_id: existing.id });
  }
  const args = { parsed, raw, key, text };
  let tx;
  switch (parsed.kind) {
    case 'salary_credit':
      tx = engine.bookSalary(args);
      return loggedResult(raw, parsed, 'inserted', `Salary ${money(tx.amount)} LKR recorded as income.`, { transaction_id: tx.id, transaction: tx });
    case 'interest_credit':
      tx = engine.bookInterest(args);
      return loggedResult(raw, parsed, 'inserted', `Interest ${money(tx.amount)} LKR recorded. Not counted as earned.`, { transaction_id: tx.id, transaction: tx });
    case 'account_credit':
      tx = engine.bookAccountCredit(args);
      return loggedResult(raw, parsed, 'inserted', `Credit ${money(tx.amount)} LKR recorded as a transfer until it is paired or explained.`, { transaction_id: tx.id, transaction: tx });
    case 'mb_transfer_debit':
      tx = engine.bookMbDebit(args);
      return loggedResult(raw, parsed, 'inserted', `Transfer out ${money(tx.amount)} LKR recorded.`, { transaction_id: tx.id, transaction: tx });
    default:
      return null;
  }
}

async function ingestSmsText({ text, receivedAt = null, guessCategory, notify, chatId, sendMessage } = {}) {
  const received_at = receivedAt || isoNow();
  let parsed = parseSms(text);
  if (parsed?.account_masked) rememberAccounts([parsed.account_masked], parsed.bank);
  if (!parsed) parsed = ownTransfer(text);

  // One-time codes are never kept: the stored copy has the code blanked out.
  const raw = db.insertSmsRaw({
    text: parsed?.type === 'otp' ? parsed.redacted_text : text,
    received_at,
    parsed: Boolean(parsed),
    parser_match: parsed ? parsed.parser_match : null,
  });
  const options = { guessCategory, notify, chatId, sendMessage };

  const result = await route(parsed, raw, text, options);
  await settleSafely(options);
  return result;
}

async function settleSafely(options) {
  try {
    const guess = options.guessCategory === undefined ? guessMerchantCategory : options.guessCategory;
    await engine.settle({
      notify: options.notify !== false,
      guessCategory: guess,
      notifyExpense: (tx, deps) => notifySmsExpense(tx, { ...options, ...deps }),
      chatId: options.chatId,
      sendMessage: options.sendMessage,
    });
  } catch (err) {
    log('error', 'SmsIngest', 'settle_failed', { error: err.message });
  }
}

async function route(parsed, raw, text, options) {
  if (parsed?.type === 'ignore' && parsed.kind !== 'interest_credit') {
    return ignoredResult(raw, parsed, parsed.ignore_reason || 'ignored');
  }

  if (parsed?.type === 'otp') {
    recordSkip(raw, 'otp', parsed);
    return skippedNotify({
      ...baseResult(raw, parsed), action: 'skipped', skip_reason: 'otp',
      message: 'One-time code. Not stored, not counted.',
    }, 'skipped');
  }

  if (parsed?.type === 'declined') {
    recordSkip(raw, 'declined', parsed, parsed.decline_reason);
    if (parsed.signal === 'low_balance') {
      await notifyHub.escalate({
        type: 'low_balance',
        severity: 'low',
        evidence: {
          summary: `A ${money(parsed.amount)} LKR card payment at ${parsed.merchant} was declined for insufficient funds.`,
          account: parsed.account_masked,
          balance: parsed.balance_after,
          amount: parsed.amount,
        },
        dedupeKey: `low_balance:${parsed.account_masked}:${parsed.occurred_at.slice(0, 10)}`,
      }, { chatId: options.chatId });
    }
    return skippedNotify({
      ...baseResult(raw, parsed), action: 'skipped', skip_reason: 'declined',
      message: 'Declined card payment. Nothing was charged, so nothing is booked.',
    }, 'skipped');
  }

  if (!parsed) {
    log('warn', 'SmsIngest', 'unparsed', { sms_raw_id: raw.id, preview: preview(text, 140) });
    recordSkip(raw, 'unparsed', null, preview(text, 140));
    await notifyHub.escalate({
      type: 'parser_failure',
      severity: 'medium',
      evidence: {
        summary: 'An SMS did not match any known bank format.',
        sms_raw_id: raw.id,
        preview: preview(text, 140),
      },
      dedupeKey: `parser_failure:${raw.id}`,
    }, { chatId: options.chatId });
    return skippedNotify({
      ...baseResult(raw, null), action: 'unparsed',
      message: 'SMS did not match a known bank format. Logged raw and not counted.',
    }, 'unparsed');
  }

  const key = dedupeKey(parsed, raw);

  if (parsed.type === 'purchase') return insertPurchase(parsed, raw, key, text, options);
  if (parsed.type === 'reversal' || parsed.type === 'credit_confirmation') return reversalFlow(parsed, raw, key, options);

  if (parsed.kind === 'merchant_adjustment_credit') {
    const outcome = engine.bookAdjustment({ parsed, raw, key });
    if (outcome.action === 'duplicate') return loggedResult(raw, parsed, 'duplicate', 'Already processed. No new row.');
    if (outcome.action === 'refunded') {
      return loggedResult(raw, parsed, 'refunded',
        `Netted ${money(parsed.amount)} LKR against ${outcome.transaction.merchant} expense #${outcome.transaction.id}.`,
        { transaction_id: outcome.transaction.id });
    }
    return loggedResult(raw, parsed, 'needs_review',
      `Refund of ${money(parsed.amount)} LKR from ${parsed.merchant} has no purchase to net against yet.`,
      { unmatched_id: outcome.unmatched.id });
  }

  if (parsed.kind === 'inbound_transfer_notice') {
    const outcome = engine.bookInboundNotice({ parsed, raw, key });
    if (outcome.action === 'duplicate') return loggedResult(raw, parsed, 'duplicate', 'Already processed. No new row.');
    return loggedResult(raw, parsed, 'pending',
      `${parsed.payer} sent ${money(parsed.amount)} LKR. Waiting for the matching credit.`,
      { unmatched_id: outcome.unmatched.id });
  }

  const booked = await ledgerFlow(parsed, raw, key, text);
  if (booked) return booked;

  log('warn', 'SmsIngest', 'unhandled', { sms_raw_id: raw.id, parser_match: parsed.parser_match });
  return skippedNotify({
    ...baseResult(raw, parsed), action: 'unparsed',
    message: 'Parsed SMS had no ingest handler. Logged raw and not counted.',
  }, 'unparsed');
}

function listSmsReviews() {
  return db.listOpenSmsReviews().map(hydrateReversal);
}

function resolveSmsReview(reviewId, transactionId) {
  const result = engine.resolveReview(reviewId, transactionId);
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
