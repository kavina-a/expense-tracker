// Pure key generation: no database. Used by key:generate (run on your own
// machine) and by createKey. The secret exists only in the returned `key`.

const crypto = require('crypto');

const SCOPES = ['full', 'ingest', 'agent'];
// Names travel inside API_KEY_SEEDS (comma and colon separated), so keep them simple.
const NAME_RE = /^[A-Za-z0-9 ._-]{1,60}$/;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateKey({ name, scope }) {
  const label = String(name || '').trim();
  if (!label) throw new Error('name is required');
  if (!NAME_RE.test(label)) throw new Error('name may only use letters, numbers, spaces, dot, dash and underscore');
  if (!SCOPES.includes(scope)) throw new Error(`scope must be one of: ${SCOPES.join(', ')}`);

  const prefix = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  return { name: label, scope, prefix, hash: sha256Hex(secret), key: `stk_${prefix}_${secret}` };
}

// One entry of API_KEY_SEEDS: name:scope:prefix:hash
function seedEntry({ name, scope, prefix, hash }) {
  return `${name}:${scope}:${prefix}:${hash}`;
}

// Never throws: a bad entry is reported and skipped so it can't stop the server booting.
function parseSeeds(raw) {
  const entries = [];
  const problems = [];
  for (const part of String(raw || '').split(',')) {
    const text = part.trim();
    if (!text) continue;
    const [name, scope, prefix, hash, ...extra] = text.split(':');
    if (extra.length || !NAME_RE.test(name || '') || !SCOPES.includes(scope)
      || !/^[0-9a-f]{8}$/.test(prefix || '') || !/^[0-9a-f]{64}$/.test(hash || '')) {
      problems.push(`ignored malformed entry starting "${text.slice(0, 20)}"`);
      continue;
    }
    entries.push({ name, scope, prefix, hash });
  }
  return { entries, problems };
}

module.exports = { SCOPES, NAME_RE, sha256Hex, generateKey, seedEntry, parseSeeds };
