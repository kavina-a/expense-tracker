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
  const body = { ok: false, error: err.message || 'Internal server error' };
  if (err.code) body.code = err.code;
  if (err.current) body.current = err.current;
  if (err.expected) body.expected = err.expected;
  if (err.mismatches) body.mismatches = err.mismatches;
  res.status(status).json(body);
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
  '/transactions/{id}': {
    get: {
      operationId: 'getTransaction',
      summary: 'One transaction by id (no raw SMS text)',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      responses: {
        200: { description: 'Transaction' },
        404: { description: 'Not found' },
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
        'Types: ensure_category, upsert_mapping, capture_expense, capture_income, capture_batch, correct_transaction.',
        'Capture matches the same type by exact Colombo date + amount (cents). Nearby amounts or dates are never matched.',
        'A unique exact hit is enriched. Several exact hits return needs_review. A miss inserts source=ledger with account_masked null.',
        'correct_transaction updates one existing row by id. expected.date and expected.amount must match the current row or the call returns 409.',
        'Corrections change accounting fields only. SMS raw text, source, account, and occurred_at are left alone. No balancing fees are invented.',
        'dry_run=true previews without writing and does not consume idempotency_key.',
        'currency must be LKR. Do not send account, card, or time-of-day unless the user supplied evidence.',
        'Agent keys may POST only this path.',
      ].join(' '),
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AgentActionRequest' },
          },
        },
      },
      responses: {
        200: { description: 'Action result' },
        400: { description: 'Validation error' },
        401: { description: 'Missing or invalid API key' },
        403: { description: 'Key scope cannot write' },
        409: { description: 'correct_transaction expected originals do not match' },
      },
    },
  },
};

const SCHEMAS = {
  CaptureItem: {
    type: 'object',
    required: ['date', 'amount'],
    properties: {
      date: { type: 'string', format: 'date', description: 'Colombo calendar day YYYY-MM-DD' },
      amount: { type: 'number', exclusiveMinimum: 0 },
      currency: { type: 'string', enum: ['LKR'] },
      type: { type: 'string', enum: ['expense', 'income'], default: 'expense' },
      merchant: { type: 'string' },
      description: { type: 'string' },
      category: { type: 'string' },
      note: { type: 'string' },
      client_key: { type: 'string' },
      account_masked: { type: 'string', description: 'Omit unless the user supplied account evidence' },
    },
  },
  ExpectedOriginals: {
    type: 'object',
    required: ['date', 'amount'],
    description: 'Optimistic concurrency: must match the row as stored now.',
    properties: {
      date: { type: 'string', format: 'date' },
      amount: { type: 'number' },
      type: { type: 'string' },
      category: { type: 'string' },
    },
  },
  CorrectionSet: {
    type: 'object',
    description: 'Accounting fields to change. Does not alter SMS raw text, source, account, or occurred_at.',
    properties: {
      date: { type: 'string', format: 'date' },
      amount: { type: 'number', exclusiveMinimum: 0 },
      type: { type: 'string', enum: ['expense', 'income', 'investment', 'transfer'] },
      category: { type: 'string' },
      description: { type: 'string' },
      note: { type: 'string' },
      merchant: { type: 'string' },
    },
  },
  CorrectTransactionPayload: {
    type: 'object',
    required: ['transaction_id', 'expected', 'set'],
    properties: {
      transaction_id: { type: 'integer' },
      expected: { $ref: '#/components/schemas/ExpectedOriginals' },
      set: { $ref: '#/components/schemas/CorrectionSet' },
      dry_run: { type: 'boolean' },
    },
  },
  CaptureBatchPayload: {
    type: 'object',
    properties: {
      currency: { type: 'string', enum: ['LKR'] },
      dry_run: { type: 'boolean' },
      categories: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['expense', 'income', 'investment'] },
            icon: { type: 'string' },
            color: { type: 'string' },
          },
        },
      },
      mappings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['merchant_pattern', 'category'],
          properties: {
            merchant_pattern: { type: 'string' },
            description_pattern: { type: 'string', description: 'Optional extra tokens; join with + to require all (e.g. DOMAIN+TAGGY)' },
            category: { type: 'string' },
            note: { type: 'string' },
          },
        },
      },
      corrections: {
        type: 'array',
        items: { $ref: '#/components/schemas/CorrectTransactionPayload' },
      },
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/CaptureItem' },
      },
    },
  },
  AgentActionRequest: {
    type: 'object',
    required: ['type', 'reason'],
    properties: {
      type: {
        type: 'string',
        enum: [
          'ensure_category',
          'upsert_mapping',
          'capture_expense',
          'capture_income',
          'capture_batch',
          'correct_transaction',
        ],
      },
      reason: { type: 'string' },
      idempotency_key: { type: 'string' },
      dry_run: { type: 'boolean' },
      payload: {
        description: 'Shape depends on type. capture_expense/capture_income use CaptureItem; capture_batch uses CaptureBatchPayload; correct_transaction uses CorrectTransactionPayload.',
        oneOf: [
          { $ref: '#/components/schemas/CaptureItem' },
          { $ref: '#/components/schemas/CaptureBatchPayload' },
          { $ref: '#/components/schemas/CorrectTransactionPayload' },
        ],
      },
    },
  },
};

function openApiDocument(req) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Suspense Tracker',
      version: '1.2.0',
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
      schemas: SCHEMAS,
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

  app.get('/api/v1/transactions/:id', wrap((req, res) => {
    res.json(capture.getPublicById(req.params.id));
  }));

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
      dry_run: body.dry_run,
      auth: req.auth,
    });
    res.json(result);
  }));
}

module.exports = { mountV1, openApiDocument };
