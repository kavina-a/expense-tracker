const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const backendDir = path.join(__dirname, '..');

// db.js migrates on require, so each "boot" is a separate process.
function boot(dbPath) {
  const result = spawnSync(process.execPath, ['-e', "require('./db').closeDb()"], {
    cwd: backendDir,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function backupsIn(dir) {
  const backups = path.join(dir, 'backups');
  return fs.existsSync(backups) ? fs.readdirSync(backups).filter((f) => f.endsWith('.db')) : [];
}

describe('migration backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suspense-migration-'));
  const dbPath = path.join(dir, 'expenses.db');

  it('does not back up a brand-new database', () => {
    const out = boot(dbPath);
    assert.match(out, /Applied migration 001_auth_sessions_notify/);
    assert.doesNotMatch(out, /Backing up/);
    assert.deepEqual(backupsIn(dir), []);
  });

  it('logs the backup path, writes a readable copy, then migrates', () => {
    // Make this look like a database from before the release: it holds data and
    // has never recorded the migration.
    const old = new Database(dbPath);
    old.prepare(`
      INSERT INTO transactions (amount, type, category, date, created_at)
      VALUES (1234.5, 'expense', 'Food', '2026-10-01', '2026-10-01T00:00:00Z')
    `).run();
    old.exec('DROP TABLE schema_migrations');
    old.close();

    const out = boot(dbPath);
    const backupLine = out.indexOf('Backing up before migration 001_auth_sessions_notify');
    const appliedLine = out.indexOf('Applied migration 001_auth_sessions_notify');
    assert.ok(backupLine >= 0, 'backup path is logged');
    assert.ok(backupLine < appliedLine, 'backup is logged before the migration runs');

    const files = backupsIn(dir);
    assert.equal(files.length, 1);
    assert.match(out, new RegExp(files[0].replace(/\./g, '\\.')));

    const copy = new Database(path.join(dir, 'backups', files[0]), { readonly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 1);
    copy.close();
  });

  it('keeps existing data and does not back up again once migrated', () => {
    const before = backupsIn(dir).length;
    const out = boot(dbPath);
    assert.doesNotMatch(out, /Backing up/);
    assert.equal(backupsIn(dir).length, before);

    const live = new Database(dbPath, { readonly: true });
    const row = live.prepare('SELECT amount, category FROM transactions').get();
    assert.deepEqual({ ...row }, { amount: 1234.5, category: 'Food' });
    live.close();
  });
});
