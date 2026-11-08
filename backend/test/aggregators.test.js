require('./env')('aggregators');

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { app } = require('../index');
const { createKey } = require('../auth/keys');
const capture = require('../ledger/capture');
const mappings = require('../ledger/mappings');
const notify = require('../notify');
const { ingestSmsText } = require('../sms/ingest');
const { notifySmsExpense, handleSmsCallback } = require('../sms/telegramNotify');
const { purchaseMintpay, purchaseUber, realInternetMintpay } = require('../sms/samples');
const { isAggregatorMerchant } = require('../sms/aggregators');

let server;
let base;

const { before } = require('node:test');
before(async () => {
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(() => { db.closeDb(); resolve(); })));

const bearer = (key) => ({ authorization: `Bearer ${key}` });

function call(path, { method = 'GET', headers = {}, body } = {}) {
  const init = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetch(`${base}${path}`, init);
}

function questionsFor(txId) {
  return db.connection.prepare('SELECT * FROM questions WHERE subject = ? AND subject_id = ? ORDER BY id').all('txn', txId);
}

function fictionalSms({ location, amount, date, time = '10:00' }) {
  const [year, month, day] = date.split('-');
  const yy = year.slice(2);
  return `SMS ALERT:INTERNET, Account:1111***2299,Location:${location}, LK,Amount(Approx.):${amount} LKR,Av.Bal:1000.00 LKR,Date:${day}.${month}.${yy},Time:${time}, Hot Line:0112462462`;
}

describe('Mintpay is a payment aggregator', () => {
  it('recognises Mintpay variants and not ordinary shops', () => {
    assert.equal(isAggregatorMerchant('MINTPAY'), true);
    assert.equal(isAggregatorMerchant('MINTPAY PVT LTD'), true);
    assert.equal(isAggregatorMerchant('UBER'), false);
    assert.equal(isAggregatorMerchant('BARISTA - CARGILLS SQUARE'), false);
  });

  it('ignores a legacy Mintpay category_rule and does not call the model', async () => {
    db.connection.prepare(`
      INSERT OR REPLACE INTO category_rules (pattern, category, created_at)
      VALUES ('MINTPAY', 'Out w Friends', datetime('now'))
    `).run();
    db.connection.prepare(`
      INSERT OR REPLACE INTO merchant_mappings
        (merchant_pattern, description_pattern, category, approved_by, note, created_at)
      VALUES ('MINTPAY', '', 'Out w Friends', 'user', 'legacy', datetime('now'))
    `).run();
    assert.equal(db.matchCategoryRule('MINTPAY'), null);
    assert.equal(db.matchCategoryRule('MINTPAY PVT LTD'), null);
    assert.equal(mappings.matchMerchantMapping('MINTPAY', ''), null);
    assert.equal(mappings.upsertMapping({
      merchant_pattern: 'MINTPAY',
      category: 'Out w Friends',
    }), null);

    let guessed = 0;
    const result = await ingestSmsText({
      text: fictionalSms({ location: 'MINTPAY PVT LTD', amount: '23.28', date: '2026-11-08', time: '16:20' }),
      guessCategory: async () => {
        guessed += 1;
        return { confident: true, category: 'Out w Friends' };
      },
      notify: true,
      sendMessage: async () => { throw new Error('Telegram must not be called on the ledger channel'); },
    });
    assert.equal(guessed, 0);
    assert.equal(result.action, 'inserted');
    assert.equal(result.category, 'pending_category');
    assert.equal(result.category_via, 'aggregator');
    assert.equal(result.notify_reason, 'ledger_question');
    const row = db.getTransactionById(result.transaction_id);
    assert.equal(row.needs_review, 1);
    assert.equal(row.source, 'sms');
    assert.ok(db.getTransactions({ limit: 1000 }).some((tx) => tx.id === row.id), 'unknown aggregator charges stay in totals');
    const [question] = questionsFor(result.transaction_id);
    assert.ok(question);
    assert.match(question.prompt, /payment method, not the shop/);
    assert.match(question.prompt, /Pay Now or instalments/);
    const options = JSON.parse(question.options);
    assert.equal(options.kind, 'aggregator');
    assert.deepEqual(options.choices, ['Pay Now', 'Instalments']);
    assert.equal(options.choices.includes('Out w Friends'), false);
    const open = notify.listOpenEscalations().filter((e) => e.dedupe_key === `aggregator:${row.id}`);
    assert.equal(open.length, 1);
    assert.equal(open[0].type, 'aggregator_unplanned');
  });

  it('does not duplicate the question when the same SMS is ingested again', async () => {
    const first = await ingestSmsText({
      text: fictionalSms({ location: 'MINTPAY', amount: '18.50', date: '2026-11-08', time: '11:00' }),
      guessCategory: async () => ({ confident: true, category: 'Out w Friends' }),
    });
    const second = await ingestSmsText({
      text: fictionalSms({ location: 'MINTPAY', amount: '18.50', date: '2026-11-08', time: '11:00' }),
      guessCategory: async () => ({ confident: true, category: 'Out w Friends' }),
    });
    assert.equal(first.action, 'inserted');
    assert.equal(second.action, 'duplicate');
    assert.equal(second.transaction_id, first.transaction_id);
    assert.equal(questionsFor(first.transaction_id).length, 1);
  });

  it('does not teach a global Mintpay category from one answered charge', async () => {
    const first = await ingestSmsText({
      text: fictionalSms({ location: 'MINTPAY PVT LTD', amount: '31.00', date: '2026-11-08', time: '12:00' }),
      guessCategory: null,
    });
    const applied = capture.resolveAggregator({
      transaction_id: first.transaction_id,
      store: 'Northwind Cafe',
      payment: 'pay_now',
      category: 'Coffee Shop',
    });
    assert.equal(applied.action, 'resolved_aggregator');
    assert.equal(applied.taught_mapping, false);
    assert.equal(applied.transaction.description, 'Northwind Cafe');
    assert.equal(applied.transaction.note, 'Pay Now');
    assert.equal(applied.transaction.category, 'Coffee Shop');
    assert.equal(applied.transaction.needs_review, 0);
    assert.equal(db.matchCategoryRule('MINTPAY PVT LTD'), null);
    assert.equal(db.matchCategoryRule('MINTPAY'), null);
    assert.equal(mappings.matchMerchantMapping('MINTPAY PVT LTD', ''), null);
    const answered = questionsFor(first.transaction_id);
    assert.ok(answered.length >= 1);
    assert.ok(answered.every((q) => q.resolution));

    const next = await ingestSmsText({
      text: fictionalSms({ location: 'MINTPAY PVT LTD', amount: '14.25', date: '2026-11-08', time: '13:00' }),
      guessCategory: async () => ({ confident: true, category: 'Coffee Shop' }),
    });
    assert.equal(next.action, 'inserted');
    assert.notEqual(next.transaction_id, first.transaction_id);
    assert.equal(next.category, 'pending_category');
    assert.equal(next.category_via, 'aggregator');
    assert.equal(questionsFor(next.transaction_id).length, 1);
  });

  it('lets an agent key resolve one aggregator charge without writing a mapping', async () => {
    const created = await ingestSmsText({
      text: fictionalSms({ location: 'MINTPAY', amount: '9.90', date: '2026-11-08', time: '14:00' }),
      guessCategory: null,
    });
    const { key } = createKey({ name: 'agg-agent', scope: 'agent' });
    const denied = await call('/api/v1/agent/actions', {
      method: 'POST',
      headers: bearer(key),
      body: {
        type: 'upsert_mapping',
        reason: 'must not map mintpay',
        payload: { merchant_pattern: 'MINTPAY', category: 'Coffee Shop' },
      },
    });
    assert.equal(denied.status, 400);

    const res = await call('/api/v1/agent/actions', {
      method: 'POST',
      headers: bearer(key),
      body: {
        type: 'resolve_aggregator',
        reason: 'user named the shop for this Mintpay charge',
        payload: {
          transaction_id: created.transaction_id,
          store: 'Gizmo Beans',
          payment: 'instalments',
        },
      },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.action, 'resolved_aggregator');
    assert.equal(body.result.taught_mapping, false);
    const row = db.getTransactionById(created.transaction_id);
    assert.equal(row.description, 'Gizmo Beans');
    assert.equal(row.note, 'Instalments');
    assert.equal(row.category, 'pending_category');
    assert.equal(row.amount, 9.9);
    assert.equal(row.source, 'sms');
  });

  it('leaves ordinary merchants on the mapping/rule/LLM path', async () => {
    const uber = await ingestSmsText({
      text: purchaseUber.replace('207.65', '44.44'),
      guessCategory: async () => ({ confident: true, category: 'Groceries' }),
    });
    assert.equal(uber.category, 'Transport');
    assert.equal(uber.category_via, 'rule');

    let guessed = 0;
    const keells = await ingestSmsText({
      text: fictionalSms({ location: 'KEELLS NORTHWIND', amount: '55.00', date: '2026-11-08' }),
      guessCategory: async ({ merchant }) => {
        guessed += 1;
        assert.equal(merchant, 'KEELLS NORTHWIND');
        return { confident: true, category: 'Groceries' };
      },
    });
    assert.equal(guessed, 1);
    assert.equal(keells.category, 'Groceries');
    assert.equal(keells.category_via, 'llm');
    assert.equal(db.matchCategoryRule('KEELLS NORTHWIND'), 'Groceries');
  });

  it('does not write a Mintpay rule when Telegram categorises one charge', async () => {
    process.env.NOTIFY_CHANNEL = 'telegram';
    const sent = [];
    const result = await ingestSmsText({
      text: purchaseMintpay.replace('1722.00', '17.22'),
      guessCategory: async () => ({ confident: true, category: 'Out w Friends' }),
      notify: true,
      chatId: '42',
      sendMessage: async (_id, text, options) => {
        sent.push({ text, options });
        return { message_id: 701 };
      },
    });
    assert.equal(result.category, 'pending_category');
    assert.equal(result.notified, true);
    assert.match(sent[0].text, /payment method, not the shop/);
    const buttons = sent[0].options.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(buttons.includes(`s:a:${result.transaction_id}:pay_now`));
    assert.equal(buttons.some((data) => data.startsWith(`s:c:`)), false);

    db.updateSmsExpense(result.transaction_id, {
      category_prompt_options: JSON.stringify(['Out w Friends']),
    });
    const tx = db.getTransactionById(result.transaction_id);
    await handleSmsCallback({
      id: 'cb-agg',
      data: `s:c:${tx.id}:0`,
      message: { chat: { id: '42' }, message_id: tx.telegram_notify_message_id },
    }, {
      chatId: '42',
      sendMessage: async () => ({ message_id: 702 }),
      editMessageReplyMarkup: async () => {},
      answerCallbackQuery: async () => {},
    });
    assert.equal(db.getTransactionById(tx.id).category, 'Out w Friends');
    assert.equal(db.matchCategoryRule('MINTPAY'), null);

    process.env.NOTIFY_CHANNEL = 'ledger';
    const later = await ingestSmsText({
      text: realInternetMintpay.replace('2181.89', '21.81').replace('14:24', '15:24'),
      guessCategory: async () => ({ confident: true, category: 'Out w Friends' }),
    });
    assert.equal(later.category, 'pending_category');
    assert.equal(questionsFor(later.transaction_id).length, 1);
  });
});
