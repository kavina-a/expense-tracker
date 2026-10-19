const { canonicalizeAccount } = require('../account');

function normalizeMerchant(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  return text ? text.toUpperCase() : null;
}

function parseAmount(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function expandYear(yy) {
  const n = Number(yy);
  if (!Number.isInteger(n)) return null;
  return String(n >= 70 ? 1900 + n : 2000 + n);
}

function occurredAt(day, month, year, time) {
  const parts = String(time).split(':');
  const [hh, mm, ss = '00'] = parts;
  const pad = (value) => String(value).padStart(2, '0');
  if (!year || !day || !month || !hh || !mm) return null;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function parsed(fields) {
  if (!fields.account_masked || fields.amount == null || !fields.occurred_at) return null;
  return {
    bank: 'hnb',
    type: fields.type,
    account_masked: fields.account_masked,
    merchant: fields.merchant ?? null,
    amount: fields.amount,
    direction: fields.direction,
    balance_after: fields.balance_after ?? null,
    occurred_at: fields.occurred_at,
    reference: fields.reference ?? null,
  };
}

// Optional "HNB " prefix, INTERNET/PURCHASE (+ Debit account), commas in Location.
// HNB SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):670.59 LKR,...
// HNB SMS ALERT: PURCHASE, Debit account:2080***2939,Location:BARISTA - CARGILLS SQUARE, LK,...
const PURCHASE_RE = /^(?:HNB\s+)?SMS ALERT:\s*[A-Za-z0-9]+,\s*(?:Debit\s*)?Account:([^\s,]+),\s*Location:\s*(.+?),\s*[A-Za-z]{2},\s*Amount\(Approx\.\):\s*([0-9,]+(?:\.\d+)?)\s*LKR,\s*Av\.Bal:\s*([0-9,]+(?:\.\d+)?)\s*LKR,\s*Date:(\d{2})\.(\d{2})\.(\d{2}),\s*Time:(\d{2}:\d{2})/i;

// TRANSACTION REVERSAL, Credit account:2080***2939,Location:UBER, LK,Amount:207.65 LKR,...
const REVERSAL_RE = /^(?:HNB\s+)?TRANSACTION REVERSAL,\s*Credit account:([^\s,]+),\s*Location:\s*(.+?),\s*[A-Za-z]{2},\s*Amount:\s*([0-9,]+(?:\.\d+)?)\s*LKR,\s*Av\.Bal:\s*([0-9,]+(?:\.\d+)?)\s*LKR,\s*Date:(\d{2})\.(\d{2})\.(\d{2}),\s*Time:(\d{2}:\d{2})/i;

// LKR 207.65 credited to Ac No:20802XXXXX39 on 27/09/26 05:54:22 Reason:ECOM REV/002117/ID:113007 Bal:LKR 11,762.17
const CREDIT_RE = /^LKR\s+([0-9,]+(?:\.\d+)?)\s+credited to Ac No:(\S+)\s+on\s+(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})\s+Reason:(.+?)\s+Bal:LKR\s+([0-9,]+(?:\.\d+)?)/i;

// LKR 1,598.00 debited to Ac No:20802XXXXX39 on 19/10/26 10:18:43 Reason:MB BillPmt/Mobitel/... Bal:LKR 15,975.58
const DEBIT_RE = /^LKR\s+([0-9,]+(?:\.\d+)?)\s+debited to Ac No:(\S+)\s+on\s+(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})\s+Reason:(.+?)\s+Bal:LKR\s+([0-9,]+(?:\.\d+)?)/i;
const BILLPMT_RE = /BillPmt\/([^/]+)/i;

const purchaseAlert = {
  name: 'hnb_purchase_alert',
  parse(text) {
    const match = PURCHASE_RE.exec(text);
    if (!match) return null;
    const [, account, location, amount, balance, day, month, year, time] = match;
    return parsed({
      type: 'purchase',
      account_masked: canonicalizeAccount(account),
      merchant: normalizeMerchant(location),
      amount: parseAmount(amount),
      direction: 'debit',
      balance_after: parseAmount(balance),
      occurred_at: occurredAt(day, month, expandYear(year), time),
      reference: null,
    });
  },
};

const reversalAlert = {
  name: 'hnb_reversal_alert',
  parse(text) {
    const match = REVERSAL_RE.exec(text);
    if (!match) return null;
    const [, account, location, amount, balance, day, month, year, time] = match;
    return parsed({
      type: 'reversal',
      account_masked: canonicalizeAccount(account),
      merchant: normalizeMerchant(location),
      amount: parseAmount(amount),
      direction: 'credit',
      balance_after: parseAmount(balance),
      occurred_at: occurredAt(day, month, expandYear(year), time),
      reference: null,
    });
  },
};

function ledgerFields(match) {
  const [, amount, account, day, month, year, time, reason, balance] = match;
  return { amount, account, day, month, year, time, reason: String(reason).trim(), balance };
}

const billPayment = {
  name: 'hnb_bill_payment',
  parse(text) {
    const match = DEBIT_RE.exec(text);
    if (!match) return null;
    const fields = ledgerFields(match);
    const biller = fields.reason.match(BILLPMT_RE)?.[1]?.trim();
    if (!biller) return null;
    return parsed({
      type: 'purchase',
      account_masked: canonicalizeAccount(fields.account),
      merchant: normalizeMerchant(`${biller} bill payment`),
      amount: parseAmount(fields.amount),
      direction: 'debit',
      balance_after: parseAmount(fields.balance),
      occurred_at: occurredAt(fields.day, fields.month, expandYear(fields.year), fields.time),
      reference: fields.reason,
    });
  },
};

const interestCredit = {
  name: 'hnb_interest_credit',
  parse(text) {
    const match = CREDIT_RE.exec(text);
    if (!match) return null;
    const fields = ledgerFields(match);
    if (!/Int\.Pd/i.test(fields.reason)) return null;
    const row = parsed({
      type: 'ignore',
      account_masked: canonicalizeAccount(fields.account),
      merchant: null,
      amount: parseAmount(fields.amount),
      direction: 'credit',
      balance_after: parseAmount(fields.balance),
      occurred_at: occurredAt(fields.day, fields.month, expandYear(fields.year), fields.time),
      reference: fields.reason,
    });
    return row ? { ...row, ignore_reason: 'interest' } : null;
  },
};

const creditConfirmation = {
  name: 'hnb_credit_confirmation',
  parse(text) {
    const match = CREDIT_RE.exec(text);
    if (!match) return null;
    const fields = ledgerFields(match);
    const reference = fields.reason;
    // Only the reversal companion ("...REV...") — other credits stay unparsed
    // until a dedicated matcher exists, so they are not booked as income.
    if (!/REV/i.test(reference)) return null;
    return parsed({
      type: 'credit_confirmation',
      account_masked: canonicalizeAccount(fields.account),
      merchant: null,
      amount: parseAmount(fields.amount),
      direction: 'credit',
      balance_after: parseAmount(fields.balance),
      occurred_at: occurredAt(fields.day, fields.month, expandYear(fields.year), fields.time),
      reference,
    });
  },
};

module.exports = {
  id: 'hnb',
  matchers: [purchaseAlert, reversalAlert, billPayment, interestCredit, creditConfirmation],
  normalizeMerchant,
};
