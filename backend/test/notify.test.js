require('./env')('notify');

const { describe, it, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const notify = require('../notify');
const { ingestSmsText } = require('../sms/ingest');
const { notifySmsExpense } = require('../sms/telegramNotify');
const { purchaseUber, purchaseMintpay } = require('../sms/samples');

after(() => db.closeDb());

afterEach(() => { process.env.NOTIFY_CHANNEL = 'ledger'; });

// Fails the test if anything tries to talk to Telegram.
const neverSend = async () => { throw new Error('Telegram must not be called on the ledger channel'); };

function questionsFor(txId) {
  return db.connection.prepare('SELECT * FROM questions WHERE subject = ? AND subject_id = ? ORDER BY id').all('txn', txId);
}

describe('NOTIFY_CHANNEL', () => {
  it('defaults to ledger, accepts telegram, and treats anything else as ledger', () => {
    delete process.env.NOTIFY_CHANNEL;
    assert.equal(notify.channel(), 'ledger');
    process.env.NOTIFY_CHANNEL = 'telegram';
    assert.equal(notify.channel(), 'telegram');
    process.env.NOTIFY_CHANNEL = ' TELEGRAM ';
    assert.equal(notify.channel(), 'telegram');
    process.env.NOTIFY_CHANNEL = 'carrier-pigeon';
    assert.equal(notify.channel(), 'ledger');
  });
});

describe('ledger channel: SMS expenses become questions', () => {
  it('asks for a category when none is known, and never touches Telegram', async () => {
    const result = await ingestSmsText({
      text: purchaseMintpay,
      guessCategory: null,
      chatId: '42',
      sendMessage: neverSend,
    });
    assert.equal(result.action, 'inserted');
    assert.equal(result.notified, false);
    assert.equal(result.notify_reason, 'ledger_question');

    const [question] = questionsFor(result.transaction_id);
    assert.ok(question, 'a question was written');
    assert.match(question.prompt, /What category is MINTPAY/);
    assert.equal(question.priority, 2);
    assert.equal(question.resolution, null);
    const options = JSON.parse(question.options);
    assert.equal(options.kind, 'category');
    assert.ok(options.choices.length > 0, 'offers the categories in use');
  });

  it('asks for a note when the category is already known', async () => {
    const result = await ingestSmsText({ text: purchaseUber, guessCategory: null, sendMessage: neverSend });
    assert.equal(result.action, 'inserted');
    assert.notEqual(result.category, 'pending_category');

    const [question] = questionsFor(result.transaction_id);
    assert.match(question.prompt, /filed under/);
    assert.equal(question.priority, 1);
    assert.equal(JSON.parse(question.options).kind, 'note');
  });

  it('is idempotent: notifying twice leaves one question', async () => {
    const result = await ingestSmsText({
      text: purchaseUber.replace('207.65', '311.20'),
      guessCategory: null,
      sendMessage: neverSend,
    });
    const tx = db.getTransactionById(result.transaction_id);
    await notifySmsExpense(tx, { sendMessage: neverSend });
    await notifySmsExpense(tx, { sendMessage: neverSend });
    assert.equal(questionsFor(tx.id).length, 1);
  });

  it('still respects muted merchants', async () => {
    db.muteMerchant('KEELLS SUPER');
    const result = await ingestSmsText({
      text: 'SMS ALERT:INTERNET, Account:2080***2939,Location:KEELLS SUPER, LK,Amount(Approx.):500.00 LKR,Av.Bal:100.00 LKR,Date:19.10.26,Time:10:00, Hot Line:0112462462',
      guessCategory: null,
      sendMessage: neverSend,
    });
    assert.equal(result.notify_reason, 'muted');
    assert.equal(questionsFor(result.transaction_id).length, 0);
  });

  it('writes no pending-category question for a transaction that is not from SMS', async () => {
    const tx = db.insertTransaction({
      amount: 10, type: 'expense', category: 'Other', date: '2026-10-26', source: 'telegram',
    });
    const result = await notifySmsExpense(tx, { sendMessage: neverSend });
    assert.equal(result.reason, 'not_sms');
    assert.equal(questionsFor(tx.id).length, 0);
  });
});

describe('telegram channel is unchanged', () => {
  it('sends the Telegram message and writes no question', async () => {
    process.env.NOTIFY_CHANNEL = 'telegram';
    const sent = [];
    const result = await ingestSmsText({
      text: purchaseUber.replace('207.65', '999.99'),
      guessCategory: null,
      chatId: '42',
      sendMessage: async (chatId, text, options) => { sent.push({ chatId, text, options }); return { message_id: 900 }; },
    });
    assert.equal(result.notified, true);
    assert.equal(result.notify_reason, 'sent');
    assert.equal(sent.length, 1);
    assert.equal(questionsFor(result.transaction_id).length, 0);
  });
});

describe('escalations', () => {
  it('records an escalation with its evidence, oldest first when listed', async () => {
    await notify.escalate({ type: 'balance_gap', severity: 'high', evidence: { summary: 'gap', amount: -106.56 }, dedupeKey: 'esc-a' });
    await notify.escalate({ type: 'low_balance', evidence: { summary: 'low' }, dedupeKey: 'esc-b' });
    const open = notify.listOpenEscalations().filter((e) => ['esc-a', 'esc-b'].includes(e.dedupe_key));
    assert.deepEqual(open.map((e) => e.type), ['balance_gap', 'low_balance']);
    assert.equal(open[0].evidence.amount, -106.56);
    assert.equal(open[0].severity, 'high');
    assert.equal(open[1].severity, 'medium');
  });

  it('does not duplicate when the same detector fires again', async () => {
    const first = await notify.escalate({ type: 'anomaly', evidence: { n: 1 }, dedupeKey: 'esc-dup' });
    const second = await notify.escalate({ type: 'anomaly', evidence: { n: 2 }, dedupeKey: 'esc-dup' });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.escalation.id, first.escalation.id);
    assert.equal(second.escalation.evidence.n, 1, 'keeps the original evidence');
  });

  it('rejects types and severities it does not know', async () => {
    await assert.rejects(notify.escalate({ type: 'made_up' }), /Unknown escalation type/);
    await assert.rejects(notify.escalate({ type: 'anomaly', severity: 'catastrophic' }), /Unknown severity/);
  });

  it('does not message Telegram on the ledger channel', async () => {
    await notify.escalate({ type: 'parser_failure', evidence: { summary: 'x' }, dedupeKey: 'esc-quiet' }, {
      chatId: '42',
      sendMessage: neverSend,
    });
  });

  it('pushes a message to Telegram on the telegram channel, once', async () => {
    process.env.NOTIFY_CHANNEL = 'telegram';
    const sent = [];
    const deps = { chatId: '42', sendMessage: async (chatId, text) => { sent.push({ chatId, text }); } };
    await notify.escalate({ type: 'heartbeat_missing', evidence: { summary: 'no SMS for 80h' }, dedupeKey: 'esc-tg' }, deps);
    await notify.escalate({ type: 'heartbeat_missing', evidence: { summary: 'no SMS for 80h' }, dedupeKey: 'esc-tg' }, deps);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /heartbeat missing: no SMS for 80h/);
  });
});

describe('questions', () => {
  it('validates subject and prompt, and dedupes by key', () => {
    assert.throws(() => notify.ask({ subject: 'nonsense', prompt: 'x' }), /Unknown question subject/);
    assert.throws(() => notify.ask({ subject: 'txn', prompt: '  ' }), /prompt is required/);
    const first = notify.ask({ subject: 'gap', prompt: 'What happened?', dedupeKey: 'q-dup' });
    const second = notify.ask({ subject: 'gap', prompt: 'What happened?', dedupeKey: 'q-dup' });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
  });

  it('lists open questions by priority, then age', () => {
    notify.ask({ subject: 'plan', prompt: 'low', priority: 0, dedupeKey: 'q-low' });
    notify.ask({ subject: 'plan', prompt: 'high', priority: 5, dedupeKey: 'q-high' });
    const mine = notify.listOpenQuestions().filter((q) => ['q-low', 'q-high'].includes(q.dedupe_key));
    assert.deepEqual(mine.map((q) => q.prompt), ['high', 'low']);
  });
});
