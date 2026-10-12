import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const runnerSource = readFileSync(resolve(root, 'supabase/functions/import-effects-runner/index.ts'), 'utf8')
const drainSource = readFileSync(resolve(root, 'supabase/functions/import-effects-runner/drain.ts'), 'utf8')
const migrationSource = readFileSync(resolve(root, 'supabase/migrations/025_import_effect_worker.sql'), 'utf8')

describe('runner dos efeitos pós-commit de import', () => {
  it('faz claim e delega cada efeito a um consumidor SQL protegido', () => {
    expect(drainSource).toContain("'claim_import_effects'")
    expect(drainSource).toContain("'process_import_effect'")
    expect(runnerSource).toContain('IMPORT_EFFECTS_CRON_SECRET')
    expect(runnerSource).toContain('IMPORT_EFFECTS_RUNNER_ENABLED')
    expect(runnerSource).not.toContain('consumer_handlers_pending')
  })

  it('mantém o executor no banco e separa retry transitório de bloqueio', () => {
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.process_import_effect(')
    expect(migrationSource).toContain("WHEN 'physical_flags'")
    expect(migrationSource).toMatch(/WHEN 'provisional_charges',\s*'local_billing'/)
    expect(migrationSource).toContain("WHEN 'demurrage_billing'")
    expect(migrationSource).toContain('complete_import_effect')
    expect(migrationSource).toContain("'unsupported_effect_kind'")
    expect(migrationSource).toContain("'import_effect_blocked'")
    expect(migrationSource).toContain('_record_import_effect_blocked_alert')
    expect(migrationSource).toContain("'retry_wait'")
    expect(migrationSource).toContain("'blocked'")
    expect(migrationSource).toContain("REVOKE ALL ON FUNCTION public.process_import_effect")
    expect(migrationSource).toContain('GRANT EXECUTE ON FUNCTION public.process_import_effect')
  })

  it('declara o disparo periódico sem ativar o consumidor por acidente', () => {
    expect(migrationSource).toContain("'import-effects-runner'")
    expect(migrationSource).toContain("'*/5 * * * *'")
    expect(migrationSource).toContain("ops.dispatch_edge_job('import-effects-runner', 'IMPORT_EFFECTS_CRON_SECRET')")
    expect(runnerSource).toContain("Deno.env.get('IMPORT_EFFECTS_RUNNER_ENABLED')")
  })
})
