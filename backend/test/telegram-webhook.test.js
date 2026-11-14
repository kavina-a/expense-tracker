const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { webhookUrlFromEnv } = require('../telegram');

describe('telegram webhook URL', () => {
  it('accepts HTTPS only and appends /telegram when missing', () => {
    assert.equal(
      webhookUrlFromEnv({ TELEGRAM_WEBHOOK_URL: 'https://example.com/telegram' }),
      'https://example.com/telegram',
    );
    assert.equal(
      webhookUrlFromEnv({ TELEGRAM_WEBHOOK_URL: 'https://example.com' }),
      'https://example.com/telegram',
    );
    assert.equal(
      webhookUrlFromEnv({ TELEGRAM_WEBHOOK_URL: 'https://example.com/telegram/' }),
      'https://example.com/telegram',
    );
    assert.equal(webhookUrlFromEnv({ TELEGRAM_WEBHOOK_URL: 'http://example.com/telegram' }), null);
    assert.equal(webhookUrlFromEnv({ TELEGRAM_WEBHOOK_URL: 'https://localhost/telegram' }), null);
    assert.equal(webhookUrlFromEnv({ TELEGRAM_WEBHOOK_URL: 'not a url' }), null);
    assert.equal(webhookUrlFromEnv({}), null);
  });
});
