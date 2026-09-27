const crypto = require('crypto');
const { ingestSmsText, listSmsReviews, resolveSmsReview } = require('./ingest');

function smsSecret() {
  const value = process.env.SMS_INGEST_SECRET;
  return value && String(value).trim() ? String(value) : null;
}

function secretsMatch(provided, expected) {
  const a = Buffer.from(String(provided ?? ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireSmsSecret(req, res, next) {
  const expected = smsSecret();
  if (!expected) {
    return res.status(503).json({ error: 'SMS ingest is not configured' });
  }
  const provided = req.get('x-sms-secret');
  if (!provided || !secretsMatch(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function asyncHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('[SMS]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

function safeId(value) {
  const id = parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function mountSmsRoutes(app) {
  app.post('/api/sms-ingest', requireSmsSecret, asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (typeof body.text !== 'string' || !body.text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (body.received_at != null) {
      if (typeof body.received_at !== 'string' || Number.isNaN(Date.parse(body.received_at))) {
        return res.status(400).json({ error: 'received_at must be an ISO8601 timestamp' });
      }
    }
    const result = await ingestSmsText({ text: body.text, receivedAt: body.received_at || null });
    res.status(200).json({ ok: true, ...result });
  }));

  app.get('/api/sms-review', requireSmsSecret, asyncHandler((_req, res) => {
    res.json({ ok: true, reviews: listSmsReviews() });
  }));

  app.post('/api/sms-review/:id/resolve', requireSmsSecret, asyncHandler((req, res) => {
    const reviewId = safeId(req.params.id);
    const transactionId = safeId(req.body?.transaction_id);
    if (!reviewId) return res.status(400).json({ error: 'Invalid review id' });
    if (!transactionId) return res.status(400).json({ error: 'transaction_id is required' });

    const result = resolveSmsReview(reviewId, transactionId);
    if (result.error === 'not_found') return res.status(404).json({ error: 'Review not found' });
    if (result.error === 'not_open') return res.status(409).json({ error: 'Review is already resolved' });
    if (result.error === 'not_candidate') {
      return res.status(400).json({ error: 'transaction_id is not one of the candidates' });
    }
    if (result.error === 'not_posted') {
      return res.status(409).json({ error: 'That expense is no longer posted' });
    }
    res.json({ ok: true, ...result });
  }));
}

module.exports = { mountSmsRoutes, requireSmsSecret };
