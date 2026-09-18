#!/usr/bin/env node

// Compatibility entrypoint retained for Claude hooks and existing Codex setup
// scripts. The repository's synchronizer is the only implementation so every
// harness gets the same ownership and pruning rules.

import { syncAll } from './skill-sync.mjs'

const results = syncAll({ pruneOwned: true })

for (const result of results) {
  const summary = result.actions
    .map(({ action, skill }) => `${action} ${skill}`)
    .join(', ')
  const ownershipNote = result.ownershipSource === 'legacy-ledger' ? ' [legacy ownership ledger]' : ''
  console.log(`${result.target}${ownershipNote}: ${summary || 'no changes'}`)
}

if (results.some((result) => !result.ok)) process.exitCode = 1
