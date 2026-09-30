import test from 'node:test'
import assert from 'node:assert/strict'

import { decodeEnvDocument, decodeEnvLine, maskCommands } from './load-branch-env.mjs'

// Trava de regressão do provisionamento da Preview (PR 652): o
// `supabase branches get -o env` emite `KEY="valor"` e o $GITHUB_ENV precisa
// receber o valor sem as aspas literais — com elas, o provision-preview-admin
// quebrava em `Invalid supabaseUrl` e o qa-admin nunca era criado.

test('remove as aspas duplas do formato dotenv', () => {
  assert.deepEqual(decodeEnvLine('SUPABASE_URL="https://cabhtbujbfaaywjlvfia.supabase.co"'), [
    'SUPABASE_URL',
    'https://cabhtbujbfaaywjlvfia.supabase.co',
  ])
})

test('preserva valor sem aspas como está', () => {
  assert.deepEqual(decodeEnvLine('FOO=bar'), ['FOO', 'bar'])
  assert.deepEqual(decodeEnvLine('EMPTY='), ['EMPTY', ''])
})

test('desfaz escapes dentro das aspas', () => {
  assert.deepEqual(decodeEnvLine('A="a\\"b\\\\c"'), ['A', 'a"b\\c'])
})

test('não toca em aspa simples nem em aspa desemparelhada', () => {
  assert.deepEqual(decodeEnvLine(`A='quoted'`), ['A', `'quoted'`])
  assert.deepEqual(decodeEnvLine('A="aberto'), ['A', '"aberto'])
})

test('ignora linhas vazias e comentários no documento', () => {
  assert.deepEqual(decodeEnvDocument('\n# comentario\nA="1"\n\nB=2\n'), [
    ['A', '1'],
    ['B', '2'],
  ])
})

test('aborta em linha fora do formato KEY=valor', () => {
  assert.throws(() => decodeEnvLine('sem-igual'), /Linha inesperada/)
})

test('aborta em valor com aspas inválidas em vez de corromper', () => {
  assert.throws(() => decodeEnvLine('A="\\q"'), /aspas inválidas/)
})

test('mascara no log toda credencial da branch antes de exportar', () => {
  assert.deepEqual(maskCommands([['SUPABASE_SERVICE_ROLE_KEY', 'eyJ-segredo-longo'], ['FLAG', 'true']]), [
    '::add-mask::eyJ-segredo-longo',
  ])
})
