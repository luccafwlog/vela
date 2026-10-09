// Checagens de aceitação da revisão das importações (2026-10-09; docs/archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md).
// Cada it.fails documenta um defeito confirmado e roda no job local-pg do CI; quando a correção entrar, troque it.fails por it.
//
// Problema-raiz M04: a fila `import_pending_effects` guarda intenções sem
// validade e o `import-effects-runner` está pausado em produção
// (docs/operations/servicos-externos.md:297-322). Os consumidores executam a
// intenção sem revalidar o estado atual:
// - `_run_import_effect_vehicle_followup` (migration 128:897-977) cancela toda
//   fatura do B/L com o motivo "isento", sem testar a isenção; o gatilho adiado
//   da 128 já tratou a fatura no commit da importação de veículos;
// - `_run_import_effect_local_charges` (migration 056:754-884) chama
//   `auto_bill_bl_after_ce_mercante` → `_auto_bill_bl_core(..., false)` (085:509)
//   e recalcula o B/L retido pela tabela do dia do processamento; um B/L de
//   carga solta (sem containers) deixa `v_container_numbers` NULL e recalcula
//   todos os B/Ls pendentes da Viagem (056:829), apagando a retenção do Portal;
//   a falha transitória capturada por `_auto_bill_bl_core` volta como 22023
//   (056:874) e `process_import_effect` (031:838-844) a bloqueia de vez;
// - `claim_import_effects` (017:276-302) bloqueia o efeito de lease esgotado sem
//   abrir o Alerta `import_effect_blocked`.
//
// O executor é simulado como o `import-effects-runner/index.ts:46-68`: papel
// `service_role`, `claim_import_effects` e `process_import_effect` por efeito, com
// `import_effects.entity_prefix` para só tocar os efeitos desta suíte. As ações
// de usuário usam as RPCs reais como `authenticated`, com os payloads dos
// serviços: planilha de CE `apply_ce_mercante_rows_atomic` (ceMercanteImport.ts:197-207),
// veículos `import_vehicle_rows_transactional` (vehicleImport.ts:337-357),
// carga solta `import_breakbulk_manifest_transactional` (breakbulkImport.ts:54-149)
// e Liberação `grant_customer_billing_portal_release` (billingPortalRelease.ts:43-47).
// A mudança de tabela é um UPDATE no item, como em portalBillingRelease.local-pg.test.ts.
//
// Fora daqui, por dependerem de decisão: efeito `physical_flags` da Viagem inteira
// que desfaz correção manual de perfil (BAP-V01, precedência manual × Baplie é do
// M11); efeito 'Concluído' com resultado de domínio bloqueado (INF-07); efeitos
// duplicados por revisão fixa (INF-14, sem regra de comportamento visível);
// emissão automática de Demurrage pela fila (DAT-06, decisão pendente). O
// cenário 4 cita DAT-06 só pela parte "erro transitório vira bloqueio".
//
// Os cenários 2, 3 e 4 partem do efeito `local_billing` que a planilha de CE
// registra para o B/L retido e que hoje fica pendente. Se a correção fizer esse
// efeito nascer superseded (ADR 0070:39-40), o cenário 4 precisa de outra fonte
// de efeito para a trava, e as pré-condições de efeito pendente dos cenários 2
// e 3 mudam; as regras dos it.fails continuam as mesmas.
//
// Namespace exclusivo: ids 99204xxx, CNPJ syntheticCnpj(204001..204004), B/Ls
// 'A204-*', usuários ...0000002040NN, manifestos 'A204-MAN-*'. Containers
// 'ADCU204xxxx': a checagem ISO de `bl_containers` impede o prefixo A204; a
// limpeza os remove pelo B/L. A limpeza (antes e depois) remove também faturas,
// recebíveis, cálculos, veículos, itens de carga solta, lotes, efeitos e
// tentativas, Alertas (inclusive os de efeito), auditoria, notificações e a
// conta de Portal criada pelo gatilho de inserção de Cliente.
import { execFileSync, spawn } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000204001'
const equipId = '00000000-0000-0000-0000-000000204002'
const actorIds = [adminId, equipId]
const HOLD = 'Acesso ao portal nao provisionado'
const WORKER = 'a204-import-effects-runner'

// Aberto: Liberação de faturamento vigente (gate aberto, ADR 0070); o CE emite.
const aberto = { id: 99204001, cnpj: syntheticCnpj(204001), name: 'A204 CLIENTE ABERTO LTDA' }
// Retidos: sem Portal pronto e sem Liberação; o CE calcula e retém (ADR 0070:37-41).
// Um por cenário, porque a Liberação de um cenário reprocessa todos os B/Ls do Cliente.
const retidoTabela = { id: 99204002, cnpj: syntheticCnpj(204002), name: 'A204 CLIENTE RETIDO TABELA LTDA' }
const retidoViagem = { id: 99204003, cnpj: syntheticCnpj(204003), name: 'A204 CLIENTE RETIDO VIAGEM LTDA' }
const retidoTrava = { id: 99204004, cnpj: syntheticCnpj(204004), name: 'A204 CLIENTE RETIDO TRAVA LTDA' }
const customers = [aberto, retidoTabela, retidoViagem, retidoTrava]
const carrierId = 99204010
const vesselId = 99204011
const voyage = { veiculos: 99204021, tabela: 99204022, cargaSolta: 99204023, trava: 99204024, lease: 99204025 }
const pol = 'A204O'
// Uma tabela por POD, para que a mudança de preço de um cenário não toque os outros.
const tables = {
  base: { id: 99204031, itemId: 99204032, pod: 'A204P', cargoMode: 'container', fee: 125 },
  tabela: { id: 99204033, itemId: 99204034, pod: 'A204Q', cargoMode: 'container', fee: 90 },
  viagem: { id: 99204035, itemId: 99204036, pod: 'A204R', cargoMode: 'container', fee: 100 },
  viagemCargaSolta: { id: 99204037, itemId: 99204038, pod: 'A204R', cargoMode: 'carga_solta', fee: 50 },
}
const tableIds = Object.values(tables).map((table) => table.id)
const itemIds = Object.values(tables).map((table) => table.itemId)

function psqlArgs(sql: string): string[] {
  return ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql]
}

// Fixture e leitura: dono do banco com claims de service_role (sem RLS).
function localPsql(sql: string): string {
  return execFileSync('psql', psqlArgs(
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${adminId}'; ${sql}`,
  ), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

// Usuário interno real: papel `authenticated`, RLS e grants valem.
function asUser(sub: string, sql: string): string {
  return execFileSync('psql', psqlArgs(
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${sub}'; ${sql}`,
  ), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

// Um ciclo do executor (import-effects-runner/index.ts:46-68), restrito ao prefixo.
function runWorker(entityPrefix: string, sessionSql = ''): Array<{ id: number; entity: string; kind: string; status: string }> {
  const output = execFileSync('psql', psqlArgs(`
    SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
    SET import_effects.entity_prefix = '${entityPrefix}'; ${sessionSql}
    SELECT jsonb_build_object(
      'id', c.id, 'entity', c.entity_id, 'kind', c.effect_kind,
      'status', public.process_import_effect(c.id, '${WORKER}')->'effect'->>'status'
    )
    FROM public.claim_import_effects('${WORKER}', 50, 300) AS c
    ORDER BY c.id;
  `), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  return output.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { id: number; entity: string; kind: string; status: string })
}

function jsonLiteral(value: unknown): string {
  return `$json$${JSON.stringify(value)}$json$::jsonb`
}

function importCeSheet(manifestoNumero: string, voyageId: number, rows: Array<{ blId: string; ce: string }>) {
  return JSON.parse(asUser(adminId, `
    SELECT public.apply_ce_mercante_rows_atomic(
      ${jsonLiteral(rows.map((row, index) => ({ row: index + 2, bl_id: row.blId, ce: row.ce })))},
      '${adminId}'::uuid, 'bls', '${manifestoNumero}', ${voyageId}
    );
  `)) as { ok: boolean; inserted?: number; errors?: unknown }
}

// Mesmo payload de importVehicleRows (vehicleImport.ts:337-357), pelo usuário de Equipamentos.
function importVehicles(rows: Array<{ voyageId: number; blId: string; chassis: string }>): string {
  const payload = rows.map((row) => ({
    voyage_id: row.voyageId,
    container_id: Number(localPsql(`SELECT id FROM public.bl_containers WHERE bl_id = '${row.blId}';`)),
    bl_id: row.blId,
    chassis: row.chassis,
    brand: 'BYD',
    model: 'SEAL',
    weight_kg: 1600,
    cbm: 12,
    unpacking_location: null,
  }))
  return asUser(equipId, `SELECT public.import_vehicle_rows_transactional(${jsonLiteral(payload)});`)
}

// Mesmo payload de grantBillingPortalRelease; reviewDateToTimestamp
// (billingPortalRelease.ts:38-40) fecha o dia no horário de Brasília.
function grantRelease(customerId: number) {
  const reviewDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return JSON.parse(asUser(adminId, `
    SELECT public.grant_customer_billing_portal_release(
      ${customerId}, 'Liberação A204 para emitir o CE retido', '${reviewDate}T23:59:59-03:00'::timestamptz
    );
  `)) as { reprocess: { issued: number; blocked: number; failed: number; gate_open: boolean } }
}

function setPrice(itemId: number, value: number): void {
  localPsql(`UPDATE public.charge_table_items SET value_brl = ${value}, unit_value_brl = ${value} WHERE id = ${itemId};`)
}

// B/L de container já importado, com rota (a planilha de CE exige POL/POD) e Cliente por CNPJ.
function insertContainerBl(bl: { id: string; voyageId: number; customerId: number; pod: string; container: string; seal: string }): void {
  localPsql(`
    INSERT INTO public.bls (
      id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status,
      customer_reconciliation_status, review_status, consignee, movement_to
    ) VALUES (
      '${bl.id}', ${bl.voyageId}, ${bl.customerId}, '${pol}', '${bl.pod}', 'container', 'pending', 'not_calculated',
      'matched_document', 'ok', 'A204 CONSIGNATARIO', 'CY/CY'
    );
    INSERT INTO public.bl_containers (bl_id, container_number, type, seal_number)
    VALUES ('${bl.id}', '${bl.container}', '40HC', '${bl.seal}');
  `)
}

type BlCharge = { financial_status: string; charge_status: string; billing_hold_reason: string | null; auto_total: number }

function blCharge(blId: string): BlCharge {
  return JSON.parse(localPsql(`
    SELECT jsonb_build_object(
      'financial_status', b.financial_status,
      'charge_status', b.charge_status,
      'billing_hold_reason', b.billing_hold_reason,
      'auto_total', (SELECT COALESCE(sum(cc.total_value_brl), 0) FROM public.charge_calculations cc
        WHERE cc.bl_id = b.id AND cc.source = 'auto')
    ) FROM public.bls b WHERE b.id = '${blId}';
  `)) as BlCharge
}

type InvoiceRow = { id: number; type: string; status: string; total_brl: number; cancel_reason: string | null }

function individualInvoices(blId: string): InvoiceRow[] {
  return JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', inv.id, 'type', inv.invoice_type, 'status', inv.status,
      'total_brl', inv.total_brl, 'cancel_reason', inv.cancel_reason
    ) ORDER BY inv.id), '[]'::jsonb)
    FROM public.invoices inv
    WHERE inv.id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id = '${blId}');
  `)) as InvoiceRow[]
}

type EffectRow = { id: number; kind: string; status: string; attempts: number; last_error_code: string | null; last_error_message: string | null }

function effects(entityId: string): EffectRow[] {
  return JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id, 'kind', e.effect_kind, 'status', e.status, 'attempts', e.attempts,
      'last_error_code', e.last_error_code, 'last_error_message', e.last_error_message
    ) ORDER BY e.id), '[]'::jsonb)
    FROM public.import_pending_effects e WHERE e.entity_id = '${entityId}';
  `)) as EffectRow[]
}

function blockedEffectAlerts(effectId: number): number {
  return Number(localPsql(`
    SELECT count(*) FROM public.alert_items ai
    WHERE ai.item_type = 'import_effect_blocked' AND ai.status = 'active'
      AND ai.metadata->>'effect_id' = '${effectId}';
  `))
}

const customerIdList = customers.map((customer) => customer.id).join(', ')
const voyageIdList = Object.values(voyage).join(', ')
const actorList = actorIds.map((id) => `'${id}'`).join(', ')

const cleanupSql = `
  SET session_replication_role = replica;
  CREATE TEMP TABLE a204_bls AS SELECT id FROM public.bls WHERE id LIKE 'A204-%';
  CREATE TEMP TABLE a204_customers AS SELECT unnest(ARRAY[${customerIdList}]::bigint[]) AS id;
  CREATE TEMP TABLE a204_voyages AS SELECT unnest(ARRAY[${voyageIdList}]::bigint[]) AS id;
  CREATE TEMP TABLE a204_effects AS
    SELECT id FROM public.import_pending_effects
    WHERE entity_id LIKE 'A204-%'
       OR entity_id IN (SELECT id::text FROM a204_voyages)
       OR created_by IN (${actorList});
  CREATE TEMP TABLE a204_invoices AS
    SELECT id FROM public.invoices
    WHERE bl_id IN (SELECT id FROM a204_bls)
       OR customer_id IN (SELECT id FROM a204_customers)
       OR voyage_id IN (SELECT id FROM a204_voyages)
       OR id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id IN (SELECT id FROM a204_bls))
       OR id IN (SELECT invoice_id FROM public.invoice_items WHERE bl_id IN (SELECT id FROM a204_bls));
  CREATE TEMP TABLE a204_receivables AS
    SELECT id FROM public.bl_receivables
    WHERE bl_id IN (SELECT id FROM a204_bls) OR customer_id IN (SELECT id FROM a204_customers);
  CREATE TEMP TABLE a204_calcs AS SELECT id FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM a204_bls);
  CREATE TEMP TABLE a204_containers AS SELECT id FROM public.bl_containers WHERE bl_id IN (SELECT id FROM a204_bls);
  CREATE TEMP TABLE a204_vehicles AS SELECT id FROM public.vehicles WHERE bl_id IN (SELECT id FROM a204_bls);
  CREATE TEMP TABLE a204_batches AS
    SELECT id FROM public.import_batches
    WHERE voyage_id IN (SELECT id FROM a204_voyages) OR uploaded_by IN (${actorList});
  CREATE TEMP TABLE a204_contacts AS SELECT id FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM a204_customers);
  CREATE TEMP TABLE a204_accounts AS SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM a204_customers);
  CREATE TEMP TABLE a204_alerts AS
    SELECT id FROM public.alerts
    WHERE message LIKE '%A204%' OR entity_id LIKE 'A204%'
       OR (entity_type = 'import_effect' AND entity_id IN (SELECT id::text FROM a204_effects))
       OR (entity_type = 'customer' AND entity_id IN (SELECT id::text FROM a204_customers))
       OR (entity_type = 'voyage' AND entity_id IN (SELECT id::text FROM a204_voyages))
       OR (entity_type = 'invoice' AND entity_id IN (SELECT id::text FROM a204_invoices));
  CREATE TEMP TABLE a204_alert_items AS
    SELECT id FROM public.alert_items
    WHERE alert_id IN (SELECT id FROM a204_alerts)
       OR message LIKE '%A204%'
       OR metadata::text LIKE '%A204%'
       OR metadata->>'effect_id' IN (SELECT id::text FROM a204_effects)
       OR metadata->>'customer_id' IN (SELECT id::text FROM a204_customers)
       OR metadata->>'voyage_id' IN (SELECT id::text FROM a204_voyages);

  DELETE FROM public.internal_notifications
  WHERE alert_item_id IN (SELECT id FROM a204_alert_items)
     OR alert_id IN (SELECT id FROM a204_alerts)
     OR recipient_id IN (${actorList});
  DELETE FROM public.alert_item_events
  WHERE alert_item_id IN (SELECT id FROM a204_alert_items) OR actor_id IN (${actorList});
  DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM a204_alert_items);
  DELETE FROM public.alert_notification_failures
  WHERE alert_item_id IN (SELECT id FROM a204_alert_items) OR alert_id IN (SELECT id FROM a204_alerts);
  DELETE FROM public.alert_items WHERE id IN (SELECT id FROM a204_alert_items);
  DELETE FROM public.alerts WHERE id IN (SELECT id FROM a204_alerts);

  DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM a204_effects);
  DELETE FROM public.import_pending_effects WHERE id IN (SELECT id FROM a204_effects);

  DELETE FROM public.portal_notifications
  WHERE bl_id IN (SELECT id FROM a204_bls) OR customer_id IN (SELECT id FROM a204_customers);
  DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN (SELECT id FROM a204_invoices);
  DELETE FROM public.ledger_settlements
  WHERE invoice_id IN (SELECT id FROM a204_invoices) OR receivable_id IN (SELECT id FROM a204_receivables);
  DELETE FROM public.invoice_refunds WHERE invoice_id IN (SELECT id FROM a204_invoices);
  DELETE FROM public.invoice_corrections WHERE invoice_id IN (SELECT id FROM a204_invoices);
  DELETE FROM public.payments WHERE invoice_id IN (SELECT id FROM a204_invoices);
  DELETE FROM public.invoice_customer_changes
  WHERE bl_id IN (SELECT id FROM a204_bls)
     OR new_invoice_id IN (SELECT id FROM a204_invoices)
     OR original_customer_id IN (SELECT id FROM a204_customers)
     OR target_customer_id IN (SELECT id FROM a204_customers);
  DELETE FROM public.invoice_lifecycle_events
  WHERE invoice_id IN (SELECT id FROM a204_invoices)
     OR related_invoice_id IN (SELECT id FROM a204_invoices)
     OR receivable_id IN (SELECT id FROM a204_receivables);
  DELETE FROM public.invoice_receivable_links
  WHERE invoice_id IN (SELECT id FROM a204_invoices)
     OR bl_id IN (SELECT id FROM a204_bls)
     OR receivable_id IN (SELECT id FROM a204_receivables);
  DELETE FROM public.billing_batches
  WHERE invoice_id IN (SELECT id FROM a204_invoices) OR customer_id IN (SELECT id FROM a204_customers);
  DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM a204_invoices) OR bl_id IN (SELECT id FROM a204_bls);
  DELETE FROM public.invoice_bls WHERE invoice_id IN (SELECT id FROM a204_invoices) OR bl_id IN (SELECT id FROM a204_bls);
  DELETE FROM public.invoices WHERE id IN (SELECT id FROM a204_invoices);
  DELETE FROM public.bl_receivables WHERE id IN (SELECT id FROM a204_receivables);
  DELETE FROM public.invoice_basis_pending_changes WHERE bl_id IN (SELECT id FROM a204_bls);
  DELETE FROM public.charge_calculations WHERE id IN (SELECT id FROM a204_calcs);
  DELETE FROM public.billing_run_logs WHERE bl_id IN (SELECT id FROM a204_bls);
  DELETE FROM public.customer_reconciliation_queue
  WHERE bl_id IN (SELECT id FROM a204_bls) OR customer_id IN (SELECT id FROM a204_customers);
  DELETE FROM public.vehicles WHERE id IN (SELECT id FROM a204_vehicles);
  DELETE FROM public.bl_breakbulk_items WHERE bl_id IN (SELECT id FROM a204_bls);
  DELETE FROM public.bl_containers WHERE id IN (SELECT id FROM a204_containers);
  DELETE FROM public.bls WHERE id IN (SELECT id FROM a204_bls);
  DELETE FROM public.import_errors WHERE batch_id IN (SELECT id FROM a204_batches);
  DELETE FROM public.import_batches WHERE id IN (SELECT id FROM a204_batches);
  DELETE FROM public.manifestos_mercante WHERE voyage_id IN (SELECT id FROM a204_voyages) OR numero LIKE 'A204-%';
  DELETE FROM public.voyage_route_ce_master WHERE voyage_id IN (SELECT id FROM a204_voyages);
  DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (SELECT id FROM a204_voyages);
  DELETE FROM public.voyage_documental_state WHERE voyage_id IN (SELECT id FROM a204_voyages);
  DELETE FROM public.pricing_rule_versions
  WHERE charge_table_id IN (${tableIds.join(', ')})
     OR charge_item_id IN (${itemIds.join(', ')})
     OR customer_id IN (SELECT id FROM a204_customers);
  DELETE FROM public.charge_table_items WHERE id IN (${itemIds.join(', ')});
  DELETE FROM public.charge_tables WHERE id IN (${tableIds.join(', ')});
  DELETE FROM public.voyages WHERE id IN (SELECT id FROM a204_voyages);
  DELETE FROM public.vessels WHERE id = ${vesselId};
  DELETE FROM public.carriers WHERE id = ${carrierId};

  DELETE FROM public.portal_provisioning_events
  WHERE customer_id IN (SELECT id FROM a204_customers) OR account_id IN (SELECT id FROM a204_accounts);
  DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM a204_accounts);
  DELETE FROM public.portal_invites WHERE account_id IN (SELECT id FROM a204_accounts);
  DELETE FROM public.customer_portal_sessions
  WHERE account_id IN (SELECT id FROM a204_accounts) OR customer_id IN (SELECT id FROM a204_customers);
  DELETE FROM public.portal_inspection_events WHERE customer_id IN (SELECT id FROM a204_customers);
  DELETE FROM public.portal_rate_limits WHERE customer_id IN (SELECT id FROM a204_customers);
  DELETE FROM public.customer_portal_accounts WHERE id IN (SELECT id FROM a204_accounts);
  DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM a204_contacts);
  DELETE FROM public.customer_contact_preferences WHERE contact_id IN (SELECT id FROM a204_contacts);
  DELETE FROM public.customer_contact_change_events WHERE customer_id IN (SELECT id FROM a204_customers);
  DELETE FROM public.customer_contacts WHERE id IN (SELECT id FROM a204_contacts);
  DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (SELECT id FROM a204_customers);
  DELETE FROM public.customers WHERE id IN (SELECT id FROM a204_customers);

  DELETE FROM public.audit_logs
  WHERE changed_by IN (${actorList})
     OR entity_id LIKE 'A204%'
     OR (entity_type = 'import_effect' AND entity_id IN (SELECT id::text FROM a204_effects))
     OR (entity_type IN ('customers', 'customer') AND entity_id IN (SELECT id::text FROM a204_customers))
     OR (entity_type IN ('voyages', 'voyage') AND entity_id IN (SELECT id::text FROM a204_voyages))
     OR (entity_type = 'vessels' AND entity_id = '${vesselId}')
     OR (entity_type = 'carriers' AND entity_id = '${carrierId}')
     OR (entity_type = 'charge_tables' AND entity_id IN (${tableIds.map((id) => `'${id}'`).join(', ')}))
     OR (entity_type = 'charge_table_items' AND entity_id IN (${itemIds.map((id) => `'${id}'`).join(', ')}))
     OR (entity_type = 'customer_contacts' AND entity_id IN (SELECT id::text FROM a204_contacts))
     OR (entity_type = 'customer_portal_accounts' AND entity_id IN (SELECT id::text FROM a204_accounts))
     OR (entity_type = 'bl_containers' AND entity_id IN (SELECT id::text FROM a204_containers))
     OR (entity_type = 'vehicles' AND entity_id IN (SELECT id::text FROM a204_vehicles))
     OR (entity_type = 'import_batches' AND entity_id IN (SELECT id::text FROM a204_batches))
     OR (entity_type IN ('invoices', 'invoice') AND entity_id IN (SELECT id::text FROM a204_invoices))
     OR (entity_type = 'bl_receivables' AND entity_id IN (SELECT id::text FROM a204_receivables))
     OR (entity_type = 'charge_calculations' AND entity_id IN (SELECT id::text FROM a204_calcs));
  DELETE FROM public.user_profiles WHERE id IN (${actorList});
  DELETE FROM auth.users WHERE id IN (${actorList});
  SET session_replication_role = origin;
`

function cleanup(): void {
  localPsql(cleanupSql)
}

describeLocal('M04 — fila de efeitos de importação: consumidores que agem sobre intenção velha', () => {
  beforeAll(() => {
    cleanup()
    localPsql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${adminId}', 'a204-admin@example.test'),
        ('${equipId}', 'a204-equipamentos@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${adminId}', 'A204 Administrativo', 'administrativo', true),
        ('${equipId}', 'A204 Equipamentos', 'equipamentos', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        ${customers.map((customer) => `(${customer.id}, '${customer.cnpj}', '${customer.name}')`).join(',\n        ')};
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      VALUES (${aberto.id}, 'Fixture A204: gate aberto para o CE', '${adminId}', now() + interval '1 day');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A204 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A204 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyage.veiculos}, ${vesselId}, 'A204A', 'active'),
        (${voyage.tabela}, ${vesselId}, 'A204B', 'active'),
        (${voyage.cargaSolta}, ${vesselId}, 'A204C', 'active'),
        (${voyage.trava}, ${vesselId}, 'A204D', 'active'),
        (${voyage.lease}, ${vesselId}, 'A204E', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode) VALUES
        ${Object.values(tables).map((table) => `(${table.id}, 'Tabela A204 ${table.pod} ${table.cargoMode}', '${table.pod}', CURRENT_DATE - 30, true, '${table.cargoMode}')`).join(',\n        ')};
      INSERT INTO public.charge_table_items (
        id, charge_table_id, name, applies_to, value_brl, unit_value_brl,
        application_basis, category, cargo_profile, currency
      ) VALUES
        ${Object.values(tables).map((table) => `(${table.itemId}, ${table.id}, 'Taxa A204 por B/L', 'bl', ${table.fee}, ${table.fee}, 'bl', 'base', 'any', 'BRL')`).join(',\n        ')};
    `)
  })

  afterAll(cleanup)

  // --- 1. vehicle_followup em B/L FCL faturado --------------------------------
  let vehicleFollowup: { processed: Array<{ entity: string; kind: string; status: string }>; invoices: Record<string, InvoiceRow[]>; bls: Record<string, BlCharge> } | null = null

  it('cenário 1: veículos importados em dois B/Ls FCL (um já faturado, outro faturado depois pelo CE) e o executor processa o efeito', () => {
    insertContainerBl({ id: 'A204-FCL1', voyageId: voyage.veiculos, customerId: aberto.id, pod: tables.base.pod, container: 'ADCU2040011', seal: 'A204S11' })
    insertContainerBl({ id: 'A204-FCL2', voyageId: voyage.veiculos, customerId: aberto.id, pod: tables.base.pod, container: 'ADCU2040012', seal: 'A204S12' })

    expect(importCeSheet('A204-MAN-1', voyage.veiculos, [{ blId: 'A204-FCL1', ce: '204001000000011' }])).toMatchObject({ ok: true, inserted: 1 })
    expect(importVehicles([
      { voyageId: voyage.veiculos, blId: 'A204-FCL1', chassis: 'LGXC74C44V0204011' },
      { voyageId: voyage.veiculos, blId: 'A204-FCL2', chassis: 'LGXC74C44V0204012' },
    ])).toBe('2')
    // VEI-02: o CE chega depois dos veículos; a intenção do efeito é mais velha que a fatura.
    expect(importCeSheet('A204-MAN-1', voyage.veiculos, [{ blId: 'A204-FCL2', ce: '204001000000012' }])).toMatchObject({ ok: true, inserted: 1 })

    for (const blId of ['A204-FCL1', 'A204-FCL2']) {
      // Pré-condições: fatura emitida de R$ 125, intacta depois do commit dos
      // veículos (o gatilho adiado da 128 não mexe: FCL não muda de valor), e o
      // motor ainda cobra R$ 125 com o veículo no B/L.
      expect(individualInvoices(blId).map((invoice) => [invoice.status, Number(invoice.total_brl)])).toEqual([['issued', tables.base.fee]])
      expect(blCharge(blId).financial_status).toBe('invoiced')
      expect(JSON.parse(localPsql(`SELECT public._quote_bl_local_charges('${blId}', NULL);`))).toMatchObject({ status: 'ok', total_brl: tables.base.fee })
      expect(effects(blId).filter((effect) => effect.kind === 'vehicle_followup').map((effect) => effect.status)).toEqual(['pending'])
    }

    // 'succeeded' também depois da correção: um consumidor que falhe (blocked)
    // deixaria a fatura intacta e passaria na checagem abaixo por acidente.
    const processed = runWorker('A204-FCL%')
    expect(processed.map((effect) => [effect.entity, effect.kind, effect.status])).toEqual([
      ['A204-FCL1', 'vehicle_followup', 'succeeded'],
      ['A204-FCL2', 'vehicle_followup', 'succeeded'],
    ])
    // A fila fica vazia: nada reemite depois, o estado lido abaixo é o final.
    expect(runWorker('A204-FCL%')).toEqual([])
    vehicleFollowup = {
      processed,
      invoices: { 'A204-FCL1': individualInvoices('A204-FCL1'), 'A204-FCL2': individualInvoices('A204-FCL2') },
      bls: { 'A204-FCL1': blCharge('A204-FCL1'), 'A204-FCL2': blCharge('A204-FCL2') },
    }
  })

  it.fails('esperado: o efeito de veículos não cancela a fatura de B/L FCL cujo valor não muda [VEI-01, VEI-02, INF-05] — regra: CONTEXT.md:1287-1290 (veículo em FCL paga normalmente), ADR 0077:25-26 e CONTEXT.md:2104-2108 (só há efeito se o valor do B/L ou o Cliente mudar), faturamento.md:366 (sem mudança de valor nem de Cliente: nada acontece)', () => {
    for (const blId of ['A204-FCL1', 'A204-FCL2']) {
      expect(vehicleFollowup?.invoices[blId].map((invoice) => [invoice.status, invoice.cancel_reason])).toEqual([['issued', null]])
      expect(vehicleFollowup?.bls[blId].financial_status).toBe('invoiced')
    }
  })

  // --- 2. local_billing do próprio B/L retido, depois de mudar a tabela -------
  let heldOwnEffect: { afterEffect: BlCharge; processed: Array<{ kind: string; status: string }>; invoices: InvoiceRow[] } | null = null

  it('cenário 2: CE de Cliente sem Portal retém a fatura, a tabela muda, o executor processa o efeito legado do CE e depois o Administrativo concede a Liberação', () => {
    insertContainerBl({ id: 'A204-H1', voyageId: voyage.tabela, customerId: retidoTabela.id, pod: tables.tabela.pod, container: 'ADCU2040021', seal: 'A204S21' })
    expect(importCeSheet('A204-MAN-2', voyage.tabela, [{ blId: 'A204-H1', ce: '204001000000021' }])).toMatchObject({ ok: true, inserted: 1 })

    // Pré-condições: retido com o cálculo do dia do CE e o efeito legado pendente.
    expect(blCharge('A204-H1')).toEqual({ financial_status: 'pending', charge_status: 'calculated', billing_hold_reason: HOLD, auto_total: tables.tabela.fee })
    expect(effects('A204-H1').map((effect) => [effect.kind, effect.status])).toEqual([['local_billing', 'pending']])

    setPrice(tables.tabela.itemId, 120)
    const processed = runWorker('A204-H1')
    expect(processed.map((effect) => [effect.kind, effect.status])).toEqual([['local_billing', 'succeeded']])
    const afterEffect = blCharge('A204-H1')
    expect(afterEffect.billing_hold_reason).toBe(HOLD)

    const grant = grantRelease(retidoTabela.id)
    expect(grant.reprocess).toMatchObject({ gate_open: true, issued: 1, failed: 0 })
    heldOwnEffect = { afterEffect, processed, invoices: individualInvoices('A204-H1') }
    expect(heldOwnEffect.invoices.map((invoice) => invoice.status)).toEqual(['issued'])
  })

  it.fails('esperado: o efeito legado mantém o cálculo do dia do CE e a Liberação emite R$ 90, não a tabela do dia do executor [CE-V04, ORDCE-V04, CED-14] — regra: ADR 0070:103-107 (nota 2026-09-24 b, taxas do dia do CE) e CONTEXT.md:1539-1542 (a Liberação emite com as taxas calculadas no registro do CE, sem recalcular pela tabela vigente)', () => {
    expect(heldOwnEffect?.afterEffect.auto_total).toBe(tables.tabela.fee)
    expect(heldOwnEffect?.invoices.map((invoice) => Number(invoice.total_brl))).toEqual([tables.tabela.fee])
  })

  // --- 3. local_billing de B/L de carga solta varre a Viagem ------------------
  let looseCargoSweep: { heldBefore: BlCharge; heldAfter: BlCharge; invoices: InvoiceRow[] } | null = null

  it('cenário 3: B/L retido com CE, a tabela muda, um manifesto de carga solta de outro Cliente entra na mesma Viagem e o executor processa o efeito dele', () => {
    insertContainerBl({ id: 'A204-H3', voyageId: voyage.cargaSolta, customerId: retidoViagem.id, pod: tables.viagem.pod, container: 'ADCU2040031', seal: 'A204S31' })
    expect(importCeSheet('A204-MAN-3', voyage.cargaSolta, [{ blId: 'A204-H3', ce: '204001000000031' }])).toMatchObject({ ok: true, inserted: 1 })
    // O efeito legado do próprio B/L roda antes da mudança de tabela: isola o
    // caso do cenário 2 e deixa só o efeito do B/L de carga solta em jogo.
    expect(runWorker('A204-H3').map((effect) => [effect.kind, effect.status])).toEqual([['local_billing', 'succeeded']])
    const heldBefore = blCharge('A204-H3')
    expect(heldBefore).toEqual({ financial_status: 'pending', charge_status: 'calculated', billing_hold_reason: HOLD, auto_total: tables.viagem.fee })

    setPrice(tables.viagem.itemId, 400)
    // Payload de importBreakbulkManifest (breakbulkImport.ts:54-149): B/L com
    // Cliente por CNPJ e sem CE no arquivo (a chave ce_mercante não vai).
    const imported = JSON.parse(asUser(adminId, `
      SELECT public.import_breakbulk_manifest_transactional(
        'a204-carga-solta.pdf', ${voyage.cargaSolta}, '${adminId}'::uuid, 1,
        ${jsonLiteral([{
          id: 'A204-BB1',
          voyage_id: voyage.cargaSolta,
          bb_machine_qty: 1,
          bb_packages_qty: 2,
          bb_packages_total: 2,
          bb_weight_ton: 5,
          shipper: 'A204 SHIPPER',
          consignee: aberto.name,
          notify_party: 'A204 NOTIFY',
          customer_id: aberto.id,
          suggested_customer_id: null,
          manifest_customer_cnpj_cpf: aberto.cnpj,
          manifest_customer_name: aberto.name,
          manifest_customer_email: null,
          customer_reconciliation_status: 'matched_document',
          customer_reconciliation_notes: 'Cliente reconciliado automaticamente por CNPJ.',
          billing_hold_reason: null,
          pol,
          pod: tables.viagemCargaSolta.pod,
          cargo_description: 'MAQUINA A204',
          ncm_codes: [],
          bb_cbm: 3,
          review_status: 'ok',
          financial_status: 'pending',
          notes: null,
        }])},
        ${jsonLiteral([{
          bl_id: 'A204-BB1',
          item_description: 'MAQUINA A204',
          package_qty: 2,
          package_unit: 'PACKAGES',
          gross_weight_kg: 5000,
          cbm: 3,
          marks: null,
        }])},
        '[]'::jsonb
      );
    `)) as { batch_id: number; breakbulk_bl_ids: string[] }
    expect(imported.breakbulk_bl_ids).toEqual(['A204-BB1'])
    expect(localPsql(`SELECT cargo_mode || '|' || (SELECT count(*) FROM public.bl_containers WHERE bl_id = 'A204-BB1') FROM public.bls WHERE id = 'A204-BB1';`)).toBe('carga_solta|0')
    expect(effects('A204-BB1').map((effect) => [effect.kind, effect.status])).toEqual([['local_billing', 'pending']])
    // Nada tocou o B/L retido até aqui.
    expect(blCharge('A204-H3')).toEqual(heldBefore)

    expect(runWorker('A204-BB%').map((effect) => [effect.entity, effect.kind, effect.status])).toEqual([['A204-BB1', 'local_billing', 'succeeded']])
    const heldAfter = blCharge('A204-H3')

    const grant = grantRelease(retidoViagem.id)
    expect(grant.reprocess).toMatchObject({ gate_open: true, issued: 1, failed: 0 })
    looseCargoSweep = { heldBefore, heldAfter, invoices: individualInvoices('A204-H3') }
    expect(looseCargoSweep.invoices.map((invoice) => invoice.status)).toEqual(['issued'])
  })

  it.fails('esperado: o efeito do B/L de carga solta não toca o B/L retido da mesma Viagem, que mantém a retenção e sai na Liberação com R$ 100 [TST-V01, ORDCE-07] — regra: ADR 0070:37-41 (o CE retém e grava billing_hold_reason), ADR 0070:103-107 e CONTEXT.md:1539-1542 (taxas do dia do CE)', () => {
    expect(looseCargoSweep?.heldAfter).toEqual(looseCargoSweep?.heldBefore)
    expect(looseCargoSweep?.invoices.map((invoice) => Number(invoice.total_brl))).toEqual([tables.viagem.fee])
  })

  // --- 4. Contenção de trava no local_billing ---------------------------------
  let lockContention: EffectRow | null = null

  it('cenário 4: o executor processa o efeito do CE retido enquanto outra transação segura a linha do B/L', async () => {
    insertContainerBl({ id: 'A204-T1', voyageId: voyage.trava, customerId: retidoTrava.id, pod: tables.base.pod, container: 'ADCU2040041', seal: 'A204S41' })
    expect(importCeSheet('A204-MAN-4', voyage.trava, [{ blId: 'A204-T1', ce: '204001000000041' }])).toMatchObject({ ok: true, inserted: 1 })
    expect(effects('A204-T1').map((effect) => [effect.kind, effect.status])).toEqual([['local_billing', 'pending']])

    // Outra sessão (Revisão, outra importação) segura a linha do B/L por alguns segundos.
    const holder = spawn('psql', psqlArgs(`
      BEGIN;
      SELECT 1 FROM public.bls WHERE id = 'A204-T1' FOR UPDATE;
      SELECT pg_sleep(4);
      COMMIT;
    `), { env: { ...process.env, PGAPPNAME: 'a204-lock-holder' }, stdio: 'ignore' })
    const holderDone = new Promise<number | null>((resolve) => holder.on('exit', resolve))
    let holding = false
    for (let attempt = 0; attempt < 50 && !holding; attempt += 1) {
      holding = localPsql(`SELECT count(*) FROM pg_stat_activity WHERE application_name = 'a204-lock-holder' AND wait_event = 'PgSleep';`) === '1'
      if (!holding) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(holding).toBe(true)

    const processed = runWorker('A204-T1', `SET lock_timeout = '300ms';`)
    expect(await holderDone).toBe(0)
    expect(processed.map((effect) => effect.kind)).toEqual(['local_billing'])
    ;[lockContention] = effects('A204-T1')
    // Pré-condições: uma única tentativa, derrubada pela espera da trava (55P03).
    expect(lockContention.attempts).toBe(1)
    expect(lockContention.last_error_message).toContain('lock timeout')
  }, 30_000)

  it.fails('esperado: a contenção de trava vira nova tentativa (retry_wait, transient_sql_error), não bloqueio definitivo [INF-V01, DAT-06] — regra: ADR 0065:32-37 (process_import_effect classifica erros transitórios para retry) e RASTREABILIDADE.md:431 (retry transitório)', () => {
    expect({ status: lockContention?.status, code: lockContention?.last_error_code }).toEqual({ status: 'retry_wait', code: 'transient_sql_error' })
  })

  // --- 5. Lease esgotado -------------------------------------------------------
  let leaseExhausted: { effect: EffectRow; alerts: number } | null = null

  it('cenário 5: o executor reivindica o efeito de veículos e morre antes de confirmar, cinco vezes seguidas', () => {
    insertContainerBl({ id: 'A204-L1', voyageId: voyage.lease, customerId: aberto.id, pod: tables.base.pod, container: 'ADCU2040051', seal: 'A204S51' })
    expect(importVehicles([{ voyageId: voyage.lease, blId: 'A204-L1', chassis: 'LGXC74C44V0204051' }])).toBe('1')
    const [pending] = effects('A204-L1')
    expect(pending).toMatchObject({ kind: 'vehicle_followup', status: 'pending', attempts: 0 })
    expect(localPsql(`SELECT count(*) FROM public.alert_type_catalog WHERE type = 'import_effect_blocked';`)).toBe('1')

    // Cada ciclo reivindica e o worker some: a lease vence sem conclusão
    // (comentário de claim_import_effects: "Recupera workers que morreram").
    for (let cycle = 0; cycle < 6; cycle += 1) {
      execFileSync('psql', psqlArgs(`
        SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
        SET import_effects.entity_prefix = 'A204-L1';
        SELECT count(*) FROM public.claim_import_effects('a204-dead-worker', 10, 300);
      `), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      localPsql(`UPDATE public.import_pending_effects SET lease_until = now() - interval '1 second' WHERE id = ${pending.id} AND status = 'running';`)
    }

    const [effect] = effects('A204-L1')
    expect(effect).toMatchObject({ status: 'blocked', attempts: 5, last_error_code: 'lease_expired' })

    // Controle positivo da consulta de Alerta: um efeito que o próprio
    // process_import_effect bloqueia (entidade que não é B/L nem Viagem) abre o
    // Alerta que blockedEffectAlerts conta. Assim o 0 abaixo é ausência de
    // Alerta, não consulta errada.
    localPsql(`
      INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, created_by)
      VALUES (gen_random_uuid(), 'local_billing', 'A204-L9', '${adminId}');
    `)
    expect(runWorker('A204-L9').map((control) => [control.entity, control.status])).toEqual([['A204-L9', 'blocked']])
    const [control] = effects('A204-L9')
    expect(control.last_error_code).toBe('effect_domain_missing')
    expect(blockedEffectAlerts(control.id)).toBe(1)

    leaseExhausted = { effect, alerts: blockedEffectAlerts(effect.id) }
  })

  it.fails('esperado: o efeito bloqueado por lease esgotado abre o Alerta import_effect_blocked [INF-06, DAT-V01] — regra: src/services/alertRulesCatalog.ts:228-229 (aparece quando o efeito entra em blocked, inclusive ao esgotar as tentativas) e ADR 0065:58-59 (falha operacional não fica invisível)', () => {
    expect(leaseExhausted?.alerts).toBe(1)
  })
})
