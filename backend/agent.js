// Ledger's read surface. Phase 4 adds actions, notify and approvals; for now the
// agent (or a full-scope caller) can read what is waiting for it.

const { listOpenEscalations, listOpenQuestions, channel } = require('./notify');

function mountAgentRoutes(app) {
  // Open escalations (oldest first, with evidence) and open questions.
  app.get('/api/agent/inbox', (_req, res) => {
    res.json({
      ok: true,
      channel: channel(),
      escalations: listOpenEscalations(),
      questions: listOpenQuestions(),
    });
  });
}

module.exports = { mountAgentRoutes };
