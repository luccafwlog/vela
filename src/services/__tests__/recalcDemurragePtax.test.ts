import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const functionSource = readFileSync(resolve(root, 'supabase/functions/recalc-demurrage-ptax/index.ts'), 'utf8')

describe('recálculo de PTAX', () => {
  it('persiste alerta durável para indisponibilidade e falhas do job', () => {
    expect(functionSource).toContain("'demurrage_ptax_recalc_failed'")
    expect(functionSource).toContain("'exchange_rate_reference'")
    expect(functionSource).toContain("'upsert_alert_item'")
    expect(functionSource).toContain("'resolve_alert_item'")
    expect(functionSource).toContain("'recalc-demurrage-ptax'")

    expect(functionSource).toMatch(/recordPtaxFailure\(supabase,\s*'ptax_unavailable'/)
    expect(functionSource).toMatch(/recordPtaxFailure\(supabase,\s*'reference_failed'/)
    expect(functionSource).toMatch(/recordPtaxFailure\(supabase,\s*'recalc_failed'/)
    expect(functionSource).toMatch(/await\s+resolvePtaxFailure\(supabase,\s*quoteDate\)/)
  })

  it('aceita só POST, o método do job, antes de conferir o segredo (auditoria run-3)', () => {
    const methodGuard = functionSource.indexOf("if (req.method !== 'POST') {")
    expect(methodGuard).toBeGreaterThan(-1)
    expect(methodGuard).toBeLessThan(functionSource.indexOf('timingSafeEqual(bearer, cronSecret)'))
    expect(functionSource).toContain('status: 405')
    // O agendamento vigente chama pela função que usa net.http_post.
    const schedule = readFileSync(resolve(root, 'supabase/migrations/358_baixa_itau_nao_para_em_silencio.sql'), 'utf8')
    expect(schedule).toContain("ops.dispatch_edge_job('recalc-demurrage-ptax', 'RECALC_CRON_SECRET')")
  })

  it('só grava a referência depois de obter uma cotação válida', () => {
    const fetchCall = functionSource.indexOf('quote = await fetchLatestPtax()')
    const referenceCall = functionSource.indexOf("supabase.rpc('save_exchange_rate_reference_v2'")

    expect(fetchCall).toBeGreaterThan(-1)
    expect(referenceCall).toBeGreaterThan(fetchCall)
  })
})
