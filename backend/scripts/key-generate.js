#!/usr/bin/env node
// Makes keys on YOUR machine without touching any database, so nothing secret
// ever has to be typed into a server shell.
//
//   npm run key:generate                      # makes the usual pair: ledger (agent) + shortcut (ingest)
//   npm run key:generate -- --name x --scope full
//
// It prints each key once, plus the API_KEY_SEEDS line to paste into Railway.
// The server stores only the hashes.

const { generateKey, seedEntry, SCOPES } = require('../auth/keygen');

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    out[argv[i].slice(2)] = next && !next.startsWith('--') ? next : true;
    if (out[argv[i].slice(2)] !== true) i += 1;
  }
  return out;
}

const args = flags(process.argv.slice(2));
let specs;
if (args.name || args.scope) {
  if (typeof args.name !== 'string' || typeof args.scope !== 'string') {
    console.error(`Usage: npm run key:generate -- --name <label> --scope <${SCOPES.join('|')}>`);
    process.exit(1);
  }
  specs = [{ name: args.name, scope: args.scope }];
} else {
  specs = [{ name: 'ledger', scope: 'agent' }, { name: 'shortcut', scope: 'ingest' }];
}

try {
  const keys = specs.map(generateKey);
  console.log('\nKeys (shown once; save them in your password manager):\n');
  for (const k of keys) console.log(`  ${k.name.padEnd(10)} [${k.scope}]  ${k.key}`);
  console.log('\nIn Railway -> Variables, set API_KEY_SEEDS to (hashes only, safe to store):\n');
  console.log(`  ${keys.map(seedEntry).join(',')}`);
  console.log('\nIf API_KEY_SEEDS already has entries, append these after a comma.');
  console.log('Send a key as:  Authorization: Bearer <key>\n');
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
