require('./env')('capture');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { app } = require('../index');
const { createKey } = require('../auth/keys');
const capture = require('../ledger/capture');
const mappings = require('../ledger/mappings');
const { ingestSmsText } = require('../sms/ingest');

let server;
let base;

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

function fictionalSms({ location, amount, date, time = '10:00' }) {
  const [year, month, day] = date.split('-');
  const yy = year.slice(2);
  return `SMS ALERT:INTERNET, Account:1111***2299,Location:${location}, LK,Amount(Approx.):${amount} LKR,Av.Bal:1000.00 LKR,Date:${day}.${month}.${yy},Time:${time}, Hot Line:0112462462`;
}

describe('user-approved merchant mappings', () => {
  it('maps Cloudflare domain/Taggy, Fashn.ai and Claude, but not a plain Cloudflare charge', () => {
    assert.equal(mappings.matchMerchantMapping('CLOUDFLARE', 'Workers plan'), null);
    assert.equal(mappings.matchMerchantMapping('CLOUDFLARE', 'Cloudflare domain renewal'), null);
    assert.equal(mappings.matchMerchantMapping('CLOUDFLARE', 'Taggy hosting'), null);
    assert.equal(mappings.matchMerchantMapping('CLOUDFLARE', 'Cloudflare domain for Taggy').category, 'Taggy');
    assert.equal(mappings.matchMerchantMapping('FASHN.AI', '').category, 'Modelsnapper');
    assert.equal(mappings.matchMerchantMapping('CLAUDE', 'Claude payment').category, 'AI Tools');
  });

  it('lets SMS ingest use those mappings for fictional merchants', async () => {
    const fashn = await ingestSmsText({
      text: fictionalSms({ location: 'FASHN.AI', amount: '11.11', date: '2026-10-02' }),
      guessCategory: null,
    });
    assert.equal(fashn.action, 'inserted');
    assert.equal(fashn.category, 'Modelsnapper');

    const cloud = await ingestSmsText({
      text: fictionalSms({ location: 'CLOUDFLARE', amount: '22.22', date: '2026-10-03' }),
      guessCategory: null,
    });
    assert.equal(cloud.action, 'inserted');
    assert.equal(cloud.category, 'pending_category');
  });
});

describe('duplicate-safe capture', () => {
  it('creates Taggy/Modelsnapper if asked, and aliases AI expenses to AI Tools', () => {
    const taggy = capture.ensureCategoryAction({ name: 'Taggy', type: 'expense' });
    assert.equal(taggy.action, 'existing');
    assert.equal(taggy.category.name, 'Taggy');
    const gizmo = capture.ensureCategoryAction({ name: 'Gizmo', type: 'expense' });
    assert.equal(gizmo.action, 'created');
    const aliased = capture.ensureCategoryAction({ name: 'AI expenses' });
    assert.equal(aliased.action, 'existing');
    assert.equal(aliased.category.name, 'AI Tools');
    assert.equal(aliased.aliased, true);
  });

  it('inserts when nothing matches and leaves account unassigned', () => {
    const created = capture.ensureCategoryAction({ name: 'Northwind', type: 'expense' });
    assert.ok(['created', 'existing'].includes(created.action));
    const result = capture.captureExpense({
      date: '2026-10-08',
      amount: 12.34,
      merchant: 'ACME CLOUD',
      description: 'Acme Cloud domain for Northwind',
      category: 'Northwind',
      client_key: 'test-northwind-domain',
    });
    assert.equal(result.action, 'inserted');
    assert.equal(result.transaction.account_masked, null);
    assert.equal(result.transaction.account_assigned, false);
    assert.equal(result.transaction.occurred_at, null);
    assert.equal(result.transaction.source, 'ledger');
    assert.equal(result.transaction.category, 'Northwind');
  });

  it('enriches a unique SMS match instead of inserting a second expense', async () => {
    const sms = await ingestSmsText({
      text: fictionalSms({ location: 'BRAINBOX', amount: '90.00', date: '2026-10-07' }),
      guessCategory: null,
    });
    assert.equal(sms.action, 'inserted');
    const smsId = sms.transaction_id;

    const result = capture.captureExpense({
      date: '2026-10-07',
      amount: 90,
      merchant: 'BRAINBOX',
      description: 'Brainbox payment',
      category: 'AI expenses',
      client_key: 'test-brainbox',
    });
    assert.equal(result.action, 'enriched');
    assert.equal(result.transaction_id, smsId);
    assert.equal(result.transaction.category, 'AI Tools');
    assert.equal(result.transaction.source, 'sms');
    assert.equal(result.transaction.account_assigned, true);
    const count = db.connection.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE date = '2026-10-07' AND ROUND(amount * 100) = 9000"
    ).get().n;
    assert.equal(count, 1);
  });

  it('preserves an existing category when capture omits one', async () => {
    const sms = await ingestSmsText({
      text: fictionalSms({ location: 'TUNES', amount: '1.23', date: '2026-10-27' }),
      guessCategory: async () => ({ confident: true, category: 'Other' }),
    });
    assert.equal(sms.category, 'Other');
    const result = capture.captureExpense({
      date: '2026-10-27',
      amount: 1.23,
      merchant: 'TUNES',
      description: 'Tunes playback',
      client_key: 'test-tunes',
    });
    assert.equal(result.action, 'enriched');
    assert.equal(result.transaction.category, 'Other');
  });

  it('inserts unclassified pending when there is no match and no category', () => {
    const result = capture.captureExpense({
      date: '2026-10-27',
      amount: 4.56,
      merchant: 'TUNES PLUS',
      description: 'Tunes extra',
      client_key: 'test-tunes-new',
    });
    assert.equal(result.action, 'inserted');
    assert.equal(result.transaction.category, 'pending_category');
  });

  it('returns needs_review when two posted expenses share the date and amount', () => {
    db.insertTransaction({
      amount: 56.78, type: 'expense', category: 'Other', date: '2026-10-28',
      merchant: 'WIDGET.AI', source: 'sms', status: 'posted',
    });
    db.insertTransaction({
      amount: 56.78, type: 'expense', category: 'Other', date: '2026-10-28',
      merchant: 'WIDGET.AI', source: 'sms', status: 'posted',
    });
    const result = capture.captureExpense({
      date: '2026-10-28',
      amount: 56.78,
      merchant: 'WIDGET.AI',
      description: 'Widget.ai for Gizmo',
      category: 'Gizmo',
      client_key: 'test-gizmo-ambiguous',
    });
    assert.equal(result.action, 'needs_review');
    assert.equal(result.transaction_id, null);
    assert.equal(result.candidates.length, 2);
    const count = db.connection.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE date = '2026-10-28' AND ROUND(amount * 100) = 5678"
    ).get().n;
    assert.equal(count, 2);
  });

  it('replays the same capture without inserting again', () => {
    const first = capture.captureExpense({
      date: '2026-10-11',
      amount: 7.77,
      merchant: 'ACME CLOUD',
      description: 'Acme Cloud domain for Northwind',
      category: 'Northwind',
      client_key: 'test-replay',
    });
    const second = capture.captureExpense({
      date: '2026-10-11',
      amount: 7.77,
      merchant: 'ACME CLOUD',
      description: 'Acme Cloud domain for Northwind',
      category: 'Northwind',
      client_key: 'test-replay',
    });
    assert.equal(first.action, 'inserted');
    assert.equal(second.action, 'replayed');
    assert.equal(second.transaction_id, first.transaction_id);
  });

  it('links a later fictional SMS onto a ledger capture instead of duplicating', async () => {
    const logged = capture.captureExpense({
      date: '2026-10-12',
      amount: 33.33,
      merchant: 'FASHN.AI',
      description: 'Fashn.ai for Modelsnapper',
      category: 'Modelsnapper',
      client_key: 'test-fashn-first',
    });
    assert.equal(logged.action, 'inserted');
    assert.equal(logged.transaction.account_assigned, false);

    const sms = await ingestSmsText({
      text: fictionalSms({ location: 'FASHN.AI', amount: '33.33', date: '2026-10-12' }),
      guessCategory: null,
    });
    assert.equal(sms.action, 'linked_capture');
    assert.equal(sms.transaction_id, logged.transaction_id);
    assert.equal(sms.transaction.category, 'Modelsnapper');
    assert.equal(sms.transaction.source, 'sms');
    assert.ok(sms.transaction.account_masked, 'SMS supplies the account; capture must not invent one');
  });

  it('does not invent a time of day or a cash/card account', () => {
    const result = capture.captureExpense({
      date: '2026-10-13',
      amount: 8.08,
      merchant: 'CLAUDE',
      description: 'Claude payment',
      category: 'AI Tools',
      client_key: 'test-claude',
      occurred_at: '2026-10-13T22:11:00+05:30',
      account: 'cash',
    });
    assert.equal(result.transaction.occurred_at, null);
    assert.equal(result.transaction.account_masked, null);
  });
});

describe('Ledger v1 HTTP', () => {
  it('documents the new paths in OpenAPI and serves them to an agent key', async () => {
    const { key } = createKey({ name: 'capture-spec', scope: 'agent' });
    const specRes = await call('/api/v1/openapi.json', { headers: bearer(key) });
    assert.equal(specRes.status, 200);
    const spec = await specRes.json();
    for (const path of [
      '/agent/inbox',
      '/transactions',
      '/transactions/{id}',
      '/categories',
      '/merchant-mappings',
      '/agent/actions',
    ]) {
      assert.ok(spec.paths[path], path);
    }
    assert.equal(spec.info.version, '1.2.0');
    assert.ok(spec.paths['/agent/actions'].post);
    assert.ok(spec.paths['/agent/actions'].get);
  });

  it('lets an agent key read a date range and categories, and write through actions', async () => {
    const { key } = createKey({ name: 'capture-agent', scope: 'agent' });
    const tx = await call('/api/v1/transactions?from=2026-10-01&to=2026-10-31', { headers: bearer(key) });
    assert.equal(tx.status, 200);
    const body = await tx.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.transactions));

    const cats = await call('/api/v1/categories', { headers: bearer(key) });
    assert.equal(cats.status, 200);
    const names = (await cats.json()).categories.map((row) => row.name);
    assert.ok(names.includes('Taggy'));
    assert.ok(names.includes('Modelsnapper'));
    assert.ok(names.includes('AI Tools'));

    const maps = await call('/api/v1/merchant-mappings', { headers: bearer(key) });
    assert.equal(maps.status, 200);

    const denied = await call('/api/transactions', {
      method: 'POST',
      headers: bearer(key),
      body: { amount: 1, type: 'expense', category: 'Other' },
    });
    assert.equal(denied.status, 403);

    const action = await call('/api/v1/agent/actions', {
      method: 'POST',
      headers: bearer(key),
      body: {
        type: 'capture_expense',
        reason: 'user-approved fictional October capture',
        idempotency_key: 'http-test-acme',
        payload: {
          date: '2026-10-14',
          amount: 15.15,
          merchant: 'ACME CLOUD',
          description: 'Acme Cloud domain for Northwind',
          category: 'Northwind',
          client_key: 'http-test-acme',
        },
      },
    });
    assert.equal(action.status, 200);
    const written = await action.json();
    assert.equal(written.ok, true);
    assert.equal(written.result.action, 'inserted');

    const replay = await call('/api/v1/agent/actions', {
      method: 'POST',
      headers: bearer(key),
      body: {
        type: 'capture_expense',
        reason: 'user-approved fictional October capture',
        idempotency_key: 'http-test-acme',
        payload: {
          date: '2026-10-14',
          amount: 15.15,
          merchant: 'ACME CLOUD',
          description: 'Acme Cloud domain for Northwind',
          category: 'Northwind',
          client_key: 'http-test-acme',
        },
      },
    });
    assert.equal((await replay.json()).replayed, true);

    const log = await call('/api/v1/agent/actions', { headers: bearer(key) });
    assert.equal(log.status, 200);
    assert.ok((await log.json()).actions.some((row) => row.idempotency_key === 'http-test-acme'));
  });

  it('rejects an ingest key and requires a reason', async () => {
    const ingest = createKey({ name: 'capture-ingest', scope: 'ingest' });
    const denied = await call('/api/v1/agent/actions', {
      method: 'POST',
      headers: bearer(ingest.key),
      body: { type: 'ensure_category', reason: 'nope', payload: { name: 'Nope' } },
    });
    assert.equal(denied.status, 403);

    const { key } = createKey({ name: 'capture-noreason', scope: 'agent' });
    const missing = await call('/api/v1/agent/actions', {
      method: 'POST',
      headers: bearer(key),
      body: { type: 'ensure_category', payload: { name: 'Nope' } },
    });
    assert.equal(missing.status, 400);
  });

  it('applies a fictional batch through dispatchAction and is idempotent', () => {
    const payload = require('../ledger/capture.example.json');
    const first = capture.dispatchAction({
      type: 'capture_batch',
      reason: payload.reason,
      payload: {
        currency: payload.currency,
        categories: payload.categories,
        mappings: payload.mappings,
        items: payload.items,
      },
      idempotency_key: 'example-batch-1',
      auth: { kind: 'key', scope: 'agent', key: { id: 0 } },
    });
    assert.equal(first.ok, true);
    const actions = first.result.items.map((item) => item.action);
    assert.ok(actions.includes('inserted') || actions.includes('enriched') || actions.includes('needs_review') || actions.includes('replayed'));

    const second = capture.dispatchAction({
      type: 'capture_batch',
      reason: payload.reason,
      payload: {
        currency: payload.currency,
        categories: payload.categories,
        mappings: payload.mappings,
        items: payload.items,
      },
      idempotency_key: 'example-batch-1',
      auth: { kind: 'key', scope: 'agent', key: { id: 0 } },
    });
    assert.equal(second.replayed, true);
  });

  it('documents typed payload schemas and the new action types', async () => {
    const { key } = createKey({ name: 'capture-schemas', scope: 'agent' });
    const spec = await (await call('/api/v1/openapi.json', { headers: bearer(key) })).json();
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.components.schemas.CaptureItem);
    assert.ok(spec.components.schemas.CorrectTransactionPayload);
    assert.ok(spec.components.schemas.CaptureBatchPayload);
    assert.ok(spec.components.schemas.AgentActionRequest);
    assert.deepEqual(spec.paths['/agent/actions'].post.requestBody.content['application/json'].schema, {
      $ref: '#/components/schemas/AgentActionRequest',
    });
    const types = spec.components.schemas.AgentActionRequest.properties.type.enum;
    assert.ok(types.includes('capture_income'));
    assert.ok(types.includes('correct_transaction'));
    assert.ok(spec.paths['/transactions/{id}']);
  });
});

describe('income capture and corrections', () => {
  it('inserts income when nothing matches and leaves account unassigned', () => {
    const result = capture.captureIncome({
      date: '2026-10-22',
      amount: 95.75,
      merchant: 'NORTHWIND PAYROLL',
      description: 'Northwind October payroll',
      category: 'Arimac',
      client_key: 'test-oct-income-arimac',
    });
    assert.equal(result.action, 'inserted');
    assert.equal(result.transaction.type, 'income');
    assert.equal(result.transaction.category, 'Arimac');
    assert.equal(result.transaction.account_assigned, false);
    assert.equal(result.transaction.occurred_at, null);
    assert.equal(result.transaction.source, 'ledger');
  });

  it('does not treat an expense of the same date and amount as income', () => {
    const expense = capture.captureExpense({
      date: '2026-10-21',
      amount: 44.00,
      merchant: 'NORTHWIND PAYROLL',
      category: 'Other',
      client_key: 'typed-expense-same-day',
    });
    const income = capture.captureIncome({
      date: '2026-10-21',
      amount: 44.00,
      merchant: 'NORTHWIND PAYROLL',
      category: 'Arimac',
      client_key: 'typed-income-same-day',
    });
    assert.equal(expense.action, 'inserted');
    assert.equal(expense.transaction.type, 'expense');
    assert.equal(income.action, 'inserted');
    assert.equal(income.transaction.type, 'income');
    assert.notEqual(income.transaction_id, expense.transaction_id);
  });

  it('dry_run previews income without writing or consuming idempotency_key', () => {
    const preview = capture.dispatchAction({
      type: 'capture_income',
      reason: 'preview fictional October income',
      dry_run: true,
      idempotency_key: 'dry-run-income-key',
      payload: {
        date: '2026-10-16',
        amount: 12.50,
        merchant: 'NORTHWIND PAYROLL',
        category: 'Arimac',
        client_key: 'dry-run-income',
      },
    });
    assert.equal(preview.dry_run, true);
    assert.equal(preview.result.action, 'inserted');
    assert.equal(preview.result.transaction_id, null);
    assert.equal(
      capture.listActions().some((row) => row.idempotency_key === 'dry-run-income-key'),
      false,
    );

    const applied = capture.dispatchAction({
      type: 'capture_income',
      reason: 'apply fictional October income',
      idempotency_key: 'dry-run-income-key',
      payload: {
        date: '2026-10-16',
        amount: 12.50,
        merchant: 'NORTHWIND PAYROLL',
        category: 'Arimac',
        client_key: 'dry-run-income',
      },
      auth: { kind: 'key', scope: 'agent', key: { id: 0 } },
    });
    assert.equal(applied.replayed, false);
    assert.equal(applied.result.action, 'inserted');
    assert.equal(applied.result.transaction.type, 'income');
  });

  it('does not treat a nearby amount on the same day as the same expense', async () => {
    const sms = await ingestSmsText({
      text: fictionalSms({ location: 'WIDGET.AI', amount: '25.92', date: '2026-10-28' }),
      guessCategory: null,
    });
    assert.equal(sms.action, 'inserted');
    const result = capture.captureExpense({
      date: '2026-10-28',
      amount: 26.99,
      merchant: 'WIDGET.AI',
      description: 'Widget.ai for Gizmo',
      category: 'Gizmo',
      client_key: 'test-no-fuzzy-widget',
    });
    assert.equal(result.action, 'inserted');
    assert.notEqual(result.transaction_id, sms.transaction_id);
  });

  it('corrects an identified row by id with expected originals and keeps SMS evidence', async () => {
    const sms = await ingestSmsText({
      text: fictionalSms({ location: 'ACME CLOUD', amount: '10.00', date: '2026-10-09' }),
      guessCategory: null,
    });
    const id = sms.transaction_id;
    const rawBefore = db.connection.prepare('SELECT raw_message, source FROM transactions WHERE id = ?').get(id);
    assert.ok(rawBefore.raw_message);

    const preview = capture.correctTransaction({
      transaction_id: id,
      expected: { date: '2026-10-09', amount: 10.00, type: 'expense' },
      set: { date: '2026-10-08', amount: 10.34, category: 'Northwind' },
      dry_run: true,
    });
    assert.equal(preview.dry_run, true);
    assert.equal(preview.action, 'corrected');
    const still = db.getTransactionById(id);
    assert.equal(still.date, '2026-10-09');
    assert.equal(still.amount, 10);

    const applied = capture.correctTransaction({
      transaction_id: id,
      expected: { date: '2026-10-09', amount: 10.00, type: 'expense' },
      set: { date: '2026-10-08', amount: 10.34, category: 'Northwind' },
    });
    assert.equal(applied.action, 'corrected');
    assert.equal(applied.transaction.date, '2026-10-08');
    assert.equal(applied.transaction.amount, 10.34);
    assert.equal(applied.transaction.category, 'Northwind');
    assert.equal(applied.before_image.amount, 10);
    assert.equal(applied.before_image.date, '2026-10-09');
    const after = db.connection.prepare('SELECT raw_message, source, occurred_at FROM transactions WHERE id = ?').get(id);
    assert.equal(after.raw_message, rawBefore.raw_message);
    assert.equal(after.source, 'sms');
    const count = db.connection.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE merchant = 'ACME CLOUD' AND date IN ('2026-10-08','2026-10-09') AND ROUND(amount * 100) IN (1000, 1034)"
    ).get().n;
    assert.equal(count, 1);
  });

  it('rejects a correction when expected originals do not match', async () => {
    const sms = await ingestSmsText({
      text: fictionalSms({ location: 'TUNES', amount: '3.75', date: '2026-10-27' }),
      guessCategory: null,
    });
    assert.throws(
      () => capture.correctTransaction({
        transaction_id: sms.transaction_id,
        expected: { date: '2026-10-27', amount: 3.90, type: 'expense' },
        set: { amount: 3.90 },
      }),
      (err) => err.status === 409 && err.code === 'conflict',
    );
    const row = db.getTransactionById(sms.transaction_id);
    assert.equal(row.amount, 3.75);
  });

  it('lets an agent key correct through actions and get a transaction by id', async () => {
    const { key } = createKey({ name: 'capture-correct', scope: 'agent' });
    const income = await call('/api/v1/agent/actions', {
      method: 'POST',
      headers: bearer(key),
      body: {
        type: 'capture_income',
        reason: 'user-approved fictional October income',
        idempotency_key: 'http-test-income',
        payload: {
          date: '2026-10-15',
          amount: 67.25,
          merchant: 'GIZMO TUTORING',
          description: 'Gizmo tutoring',
          category: 'Tutopiya',
          client_key: 'http-test-income',
        },
      },
    });
    assert.equal(income.status, 200);
    const created = await income.json();
    assert.equal(created.result.action, 'inserted');
    assert.equal(created.result.transaction.type, 'income');
    assert.equal(created.result.transaction.category, 'Tutopiya');

    const got = await call(`/api/v1/transactions/${created.result.transaction_id}`, { headers: bearer(key) });
    assert.equal(got.status, 200);
    const body = await got.json();
    assert.equal(body.transaction.category, 'Tutopiya');
    assert.equal(body.transaction.raw_message, undefined);

    const dry = await call('/api/v1/agent/actions', {
      method: 'POST',
      headers: bearer(key),
      body: {
        type: 'correct_transaction',
        reason: 'preview fictional amount fix',
        dry_run: true,
        payload: {
          transaction_id: created.result.transaction_id,
          expected: { date: '2026-10-15', amount: 67.25, type: 'income' },
          set: { amount: 67.50 },
        },
      },
    });
    assert.equal(dry.status, 200);
    const preview = await dry.json();
    assert.equal(preview.dry_run, true);
    assert.equal(db.getTransactionById(created.result.transaction_id).amount, 67.25);

    const conflict = await call('/api/v1/agent/actions', {
      method: 'POST',
      headers: bearer(key),
      body: {
        type: 'correct_transaction',
        reason: 'stale expected originals',
        payload: {
          transaction_id: created.result.transaction_id,
          expected: { date: '2026-10-15', amount: 1, type: 'income' },
          set: { amount: 67.50 },
        },
      },
    });
    assert.equal(conflict.status, 409);
    const denied = await conflict.json();
    assert.equal(denied.code, 'conflict');
    assert.ok(denied.current);
  });
});

