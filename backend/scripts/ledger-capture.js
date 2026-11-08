#!/usr/bin/env node
// Apply a reviewed Ledger capture payload.
//
//   node scripts/ledger-capture.js --file ./reviewed.capture.json --dry-run
//   node scripts/ledger-capture.js --file ./reviewed.capture.json --local
//   LEDGER_API_KEY=stk_... node scripts/ledger-capture.js --file ./reviewed.capture.json --base https://example.up.railway.app
//
// The API key is read from LEDGER_API_KEY or EXPENSE_TRACKER_API_KEY only.
// It is never printed. Do not put personal amounts in git; use a gitignored file.

const fs = require('fs');
const path = require('path');

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function usage(message) {
  if (message) console.error(message);
  console.error(`Usage:
  node scripts/ledger-capture.js --file <payload.json> [--dry-run]
  node scripts/ledger-capture.js --file <payload.json> --local
  LEDGER_API_KEY=stk_... node scripts/ledger-capture.js --file <payload.json> --base <origin>

Payload shape: { reason, currency, dry_run, categories[], mappings[], corrections[], items[] }.
See ledger/capture.example.json (fictional amounts only).`);
  process.exit(message ? 1 : 0);
}

function readPayload(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) usage(`File not found: ${abs}`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    usage(`Invalid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    usage('Payload must be a JSON object');
  }
  return parsed;
}

function actionBody(payload) {
  const reason = payload.reason || 'user-approved ledger capture';
  return {
    type: 'capture_batch',
    reason,
    idempotency_key: payload.idempotency_key || undefined,
    payload: {
      currency: payload.currency || 'LKR',
      dry_run: Boolean(payload.dry_run),
      categories: payload.categories || [],
      mappings: payload.mappings || [],
      corrections: payload.corrections || [],
      items: payload.items || [],
    },
  };
}

async function postRemote(origin, body) {
  const key = process.env.LEDGER_API_KEY || process.env.EXPENSE_TRACKER_API_KEY;
  if (!key) {
    usage('Set LEDGER_API_KEY (or EXPENSE_TRACKER_API_KEY) to POST. Use --local or --dry-run otherwise.');
  }
  const base = String(origin).replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
  const url = `${base}/api/v1/agent/actions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    console.error(`HTTP ${res.status}`);
    console.log(JSON.stringify(json, null, 2));
    process.exit(1);
  }
  return json;
}

function postLocal(body) {
  const result = require('../ledger/capture').dispatchAction({
    type: body.type,
    reason: body.reason,
    payload: body.payload,
    idempotency_key: body.idempotency_key,
    auth: { kind: 'cli', scope: 'agent' },
  });
  return result;
}

async function main() {
  if (hasFlag('help') || hasFlag('h')) usage();
  const file = arg('file');
  if (!file) usage('Missing --file');
  const payload = readPayload(file);
  const body = actionBody(payload);

  if (hasFlag('dry-run')) {
    const summary = {
      dry_run: true,
      reason: body.reason,
      currency: body.payload.currency,
      categories: (body.payload.categories || []).map((c) => ({ name: c.name, type: c.type || 'expense' })),
      mappings: (body.payload.mappings || []).map((m) => ({
        merchant_pattern: m.merchant_pattern,
        description_pattern: m.description_pattern || '',
        category: m.category,
      })),
      corrections: (body.payload.corrections || []).map((row) => ({
        transaction_id: row.transaction_id,
        set_fields: Object.keys(row.set || {}),
        has_expected: Boolean(row.expected),
      })),
      items: (body.payload.items || []).map((item) => ({
        date: item.date,
        type: item.type || 'expense',
        merchant: item.merchant || null,
        category: item.category || null,
        client_key: item.client_key || null,
        has_amount: item.amount != null,
        has_account: Boolean(item.account_masked),
      })),
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const result = hasFlag('local')
    ? postLocal(body)
    : await postRemote(arg('base', process.env.LEDGER_API_BASE || 'http://127.0.0.1:3000'), body);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
