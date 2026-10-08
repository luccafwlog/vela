import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveSupabaseBranch } from './resolve-supabase-branch.mjs'

const listing = [
  { id: 'main-id', name: 'main', git_branch: 'main' },
  { id: 'manual-id', name: 'Auditoria00-005', git_branch: 'claude/auditoria-contrato-etapas-00-05' },
  { id: 'auto-id', name: 'feature-x', git_branch: null },
]

test('acha a branch criada à mão pela branch Git vinculada', () => {
  assert.equal(resolveSupabaseBranch(listing, 'claude/auditoria-contrato-etapas-00-05'), 'manual-id')
})

test('aceita o nome exato de uma branch sem vínculo Git', () => {
  assert.equal(resolveSupabaseBranch(listing, 'feature-x'), 'auto-id')
})

test('devolve null quando nenhuma branch corresponde', () => {
  assert.equal(resolveSupabaseBranch(listing, 'outra'), null)
  assert.equal(resolveSupabaseBranch({ branches: [] }, 'main'), null)
})
