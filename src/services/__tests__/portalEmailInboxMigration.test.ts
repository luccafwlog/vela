import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const migrationPath = resolve(root, 'supabase/migrations/022_email_inbox_and_dispatch_state.sql')
const runnerPath = resolve(root, 'supabase/functions/portal-email-events-runner/index.ts')

describe('S07 — inbox durável de eventos do Portal', () => {
  it('declara estado, histórico append-only e RPCs de claim/processamento', () => {
    expect(existsSync(migrationPath)).toBe(true)

    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('ALTER TABLE public.portal_email_events')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.portal_email_event_attempts')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.claim_portal_email_events')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.process_portal_email_event')
    expect(sql).toContain('FOR UPDATE SKIP LOCKED')
    expect(sql).toContain("status IN ('pending', 'processing', 'retry_wait', 'processed', 'failed', 'investigate')")
  })

  it('expõe runner autenticado por segredo e sem ativar consumidores incompletos', () => {
    expect(existsSync(runnerPath)).toBe(true)

    const runner = readFileSync(runnerPath, 'utf8')
    expect(runner).toContain('PORTAL_EMAIL_EVENTS_CRON_SECRET')
    expect(runner).toContain("admin.rpc('claim_portal_email_events'")
    expect(runner).toContain('processPortalEmailEvent(admin')
    expect(runner).not.toContain('consumer_handlers_pending')
  })

  it('reusa tentativa de envio quando a chave de idempotência já existe', () => {
    const portalEmail = readFileSync(resolve(root, 'supabase/functions/_shared/portalEmail.ts'), 'utf8')
    expect(portalEmail).toContain("if (error?.code === '23505')")
    expect(portalEmail).toContain(".eq('idempotency_key', idempotencyKey)")
    expect(portalEmail).toContain('existing: true')
  })
})

describe('agendamento dos runners (107)', () => {
  it('testa a função de disparo pela assinatura e agenda os dois runners', () => {
    const sql = readFileSync(resolve(root, 'supabase/migrations/107_schedule_email_events_and_import_effects_runners.sql'), 'utf8')
    expect(sql).toContain("to_regprocedure('ops.dispatch_edge_job(text,text,text,text)')")
    expect(sql).toContain("ops.dispatch_edge_job('portal-email-events-runner', 'PORTAL_EMAIL_EVENTS_CRON_SECRET')")
    expect(sql).toContain("ops.dispatch_edge_job('import-effects-runner', 'IMPORT_EFFECTS_CRON_SECRET')")
  })

  it('não usa to_regproc com assinatura em migration nova (sempre NULL no Postgres)', () => {
    // 022 e 025 são históricas e protegidas; 107 corrige o efeito delas.
    const dir = resolve(root, 'supabase/migrations')
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith('.sql') && !/^0(22|25)_/.test(name))
      .filter((name) => /to_regproc\('[^']*\(/.test(readFileSync(resolve(dir, name), 'utf8')))
    expect(offenders).toEqual([])
  })
})
