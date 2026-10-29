require('./env')('replay');

// Replays the 62 real HNB messages (18-26 Oct 2026) through ingest and checks
// the recorded expectations. Skips where the private fixtures are absent.
// Each later phase extends the assertions here.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { ingestSmsText } = require('../sms/ingest');

const ROOT = process.env.SMS_FIXTURES_DIR || path.join(__dirname, '..', 'sms', 'fixtures');
const FILE = path.join(ROOT, 'hnb', 'timeline_2026-10-18_to_26.json');
const present = fs.existsSync(FILE);

after(() => db.closeDb());

describe('62-message HNB replay', { skip: !present && 'fixtures not present' }, () => {
  const timeline = present ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
  const conn = db.connection;
  const rawIdToSeq = new Map();
  const results = new Map();

  it('ingests every message without error', async () => {
    let lastAt = '2026-10-18T00:00:00+05:30';
    for (const m of timeline.messages) {
      const e = m.expected_parse;
      // Some messages carry no usable time (seq 13 says "14:2x"): reuse the last known one.
      let at = e.occurred_at || (e.received_at ? `${e.received_at}T12:00:00+05:30` : lastAt);
      if (Number.isNaN(Date.parse(at))) at = lastAt;
      lastAt = at;
      const result = await ingestSmsText({ text: m.sms, receivedAt: new Date(at).toISOString(), notify: false });
      rawIdToSeq.set(result.sms_raw_id, m.seq);
      results.set(m.seq, result);
    }
    assert.equal(results.size, 62);
  });

  const skippedSeqs = (reason) => db.listSmsSkipped({ reason, limit: 500 })
    .map((row) => rawIdToSeq.get(row.sms_raw_id)).sort((a, b) => a - b);

  it('skips the OTPs and stores no code', () => {
    assert.deepEqual(skippedSeqs('otp'), timeline.expected_end_state.skipped.otp);
    const rows = conn.prepare("SELECT text FROM sms_raw WHERE text LIKE '%verification code%'").all();
    assert.equal(rows.length, 4);
    for (const row of rows) assert.ok(!row.text.includes('123456'));
  });

  it('skips the declined payments and books nothing for them', () => {
    assert.deepEqual(skippedSeqs('declined'), timeline.expected_end_state.skipped.declined);
  });

  it('raises exactly one low-balance escalation per account per day', () => {
    const rows = conn.prepare("SELECT dedupe_key FROM escalations WHERE type = 'low_balance' ORDER BY id").all();
    // declined on 18, 21 (twice), 23 Oct -> three days
    assert.deepEqual(rows.map((r) => r.dedupe_key), [
      'low_balance:2080***39:2026-10-18',
      'low_balance:2080***39:2026-10-21',
      'low_balance:2080***39:2026-10-23',
    ]);
  });

  it('drops the second SMS of every reversal pair', () => {
    assert.deepEqual(skippedSeqs('duplicate_reversal'), timeline.expected_end_state.duplicate_reversal_sms_to_drop);
  });

  it('leaves nothing unparsed', () => {
    assert.deepEqual(skippedSeqs('unparsed'), []);
    assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM escalations WHERE type = 'parser_failure'").get().n, 0);
  });
});
