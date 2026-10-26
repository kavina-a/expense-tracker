// Authentication for /api/*.
//
// Callers are one of:
//   - a browser with a session cookie        -> full access (single user)
//   - an API key, scope full                  -> full access
//   - an API key, scope agent                 -> read-only (Phase 4 adds the agent actions)
//   - an API key, scope ingest                -> SMS ingest routes only
//
// The webhooks (/webhook, /telegram) are outside /api and keep their own secrets.
// The SMS routes sit under /api but do their own check (see sms/http.js) so the
// iOS Shortcut can keep sending X-SMS-Secret.

const { verifyKey } = require('./keys');
const sessions = require('./sessions');

// Paths below are relative to the /api mount.
const PUBLIC_PATHS = new Set(['/auth/login', '/auth/logout']);
const SELF_AUTH_PREFIXES = ['/sms-ingest', '/sms-review'];
// Whole-database export: only a full-scope caller, never the agent.
const FULL_ONLY_PATHS = new Set(['/backup', '/restore']);

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (match) return match[1];
  return req.get('x-api-key') || null;
}

// -> { kind, scope, key? } | { invalid: true } | null (no credentials at all)
function authenticate(req) {
  const token = bearerToken(req);
  if (token) {
    const key = verifyKey(token);
    return key ? { kind: 'key', scope: key.scope, key } : { invalid: true };
  }
  const cookie = sessions.sessionTokenFrom(req);
  if (cookie) {
    return sessions.validSession(cookie) ? { kind: 'session', scope: 'full' } : { invalid: true };
  }
  return null;
}

function scopeAllows(scope, method, apiPath) {
  if (scope === 'full') return true;
  if (scope === 'agent') {
    if (FULL_ONLY_PATHS.has(apiPath)) return false;
    return method === 'GET' || method === 'HEAD';
  }
  return false; // ingest keys only reach the SMS routes, which authenticate themselves
}

function hasJsonContentType(req) {
  return String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json');
}

function apiAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (SELF_AUTH_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
    return next();
  }

  const who = authenticate(req);
  if (!who || who.invalid) return res.status(401).json({ error: 'Unauthorized' });

  if (!scopeAllows(who.scope, req.method, req.path)) {
    return res.status(403).json({ error: 'Forbidden', code: 'insufficient_scope' });
  }

  // Cookies ride along on cross-site requests; keys don't. SameSite=Strict is the
  // main defence. Requiring a JSON content type on writes adds a second one,
  // because a cross-site page can't send it without a CORS preflight we refuse.
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (who.kind === 'session' && unsafe && !hasJsonContentType(req)) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }

  req.auth = who;
  next();
}

function cookieShouldBeSecure(req) {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

function mountAuthRoutes(app) {
  app.post('/api/auth/login', (req, res) => {
    if (!sessions.passwordConfigured()) {
      return res.status(503).json({ error: 'Dashboard login is not configured' });
    }
    const ipKey = `ip:${req.ip}`;
    if (sessions.loginLimiter.blocked(ipKey) || sessions.globalLoginLimiter.blocked('all')) {
      res.set('Retry-After', '900');
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }
    if (!sessions.passwordMatches(req.body?.password)) {
      sessions.loginLimiter.fail(ipKey);
      sessions.globalLoginLimiter.fail('all');
      return res.status(401).json({ error: 'Wrong password' });
    }
    sessions.loginLimiter.reset(ipKey);
    const session = sessions.createSession();
    res.cookie(sessions.COOKIE_NAME, session.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: cookieShouldBeSecure(req),
      path: '/',
      maxAge: session.maxAgeMs,
    });
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    sessions.destroySession(sessions.sessionTokenFrom(req));
    res.clearCookie(sessions.COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  // Goes through apiAuth, so it is 401 without a session. The frontend uses it
  // to decide between the login page and the app.
  app.get('/api/auth/me', (req, res) => {
    res.json({ ok: true, via: req.auth.kind, scope: req.auth.scope });
  });
}

module.exports = { apiAuth, mountAuthRoutes, authenticate, scopeAllows, bearerToken };
