// Notices when the iOS Shortcut has quietly stopped sending SMS.
//
// If the last SMS arrived more than HEARTBEAT_HOURS ago (default 72) AND the
// last 30 days averaged at least one SMS a day, that silence is unusual and
// raises one `heartbeat_missing` escalation per silent stretch.

const db = require('../db');
const { escalate } = require('../notify');
const { now } = require('../time');

const DAY_MS = 24 * 60 * 60 * 1000;

function heartbeatHours() {
  const n = Number(process.env.HEARTBEAT_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 72;
}

async function checkHeartbeat(deps = {}) {
  const at = now();
  const last = db.lastSmsReceivedAt();
  if (!last) return { checked: true, silent: false, reason: 'no_sms_yet' };

  const silentHours = (at.getTime() - Date.parse(last)) / (60 * 60 * 1000);
  if (!(silentHours > heartbeatHours())) return { checked: true, silent: false, silentHours };

  // The rate is measured over the 30 days before the silence began.
  const since = new Date(Date.parse(last) - 30 * DAY_MS).toISOString();
  const perDay = db.countSmsReceivedSince(since) / 30;
  if (perDay < 1) return { checked: true, silent: false, silentHours, perDay, reason: 'quiet_account' };

  const result = await escalate({
    type: 'heartbeat_missing',
    severity: 'high',
    evidence: {
      summary: `No bank SMS for ${Math.floor(silentHours)} hours, but the 30 days before that averaged ${perDay.toFixed(1)} a day.`,
      last_sms_at: last,
      silent_hours: Math.floor(silentHours),
      average_per_day: Number(perDay.toFixed(2)),
    },
    // One escalation per silent stretch: the key is the last SMS we did get.
    dedupeKey: `heartbeat_missing:${last}`,
  }, deps);
  return { checked: true, silent: true, silentHours, perDay, created: result.created };
}

function startHeartbeat({ intervalMs = 60 * 60 * 1000 } = {}) {
  const run = () => checkHeartbeat().catch((err) => console.error('[heartbeat]', err.message));
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { checkHeartbeat, startHeartbeat, heartbeatHours };
