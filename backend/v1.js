// Ledger-facing API. /api/v1/openapi.json is what Ledger fetches with its key.

const { listOpenEscalations, listOpenQuestions, channel } = require('./notify');

function publicOrigin(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function openApiDocument(req) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Suspense Tracker',
      version: '1.0.0',
      description: 'Send Authorization: Bearer <api key>. The ledger key can read the inbox.',
    },
    servers: [{ url: `${publicOrigin(req)}/api/v1` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
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
    },
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

function mountV1(app) {
  app.get('/api/v1/openapi.json', (req, res) => {
    res.json(openApiDocument(req));
  });
  app.get('/api/v1/agent/inbox', (_req, res) => {
    res.json(inboxPayload());
  });
}

module.exports = { mountV1, openApiDocument };
