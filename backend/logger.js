function preview(text, max = 80) {
  if (text == null) return '';
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function serializeError(err) {
  if (!err) return {};
  const out = {
    name: err.name,
    message: err.message,
    code: err.code,
    status: err.status,
    type: err.type,
  };
  if (err.cause) {
    out.cause = typeof err.cause === 'object'
      ? { name: err.cause.name, message: err.cause.message, code: err.cause.code }
      : String(err.cause);
  }
  if (err.error) out.apiError = err.error;
  if (err.headers) out.requestId = err.headers['x-request-id'] || err.headers['x-openai-request-id'];
  return out;
}

function log(level, scope, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function logError(scope, err, meta = {}) {
  log('error', scope, err?.message || 'Unknown error', {
    ...meta,
    error: serializeError(err),
  });
}

function summarizeParsed(parsed) {
  if (!parsed) return {};
  if (parsed.isQuery) {
    return {
      isQuery: true,
      queryType: parsed.queryType || 'unknown',
      ...(parsed.category ? { category: parsed.category } : {}),
      ...(parsed.n != null ? { n: parsed.n } : {}),
    };
  }
  if (parsed.needsClarification) {
    return { isQuery: false, needsClarification: true, questionPreview: preview(parsed.question, 120) };
  }
  return {
    isQuery: false,
    type: parsed.type,
    amount: parsed.amount,
    category: parsed.category,
    date: parsed.date,
    descriptionPreview: preview(parsed.description, 60),
  };
}

module.exports = { log, logError, preview, serializeError, summarizeParsed };
