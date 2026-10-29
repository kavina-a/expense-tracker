const { canonicalizeAccount } = require('../account');

function normalizeMerchant(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  return text ? text.toUpperCase() : null;
}

// The merchant exactly as the bank sent it (mixed case kept); matching uses the uppercase key.
function rawMerchant(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  return text || null;
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
    kind: fields.kind ?? null,
    channel: fields.channel ?? null,
    account_masked: fields.account_masked,
    merchant: fields.merchant ?? null,
    merchant_raw: fields.merchant_raw ?? null,
    amount: fields.amount,
    direction: fields.direction,
    balance_after: fields.balance_after ?? null,
    occurred_at: fields.occurred_at,
    reference: fields.reference ?? null,
    reason: fields.reason ?? null,
  };
}

// Optional "HNB " prefix, INTERNET/PURCHASE (+ Debit account), commas in Location.
// HNB SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):670.59 LKR,...
// HNB SMS ALERT: PURCHASE, Debit account:2080***2939,Location:BARISTA - CARGILLS SQUARE, LK,...
const PURCHASE_RE = /^(?:HNB\s+)?SMS ALERT:\s*[A-Za-z0-9]+,\s*(?:Debit\s*)?Account:([^\s,]+),\s*Location\s*:\s*(.+?),\s*[A-Za-z]{2},\s*Am(?:oun)?t\(Approx\.\)\s*:\s*([0-9,]+(?:\.\d+)?)\s*LKR,\s*Av[.l]*\s*Bal\s*:\s*([0-9,]+(?:\.\d+)?)\s*LKR,\s*Date:\s*(\d{2})\.(\d{2})\.(\d{2}),\s*Time:\s*(\d{2}:\d{2})/i;

// TRANSACTION REVERSAL, Credit account:2080***2939,Location:UBER, LK,Amount:207.65 LKR,...
const REVERSAL_RE = /^(?:HNB\s+)?TRANSACTION REVERSAL,\s*Credit account:([^\s,]+),\s*Location\s*:\s*(.+?),\s*[A-Za-z]{2},\s*Amount:\s*([0-9,]+(?:\.\d+)?)\s*LKR,\s*Av[.l]*\s*Bal\s*:\s*([0-9,]+(?:\.\d+)?)\s*LKR,\s*Date:\s*(\d{2})\.(\d{2})\.(\d{2}),\s*Time:\s*(\d{2}:\d{2})/i;

// LKR 207.65 credited to Ac No:20802XXXXX39 on 27/09/26 05:54:22 Reason:ECOM REV/002117/ID:113007 Bal:LKR 11,762.17
const CREDIT_RE = /^LKR\s+([0-9,]+(?:\.\d+)?)\s+credited to Ac No:(\S+)\s+on\s+(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})\s+Reason:(.+?)\s+Bal:\s*LKR\s+([0-9,]+(?:\.\d+)?)/i;

// LKR 1,598.00 debited to Ac No:20802XXXXX39 on 19/10/26 10:18:43 Reason:MB BillPmt/Mobitel/... Bal:LKR 15,975.58
const DEBIT_RE = /^LKR\s+([0-9,]+(?:\.\d+)?)\s+debited to Ac No:(\S+)\s+on\s+(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})\s+Reason:(.+?)\s+Bal:\s*LKR\s+([0-9,]+(?:\.\d+)?)/i;
const BILLPMT_RE = /BillPmt\/([^/]+)/i;

const purchaseAlert = {
  name: 'hnb_purchase_alert',
  parse(text) {
    const match = PURCHASE_RE.exec(text);
    if (!match) return null;
    const [, account, location, amount, balance, day, month, year, time] = match;
    return parsed({
      type: 'purchase',
      kind: 'card_debit',
      channel: /PURCHASE/i.test(text.slice(0, 40)) ? 'pos' : 'online',
      account_masked: canonicalizeAccount(account),
      merchant: normalizeMerchant(location),
      merchant_raw: rawMerchant(location),
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
      kind: 'card_reversal',
      account_masked: canonicalizeAccount(account),
      merchant: normalizeMerchant(location),
      merchant_raw: rawMerchant(location),
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
      kind: 'bill_payment',
      account_masked: canonicalizeAccount(fields.account),
      merchant: normalizeMerchant(biller),
      merchant_raw: rawMerchant(biller),
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
      kind: 'interest_credit',
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
      kind: 'ecom_reversal_credit',
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


function ledgerTime(fields) {
  return occurredAt(fields.day, fields.month, expandYear(fields.year), fields.time);
}

// LKR 20,000.00 debited to Ac No:...64 ... Reason:MB:Money for me Bal:LKR ...
// Anything else debited that is not BillPmt/MB: stays unparsed (no sample yet).
const mbTransferDebit = {
  name: 'hnb_mb_transfer_debit',
  parse(text) {
    const match = DEBIT_RE.exec(text);
    if (!match) return null;
    const fields = ledgerFields(match);
    const remark = fields.reason.match(/^MB\s*:\s*(.+)$/i)?.[1]?.trim();
    if (!remark) return null;
    const row = parsed({
      type: 'transfer_debit',
      kind: 'mb_transfer_debit',
      account_masked: canonicalizeAccount(fields.account),
      amount: parseAmount(fields.amount),
      direction: 'debit',
      balance_after: parseAmount(fields.balance),
      occurred_at: ledgerTime(fields),
      reason: fields.reason,
    });
    return row ? { ...row, user_note: remark } : null;
  },
};

// Salary reasons look like SALARY_OCT_2026/BT/<ref>.
const salaryCredit = {
  name: 'hnb_salary_credit',
  parse(text) {
    const match = CREDIT_RE.exec(text);
    if (!match) return null;
    const fields = ledgerFields(match);
    const month = fields.reason.match(/^SALARY[_\s-]*([A-Z]{3})[A-Z]*[_\s-]*(\d{4})/i);
    if (!month) return null;
    const row = parsed({
      type: 'credit',
      kind: 'salary_credit',
      account_masked: canonicalizeAccount(fields.account),
      amount: parseAmount(fields.amount),
      direction: 'credit',
      balance_after: parseAmount(fields.balance),
      occurred_at: ledgerTime(fields),
      reason: fields.reason,
      reference: fields.reason,
    });
    const index = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(month[1].toUpperCase());
    return row ? { ...row, salary_month: index >= 0 ? `${month[2]}-${String(index + 1).padStart(2, '0')}` : null } : null;
  },
};

// Any other plain credit (a transfer in from someone, or from your own account).
// Must run after the REV, interest and salary matchers.
const accountCredit = {
  name: 'hnb_account_credit',
  parse(text) {
    const match = CREDIT_RE.exec(text);
    if (!match) return null;
    const fields = ledgerFields(match);
    return parsed({
      type: 'credit',
      kind: 'account_credit',
      account_masked: canonicalizeAccount(fields.account),
      amount: parseAmount(fields.amount),
      direction: 'credit',
      balance_after: parseAmount(fields.balance),
      occurred_at: ledgerTime(fields),
      reason: fields.reason,
    });
  },
};

// A Transaction for LKR 300.00 has been credit ed to Ac No:20802XXXXX39 on 20/10/26 15:55:56 . Remarks :ADJ FOR ECOM/UBER10/16.Bal: LKR 5,902.80
const ADJ_RE = /^A Transaction for LKR\s+([0-9,]+(?:\.\d+)?)\s+has been credit\s*ed to Ac No:(\S+)\s+on\s+(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})\s*\.?\s*Remarks\s*:\s*ADJ FOR ECOM\/(.+?)\s*(\d{1,2})\/(\d{1,2})\s*\.?\s*Bal\s*:\s*LKR\s+([0-9,]+(?:\.\d+)?)/i;

const merchantAdjustment = {
  name: 'hnb_merchant_adjustment_credit',
  parse(text) {
    const match = ADJ_RE.exec(text);
    if (!match) return null;
    const [, amount, account, day, month, year, time, merchant, a, b, balance] = match;
    const fullYear = expandYear(year);
    // The fixtures only show month/day (10/16, 10/20). Fall back to day/month
    // when the first number cannot be a month.
    const [m, d] = Number(a) <= 12 ? [a, b] : [b, a];
    const pad = (v) => String(v).padStart(2, '0');
    // A purchase month later than the SMS month belongs to the previous year.
    const origYear = Number(m) > Number(month) ? String(Number(fullYear) - 1) : fullYear;
    const row = parsed({
      type: 'refund_credit',
      kind: 'merchant_adjustment_credit',
      account_masked: canonicalizeAccount(account),
      merchant: normalizeMerchant(merchant),
      merchant_raw: rawMerchant(merchant),
      amount: parseAmount(amount),
      direction: 'credit',
      balance_after: parseAmount(balance),
      occurred_at: occurredAt(day, month, fullYear, time),
      reason: `ADJ FOR ECOM/${merchant.trim()}${a}/${b}`,
    });
    return row ? { ...row, original_txn_date: `${origYear}-${pad(m)}-${pad(d)}` } : null;
  },
};

// HNB SMS ALERT:Transaction for Amt(Approx.):  1008.97 LKR declined due to insufficient funds....
// Account: 2080***2939,Location: UBER EATS, LK,Avl Bal: 703.38 LKR,Date: 18.10.26, Time:14:31,Hotline:...
const DECLINED_RE = /^(?:HNB\s+)?SMS ALERT:\s*Transaction for Am(?:oun)?t\(Approx\.\)\s*:\s*([0-9,]+(?:\.\d+)?)\s*LKR declined(?: due to ([^.]+))?\..*?Account\s*:\s*([^\s,]+),\s*Location\s*:\s*(.+?),\s*[A-Za-z]{2},\s*Av[.l]*\s*Bal\s*:\s*([0-9,]+(?:\.\d+)?)\s*LKR,\s*Date:\s*(\d{2})\.(\d{2})\.(\d{2}),\s*Time:\s*(\d{2}:\d{2})/i;

const declined = {
  name: 'hnb_declined',
  parse(text) {
    const match = DECLINED_RE.exec(text);
    if (!match) return null;
    const [, amount, why, account, location, balance, day, month, year, time] = match;
    const row = parsed({
      type: 'declined',
      kind: 'declined',
      account_masked: canonicalizeAccount(account),
      merchant: normalizeMerchant(location),
      merchant_raw: rawMerchant(location),
      amount: parseAmount(amount),
      direction: 'none',
      balance_after: parseAmount(balance),
      occurred_at: occurredAt(day, month, expandYear(year), time),
      reason: why ? why.trim() : null,
    });
    return row ? { ...row, decline_reason: row.reason, signal: /insufficient/i.test(why || '') ? 'low_balance' : null } : null;
  },
};

// Your verification code is 123456. Use this to verify ... — no amounts, no account.
// The code itself is never stored: `redacted_text` is what the database keeps.
const otp = {
  name: 'hnb_otp',
  parse(text) {
    const match = /^Your verification code is\s*([A-Za-z0-9-]+)/i.exec(text);
    if (!match) return null;
    return {
      bank: 'hnb',
      type: 'otp',
      kind: 'otp',
      account_masked: null,
      amount: null,
      direction: 'none',
      occurred_at: null,
      reference: null,
      redacted_text: text.replace(match[1], '[redacted]'),
    };
  },
};

// You received LKR 51,000 from PERERA A B   (no account, no balance, no timestamp)
const inboundTransferNotice = {
  name: 'hnb_inbound_transfer_notice',
  parse(text) {
    const match = /^You received LKR\s+([0-9,]+(?:\.\d+)?)\s+from\s+(.+?)(?:\s+OTP\b|\s+Do not share|$)/i.exec(text);
    if (!match) return null;
    return {
      bank: 'hnb',
      type: 'inbound_notice',
      kind: 'inbound_transfer_notice',
      account_masked: null,
      amount: parseAmount(match[1]),
      direction: 'credit',
      occurred_at: null,
      reference: null,
      payer: match[2].trim(),
    };
  },
};

module.exports = {
  id: 'hnb',
  matchers: [
    purchaseAlert, reversalAlert, declined, billPayment, mbTransferDebit,
    interestCredit, creditConfirmation, salaryCredit, merchantAdjustment, accountCredit,
    otp, inboundTransferNotice,
  ],
  normalizeMerchant,
};
