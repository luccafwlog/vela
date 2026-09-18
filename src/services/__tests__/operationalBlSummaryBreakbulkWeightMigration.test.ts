import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/063_operational_bl_summary_breakbulk_weight.sql'),
  'utf8',
)

describe('migration 063 — separação de breakbulkWeightTon no operational_list_bl_summary', () => {
  it('contém a função operational_list_bl_summary com separação explícita de pesos', () => {
    expect(migrationSql).toMatch(/CREATE OR REPLACE FUNCTION\s+public\.operational_list_bl_summary/i)
    expect(migrationSql).toContain("'breakbulkWeightTon', coalesce(sum(bb_weight_ton), 0)")
    expect(migrationSql).toContain(
      "'totalWeightTon', coalesce(sum(coalesce(total_weight_kg, 0) / 1000 + coalesce(bb_weight_ton, 0)), 0)",
    )
    expect(migrationSql).toMatch(/SECURITY INVOKER/i)
    expect(migrationSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.operational_list_bl_summary/i)
  })
})
