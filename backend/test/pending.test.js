require('./env')('pending');

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const time = require('../time');
const db = require('../db').connection;

afterEach(() => time.resetClock());

function loadPending() {
  delete require.cache[require.resolve('../pending')];
  return require('../pending');
}

describe('clarification state in SQLite', () => {
  it('stores, reads and clears a pending follow-up', () => {
    const pending = loadPending();
    assert.equal(pending.getPending('telegram', 42), null);
    pending.setPending('telegram', 42, '450');
    assert.equal(pending.getPending('telegram', 42).text, '450');
    pending.clearPending('telegram', 42);
    assert.equal(pending.getPending('telegram', 42), null);
  });

  it('survives a module reload because it lives in the database', () => {
    loadPending().setPending('telegram', 7, 'coffee with');
    const row = db.prepare("SELECT text FROM pending_clarifications WHERE chat_id = '7'").get();
    assert.equal(row.text, 'coffee with');
    assert.equal(loadPending().getPending('telegram', 7).text, 'coffee with');
  });

  it('expires after 10 minutes', () => {
    const pending = loadPending();
    time.setClock(() => new Date('2026-10-26T10:00:00Z'));
    pending.setPending('whatsapp', '94771234567', 'petrol');

    time.setClock(() => new Date('2026-10-26T10:09:59Z'));
    assert.equal(pending.getPending('whatsapp', '94771234567').text, 'petrol');

    time.setClock(() => new Date('2026-10-26T10:10:00Z'));
    assert.equal(pending.getPending('whatsapp', '94771234567'), null);
    const left = db.prepare("SELECT COUNT(*) AS n FROM pending_clarifications WHERE chat_id = '94771234567'").get();
    assert.equal(left.n, 0, 'expired row is removed on read');
  });

  it('keeps channels and chats separate, and the latest write wins', () => {
    const pending = loadPending();
    pending.setPending('telegram', 1, 'a');
    pending.setPending('whatsapp', 1, 'b');
    pending.setPending('telegram', 1, 'c');
    assert.equal(pending.getPending('telegram', 1).text, 'c');
    assert.equal(pending.getPending('whatsapp', 1).text, 'b');
  });

  it('removes other expired rows when something new is written', () => {
    const pending = loadPending();
    time.setClock(() => new Date('2026-10-26T10:00:00Z'));
    pending.setPending('telegram', 'old', 'stale');
    time.setClock(() => new Date('2026-10-26T11:00:00Z'));
    pending.setPending('telegram', 'new', 'fresh');
    const old = db.prepare("SELECT COUNT(*) AS n FROM pending_clarifications WHERE chat_id = 'old'").get();
    assert.equal(old.n, 0);
  });
});
