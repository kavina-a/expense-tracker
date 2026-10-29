require('./env')('fixtures');

// Generic parser check. Every sms/fixtures/<bank>/*.json that has a `messages`
// array is parsed and compared with each message's `expected_parse`. Adding a
// bank needs fixtures, not test code. Real fixtures hold personal data and are
// gitignored, so this skips cleanly where they are absent (set SMS_FIXTURES_DIR
// to point elsewhere).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseSms } = require('../sms/parsers');

const ROOT = process.env.SMS_FIXTURES_DIR || path.join(__dirname, '..', 'sms', 'fixtures');

function fixtureFiles() {
  if (!fs.existsSync(ROOT)) return [];
  const out = [];
  for (const bank of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!bank.isDirectory()) continue;
    for (const file of fs.readdirSync(path.join(ROOT, bank.name))) {
      if (file.endsWith('.json')) out.push(path.join(ROOT, bank.name, file));
    }
  }
  return out;
}

const files = fixtureFiles();

describe('bank SMS fixtures', { skip: files.length === 0 && 'no fixtures present' }, () => {
  it('match the recorded hashes (so nobody edits them by accident)', () => {
    const lock = path.join(__dirname, '..', 'sms', 'fixtures.sha256');
    if (!fs.existsSync(lock) || ROOT !== path.join(__dirname, '..', 'sms', 'fixtures')) return;
    for (const line of fs.readFileSync(lock, 'utf8').split('\n').filter(Boolean)) {
      const [hash, name] = line.split(/\s+/);
      const file = files.find((f) => f.endsWith(name)) || path.join(ROOT, 'hnb', name);
      if (!fs.existsSync(file)) continue;
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), hash, name);
    }
  });

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.messages)) continue;
    it(`parses every message in ${path.basename(file)}`, () => {
      for (const m of data.messages) {
        const e = m.expected_parse || {};
        const got = parseSms(m.sms);
        const where = `seq ${m.seq}`;
        assert.ok(got, `${where} did not parse`);
        assert.equal(got.kind, e.kind, `${where} kind`);
        if (e.amount != null) assert.equal(got.amount, e.amount, `${where} amount`);
        if (e.account) assert.equal(got.account_masked, e.account, `${where} account`);
        if (e.merchant) assert.equal(got.merchant, String(e.merchant).toUpperCase(), `${where} merchant`);
        if (e.reported_balance != null) assert.equal(got.balance_after, e.reported_balance, `${where} balance`);
        if (e.occurred_at) assert.equal(got.occurred_at, e.occurred_at.slice(0, 19), `${where} time`);
        if (e.direction && e.direction !== 'none') assert.equal(got.direction, e.direction, `${where} direction`);
      }
    });
  }
});
