// Checagens de aceitação da revisão das importações (2026-10-09; docs/archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md).
// As referências `arquivo:linha` apontam para o checkout `fa5f238` da revisão; as regras decididas depois estão na ADR 0078.
// Os defeitos foram corrigidos na migration 178 (etapa 7 do plano de correção): os it.fails viraram it e rodam no job local-pg do CI.
//
// Problemas-raiz M18 (notificação "Nova fatura emitida" com R$ 0.00), M19 (B/L
// cancelado na prontidão do Comunicado de CE e Taxas) e M10 (Demurrage e datas).
// Causas nas definições efetivas (após as migrations do checkout):
// - M18: `create_invoice_from_bls_core` insere a fatura com `total_brl = 0`
//   (019:694-717) e só grava o total depois dos itens (019:831-833);
//   `trg_notify_invoice_issued` é AFTER INSERT OR UPDATE OF status (002:23833) e
//   `notify_invoice_issued` monta a mensagem com `NEW.total_brl` (002:11168-11185).
// - M19: `customer_local_charges_communication_readiness` (última definição na
//   059:528-604) exclui só `financial_status = 'cancelled'`; `cancel_bl` (089)
//   grava `cancelled_at` e não mexe no status financeiro. O predicado de "B/L
//   ativo" já usado no status documental (134) e nos Alertas de revisão (169)
//   não chegou à prontidão.
// - M10: `_calculate_demurrage_invoice_authoritative` só aceita item com
//   subtotal > 0 (023:218-224, redefinida igual na 138:360-366) e
//   `assert_demurrage_invoice_complete` exige todo container não-SOC na fatura
//   (066:132-190, 121:795-860); `apply_container_dates_atomic` conta o SOC como
//   devolução pendente (015:194-197) e `_run_import_effect_demurrage` inclui o
//   SOC na emissão (025:122-128), embora a 121:15-17 diga que o SOC "não conta no
//   conjunto 'todos os containers devolvidos'"; o gatilho de modalidade de carga
//   dispara em qualquer UPDATE de `bl_containers` (060:227-230) e
//   `_recalculate_bl_cargo_mode` grava "Carga alterada após faturamento" e devolve
//   o B/L faturado à Revisão (064:215-225).
//
// As ações usam as RPCs reais, como `authenticated` (Administrativo), com os
// payloads dos serviços: planilha de CE `apply_ce_mercante_rows_atomic`
// (ceMercanteImport.ts:197-207), Cancelar B/L `cancel_bl` (blState.ts:10-18),
// prontidão `customer_local_charges_communication_readiness`
// (customerCommunicationReadiness.ts:59), datas `apply_container_dates_atomic`
// (containerDatesImport.ts:114-130, com o estado lido no clique) e Invoice de
// Demurrage `create_demurrage_invoice_authoritative` com as duas seleções que os
// serviços montam (demurrageInvoices.ts:92-146). O `import-effects-runner` está
// pausado em produção (docs/operations/servicos-externos.md:297-300); o executor
// é simulado como em auditoriaEfeitosImportacao (service_role,
// `claim_import_effects` e `process_import_effect`, restrito ao prefixo A207-).
// Os B/Ls entram por INSERT direto, como B/L de container já importado.
//
// Fora daqui, por dependerem de decisão de negócio ou por não serem alcançáveis
// pela tela: devolução vazia na planilha (manter ou limpar, DAT-02/ORDCT-06);
// semântica de `demurrage_status`, 'overdue' nunca gravado e "Gerar Fatura" só
// com 'overdue' (DAT-05, ORDCT-07, DAT-V02, ORDCT-V04); datas alteradas depois da
// Demurrage emitida (DAT-09, ORDCT-08); recebível que nasce no cálculo e trava
// `cancel_bl` (CED-08, ORDCE-14, BAP-V04); Alerta "CE Mercante pendente" com B/L
// cancelado sem CE (só por chamada direta: a ficha só oferece Cancelar com CE,
// BlDetalhe.tsx:372-373, e CONTEXT.md:798 diz que B/L sem CE é excluído).
//
// Namespace exclusivo: ids 99207xxx, CNPJ syntheticCnpj(207001), B/Ls 'A207-*',
// usuário ...0000002070NN, manifestos 'A207-MAN-*', documentos 'A207-DEM-*'.
// Containers 'ADCU207xxxx' (a checagem ISO de `bl_containers` impede o prefixo
// A207; a limpeza os remove pelo B/L). A limpeza (antes e depois) remove também
// faturas, recebíveis, cálculos, Invoices de Demurrage, efeitos e tentativas,
// Alertas (inclusive os de efeito), auditoria, notificações do Portal, contatos
// e a conta de Portal criada pelo gatilho de inserção de Cliente.
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000207001'
const WORKER = 'a207-import-effects-runner'
// Cliente com Liberação de faturamento vigente: o CE emite (ADR 0070).
const cliente = { id: 99207001, cnpj: syntheticCnpj(207001), name: 'A207 CLIENTE ALFA LTDA', email: 'a207-alfa@example.test' }
const carrierId = 99207010
const vesselId = 99207011
const voyage = {
  notificacao: 99207021,
  cancelado: 99207022,
  datasFaturado: 99207023,
  demurrage: 99207024,
  grupo: 99207025,
  recebivel: 99207026,
}
const voyageIds = Object.values(voyage)
const chargeTableId = 99207031
const containerItemId = 99207032
const containerFee = 1535
const pol = 'A207O'
const pod = 'A207P'
// POD da mesma Viagem sem tabela de Taxas Locais: o CE grava e nada é calculado.
const podSemTabela = 'A207Q'
// Acordo de Demurrage do Cliente; os limites de P1/P2 vêm da tarifa por tipo.
const acordo = { freeDays: 10, p1Usd: 10, p2Usd: 20 }

function psqlArgs(sql: string): string[] {
  return ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql]
}

// Fixture e leitura: dono do banco com claims de service_role (sem RLS).
function localPsql(sql: string): string {
  return execFileSync('psql', psqlArgs(
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

// Usuário interno real (Administrativo): papel `authenticated`, RLS e grants valem.
function asAdmin(sql: string): string {
  return execFileSync('psql', psqlArgs(
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function tryAsAdmin(sql: string): { output: string | null; error: string | null } {
  try {
    return { output: asAdmin(sql), error: null }
  } catch (error) {
    const stderr = String((error as { stderr?: string | Buffer }).stderr ?? error)
    const message = stderr.split('\n').find((line) => line.startsWith('ERROR:')) ?? stderr
    return { output: null, error: message.trim() }
  }
}

// Um ciclo do executor (import-effects-runner/index.ts:46-68), restrito ao prefixo.
function runWorker(entityPrefix: string): Array<{ id: number; entity: string; kind: string; status: string }> {
  const output = execFileSync('psql', psqlArgs(`
    SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
    SET import_effects.entity_prefix = '${entityPrefix}';
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

type ContainerFixture = {
  number: string
  ownership?: 'SOC' | 'COC'
  dischargeDate?: string
  returnDate?: string
  demurrageStatus?: string
}

// B/L de container já importado, com Cliente reconciliado por CNPJ, rota
// cadastrada (a planilha de CE exige POL/POD) e ROE manual de Demurrage (evita
// depender da referência cambial global).
function insertBl(id: string, voyageId: number, blPod: string, containers: ContainerFixture[]): void {
  const containerRows = containers.map((container) => `(
    '${id}', '${container.number}', '40HC',
    ${container.ownership ? `'${container.ownership}'` : 'NULL'}, ${container.ownership ? `'bl'` : 'NULL'},
    ${container.dischargeDate ? `'${container.dischargeDate}'` : 'NULL'},
    ${container.returnDate ? `'${container.returnDate}'` : 'NULL'},
    '${container.demurrageStatus ?? 'within_free_time'}'
  )`)
  localPsql(`
    INSERT INTO public.bls (
      id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status,
      customer_reconciliation_status, review_status, consignee, demurrage_roe_manual, demurrage_roe
    ) VALUES (
      '${id}', ${voyageId}, ${cliente.id}, '${pol}', '${blPod}', 'container', 'pending', 'not_calculated',
      'matched_document', 'ok', 'A207 CONSIGNATARIO', true, 5.5
    );
    INSERT INTO public.bl_containers (
      bl_id, container_number, type, ownership, ownership_source, discharge_date, return_date, demurrage_status
    ) VALUES ${containerRows.join(', ')};
  `)
}

function importCeSheet(manifestoNumero: string, voyageId: number, rows: Array<{ blId: string; ce: string }>) {
  return JSON.parse(asAdmin(`
    SELECT public.apply_ce_mercante_rows_atomic(
      ${jsonLiteral(rows.map((row, index) => ({ row: index + 2, bl_id: row.blId, ce: row.ce })))},
      '${actorId}'::uuid, 'bls', '${manifestoNumero}', ${voyageId}
    );
  `)) as { ok: boolean; inserted?: number; errors?: unknown }
}

type DatesResult = { updated_ids: number[]; unchanged_ids: number[]; billing_state: string }

// Mesmo payload de importContainerDates: uma unidade por B/L, com o estado atual
// do container como `expected_*` (lido no clique de confirmar).
function importContainerDates(blId: string, rows: Array<{ number: string; discharge: string; return: string | null }>) {
  const current = JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_object_agg(container_number, jsonb_build_object(
      'discharge_date', discharge_date, 'return_date', return_date
    )), '{}'::jsonb)
    FROM public.bl_containers WHERE bl_id = '${blId}';
  `)) as Record<string, { discharge_date: string | null; return_date: string | null }>
  const payload = rows.map((row) => ({
    container_number: row.number,
    discharge_date: row.discharge,
    return_date: row.return,
    expected_discharge_date: current[row.number]?.discharge_date ?? null,
    expected_return_date: current[row.number]?.return_date ?? null,
  }))
  return JSON.parse(asAdmin(`
    SELECT public.apply_container_dates_atomic('${randomUUID()}'::uuid, '${blId}', ${jsonLiteral(payload)}, '${actorId}'::uuid);
  `)) as DatesResult
}

type BlState = {
  financial_status: string | null
  charge_status: string | null
  review_status: string | null
  billing_hold_reason: string | null
  cancelled: boolean
}

function blState(blId: string): BlState {
  return JSON.parse(localPsql(`
    SELECT jsonb_build_object(
      'financial_status', financial_status, 'charge_status', charge_status,
      'review_status', review_status, 'billing_hold_reason', billing_hold_reason,
      'cancelled', cancelled_at IS NOT NULL
    ) FROM public.bls WHERE id = '${blId}';
  `)) as BlState
}

type Readiness = {
  ready: boolean
  reasons: string[]
  bl_count: number
  bls: Array<{ bl_id: string; blocked_reasons: string[] }>
}

function communicationReadiness(voyageId: number): Readiness {
  return JSON.parse(asAdmin(`SELECT public.customer_local_charges_communication_readiness(${voyageId}, ${cliente.id});`)) as Readiness
}

// B/Ls que o conteúdo do Comunicado de CE e Taxas lista (executor server-only,
// `customer_local_charges_communication_payload`, mesmo filtro de B/L da prontidão).
function communicationPayloadBls(voyageId: number): string[] {
  return JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_agg(item->>'bl_id' ORDER BY item->>'bl_id'), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(
      public.customer_local_charges_communication_payload(${voyageId}, ${cliente.id})->'bls', '[]'::jsonb
    )) AS item;
  `)) as string[]
}

function containerIds(blId: string): Record<string, number> {
  return JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_object_agg(container_number, id), '{}'::jsonb) FROM public.bl_containers WHERE bl_id = '${blId}';
  `)) as Record<string, number>
}

// Valor de Demurrage de um container pelo próprio cálculo do banco, na data de
// negócio da emissão (create_demurrage_invoice_authoritative usa a de Brasília).
function demurrageUsdOf(blId: string, containerId: number): number {
  return Number(localPsql(`
    SELECT (public._calculate_demurrage_invoice_authoritative(
      '${blId}', ARRAY[${containerId}]::bigint[], (now() AT TIME ZONE 'America/Sao_Paulo')::date
    )->>'total_usd');
  `))
}

type DemurrageInvoice = { status: string; total_usd: number; containers: string[] }

function activeDemurrageInvoices(blId: string): DemurrageInvoice[] {
  return JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'status', d.status,
      'total_usd', d.total_usd,
      'containers', (
        SELECT COALESCE(jsonb_agg(i.container_number ORDER BY i.container_number), '[]'::jsonb)
        FROM public.demurrage_invoice_items i WHERE i.invoice_id = d.id
      )
    ) ORDER BY d.id), '[]'::jsonb)
    FROM public.demurrage_invoices d
    WHERE d.bl_id = '${blId}' AND d.status IN ('issued', 'paid');
  `)) as DemurrageInvoice[]
}

function demurrageEffects(blId: string): Array<{ status: string; error: string | null }> {
  return JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'error', last_error_message) ORDER BY id), '[]'::jsonb)
    FROM public.import_pending_effects
    WHERE entity_id = '${blId}' AND effect_kind = 'demurrage_billing';
  `)) as Array<{ status: string; error: string | null }>
}

// Os dois formatos aceitos para o total: o da mensagem atual (round()::text) e o
// pt-BR. O formato é decisão de apresentação; o valor não.
function totalVariants(total: number): string[] {
  const fixed = total.toFixed(2)
  const [inteiro, centavos] = fixed.split('.')
  return [fixed, `${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${centavos}`]
}

const cleanupSql = `
  SET session_replication_role = replica;
  CREATE TEMP TABLE a207_bls AS SELECT id FROM public.bls WHERE id LIKE 'A207-%';
  CREATE TEMP TABLE a207_customers AS SELECT unnest(ARRAY[${cliente.id}]::bigint[]) AS id;
  CREATE TEMP TABLE a207_voyages AS SELECT unnest(ARRAY[${voyageIds.join(', ')}]::bigint[]) AS id;
  CREATE TEMP TABLE a207_invoices AS
    SELECT id FROM public.invoices
    WHERE bl_id IN (SELECT id FROM a207_bls)
       OR customer_id IN (SELECT id FROM a207_customers)
       OR voyage_id IN (SELECT id FROM a207_voyages)
       OR id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id IN (SELECT id FROM a207_bls))
       OR id IN (SELECT invoice_id FROM public.invoice_items WHERE bl_id IN (SELECT id FROM a207_bls));
  CREATE TEMP TABLE a207_dem_invoices AS
    SELECT id FROM public.demurrage_invoices
    WHERE bl_id IN (SELECT id FROM a207_bls) OR customer_id IN (SELECT id FROM a207_customers) OR doc_number LIKE 'A207-%';
  CREATE TEMP TABLE a207_receivables AS
    SELECT id FROM public.bl_receivables
    WHERE bl_id IN (SELECT id FROM a207_bls) OR customer_id IN (SELECT id FROM a207_customers);
  CREATE TEMP TABLE a207_calcs AS SELECT id FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM a207_bls);
  CREATE TEMP TABLE a207_containers AS SELECT id FROM public.bl_containers WHERE bl_id IN (SELECT id FROM a207_bls);
  CREATE TEMP TABLE a207_contacts AS SELECT id FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM a207_customers);
  CREATE TEMP TABLE a207_accounts AS SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM a207_customers);
  CREATE TEMP TABLE a207_effects AS
    SELECT id FROM public.import_pending_effects
    WHERE entity_id IN (SELECT id FROM a207_bls) OR entity_id LIKE 'A207-%' OR created_by = '${actorId}';
  CREATE TEMP TABLE a207_alerts AS
    SELECT id FROM public.alerts
    WHERE message LIKE '%A207 %' OR message LIKE '%A207-%'
       OR entity_id LIKE 'A207 %' OR entity_id LIKE 'A207-%'
       OR (entity_type = 'customer' AND entity_id IN (SELECT id::text FROM a207_customers))
       OR (entity_type = 'voyage' AND entity_id IN (SELECT id::text FROM a207_voyages))
       OR (entity_type = 'import_effect' AND entity_id IN (SELECT id::text FROM a207_effects));
  CREATE TEMP TABLE a207_alert_items AS
    SELECT id FROM public.alert_items
    WHERE alert_id IN (SELECT id FROM a207_alerts)
       OR message LIKE '%A207 %' OR message LIKE '%A207-%'
       OR metadata::text LIKE '%A207 %' OR metadata::text LIKE '%A207-%'
       OR metadata->>'customer_id' IN (SELECT id::text FROM a207_customers)
       OR metadata->>'voyage_id' IN (SELECT id::text FROM a207_voyages);

  DELETE FROM public.internal_notifications
  WHERE alert_item_id IN (SELECT id FROM a207_alert_items)
     OR alert_id IN (SELECT id FROM a207_alerts)
     OR recipient_id = '${actorId}';
  DELETE FROM public.alert_item_events
  WHERE alert_item_id IN (SELECT id FROM a207_alert_items) OR actor_id = '${actorId}';
  DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM a207_alert_items);
  DELETE FROM public.alert_notification_failures
  WHERE alert_item_id IN (SELECT id FROM a207_alert_items) OR alert_id IN (SELECT id FROM a207_alerts);
  DELETE FROM public.alert_items WHERE id IN (SELECT id FROM a207_alert_items);
  DELETE FROM public.alerts WHERE id IN (SELECT id FROM a207_alerts);

  DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM a207_effects);
  DELETE FROM public.import_pending_effects WHERE id IN (SELECT id FROM a207_effects);

  DELETE FROM public.portal_notifications
  WHERE bl_id IN (SELECT id FROM a207_bls) OR customer_id IN (SELECT id FROM a207_customers);
  DELETE FROM public.itau_pix_charges
  WHERE invoice_id IN (SELECT id FROM a207_invoices) OR demurrage_invoice_id IN (SELECT id FROM a207_dem_invoices);
  DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (SELECT id FROM a207_dem_invoices);
  DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM a207_dem_invoices);
  DELETE FROM public.demurrage_invoice_items
  WHERE invoice_id IN (SELECT id FROM a207_dem_invoices) OR container_id IN (SELECT id FROM a207_containers);
  DELETE FROM public.demurrage_invoices WHERE id IN (SELECT id FROM a207_dem_invoices);
  DELETE FROM public.customer_demurrage_agreements WHERE customer_id IN (SELECT id FROM a207_customers);
  DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN (SELECT id FROM a207_invoices);
  DELETE FROM public.ledger_settlements
  WHERE invoice_id IN (SELECT id FROM a207_invoices) OR receivable_id IN (SELECT id FROM a207_receivables);
  DELETE FROM public.invoice_customer_changes
  WHERE bl_id IN (SELECT id FROM a207_bls)
     OR new_invoice_id IN (SELECT id FROM a207_invoices)
     OR original_customer_id IN (SELECT id FROM a207_customers)
     OR target_customer_id IN (SELECT id FROM a207_customers);
  DELETE FROM public.invoice_lifecycle_events
  WHERE invoice_id IN (SELECT id FROM a207_invoices)
     OR related_invoice_id IN (SELECT id FROM a207_invoices)
     OR receivable_id IN (SELECT id FROM a207_receivables);
  DELETE FROM public.invoice_receivable_links
  WHERE invoice_id IN (SELECT id FROM a207_invoices)
     OR bl_id IN (SELECT id FROM a207_bls)
     OR receivable_id IN (SELECT id FROM a207_receivables);
  DELETE FROM public.billing_batches
  WHERE invoice_id IN (SELECT id FROM a207_invoices) OR customer_id IN (SELECT id FROM a207_customers);
  DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM a207_invoices) OR bl_id IN (SELECT id FROM a207_bls);
  DELETE FROM public.invoice_bls WHERE invoice_id IN (SELECT id FROM a207_invoices) OR bl_id IN (SELECT id FROM a207_bls);
  DELETE FROM public.invoices WHERE id IN (SELECT id FROM a207_invoices);
  DELETE FROM public.bl_receivables WHERE id IN (SELECT id FROM a207_receivables);
  DELETE FROM public.invoice_basis_pending_changes WHERE bl_id IN (SELECT id FROM a207_bls);
  DELETE FROM public.charge_calculations WHERE id IN (SELECT id FROM a207_calcs);
  DELETE FROM public.billing_run_logs WHERE bl_id IN (SELECT id FROM a207_bls);
  DELETE FROM public.customer_reconciliation_queue
  WHERE bl_id IN (SELECT id FROM a207_bls) OR customer_id IN (SELECT id FROM a207_customers);
  DELETE FROM public.bl_containers WHERE id IN (SELECT id FROM a207_containers);
  DELETE FROM public.bls WHERE id IN (SELECT id FROM a207_bls);
  DELETE FROM public.manifestos_mercante WHERE voyage_id IN (SELECT id FROM a207_voyages) OR numero LIKE 'A207-%';
  DELETE FROM public.voyage_route_ce_master WHERE voyage_id IN (SELECT id FROM a207_voyages);
  DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (SELECT id FROM a207_voyages);
  DELETE FROM public.voyage_documental_state WHERE voyage_id IN (SELECT id FROM a207_voyages);
  DELETE FROM public.pricing_rule_versions
  WHERE charge_table_id = ${chargeTableId}
     OR charge_item_id = ${containerItemId}
     OR customer_id IN (SELECT id FROM a207_customers);
  DELETE FROM public.charge_table_items WHERE id = ${containerItemId};
  DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
  DELETE FROM public.voyages WHERE id IN (SELECT id FROM a207_voyages);
  DELETE FROM public.vessels WHERE id = ${vesselId};
  DELETE FROM public.carriers WHERE id = ${carrierId};

  DELETE FROM public.portal_provisioning_events
  WHERE customer_id IN (SELECT id FROM a207_customers) OR account_id IN (SELECT id FROM a207_accounts);
  DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM a207_accounts);
  DELETE FROM public.portal_invites WHERE account_id IN (SELECT id FROM a207_accounts);
  DELETE FROM public.customer_portal_sessions
  WHERE account_id IN (SELECT id FROM a207_accounts) OR customer_id IN (SELECT id FROM a207_customers);
  DELETE FROM public.portal_inspection_events WHERE customer_id IN (SELECT id FROM a207_customers);
  DELETE FROM public.portal_rate_limits WHERE customer_id IN (SELECT id FROM a207_customers);
  DELETE FROM public.customer_portal_accounts WHERE id IN (SELECT id FROM a207_accounts);
  DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM a207_contacts);
  DELETE FROM public.customer_contact_preferences WHERE contact_id IN (SELECT id FROM a207_contacts);
  DELETE FROM public.customer_contact_change_events WHERE customer_id IN (SELECT id FROM a207_customers);
  DELETE FROM public.customer_contacts WHERE id IN (SELECT id FROM a207_contacts);
  DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (SELECT id FROM a207_customers);
  DELETE FROM public.customers WHERE id IN (SELECT id FROM a207_customers);

  DELETE FROM public.audit_logs
  WHERE changed_by = '${actorId}'
     OR entity_id LIKE 'A207-%'
     OR (entity_type IN ('customers', 'customer') AND entity_id IN (SELECT id::text FROM a207_customers))
     OR (entity_type IN ('voyages', 'voyage') AND entity_id IN (SELECT id::text FROM a207_voyages))
     OR (entity_type = 'vessels' AND entity_id = '${vesselId}')
     OR (entity_type = 'carriers' AND entity_id = '${carrierId}')
     OR (entity_type = 'charge_tables' AND entity_id = '${chargeTableId}')
     OR (entity_type = 'charge_table_items' AND entity_id = '${containerItemId}')
     OR (entity_type = 'customer_contacts' AND entity_id IN (SELECT id::text FROM a207_contacts))
     OR (entity_type = 'bl_containers' AND entity_id IN (SELECT id::text FROM a207_containers))
     OR (entity_type IN ('invoices', 'invoice') AND entity_id IN (SELECT id::text FROM a207_invoices))
     OR (entity_type IN ('demurrage_invoices', 'demurrage_invoice_items') AND entity_id IN (SELECT id::text FROM a207_dem_invoices))
     OR (entity_type = 'bl_receivables' AND entity_id IN (SELECT id::text FROM a207_receivables))
     OR (entity_type = 'charge_calculations' AND entity_id IN (SELECT id::text FROM a207_calcs));
  DELETE FROM public.user_profiles WHERE id = '${actorId}';
  DELETE FROM auth.users WHERE id = '${actorId}';
  SET session_replication_role = origin;
`

function cleanup(): void {
  localPsql(cleanupSql)
}

describeLocal('M18, M19 e M10 — notificação de fatura, B/L cancelado no Comunicado e Demurrage pelas datas', () => {
  beforeAll(() => {
    cleanup()
    localPsql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'a207-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'A207 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${cliente.id}, '${cliente.cnpj}', '${cliente.name}');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A207 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A207 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyage.notificacao}, ${vesselId}, 'A207A', 'active'),
        (${voyage.cancelado}, ${vesselId}, 'A207B', 'active'),
        (${voyage.datasFaturado}, ${vesselId}, 'A207C', 'active'),
        (${voyage.demurrage}, ${vesselId}, 'A207D', 'active'),
        (${voyage.grupo}, ${vesselId}, 'A207E', 'active'),
        (${voyage.recebivel}, ${vesselId}, 'A207F', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${chargeTableId}, 'Tabela A207 container', '${pod}', CURRENT_DATE - 30, true, 'container');
      INSERT INTO public.charge_table_items (
        id, charge_table_id, name, applies_to, value_brl, unit_value_brl,
        application_basis, category, cargo_profile, currency
      ) VALUES (
        ${containerItemId}, ${chargeTableId}, 'Taxa A207 por container', 'container', ${containerFee}, ${containerFee},
        'container_distinct_voyage', 'base', 'any', 'BRL'
      );
      -- Desde a 083/084 o CE só emite com Liberação vigente e contato com e-mail.
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
      VALUES (${cliente.id}, 'Financeiro A207', '${cliente.email}', 'financeiro', true);
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      VALUES (${cliente.id}, 'Fixture A207: gate aberto para o CE', '${actorId}', now() + interval '1 day');
      INSERT INTO public.customer_demurrage_agreements (customer_id, free_days, p1_usd, p2_usd, valid_from, active)
      VALUES (${cliente.id}, ${acordo.freeDays}, ${acordo.p1Usd}, ${acordo.p2Usd}, '2026-01-01', true);
    `)
  })

  afterAll(cleanup)

  // --- 1. M18: notificação "Nova fatura emitida" no Portal --------------------
  let emissao: { invoiceNumber: string; total: number; message: string } | null = null

  it('cenário 1: o CE Mercante emite a fatura de Taxas Locais de um Cliente com Liberação', () => {
    insertBl('A207-N1', voyage.notificacao, pod, [{ number: 'ADCU2070011' }])
    expect(importCeSheet('A207-MAN-1', voyage.notificacao, [{ blId: 'A207-N1', ce: '207001000000011' }]))
      .toMatchObject({ ok: true, inserted: 1 })

    const invoice = JSON.parse(localPsql(`
      SELECT jsonb_build_object('number', invoice_number, 'total', total_brl, 'status', status)
      FROM public.invoices WHERE bl_id = 'A207-N1';
    `)) as { number: string; total: number; status: string }
    expect(invoice).toMatchObject({ status: 'issued', total: containerFee })

    const message = localPsql(`
      SELECT message FROM public.portal_notifications
      WHERE customer_id = ${cliente.id} AND type = 'invoice_issued' AND message LIKE '%${invoice.number} %';
    `)
    expect(message).toContain(invoice.number)
    emissao = { invoiceNumber: invoice.number, total: invoice.total, message }
  })

  it('esperado: a notificação "Nova fatura emitida" informa o total real da fatura [CED-05, ORDCT-V01] — regra: CONTEXT.md:1931-1934 (Notificação In-App do Portal responde ao evento financeiro), CONTEXT.md:2104 e ADR 0077:8-9,15 (a fatura aparece no Portal na emissão e preserva o total)', () => {
    const variants = totalVariants(emissao?.total ?? Number.NaN)
    expect(emissao?.message).not.toContain('R$ 0.00')
    expect(variants.some((value) => emissao?.message.includes(`R$ ${value}`))).toBe(true)
  })

  // --- 2. M19: B/L Cancelado na prontidão do Comunicado de CE e Taxas ---------
  let prontidaoComCancelado: Readiness | null = null
  let conteudoComCancelado: string[] | null = null

  it('cenário 2: um B/L do Cliente na Viagem é faturado pelo CE e outro, com CE e sem Taxas calculadas, é cancelado pelo Administrativo', () => {
    insertBl('A207-C1', voyage.cancelado, pod, [{ number: 'ADCU2070021' }])
    insertBl('A207-C2', voyage.cancelado, podSemTabela, [{ number: 'ADCU2070022' }])
    // Uma planilha por Manifesto Mercante (rota): o número fica preso à rota.
    expect(importCeSheet('A207-MAN-2', voyage.cancelado, [{ blId: 'A207-C1', ce: '207001000000021' }]))
      .toMatchObject({ ok: true, inserted: 1 })
    expect(importCeSheet('A207-MAN-3', voyage.cancelado, [{ blId: 'A207-C2', ce: '207001000000022' }]))
      .toMatchObject({ ok: true, inserted: 1 })
    expect(blState('A207-C1').financial_status).toBe('invoiced')
    // Sem tabela no POD, nada é calculado, não há recebível e a ficha oferece
    // Cancelar (B/L com CE, BlDetalhe.tsx:372-373); payload de blState.ts:10-18.
    expect(JSON.parse(asAdmin(`SELECT public.cancel_bl('A207-C2', 'Carga não embarcou (A207)', false);`)))
      .toEqual({ cancelled: true, reasons: [] })
    expect(blState('A207-C2')).toMatchObject({ cancelled: true, financial_status: 'pending' })

    prontidaoComCancelado = communicationReadiness(voyage.cancelado)
    // Só o B/L cancelado pode bloquear: o B/L ativo tem CE, revisão limpa e fatura.
    expect(prontidaoComCancelado.bls.filter((bl) => bl.bl_id !== 'A207-C2')).toEqual([
      expect.objectContaining({ bl_id: 'A207-C1', blocked_reasons: [] }),
    ])
    conteudoComCancelado = communicationPayloadBls(voyage.cancelado)
    expect(conteudoComCancelado).toContain('A207-C1')
  })

  it('esperado: o B/L cancelado fica fora da prontidão e do conteúdo do Comunicado de CE e Taxas do Cliente na Viagem, que fica pronto [CED-07] — regra: CONTEXT.md:790-801 (B/L Cancelado sai do faturamento e libera o CE) e docs/modules/clientes.md:176-178 (prontidão exige faturamento concluído em todos os B/Ls ativos)', () => {
    expect(prontidaoComCancelado).toMatchObject({ ready: true, reasons: [] })
    // Só a prontidão não basta: o Comunicado pronto não pode listar o B/L cancelado.
    expect(conteudoComCancelado).toEqual(['A207-C1'])
  })

  // --- 3. M10: datas de descarga em B/L faturado (ADR 0077) ------------------
  let datasEmFaturado: { before: BlState; after: BlState; readinessBefore: Readiness; readinessAfter: Readiness } | null = null

  it('cenário 3: a planilha de datas registra a descarga do container de um B/L já faturado pelo CE', () => {
    insertBl('A207-R1', voyage.datasFaturado, pod, [{ number: 'ADCU2070031' }])
    expect(importCeSheet('A207-MAN-4', voyage.datasFaturado, [{ blId: 'A207-R1', ce: '207001000000031' }]))
      .toMatchObject({ ok: true, inserted: 1 })
    const before = blState('A207-R1')
    const readinessBefore = communicationReadiness(voyage.datasFaturado)
    expect(before).toMatchObject({ financial_status: 'invoiced', charge_status: 'ready_for_billing', billing_hold_reason: null })
    expect(readinessBefore).toMatchObject({ ready: true, reasons: [] })

    const result = importContainerDates('A207-R1', [{ number: 'ADCU2070031', discharge: '2026-09-20', return: null }])
    expect(result.updated_ids).toHaveLength(1)
    // A fatura emitida não muda (ADR 0077 decisão 1).
    expect(localPsql(`SELECT status || ':' || total_brl FROM public.invoices WHERE bl_id = 'A207-R1';`)).toBe(`issued:${containerFee.toFixed(2)}`)

    datasEmFaturado = { before, after: blState('A207-R1'), readinessBefore, readinessAfter: communicationReadiness(voyage.datasFaturado) }
  })

  it('esperado: o B/L segue faturado e revisado, sem "Carga alterada após faturamento", e o Comunicado de CE e Taxas continua pronto [ORDCT-V02, VEI-V02] — regra: ADR 0077:22-24 e CONTEXT.md:2104-2109 (data de Demurrage não é correção) e ADR 0077:75-77 (a 128 removeu os gatilhos que alertavam a cada alteração de container)', () => {
    expect(datasEmFaturado?.after).toEqual(datasEmFaturado?.before)
    expect(datasEmFaturado?.readinessAfter).toMatchObject({ ready: true, reasons: [] })
  })

  // --- 4. M10: container devolvido no free time + container em atraso --------
  let misto: { expectedUsd: number; attempts: Array<string | null>; invoices: DemurrageInvoice[] } | null = null

  it('cenário 4: a planilha devolve os dois containers de um B/L, um dentro do free time e outro em atraso, e o Administrativo emite a Invoice de Demurrage', () => {
    insertBl('A207-M1', voyage.demurrage, pod, [{ number: 'ADCU2070041' }, { number: 'ADCU2070042' }])
    const dates = importContainerDates('A207-M1', [
      { number: 'ADCU2070041', discharge: '2026-07-01', return: '2026-07-10' },
      { number: 'ADCU2070042', discharge: '2026-07-01', return: '2026-09-30' },
    ])
    expect(dates).toMatchObject({ billing_state: 'ready_for_billing' })
    const ids = containerIds('A207-M1')
    // 9 dias (free time de 10) e 91 dias: só o segundo tem sobreestadia.
    const expectedUsd = demurrageUsdOf('A207-M1', ids.ADCU2070042)
    expect(expectedUsd).toBeGreaterThan(0)

    // As duas seleções possíveis: todos os não-SOC devolvidos (a do efeito
    // automático, _run_import_effect_demurrage, e a de createInvoiceForReturnedBL,
    // demurrageInvoices.ts:121-146, hoje sem chamador) e só o container com
    // sobreestadia (a de createInvoiceForBL, :92-118, se ele estivesse 'overdue';
    // nada grava 'overdue' hoje, DAT-05). A segunda só roda se a primeira falhar.
    const attempts: Array<string | null> = []
    for (const [doc, selection] of [
      ['A207-DEM-M1A', [ids.ADCU2070041, ids.ADCU2070042]],
      ['A207-DEM-M1B', [ids.ADCU2070042]],
    ] as const) {
      if (activeDemurrageInvoices('A207-M1').length > 0) break
      attempts.push(tryAsAdmin(`
        SELECT public.create_demurrage_invoice_authoritative(
          '${doc}', 'A207-M1', ${cliente.id}, ARRAY[${selection.join(', ')}]::bigint[]
        );
      `).error)
    }
    misto = { expectedUsd, attempts, invoices: activeDemurrageInvoices('A207-M1') }
    expect(misto.attempts.length).toBeGreaterThan(0)
    // Uma recusa só vale se for a do defeito (item sem sobreestadia fora do
    // cálculo ou conjunto incompleto), e não câmbio, permissão ou fixture.
    for (const error of misto.attempts.filter((value): value is string => value !== null)) {
      expect(error).toMatch(/Nenhum container faturável ou conjunto de containers desatualizado|não contém o conjunto completo e exclusivo de containers/)
    }
  })

  it('esperado: o B/L com todos os containers devolvidos tem uma Invoice de Demurrage emitida no valor da sobreestadia do container em atraso [DAT-04] — regra: CONTEXT.md:1406-1409 (emitida quando todos os containers do B/L foram devolvidos), CONTEXT.md:1335-1337 e ADR 0014:26-27', () => {
    expect(misto?.invoices).toHaveLength(1)
    expect(misto?.invoices[0]).toMatchObject({ status: 'issued', total_usd: misto?.expectedUsd })
  })

  // --- 5. M10: SOC sem devolução + COC devolvido -----------------------------
  let socSemDevolucao: { dates: DatesResult; expectedUsd: number; effects: Array<{ status: string; error: string | null }>; invoices: DemurrageInvoice[] } | null = null

  it('cenário 5: a planilha devolve o container COC de um B/L que também tem um container SOC', () => {
    insertBl('A207-S1', voyage.demurrage, pod, [{ number: 'ADCU2070051', ownership: 'SOC' }, { number: 'ADCU2070052' }])
    const dates = importContainerDates('A207-S1', [{ number: 'ADCU2070052', discharge: '2026-07-01', return: '2026-09-30' }])
    expect(dates.updated_ids).toHaveLength(1)
    const expectedUsd = demurrageUsdOf('A207-S1', containerIds('A207-S1').ADCU2070052)
    expect(expectedUsd).toBeGreaterThan(0)
    runWorker('A207-S1')
    socSemDevolucao = { dates, expectedUsd, effects: demurrageEffects('A207-S1'), invoices: activeDemurrageInvoices('A207-S1') }
  })

  it('esperado: o SOC não conta como devolução pendente; o B/L fica pronto, a emissão é enfileirada e a Demurrage do COC sai [DAT-07] — regra: CONTEXT.md:938 (SOC não tem devolução a esperar nem Demurrage), migration 121:15-17 e ADR 0014:35-36 (emissão automática quando todos os containers voltaram)', () => {
    expect(socSemDevolucao?.dates.billing_state).toBe('ready_for_billing')
    expect(socSemDevolucao?.effects.map((effect) => effect.status)).toEqual(['succeeded'])
    expect(socSemDevolucao?.invoices).toEqual([
      { status: 'issued', total_usd: socSemDevolucao?.expectedUsd, containers: ['ADCU2070052'] },
    ])
  })

  // --- 6. M10: SOC e COC devolvidos ------------------------------------------
  let socDevolvido: { expectedUsd: number; effects: Array<{ status: string; error: string | null }>; invoices: DemurrageInvoice[] } | null = null

  it('cenário 6: o B/L tem o SOC já com devolução registrada e a planilha devolve o COC; o executor processa a emissão de Demurrage', () => {
    // A devolução do SOC já gravada (como a planilha grava: 'returned'); vem da
    // fixture para não depender de a RPC aceitar devolução de SOC.
    insertBl('A207-S2', voyage.demurrage, pod, [
      { number: 'ADCU2070061', ownership: 'SOC', dischargeDate: '2026-07-01', returnDate: '2026-07-20', demurrageStatus: 'returned' },
      { number: 'ADCU2070062' },
    ])
    const dates = importContainerDates('A207-S2', [{ number: 'ADCU2070062', discharge: '2026-07-01', return: '2026-09-30' }])
    expect(dates).toMatchObject({ billing_state: 'ready_for_billing' })
    expect(demurrageEffects('A207-S2').map((effect) => effect.status)).toEqual(['pending'])
    const expectedUsd = demurrageUsdOf('A207-S2', containerIds('A207-S2').ADCU2070062)
    expect(expectedUsd).toBeGreaterThan(0)

    const processed = runWorker('A207-S2')
    expect(processed.map((effect) => effect.kind)).toEqual(['demurrage_billing'])
    socDevolvido = { expectedUsd, effects: demurrageEffects('A207-S2'), invoices: activeDemurrageInvoices('A207-S2') }
    // Efeito não concluído só vale se a recusa for a do SOC, e não câmbio ou permissão.
    for (const effect of socDevolvido.effects.filter((value) => value.status !== 'succeeded')) {
      expect(effect.error).toMatch(/ADCU2070061 é SOC/)
    }
  })

  it('esperado: a emissão automática fatura só o COC e o efeito termina concluído [ORDCT-18, DAT-07] — regra: CONTEXT.md:938, migration 121:15-17 (SOC não entra em fatura de Demurrage) e ADR 0014:35-36', () => {
    expect(socDevolvido?.effects.map((effect) => effect.status)).toEqual(['succeeded'])
    expect(socDevolvido?.invoices).toEqual([
      { status: 'issued', total_usd: socDevolvido?.expectedUsd, containers: ['ADCU2070062'] },
    ])
  })

  // --- Checagens novas da etapa 7 (migration 178) ---------------------------
  function containerDates(blId: string): Record<string, { discharge: string | null; return: string | null }> {
    return JSON.parse(localPsql(`
      SELECT COALESCE(jsonb_object_agg(container_number, jsonb_build_object('discharge', discharge_date, 'return', return_date)), '{}'::jsonb)
      FROM public.bl_containers WHERE bl_id = '${blId}';
    `)) as Record<string, { discharge: string | null; return: string | null }>
  }

  it('devolução vazia na planilha preserva a data gravada', () => {
    insertBl('A207-V1', voyage.grupo, pod, [{ number: 'ADCU2070081' }])
    importContainerDates('A207-V1', [{ number: 'ADCU2070081', discharge: '2026-07-01', return: '2026-07-05' }])
    const again = importContainerDates('A207-V1', [{ number: 'ADCU2070081', discharge: '2026-07-01', return: null }])
    expect(again.updated_ids).toEqual([])
    expect(containerDates('A207-V1').ADCU2070081).toEqual({ discharge: '2026-07-01', return: '2026-07-05' })
  })

  it('a data vale para o B/L irmão que divide o container e o grupo recebe uma única Invoice de Demurrage', () => {
    insertBl('A207-G1', voyage.grupo, pod, [{ number: 'ADCU2070071' }])
    insertBl('A207-G2', voyage.grupo, pod, [{ number: 'ADCU2070071' }, { number: 'ADCU2070072' }])
    expect(localPsql(`SELECT array_to_string(public.demurrage_group_bl_ids('A207-G2'), ',');`)).toBe('A207-G1,A207-G2')

    const first = importContainerDates('A207-G2', [{ number: 'ADCU2070072', discharge: '2026-07-01', return: '2026-09-30' }])
    expect(first.billing_state).toBe('pending')
    importContainerDates('A207-G1', [{ number: 'ADCU2070071', discharge: '2026-07-01', return: '2026-09-20' }])
    // A data chegou ao B/L irmão.
    expect(containerDates('A207-G2').ADCU2070071).toEqual({ discharge: '2026-07-01', return: '2026-09-20' })
    // Uma emissão, pelo B/L-âncora.
    expect(demurrageEffects('A207-G2')).toEqual([])
    expect(demurrageEffects('A207-G1').map((effect) => effect.status)).toEqual(['pending'])
    expect(runWorker('A207-G%').map((effect) => [effect.entity, effect.status])).toEqual([['A207-G1', 'succeeded']])

    const ids = { ADCU2070072: containerIds('A207-G2').ADCU2070072, shared: containerIds('A207-G1').ADCU2070071 }
    const expected = Number(localPsql(`
      SELECT (public._calculate_demurrage_invoice_authoritative('A207-G1', ARRAY[${ids.shared}, ${ids.ADCU2070072}]::bigint[],
        (now() AT TIME ZONE 'America/Sao_Paulo')::date)->>'total_usd');
    `))
    expect(activeDemurrageInvoices('A207-G1')).toEqual([
      { status: 'issued', total_usd: expected, containers: ['ADCU2070071', 'ADCU2070072'] },
    ])
    expect(activeDemurrageInvoices('A207-G2')).toEqual([])
  })

  it('corrigir a devolução depois da emissão, sem pagamento, cancela e reemite a Invoice de Demurrage', () => {
    const [before] = activeDemurrageInvoices('A207-G1')
    const id072 = containerIds('A207-G2').ADCU2070072
    const result = JSON.parse(asAdmin(`
      SELECT public.set_container_dates(${id072}, '2026-07-01', '2026-10-05', 'Terminal corrigiu a devolução (A207)');
    `)) as { demurrage: { demurrage_invoices: Array<{ status: string; reissue: { status: string } }> } }
    expect(result.demurrage.demurrage_invoices).toEqual([expect.objectContaining({ status: 'cancelled', reissue: expect.objectContaining({ status: 'issued' }) })])
    const [after] = activeDemurrageInvoices('A207-G1')
    expect(after.containers).toEqual(['ADCU2070071', 'ADCU2070072'])
    expect(after.total_usd).toBeGreaterThan(before.total_usd)
    expect(localPsql(`SELECT count(*) FROM public.demurrage_invoices WHERE bl_id = 'A207-G1' AND status = 'cancelled';`)).toBe('1')
  })

  it('remover uma data pela edição do container exige motivo', () => {
    const id = containerIds('A207-V1').ADCU2070081
    expect(tryAsAdmin(`SELECT public.set_container_dates(${id}, '2026-07-01', NULL, NULL);`).error).toMatch(/motivo/)
    expect(tryAsAdmin(`SELECT public.set_container_dates(${id}, '2026-07-01', NULL, 'Devolução lançada no container errado (A207)');`).error).toBeNull()
    expect(containerDates('A207-V1').ADCU2070081).toEqual({ discharge: '2026-07-01', return: null })
  })

  it('recebível sem fatura não trava o cancelamento do B/L e é anulado com registro', () => {
    insertBl('A207-RC1', voyage.recebivel, pod, [{ number: 'ADCU2070091' }])
    localPsql(`
      INSERT INTO public.bl_receivables (bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl, status)
      VALUES ('A207-RC1', ${cliente.id}, 'local_charges', 100, 0, 100, 'open');
    `)
    expect(JSON.parse(asAdmin(`SELECT public.cancel_bl('A207-RC1', 'Carga não embarcou (A207)', false);`))).toEqual({ cancelled: true, reasons: [] })
    expect(localPsql(`SELECT status || ':' || balance_brl FROM public.bl_receivables WHERE bl_id = 'A207-RC1';`)).toBe('void:0.00')
    expect(localPsql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = 'A207-RC1' AND field_name = 'receivable_voided';`)).toBe('1')
  })
})
