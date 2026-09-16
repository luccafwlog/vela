import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')

function readTerminalizedScheduleMigration() {
  const filename = readdirSync(migrationsDir).find((entry) => /^049_.*terminalized.*schedule.*\.sql$/i.test(entry))
  expect(filename, 'migration 049 de persistência da escala terminalizada').toBeTruthy()
  return readFileSync(join(migrationsDir, filename!), 'utf8')
}

describe('contrato da persistência de escala terminalizada', () => {
  it('mantém o RPC público como wrapper atômico e preserva o corpo anterior como helper privado', () => {
    const sql = readTerminalizedScheduleMigration()

    expect(sql).toMatch(/DO\s+\$\$[\s\S]*?ALTER FUNCTION public\.save_voyage_escala_terminal_state_v2\([\s\S]*?\)\s+RENAME TO save_voyage_escala_terminal_state_v2_legacy_049[\s\S]*?END\s*\$\$/i)
    expect(sql).toContain('to_regprocedure(\'public.save_voyage_escala_terminal_state_v2_legacy_049')
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.save_voyage_escala_terminal_state_v2\(/i)
    expect(sql).toMatch(/LANGUAGE plpgsql\s+SECURITY DEFINER[\s\S]*?SET search_path TO 'public', 'pg_temp'/i)
    expect(sql).toContain('public.save_voyage_escala_terminal_state_v2_legacy_049(')
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.save_voyage_escala_terminal_state_v2_legacy_049\(/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.save_voyage_escala_terminal_state_v2\(/i)
  })

  it('persiste cada campo do snapshot POD e é idempotente após o corpo legado', () => {
    const sql = readTerminalizedScheduleMigration()

    expect(sql).toMatch(/v_schedule\s*:=\s*p_export_expectation->'schedule'/i)
    expect(sql).toMatch(/FOREACH v_schedule_field IN ARRAY ARRAY\[[\s\S]*'eta'[\s\S]*'etb'[\s\S]*'ata'[\s\S]*'atb'[\s\S]*'etd'[\s\S]*'atd'[\s\S]*'rtw'[\s\S]*'ces'[\s\S]*'linked'[\s\S]*'escala_number'[\s\S]*'tem_importacao'[\s\S]*'deleted'/i)
    expect(sql).toMatch(/SELECT al\.new_value[\s\S]*FROM public\.audit_logs AS al[\s\S]*ORDER BY al\.changed_at DESC, al\.id DESC/i)
    expect(sql).toMatch(/IF v_schedule_old_value IS DISTINCT FROM v_schedule_new_value THEN[\s\S]*INSERT INTO public\.audit_logs/i)
    expect(sql).toMatch(/IF COALESCE\(\(v_result->>'blocked'\)::BOOLEAN, FALSE\) THEN[\s\S]*RETURN v_result/i)
  })
})
