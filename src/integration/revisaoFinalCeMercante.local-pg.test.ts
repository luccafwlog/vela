// Revisão final da PR 929 (migration 212): Manifesto Mercante só muda pelas
// RPCs, emissão "Nada a faturar" fecha os Alertas do B/L, a planilha repetida
// devolve à emissão o B/L que ficou sem fatura e o CE do Granito tem as
// mesmas regras do CE do B/L.
//
// As ações usam as RPCs reais como `authenticated` (Administrativo).
// Namespace exclusivo: ids 992127xx, B/Ls 'R212-*', usuário ...000000212701,
// manifestos 'R212*' (13 caracteres), CEs '992127…'.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000212701'
const customer = { id: 99212701, cnpj: syntheticCnpj(212701), name: 'R212 CLIENTE LTDA' }
const carrierId = 99212710
const vesselId = 99212711
const voyageId = 99212721
const chargeTable = { id: 99212731, item: 99212732, pod: 'R212P' }
// POD sem tabela: o B/L espera; depois a tabela chega zerada ("Nada a faturar").
const zeroTable = { id: 99212733, item: 99212734, pod: 'R212Z' }
const graniteManifestId = '00000000-0000-0000-0000-000000212761'
const graniteBlId = '00000000-0000-0000-0000-000000212762'
const pol = 'R212O'
const fee = 212

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

function json<T>(sql: string): T {
  const result = asAdmin(sql)
  if (result.error) throw new Error(result.error)
  return JSON.parse(result.output) as T
}

function jsonLiteral(value: unknown): string {
  return `$json$${JSON.stringify(value)}$json$::jsonb`
}

function insertBl(id: string, blPod: string, container: string) {
  psql(`
    INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status,
      customer_reconciliation_status, review_status, consignee)
    VALUES ('${id}', ${voyageId}, ${customer.id}, '${pol}', '${blPod}', 'container', 'pending', 'not_calculated',
      'matched_document', 'ok', '${customer.name}');
    INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${id}', '${container}', '40HC');
  `)
}

function insertChargeTable(table: { id: number; item: number; pod: string }, value: number) {
  psql(`
    INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
    VALUES (${table.id}, 'Tabela ${table.pod}', '${table.pod}', CURRENT_DATE - 30, true, 'container');
    INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
    VALUES (${table.item}, ${table.id}, 'Taxa ${table.pod} por B/L', 'bl', ${value}, ${value}, 'bl', 'base', 'any', 'BRL');
  `)
}

type Rows = Array<{ row: number; bl_id: string; ce: string }>
type ApplyResult = { ok: boolean; errors?: Array<{ row?: number; message: string }>; unchanged?: number; billing_pending_bl_ids?: string[] }

/** Planilha de CE com emissão adiada, como a tela faz. */
function apply(rows: Rows, numero: string): ApplyResult {
  return json(`SELECT public.apply_ce_mercante_rows_atomic(${jsonLiteral(rows)}, '${actorId}'::uuid, 'bls', '${numero}', ${voyageId}, false, NULL, true);`)
}

function applyGranite(ce: string): ApplyResult {
  return json(`SELECT public.apply_ce_mercante_rows_atomic(${jsonLiteral([{ row: 2, bl_id: graniteBlId, ce }])}, '${actorId}'::uuid, 'granite');`)
}

function emit(blIds: string[]): Array<{ bl_id: string; status: string; reason: string }> {
  return json<{ results: Array<{ bl_id: string; status: string; reason: string }> }>(
    `SELECT public.emit_ce_mercante_billing(ARRAY[${blIds.map((id) => `'${id}'`).join(', ')}]::text[]);`).results
}

function manifestoOf(blId: string): string {
  return psql(`SELECT COALESCE(m.numero, '') FROM public.bls b LEFT JOIN public.manifestos_mercante m ON m.id = b.manifesto_mercante_id WHERE b.id = '${blId}';`)
}

function activeAlert(type: string, entityId: string, entityType = 'bl'): string {
  return psql(`SELECT COALESCE(string_agg(i.status || ':' || COALESCE(i.message, ''), ' | '), '')
    FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_type = '${entityType}' AND a.entity_id = '${entityId}' AND i.status = 'active';`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE r212_bls AS SELECT id FROM public.bls WHERE id LIKE 'R212-%';
    CREATE TEMP TABLE r212_invoices AS SELECT id FROM public.invoices WHERE bl_id IN (SELECT id FROM r212_bls)
      OR id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id IN (SELECT id FROM r212_bls))
      OR id IN (SELECT invoice_id FROM public.invoice_receivable_links WHERE bl_id IN (SELECT id FROM r212_bls));
    CREATE TEMP TABLE r212_alerts AS SELECT id FROM public.alerts WHERE entity_id IN (SELECT id FROM r212_bls)
      OR (entity_type = 'voyage' AND entity_id = '${voyageId}')
      OR (entity_type = 'charge_table_gap' AND entity_id LIKE 'R212%');
    DELETE FROM public.invoice_receivable_links WHERE invoice_id IN (SELECT id FROM r212_invoices) OR bl_id IN (SELECT id FROM r212_bls);
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN (SELECT id FROM r212_invoices);
    DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM r212_invoices);
    DELETE FROM public.invoice_bls WHERE invoice_id IN (SELECT id FROM r212_invoices);
    DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN (SELECT id FROM r212_invoices);
    DELETE FROM public.invoices WHERE id IN (SELECT id FROM r212_invoices);
    DELETE FROM public.bl_receivables WHERE bl_id IN (SELECT id FROM r212_bls);
    DELETE FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM r212_bls);
    DELETE FROM public.billing_run_logs WHERE bl_id IN (SELECT id FROM r212_bls);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM r212_bls));
    DELETE FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM r212_bls);
    DELETE FROM public.portal_notifications WHERE customer_id = ${customer.id};
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM r212_alerts));
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM r212_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM r212_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM r212_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r212_alerts);
    DELETE FROM public.granite_bls WHERE id = '${graniteBlId}' OR manifest_id = '${graniteManifestId}';
    DELETE FROM public.granite_manifests WHERE id = '${graniteManifestId}';
    DELETE FROM public.audit_logs WHERE entity_id IN (SELECT id FROM r212_bls)
      OR entity_id = '${graniteBlId}'
      OR (entity_type IN ('voyage', 'voyages') AND entity_id = '${voyageId}')
      OR changed_by = '${actorId}';
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM r212_bls);
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM r212_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM r212_bls);
    DELETE FROM public.voyage_route_ce_master WHERE voyage_id = ${voyageId};
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${voyageId} OR numero LIKE 'R212%';
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id IN (${chargeTable.id}, ${zeroTable.id})
      OR charge_item_id IN (${chargeTable.item}, ${zeroTable.item});
    DELETE FROM public.charge_table_items WHERE id IN (${chargeTable.item}, ${zeroTable.item});
    DELETE FROM public.charge_tables WHERE id IN (${chargeTable.id}, ${zeroTable.id});
    DELETE FROM public.voyages WHERE id = ${voyageId};
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

describeLocal('Revisão final da PR 929 — CE Mercante e Manifesto (migration 212)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'r212-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'R212 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customer.id}, '${customer.cnpj}', '${customer.name}');
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
      VALUES (${customer.id}, 'Financeiro R212', 'r212@example.test', 'financeiro', true);
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      VALUES (${customer.id}, 'Fixture R212', '${actorId}', now() + interval '1 day');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'R212 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'R212 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'R212A', 'active');
    `)
    insertChargeTable(chargeTable, fee)
  })

  afterAll(cleanup)

  it('o cadastro de Manifestos não aceita gravação direta pela API; Mover continua pela RPC', () => {
    for (const statement of [
      `INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza) VALUES (${voyageId}, '${pol}', '${chargeTable.pod}', 'R212A00000009', 'carga');`,
      `UPDATE public.manifestos_mercante SET numero = 'R212A00000008' WHERE voyage_id = ${voyageId};`,
      `DELETE FROM public.manifestos_mercante WHERE voyage_id = ${voyageId};`,
    ]) {
      expect(asAdmin(statement).error).toMatch(/permission denied for table manifestos_mercante/)
    }
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES']) {
      expect(psql(`SELECT has_table_privilege('authenticated', 'public.manifestos_mercante', '${privilege}')::text
        || has_table_privilege('anon', 'public.manifestos_mercante', '${privilege}')::text;`)).toBe('falsefalse')
    }
    expect(psql(`SELECT has_table_privilege('authenticated', 'public.manifestos_mercante', 'SELECT');`)).toBe('t')

    insertBl('R212-M1', chargeTable.pod, 'RDCU2120001')
    const moved = json<{ created: boolean; moved: number }>(`SELECT public.move_bls_to_manifesto_mercante(ARRAY['R212-M1'], 'R212A00000001', 'Fixture (R212)');`)
    expect(moved).toMatchObject({ created: true, moved: 1 })
    expect(manifestoOf('R212-M1')).toBe('R212A00000001')
  })

  it('o vínculo do B/L com o Manifesto não muda por UPDATE ou INSERT direto; trocar o POL ainda desvincula', () => {
    const otherId = psql(`INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza)
      VALUES (${voyageId}, 'R212X', 'R212Y', 'R212A00000002', 'carga') RETURNING id;`)

    expect(asAdmin(`UPDATE public.bls SET manifesto_mercante_id = NULL WHERE id = 'R212-M1';`).error)
      .toMatch(/Manifesto Mercante do B\/L R212-M1 muda só por Mover ou Desvincular/)
    expect(asAdmin(`UPDATE public.bls SET manifesto_mercante_id = '${otherId}' WHERE id = 'R212-M1';`).error)
      .toMatch(/Manifesto Mercante do B\/L R212-M1/)
    expect(manifestoOf('R212-M1')).toBe('R212A00000001')
    expect(asAdmin(`BEGIN; INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, manifesto_mercante_id)
      VALUES ('R212-M9', ${voyageId}, 'R212X', 'R212Y', 'carga_solta', '${otherId}'); ROLLBACK;`).error)
      .toMatch(/Manifesto Mercante do B\/L R212-M9/)

    // A ficha manda a linha inteira com o mesmo vínculo: passa.
    const same = psql(`SELECT manifesto_mercante_id FROM public.bls WHERE id = 'R212-M1';`)
    expect(asAdmin(`UPDATE public.bls SET manifesto_mercante_id = '${same}', consignee = '${customer.name}' WHERE id = 'R212-M1';`).error).toBeNull()
    expect(manifestoOf('R212-M1')).toBe('R212A00000001')

    // Editar o POL pela ficha (UPDATE direto) continua e desvincula pelo gatilho.
    expect(asAdmin(`UPDATE public.bls SET pol = 'R212Q' WHERE id = 'R212-M1';`).error).toBeNull()
    expect(manifestoOf('R212-M1')).toBe('')
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_id = 'R212-M1' AND field_name = 'manifesto_mercante' ORDER BY id DESC LIMIT 1;`))
      .toMatch(/POL, o POD ou a Viagem/)
    // A ficha que manda o vínculo antigo junto com o POL novo também passa.
    expect(json<{ moved: number }>(`SELECT public.move_bls_to_manifesto_mercante(ARRAY['R212-M1'], 'R212A00000003', 'Volta (R212)');`).moved).toBe(1)
    const linked = psql(`SELECT manifesto_mercante_id FROM public.bls WHERE id = 'R212-M1';`)
    expect(asAdmin(`UPDATE public.bls SET pol = '${pol}', manifesto_mercante_id = '${linked}' WHERE id = 'R212-M1';`).error).toBeNull()
    expect(manifestoOf('R212-M1')).toBe('')
  })

  it('B/L que sai como "Nada a faturar" deixa o Alerta de tabela faltando e fecha a falha anterior', () => {
    insertBl('R212-Z1', zeroTable.pod, 'RDCU2120011')
    expect(apply([{ row: 2, bl_id: 'R212-Z1', ce: '992127000000011' }], 'R212Z00000001').ok).toBe(true)
    expect(emit(['R212-Z1'])).toEqual([expect.objectContaining({ bl_id: 'R212-Z1', status: 'blocked', reason: 'charge_table_missing' })])
    expect(activeAlert('billing_charge_table_missing', 'R212Z:container', 'charge_table_gap')).toMatch(/1 B\/L\(s\) aguardando a fatura \(R212-Z1\)/)
    expect(asAdmin(`SELECT public.upsert_billing_alert('billing_auto_issue_failed', 'R212-Z1', 'Falha anterior (R212)');`).error).toBeNull()

    // A tabela chega com a taxa zerada: não há fatura a emitir, nem espera.
    insertChargeTable(zeroTable, 0)
    expect(emit(['R212-Z1'])).toEqual([expect.objectContaining({ bl_id: 'R212-Z1', status: 'skipped', reason: 'nothing_to_bill' })])
    expect(activeAlert('billing_charge_table_missing', 'R212Z:container', 'charge_table_gap')).toBe('')
    expect(activeAlert('billing_auto_issue_failed', 'R212-Z1')).toBe('')
  })

  it('a mesma planilha de novo devolve à emissão o B/L que ficou sem fatura, e não o faturado', () => {
    insertBl('R212-E1', chargeTable.pod, 'RDCU2120021')
    insertBl('R212-E2', chargeTable.pod, 'RDCU2120022')
    const rows: Rows = [
      { row: 2, bl_id: 'R212-E1', ce: '992127000000021' },
      { row: 3, bl_id: 'R212-E2', ce: '992127000000022' },
    ]
    const first = apply(rows, 'R212E00000001')
    expect(first.billing_pending_bl_ids?.sort()).toEqual(['R212-E1', 'R212-E2'])
    // A emissão parou depois do primeiro B/L (tela fechada, queda de rede).
    expect(emit(['R212-E1'])[0].status).toBe('invoiced')

    const again = apply(rows, 'R212E00000001')
    expect(again).toMatchObject({ ok: true, unchanged: 2 })
    expect(again.billing_pending_bl_ids).toEqual(['R212-E2'])
    expect(emit(again.billing_pending_bl_ids ?? [])[0]).toMatchObject({ bl_id: 'R212-E2', status: 'invoiced' })
    expect(psql(`SELECT count(*) FROM public.invoices WHERE bl_id IN ('R212-E1', 'R212-E2');`)).toBe('2')
    expect(apply(rows, 'R212E00000001').billing_pending_bl_ids).toEqual([])
  })

  it('CE do Granito: a função interna não é da API e a planilha recusa CE vazio ou fora de 15 dígitos', () => {
    psql(`
      INSERT INTO public.granite_manifests (id, voyage_id, vessel_voyage) VALUES ('${graniteManifestId}', ${voyageId}, 'R212 NAVIO R212A');
      INSERT INTO public.granite_bls (id, manifest_id, bl_number, ce_mercante) VALUES ('${graniteBlId}', '${graniteManifestId}', 'R212-GRA-1', '992127000000031');
    `)
    for (const role of ['authenticated', 'anon', 'public']) {
      expect(psql(`SELECT has_function_privilege('${role}', 'public.apply_granite_ce_mercante_update(uuid,text,uuid)', 'EXECUTE');`)).toBe('f')
    }
    expect(asAdmin(`SELECT public.apply_granite_ce_mercante_update('${graniteBlId}'::uuid, '', '${actorId}'::uuid);`).error)
      .toMatch(/permission denied for function apply_granite_ce_mercante_update/)

    for (const ce of ['', '12345', '99212700000003A']) {
      const refused = applyGranite(ce)
      expect(refused.ok).toBe(false)
      expect(refused.errors?.[0].message).toMatch(/15 d[ií]gitos/)
    }
    expect(psql(`SELECT ce_mercante FROM public.granite_bls WHERE id = '${graniteBlId}';`)).toBe('992127000000031')

    expect(applyGranite('992127 000000032')).toMatchObject({ ok: true })
    expect(psql(`SELECT ce_mercante FROM public.granite_bls WHERE id = '${graniteBlId}';`)).toBe('992127000000032')
    expect(applyGranite('992127000000032')).toMatchObject({ ok: true, unchanged: 1 })
  })
})
