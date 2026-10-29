// Where prompts, questions and alerts go.
//
// NOTIFY_CHANNEL=ledger (default)  -> written to the `questions` / `escalations` tables
//                                     for Ledger to read over the API
// NOTIFY_CHANNEL=telegram          -> the original Telegram flow (Kash), unchanged.
//                                     Escalations are also pushed to the Telegram chat.
//
// Detection stays in code. This module only decides who gets told.

const crypto = require('crypto');
const db = require('../db').connection;
const { isoNow } = require('../time');
const { log } = require('../logger');

const ESCALATION_TYPES = [
  'needs_review_stale',
  'balance_gap',
  'anomaly',
  'income_anomaly',
  'low_balance',
  'aggregator_unplanned',
  'heartbeat_missing',
  'parser_failure',
];
const SEVERITIES = ['low', 'medium', 'high'];

function channel() {
  return String(process.env.NOTIFY_CHANNEL || 'ledger').trim().toLowerCase() === 'telegram'
    ? 'telegram'
    : 'ledger';
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function hydrateEscalation(row) {
  return row ? { ...row, evidence: parseJson(row.evidence, {}) } : null;
}

function hydrateQuestion(row) {
  return row ? { ...row, options: parseJson(row.options, null) } : null;
}

function describeEscalation(row) {
  const evidence = row.evidence || {};
  const detail = evidence.summary || evidence.message || '';
  return `⚠️ ${row.type.replace(/_/g, ' ')}${detail ? `: ${detail}` : ''}`;
}

// Records an escalation. A repeated dedupe_key returns the existing row, so
// detectors can run on every ingest without piling up duplicates.
async function escalate({ type, severity = 'medium', evidence = {}, dedupeKey = null }, deps = {}) {
  if (!ESCALATION_TYPES.includes(type)) throw new Error(`Unknown escalation type: ${type}`);
  if (!SEVERITIES.includes(severity)) throw new Error(`Unknown severity: ${severity}`);

  const inserted = db.prepare(`
    INSERT OR IGNORE INTO escalations (type, severity, evidence, status, dedupe_key, created_at)
    VALUES (?, ?, ?, 'open', ?, ?)
  `).run(type, severity, JSON.stringify(evidence), dedupeKey, isoNow());

  const row = hydrateEscalation(
    inserted.changes
      ? db.prepare('SELECT * FROM escalations WHERE id = ?').get(inserted.lastInsertRowid)
      : db.prepare('SELECT * FROM escalations WHERE dedupe_key = ?').get(dedupeKey)
  );
  const created = inserted.changes > 0;
  if (created) log('info', 'Notify', 'escalation_created', { id: row.id, type, severity, channel: channel() });

  if (created && process.env.LEDGER_WEBHOOK_URL) {
    try { await postLedgerWebhook(row); } catch (err) {
      log('warn', 'Notify', 'ledger_webhook_failed', { id: row.id, error: err.message });
    }
  }

  if (created && channel() === 'telegram') {
    const chatId = deps.chatId || process.env.MY_TELEGRAM_CHAT_ID;
    if (chatId) {
      const send = deps.sendMessage || ((id, text) => require('../telegram').sendMessage(id, text));
      try { await send(chatId, describeEscalation(row)); } catch (err) {
        log('warn', 'Notify', 'telegram_escalation_failed', { id: row.id, error: err.message });
      }
    }
  }
  return { created, escalation: row };
}

// Records a question for the user. `options` is free-form JSON; the SMS flow uses
// { kind: 'category' | 'note' | 'mute', choices: [...] }.
function ask({ subject, subjectId = null, prompt, options = null, priority = 0, dedupeKey = null }) {
  if (!['txn', 'account', 'payer', 'gap', 'plan'].includes(subject)) {
    throw new Error(`Unknown question subject: ${subject}`);
  }
  if (!String(prompt || '').trim()) throw new Error('prompt is required');

  const inserted = db.prepare(`
    INSERT OR IGNORE INTO questions (subject, subject_id, prompt, options, priority, dedupe_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(subject, subjectId, prompt, options == null ? null : JSON.stringify(options), priority, dedupeKey, isoNow());

  const row = hydrateQuestion(
    inserted.changes
      ? db.prepare('SELECT * FROM questions WHERE id = ?').get(inserted.lastInsertRowid)
      : db.prepare('SELECT * FROM questions WHERE dedupe_key = ?').get(dedupeKey)
  );
  if (inserted.changes) log('info', 'Notify', 'question_created', { id: row.id, subject, subjectId });
  return { created: inserted.changes > 0, question: row };
}

async function postLedgerWebhook(escalation) {
  const url = process.env.LEDGER_WEBHOOK_URL;
  if (!url) return;
  const body = JSON.stringify({
    type: 'escalation',
    escalation: {
      id: escalation.id,
      type: escalation.type,
      severity: escalation.severity,
      status: escalation.status,
      evidence: escalation.evidence,
      created_at: escalation.created_at,
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = process.env.LEDGER_WEBHOOK_SECRET || '';
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-timestamp': timestamp,
      'x-signature': `sha256=${signature}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Ledger webhook ${res.status}`);
}

function listOpenEscalations(limit = 100) {
  return db.prepare(`
    SELECT * FROM escalations WHERE status = 'open' ORDER BY created_at ASC, id ASC LIMIT ?
  `).all(limit).map(hydrateEscalation);
}

function listOpenQuestions(limit = 100) {
  return db.prepare(`
    SELECT * FROM questions WHERE resolution IS NULL ORDER BY priority DESC, created_at ASC, id ASC LIMIT ?
  `).all(limit).map(hydrateQuestion);
}

module.exports = {
  ESCALATION_TYPES,
  channel,
  escalate,
  ask,
  listOpenEscalations,
  listOpenQuestions,
};
