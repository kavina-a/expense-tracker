// Kash follow-up state. When the bot asks "how much was it?", the next message
// is merged with the original. Stored in SQLite so a Railway restart doesn't
// drop a half-finished entry, and expires after 10 minutes.

const db = require('./db').connection;
const { now } = require('./time');

const PENDING_TTL_MS = 10 * 60 * 1000;

function keyOf(channel, chatId) {
  return { channel: String(channel), chat_id: String(chatId ?? 'default') };
}

function purgeExpired() {
  db.prepare('DELETE FROM pending_clarifications WHERE expires_at <= ?').run(now().toISOString());
}

function getPending(channel, chatId) {
  const { channel: ch, chat_id } = keyOf(channel, chatId);
  const row = db.prepare(
    'SELECT text, created_at, expires_at FROM pending_clarifications WHERE channel = ? AND chat_id = ?'
  ).get(ch, chat_id);
  if (!row) return null;
  if (Date.parse(row.expires_at) <= now().getTime()) {
    clearPending(channel, chatId);
    return null;
  }
  return { text: row.text, at: Date.parse(row.created_at) };
}

function setPending(channel, chatId, text) {
  const { channel: ch, chat_id } = keyOf(channel, chatId);
  const created = now();
  purgeExpired();
  db.prepare(`
    INSERT INTO pending_clarifications (channel, chat_id, text, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(channel, chat_id) DO UPDATE SET
      text = excluded.text,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `).run(ch, chat_id, String(text), created.toISOString(), new Date(created.getTime() + PENDING_TTL_MS).toISOString());
}

function clearPending(channel, chatId) {
  const { channel: ch, chat_id } = keyOf(channel, chatId);
  db.prepare('DELETE FROM pending_clarifications WHERE channel = ? AND chat_id = ?').run(ch, chat_id);
}

module.exports = { PENDING_TTL_MS, getPending, setPending, clearPending };
