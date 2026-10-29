require('./env')('skipped');

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { ingestSmsText } = require('../sms/ingest');
const { checkHeartbeat } = require('../sms/heartbeat');
const { setClock, resetClock } = require('../time');

after(() => { resetClock(); db.closeDb(); });

const conn = db.connection;
const OTP = 'Your verification code is 482913. Use this to verify your transfer with HNB Digital Banking';
const DECLINED = 'HNB SMS ALERT:Transaction for Amt(Approx.):  800.00 LKR declined due to insufficient funds.Please attempt when sufficient funds are available. Account: 2080***2939,Location: SHOP ONE, LK,Avl Bal: 100.00 LKR,Date: 03.11.26, Time:09:05,Hotline:0112462462';

beforeEach(() => {
  for (const t of ['sms_skipped', 'sms_raw', 'escalations', 'transactions']) conn.prepare(`DELETE FROM ${t}`).run();
  resetClock();
});

const skipped = (reason) => db.listSmsSkipped({ reason });
const escalations = (type) => conn.prepare('SELECT * FROM escalations WHERE type = ?').all(type);

describe('sms_skipped', () => {
  it('records an OTP as skipped and never stores the code', async () => {
    const result = await ingestSmsText({ text: OTP, notify: false });
    assert.equal(result.action, 'skipped');
    assert.equal(skipped('otp').length, 1);
    const raw = conn.prepare('SELECT text FROM sms_raw').all();
    assert.equal(raw.length, 1);
    assert.ok(!raw[0].text.includes('482913'));
    assert.equal(conn.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 0);
  });

  it('records a declined payment, books nothing, and escalates low balance once a day', async () => {
    await ingestSmsText({ text: DECLINED, notify: false });
    await ingestSmsText({ text: DECLINED, notify: false });
    assert.equal(skipped('declined').length, 2);
    assert.equal(conn.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 0);
    const lows = escalations('low_balance');
    assert.equal(lows.length, 1);
    assert.equal(JSON.parse(lows[0].evidence).account, '2080***39');
  });

  it('flags an SMS no parser understands as parser_failure', async () => {
    const result = await ingestSmsText({ text: 'LKR 10.00 withdrawn at ATM somewhere', notify: false });
    assert.equal(result.action, 'unparsed');
    assert.equal(skipped('unparsed').length, 1);
    assert.equal(escalations('parser_failure').length, 1);
  });
});

describe('heartbeat', () => {
  const day = 24 * 60 * 60 * 1000;
  const T0 = Date.parse('2026-11-30T00:00:00Z');

  function seedDaily(days, endMs) {
    const insert = conn.prepare('INSERT INTO sms_raw (text, received_at, parsed, created_at) VALUES (?, ?, 1, ?)');
    for (let i = 0; i < days; i++) {
      const at = new Date(endMs - i * day).toISOString();
      insert.run('x', at, at);
    }
  }

  it('stays quiet when SMS are recent', async () => {
    seedDaily(30, T0 - 1 * day);
    setClock(() => new Date(T0));
    assert.equal((await checkHeartbeat()).silent, false);
    assert.equal(escalations('heartbeat_missing').length, 0);
  });

  it('escalates once after more than 72h of silence on a busy account', async () => {
    seedDaily(60, T0 - 4 * day);
    setClock(() => new Date(T0));
    const first = await checkHeartbeat();
    const again = await checkHeartbeat();
    assert.equal(first.silent, true);
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(escalations('heartbeat_missing').length, 1);
  });

  it('does not escalate for an account that rarely gets SMS', async () => {
    const at = new Date(T0 - 10 * day).toISOString();
    conn.prepare('INSERT INTO sms_raw (text, received_at, parsed, created_at) VALUES (?, ?, 1, ?)').run('x', at, at);
    setClock(() => new Date(T0));
    const result = await checkHeartbeat();
    assert.equal(result.silent, false);
    assert.equal(result.reason, 'quiet_account');
  });

  it('respects HEARTBEAT_HOURS', async () => {
    seedDaily(60, T0 - 4 * day);
    setClock(() => new Date(T0));
    process.env.HEARTBEAT_HOURS = '200';
    try {
      assert.equal((await checkHeartbeat()).silent, false);
    } finally {
      delete process.env.HEARTBEAT_HOURS;
    }
  });
});
