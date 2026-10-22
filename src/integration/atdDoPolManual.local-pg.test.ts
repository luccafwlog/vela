import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Lote 7 do plano docs/plans/2026-10-21-frente-das-importacoes.md (migration
// 401; ADR 0095, decisão 23; F-48): o ATD do POL corrigido à mão não é
// recalculado pela importação de B/L nem pelo cancelamento; o ATD derivado
// conta só B/Ls ativos; cancelar e reativar recalculam; apagar o ATD à mão
// devolve o cálculo pelos B/Ls. Chama a RPC da tela
// (`import_bl_freight_file_atomic`) e grava a correção manual como a tela
// (`saveVoyagePolSchedule`, que grava pela RPC `record_audit_entries` como o operador desde a 404).

const w = financeWorld(9401)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return w.psql(`SELECT count(*) FROM pg_proc WHERE proname = 'import_bl_freight_file_atomic'`) === '1'
  } catch {
    return false
  }
}, 'importação de B/L aplicada')

function cleanupExtra() {
  w.psql(`SET session_replication_role = replica;
    DO $$ BEGIN IF to_regclass('public.voyage_pol_atd_manual') IS NOT NULL THEN
      DELETE FROM public.voyage_pol_atd_manual WHERE voyage_id = ${w.voyageId}; END IF; END $$;
    DELETE FROM public.audit_logs WHERE entity_type = 'voyage_pol_schedule' AND entity_id LIKE '${w.voyageId}::%';
    DELETE FROM public.import_batches WHERE voyage_id = ${w.voyageId};
    SET session_replication_role = origin;`)
}

describeLocal('401 — ATD do POL: correção manual vence e só B/Ls ativos contam', () => {
  let cnpj = ''
  let previousRoe = ''

  beforeAll(() => {
    cleanupExtra()
    w.setup()
    previousRoe = w.psql(`SELECT coalesce(roe::text, '') || '|' || coalesce(effective_date::text, '') FROM public.exchange_rate_reference WHERE id = 1`)
    w.psql(`INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, 5, CURRENT_DATE)
      ON CONFLICT (id) DO UPDATE SET roe = EXCLUDED.roe, effective_date = EXCLUDED.effective_date`)
    w.table(1000)
    cnpj = w.psql(`SELECT cnpj_cpf FROM public.customers WHERE id = ${w.customerId}`)
  })
  afterAll(() => {
    if (previousRoe) {
      const [roe, date] = previousRoe.split('|')
      w.psql(`UPDATE public.exchange_rate_reference SET roe = ${roe}, effective_date = '${date}' WHERE id = 1`)
    }
    cleanupExtra()
    w.cleanup()
  })

  /** B/L gravado na Viagem com POL e Laden on Board. */
  function blAt(name: string, pol: string, laden: string) {
    const id = w.createBl(name)
    w.psql(`UPDATE public.bls SET pol = '${pol}', laden_on_board = '${laden}' WHERE id = '${id}'`)
    return id
  }
  /** Linha do arquivo como a tela monta. */
  function line(id: string, pol: string, laden: string) {
    const container = w.psql(`SELECT container_number FROM public.bl_containers WHERE bl_id = '${id}' LIMIT 1`)
    return {
      id, voyage_id: w.voyageId, pol, pod: w.pod, cargo_mode: 'container', laden_on_board: laden,
      customer_id: w.customerId, customer_reconciliation_status: 'matched_document',
      manifest_customer_cnpj_cpf: cnpj, manifest_customer_name: 'Cliente FF9401-0',
      billing_impact: false, override_billing: false,
      containers: [{ container_number: container, type: '22G1', gross_weight_kg: 12000, cbm: 30 }],
      total_weight_kg: 12000, total_cbm: 30,
    }
  }
  function importOk(lines: unknown[]) {
    const result = w.as('administrativo', `SELECT public.import_bl_freight_file_atomic($json$${JSON.stringify(lines)}$json$::jsonb, '${w.actors.administrativo}'::uuid, NULL)`)
    expect(result.status, result.stderr).toBe(0)
  }
  /** ATD do POL como a tela lê: a última gravação no Histórico. */
  function atd(pol: string): string {
    return w.psql(`SELECT coalesce((SELECT coalesce(new_value, 'null') FROM public.audit_logs
      WHERE entity_type = 'voyage_pol_schedule' AND entity_id = '${w.voyageId}::${pol}' AND field_name = 'atd'
      ORDER BY changed_at DESC, id DESC LIMIT 1), 'none')`)
  }
  function lastJustification(pol: string): string {
    return w.psql(`SELECT justification FROM public.audit_logs
      WHERE entity_type = 'voyage_pol_schedule' AND entity_id = '${w.voyageId}::${pol}' AND field_name = 'atd'
      ORDER BY changed_at DESC, id DESC LIMIT 1`)
  }
  /** Correção manual pela tela (Rotas e Manifestos → Editar). */
  function manualAtd(pol: string, value: string | null) {
    w.asOk('operacoes', `SELECT public.record_audit_entries(jsonb_build_array(jsonb_build_object(
      'entity_type', 'voyage_pol_schedule', 'entity_id', '${w.voyageId}::${pol}', 'field_name', 'atd',
      'old_value', NULL, 'new_value', ${value ? `'${value}'` : 'NULL'}, 'justification', 'Atualizacao manual de ATD por POL')))`)
  }

  it('cancelar o B/L de menor Laden on Board recalcula o ATD; reativar volta; a importação ignora o cancelado', () => {
    const pol = 'CNSHA'
    const a = blAt('A1', pol, '2026-07-12')
    const b = blAt('B1', pol, '2026-07-09')
    importOk([line(a, pol, '2026-07-12')])
    expect(atd(pol)).toBe('2026-07-09')

    expect(w.cancelBl(b, 'Reemitido')).toMatchObject({ cancelled: true })
    expect(atd(pol)).toBe('2026-07-12')
    expect(lastJustification(pol)).toContain(`B/L ${b} cancelado`)

    importOk([line(a, pol, '2026-07-11')])
    expect(atd(pol)).toBe('2026-07-11')

    w.asOk('administrativo', `RESET ROLE; SELECT public.reactivate_bl('${b}', 'Cancelado por engano')`)
    expect(atd(pol)).toBe('2026-07-09')
    expect(lastJustification(pol)).toContain(`B/L ${b} reativado`)
  })

  it('a correção manual marca o POL e vence a importação e o cancelamento', () => {
    const pol = 'CNNGB'
    const a = blAt('A2', pol, '2026-08-12')
    const b = blAt('B2', pol, '2026-08-10')
    importOk([line(a, pol, '2026-08-12')])
    expect(atd(pol)).toBe('2026-08-10')

    manualAtd(pol, '2026-08-05')
    expect(w.psql(`SELECT atd || '|' || marked_by FROM public.voyage_pol_atd_manual WHERE voyage_id = ${w.voyageId} AND pol = '${pol}'`))
      .toBe(`2026-08-05|${w.actors.operacoes}`)

    importOk([line(a, pol, '2026-08-01')])
    expect(atd(pol)).toBe('2026-08-05')
    w.cancelBl(b)
    expect(atd(pol)).toBe('2026-08-05')
  })

  it('apagar o ATD à mão desfaz a marca e o ATD volta ao menor Laden on Board dos B/Ls ativos', () => {
    const pol = 'CNTAO'
    const a = blAt('A3', pol, '2026-09-12')
    blAt('B3', pol, '2026-09-14')
    manualAtd(pol, '2026-09-01')
    importOk([line(a, pol, '2026-09-12')])
    expect(atd(pol)).toBe('2026-09-01')

    manualAtd(pol, null)
    expect(w.psql(`SELECT count(*) FROM public.voyage_pol_atd_manual WHERE voyage_id = ${w.voyageId} AND pol = '${pol}'`)).toBe('0')
    expect(atd(pol)).toBe('2026-09-12')
    expect(lastJustification(pol)).toContain('ATD manual apagado')
  })

  it('excluir o B/L de menor Laden on Board recalcula o ATD (migration 408, R-09)', () => {
    const pol = 'CNXMN'
    const a = blAt('A4', pol, '2026-10-12')
    const b = blAt('B4', pol, '2026-10-09')
    importOk([line(a, pol, '2026-10-12')])
    expect(atd(pol)).toBe('2026-10-09')

    w.asOk('administrativo', `RESET ROLE; SELECT public.delete_records('bl', ARRAY['${b}'], false, 'Lançado por engano')`)
    expect(atd(pol)).toBe('2026-10-12')
  })

  it('o Histórico da Viagem não aceita navio, número nem status pela tela: vêm do gatilho (migration 408, R-13)', () => {
    for (const field of ['vessel_id', 'voyage_number', 'status']) {
      const result = w.as('operacoes', `SELECT public.record_audit_entries(jsonb_build_array(jsonb_build_object(
        'entity_type', 'voyages', 'entity_id', '${w.voyageId}', 'field_name', '${field}',
        'old_value', 'x', 'new_value', 'y', 'justification', NULL)))`)
      expect(result.status, field).not.toBe(0)
      expect(result.stderr).toContain('Registro do Histórico não aceito')
    }
  })

  it('a marca não se grava pela API', () => {
    const result = w.as('operacoes', `INSERT INTO public.voyage_pol_atd_manual (voyage_id, pol, atd) VALUES (${w.voyageId}, 'XXPOL', '2026-01-01')`)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/permission denied|row-level security/)
  })
})
