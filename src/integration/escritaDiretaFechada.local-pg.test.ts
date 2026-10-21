import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// ADR 0094, B1 e B4 (migration 380): só as funções do sistema gravam nas
// tabelas de carga; a tela grava direto só `unpacking_location` e `natureza`.
// B/L cancelado é somente leitura também nos containers e veículos, e a
// planilha de datas grava só nos B/Ls ativos do container.

const w = financeWorld(9316)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'guard_cancelled_bl_cargo'`) === '1'
  } catch {
    return false
  }
}, 'migration 380 aplicada')

describeLocal('380 — escrita direta fechada e B/L cancelado somente leitura', () => {
  beforeAll(() => {
    w.setup()
    w.table(1000)
  })
  afterAll(() => w.cleanup())

  const can = (table: string, privilege: string) => w.psql(`SELECT has_table_privilege('authenticated', 'public.${table}', '${privilege}')`)
  const canColumn = (table: string, column: string) => w.psql(`SELECT has_column_privilege('authenticated', 'public.${table}', '${column}', 'UPDATE')`)

  it('authenticated não grava direto nas tabelas de carga; só as colunas da tela', () => {
    for (const table of ['bl_containers', 'baplie_containers', 'vehicles', 'vazios_bookings', 'vazios_importacao_containers',
      'vazios_importacao_manifests', 'vazios_manifests', 'granite_bls', 'granite_manifests']) {
      expect(can(table, 'INSERT'), table).toBe('f')
      expect(can(table, 'UPDATE'), table).toBe('f')
    }
    expect(canColumn('bl_containers', 'unpacking_location')).toBe('t')
    expect(canColumn('bl_containers', 'discharge_date')).toBe('f')
    expect(canColumn('vazios_importacao_containers', 'natureza')).toBe('t')
    expect(can('vazios_export_operations', 'INSERT')).toBe('t')
    expect(can('vazios_export_service_lines', 'UPDATE')).toBe('t')

    const id = w.createBl('COL')
    const container = w.psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${id}'`)
    w.asOk('operacoes', `UPDATE public.bl_containers SET unpacking_location = 'Armazém 3' WHERE id = ${container}`)
    expect(w.as('operacoes', `UPDATE public.bl_containers SET seal_number = 'X1' WHERE id = ${container}`).stderr).toMatch(/permission denied/)
    expect(w.as('operacoes', `INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${w.container()}', '22G1')`).stderr)
      .toMatch(/permission denied/)
  })

  it('B/L cancelado: containers e veículos ficam como estão; o status de Demurrage segue', () => {
    const id = w.createBl('CANC')
    w.cancelBl(id)
    const container = w.psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${id}'`)
    const refused = /cancelado é somente leitura/
    expect(() => w.psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${w.container()}', '22G1')`)).toThrow(refused)
    expect(() => w.psql(`UPDATE public.bl_containers SET seal_number = 'S9' WHERE id = ${container}`)).toThrow(refused)
    expect(() => w.psql(`DELETE FROM public.bl_containers WHERE id = ${container}`)).toThrow(refused)
    expect(() => w.psql(`INSERT INTO public.vehicles (bl_id, chassis, voyage_id) VALUES ('${id}', 'FF9316CHASSI0001', ${w.voyageId})`)).toThrow(refused)
    w.psql(`UPDATE public.bl_containers SET demurrage_status = demurrage_status WHERE id = ${container}`)
  })

  it('planilha de datas: a data vai ao B/L ativo do container e nunca ao cancelado', () => {
    const shared = w.container()
    const active = w.createBl('DATA-A', { container: shared })
    const cancelled = w.createBl('DATA-C', { container: shared })
    w.cancelBl(cancelled)
    const result = JSON.parse(w.asOk('operacoes', `SELECT public.apply_container_dates_batch_atomic(gen_random_uuid(),
      '[{"bl_id":"${cancelled}","rows":[{"container_number":"${shared}","discharge_date":"2026-10-01","return_date":null}]}]'::jsonb,
      '${w.actors.operacoes}'::uuid)`)) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(w.psql(`SELECT coalesce(discharge_date::text, 'null') FROM public.bl_containers WHERE bl_id = '${active}'`)).toBe('2026-10-01')
    expect(w.psql(`SELECT coalesce(discharge_date::text, 'null') FROM public.bl_containers WHERE bl_id = '${cancelled}'`)).toBe('null')
  })
})
