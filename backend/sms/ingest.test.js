const fs = require('fs');
const os = require('os');
const path = require('path');

const dbPath = path.join(os.tmpdir(), `suspense-sms-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch { /* fresh */ }
}
process.env.DB_PATH = dbPath;
process.env.SMS_INGEST_SECRET = 'test-secret';
process.env.MY_TELEGRAM_CHAT_ID = '';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../db');
const { ingestSmsText, resolveSmsReview } = require('./ingest');

function ingest(options) {
  return ingestSmsText({ guessCategory: null, notify: false, ...options });
}
const { mountSmsRoutes } = require('./http');
const { purchaseMintpay, purchaseUber, reversalUber, creditUber } = require('./samples');

function cents(amount) {
  return Math.round(Number(amount) * 100);
}

function smsExpenseRows(amountCents, merchant) {
  return db.getTransactions({ includeReversed: true, limit: 1000 }).filter((row) => (
    row.source === 'sms'
    && cents(row.amount) === amountCents
    && (merchant == null || row.merchant === merchant)
  ));
}

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  mountSmsRoutes(app);
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* already gone */ }
  }
});

describe('SMS ingest', () => {
  it('nets the Uber purchase, reversal alert, and credit confirmation into one reversed expense', async () => {
    const purchase = await ingest({ text: purchaseUber });
    const reversal = await ingest({ text: reversalUber });
    const credit = await ingest({ text: creditUber });

    assert.equal(purchase.action, 'inserted');
    assert.equal(purchase.category, 'Transport');
    assert.equal(purchase.transaction.source, 'sms');
    assert.equal(purchase.transaction.status, 'posted');
    assert.equal(purchase.transaction.type, 'expense');

    assert.equal(reversal.action, 'reversed');
    assert.equal(reversal.transaction_id, purchase.transaction_id);
    assert.equal(credit.action, 'linked_existing');
    assert.equal(credit.transaction_id, purchase.transaction_id);

    const rows = smsExpenseRows(20765, 'UBER');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, purchase.transaction_id);
    assert.equal(rows[0].status, 'reversed');
    assert.equal(rows[0].type, 'expense');
    assert.equal(rows[0].reference, 'ECOM REV/002117/ID:113007');

    const visible = db.getTransactions({ month: '2026-09', limit: 1000 });
    assert.equal(visible.some((row) => row.id === purchase.transaction_id), false);

    const links = db.listSmsReversalsForTransaction(purchase.transaction_id);
    assert.equal(links.length, 2);
    assert.ok(links.every((row) => row.status === 'linked' && row.transaction_id === purchase.transaction_id));

    const income = db.getTransactions({ includeReversed: true, type: 'income', limit: 1000 })
      .filter((row) => row.source === 'sms');
    assert.equal(income.length, 0);

    assert.equal(db.getSmsRaw(purchase.sms_raw_id).parser_match, 'hnb_purchase_alert');
    assert.equal(db.getSmsRaw(reversal.sms_raw_id).parsed, 1);
    assert.equal(db.getSmsRaw(credit.sms_raw_id).parser_match, 'hnb_credit_confirmation');
    assert.ok(db.getSmsRaw(credit.sms_raw_id).text.includes('\n'));

    const again = await ingest({ text: purchaseUber });
    assert.equal(again.action, 'duplicate');
    assert.equal(smsExpenseRows(20765, 'UBER').length, 1);
  });

  it('leaves both posted debits alone when a reversal matches more than one', async () => {
    const first = await ingest({
      text: 'SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):500.00 LKR,Av.Bal:100.00 LKR,Date:01.01.26,Time:10:00, Hot Line:0112462462',
    });
    const second = await ingest({
      text: 'SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):500.00 LKR,Av.Bal:90.00 LKR,Date:02.01.26,Time:11:00, Hot Line:0112462462',
    });
    const reversal = await ingest({
      text: 'TRANSACTION REVERSAL, Credit account:2080***2939,Location:UBER, LK,Amount:500.00 LKR,Av.Bal:200.00 LKR,Date:03.01.26,Time:08:00, Hot Line:0112462462',
    });

    assert.equal(reversal.action, 'needs_review');
    assert.equal(db.getTransactionById(first.transaction_id).status, 'posted');
    assert.equal(db.getTransactionById(second.transaction_id).status, 'posted');
    const ids = reversal.candidates.map((row) => row.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [first.transaction_id, second.transaction_id].sort((a, b) => a - b));
    assert.equal(smsExpenseRows(50000, 'UBER').length, 2);

    const resolved = resolveSmsReview(reversal.review_id, first.transaction_id);
    assert.equal(resolved.action, 'reversed');
    assert.equal(db.getTransactionById(first.transaction_id).status, 'reversed');
    assert.equal(db.getTransactionById(second.transaction_id).status, 'posted');
  });

  it('does not match a telegram row and logs an orphan reversal', async () => {
    const telegram = db.insertTransaction({
      amount: 333,
      type: 'expense',
      category: 'Uber',
      description: 'UBER',
      date: '2026-03-01',
      raw_message: '333 uber',
      source: 'telegram',
      merchant: 'UBER',
      account_masked: '2080***39',
      direction: 'debit',
      status: 'posted',
    });
    const result = await ingest({
      text: 'TRANSACTION REVERSAL, Credit account:2080***2939,Location:UBER, LK,Amount:333.00 LKR,Av.Bal:10.00 LKR,Date:04.03.26,Time:09:00, Hot Line:0112462462',
    });
    assert.equal(result.action, 'orphan_reversal');
    assert.equal(result.status, 'orphan_reversal');
    assert.equal(db.getTransactionById(telegram.id).status, 'posted');
    assert.equal(smsExpenseRows(33300, 'UBER').length, 0);
  });

  it('maps UBER EATS to Food and leaves unknown merchants pending', async () => {
    const eats = await ingest({
      text: 'SMS ALERT:INTERNET, Account:2080***2939,Location:UBER EATS, LK,Amount(Approx.):900.00 LKR,Av.Bal:100.00 LKR,Date:02.02.26,Time:12:00, Hot Line:0112462462',
    });
    assert.equal(eats.category, 'Food');
    const mintpay = await ingest({ text: purchaseMintpay });
    assert.equal(mintpay.action, 'inserted');
    assert.equal(mintpay.category, 'pending_category');
  });

  it('logs unmatched SMS and does not insert a transaction', async () => {
    const before = db.getTransactions({ includeReversed: true, limit: 1000 }).length;
    const result = await ingest({ text: 'this is not a bank sms' });
    assert.equal(result.action, 'unparsed');
    assert.equal(result.parsed, null);
    assert.equal(db.getSmsRaw(result.sms_raw_id).parsed, 0);
    assert.equal(db.getSmsRaw(result.sms_raw_id).parser_match, null);
    assert.equal(db.getTransactions({ includeReversed: true, limit: 1000 }).length, before);
  });

  it('ignores interest credits and transfers between accounts it has already seen', async () => {
    const before = db.getTransactions({ includeReversed: true, limit: 1000 }).length;
    const interestA = await ingest({
      text: 'LKR 103.49 credited to Ac No:20802XXXXX64 on 27/09/26 21:24:32 Reason:20802XXXXX64:Int.Pd: 31-08-2026 to 27-09-2026 Bal:LKR 97,140.60',
    });
    const interestB = await ingest({
      text: 'LKR 13.16 credited to Ac No:20802XXXXX39 on 27/09/26 21:40:31 Reason:20802XXXXX39:Int.Pd: 31-08-2026 to 27-09-2026 Bal:LKR 11,772.25',
    });
    assert.equal(interestA.action, 'ignored');
    assert.equal(interestA.ignore_reason, 'interest');
    assert.equal(interestB.action, 'ignored');
    assert.equal(db.isOwnAccount('2080***64'), true);
    assert.equal(db.isOwnAccount('2080***39'), true);

    const transfer = await ingest({
      text: 'LKR 5000.00 debited from Ac No:20802XXXXX39 on 28/09/26 10:00:00 Reason:20802XXXXX64 Bal:LKR 6,772.25',
    });
    assert.equal(transfer.action, 'ignored');
    assert.equal(transfer.ignore_reason, 'own_transfer');
    assert.equal(db.getTransactions({ includeReversed: true, limit: 1000 }).length, before);
  });

  it('ignores a debit whose payee is another of your HNB accounts', async () => {
    db.rememberOwnAccount('2080***77', 'hnb');
    const before = db.getTransactions({ includeReversed: true, limit: 1000 }).length;
    const result = await ingest({
      text: 'SMS ALERT:INTERNET, Account:2080***2939,Location:208099988877, LK,Amount(Approx.):5000.00 LKR,Av.Bal:1000.00 LKR,Date:28.09.26,Time:10:15, Hot Line:0112462462',
    });
    assert.equal(result.action, 'ignored');
    assert.equal(result.ignore_reason, 'own_transfer');
    assert.equal(db.getTransactions({ includeReversed: true, limit: 1000 }).length, before);

    db.rememberOwnAccount('2080***11', 'hnb');
    db.rememberOwnAccount('2080***22', 'hnb');
    const moved = await ingest({ text: 'Moved 208011111111 to 208022222222' });
    assert.equal(moved.action, 'ignored');
    assert.equal(moved.ignore_reason, 'own_transfer');
  });

  it('links a credit confirmation that arrives before the reversal alert', async () => {
    const purchase = await ingest({
      text: 'SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):88.00 LKR,Av.Bal:50.00 LKR,Date:10.08.26,Time:12:00, Hot Line:0112462462',
    });
    const credit = await ingest({
      text: 'LKR 88.00 credited to Ac No:20802XXXXX39 on 11/08/26 06:00:00 Reason:ECOM REV/000088/ID:880001 Bal:LKR 138.00',
    });
    const reversal = await ingest({
      text: 'TRANSACTION REVERSAL, Credit account:2080***2939,Location:UBER, LK,Amount:88.00 LKR,Av.Bal:138.00 LKR,Date:11.08.26,Time:06:01, Hot Line:0112462462',
    });
    assert.equal(credit.action, 'reversed');
    assert.equal(credit.transaction_id, purchase.transaction_id);
    assert.equal(reversal.action, 'linked_existing');
    assert.equal(reversal.transaction_id, purchase.transaction_id);
    assert.equal(smsExpenseRows(8800, 'UBER').length, 1);
    assert.equal(smsExpenseRows(8800, 'UBER')[0].status, 'reversed');
  });
});

describe('POST /api/sms-ingest', () => {
  it('rejects a missing or wrong secret and a body without text', async () => {
    const missing = await fetch(`${baseUrl}/api/sms-ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: purchaseUber }),
    });
    assert.equal(missing.status, 401);

    const wrong = await fetch(`${baseUrl}/api/sms-ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sms-secret': 'nope' },
      body: JSON.stringify({ text: purchaseUber }),
    });
    assert.equal(wrong.status, 401);

    const empty = await fetch(`${baseUrl}/api/sms-ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sms-secret': 'test-secret' },
      body: JSON.stringify({ text: '   ' }),
    });
    assert.equal(empty.status, 400);

    const previous = process.env.SMS_INGEST_SECRET;
    delete process.env.SMS_INGEST_SECRET;
    try {
      const unconfigured = await fetch(`${baseUrl}/api/sms-ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sms-secret': 'test-secret' },
        body: JSON.stringify({ text: 'hello' }),
      });
      assert.equal(unconfigured.status, 503);
    } finally {
      process.env.SMS_INGEST_SECRET = previous;
    }
  });

  it('ingests a raw SMS and echoes the category', async () => {
    const res = await fetch(`${baseUrl}/api/sms-ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sms-secret': 'test-secret' },
      body: JSON.stringify({
        text: 'SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):42.50 LKR,Av.Bal:10.00 LKR,Date:15.08.26,Time:09:15, Hot Line:0112462462',
        received_at: '2026-08-15T09:16:00+05:30',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.action, 'inserted');
    assert.equal(body.category, 'Transport');
    assert.equal(body.parsed.merchant, 'UBER');
    assert.equal(cents(body.parsed.amount), 4250);
    assert.equal(db.getSmsRaw(body.sms_raw_id).received_at, '2026-08-15T09:16:00+05:30');
  });
});
