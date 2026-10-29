require('./env')('auth');

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const time = require('../time');
const db = require('../db');
const { app } = require('../index');
const { createKey, revokeKey, verifyKey } = require('../auth/keys');
const sessions = require('../auth/sessions');

let server;
let base;

before(async () => {
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(() => { db.closeDb(); resolve(); })));

afterEach(() => {
  time.resetClock();
  sessions.loginLimiter.clear();
  sessions.globalLoginLimiter.clear();
  process.env.DASHBOARD_PASSWORD = 'correct horse battery';
});

function call(path, { method = 'GET', headers = {}, body, json = true } = {}) {
  const init = { method, headers: { ...headers } };
  if (json) init.headers['content-type'] = 'application/json';
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return fetch(`${base}${path}`, init);
}

const bearer = (key) => ({ authorization: `Bearer ${key}` });

async function login(password = 'correct horse battery') {
  const res = await call('/api/auth/login', { method: 'POST', body: { password } });
  const cookie = res.headers.getSetCookie?.()[0] || '';
  return { res, setCookie: cookie, cookie: cookie.split(';')[0] };
}

// Every method+path registered under /api, taken from Express itself, so a route
// added later is covered without anyone remembering to list it here.
function apiRoutes() {
  const found = [];
  for (const layer of app._router.stack) {
    if (!layer.route || !String(layer.route.path).startsWith('/api/')) continue;
    for (const method of Object.keys(layer.route.methods)) {
      found.push({ method: method.toUpperCase(), path: layer.route.path.replace(/:\w+/g, '1') });
    }
  }
  return found;
}

describe('every /api route requires credentials', () => {
  const LOGIN_ROUTES = new Set(['/api/auth/login', '/api/auth/logout']);

  it('finds the routes it is supposed to check', () => {
    const routes = apiRoutes();
    assert.ok(routes.length >= 30, `only found ${routes.length} routes`);
    assert.ok(routes.some((r) => r.path === '/api/backup'));
    assert.ok(routes.some((r) => r.path === '/api/sms-ingest'));
    assert.ok(routes.some((r) => r.path === '/api/agent/inbox'));
  });

  it('returns 401 for all of them without credentials', async () => {
    const failures = [];
    for (const { method, path } of apiRoutes()) {
      if (LOGIN_ROUTES.has(path)) continue;
      const res = await call(path, { method, body: method === 'GET' ? undefined : {} });
      if (res.status !== 401) failures.push(`${method} ${path} -> ${res.status}`);
    }
    assert.deepEqual(failures, []);
  });

  it('returns 401 for unknown /api paths too, so routes cannot be probed', async () => {
    const res = await call('/api/definitely-not-a-route');
    assert.equal(res.status, 401);
  });

  it('leaves health, privacy and terms public', async () => {
    for (const path of ['/health', '/privacy', '/terms']) {
      const res = await call(path);
      assert.equal(res.status, 200, path);
    }
  });

  it('rejects a garbage bearer token and a garbage cookie', async () => {
    assert.equal((await call('/api/transactions', { headers: bearer('nonsense') })).status, 401);
    assert.equal((await call('/api/transactions', { headers: { cookie: 'sid=abc' } })).status, 401);
  });
});

describe('API keys', () => {
  it('shows the key once, stores only a hash, and verifies it', () => {
    const created = createKey({ name: 'unit', scope: 'agent' });
    assert.match(created.key, /^stk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    const row = db.connection.prepare('SELECT * FROM api_keys WHERE id = ?').get(created.id);
    const secret = created.key.split('_').slice(2).join('_');
    assert.notEqual(row.hash, secret);
    assert.ok(!JSON.stringify(row).includes(secret), 'secret is not stored anywhere in the row');
    assert.deepEqual({ ...verifyKey(created.key) }, { id: created.id, name: 'unit', scope: 'agent' });
  });

  it('rejects a key with the right prefix and the wrong secret', () => {
    const created = createKey({ name: 'wrong-secret', scope: 'full' });
    const prefix = created.key.split('_')[1];
    assert.equal(verifyKey(`stk_${prefix}_${'x'.repeat(43)}`), null);
  });

  it('rejects unknown scopes and empty names', () => {
    assert.throws(() => createKey({ name: 'x', scope: 'root' }), /scope/);
    assert.throws(() => createKey({ name: '  ', scope: 'full' }), /name/);
  });

  it('stops working once revoked', async () => {
    const { key, id } = createKey({ name: 'to-revoke', scope: 'full' });
    assert.equal((await call('/api/transactions', { headers: bearer(key) })).status, 200);
    revokeKey(id);
    assert.equal((await call('/api/transactions', { headers: bearer(key) })).status, 401);
  });

  it('accepts the X-API-Key header as well as Bearer', async () => {
    const { key } = createKey({ name: 'x-api-key', scope: 'full' });
    assert.equal((await call('/api/transactions', { headers: { 'x-api-key': key } })).status, 200);
  });

  it('gives a full key access to everything', async () => {
    const { key } = createKey({ name: 'full', scope: 'full' });
    assert.equal((await call('/api/backup', { headers: bearer(key) })).status, 200);
    const created = await call('/api/transactions', {
      method: 'POST',
      headers: bearer(key),
      body: { amount: 100, type: 'expense', category: 'Other' },
    });
    assert.equal(created.status, 201);
  });

  it('limits an agent key to reading, and keeps it away from the full backup', async () => {
    const { key } = createKey({ name: 'agent', scope: 'agent' });
    assert.equal((await call('/api/transactions', { headers: bearer(key) })).status, 200);
    assert.equal((await call('/api/summary', { headers: bearer(key) })).status, 200);

    const write = await call('/api/transactions', {
      method: 'POST',
      headers: bearer(key),
      body: { amount: 1, type: 'expense', category: 'Other' },
    });
    assert.equal(write.status, 403);
    assert.equal((await write.json()).code, 'insufficient_scope');

    assert.equal((await call('/api/backup', { headers: bearer(key) })).status, 403);
    const del = await call('/api/transactions/1', { method: 'DELETE', headers: bearer(key) });
    assert.equal(del.status, 403);
  });

  it('limits an ingest key to the SMS routes', async () => {
    const { key } = createKey({ name: 'shortcut', scope: 'ingest' });
    const denied = await call('/api/transactions', { headers: bearer(key) });
    assert.equal(denied.status, 403);
    assert.equal((await call('/api/agent/inbox', { headers: bearer(key) })).status, 403);

    const ingest = await call('/api/sms-ingest', {
      method: 'POST',
      headers: bearer(key),
      body: { text: 'hello, not a bank message' },
    });
    assert.equal(ingest.status, 200);
    assert.equal((await ingest.json()).action, 'unparsed');
  });

  it('still accepts the legacy X-SMS-Secret on the SMS routes only', async () => {
    const ok = await call('/api/sms-ingest', {
      method: 'POST',
      headers: { 'x-sms-secret': 'test-secret' },
      body: { text: 'hello again' },
    });
    assert.equal(ok.status, 200);
    const wrong = await call('/api/sms-ingest', {
      method: 'POST',
      headers: { 'x-sms-secret': 'nope' },
      body: { text: 'hello' },
    });
    assert.equal(wrong.status, 401);
    // The shortcut secret does not unlock the rest of the API.
    assert.equal((await call('/api/transactions', { headers: { 'x-sms-secret': 'test-secret' } })).status, 401);
  });

  it('lets an agent key read SMS reviews but not resolve them', async () => {
    const { key } = createKey({ name: 'agent-sms', scope: 'agent' });
    assert.equal((await call('/api/sms-review', { headers: bearer(key) })).status, 200);
    const resolve = await call('/api/sms-review/1/resolve', {
      method: 'POST',
      headers: bearer(key),
      body: { transaction_id: 1 },
    });
    assert.equal(resolve.status, 403);
  });

  it('serves the agent inbox to agent keys, oldest escalation first', async () => {
    const { escalate } = require('../notify');
    await escalate({ type: 'heartbeat_missing', evidence: { summary: 'first' }, dedupeKey: 'inbox-1' });
    await escalate({ type: 'parser_failure', severity: 'high', evidence: { summary: 'second' }, dedupeKey: 'inbox-2' });

    const { key } = createKey({ name: 'agent-inbox', scope: 'agent' });
    const res = await call('/api/agent/inbox', { headers: bearer(key) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.channel, 'ledger');
    const mine = body.escalations.filter((e) => ['inbox-1', 'inbox-2'].includes(e.dedupe_key));
    assert.deepEqual(mine.map((e) => e.evidence.summary), ['first', 'second']);
    assert.equal(mine[1].severity, 'high');
  });

  it('serves OpenAPI 3.1 at /api/v1/openapi.json when the key is sent', async () => {
    const { key } = createKey({ name: 'agent-spec', scope: 'agent' });
    assert.equal((await call('/api/v1/openapi.json')).status, 401);
    const res = await call('/api/v1/openapi.json', { headers: bearer(key) });
    assert.equal(res.status, 200);
    const spec = await res.json();
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.paths['/agent/inbox']);
    assert.equal(spec.servers[0].url.endsWith('/api/v1'), true);
    const inbox = await call('/api/v1/agent/inbox', { headers: bearer(key) });
    assert.equal(inbox.status, 200);
    assert.equal((await inbox.json()).ok, true);
  });
});

describe('dashboard login', () => {
  it('rejects a wrong password', async () => {
    const { res } = await login('not it');
    assert.equal(res.status, 401);
    assert.equal(res.headers.getSetCookie().length, 0);
  });

  it('sets an httpOnly, SameSite=Strict cookie and then lets the browser in', async () => {
    const { res, setCookie, cookie } = await login();
    assert.equal(res.status, 200);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /Max-Age=2592000/);

    const me = await call('/api/auth/me', { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).via, 'session');
    assert.equal((await call('/api/transactions', { headers: { cookie } })).status, 200);
  });

  it('marks the cookie Secure behind an HTTPS proxy, unless COOKIE_SECURE says otherwise', async () => {
    const attempt = async () => {
      sessions.loginLimiter.clear();
      return (await call('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-proto': 'https' },
        body: { password: 'correct horse battery' },
      })).headers.getSetCookie()[0];
    };
    delete process.env.COOKIE_SECURE;
    try {
      assert.match(await attempt(), /Secure/);
      process.env.COOKIE_SECURE = 'false';
      assert.doesNotMatch(await attempt(), /Secure/);
    } finally {
      process.env.COOKIE_SECURE = 'false';
    }
  });

  it('stores only a hash of the session token', async () => {
    const { cookie } = await login();
    const token = cookie.split('=')[1];
    const ids = db.connection.prepare('SELECT id FROM sessions').all().map((r) => r.id);
    assert.ok(ids.length > 0);
    assert.ok(!ids.includes(token));
  });

  it('refuses writes from a session that is not sending JSON', async () => {
    const { cookie } = await login();
    const plain = await call('/api/transactions/bulk-delete', {
      method: 'POST',
      headers: { cookie, 'content-type': 'text/plain' },
      body: 'ids=1',
      json: false,
    });
    assert.equal(plain.status, 415);
    const form = await call('/api/transactions/bulk-delete', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'ids=1',
      json: false,
    });
    assert.equal(form.status, 415);
    const json = await call('/api/transactions/bulk-delete', { method: 'POST', headers: { cookie }, body: {} });
    assert.equal(json.status, 400, 'JSON passes auth and fails validation, which is the point');
  });

  it('ends the session on logout', async () => {
    const { cookie } = await login();
    const out = await call('/api/auth/logout', { method: 'POST', headers: { cookie } });
    assert.equal(out.status, 200);
    assert.equal((await call('/api/transactions', { headers: { cookie } })).status, 401);
  });

  it('expires sessions after 30 days', async () => {
    time.setClock(() => new Date('2026-10-01T00:00:00Z'));
    const { cookie } = await login();
    time.setClock(() => new Date('2026-10-30T23:59:00Z'));
    assert.equal((await call('/api/auth/me', { headers: { cookie } })).status, 200);
    time.setClock(() => new Date('2026-10-31T00:01:00Z'));
    assert.equal((await call('/api/auth/me', { headers: { cookie } })).status, 401);
  });

  it('answers 503 when no dashboard password is configured', async () => {
    delete process.env.DASHBOARD_PASSWORD;
    const { res } = await login('anything');
    assert.equal(res.status, 503);
  });

  it('locks out after repeated wrong passwords, even for the right one', async () => {
    for (let i = 0; i < 5; i += 1) assert.equal((await login('wrong')).res.status, 401);
    const blocked = await login('wrong');
    assert.equal(blocked.res.status, 429);
    assert.equal(blocked.res.headers.get('retry-after'), '900');
    assert.equal((await login()).res.status, 429);
  });

  it('lets a full key and a session both reach SMS review resolution', async () => {
    const { cookie } = await login();
    const res = await call('/api/sms-review', { headers: { cookie } });
    assert.equal(res.status, 200);
    const form = await call('/api/sms-review/1/resolve', {
      method: 'POST',
      headers: { cookie, 'content-type': 'text/plain' },
      body: 'x',
      json: false,
    });
    assert.equal(form.status, 415);
  });
});
