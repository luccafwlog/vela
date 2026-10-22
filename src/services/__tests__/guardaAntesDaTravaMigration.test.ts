import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Migration 408 (R-11): o usuário sem permissão é recusado antes de a RPC
// travar a Viagem, para não segurar a importação de quem tem permissão.
// Contrato de texto SQL; o comportamento das RPCs está nas suítes local-pg.
const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/408_melhorias_da_revisao_da_pr_1021.sql'), 'utf8')

function body(name: string) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, name).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf('$function$;', start))
}

describe('408 — guarda de permissão antes da trava da Viagem', () => {
  it.each([
    'apply_ce_mercante_rows_atomic',
    'import_breakbulk_manifest_transactional',
    'import_granite_manifest_transactional',
  ])('%s recusa com 42501 antes de qualquer trava', (name) => {
    const text = body(name)
    const guard = text.indexOf("ERRCODE = '42501'")
    const lock = text.search(/_lock_import_|pg_advisory_xact_lock|FOR UPDATE|_core_|_legacy_/)
    expect(guard).toBeGreaterThan(0)
    expect(lock === -1 || guard < lock).toBe(true)
  })
})
