// Checagens de aceitação da revisão das importações (2026-10-09; docs/archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md).
// As referências `arquivo:linha` apontam para o checkout `fa5f238` da revisão; as regras decididas depois estão na ADR 0078.
// Cada it.fails documenta um defeito confirmado e roda no job local-pg do CI; quando a correção entrar, troque it.fails por it.
//
// Problema-raiz M03: container compartilhado entre B/Ls. O motor rateia a taxa
// por container (`container_distinct_voyage`, 1/share_count) e a transição do CE
// emite uma Invoice Individual por B/L (`_auto_bill_bl_core` → `create_invoice_from_bls_core`
// com ARRAY[um B/L]). O gatilho `guard_shared_container_invoice` (migration 066:348-389,
// sem redefinição posterior) recusa o vínculo `invoice_bls` de qualquer B/L cujo irmão
// do mesmo container já esteja `invoiced`/`paid` em outra fatura, mesmo quando o
// rateio é o mesmo (1/2 nos dois). A intenção declarada em 066:344-346 era evitar que
// um segundo B/L carregasse 150% do container; o efeito é que só o primeiro B/L
// a passar pela emissão é faturado. `guard_shared_container_mutation` (066:391-416)
// dispara em qualquer UPDATE de `bl_containers` (inclusive só de datas) quando
// outro B/L do container está faturado.
//
// As ações usam as RPCs reais, como `authenticated`, com os payloads dos serviços:
// planilha de CE `apply_ce_mercante_rows_atomic` (ceMercanteImport.ts:197-207),
// Liberação `grant_customer_billing_portal_release` (billingPortalRelease.ts:42-47)
// e datas `apply_container_dates_atomic` (containerDatesImport.ts:114-130). Os B/Ls
// entram por INSERT direto: o cálculo provisório da importação de B/L não participa
// do defeito, porque o CE recalcula (`_auto_bill_bl_core(..., false)`).
//
// Fora daqui: B/L que chega depois do irmão faturado (ORDCE-V03; a ADR 0078 decidiu
// tratar a fatura do irmão pela ADR 0077, checagem a escrever na Etapa 5) e B/L
// cobrado só pela consolidada que segue 'pending' (CED-09).
// Também fora: B/L sem Cliente que recebe o CE com o irmão e é vinculado na Revisão.
// Ele cai na mesma guarda, mas `complete_review_customer_group` grava o Cliente
// (dispara o gatilho do CE) antes de tirar o B/L de 'pending_review', e o gate de
// revisão recusa a emissão por outro motivo (M09); o caso não viraria verde só com
// a correção de M03.
//
// Namespace exclusivo: ids 99203xxx, CNPJ syntheticCnpj(203001..203003), B/Ls
// 'A203-*', usuário ...0203001, manifestos 'A203-MAN-*'. Containers 'ADCU203xxxx':
// a checagem ISO de `bl_containers` (4 letras + 7 dígitos) impede o prefixo A203;
// a limpeza os remove pelo B/L. A limpeza (antes e depois) remove também faturas,
// recebíveis, efeitos, alertas, auditoria, notificações e a conta de Portal criada
// pelo gatilho de inserção de Cliente.
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000203001'
// Alfa e Beta: Liberação de faturamento vigente (gate aberto, ADR 0070).
const alfa = { id: 99203001, cnpj: syntheticCnpj(203001), name: 'A203 CLIENTE ALFA LTDA', email: 'a203-alfa@example.test' }
const beta = { id: 99203002, cnpj: syntheticCnpj(203002), name: 'A203 CLIENTE BETA LTDA', email: 'a203-beta@example.test' }
// Gama: sem Portal pronto e sem Liberação; o CE calcula e retém (CONTEXT.md:1117-1119).
const gama = { id: 99203003, cnpj: syntheticCnpj(203003), name: 'A203 CLIENTE GAMA LTDA', email: 'a203-gama@example.test' }
const carrierId = 99203010
const vesselId = 99203011
const voyage = {
  mesmoCliente: 99203021,
  clientesDiferentes: 99203022,
  liberacao: 99203023,
  datas: 99203024,
}
const chargeTableId = 99203031
const containerItemId = 99203032
const containerFee = 1000
const pol = 'A203O'
const pod = 'A203P'

function localPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asOperator(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function tryAsOperator(sql: string): { output: string | null; error: string | null } {
  try {
    return { output: asOperator(sql), error: null }
  } catch (error) {
    const stderr = (error as { stderr?: string | Buffer }).stderr
    const message = String(stderr ?? error).split('\n').find((line) => line.startsWith('ERROR:')) ?? String(stderr ?? error)
    return { output: null, error: message.trim() }
  }
}

function jsonLiteral(value: unknown): string {
  return `$json$${JSON.stringify(value)}$json$::jsonb`
}

function sqlTextArray(values: string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'`).join(', ')}]::text[]`
}

type BlFixture = { id: string; voyageId: number; customerId: number; container: string }

// B/L de container já importado, com Cliente reconciliado por CNPJ e rota
// cadastrada (a planilha de CE exige POL/POD).
function insertBls(bls: BlFixture[]): void {
  const rows = bls.map((bl) =>
    `('${bl.id}', ${bl.voyageId}, ${bl.customerId}, '${pol}', '${pod}', 'container', 'pending', 'not_calculated', 'matched_document', 'ok', 'A203 CONSIGNATARIO')`)
  localPsql(`
    INSERT INTO public.bls (
      id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status,
      customer_reconciliation_status, review_status, consignee
    ) VALUES ${rows.join(', ')};
    INSERT INTO public.bl_containers (bl_id, container_number, type)
    VALUES ${bls.map((bl) => `('${bl.id}', '${bl.container}', '40HC')`).join(', ')};
  `)
}

function importCeSheet(manifestoNumero: string, voyageId: number, rows: Array<{ blId: string; ce: string }>) {
  const output = asOperator(`
    SELECT public.apply_ce_mercante_rows_atomic(
      ${jsonLiteral(rows.map((row, index) => ({ row: index + 2, bl_id: row.blId, ce: row.ce })))},
      '${actorId}'::uuid, 'bls', '${manifestoNumero}', ${voyageId}
    );
  `)
  return JSON.parse(output) as { ok: boolean; inserted?: number; errors?: unknown }
}

type BlBilling = {
  ce_mercante: string | null
  customer_id: number | null
  financial_status: string | null
  charge_status: string | null
  billing_hold_reason: string | null
}
type ContainerLine = { bl_id: string; invoice_customer_id: number; quantity: number; total_brl: number; label: string | null }
type BillingState = { bls: Record<string, BlBilling>; lines: ContainerLine[] }

// Linha de taxa por container cobrada em fatura viva (individual ou consolidada).
function billingState(blIds: string[]): BillingState {
  return JSON.parse(localPsql(`
    SELECT jsonb_build_object(
      'bls', (
        SELECT jsonb_object_agg(b.id, jsonb_build_object(
          'ce_mercante', b.ce_mercante,
          'customer_id', b.customer_id,
          'financial_status', b.financial_status,
          'charge_status', b.charge_status,
          'billing_hold_reason', b.billing_hold_reason
        ))
        FROM public.bls b WHERE b.id = ANY(${sqlTextArray(blIds)})
      ),
      'lines', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'bl_id', ii.bl_id,
          'invoice_customer_id', inv.customer_id,
          'quantity', ii.quantity,
          'total_brl', ii.total_value_brl,
          'label', ii.snapshot_payload->>'shared_quantity_label'
        ) ORDER BY ii.bl_id, inv.id), '[]'::jsonb)
        FROM public.invoice_items ii
        JOIN public.invoices inv ON inv.id = ii.invoice_id
        WHERE ii.bl_id = ANY(${sqlTextArray(blIds)})
          AND ii.charge_item_id = ${containerItemId}
          AND inv.status IN ('issued', 'partially_paid', 'paid', 'overdue')
      )
    );
  `)) as BillingState
}

function financialStatuses(state: BillingState | null): Record<string, string | null> {
  return Object.fromEntries(Object.entries(state?.bls ?? {}).map(([id, bl]) => [id, bl.financial_status]))
}

function containerShares(state: BillingState | null): Record<string, Array<{ quantity: number; total_brl: number }>> {
  const shares: Record<string, Array<{ quantity: number; total_brl: number }>> = {}
  for (const line of state?.lines ?? []) {
    shares[line.bl_id] = [...(shares[line.bl_id] ?? []), { quantity: line.quantity, total_brl: line.total_brl }]
  }
  return shares
}

function billedContainerTotal(state: BillingState | null): number {
  return (state?.lines ?? []).reduce((sum, line) => sum + line.total_brl, 0)
}

// Recusa das duas guardas da 066 ('Container compartilhado ... já possui snapshot
// financeiro' / '... já está faturado em outra B/L'). Serve para os cenários
// provarem que o B/L ficou para trás por causa delas, e não por gate, revisão,
// tabela, permissão ou erro de SQL; depois da correção a condição não ocorre.
const sharedContainerRefusal = /container compartilhado/i

// `_auto_bill_bl_core` engole a exceção na transição do CE e deixa a mensagem
// original no efeito `local_billing` pendente (migration 085:470-494).
function expectPendingOnlyBySharedContainerGuard(state: BillingState): void {
  const pending = Object.entries(state.bls).filter(([, bl]) => bl.financial_status !== 'invoiced').map(([id]) => id)
  if (pending.length === 0) return
  const refusals = JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_object_agg(entity_id, messages), '{}'::jsonb) FROM (
      SELECT entity_id, jsonb_agg(source_snapshot->>'message' ORDER BY id) AS messages
      FROM public.import_pending_effects
      WHERE entity_id = ANY(${sqlTextArray(pending)})
        AND effect_kind = 'local_billing'
        AND status = 'pending'
        AND source_snapshot->>'reason' = 'auto_billing_failed'
      GROUP BY entity_id
    ) AS refused;
  `)) as Record<string, string[]>
  for (const id of pending) {
    expect(refusals[id] ?? [], `motivo de ${id} ter ficado sem fatura`).toEqual(
      expect.arrayContaining([expect.stringMatching(sharedContainerRefusal)]),
    )
  }
}

type Readiness = { ready: boolean; reasons: string[] }

function communicationReadiness(voyageId: number, customerId: number): Readiness {
  return JSON.parse(localPsql(`SELECT public.customer_local_charges_communication_readiness(${voyageId}, ${customerId});`)) as Readiness
}

const cleanupSql = `
  SET session_replication_role = replica;
  CREATE TEMP TABLE a203_bls AS SELECT id FROM public.bls WHERE id LIKE 'A203-%';
  CREATE TEMP TABLE a203_customers AS SELECT unnest(ARRAY[${alfa.id}, ${beta.id}, ${gama.id}]::bigint[]) AS id;
  CREATE TEMP TABLE a203_voyages AS SELECT unnest(ARRAY[${Object.values(voyage).join(', ')}]::bigint[]) AS id;
  CREATE TEMP TABLE a203_invoices AS
    SELECT id FROM public.invoices
    WHERE bl_id IN (SELECT id FROM a203_bls)
       OR customer_id IN (SELECT id FROM a203_customers)
       OR voyage_id IN (SELECT id FROM a203_voyages)
       OR id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id IN (SELECT id FROM a203_bls))
       OR id IN (SELECT invoice_id FROM public.invoice_items WHERE bl_id IN (SELECT id FROM a203_bls));
  CREATE TEMP TABLE a203_receivables AS
    SELECT id FROM public.bl_receivables
    WHERE bl_id IN (SELECT id FROM a203_bls) OR customer_id IN (SELECT id FROM a203_customers);
  CREATE TEMP TABLE a203_calcs AS SELECT id FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM a203_bls);
  CREATE TEMP TABLE a203_containers AS SELECT id FROM public.bl_containers WHERE bl_id IN (SELECT id FROM a203_bls);
  CREATE TEMP TABLE a203_contacts AS SELECT id FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM a203_customers);
  CREATE TEMP TABLE a203_accounts AS SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM a203_customers);
  CREATE TEMP TABLE a203_alerts AS
    SELECT id FROM public.alerts
    WHERE message LIKE '%A203 %' OR message LIKE '%A203-%'
       OR entity_id LIKE 'A203 %' OR entity_id LIKE 'A203-%'
       OR (entity_type = 'customer' AND entity_id IN (SELECT id::text FROM a203_customers))
       OR (entity_type = 'voyage' AND entity_id IN (SELECT id::text FROM a203_voyages));
  CREATE TEMP TABLE a203_alert_items AS
    SELECT id FROM public.alert_items
    WHERE alert_id IN (SELECT id FROM a203_alerts)
       OR message LIKE '%A203 %' OR message LIKE '%A203-%'
       OR metadata::text LIKE '%A203 %' OR metadata::text LIKE '%A203-%'
       OR metadata->>'customer_id' IN (SELECT id::text FROM a203_customers)
       OR metadata->>'voyage_id' IN (SELECT id::text FROM a203_voyages);

  DELETE FROM public.internal_notifications
  WHERE alert_item_id IN (SELECT id FROM a203_alert_items)
     OR alert_id IN (SELECT id FROM a203_alerts)
     OR recipient_id = '${actorId}';
  DELETE FROM public.alert_item_events
  WHERE alert_item_id IN (SELECT id FROM a203_alert_items) OR actor_id = '${actorId}';
  DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM a203_alert_items);
  DELETE FROM public.alert_notification_failures
  WHERE alert_item_id IN (SELECT id FROM a203_alert_items) OR alert_id IN (SELECT id FROM a203_alerts);
  DELETE FROM public.alert_items WHERE id IN (SELECT id FROM a203_alert_items);
  DELETE FROM public.alerts WHERE id IN (SELECT id FROM a203_alerts);

  DELETE FROM public.import_effect_attempts
  WHERE effect_id IN (
    SELECT id FROM public.import_pending_effects
    WHERE entity_id IN (SELECT id FROM a203_bls) OR created_by = '${actorId}'
  );
  DELETE FROM public.import_pending_effects
  WHERE entity_id IN (SELECT id FROM a203_bls) OR created_by = '${actorId}';

  DELETE FROM public.portal_notifications
  WHERE bl_id IN (SELECT id FROM a203_bls) OR customer_id IN (SELECT id FROM a203_customers);
  DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN (SELECT id FROM a203_invoices);
  DELETE FROM public.ledger_settlements
  WHERE invoice_id IN (SELECT id FROM a203_invoices) OR receivable_id IN (SELECT id FROM a203_receivables);
  DELETE FROM public.invoice_customer_changes
  WHERE bl_id IN (SELECT id FROM a203_bls)
     OR new_invoice_id IN (SELECT id FROM a203_invoices)
     OR original_customer_id IN (SELECT id FROM a203_customers)
     OR target_customer_id IN (SELECT id FROM a203_customers);
  DELETE FROM public.invoice_lifecycle_events
  WHERE invoice_id IN (SELECT id FROM a203_invoices)
     OR related_invoice_id IN (SELECT id FROM a203_invoices)
     OR receivable_id IN (SELECT id FROM a203_receivables);
  DELETE FROM public.invoice_receivable_links
  WHERE invoice_id IN (SELECT id FROM a203_invoices)
     OR bl_id IN (SELECT id FROM a203_bls)
     OR receivable_id IN (SELECT id FROM a203_receivables);
  DELETE FROM public.billing_batches
  WHERE invoice_id IN (SELECT id FROM a203_invoices) OR customer_id IN (SELECT id FROM a203_customers);
  DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM a203_invoices) OR bl_id IN (SELECT id FROM a203_bls);
  DELETE FROM public.invoice_bls WHERE invoice_id IN (SELECT id FROM a203_invoices) OR bl_id IN (SELECT id FROM a203_bls);
  DELETE FROM public.invoices WHERE id IN (SELECT id FROM a203_invoices);
  DELETE FROM public.bl_receivables WHERE id IN (SELECT id FROM a203_receivables);
  DELETE FROM public.invoice_basis_pending_changes WHERE bl_id IN (SELECT id FROM a203_bls);
  DELETE FROM public.charge_calculations WHERE id IN (SELECT id FROM a203_calcs);
  DELETE FROM public.billing_run_logs WHERE bl_id IN (SELECT id FROM a203_bls);
  DELETE FROM public.customer_reconciliation_queue
  WHERE bl_id IN (SELECT id FROM a203_bls) OR customer_id IN (SELECT id FROM a203_customers);
  DELETE FROM public.bl_containers WHERE id IN (SELECT id FROM a203_containers);
  DELETE FROM public.bls WHERE id IN (SELECT id FROM a203_bls);
  DELETE FROM public.manifestos_mercante WHERE voyage_id IN (SELECT id FROM a203_voyages) OR numero LIKE 'A203-%';
  DELETE FROM public.voyage_route_ce_master WHERE voyage_id IN (SELECT id FROM a203_voyages);
  DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (SELECT id FROM a203_voyages);
  DELETE FROM public.voyage_documental_state WHERE voyage_id IN (SELECT id FROM a203_voyages);
  DELETE FROM public.pricing_rule_versions
  WHERE charge_table_id = ${chargeTableId}
     OR charge_item_id = ${containerItemId}
     OR customer_id IN (SELECT id FROM a203_customers);
  DELETE FROM public.charge_table_items WHERE id = ${containerItemId};
  DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
  DELETE FROM public.voyages WHERE id IN (SELECT id FROM a203_voyages);
  DELETE FROM public.vessels WHERE id = ${vesselId};
  DELETE FROM public.carriers WHERE id = ${carrierId};

  DELETE FROM public.portal_provisioning_events
  WHERE customer_id IN (SELECT id FROM a203_customers) OR account_id IN (SELECT id FROM a203_accounts);
  DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM a203_accounts);
  DELETE FROM public.portal_invites WHERE account_id IN (SELECT id FROM a203_accounts);
  DELETE FROM public.customer_portal_sessions
  WHERE account_id IN (SELECT id FROM a203_accounts) OR customer_id IN (SELECT id FROM a203_customers);
  DELETE FROM public.portal_inspection_events WHERE customer_id IN (SELECT id FROM a203_customers);
  DELETE FROM public.portal_rate_limits WHERE customer_id IN (SELECT id FROM a203_customers);
  DELETE FROM public.customer_portal_accounts WHERE id IN (SELECT id FROM a203_accounts);
  DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM a203_contacts);
  DELETE FROM public.customer_contact_preferences WHERE contact_id IN (SELECT id FROM a203_contacts);
  DELETE FROM public.customer_contact_change_events WHERE customer_id IN (SELECT id FROM a203_customers);
  DELETE FROM public.customer_contacts WHERE id IN (SELECT id FROM a203_contacts);
  DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (SELECT id FROM a203_customers);
  DELETE FROM public.customers WHERE id IN (SELECT id FROM a203_customers);

  DELETE FROM public.audit_logs
  WHERE changed_by = '${actorId}'
     OR entity_id LIKE 'A203-%'
     OR (entity_type IN ('customers', 'customer') AND entity_id IN (SELECT id::text FROM a203_customers))
     OR (entity_type IN ('voyages', 'voyage') AND entity_id IN (SELECT id::text FROM a203_voyages))
     OR (entity_type = 'vessels' AND entity_id = '${vesselId}')
     OR (entity_type = 'carriers' AND entity_id = '${carrierId}')
     OR (entity_type = 'charge_tables' AND entity_id = '${chargeTableId}')
     OR (entity_type = 'charge_table_items' AND entity_id = '${containerItemId}')
     OR (entity_type = 'customer_contacts' AND entity_id IN (SELECT id::text FROM a203_contacts))
     OR (entity_type = 'bl_containers' AND entity_id IN (SELECT id::text FROM a203_containers))
     OR (entity_type IN ('invoices', 'invoice') AND entity_id IN (SELECT id::text FROM a203_invoices))
     OR (entity_type = 'bl_receivables' AND entity_id IN (SELECT id::text FROM a203_receivables))
     OR (entity_type = 'charge_calculations' AND entity_id IN (SELECT id::text FROM a203_calcs));
  DELETE FROM public.user_profiles WHERE id = '${actorId}';
  DELETE FROM auth.users WHERE id = '${actorId}';
  SET session_replication_role = origin;
`

function cleanup(): void {
  localPsql(cleanupSql)
}

// Regra comum aos cenários de faturamento: CONTEXT.md:1153-1155 (B/Ls que dividem
// um container recebem o CE no mesmo momento; é isso que garante o rateio correto),
// ADR 0020 nota de 2026-08-06 (docs/adr/0020-ce-mercante-gatilho-calculo-taxas-locais.md:111-132:
// o caso residual não acontece porque o CE é simultâneo; a soma dos rateios cobrados
// por container fecha em 1) e CONTEXT.md:1324-1326 (Invoice Individual é emitida
// para as cobranças elegíveis de um B/L). Fração '1/N' no documento: faturamento.md:125-128.
describeLocal('M03 — container compartilhado entre B/Ls no faturamento pelo CE', () => {
  beforeAll(() => {
    cleanup()
    localPsql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'a203-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'A203 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${alfa.id}, '${alfa.cnpj}', '${alfa.name}'),
        (${beta.id}, '${beta.cnpj}', '${beta.name}'),
        (${gama.id}, '${gama.cnpj}', '${gama.name}');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A203 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A203 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyage.mesmoCliente}, ${vesselId}, 'A203A', 'active'),
        (${voyage.clientesDiferentes}, ${vesselId}, 'A203B', 'active'),
        (${voyage.liberacao}, ${vesselId}, 'A203C', 'active'),
        (${voyage.datas}, ${vesselId}, 'A203D', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${chargeTableId}, 'Tabela A203 container', '${pod}', CURRENT_DATE - 30, true, 'container');
      -- Item por container rateado entre os B/Ls que o dividem (1/share_count).
      INSERT INTO public.charge_table_items (
        id, charge_table_id, name, applies_to, value_brl, unit_value_brl,
        application_basis, category, cargo_profile, currency
      ) VALUES (
        ${containerItemId}, ${chargeTableId}, 'Taxa A203 por container', 'container', ${containerFee}, ${containerFee},
        'container_distinct_voyage', 'base', 'any', 'BRL'
      );
      -- Desde a 083/084 o CE só emite com Liberação vigente e contato com e-mail.
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary) VALUES
        (${alfa.id}, 'Financeiro A203 Alfa', '${alfa.email}', 'financeiro', true),
        (${beta.id}, 'Financeiro A203 Beta', '${beta.email}', 'financeiro', true),
        (${gama.id}, 'Financeiro A203 Gama', '${gama.email}', 'financeiro', true);
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at) VALUES
        (${alfa.id}, 'Fixture A203: gate aberto para o CE', '${actorId}', now() + interval '1 day'),
        (${beta.id}, 'Fixture A203: gate aberto para o CE', '${actorId}', now() + interval '1 day');
    `)
  })

  afterAll(cleanup)

  // --- 1. Mesmo Cliente, CE dos dois na mesma planilha -------------------------
  let sameCustomer: { state: BillingState; readiness: Readiness } | null = null

  it('cenário 1: dois B/Ls do mesmo Cliente dividem um container e recebem o CE na mesma planilha', () => {
    insertBls([
      { id: 'A203-S1', voyageId: voyage.mesmoCliente, customerId: alfa.id, container: 'ADCU2030011' },
      { id: 'A203-S2', voyageId: voyage.mesmoCliente, customerId: alfa.id, container: 'ADCU2030011' },
    ])
    const result = importCeSheet('A203-MAN-1', voyage.mesmoCliente, [
      { blId: 'A203-S1', ce: '203001000000011' },
      { blId: 'A203-S2', ce: '203001000000012' },
    ])
    expect(result).toMatchObject({ ok: true, inserted: 2 })

    const state = billingState(['A203-S1', 'A203-S2'])
    sameCustomer = { state, readiness: communicationReadiness(voyage.mesmoCliente, alfa.id) }
    expect(state.bls['A203-S1'].ce_mercante).toBe('203001000000011')
    expect(state.bls['A203-S2'].ce_mercante).toBe('203001000000012')
    // Pré-condição da fixture: gate aberto, tabela resolvida e rateio 1/2 vigente.
    expect(state.lines.length).toBeGreaterThan(0)
    expect(state.lines.every((line) => line.quantity === 0.5 && line.total_brl === containerFee / 2)).toBe(true)
    expectPendingOnlyBySharedContainerGuard(state)
  })

  it.fails('esperado: os dois B/Ls ficam faturados, cada um com 1/2 do container, e o Comunicado de CE e Taxas fica pronto [CED-01, ORDCE-01, ORDCT-V03] — regra: CONTEXT.md:1153-1155, ADR 0020:111-132, CONTEXT.md:1324-1326 e clientes.md:176-178 (prontidão exige faturamento concluído em todos os B/Ls)', () => {
    expect(financialStatuses(sameCustomer?.state ?? null)).toEqual({ 'A203-S1': 'invoiced', 'A203-S2': 'invoiced' })
    expect(containerShares(sameCustomer?.state ?? null)).toEqual({
      'A203-S1': [{ quantity: 0.5, total_brl: 500 }],
      'A203-S2': [{ quantity: 0.5, total_brl: 500 }],
    })
    expect(billedContainerTotal(sameCustomer?.state ?? null)).toBe(containerFee)
    expect(sameCustomer?.readiness).toMatchObject({ ready: true, reasons: [] })
  })

  // --- 2. Clientes diferentes, CE dos dois na mesma planilha ------------------
  // Cenário 2 (Clientes diferentes no mesmo container) saiu na ADR 0078: container
  // FCL não é dividido entre Clientes diferentes, e a importação de B/L passa a
  // recusar esse estado. A checagem da recusa entra com a Etapa 5 do plano.

  // --- 3. CE retido sem Portal; a Liberação abre o gate depois ----------------
  let afterRelease: { reprocess: { issued: number; blocked: number; failed: number; gate_open: boolean }; state: BillingState } | null = null

  it('cenário 3: Cliente sem Portal recebe o CE dos dois B/Ls do container e depois o Administrativo concede a Liberação', () => {
    insertBls([
      { id: 'A203-G1', voyageId: voyage.liberacao, customerId: gama.id, container: 'ADCU2030033' },
      { id: 'A203-G2', voyageId: voyage.liberacao, customerId: gama.id, container: 'ADCU2030033' },
    ])
    expect(importCeSheet('A203-MAN-3', voyage.liberacao, [
      { blId: 'A203-G1', ce: '203001000000031' },
      { blId: 'A203-G2', ce: '203001000000032' },
    ])).toMatchObject({ ok: true, inserted: 2 })
    const held = billingState(['A203-G1', 'A203-G2'])
    for (const id of ['A203-G1', 'A203-G2']) {
      expect(held.bls[id]).toMatchObject({
        financial_status: 'pending',
        charge_status: 'calculated',
        billing_hold_reason: 'Acesso ao portal nao provisionado',
      })
    }
    expect(held.lines).toEqual([])

    // Mesmo payload de grantBillingPortalRelease; reviewDateToTimestamp
    // (billingPortalRelease.ts:38-40) fecha o dia no horário de Brasília.
    const reviewDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const grant = JSON.parse(asOperator(`
      SELECT public.grant_customer_billing_portal_release(
        ${gama.id}, 'Liberação A203 para emitir o CE retido', '${reviewDate}T23:59:59-03:00'::timestamptz
      );
    `)) as { reprocess: { issued: number; blocked: number; failed: number; gate_open: boolean } }
    afterRelease = { reprocess: grant.reprocess, state: billingState(['A203-G1', 'A203-G2']) }
    expect(grant.reprocess.gate_open).toBe(true)
    expect(grant.reprocess.issued).toBeGreaterThan(0)
    expect(afterRelease.state.lines.length).toBeGreaterThan(0)
    expect(afterRelease.state.lines.every((line) => line.quantity === 0.5)).toBe(true)

    // A Liberação conta P0003 como bloqueio de negócio e não registra o motivo
    // (migration 085:570-578). "Emitir fatura" na ficha do B/L (billing.ts:945-956)
    // mostra qual guarda segura quem ficou para trás; a recusa desfaz a chamada.
    for (const [id, bl] of Object.entries(afterRelease.state.bls)) {
      if (bl.financial_status === 'invoiced') continue
      expect(tryAsOperator(`SELECT public.mark_bl_ready_and_create_invoice('${id}');`).error, `Emitir fatura de ${id}`)
        .toEqual(expect.stringMatching(sharedContainerRefusal))
    }
  })

  it.fails('esperado: a Liberação emite os dois B/Ls retidos, cada um com 1/2 do container [CED-01, ORDCE-01] — regra: CONTEXT.md:1117-1119 (a fatura retida sai quando o Administrativo concede a Liberação), ADR 0070 e CONTEXT.md:1153-1155', () => {
    expect(afterRelease?.reprocess).toMatchObject({ issued: 2, blocked: 0, failed: 0 })
    expect(financialStatuses(afterRelease?.state ?? null)).toEqual({ 'A203-G1': 'invoiced', 'A203-G2': 'invoiced' })
    expect(billedContainerTotal(afterRelease?.state ?? null)).toBe(containerFee)
  })

  // --- 4. Datas de descarga e devolução no irmão do B/L faturado --------------
  let siblingDates: { error: string | null; container: { discharge_date: string | null; return_date: string | null } } | null = null

  it('cenário 4: importar datas de descarga e devolução do container compartilhado no B/L irmão de um B/L faturado', () => {
    insertBls([
      { id: 'A203-T1', voyageId: voyage.datas, customerId: alfa.id, container: 'ADCU2030044' },
      { id: 'A203-T2', voyageId: voyage.datas, customerId: alfa.id, container: 'ADCU2030044' },
    ])
    expect(importCeSheet('A203-MAN-4', voyage.datas, [
      { blId: 'A203-T1', ce: '203001000000041' },
      { blId: 'A203-T2', ce: '203001000000042' },
    ])).toMatchObject({ ok: true, inserted: 2 })
    expect(billingState(['A203-T1']).bls['A203-T1'].financial_status).toBe('invoiced')

    // Payload de importContainerDates: uma unidade por B/L, com o estado visto na prévia.
    const result = tryAsOperator(`
      SELECT public.apply_container_dates_atomic(
        '${randomUUID()}'::uuid, 'A203-T2',
        ${jsonLiteral([{
          container_number: 'ADCU2030044',
          discharge_date: '2026-10-01',
          return_date: '2026-10-06',
          expected_discharge_date: null,
          expected_return_date: null,
        }])},
        '${actorId}'::uuid
      );
    `)
    siblingDates = {
      error: result.error,
      container: JSON.parse(localPsql(`
        SELECT jsonb_build_object('discharge_date', discharge_date, 'return_date', return_date)
        FROM public.bl_containers WHERE bl_id = 'A203-T2' AND container_number = 'ADCU2030044';
      `)) as { discharge_date: string | null; return_date: string | null },
    }
    expect(siblingDates.container).toHaveProperty('discharge_date')
    // Hoje a recusa tem de vir da guarda de mutação, não de permissão ou de SQL.
    if (siblingDates.error !== null) expect(siblingDates.error).toMatch(sharedContainerRefusal)
  })

  // Resolvido pela migration 174 (Etapa 2): a guarda de container compartilhado
  // olha só a mudança de participação, e datas do irmão passam.
  it('esperado: as datas do irmão são gravadas, sem pedir cancelamento da fatura do outro B/L [DAT-10, ORDCT-09] — regra: ADR 0077 decisão 2 (docs/adr/0077-fatura-emitida-nao-muda-de-valor.md:17-24: data de Demurrage não é correção; não há cancelar e reemitir manual)', () => {
    expect(siblingDates?.error).toBeNull()
    expect(siblingDates?.container).toEqual({ discharge_date: '2026-10-01', return_date: '2026-10-06' })
  })
})
