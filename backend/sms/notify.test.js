const fs = require('fs');
const os = require('os');
const path = require('path');

const dbPath = path.join(os.tmpdir(), `suspense-sms-notify-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch { /* fresh */ }
}
process.env.DB_PATH = dbPath;
process.env.SMS_INGEST_SECRET = 'test-secret';
process.env.MY_TELEGRAM_CHAT_ID = '';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { ingestSmsText } = require('./ingest');
const { interpretCategoryGuess } = require('./categorize');
const { handleSmsCallback, handleSmsTextReply } = require('./telegramNotify');

function purchase({ merchant, amount, time }) {
  return `SMS ALERT:INTERNET, Account:2080***2939,Location:${merchant}, LK,Amount(Approx.):${amount} LKR,Av.Bal:15184.20 LKR,Date:25.09.26,Time:${time}, Hot Line:0112462462`;
}

function recorder() {
  const sent = [];
  let nextId = 500;
  const sendMessage = async (_chatId, text, options) => {
    const message_id = nextId;
    nextId += 1;
    sent.push({ message_id, text, options });
    return { message_id };
  };
  return {
    sent,
    deps: {
      chatId: '42',
      sendMessage,
      editMessageReplyMarkup: async () => {},
      answerCallbackQuery: async () => {},
    },
  };
}

function mutePrompts(sent) {
  return sent.filter((message) => message.text.startsWith('Mute note-prompts'));
}

function callback(data, tx) {
  return {
    id: `cb-${data}`,
    data,
    message: { chat: { id: '42' }, message_id: tx.telegram_notify_message_id },
  };
}

after(() => {
  db.closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* gone */ }
  }
});

describe('category guess interpretation', () => {
  const categories = ['Groceries', 'Transport'];

  it('accepts a listed name and rejects unsure or invented names', () => {
    assert.deepEqual(
      interpretCategoryGuess('{"category":"groceries"}', categories),
      { confident: true, category: 'Groceries' },
    );
    assert.deepEqual(
      interpretCategoryGuess('{"category":"unsure"}', categories),
      { confident: false, category: null },
    );
    assert.deepEqual(
      interpretCategoryGuess('{"category":"Pets"}', categories),
      { confident: false, category: null },
    );
  });
});

describe('SMS category resolution and Telegram notes', () => {
  it('does not call the guesser when a category rule already matches', async () => {
    const { deps } = recorder();
    let calls = 0;
    const result = await ingestSmsText({
      text: purchase({ merchant: 'UBER', amount: '207.65', time: '18:54' }),
      guessCategory: async () => { calls += 1; return { confident: true, category: 'Groceries' }; },
      notify: true,
      ...deps,
    });
    assert.equal(calls, 0);
    assert.equal(result.category, 'Transport');
    assert.equal(result.category_via, 'rule');
    assert.equal(result.notified, true);
    const row = db.getTransactionById(result.transaction_id);
    assert.equal(row.category, 'Transport');
    assert.ok(row.telegram_notify_message_id);
  });

  it('sends a note prompt even when the category is already resolved', async () => {
    const { sent, deps } = recorder();
    const result = await ingestSmsText({
      text: purchase({ merchant: 'UBER', amount: '80.00', time: '09:01' }),
      guessCategory: null,
      notify: true,
      ...deps,
    });
    assert.equal(result.category, 'Transport');
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /UBER/);
    assert.match(sent[0].text, /Transport/);
    assert.doesNotMatch(sent[0].text, /What category/);
    const buttons = sent[0].options.reply_markup.inline_keyboard.flat();
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].text, '👍 No note needed');
    assert.equal(buttons[0].callback_data, `s:n:${result.transaction_id}`);
  });

  it('auto-applies a high-confidence guess and remembers the merchant', async () => {
    const { deps } = recorder();
    let calls = 0;
    const guess = async ({ merchant, categories }) => {
      calls += 1;
      assert.equal(merchant, 'KEELLS');
      assert.ok(categories.includes('Groceries'));
      return { confident: true, category: 'groceries' };
    };
    const first = await ingestSmsText({
      text: purchase({ merchant: 'KEELLS', amount: '1500.00', time: '11:01' }),
      guessCategory: guess,
      notify: true,
      ...deps,
    });
    assert.equal(calls, 1);
    assert.equal(first.category, 'Groceries');
    assert.equal(first.category_via, 'llm');
    assert.equal(db.matchCategoryRule('KEELLS'), 'Groceries');

    const second = await ingestSmsText({
      text: purchase({ merchant: 'KEELLS', amount: '900.00', time: '11:02' }),
      guessCategory: guess,
      notify: false,
    });
    assert.equal(calls, 1);
    assert.equal(second.category, 'Groceries');
    assert.equal(second.category_via, 'rule');
  });

  it('leaves a low-confidence guess pending and does not write a rule', async () => {
    const { sent, deps } = recorder();
    const result = await ingestSmsText({
      text: purchase({ merchant: 'CARGILLS', amount: '640.00', time: '12:01' }),
      guessCategory: async () => ({ confident: true, category: 'Not A Real Category' }),
      notify: true,
      ...deps,
    });
    assert.equal(result.category, 'pending_category');
    assert.equal(result.category_via, 'pending');
    assert.equal(db.matchCategoryRule('CARGILLS'), null);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /What category is this/);
    const data = sent[0].options.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
    assert.ok(data.some((value) => value.startsWith(`s:c:${result.transaction_id}:`)));
    assert.ok(data.includes(`s:o:${result.transaction_id}`));
    assert.ok(data.includes(`s:u:${result.transaction_id}`));
    assert.ok(data.includes(`s:n:${result.transaction_id}`));
  });

  it('marks an expense reviewed on the no-note button without writing a note', async () => {
    const { deps } = recorder();
    const result = await ingestSmsText({
      text: purchase({ merchant: 'SPAR', amount: '220.00', time: '13:01' }),
      guessCategory: null,
      notify: true,
      ...deps,
    });
    const tx = db.getTransactionById(result.transaction_id);
    await handleSmsCallback(callback(`s:n:${tx.id}`, tx), deps);
    const updated = db.getTransactionById(tx.id);
    assert.equal(updated.note_reviewed, 1);
    assert.equal(updated.note, null);
  });

  it('attaches a reply to the expense that owns the message id', async () => {
    const box = recorder();
    const older = await ingestSmsText({
      text: purchase({ merchant: 'BARISTA', amount: '950.00', time: '14:01' }),
      guessCategory: null,
      notify: true,
      ...box.deps,
    });
    const newer = await ingestSmsText({
      text: purchase({ merchant: 'BARISTA', amount: '450.00', time: '14:02' }),
      guessCategory: null,
      notify: true,
      ...box.deps,
    });
    const first = db.getTransactionById(older.transaction_id);
    const second = db.getTransactionById(newer.transaction_id);
    assert.notEqual(first.telegram_notify_message_id, second.telegram_notify_message_id);

    const handled = await handleSmsTextReply({
      text: 'Dinemore with Kissie',
      chat: { id: '42' },
      reply_to_message: { message_id: first.telegram_notify_message_id },
    }, box.deps);
    assert.equal(handled.action, 'note');
    assert.equal(db.getTransactionById(first.id).note, 'Dinemore with Kissie');
    assert.equal(db.getTransactionById(second.id).note, null);

    const missed = await handleSmsTextReply({
      text: '50 coffee',
      chat: { id: '42' },
      reply_to_message: { message_id: 999999 },
    }, box.deps);
    assert.equal(missed, false);
  });

  it('asks to mute after three explicit no-note taps, then honors mute or a decline', async () => {
    const muted = recorder();
    let guesses = 0;
    const guess = async () => {
      guesses += 1;
      return { confident: true, category: 'Groceries' };
    };
    const ids = [];
    for (const [amount, time] of [['10.00', '15:01'], ['11.00', '15:02'], ['12.00', '15:03']]) {
      const result = await ingestSmsText({
        text: purchase({ merchant: 'FOODCITY', amount, time }),
        guessCategory: guess,
        notify: true,
        ...muted.deps,
      });
      ids.push(result.transaction_id);
      await handleSmsCallback(callback(`s:n:${result.transaction_id}`, db.getTransactionById(result.transaction_id)), muted.deps);
    }
    assert.equal(guesses, 1);
    assert.equal(mutePrompts(muted.sent).length, 1);
    assert.match(mutePrompts(muted.sent)[0].text, /FOODCITY/);

    const third = db.getTransactionById(ids[2]);
    await handleSmsCallback(callback(`s:n:${third.id}`, third), muted.deps);
    assert.equal(mutePrompts(muted.sent).length, 1);

    await handleSmsCallback(callback(`s:m:${third.id}:1`, third), muted.deps);
    assert.equal(db.isMerchantMuted('FOODCITY'), true);

    const before = muted.sent.length;
    const later = await ingestSmsText({
      text: purchase({ merchant: 'FOODCITY', amount: '13.00', time: '15:04' }),
      guessCategory: guess,
      notify: true,
      ...muted.deps,
    });
    assert.equal(later.notified, false);
    assert.equal(later.category, 'Groceries');
    assert.equal(guesses, 1);
    assert.equal(muted.sent.length, before);

    const declined = recorder();
    const declinedIds = [];
    async function tapLaugfs(amount, time) {
      const result = await ingestSmsText({
        text: purchase({ merchant: 'LAUGFS', amount, time }),
        guessCategory: null,
        notify: true,
        ...declined.deps,
      });
      declinedIds.push(result.transaction_id);
      const tx = db.getTransactionById(result.transaction_id);
      await handleSmsCallback(callback(`s:n:${tx.id}`, tx), declined.deps);
    }

    await tapLaugfs('20.00', '16:01');
    await tapLaugfs('21.00', '16:02');
    await tapLaugfs('22.00', '16:03');
    assert.equal(mutePrompts(declined.sent).length, 1);
    await handleSmsCallback(
      callback(`s:m:${declinedIds[2]}:0`, db.getTransactionById(declinedIds[2])),
      declined.deps,
    );

    await tapLaugfs('23.00', '16:04');
    assert.equal(mutePrompts(declined.sent).length, 1);
    await tapLaugfs('24.00', '16:05');
    assert.equal(mutePrompts(declined.sent).length, 1);
    await tapLaugfs('25.00', '16:06');
    assert.equal(mutePrompts(declined.sent).length, 2);
    assert.equal(db.isMerchantMuted('LAUGFS'), false);
  });

  it('does not offer a mute when one of the last three was only ignored', async () => {
    const { sent, deps } = recorder();
    const ids = [];
    for (const [amount, time] of [['30.00', '17:01'], ['31.00', '17:02'], ['32.00', '17:03']]) {
      const result = await ingestSmsText({
        text: purchase({ merchant: 'DIALOG', amount, time }),
        guessCategory: null,
        notify: true,
        ...deps,
      });
      ids.push(result.transaction_id);
    }
    await handleSmsCallback(callback(`s:n:${ids[0]}`, db.getTransactionById(ids[0])), deps);
    await handleSmsCallback(callback(`s:n:${ids[2]}`, db.getTransactionById(ids[2])), deps);
    assert.equal(mutePrompts(sent).length, 0);
  });

  it('stores a typed category from Other and a button category as a rule, not a note', async () => {
    const { sent, deps } = recorder();
    const pending = await ingestSmsText({
      text: purchase({ merchant: 'ARPICO', amount: '2100.00', time: '18:01' }),
      guessCategory: async () => ({ confident: false, category: null }),
      notify: true,
      ...deps,
    });
    const tx = db.getTransactionById(pending.transaction_id);
    const options = JSON.parse(tx.category_prompt_options);
    const index = options.indexOf('Groceries');
    assert.ok(index >= 0);

    await handleSmsCallback(callback(`s:c:${tx.id}:${index}`, tx), deps);
    const categorized = db.getTransactionById(tx.id);
    assert.equal(categorized.category, 'Groceries');
    assert.equal(categorized.note, null);
    assert.equal(db.matchCategoryRule('ARPICO'), 'Groceries');

    const other = await ingestSmsText({
      text: purchase({ merchant: 'PETS VET', amount: '3500.00', time: '18:02' }),
      guessCategory: async () => ({ confident: false, category: null }),
      notify: true,
      ...deps,
    });
    const otherTx = db.getTransactionById(other.transaction_id);
    await handleSmsCallback(callback(`s:o:${otherTx.id}`, otherTx), deps);
    const waiting = db.getTransactionById(otherTx.id);
    assert.equal(waiting.category_reply_pending, 1);
    assert.equal(waiting.category, 'pending_category');

    const prompt = sent.find((message) => message.text.includes('category name for PETS VET'));
    const handled = await handleSmsTextReply({
      text: 'Vet',
      chat: { id: '42' },
      reply_to_message: { message_id: prompt.message_id },
    }, deps);
    assert.equal(handled.action, 'category_text');
    const named = db.getTransactionById(otherTx.id);
    assert.equal(named.category, 'Vet');
    assert.equal(named.note, null);
    assert.equal(named.category_reply_pending, 0);
    assert.equal(db.matchCategoryRule('PETS VET'), 'Vet');
  });
});
