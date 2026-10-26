// API keys for non-browser callers (Ledger, the iOS Shortcut).
//
// Format: stk_<prefix>_<secret>
//   prefix  8 hex chars, not secret, used to find the row
//   secret  32 random bytes, base64url
// Only sha256(secret) is stored. A fast hash is fine here because the secret is
// high-entropy; slow password hashes are for guessable passwords.

const crypto = require('crypto');
const db = require('../db').connection;
const { isoNow, now } = require('../time');

const SCOPES = ['full', 'ingest', 'agent'];
const TOKEN_RE = /^stk_([0-9a-f]{8})_([A-Za-z0-9_-]{20,})$/;
const LAST_USED_WRITE_MS = 60 * 1000;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqualHex(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createKey({ name, scope }) {
  const label = String(name || '').trim();
  if (!label) throw new Error('name is required');
  if (!SCOPES.includes(scope)) throw new Error(`scope must be one of: ${SCOPES.join(', ')}`);

  const prefix = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  const result = db.prepare(`
    INSERT INTO api_keys (name, scope, prefix, hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(label, scope, prefix, sha256Hex(secret), isoNow());

  return {
    id: Number(result.lastInsertRowid),
    name: label,
    scope,
    // Shown once. Never stored.
    key: `stk_${prefix}_${secret}`,
  };
}

// Returns { id, name, scope } or null. Never throws on malformed input.
function verifyKey(token) {
  const match = TOKEN_RE.exec(String(token || '').trim());
  if (!match) return null;
  const [, prefix, secret] = match;

  const row = db.prepare('SELECT * FROM api_keys WHERE prefix = ?').get(prefix);
  // Hash and compare even when the prefix is unknown so timing doesn't reveal it.
  const expected = row ? row.hash : sha256Hex('no-such-key');
  const matches = safeEqualHex(sha256Hex(secret), expected);
  if (!row || !matches || row.revoked_at) return null;

  const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (now().getTime() - lastUsed > LAST_USED_WRITE_MS) {
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(isoNow(), row.id);
  }
  return { id: row.id, name: row.name, scope: row.scope };
}

function listKeys() {
  return db.prepare(`
    SELECT id, name, scope, prefix, created_at, revoked_at, last_used_at
    FROM api_keys ORDER BY id
  `).all();
}

function revokeKey(id) {
  const row = db.prepare('SELECT id, revoked_at FROM api_keys WHERE id = ?').get(id);
  if (!row) return null;
  if (!row.revoked_at) {
    db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(isoNow(), id);
  }
  return db.prepare(`
    SELECT id, name, scope, prefix, created_at, revoked_at FROM api_keys WHERE id = ?
  `).get(id);
}

module.exports = { SCOPES, createKey, verifyKey, listKeys, revokeKey, sha256Hex };
