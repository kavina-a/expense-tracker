require('./env')('seed');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const db = require('../db');
const { generateKey, seedEntry, parseSeeds } = require('../auth/keygen');
const { seedKeysFromEnv, verifyKey, listKeys, revokeKey, sha256Hex } = require('../auth/keys');

after(() => db.closeDb());

describe('key generation without a database', () => {
  it('produces a key whose hash matches its secret, and a seed entry', () => {
    const k = generateKey({ name: 'ledger', scope: 'agent' });
    assert.match(k.key, /^stk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    const secret = k.key.slice('stk_'.length + 8 + 1);
    assert.equal(sha256Hex(secret), k.hash);
    assert.equal(seedEntry(k), `ledger:agent:${k.prefix}:${k.hash}`);
    assert.ok(!seedEntry(k).includes(secret), 'the seed line never contains the secret');
  });

  it('rejects names that would break the seed format, and unknown scopes', () => {
    assert.throws(() => generateKey({ name: 'a,b', scope: 'full' }), /name may only/);
    assert.throws(() => generateKey({ name: 'a:b', scope: 'full' }), /name may only/);
    assert.throws(() => generateKey({ name: 'ok', scope: 'root' }), /scope/);
  });
});

describe('API_KEY_SEEDS', () => {
  const agent = generateKey({ name: 'ledger', scope: 'agent' });
  const ingest = generateKey({ name: 'shortcut', scope: 'ingest' });
  const raw = `${seedEntry(agent)},${seedEntry(ingest)}`;

  it('registers keys that then authenticate, storing only hashes', () => {
    const { added, problems } = seedKeysFromEnv(raw);
    assert.deepEqual(added, ['ledger', 'shortcut']);
    assert.deepEqual(problems, []);
    assert.equal(verifyKey(agent.key).scope, 'agent');
    assert.equal(verifyKey(ingest.key).scope, 'ingest');
    const stored = JSON.stringify(listKeys()) + JSON.stringify(db.connection.prepare('SELECT * FROM api_keys').all());
    assert.ok(!stored.includes(agent.key.slice(-43)), 'secret is nowhere in the database');
  });

  it('is idempotent across boots', () => {
    const before = listKeys().length;
    const { added } = seedKeysFromEnv(raw);
    assert.deepEqual(added, []);
    assert.equal(listKeys().length, before);
  });

  it('keeps a revoked key revoked after the next boot', () => {
    const row = listKeys().find((k) => k.prefix === agent.prefix);
    revokeKey(row.id);
    seedKeysFromEnv(raw);
    assert.equal(verifyKey(agent.key), null);
  });

  it('skips malformed entries without throwing', () => {
    const good = generateKey({ name: 'good', scope: 'full' });
    const { entries, problems } = parseSeeds(`junk,x:y:z:w,${seedEntry(good)},ledger:agent:zzzzzzzz:${'0'.repeat(64)}`);
    assert.deepEqual(entries.map((e) => e.name), ['good']);
    assert.equal(problems.length, 3);
    assert.doesNotThrow(() => seedKeysFromEnv('totally:not:valid'));
  });

  it('ignores an empty or missing value', () => {
    assert.deepEqual(seedKeysFromEnv(''), { added: [], problems: [] });
    assert.deepEqual(seedKeysFromEnv(undefined), { added: [], problems: [] });
  });
});

describe('npm run key:generate', () => {
  it('prints a key pair and a seed line the server accepts, without a database', () => {
    const out = execFileSync(process.execPath, ['scripts/key-generate.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DB_PATH: '/nonexistent-dir-should-not-be-touched/x.db' },
      encoding: 'utf8',
    });
    const keys = [...out.matchAll(/(stk_[0-9a-f]{8}_[A-Za-z0-9_-]{43})/g)].map((m) => m[1]);
    const seedLine = out.split('\n').find((l) => /^\s+ledger:agent:/.test(l)).trim();
    assert.equal(keys.length, 2);
    assert.ok(!seedLine.includes(keys[0].slice(-43)), 'seed line has no secret');
    const { added } = seedKeysFromEnv(seedLine);
    assert.deepEqual(added, ['ledger', 'shortcut']);
    assert.equal(verifyKey(keys[0]).scope, 'agent');
    assert.equal(verifyKey(keys[1]).scope, 'ingest');
  });
});
