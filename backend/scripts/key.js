#!/usr/bin/env node
// API key management.
//   npm run key:create -- --name ledger --scope agent
//   npm run key:list
//   npm run key:revoke -- --id 3
//
// Run it where the database lives (on Railway: `railway run` / the service shell)
// so it writes to the same file the server reads.

const { createKey, listKeys, revokeKey, SCOPES } = require('../auth/keys');
const db = require('../db');

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const name = argv[i].slice(2);
    const next = argv[i + 1];
    out[name] = next && !next.startsWith('--') ? next : true;
    if (out[name] !== true) i += 1;
  }
  return out;
}

function usage(code = 1) {
  console.error(`Usage:
  npm run key:create -- --name <label> --scope <${SCOPES.join('|')}>
  npm run key:list
  npm run key:revoke -- --id <id>`);
  process.exitCode = code;
}

const [command, ...rest] = process.argv.slice(2);
const args = flags(rest);

try {
  if (command === 'create') {
    if (typeof args.name !== 'string' || typeof args.scope !== 'string') {
      usage();
    } else {
      const created = createKey({ name: args.name, scope: args.scope });
      console.log(`\nCreated key #${created.id} "${created.name}" (scope: ${created.scope})\n`);
      console.log(`  ${created.key}\n`);
      console.log('This is the only time the key is shown. Store it now; it cannot be recovered.');
      console.log('Send it as:  Authorization: Bearer <key>\n');
    }
  } else if (command === 'list') {
    const keys = listKeys();
    if (!keys.length) console.log('No API keys yet.');
    for (const key of keys) {
      const state = key.revoked_at ? `revoked ${key.revoked_at}` : 'active';
      console.log(`#${key.id}  ${key.name}  [${key.scope}]  stk_${key.prefix}_…  ${state}  last used: ${key.last_used_at || 'never'}`);
    }
  } else if (command === 'revoke') {
    const id = parseInt(args.id, 10);
    if (!Number.isInteger(id)) {
      usage();
    } else {
      const revoked = revokeKey(id);
      if (!revoked) { console.error(`No key with id ${id}`); process.exitCode = 1; }
      else console.log(`Revoked key #${revoked.id} "${revoked.name}" at ${revoked.revoked_at}`);
    }
  } else {
    usage();
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
} finally {
  db.closeDb?.();
}
