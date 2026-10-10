// Etapa 8 do plano de correção das importações (migrations 180 e 181; ADR
// 0078, itens 4, 6, 7 e 9): Nº de Manifesto Mercante canônico e cadastro
// único, Mover / Desvincular B/Ls, prévia no servidor, regras da planilha,
// emissão em lotes e rastro no Histórico.
//
// As ações usam as RPCs reais como `authenticated` (Administrativo).
// Namespace exclusivo: ids 99228xxx, B/Ls 'A228-*', usuário ...0000002280NN,
// manifestos 'A228*' (13 caracteres), CEs '992280…'.
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000228001'
const customer = { id: 99228001, cnpj: syntheticCnpj(228001), name: 'A228 CLIENTE LTDA' }
const carrierId = 99228010
const vesselId = 99228011
const voyageId = 99228021
const otherVoyageId = 99228022
const chargeTableId = 99228031
const chargeItemId = 99228032
const fee = 321
const pol = 'A228O'
const pod = 'A228P'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asAdmin(sql: string): { output: string; error: string | null } {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`],
  { encoding: 'utf8' })
  const error = run.stderr.split('\n').find((line) => line.startsWith('ERROR:')) ?? null
  return { output: run.stdout.trim(), error: error?.trim() ?? null }
}

function json<T>(sql: string): T {
  const result = asAdmin(sql)
  if (result.error) throw new Error(result.error)
  return JSON.parse(result.output) as T
}

function jsonLiteral(value: unknown): string {
  return `$json$${JSON.stringify(value)}$json$::jsonb`
}

function insertBl(id: string, options: { voyage?: number; blPod?: string; ce?: string | null; container?: string } = {}) {
  psql(`
    INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status,
      customer_reconciliation_status, review_status, consignee)
    VALUES ('${id}', ${options.voyage ?? voyageId}, ${customer.id}, '${pol}', '${options.blPod ?? pod}', 'container', 'pending', 'not_calculated',
      'matched_document', 'ok', '${customer.name}');
    INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${options.container ?? 'ADCU2280000'}', '40HC');
    ${options.ce ? `UPDATE public.bls SET ce_mercante = '${options.ce}' WHERE id = '${id}';` : ''}
  `)
}

type Rows = Array<{ row: number; bl_id: string; ce: string }>

function apply(rows: Rows, numero: string, extra = ''): { ok: boolean; errors?: Array<{ row?: number; message: string }>; warnings?: Array<{ message: string }>; needs_confirmation?: boolean; billing_pending_bl_ids?: string[]; ignored?: number } {
  return json(`SELECT public.apply_ce_mercante_rows_atomic(${jsonLiteral(rows)}, '${actorId}'::uuid, 'bls', '${numero}', ${voyageId}${extra});`)
}

function manifestoOf(blId: string): string {
  return psql(`SELECT COALESCE(m.numero, '') FROM public.bls b LEFT JOIN public.manifestos_mercante m ON m.id = b.manifesto_mercante_id WHERE b.id = '${blId}';`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE a228_bls AS SELECT id FROM public.bls WHERE id LIKE 'A228-%';
    CREATE TEMP TABLE a228_invoices AS SELECT id FROM public.invoices WHERE bl_id IN (SELECT id FROM a228_bls)
      OR id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id IN (SELECT id FROM a228_bls));
    DELETE FROM public.invoice_receivable_links WHERE invoice_id IN (SELECT id FROM a228_invoices) OR bl_id IN (SELECT id FROM a228_bls);
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN (SELECT id FROM a228_invoices);
    DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM a228_invoices);
    DELETE FROM public.invoice_bls WHERE invoice_id IN (SELECT id FROM a228_invoices);
    DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN (SELECT id FROM a228_invoices);
    DELETE FROM public.invoices WHERE id IN (SELECT id FROM a228_invoices);
    DELETE FROM public.bl_receivables WHERE bl_id IN (SELECT id FROM a228_bls);
    DELETE FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM a228_bls);
    DELETE FROM public.billing_run_logs WHERE bl_id IN (SELECT id FROM a228_bls);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM a228_bls));
    DELETE FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM a228_bls);
    DELETE FROM public.portal_notifications WHERE customer_id = ${customer.id};
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id IN (SELECT id FROM a228_bls));
    DELETE FROM public.alerts WHERE entity_id IN (SELECT id FROM a228_bls);
    DELETE FROM public.audit_logs WHERE entity_id IN (SELECT id FROM a228_bls)
      OR (entity_type IN ('voyage', 'voyages') AND entity_id IN ('${voyageId}', '${otherVoyageId}'))
      OR changed_by = '${actorId}';
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM a228_bls);
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM a228_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM a228_bls);
    DELETE FROM public.voyage_route_ce_master WHERE voyage_id IN (${voyageId}, ${otherVoyageId});
    DELETE FROM public.manifestos_mercante WHERE voyage_id IN (${voyageId}, ${otherVoyageId});
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id = ${chargeTableId} OR charge_item_id = ${chargeItemId};
    DELETE FROM public.charge_table_items WHERE id = ${chargeItemId};
    DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
    DELETE FROM public.voyages WHERE id IN (${voyageId}, ${otherVoyageId});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id = ${customer.id};
    DELETE FROM public.customer_contacts WHERE customer_id = ${customer.id};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customer.id};
    DELETE FROM public.customers WHERE id = ${customer.id};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('Etapa 8 — contrato da importação de CE (migrations 180 e 181)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'a228-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'A228 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customer.id}, '${customer.cnpj}', '${customer.name}');
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
      VALUES (${customer.id}, 'Financeiro A228', 'a228@example.test', 'financeiro', true);
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      VALUES (${customer.id}, 'Fixture A228', '${actorId}', now() + interval '1 day');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A228 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A228 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyageId}, ${vesselId}, 'A228A', 'active'), (${otherVoyageId}, ${vesselId}, 'A228B', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${chargeTableId}, 'Tabela A228', '${pod}', CURRENT_DATE - 30, true, 'container');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
      VALUES (${chargeItemId}, ${chargeTableId}, 'Taxa A228 por B/L', 'bl', ${fee}, ${fee}, 'bl', 'base', 'any', 'BRL');
    `)
  })

  afterAll(cleanup)

  it('o Nº de Manifesto Mercante é guardado na forma canônica e recusado fora de 13 caracteres', () => {
    expect(asAdmin(`INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza) VALUES (${voyageId}, '${pol}', '${pod}', ' a228-b0000-0001 ', 'carga');`).error).toBeNull()
    expect(psql(`SELECT numero FROM public.manifestos_mercante WHERE voyage_id = ${voyageId};`)).toBe('A228B00000001')
    expect(asAdmin(`INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza) VALUES (${voyageId}, '${pol}', '${pod}', 'A228-CURTO', 'carga');`).error)
      .toMatch(/13 caracteres/)
    // A busca acha pelo número digitado com separadores.
    expect(json<Array<{ numero: string }>>(`SELECT COALESCE(jsonb_agg(m), '[]') FROM public.find_manifesto_mercante('a228 b0000 0001') AS m;`)).toEqual([
      expect.objectContaining({ numero: 'A228B00000001' }),
    ])
  })

  it('Informar Nº grava no cadastro único de Manifestos e o espelho da rota acompanha', () => {
    expect(asAdmin(`SELECT public.set_voyage_route_ce_master(${otherVoyageId}, '${pol}', '${pod}', 'A228.C0000.0001', '${actorId}'::uuid, 'container');`).error).toBeNull()
    expect(psql(`SELECT numero || ':' || natureza FROM public.manifestos_mercante WHERE voyage_id = ${otherVoyageId};`)).toBe('A228C00000001:carga')
    expect(psql(`SELECT ce_master FROM public.voyage_route_ce_master WHERE voyage_id = ${otherVoyageId};`)).toBe('A228C00000001')
    expect(asAdmin(`SELECT public.set_voyage_route_ce_master(${otherVoyageId}, '${pol}', '${pod}', '123', '${actorId}'::uuid, 'container');`).error).toMatch(/13 caracteres/)
  })

  it('prévia: CE atual → novo, troca exige confirmação com motivo, cancelado é ignorado e linha sem CE é erro', () => {
    insertBl('A228-P1', { container: 'ADCU2280001' })
    insertBl('A228-P2', { container: 'ADCU2280002', ce: '992280000000002' })
    insertBl('A228-P3', { container: 'ADCU2280003' })
    expect(json<{ cancelled: boolean }>(`SELECT public.cancel_bl('A228-P3', 'Carga não embarcou (A228)', false);`).cancelled).toBe(true)

    const rows: Rows = [
      { row: 2, bl_id: 'A228-P1', ce: '992280000000001' },
      { row: 3, bl_id: 'A228-P2', ce: '992280000000022' },
      { row: 4, bl_id: 'A228-P3', ce: '992280000000003' },
    ]
    const preview = json<{ rows: Array<{ bl_id: string; status: string; current_ce?: string; new_ce?: string }>; warnings: Array<{ message: string }>; needs_confirmation: boolean; errors: unknown[] }>(
      `SELECT public.preview_ce_mercante_rows(${jsonLiteral(rows)}, 'A228D00000001', ${voyageId});`)
    expect(preview.errors).toEqual([])
    expect(preview.rows.map((row) => [row.bl_id, row.status])).toEqual([['A228-P1', 'new'], ['A228-P2', 'change'], ['A228-P3', 'cancelled']])
    expect(preview.rows[1]).toMatchObject({ current_ce: '992280000000002', new_ce: '992280000000022' })
    expect(preview.warnings[0].message).toMatch(/cancelado/)
    expect(preview.needs_confirmation).toBe(true)

    // Sem confirmação: nada é gravado.
    expect(apply(rows, 'A228D00000001')).toMatchObject({ ok: false, needs_confirmation: true })
    expect(psql(`SELECT COALESCE(ce_mercante, '') FROM public.bls WHERE id = 'A228-P1';`)).toBe('')

    // Linha sem CE é erro e nomeia a linha.
    const missing = apply([{ row: 7, bl_id: 'A228-P1', ce: '' }], 'A228D00000001')
    expect(missing.ok).toBe(false)
    expect(missing.errors?.[0]).toMatchObject({ row: 7, message: expect.stringMatching(/sem CE Mercante/) })

    const confirmed = apply(rows, 'A228D00000001', `, true, 'CE corrigido pelo despachante (A228)'`)
    expect(confirmed).toMatchObject({ ok: true, ignored: 1 })
    expect(psql(`SELECT ce_mercante FROM public.bls WHERE id = 'A228-P2';`)).toBe('992280000000022')
    expect(psql(`SELECT COALESCE(ce_mercante, '') FROM public.bls WHERE id = 'A228-P3';`)).toBe('')
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_id = 'A228-P2' AND field_name = 'ce_mercante' ORDER BY id DESC LIMIT 1;`))
      .toContain('CE corrigido pelo despachante (A228)')
  })

  it('rastro: CE, Manifesto criado e vínculo entram no Histórico uma vez cada', () => {
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = 'A228-P1' AND field_name = 'ce_mercante';`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = 'A228-P1' AND field_name = 'manifesto_mercante';`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'voyage' AND entity_id = '${voyageId}' AND field_name = 'manifesto_mercante_created' AND new_value = 'A228D00000001';`)).toBe('1')
  })

  it('Mover em lote cria o destino, registra o motivo e é tudo ou nada; Desvincular e mudança de POD desvinculam', () => {
    insertBl('A228-M1', { container: 'ADCU2280011' })
    insertBl('A228-M2', { container: 'ADCU2280012' })
    insertBl('A228-M9', { container: 'ADCU2280019', blPod: 'A228Q' })

    // Rota diferente na seleção: nada muda.
    expect(asAdmin(`SELECT public.move_bls_to_manifesto_mercante(ARRAY['A228-M1', 'A228-M9'], 'A228E00000001', 'Reemissão (A228)');`).error)
      .toMatch(/mais de uma viagem ou rota/)
    expect(manifestoOf('A228-M1')).toBe('')

    const moved = json<{ created: boolean; moved: number }>(`SELECT public.move_bls_to_manifesto_mercante(ARRAY['A228-M1', 'A228-M2'], 'a228-e0000-0001', 'Reemissão (A228)');`)
    expect(moved).toMatchObject({ created: true, moved: 2 })
    expect([manifestoOf('A228-M1'), manifestoOf('A228-M2')]).toEqual(['A228E00000001', 'A228E00000001'])
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_id = 'A228-M1' AND field_name = 'manifesto_mercante' ORDER BY id DESC LIMIT 1;`)).toBe('Reemissão (A228)')

    expect(asAdmin(`SELECT public.unlink_bls_from_manifesto_mercante(ARRAY['A228-M2'], NULL);`).error).toMatch(/motivo/)
    expect(json<{ unlinked: number }>(`SELECT public.unlink_bls_from_manifesto_mercante(ARRAY['A228-M2'], 'B/L de outro manifesto (A228)');`).unlinked).toBe(1)
    expect(manifestoOf('A228-M2')).toBe('')

    psql(`UPDATE public.bls SET pod = 'A228Q' WHERE id = 'A228-M1';`)
    expect(manifestoOf('A228-M1')).toBe('')
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_id = 'A228-M1' AND field_name = 'manifesto_mercante' ORDER BY id DESC LIMIT 1;`))
      .toMatch(/POD ou a Viagem/)
  })

  it('emissão em lotes: a gravação só calcula; o lote emite como Sistema — CE Mercante', () => {
    insertBl('A228-E1', { container: 'ADCU2280021' })
    insertBl('A228-E2', { container: 'ADCU2280022' })
    const result = apply([
      { row: 2, bl_id: 'A228-E1', ce: '992280000000031' },
      { row: 3, bl_id: 'A228-E2', ce: '992280000000032' },
    ], 'A228F00000001', `, false, NULL, true`)
    expect(result.ok).toBe(true)
    expect(result.billing_pending_bl_ids?.sort()).toEqual(['A228-E1', 'A228-E2'])
    expect(psql(`SELECT count(*) FROM public.invoices WHERE bl_id IN ('A228-E1', 'A228-E2');`)).toBe('0')
    expect(psql(`SELECT charge_status FROM public.bls WHERE id = 'A228-E1';`)).not.toBe('not_calculated')

    const emitted = json<{ results: Array<{ bl_id: string; status: string; invoice_number: string | null }> }>(
      `SELECT public.emit_ce_mercante_billing(ARRAY['A228-E1', 'A228-E2']);`)
    expect(emitted.results.map((item) => [item.bl_id, item.status])).toEqual([['A228-E1', 'invoiced'], ['A228-E2', 'invoiced']])
    expect(emitted.results.every((item) => Boolean(item.invoice_number))).toBe(true)
    expect(psql(`SELECT notes || '|' || total_brl FROM public.invoices WHERE bl_id = 'A228-E1';`)).toBe(`Sistema — CE Mercante: fatura automática após o registro do CE.|${fee.toFixed(2)}`)

    // Retomar não emite de novo.
    const again = json<{ results: Array<{ status: string }> }>(`SELECT public.emit_ce_mercante_billing(ARRAY['A228-E1']);`)
    expect(again.results[0].status).toBe('invoiced')
    expect(psql(`SELECT count(*) FROM public.invoices WHERE bl_id = 'A228-E1';`)).toBe('1')
  })
})
