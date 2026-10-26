// Per-test-file isolated environment. node --test runs each file in its own
// process, so this gives every file a fresh database in its own temp directory.
// Require this BEFORE anything that loads db.js.

const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function setupEnv(name, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `suspense-${name}-`));
  const dbPath = path.join(dir, 'expenses.db');
  Object.assign(process.env, {
    DB_PATH: dbPath,
    SMS_INGEST_SECRET: 'test-secret',
    MY_TELEGRAM_CHAT_ID: '',
    MY_WHATSAPP_NUMBER: '',
    TELEGRAM_SECRET_TOKEN: '',
    GROQ_API_KEY: '', // no key: category guessing stays off the network
    DASHBOARD_PASSWORD: 'correct horse battery',
    NOTIFY_CHANNEL: 'ledger',
    COOKIE_SECURE: 'false',
    ...overrides,
  });
  return { dir, dbPath };
};
