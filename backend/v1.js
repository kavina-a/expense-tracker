// Ledger-facing API. /api/v1/openapi.json is what Ledger fetches with its key.

const { listOpenEscalations, listOpenQuestions, channel } = require('./notify');
const capture = require('./ledger/capture');
const mappings = require('./ledger/mappings');
const db = require('./db');

function publicOrigin(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function jsonError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('[v1]', err);
  res.status(status).json({ ok: false, error: err.message || 'Internal server error' });
}

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) { jsonError(res, err); }
  };
}

const PATHS = {
  '/openapi.json': {
    get: {
      operationId: 'getOpenApi',
      summary: 'This OpenAPI document',
      responses: {
        200: { description: 'OpenAPI 3.1 document' },
        401: { description: 'Missing or invalid API key' },
      },
    },
  },
  '/agent/inbox': {
    get: {
      operationId: 'getAgentInbox',
      summary: 'Open escalations and questions, oldest escalation first',
      responses: {
        200: { description: 'Inbox' },
        401: { description: 'Missing or invalid API key' },
      },
    },
  },
  '/transactions': {
    get: {
      operationId: 'searchTransactions',
      summary: 'Date-range transaction lookup (Asia/Colombo calendar dates)',
      description: 'Inclusive from/to as YYYY-MM-DD. Defaults to the current Colombo month. Omits raw SMS text. Agent keys may read this.',
      parameters: [
        { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
        { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
        { name: 'month', in: 'query', schema: { type: 'string', example: '2026-10' } },
        { name: 'q', in: 'query', schema: { type: 'string' } },
        { name: 'merchant', in: 'query', schema: { type: 'string' } },
        { name: 'category', in: 'query', schema: { type: 'string' } },
        { name: 'amount', in: 'query', schema: { type: 'number' } },
        { name: 'type', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 200 } },
      ],
      responses: {
        200: { description: 'Matching transactions' },
        400: { description: 'Invalid date or amount' },
        401: { description: 'Missing or invalid API key' },
      },
    },
  },
  '/categories': {
    get: {
      operationId: 'listCategories',
      summary: 'List categories (existing expense/income/investment names)',
      responses: {
        200: { description: 'Categories' },
        401: { description: 'Missing or invalid API key' },
      },
    },
  },
  '/merchant-mappings': {
    get: {
      operationId: 'listMerchantMappings',
      summary: 'User-approved merchant mappings (description_pattern constrains Cloudflare-style rules)',
      responses: {
        200: { description: 'Mappings' },
        401: { description: 'Missing or invalid API key' },
      },
    },
  },
  '/agent/actions': {
    get: {
      operationId: 'listAgentActions',
      summary: 'Recent Ledger action log, newest first',
      parameters: [
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
      ],
      responses: {
        200: { description: 'Action log' },
        401: { description: 'Missing or invalid API key' },
      },
    },
    post: {
      operationId: 'postAgentAction',
      summary: 'Typed, reason-required Ledger write',
      description: [
        'Allowed types: ensure_category, upsert_mapping, capture_expense, capture_batch.',
        'capture_expense matches type=expense by Colombo date + amount (cents).',
        'A unique match is enriched (no second row). Several matches return needs_review.',
        'No match inserts source=ledger with account_masked left null unless the payload supplied one.',
        'Do not send account, card, or time-of-day unless the user actually provided them.',
        'currency must be LKR. Replay the same idempotency_key to no-op.',
        'Agent keys may POST only this path. Deletes, backup, and dashboard writes stay forbidden.',
      ].join(' '),
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['type', 'reason'],
              properties: {
                type: {
                  type: 'string',
                  enum: ['ensure_category', 'upsert_mapping', 'capture_expense', 'capture_batch'],
                },
                reason: { type: 'string' },
                idempotency_key: { type: 'string' },
                payload: { type: 'object' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Action result' },
        400: { description: 'Validation error' },
        401: { description: 'Missing or invalid API key' },
        403: { description: 'Key scope cannot write' },
      },
    },
  },
};

function openApiDocument(req) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Suspense Tracker',
      version: '1.1.0',
      description: [
        'Send Authorization: Bearer <api key> (or X-API-Key).',
        'An agent-scope key can GET these paths and POST /agent/actions.',
        'It cannot read /backup, delete rows, or use dashboard write routes.',
        'Dates are Asia/Colombo. Amounts are LKR.',
      ].join(' '),
    },
    servers: [{ url: `${publicOrigin(req)}/api/v1` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: PATHS,
  };
}

function inboxPayload() {
  return {
    ok: true,
    channel: channel(),
    escalations: listOpenEscalations(),
    questions: listOpenQuestions(),
  };
}

function defaultMonthRange() {
  const { monthColombo } = require('./time');
  const month = monthColombo();
  return { from: `${month}-01`, to: `${month}-31`, month };
}

function mountV1(app) {
  app.get('/api/v1/openapi.json', (req, res) => {
    res.json(openApiDocument(req));
  });

  app.get('/api/v1/agent/inbox', (_req, res) => {
    res.json(inboxPayload());
  });

  app.get('/api/v1/transactions', wrap((req, res) => {
    const defaults = defaultMonthRange();
    const result = capture.searchTransactions({
      from: req.query.from || (req.query.to || req.query.month ? undefined : defaults.from),
      to: req.query.to || (req.query.from || req.query.month ? undefined : defaults.to),
      month: req.query.month,
      q: req.query.q,
      merchant: req.query.merchant,
      category: req.query.category,
      amount: req.query.amount,
      type: req.query.type,
      status: req.query.status,
      limit: req.query.limit,
    });
    res.json(result);
  }));

  app.get('/api/v1/categories', wrap((_req, res) => {
    res.json({ ok: true, categories: db.getCategories() });
  }));

  app.get('/api/v1/merchant-mappings', wrap((_req, res) => {
    res.json({ ok: true, mappings: mappings.listMappings() });
  }));

  app.get('/api/v1/agent/actions', wrap((req, res) => {
    res.json({ ok: true, actions: capture.listActions({ limit: req.query.limit }) });
  }));

  app.post('/api/v1/agent/actions', wrap((req, res) => {
    const body = req.body || {};
    const result = capture.dispatchAction({
      type: body.type,
      reason: body.reason,
      payload: body.payload || {},
      idempotency_key: body.idempotency_key,
      auth: req.auth,
    });
    res.json(result);
  }));
}

module.exports = { mountV1, openApiDocument };
