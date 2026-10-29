// The transaction state machine.
//
//   provisional -> posted | voided      a card hold settles, or is cancelled
//   posted      -> voided | refunded    a reversal, or the whole amount came back
//   voided / refunded -> posted         an undo (only a person or Ledger may do this)
//
// Rows written before this existed use status 'reversed'; they are read as 'voided'.
// Every change is written to transaction_events with who made it and why.

const db = require('../db').connection;
const { isoNow } = require('../time');

const STATES = ['provisional', 'posted', 'voided', 'refunded'];
const ACTORS = ['system', 'user', 'ledger'];

const EDGES = {
  provisional: ['posted', 'voided'],
  posted: ['voided', 'refunded'],
  voided: [],
  refunded: [],
};
const RESTORE_EDGES = { voided: ['posted'], refunded: ['posted'] };

function normalizeState(status) {
  if (status === 'reversed') return 'voided';
  return status || 'posted';
}

function recordEvent(transactionId, { from = null, to = null, actor = 'system', reason = null, data = null }) {
  db.prepare(`
    INSERT INTO transaction_events (transaction_id, from_state, to_state, actor, reason, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(transactionId, from, to, actor, reason, data == null ? null : JSON.stringify(data), isoNow());
}

function canTransition(from, to, actor = 'system') {
  const f = normalizeState(from);
  if (EDGES[f]?.includes(to)) return true;
  return actor !== 'system' && Boolean(RESTORE_EDGES[f]?.includes(to));
}

// Moves a transaction to a new state. Throws on an edge the machine doesn't allow.
function transition(transactionId, to, { actor = 'system', reason = null, data = null } = {}) {
  if (!STATES.includes(to)) throw new Error(`Unknown state: ${to}`);
  if (!ACTORS.includes(actor)) throw new Error(`Unknown actor: ${actor}`);
  return db.transaction(() => {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
    if (!tx) throw new Error(`Transaction ${transactionId} not found`);
    const from = normalizeState(tx.status);
    if (from === to) return tx;
    if (!canTransition(from, to, actor)) {
      const err = new Error(`Illegal transition ${from} -> ${to}`);
      err.code = 'ILLEGAL_TRANSITION';
      throw err;
    }
    db.prepare('UPDATE transactions SET status = ? WHERE id = ?').run(to, transactionId);
    recordEvent(transactionId, { from, to, actor, reason, data });
    return db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
  })();
}

function listEvents(transactionId) {
  return db.prepare('SELECT * FROM transaction_events WHERE transaction_id = ? ORDER BY id').all(transactionId)
    .map((row) => ({ ...row, data: row.data ? JSON.parse(row.data) : null }));
}

module.exports = {
  STATES, ACTORS, EDGES, normalizeState, canTransition, transition, recordEvent, listEvents,
};
