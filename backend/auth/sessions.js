// Single-user dashboard login. The browser holds a random token in an httpOnly
// cookie; the database holds only its sha256, so a leaked database file can't be
// replayed as a session.

const crypto = require('crypto');
const db = require('../db').connection;
const { sha256Hex } = require('./keys');
const { now } = require('../time');

const COOKIE_NAME = 'sid';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

function passwordMatches(provided) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  // Hash both sides so lengths match and timingSafeEqual can't throw.
  const a = crypto.createHash('sha256').update(String(provided ?? '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function passwordConfigured() {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

function createSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  const created = now();
  const expires = new Date(created.getTime() + SESSION_MS);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(created.toISOString());
  db.prepare(`
    INSERT INTO sessions (id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?)
  `).run(sha256Hex(token), created.toISOString(), expires.toISOString(), created.toISOString());
  return { token, expiresAt: expires, maxAgeMs: SESSION_MS };
}

function validSession(token) {
  if (!token) return false;
  const row = db.prepare('SELECT id, expires_at FROM sessions WHERE id = ?').get(sha256Hex(token));
  if (!row) return false;
  if (Date.parse(row.expires_at) <= now().getTime()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return false;
  }
  return true;
}

function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256Hex(token));
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[name] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

function sessionTokenFrom(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}

// A single user behind a proxy: limit failures globally as well as per address,
// because X-Forwarded-For is only as trustworthy as the proxy in front.
function createLimiter({ max, windowMs }) {
  const hits = new Map();
  const prune = (key, t) => {
    const recent = (hits.get(key) || []).filter((at) => t - at < windowMs);
    if (recent.length) hits.set(key, recent); else hits.delete(key);
    return recent;
  };
  return {
    blocked(key) { return prune(key, now().getTime()).length >= max; },
    fail(key) {
      const t = now().getTime();
      const recent = prune(key, t);
      recent.push(t);
      hits.set(key, recent);
    },
    reset(key) { hits.delete(key); },
    clear() { hits.clear(); },
  };
}

const loginLimiter = createLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
const globalLoginLimiter = createLimiter({ max: 20, windowMs: 15 * 60 * 1000 });

module.exports = {
  COOKIE_NAME,
  SESSION_DAYS,
  passwordMatches,
  passwordConfigured,
  createSession,
  validSession,
  destroySession,
  parseCookies,
  sessionTokenFrom,
  loginLimiter,
  globalLoginLimiter,
};
