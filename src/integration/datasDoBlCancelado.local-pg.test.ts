import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// ADR 0094, B4 (migration 504): a ficha do B/L cancelado não grava as datas do
// container. Antes, `set_container_dates` aceitava a chamada, pulava a linha
// cancelada e gravava a data no mesmo container dos B/Ls irmãos ativos (ou em
// nenhum), e a tela dizia "Data de devolução salva.".

const w = financeWorld(9503)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'set_container_dates'
      AND pg_get_functiondef(oid) LIKE '%504 (ADR 0094, B4)%'`) === '1'
  } catch {
    return false
  }
}, 'migration 504 aplicada')

describeLocal('504 — datas do container do B/L cancelado recusadas na ficha', () => {
  beforeAll(() => {
    w.setup()
  })
  afterAll(() => w.cleanup())

  const dates = (id: string) => w.psql(`SELECT coalesce(discharge_date::text, '-') || '|' || coalesce(return_date::text, '-')
    FROM public.bl_containers WHERE bl_id = '${id}'`)
  const containerOf = (id: string) => w.psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${id}'`)
  const datesAudit = (id: string) => w.psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'bl' AND entity_id = '${id}' AND field_name = 'container_dates'`)

  it('a devolução pela ficha do B/L cancelado é recusada e o B/L irmão ativo fica como está', () => {
    const shared = w.container()
    const active = w.createBl('IRMAO', { container: shared })
    const cancelled = w.createBl('CANC', { container: shared })
    w.asOk('operacoes', `SELECT public.set_container_dates(${containerOf(active)}, '2026-10-01', NULL, NULL)`)
    w.cancelBl(cancelled)

    const result = w.as('operacoes', `SELECT public.set_container_dates(${containerOf(cancelled)}, NULL, '2026-10-10', NULL, true)`)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`B/L ${cancelled} cancelado: somente leitura. Reative para corrigir.`)
    expect(dates(active)).toBe('2026-10-01|-')
    expect(dates(cancelled)).toBe('2026-10-01|-')
    expect(datesAudit(cancelled)).toBe('0')
  })

  it('B/L cancelado sem irmão: a recusa vem do banco, não um sucesso sem gravação', () => {
    const cancelled = w.createBl('SOZINHO')
    w.cancelBl(cancelled)
    const result = w.as('operacoes', `SELECT public.set_container_dates(${containerOf(cancelled)}, '2026-10-01', '2026-10-05', NULL)`)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/cancelado: somente leitura\. Reative para corrigir\./)
    expect(dates(cancelled)).toBe('-|-')
  })

  it('o B/L ativo que divide o container com o cancelado segue gravando pela ficha', () => {
    const shared = w.container()
    const active = w.createBl('ATIVO', { container: shared })
    const cancelled = w.createBl('CANC2', { container: shared })
    w.cancelBl(cancelled)
    w.asOk('operacoes', `SELECT public.set_container_dates(${containerOf(active)}, '2026-10-01', '2026-10-08', NULL)`)
    expect(dates(active)).toBe('2026-10-01|2026-10-08')
    expect(dates(cancelled)).toBe('-|-')
  })
})
