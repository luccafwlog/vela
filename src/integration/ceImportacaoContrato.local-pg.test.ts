// Etapa 8 do plano de correção das importações (migrations 180 e 181; ADR
// 0078, itens 4, 6, 7 e 9): Nº de Manifesto Mercante canônico e cadastro
// único, Mover / Desvincular B/Ls, prévia no servidor, regras da planilha,
// emissão em lotes e rastro no Histórico.
//
// As ações usam as RPCs reais como `authenticated` (Administrativo).
// Namespace exclusivo: ids 99228xxx, B/Ls 'A228-*', usuário ...0000002280NN,
// manifestos 'A228*' (13 caracteres), CEs '992280…'.
import { spawn } from 'node:child_process'
import { execPsql, spawnPsql } from './localPsql'
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
// Viagem só do Alerta "CE Mercante pendente" (migration 195, K6).
const alertVoyageId = 99228023
// Viagem cancelada no teste do Alerta de tabela faltando (migration 208).
const gapVoyageId = 99228024
const graniteManifestId = '00000000-0000-0000-0000-000000228061'
const graniteBlId = '00000000-0000-0000-0000-000000228062'
const unlockRequestId = '00000000-0000-0000-0000-000000228071'
const vaziosManifestId = '00000000-0000-0000-0000-000000228081'
const chargeTableId = 99228031
const chargeItemId = 99228032
const fee = 321
// ADR 0079, decisão 4 (migration 204): tabela criada depois da espera e tabela zerada.
const lateTable = { id: 99228033, item: 99228034, pod: 'A228T' }
const zeroTable = { id: 99228035, item: 99228036, pod: 'A228Z' }
const pol = 'A228O'
const pod = 'A228P'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asAdmin(sql: string): { output: string; error: string | null } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`],
  { encoding: 'utf8' })
  const error = run.stderr.split('\n').find((line) => line.startsWith('ERROR:')) ?? null
  return { output: run.stdout.trim(), error: error?.trim() ?? null }
}

/** Como o dono das funções (as RPCs SECURITY DEFINER), que é quem grava o cadastro de Manifestos desde a 212. */
function asOwner(sql: string): { error: string | null } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' })
  return { error: run.stderr.split('\n').find((line) => line.startsWith('ERROR:'))?.trim() ?? null }
}

/** psql em outra sessão, sem bloquear o teste (janela de concorrência). */
function runAsync(sql: string): Promise<{ code: number | null; stderr: string }> {
  const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, stderr })))
}

function json<T>(sql: string): T {
  const result = asAdmin(sql)
  if (result.error) throw new Error(result.error)
  return JSON.parse(result.output) as T
}

function jsonLiteral(value: unknown): string {
  return `$json$${JSON.stringify(value)}$json$::jsonb`
}

function insertBl(id: string, options: { voyage?: number; blPod?: string; ce?: string | null; container?: string; withCustomer?: boolean } = {}) {
  const withCustomer = options.withCustomer ?? true
  psql(`
    INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status,
      customer_reconciliation_status, review_status, consignee)
    VALUES ('${id}', ${options.voyage ?? voyageId}, ${withCustomer ? customer.id : 'NULL'}, '${pol}', '${options.blPod ?? pod}', 'container', 'pending', 'not_calculated',
      '${withCustomer ? 'matched_document' : 'missing_customer'}', 'ok', '${customer.name}');
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
      OR id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id IN (SELECT id FROM a228_bls))
      OR id IN (SELECT invoice_id FROM public.invoice_receivable_links WHERE bl_id IN (SELECT id FROM a228_bls));
    CREATE TEMP TABLE a228_alerts AS SELECT id FROM public.alerts WHERE entity_id IN (SELECT id FROM a228_bls)
      OR (entity_type = 'voyage' AND entity_id IN ('${voyageId}', '${otherVoyageId}', '${alertVoyageId}', '${gapVoyageId}'))
      OR (entity_type = 'charge_table_gap' AND entity_id LIKE 'A228%');
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
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM a228_alerts));
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM a228_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM a228_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM a228_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM a228_alerts);
    DELETE FROM public.ce_unlock_zpt_status WHERE bl_id IN (SELECT id FROM a228_bls);
    DELETE FROM public.ce_unlock_request_bls WHERE bl_id IN (SELECT id FROM a228_bls) OR request_id = '${unlockRequestId}';
    DELETE FROM public.ce_unlock_requests WHERE id = '${unlockRequestId}';
    DELETE FROM public.granite_bls WHERE id = '${graniteBlId}' OR manifest_id = '${graniteManifestId}';
    DELETE FROM public.granite_manifests WHERE id = '${graniteManifestId}';
    DELETE FROM public.vazios_importacao_containers WHERE manifest_id = '${vaziosManifestId}';
    DELETE FROM public.vazios_importacao_manifests WHERE id = '${vaziosManifestId}';
    DELETE FROM public.audit_logs WHERE entity_id IN (SELECT id FROM a228_bls)
      OR (entity_type IN ('voyage', 'voyages') AND entity_id IN ('${voyageId}', '${otherVoyageId}', '${alertVoyageId}', '${gapVoyageId}'))
      OR (entity_type = 'voyage_pod_schedule' AND entity_id LIKE '${alertVoyageId}::%')
      OR changed_by = '${actorId}';
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM a228_bls);
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM a228_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM a228_bls);
    DELETE FROM public.voyage_route_ce_master WHERE voyage_id IN (${voyageId}, ${otherVoyageId}, ${alertVoyageId}, ${gapVoyageId});
    DELETE FROM public.manifestos_mercante WHERE voyage_id IN (${voyageId}, ${otherVoyageId}, ${alertVoyageId}, ${gapVoyageId});
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id IN (${chargeTableId}, ${lateTable.id}, ${zeroTable.id})
      OR charge_item_id IN (${chargeItemId}, ${lateTable.item}, ${zeroTable.item});
    DELETE FROM public.charge_table_items WHERE id IN (${chargeItemId}, ${lateTable.item}, ${zeroTable.item});
    DELETE FROM public.charge_tables WHERE id IN (${chargeTableId}, ${lateTable.id}, ${zeroTable.id});
    DELETE FROM public.voyages WHERE id IN (${voyageId}, ${otherVoyageId}, ${alertVoyageId}, ${gapVoyageId});
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
        (${voyageId}, ${vesselId}, 'A228A', 'active'), (${otherVoyageId}, ${vesselId}, 'A228B', 'active'),
        (${alertVoyageId}, ${vesselId}, 'A228C', 'active'), (${gapVoyageId}, ${vesselId}, 'A228D', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${chargeTableId}, 'Tabela A228', '${pod}', CURRENT_DATE - 30, true, 'container');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
      VALUES (${chargeItemId}, ${chargeTableId}, 'Taxa A228 por B/L', 'bl', ${fee}, ${fee}, 'bl', 'base', 'any', 'BRL');
    `)
  })

  afterAll(cleanup)

  it('o Nº de Manifesto Mercante é guardado na forma canônica e recusado fora de 13 caracteres', () => {
    // A API não grava o cadastro direto (212); as RPCs gravam como dono.
    expect(asAdmin(`INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza) VALUES (${voyageId}, '${pol}', '${pod}', ' a228-b0000-0001 ', 'carga');`).error)
      .toMatch(/permission denied/)
    expect(asOwner(`INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza) VALUES (${voyageId}, '${pol}', '${pod}', ' a228-b0000-0001 ', 'carga');`).error).toBeNull()
    expect(psql(`SELECT numero FROM public.manifestos_mercante WHERE voyage_id = ${voyageId};`)).toBe('A228B00000001')
    expect(asOwner(`INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza) VALUES (${voyageId}, '${pol}', '${pod}', 'A228-CURTO', 'carga');`).error)
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

  it('Informar Nº corrige o número sem B/L e recusa trocar ou limpar o Manifesto que já tem B/L (215)', () => {
    const informar = (numero: string) =>
      asAdmin(`SELECT public.set_voyage_route_ce_master(${otherVoyageId}, '${pol}', '${pod}', '${numero}', '${actorId}'::uuid, 'container');`).error
    // Sem B/L: o número digitado errado sai do cadastro, sem deixar dois números na rota.
    expect(informar('A228C00000002')).toBeNull()
    expect(psql(`SELECT string_agg(numero, ',' ORDER BY numero) FROM public.manifestos_mercante WHERE voyage_id = ${otherVoyageId};`)).toBe('A228C00000002')

    insertBl('A228-INF1', { voyage: otherVoyageId, container: 'ADCU2280091' })
    psql(`UPDATE public.bls SET manifesto_mercante_id = (SELECT id FROM public.manifestos_mercante WHERE numero = 'A228C00000002') WHERE id = 'A228-INF1';`)
    expect(informar('A228C00000003')).toMatch(/Ver B\/Ls → Mover/)
    expect(informar('')).toMatch(/Ver B\/Ls → Mover/)
    expect(psql(`SELECT string_agg(numero, ',' ORDER BY numero) FROM public.manifestos_mercante WHERE voyage_id = ${otherVoyageId};`)).toBe('A228C00000002')
    expect(manifestoOf('A228-INF1')).toBe('A228C00000002')
    expect(psql(`SELECT ce_master FROM public.voyage_route_ce_master WHERE voyage_id = ${otherVoyageId};`)).toBe('A228C00000002')
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
    // Migration 209: a tela manda o Manifesto que exibia; outro no banco recusa sem mexer.
    expect(asAdmin(`SELECT public.unlink_bls_from_manifesto_mercante(ARRAY['A228-M2'], 'Teste (A228)', '{"A228-M2": "A228X00000009"}'::jsonb);`).error)
      .toMatch(/Manifesto Mercante mudou depois da tela: A228-M2 está em A228E00000001/)
    expect(asAdmin(`SELECT public.move_bls_to_manifesto_mercante(ARRAY['A228-M2'], 'A228E00000002', 'Teste (A228)', '{"A228-M2": null}'::jsonb);`).error)
      .toMatch(/Manifesto Mercante mudou depois da tela: A228-M2 está em A228E00000001/)
    expect(manifestoOf('A228-M2')).toBe('A228E00000001')
    expect(json<{ unlinked: number }>(`SELECT public.unlink_bls_from_manifesto_mercante(ARRAY['A228-M2'], 'B/L de outro manifesto (A228)', '{"A228-M2": "a228-e0000-0001"}'::jsonb);`).unlinked).toBe(1)
    expect(manifestoOf('A228-M2')).toBe('')

    psql(`UPDATE public.bls SET pod = 'A228Q' WHERE id = 'A228-M1';`)
    expect(manifestoOf('A228-M1')).toBe('')
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_id = 'A228-M1' AND field_name = 'manifesto_mercante' ORDER BY id DESC LIMIT 1;`))
      .toMatch(/POD ou a Viagem/)

    // Migration 207: o Manifesto é da rota inteira; trocar o POL também desvincula.
    expect(json<{ moved: number }>(`SELECT public.move_bls_to_manifesto_mercante(ARRAY['A228-M2'], 'A228E00000001', 'Volta ao manifesto (A228)');`).moved).toBe(1)
    psql(`UPDATE public.bls SET pol = 'A228X' WHERE id = 'A228-M2';`)
    expect(manifestoOf('A228-M2')).toBe('')
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_id = 'A228-M2' AND field_name = 'manifesto_mercante' ORDER BY id DESC LIMIT 1;`))
      .toMatch(/POL, o POD ou a Viagem/)
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

  // --- Migration 195: correções da revisão da PR 929 -------------------------
  function activeAlert(type: string, entityId: string, entityType = 'bl'): string {
    return psql(`SELECT COALESCE(string_agg(i.status || ':' || COALESCE(i.message, ''), ' | '), '')
      FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = '${type}' AND a.entity_type = '${entityType}' AND a.entity_id = '${entityId}' AND i.status = 'active';`)
  }

  function confirmUnlock(blId: string, ce: string) {
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.ce_unlock_requests (id, customer_id, state, source, created_by)
      VALUES ('${unlockRequestId}', ${customer.id}, 'completed', 'request', '${actorId}') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.ce_unlock_request_bls (request_id, bl_id, ce_at_request, active, exported_at)
      VALUES ('${unlockRequestId}', '${blId}', '${ce}', true, now());
      SET session_replication_role = origin;
    `)
    // Desbloqueio conferido pela conciliação real com a ZPT (B1), não por estado montado à força.
    const reconciled = asAdmin(`SELECT public.ce_unlock_reconcile('[{"ce":"${ce}","status":"Desbloqueado"}]'::jsonb);`)
    expect(reconciled.error).toBeNull()
    expect(psql(`SELECT status FROM public.ce_unlock_zpt_status WHERE bl_id = '${blId}';`)).toBe('unlocked')
  }

  it('K1: emissão pelo CE — espera de negócio vem com a frase e sem alerta crítico', () => {
    insertBl('A228-W1', { container: 'ADCU2280031', withCustomer: false })
    insertBl('A228-W2', { container: 'ADCU2280032' })
    psql(`UPDATE public.bls SET review_status = 'pending_review' WHERE id = 'A228-W2';`)
    const result = apply([
      { row: 2, bl_id: 'A228-W1', ce: '992280000000041' },
      { row: 3, bl_id: 'A228-W2', ce: '992280000000042' },
    ], 'A228H00000001', `, false, NULL, true`)
    expect(result.ok).toBe(true)

    const emitted = json<{ results: Array<{ bl_id: string; status: string; reason: string; message: string | null; waiting: boolean }> }>(
      `SELECT public.emit_ce_mercante_billing(ARRAY['A228-W1', 'A228-W2']);`)
    expect(emitted.results).toEqual([
      expect.objectContaining({ bl_id: 'A228-W1', status: 'blocked', reason: 'customer_reconciliation_pending', waiting: true,
        message: expect.stringMatching(/^Aguardando conciliação do Cliente/) }),
      expect.objectContaining({ bl_id: 'A228-W2', status: 'blocked', reason: 'review_pending', waiting: true,
        message: expect.stringMatching(/^Aguardando Revisão do B\/L/) }),
    ])
    expect(activeAlert('billing_auto_issue_failed', 'A228-W1')).toBe('')
    expect(activeAlert('billing_auto_issue_failed', 'A228-W2')).toBe('')
  })

  it('K1: a falha de emissão automática fecha quando a fatura sai, no lote ou pelo gatilho do CE', () => {
    insertBl('A228-W3', { container: 'ADCU2280033' })
    insertBl('A228-W4', { container: 'ADCU2280034' })
    for (const blId of ['A228-W3', 'A228-W4']) {
      expect(asAdmin(`SELECT public.upsert_billing_alert('billing_auto_issue_failed', '${blId}', 'Falha anterior (A228)');`).error).toBeNull()
      expect(activeAlert('billing_auto_issue_failed', blId)).toMatch(/^active:/)
    }

    // Lote da tela: `invoiced` resolve.
    expect(apply([{ row: 2, bl_id: 'A228-W3', ce: '992280000000043' }], 'A228H00000002', `, false, NULL, true`).ok).toBe(true)
    const emitted = json<{ results: Array<{ status: string }> }>(`SELECT public.emit_ce_mercante_billing(ARRAY['A228-W3']);`)
    expect(emitted.results[0].status).toBe('invoiced')
    expect(activeAlert('billing_auto_issue_failed', 'A228-W3')).toBe('')

    // Sem adiar: o gatilho do CE emite e a fatura nascida fecha o alerta.
    expect(apply([{ row: 2, bl_id: 'A228-W4', ce: '992280000000044' }], 'A228H00000002').ok).toBe(true)
    expect(psql(`SELECT financial_status FROM public.bls WHERE id = 'A228-W4';`)).toBe('invoiced')
    expect(activeAlert('billing_auto_issue_failed', 'A228-W4')).toBe('')
  })

  function insertChargeTable(table: { id: number; item: number; pod: string }, value: number) {
    psql(`
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${table.id}, 'Tabela ${table.pod}', '${table.pod}', CURRENT_DATE - 30, true, 'container');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
      VALUES (${table.item}, ${table.id}, 'Taxa ${table.pod} por B/L', 'bl', ${value}, ${value}, 'bl', 'base', 'any', 'BRL');
    `)
  }

  // ADR 0079, decisão 4 (migration 204).
  it('tabela de cobrança faltando é espera com um Alerta por POD que fecha quando as faturas saem', () => {
    insertBl('A228-T1', { container: 'ADCU2280051', blPod: lateTable.pod })
    insertBl('A228-T2', { container: 'ADCU2280052', blPod: lateTable.pod })
    expect(apply([
      { row: 2, bl_id: 'A228-T1', ce: '992280000000061' },
      { row: 3, bl_id: 'A228-T2', ce: '992280000000062' },
    ], 'A228T00000001', `, false, NULL, true`).ok).toBe(true)

    const waiting = json<{ results: Array<{ bl_id: string; status: string; reason: string; message: string | null; waiting: boolean }> }>(
      `SELECT public.emit_ce_mercante_billing(ARRAY['A228-T1', 'A228-T2']);`)
    expect(waiting.results).toEqual([
      expect.objectContaining({ bl_id: 'A228-T1', status: 'blocked', reason: 'charge_table_missing', waiting: true,
        message: expect.stringMatching(/^Aguardando tabela de cobrança: cadastre a tabela do POD A228T \(container\)/) }),
      expect.objectContaining({ bl_id: 'A228-T2', status: 'blocked', reason: 'charge_table_missing', waiting: true }),
    ])
    expect(activeAlert('billing_auto_issue_failed', 'A228-T1')).toBe('')
    expect(activeAlert('billing_charge_table_missing', 'A228T:container', 'charge_table_gap'))
      .toMatch(/^active:Tabela de cobrança faltando para o POD A228T \(container\): 2 B\/L\(s\) aguardando a fatura \(A228-T1, A228-T2\)/)

    // A tabela é cadastrada: cada fatura que sai tira o B/L da lista; a última fecha o Alerta.
    insertChargeTable(lateTable, fee)
    expect(json<{ results: Array<{ status: string }> }>(`SELECT public.emit_ce_mercante_billing(ARRAY['A228-T1']);`).results[0].status).toBe('invoiced')
    expect(activeAlert('billing_charge_table_missing', 'A228T:container', 'charge_table_gap')).toMatch(/1 B\/L\(s\) aguardando a fatura \(A228-T2\)/)
    expect(json<{ results: Array<{ status: string }> }>(`SELECT public.emit_ce_mercante_billing(ARRAY['A228-T2']);`).results[0].status).toBe('invoiced')
    expect(activeAlert('billing_charge_table_missing', 'A228T:container', 'charge_table_gap')).toBe('')
  })

  // Revisão automática (migration 208): B/L que deixa de ser faturável sai da lista.
  it('B/L cancelado, sem CE, com outro POD ou de Viagem cancelada sai do Alerta de tabela faltando', () => {
    const gap = () => activeAlert('billing_charge_table_missing', 'A228Y:container', 'charge_table_gap')
    insertBl('A228-X1', { container: 'ADCU2280064', blPod: 'A228Y' })
    insertBl('A228-X2', { container: 'ADCU2280065', blPod: 'A228Y' })
    insertBl('A228-X3', { container: 'ADCU2280066', blPod: 'A228Y' })
    expect(apply([
      { row: 2, bl_id: 'A228-X1', ce: '992280000000064' },
      { row: 3, bl_id: 'A228-X2', ce: '992280000000065' },
      { row: 4, bl_id: 'A228-X3', ce: '992280000000066' },
    ], 'A228Y00000001', `, false, NULL, true`).ok).toBe(true)
    json(`SELECT public.emit_ce_mercante_billing(ARRAY['A228-X1', 'A228-X2', 'A228-X3']);`)
    // B/L de outra Viagem na mesma lista (o caminho da planilha é o mesmo).
    insertBl('A228-X4', { voyage: gapVoyageId, container: 'ADCU2280067', blPod: 'A228Y' })
    psql(`SELECT public._note_charge_table_gap('A228Y', 'container', 'A228-X4');`)
    expect(gap()).toMatch(/4 B\/L\(s\) aguardando a fatura \(A228-X1, A228-X2, A228-X3, A228-X4\)/)

    expect(json<{ cancelled: boolean }>(`SELECT public.cancel_bl('A228-X1', 'Carga não embarcou (A228)', false);`).cancelled).toBe(true)
    expect(asAdmin(`SELECT public.remove_bl_ce_mercante('A228-X2', 'CE do B/L errado (A228)');`).error).toBeNull()
    psql(`UPDATE public.bls SET pod = '${pod}' WHERE id = 'A228-X3';`)
    expect(gap()).toMatch(/1 B\/L\(s\) aguardando a fatura \(A228-X4\)/)

    expect(asAdmin(`SELECT public.cancel_voyage(${gapVoyageId}, 'Viagem não vai acontecer (A228)', '${actorId}'::uuid);`).error).toBeNull()
    expect(gap()).toBe('')
  })

  // Migration 217: a rota sem linha no espelho também é travada.
  it('dois "Informar Nº" simultâneos numa rota nova deixam um Manifesto só', async () => {
    const informar = (numero: string) => `SELECT public.set_voyage_route_ce_master(${otherVoyageId}, '${pol}', 'A228S', '${numero}', '${actorId}'::uuid, 'container');`
    const first = runAsync(`BEGIN; ${informar('A228S00000001')} SELECT pg_sleep(1.5); COMMIT;`)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const second = runAsync(informar('A228S00000002'))
    expect(await Promise.all([first, second])).toEqual([{ code: 0, stderr: '' }, { code: 0, stderr: '' }])
    expect(psql(`SELECT string_agg(numero, ',' ORDER BY numero) FROM public.manifestos_mercante WHERE voyage_id = ${otherVoyageId} AND pod = 'A228S';`)).toBe('A228S00000002')
    expect(psql(`SELECT ce_master FROM public.voyage_route_ce_master WHERE voyage_id = ${otherVoyageId} AND pod = 'A228S';`)).toBe('A228S00000002')
  })

  // Migration 209: dois lotes ao mesmo tempo no mesmo POD não perdem B/L da lista.
  it('duas emissões simultâneas no mesmo POD sem tabela mantêm os dois B/Ls no Alerta', async () => {
    const first = runAsync(`BEGIN; SELECT public._note_charge_table_gap('A228R', 'container', 'A228-Q1'); SELECT pg_sleep(1.5); COMMIT;`)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const second = runAsync(`SELECT public._note_charge_table_gap('A228R', 'container', 'A228-Q2');`)
    expect(await Promise.all([first, second])).toEqual([{ code: 0, stderr: '' }, { code: 0, stderr: '' }])
    expect(activeAlert('billing_charge_table_missing', 'A228R:container', 'charge_table_gap'))
      .toMatch(/2 B\/L\(s\) aguardando a fatura \(A228-Q1, A228-Q2\)/)
  })

  it('B/L calculado sem nenhuma taxa com valor sai como "Nada a faturar", sem Alerta', () => {
    insertChargeTable(zeroTable, 0)
    insertBl('A228-Z1', { container: 'ADCU2280053', blPod: zeroTable.pod })
    expect(apply([{ row: 2, bl_id: 'A228-Z1', ce: '992280000000063' }], 'A228Z00000001', `, false, NULL, true`).ok).toBe(true)

    const emitted = json<{ results: Array<{ bl_id: string; status: string; reason: string; message: string | null; waiting: boolean }> }>(
      `SELECT public.emit_ce_mercante_billing(ARRAY['A228-Z1']);`)
    expect(emitted.results).toEqual([
      expect.objectContaining({ bl_id: 'A228-Z1', status: 'skipped', reason: 'nothing_to_bill', message: 'Nada a faturar: o cálculo do B/L não tem taxa com valor.' }),
    ])
    expect(activeAlert('billing_auto_issue_failed', 'A228-Z1')).toBe('')
  })

  // ADR 0079, decisão 5 (migration 205): correção manual no Part Lot com irmão faturado.
  it('correção manual de perfil no Part Lot vale com irmão faturado; o faturado segue a ADR 0077', () => {
    insertBl('A228-L1', { container: 'ADCU2280097' })
    insertBl('A228-L2', { container: 'ADCU2280097' })
    // O CE do A228-L1 emite a fatura pelo gatilho; o A228-L2 segue sem fatura.
    expect(apply([{ row: 2, bl_id: 'A228-L1', ce: '992280000000097' }], 'A228L00000001').ok).toBe(true)
    expect(psql(`SELECT financial_status FROM public.bls WHERE id = 'A228-L1';`)).toBe('invoiced')

    // Partindo do próprio B/L faturado, a regra antiga continua: recusa e aponta o B/L sem fatura.
    const l1Container = psql(`SELECT id FROM public.bl_containers WHERE bl_id = 'A228-L1';`)
    expect(asAdmin(`SELECT public.set_bl_container_profile(${l1Container}, 'imo', 'Tentativa pelo B/L faturado (A228)', '${actorId}'::uuid);`).error)
      .toMatch(/B\/L A228-L1 já foi faturado.*também está no B\/L A228-L2, sem fatura: corrija por ele/)

    const p2Container = psql(`SELECT id FROM public.bl_containers WHERE bl_id = 'A228-L2';`)
    const corrected = json<{ invoiced_bls: string[]; propagated_to: Array<{ bl_id: string }> }>(
      `SELECT public.set_bl_container_profile(${p2Container}, 'imo', 'Armador confirmou IMO por e-mail (A228)', '${actorId}'::uuid);`)
    expect(corrected.invoiced_bls).toEqual(['A228-L1'])
    expect(corrected.propagated_to.map((item) => item.bl_id)).toEqual(['A228-L1'])
    expect(psql(`SELECT string_agg(bl_id || ':' || is_imo, ',' ORDER BY bl_id) FROM public.bl_containers WHERE bl_id IN ('A228-L1', 'A228-L2');`))
      .toBe('A228-L1:true,A228-L2:true')
    // O B/L sem fatura foi recalculado; o faturado continua faturado e a base
    // alterada foi processada pela ADR 0077 (nenhuma pendência presa).
    expect(psql(`SELECT charge_status FROM public.bls WHERE id = 'A228-L2';`)).not.toBe('not_calculated')
    expect(psql(`SELECT financial_status FROM public.bls WHERE id = 'A228-L1';`)).toBe('invoiced')
    expect(psql(`SELECT count(*) FROM public.invoice_basis_pending_changes WHERE bl_id = 'A228-L1';`)).toBe('0')
  })

  it('K8: o Histórico do CE e do vínculo leva tipo, Viagem, Manifesto, rota e motivo, mesmo sem Viagem na tela', () => {
    const context = 'Importação de CE Mercante · Viagem A228 NAVIO A228A · Manifesto A228H00000001 · Rota A228O → A228P'
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_id = 'A228-W1' AND field_name = 'ce_mercante' ORDER BY id DESC LIMIT 1;`)).toBe(context)
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_id = 'A228-W1' AND field_name = 'manifesto_mercante' ORDER BY id DESC LIMIT 1;`)).toBe(context)

    insertBl('A228-R1', { container: 'ADCU2280035' })
    const rows: Rows = [{ row: 2, bl_id: 'A228-R1', ce: '992280000000045' }]
    expect(json<{ ok: boolean }>(`SELECT public.apply_ce_mercante_rows_atomic(${jsonLiteral(rows)}, '${actorId}'::uuid, 'bls', 'a228-h0000-0003', NULL, false, NULL, true);`).ok).toBe(true)
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_id = 'A228-R1' AND field_name = 'ce_mercante' ORDER BY id DESC LIMIT 1;`))
      .toBe('Importação de CE Mercante · Viagem A228 NAVIO A228A · Manifesto A228H00000003 · Rota A228O → A228P')

    // A troca confirmada leva o motivo junto do contexto.
    expect(apply([{ row: 2, bl_id: 'A228-R1', ce: '992280000000046' }], 'A228H00000003', `, true, 'CE retificado (A228)', true`).ok).toBe(true)
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_id = 'A228-R1' AND field_name = 'ce_mercante' ORDER BY id DESC LIMIT 1;`))
      .toBe('Importação de CE Mercante · Viagem A228 NAVIO A228A · Manifesto A228H00000003 · Rota A228O → A228P · Motivo: CE retificado (A228)')
  })

  it('K2: corrigir ou remover o CE pela ficha depois do Desbloqueio conferido abre o alerta; a planilha não duplica', () => {
    insertBl('A228-U1', { container: 'ADCU2280036', withCustomer: false, ce: '992280000000051' })
    confirmUnlock('A228-U1', '992280000000051')
    // Migration 207: a ficha manda o CE que exibia; outro CE no banco recusa sem gravar.
    expect(asAdmin(`SELECT public.correct_bl_ce_mercante('A228-U1', '992280000000052', 'CE digitado errado (A228)', '992280000000059');`).error)
      .toMatch(/mudou depois que a ficha foi aberta \(agora: 992280000000051\)/)
    expect(psql(`SELECT ce_mercante FROM public.bls WHERE id = 'A228-U1';`)).toBe('992280000000051')
    expect(asAdmin(`SELECT public.correct_bl_ce_mercante('A228-U1', '992280000000052', 'CE digitado errado (A228)', '992280000000051');`).error).toBeNull()
    expect(activeAlert('ce_trocado_com_desbloqueio', 'A228-U1')).toMatch(/992280000000051 -> 992280000000052/)
    expect(psql(`SELECT source FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'ce_trocado_com_desbloqueio' AND a.entity_id = 'A228-U1';`)).toBe('ce_mercante_ficha')

    // A conciliação vale para o CE conferido: o novo CE só conta depois de a ZPT desbloqueá-lo.
    expect(asAdmin(`SELECT public.ce_unlock_reconcile('[{"ce":"992280000000052","status":"Desbloqueado"}]'::jsonb);`).error).toBeNull()

    // Migration 209: remover também confere o CE exibido.
    expect(asAdmin(`SELECT public.remove_bl_ce_mercante('A228-U1', 'CE do B/L errado (A228)', '992280000000051');`).error)
      .toMatch(/mudou depois que a ficha foi aberta \(agora: 992280000000052\)/)
    expect(psql(`SELECT ce_mercante FROM public.bls WHERE id = 'A228-U1';`)).toBe('992280000000052')
    expect(asAdmin(`SELECT public.remove_bl_ce_mercante('A228-U1', 'CE do B/L errado (A228)', '992280000000052');`).error).toBeNull()
    expect(activeAlert('ce_trocado_com_desbloqueio', 'A228-U1')).toMatch(/removido/)

    // Planilha: um alerta por troca, aberto pela porta única.
    psql(`DELETE FROM public.ce_unlock_request_bls WHERE bl_id = 'A228-U1';`)
    insertBl('A228-U2', { container: 'ADCU2280037', withCustomer: false, ce: '992280000000053' })
    confirmUnlock('A228-U2', '992280000000053')
    expect(apply([{ row: 2, bl_id: 'A228-U2', ce: '992280000000054' }], 'A228H00000004', `, true, 'CE retificado (A228)'`).ok).toBe(true)
    expect(psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'ce_trocado_com_desbloqueio' AND a.entity_id = 'A228-U2';`)).toBe('1')
    expect(activeAlert('ce_trocado_com_desbloqueio', 'A228-U2')).toMatch(/992280000000053 -> 992280000000054/)
  })

  it('K10: mesmo CE em outro formato é normalização — sem troca, efeito nem alerta de Desbloqueio', () => {
    insertBl('A228-N1', { container: 'ADCU2280038', withCustomer: false, ce: '92280000000061' })
    confirmUnlock('A228-N1', '92280000000061')
    const rows: Rows = [{ row: 2, bl_id: 'A228-N1', ce: '092280000000061' }]
    const preview = json<{ rows: Array<{ status: string }>; needs_confirmation: boolean }>(
      `SELECT public.preview_ce_mercante_rows(${jsonLiteral(rows)}, 'A228H00000005', ${voyageId});`)
    expect(preview.rows[0].status).toBe('same')
    expect(preview.needs_confirmation).toBe(false)
    const effectsBefore = psql(`SELECT count(*) FROM public.import_pending_effects WHERE entity_id = 'A228-N1';`)

    expect(apply(rows, 'A228H00000005')).toMatchObject({ ok: true, unchanged: 1, overwritten: 0, inserted: 0 })
    expect(psql(`SELECT ce_mercante FROM public.bls WHERE id = 'A228-N1';`)).toBe('092280000000061')
    expect(psql(`SELECT count(*) FROM public.import_pending_effects WHERE entity_id = 'A228-N1';`)).toBe(effectsBefore)
    expect(activeAlert('ce_trocado_com_desbloqueio', 'A228-N1')).toBe('')
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_id = 'A228-N1' AND field_name = 'ce_mercante' ORDER BY id DESC LIMIT 1;`))
      .toMatch(/^Formato do CE Mercante normalizado/)
  })

  it('K4: a fatura consolidada (vínculo de recebível) trava Remover CE e aparece na prévia', () => {
    insertBl('A228-C1', { container: 'ADCU2280039', withCustomer: false, ce: '992280000000071' })
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, total_brl, status, invoice_type, pix_payload)
      VALUES (99228901, 'A228-CONS-1', ${customer.id}, NULL, 10.00, 'issued', 'consolidated', 'A228');
      INSERT INTO public.bl_receivables (id, bl_id, customer_id, original_amount_brl, balance_brl)
      VALUES (99228902, 'A228-C1', ${customer.id}, 10.00, 10.00);
      INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status)
      VALUES (99228901, 99228902, 'A228-C1', 10.00, 'active');
      SET session_replication_role = origin;
    `)
    expect(asAdmin(`SELECT public.remove_bl_ce_mercante('A228-C1', 'CE do B/L errado (A228)');`).error).toMatch(/A228-CONS-1/)
    expect(psql(`SELECT ce_mercante FROM public.bls WHERE id = 'A228-C1';`)).toBe('992280000000071')

    const preview = json<{ rows: Array<{ live_invoices: string[] }> }>(
      `SELECT public.preview_ce_mercante_rows(${jsonLiteral([{ row: 2, bl_id: 'A228-C1', ce: '992280000000072' }])}, 'A228H00000006', ${voyageId});`)
    expect(preview.rows[0].live_invoices).toEqual(['A228-CONS-1'])
  })

  it('K7: CE que já está num B/L de Granito é erro na prévia, como na gravação', () => {
    psql(`
      INSERT INTO public.granite_manifests (id, voyage_id, vessel_voyage) VALUES ('${graniteManifestId}', ${voyageId}, 'A228 NAVIO A228A');
      INSERT INTO public.granite_bls (id, manifest_id, bl_number, ce_mercante) VALUES ('${graniteBlId}', '${graniteManifestId}', 'A228-GRA-1', '992280000000081');
    `)
    insertBl('A228-G1', { container: 'ADCU2280040', withCustomer: false })
    const rows: Rows = [{ row: 5, bl_id: 'A228-G1', ce: '992280000000081' }]
    const preview = json<{ errors: Array<{ row?: number; message: string }> }>(
      `SELECT public.preview_ce_mercante_rows(${jsonLiteral(rows)}, 'A228H00000007', ${voyageId});`)
    expect(preview.errors).toEqual([expect.objectContaining({ row: 5, message: expect.stringMatching(/B\/L de Granito A228-GRA-1/) })])
  })

  it('K12: B/L cadastrado pela API já com CE é recusado; sem CE passa', () => {
    expect(asAdmin(`BEGIN; INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, ce_mercante) VALUES ('A228-I1', ${voyageId}, '${pol}', '${pod}', 'carga_solta', '992280000000091'); ROLLBACK;`).error)
      .toMatch(/cadastrado ja com CE Mercante/)
    expect(asAdmin(`BEGIN; INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode) VALUES ('A228-I1', ${voyageId}, '${pol}', '${pod}', 'carga_solta'); ROLLBACK;`).error)
      .toBeNull()
  })

  it('K3: apply_ce_mercante_update não é executável pela API', () => {
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.apply_ce_mercante_update(text,text,uuid)', 'EXECUTE');`)).toBe('f')
  })

  it('K6: Alerta "CE Mercante pendente" compara portos normalizados (rota de vazios e B/L com sinônimo)', () => {
    psql(`
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES ('voyage_pod_schedule', '${alertVoyageId}::BRVIX', 'eta', NULL, to_char(CURRENT_DATE, 'YYYY-MM-DD'), '${actorId}');
      INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza) VALUES (${alertVoyageId}, 'CNSHA', 'BRVIX', 'A228V00000001', 'vazio');
      SET session_replication_role = replica;
      INSERT INTO public.vazios_importacao_manifests (id, voyage_id) VALUES ('${vaziosManifestId}', ${alertVoyageId});
      INSERT INTO public.vazios_importacao_containers (manifest_id, container_number, pol, pod) VALUES ('${vaziosManifestId}', 'ADCU2280091', 'SHANGHAI', 'BRVIX');
      SET session_replication_role = origin;
    `)
    const reconcile = () => psql(`SELECT public.reconcile_voyage_ce_mercante_missing_alerts(${alertVoyageId});`)
    // A rota de vazios Xangai → Vitória tem Nº de Manifesto (gravado normalizado): sem alerta.
    reconcile()
    expect(activeAlert('voyage_ce_mercante_missing', String(alertVoyageId), 'voyage')).toBe('')

    // B/L com POD "VITORIA" e sem CE conta para a escala BRVIX.
    insertBl('A228-V1', { voyage: alertVoyageId, blPod: 'VITORIA', container: 'ADCU2280092', withCustomer: false })
    reconcile()
    expect(activeAlert('voyage_ce_mercante_missing', String(alertVoyageId), 'voyage')).toMatch(/1 B\/L\(s\)/)
  })
})
