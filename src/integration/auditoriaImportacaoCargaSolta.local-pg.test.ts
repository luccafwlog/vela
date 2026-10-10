// Checagens de aceitação da revisão das importações (2026-10-09; docs/archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md).
// As referências `arquivo:linha` apontam para o checkout `fa5f238` da revisão; as regras decididas depois estão na ADR 0078.
// Cada it.fails documenta um defeito confirmado e roda no job local-pg do CI; quando a correção entrar, troque it.fails por it.
//
// Problema-raiz M01: reimportação de carga solta (Manifesto BB e B/L avulso
// PDF/DOCX) pela RPC `import_breakbulk_manifest_transactional`. O ON CONFLICT
// da definição efetiva (migrations 060:480-496 e 064:528-546) grava o que o
// arquivo traz por cima do que já existe: apaga o CE antes do UPDATE que o
// preservaria (064:542 × 064:556-559), desfaz o Cliente confirmado na Revisão,
// troca o Cliente de B/L faturado, move B/L de outra Viagem e não grava a
// sugestão de Cliente por nome (o INSERT não tem `suggested_customer_id`).
//
// Os payloads espelham `importBreakbulkManifest` (src/services/breakbulkImport.ts:54-131):
// a chave `ce_mercante` só vai quando o arquivo traz CE (breakbulkImport.ts:69),
// e o B/L avulso nunca traz (blDocumentParser.ts:170). O CE entra pela RPC real
// da planilha (`apply_ce_mercante_rows_atomic`, payload de ceMercanteImport.ts:197-207)
// e o vínculo da Revisão pela RPC real (`complete_review_customer_group`,
// payload de reviewCustomerGroup.ts:36-43). As RPCs rodam como `authenticated`.
//
// Namespace exclusivo: ids 99201xxx, CNPJ syntheticCnpj(201001..201003), B/Ls
// 'A201-*', usuário ...0201001. A limpeza (antes e depois) remove também
// faturas, recebíveis, efeitos, alertas, auditoria, notificações e a conta de
// Portal criada pelo gatilho de inserção de Cliente.
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000201001'
const alfa = { id: 99201001, cnpj: syntheticCnpj(201001), name: 'A201 CLIENTE ALFA LTDA', email: 'a201-alfa@example.test' }
const beta = { id: 99201002, cnpj: syntheticCnpj(201002), name: 'A201 CLIENTE BETA LTDA', email: 'a201-beta@example.test' }
// Sem Liberação de faturamento nem contato: o CE fica retido, sem fatura.
const gama = { id: 99201003, cnpj: syntheticCnpj(201003), name: 'A201 CLIENTE GAMA LTDA' }
const carrierId = 99201010
const vesselId = 99201011
const voyageA = 99201021
const voyageB = 99201022
const chargeTableId = 99201031
const chargeItemId = 99201032
const pol = 'A201O'
const pod = 'A201P'

function localPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
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

type BlState = {
  id: string
  voyage_id: number
  ce_mercante: string | null
  customer_id: number | null
  suggested_customer_id: number | null
  customer_reconciliation_status: string | null
  review_status: string | null
  financial_status: string | null
  manifesto_mercante_id: string | null
  notes: string | null
}

function blState(blId: string): BlState | null {
  const raw = localPsql(`
    SELECT row_to_json(t) FROM (
      SELECT id, voyage_id, ce_mercante, customer_id, suggested_customer_id,
             customer_reconciliation_status, review_status, financial_status, manifesto_mercante_id, notes
      FROM public.bls WHERE id = '${blId}'
    ) AS t;
  `)
  return raw ? (JSON.parse(raw) as BlState) : null
}

type InvoiceState = { id: number; customer_id: number; status: string; total_brl: number }

function invoicesOf(blId: string): InvoiceState[] {
  return JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'customer_id', customer_id, 'status', status, 'total_brl', total_brl
    ) ORDER BY id), '[]'::jsonb)
    FROM public.invoices WHERE bl_id = '${blId}';
  `)) as InvoiceState[]
}

type CustomerLink =
  | { kind: 'document'; customer: { id: number; cnpj: string; name: string } }
  | { kind: 'name'; consignee: string; suggestedId: number }
  | { kind: 'none'; consignee: string }

// Espelha o objeto que importBreakbulkManifest monta por B/L
// (breakbulkImport.ts:54-117, com resolveCustomerLink de customerReconciliation.ts:176-201)
// e o item único do B/L avulso (blDocumentParser.ts:164-190).
function breakbulkLine(voyageId: number, blId: string, link: CustomerLink, ceMercante: string | null = null) {
  const customerId = link.kind === 'document' ? link.customer.id : null
  const consignee = link.kind === 'document' ? link.customer.name : link.consignee
  const status = link.kind === 'document' ? 'matched_document' : link.kind === 'name' ? 'matched_name' : 'missing_customer'
  const row = {
    id: blId,
    voyage_id: voyageId,
    ...(ceMercante == null ? {} : { ce_mercante: ceMercante }),
    bb_machine_qty: 1,
    bb_packages_qty: 2,
    bb_packages_total: 2,
    bb_weight_ton: 5,
    shipper: 'A201 SHIPPER',
    consignee,
    notify_party: 'A201 NOTIFY',
    customer_id: customerId,
    suggested_customer_id: link.kind === 'name' ? link.suggestedId : null,
    manifest_customer_cnpj_cpf: link.kind === 'document' ? link.customer.cnpj : null,
    manifest_customer_name: consignee,
    manifest_customer_email: null,
    customer_reconciliation_status: status,
    customer_reconciliation_notes: link.kind === 'document'
      ? 'Cliente reconciliado automaticamente por CNPJ.'
      : link.kind === 'name' ? 'Cliente sugerido por nome; validar documento.' : 'Cliente nao encontrado na base cadastral.',
    billing_hold_reason: status === 'matched_document' ? null : 'Aguardando reconciliacao de cliente antes do faturamento.',
    pol,
    pod,
    cargo_description: 'MAQUINA A201',
    ncm_codes: [] as string[],
    bb_cbm: 3,
    review_status: customerId ? 'ok' : 'pending_review',
    financial_status: 'pending',
    notes: customerId ? null : 'Pendencias de importacao: Cliente nao vinculado automaticamente',
  }
  const item = {
    bl_id: blId,
    item_description: 'MAQUINA A201',
    package_qty: 2,
    package_unit: 'PACKAGES',
    gross_weight_kg: 5000,
    cbm: 3,
    marks: null,
  }
  return { row, item }
}

// O limite de 5 importações por minuto (import_manifest_transactional_legacy_165)
// é do produto; aqui só envelhecemos os lotes do próprio ator, sem auditoria
// (`created_at` é coluna gerada a partir de `uploaded_at`).
function releaseImportRateLimit(): void {
  localPsql(`
    SET session_replication_role = replica;
    UPDATE public.import_batches
    SET uploaded_at = uploaded_at - interval '10 minutes'
    WHERE uploaded_by = '${actorId}';
    SET session_replication_role = origin;
  `)
}

function importBreakbulk(voyageId: number, lines: Array<ReturnType<typeof breakbulkLine>>, filename = 'a201-carga-solta.pdf') {
  releaseImportRateLimit()
  return tryAsOperator(`
    SELECT public.import_breakbulk_manifest_transactional(
      '${filename}', ${voyageId}, '${actorId}'::uuid, ${lines.length},
      ${jsonLiteral(lines.map((line) => line.row))},
      ${jsonLiteral(lines.map((line) => line.item))},
      '[]'::jsonb
    );
  `)
}

function importCeSheet(manifestoNumero: string, voyageId: number, rows: Array<{ blId: string; ce: string }>) {
  const output = asOperator(`
    SELECT public.apply_ce_mercante_rows_atomic(
      ${jsonLiteral(rows.map((row, index) => ({ row: index + 2, bl_id: row.blId, ce: row.ce })))},
      '${actorId}'::uuid, 'bls', '${manifestoNumero}', ${voyageId}
    );
  `)
  return JSON.parse(output) as { ok: boolean; errors?: unknown }
}

const cleanupSql = `
  SET session_replication_role = replica;
  CREATE TEMP TABLE a201_bls AS SELECT id FROM public.bls WHERE id LIKE 'A201-%';
  CREATE TEMP TABLE a201_customers AS SELECT unnest(ARRAY[${alfa.id}, ${beta.id}, ${gama.id}]::bigint[]) AS id;
  CREATE TEMP TABLE a201_voyages AS SELECT unnest(ARRAY[${voyageA}, ${voyageB}]::bigint[]) AS id;
  CREATE TEMP TABLE a201_invoices AS
    SELECT id FROM public.invoices
    WHERE bl_id IN (SELECT id FROM a201_bls)
       OR customer_id IN (SELECT id FROM a201_customers)
       OR voyage_id IN (SELECT id FROM a201_voyages)
       OR id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id IN (SELECT id FROM a201_bls));
  CREATE TEMP TABLE a201_receivables AS
    SELECT id FROM public.bl_receivables
    WHERE bl_id IN (SELECT id FROM a201_bls) OR customer_id IN (SELECT id FROM a201_customers);
  CREATE TEMP TABLE a201_batches AS
    SELECT id FROM public.import_batches
    WHERE voyage_id IN (SELECT id FROM a201_voyages) OR uploaded_by = '${actorId}';
  CREATE TEMP TABLE a201_calcs AS SELECT id FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM a201_bls);
  CREATE TEMP TABLE a201_contacts AS SELECT id FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM a201_customers);
  CREATE TEMP TABLE a201_accounts AS SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM a201_customers);
  CREATE TEMP TABLE a201_alerts AS
    SELECT id FROM public.alerts
    WHERE message LIKE '%A201 %' OR message LIKE '%A201-%'
       OR entity_id LIKE 'A201 %' OR entity_id LIKE 'A201-%'
       OR (entity_type = 'customer' AND entity_id IN (SELECT id::text FROM a201_customers))
       OR (entity_type = 'voyage' AND entity_id IN (SELECT id::text FROM a201_voyages));
  CREATE TEMP TABLE a201_alert_items AS
    SELECT id FROM public.alert_items
    WHERE alert_id IN (SELECT id FROM a201_alerts)
       OR message LIKE '%A201 %' OR message LIKE '%A201-%'
       OR metadata::text LIKE '%A201 %' OR metadata::text LIKE '%A201-%'
       OR metadata->>'customer_id' IN (SELECT id::text FROM a201_customers)
       OR metadata->>'voyage_id' IN (SELECT id::text FROM a201_voyages);

  DELETE FROM public.internal_notifications
  WHERE alert_item_id IN (SELECT id FROM a201_alert_items)
     OR alert_id IN (SELECT id FROM a201_alerts)
     OR recipient_id = '${actorId}';
  DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM a201_alert_items);
  DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM a201_alert_items);
  DELETE FROM public.alert_notification_failures
  WHERE alert_item_id IN (SELECT id FROM a201_alert_items) OR alert_id IN (SELECT id FROM a201_alerts);
  DELETE FROM public.alert_items WHERE id IN (SELECT id FROM a201_alert_items);
  DELETE FROM public.alerts WHERE id IN (SELECT id FROM a201_alerts);

  DELETE FROM public.import_effect_attempts
  WHERE effect_id IN (
    SELECT id FROM public.import_pending_effects
    WHERE entity_id IN (SELECT id FROM a201_bls) OR created_by = '${actorId}'
  );
  DELETE FROM public.import_pending_effects
  WHERE entity_id IN (SELECT id FROM a201_bls) OR created_by = '${actorId}';

  DELETE FROM public.portal_notifications
  WHERE bl_id IN (SELECT id FROM a201_bls) OR customer_id IN (SELECT id FROM a201_customers);
  DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN (SELECT id FROM a201_invoices);
  DELETE FROM public.ledger_settlements
  WHERE invoice_id IN (SELECT id FROM a201_invoices) OR receivable_id IN (SELECT id FROM a201_receivables);
  DELETE FROM public.invoice_customer_changes
  WHERE bl_id IN (SELECT id FROM a201_bls)
     OR new_invoice_id IN (SELECT id FROM a201_invoices)
     OR original_customer_id IN (SELECT id FROM a201_customers)
     OR target_customer_id IN (SELECT id FROM a201_customers);
  DELETE FROM public.invoice_lifecycle_events
  WHERE invoice_id IN (SELECT id FROM a201_invoices)
     OR related_invoice_id IN (SELECT id FROM a201_invoices)
     OR receivable_id IN (SELECT id FROM a201_receivables);
  DELETE FROM public.invoice_receivable_links
  WHERE invoice_id IN (SELECT id FROM a201_invoices)
     OR bl_id IN (SELECT id FROM a201_bls)
     OR receivable_id IN (SELECT id FROM a201_receivables);
  DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM a201_invoices) OR bl_id IN (SELECT id FROM a201_bls);
  DELETE FROM public.invoice_bls WHERE invoice_id IN (SELECT id FROM a201_invoices) OR bl_id IN (SELECT id FROM a201_bls);
  DELETE FROM public.invoices WHERE id IN (SELECT id FROM a201_invoices);
  DELETE FROM public.bl_receivables WHERE id IN (SELECT id FROM a201_receivables);
  DELETE FROM public.invoice_basis_pending_changes WHERE bl_id IN (SELECT id FROM a201_bls);
  DELETE FROM public.charge_calculations WHERE id IN (SELECT id FROM a201_calcs);
  DELETE FROM public.billing_run_logs WHERE bl_id IN (SELECT id FROM a201_bls) OR manifest_id IN (SELECT id FROM a201_batches);
  DELETE FROM public.billing_runs WHERE manifest_id IN (SELECT id FROM a201_batches);
  DELETE FROM public.customer_reconciliation_queue
  WHERE bl_id IN (SELECT id FROM a201_bls)
     OR customer_id IN (SELECT id FROM a201_customers)
     OR manifest_id IN (SELECT id FROM a201_batches);
  DELETE FROM public.bl_breakbulk_items WHERE bl_id IN (SELECT id FROM a201_bls);
  DELETE FROM public.bls WHERE id IN (SELECT id FROM a201_bls);
  DELETE FROM public.import_errors WHERE batch_id IN (SELECT id FROM a201_batches);
  DELETE FROM public.import_batches WHERE id IN (SELECT id FROM a201_batches);
  DELETE FROM public.manifestos_mercante WHERE voyage_id IN (SELECT id FROM a201_voyages) OR numero LIKE 'A201-%';
  DELETE FROM public.voyage_route_ce_master WHERE voyage_id IN (SELECT id FROM a201_voyages);
  DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (SELECT id FROM a201_voyages);
  DELETE FROM public.voyage_documental_state WHERE voyage_id IN (SELECT id FROM a201_voyages);
  DELETE FROM public.pricing_rule_versions
  WHERE charge_table_id = ${chargeTableId}
     OR charge_item_id = ${chargeItemId}
     OR customer_id IN (SELECT id FROM a201_customers);
  DELETE FROM public.charge_table_items WHERE id = ${chargeItemId};
  DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
  DELETE FROM public.voyages WHERE id IN (SELECT id FROM a201_voyages);
  DELETE FROM public.vessels WHERE id = ${vesselId};
  DELETE FROM public.carriers WHERE id = ${carrierId};

  DELETE FROM public.portal_provisioning_events
  WHERE customer_id IN (SELECT id FROM a201_customers) OR account_id IN (SELECT id FROM a201_accounts);
  DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM a201_accounts);
  DELETE FROM public.portal_invites WHERE account_id IN (SELECT id FROM a201_accounts);
  DELETE FROM public.customer_portal_sessions
  WHERE account_id IN (SELECT id FROM a201_accounts) OR customer_id IN (SELECT id FROM a201_customers);
  DELETE FROM public.portal_inspection_events WHERE customer_id IN (SELECT id FROM a201_customers);
  DELETE FROM public.portal_rate_limits WHERE customer_id IN (SELECT id FROM a201_customers);
  DELETE FROM public.customer_portal_accounts WHERE id IN (SELECT id FROM a201_accounts);
  DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM a201_contacts);
  DELETE FROM public.customer_contact_preferences WHERE contact_id IN (SELECT id FROM a201_contacts);
  DELETE FROM public.customer_contact_change_events WHERE customer_id IN (SELECT id FROM a201_customers);
  DELETE FROM public.customer_contacts WHERE id IN (SELECT id FROM a201_contacts);
  DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (SELECT id FROM a201_customers);
  DELETE FROM public.customers WHERE id IN (SELECT id FROM a201_customers);

  DELETE FROM public.audit_logs
  WHERE changed_by = '${actorId}'
     OR entity_id LIKE 'A201-%'
     OR (entity_type IN ('customers', 'customer') AND entity_id IN (SELECT id::text FROM a201_customers))
     OR (entity_type IN ('voyages', 'voyage') AND entity_id IN (SELECT id::text FROM a201_voyages))
     OR (entity_type = 'vessels' AND entity_id = '${vesselId}')
     OR (entity_type = 'carriers' AND entity_id = '${carrierId}')
     OR (entity_type = 'charge_tables' AND entity_id = '${chargeTableId}')
     OR (entity_type = 'charge_table_items' AND entity_id = '${chargeItemId}')
     OR (entity_type = 'customer_contacts' AND entity_id IN (SELECT id::text FROM a201_contacts))
     OR (entity_type = 'import_batches' AND entity_id IN (SELECT id::text FROM a201_batches))
     OR (entity_type IN ('invoices', 'invoice') AND entity_id IN (SELECT id::text FROM a201_invoices))
     OR (entity_type = 'bl_receivables' AND entity_id IN (SELECT id::text FROM a201_receivables))
     OR (entity_type = 'charge_calculations' AND entity_id IN (SELECT id::text FROM a201_calcs));
  DELETE FROM public.user_profiles WHERE id = '${actorId}';
  DELETE FROM auth.users WHERE id = '${actorId}';
  SET session_replication_role = origin;
`

function cleanup(): void {
  localPsql(cleanupSql)
}

describeLocal('M01 — reimportação de carga solta (Manifesto BB e B/L avulso)', () => {
  beforeAll(() => {
    cleanup()
    localPsql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'a201-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'A201 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${alfa.id}, '${alfa.cnpj}', '${alfa.name}'),
        (${beta.id}, '${beta.cnpj}', '${beta.name}'),
        (${gama.id}, '${gama.cnpj}', '${gama.name}');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A201 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A201 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyageA}, ${vesselId}, 'A201A', 'active'),
        (${voyageB}, ${vesselId}, 'A201B', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${chargeTableId}, 'Tabela A201 carga solta', '${pod}', CURRENT_DATE - 30, true, 'carga_solta');
      INSERT INTO public.charge_table_items (
        id, charge_table_id, name, applies_to, value_brl, unit_value_brl,
        application_basis, category, cargo_profile, currency
      ) VALUES (${chargeItemId}, ${chargeTableId}, 'Taxa A201 por B/L', 'bl', 125, 125, 'bl', 'base', 'any', 'BRL');
      -- Desde a 083/084 o CE só emite com Liberação vigente e contato com e-mail.
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary) VALUES
        (${alfa.id}, 'Financeiro A201 Alfa', '${alfa.email}', 'financeiro', true),
        (${beta.id}, 'Financeiro A201 Beta', '${beta.email}', 'financeiro', true);
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at) VALUES
        (${alfa.id}, 'Fixture A201: gate aberto para o CE', '${actorId}', now() + interval '1 day'),
        (${beta.id}, 'Fixture A201: gate aberto para o CE', '${actorId}', now() + interval '1 day');
    `)
  })

  afterAll(cleanup)

  // --- 1. B/L avulso reimportado sem CE --------------------------------------
  let ceAfterDocumentReimport: BlState | null = null

  it('cenário 1: B/L avulso (PDF/DOCX) com CE da planilha é reimportado sem CE', () => {
    const blId = 'A201-BB1'
    const blDocument = breakbulkLine(voyageA, blId, { kind: 'document', customer: gama })
    expect(importBreakbulk(voyageA, [blDocument]).error).toBeNull()
    expect(importCeSheet('A201-MAN-1', voyageA, [{ blId, ce: '201001000000001' }])).toMatchObject({ ok: true })
    const before = blState(blId)
    expect(before).toMatchObject({ ce_mercante: '201001000000001', customer_id: gama.id })
    expect(before?.manifesto_mercante_id).toBeTruthy()
    // CE retido (Cliente sem Liberação): nenhuma fatura, o guard de CE não entra em jogo.
    expect(invoicesOf(blId)).toHaveLength(0)
    expect('ce_mercante' in blDocument.row).toBe(false)

    expect(importBreakbulk(voyageA, [blDocument], 'a201-bl-avulso-reimportado.pdf').error).toBeNull()
    ceAfterDocumentReimport = blState(blId)
    expect(ceAfterDocumentReimport?.id).toBe(blId)
  })

  it.fails('esperado: reimportar sem a chave de CE preserva o CE já gravado [BL-01, CED-03, OUT-01, ORDCE-02, TST-01] — regra: manifesto-edi.md:293, BlDocumentImportModal.tsx:101-102, breakbulkImport.ts:77-78, CONTEXT.md:1026', () => {
    expect(ceAfterDocumentReimport?.ce_mercante).toBe('201001000000001')
  })

  // --- 2. Lote com B/L faturado e B/L novo, sem CE ----------------------------
  let invoicedLotResult: { error: string | null; invoiced: BlState | null; newBl: BlState | null; invoices: InvoiceState[] } | null = null

  it('cenário 2: lote de B/Ls avulsos com um B/L já faturado e um B/L novo', () => {
    const invoicedBl = 'A201-BB2'
    const newBl = 'A201-BB7'
    const invoicedDocument = breakbulkLine(voyageA, invoicedBl, { kind: 'document', customer: alfa })
    expect(importBreakbulk(voyageA, [invoicedDocument]).error).toBeNull()
    expect(importCeSheet('A201-MAN-2', voyageA, [{ blId: invoicedBl, ce: '201001000000002' }])).toMatchObject({ ok: true })
    expect(blState(invoicedBl)).toMatchObject({ ce_mercante: '201001000000002', financial_status: 'invoiced' })
    expect(invoicesOf(invoicedBl)).toMatchObject([{ customer_id: alfa.id, status: 'issued' }])
    expect(blState(newBl)).toBeNull()

    const result = importBreakbulk(voyageA, [
      invoicedDocument,
      breakbulkLine(voyageA, newBl, { kind: 'document', customer: alfa }),
    ], 'a201-dois-bls-avulsos.pdf')
    invoicedLotResult = {
      error: result.error,
      invoiced: blState(invoicedBl),
      newBl: blState(newBl),
      invoices: invoicesOf(invoicedBl),
    }
    expect(invoicedLotResult.invoiced?.id).toBe(invoicedBl)
  })

  it.fails('esperado: o lote é aceito, o B/L novo entra e o faturado mantém CE e fatura [OUT-01, CED-03, TST-01] — regra: manifesto-edi.md:293, CONTEXT.md:1026 e ADR 0071 item 5 (docs/adr/0071-ce-mercante-como-trava-de-exclusao.md:66)', () => {
    expect(invoicedLotResult?.error).toBeNull()
    expect(invoicedLotResult?.newBl?.id).toBe('A201-BB7')
    expect(invoicedLotResult?.invoiced?.ce_mercante).toBe('201001000000002')
    expect(invoicedLotResult?.invoices).toMatchObject([{ customer_id: alfa.id, status: 'issued' }])
  })

  // --- 3. Cliente confirmado na Revisão e reimportação sem CNPJ ---------------
  // O vínculo só nasce de documento exato ou de confirmação humana, e a única
  // troca por reimportação é a Troca de Consignatário com aceite. A nota de
  // 2026-07-03 da ADR 0017 registrou que o import de manifesto manteve
  // voyage/customer/review sobrescritos; a ADR 0078, item 14, estende à carga
  // solta o contrato do B/L de container.
  let afterReviewReimport: BlState | null = null

  it('cenário 3: B/L sem CNPJ vinculado na Revisão e reimportado sem CNPJ', () => {
    const blId = 'A201-BB3'
    const blDocument = breakbulkLine(voyageA, blId, { kind: 'none', consignee: 'A201 CONSIGNATARIO SEM CNPJ' })
    expect(importBreakbulk(voyageA, [blDocument]).error).toBeNull()
    expect(blState(blId)).toMatchObject({ customer_id: null, customer_reconciliation_status: 'missing_customer' })

    const review = JSON.parse(asOperator(`
      SELECT public.complete_review_customer_group(
        ARRAY['${blId}'], ${alfa.id}, '${alfa.cnpj}', '${alfa.name}', '${alfa.email}', '${actorId}'::uuid
      );
    `)) as { customer: { id: number } }
    expect(review.customer.id).toBe(alfa.id)
    expect(blState(blId)).toMatchObject({ customer_id: alfa.id, customer_reconciliation_status: 'reconciled' })

    expect(importBreakbulk(voyageA, [blDocument], 'a201-bl-sem-cnpj-reimportado.pdf').error).toBeNull()
    afterReviewReimport = blState(blId)
    expect(afterReviewReimport?.id).toBe(blId)
  })

  it.fails('esperado: a reimportação sem CNPJ preserva o Cliente confirmado na Revisão [OUT-02, ORDCE-03, BL-01] — regra: CONTEXT.md:1011-1021 (Reconciliação de Cliente) e ADR 0043', () => {
    expect(afterReviewReimport).toMatchObject({ customer_id: alfa.id, customer_reconciliation_status: 'reconciled' })
  })

  // --- 4. Outro CNPJ sobre B/L faturado, sem aceite ---------------------------
  let customerSwap: { error: string | null; bl: BlState | null; invoices: InvoiceState[]; originalInvoiceId: number } | null = null

  it('cenário 4: Manifesto BB (layout resumido, mesma coluna CE) reimportado com o CNPJ de outro Cliente sobre B/L faturado', () => {
    const blId = 'A201-BB4'
    expect(importBreakbulk(voyageA, [breakbulkLine(voyageA, blId, { kind: 'document', customer: alfa })], 'a201-bb-resumo.xlsx').error).toBeNull()
    expect(importCeSheet('A201-MAN-4', voyageA, [{ blId, ce: '201001000000004' }])).toMatchObject({ ok: true })
    const issued = invoicesOf(blId)
    expect(issued).toMatchObject([{ customer_id: alfa.id, status: 'issued' }])
    expect(blState(blId)).toMatchObject({ customer_id: alfa.id, financial_status: 'invoiced' })

    const result = importBreakbulk(
      voyageA,
      [breakbulkLine(voyageA, blId, { kind: 'document', customer: beta }, '201001000000004')],
      'a201-bb-resumo-outro-cnpj.xlsx',
    )
    customerSwap = { error: result.error, bl: blState(blId), invoices: invoicesOf(blId), originalInvoiceId: issued[0].id }
    // Sem aceite, o vínculo fica e os demais campos seguem (CONTEXT.md:1033-1036;
    // ADR 0017, nota de 2026-08-28). Sem esta checagem, um erro qualquer da RPC
    // desfaria a transação e o esperado abaixo passaria pelo motivo errado.
    expect(customerSwap.error).toBeNull()
    expect(customerSwap.bl?.ce_mercante).toBe('201001000000004')
  })

  it.fails('esperado: sem aceite, o Cliente do B/L faturado não muda e a fatura emitida não é cancelada [OUT-02, ORDCE-V02] — regra: CONTEXT.md:1023-1036 (Troca de Consignatário: só com aceite explícito)', () => {
    expect(customerSwap?.bl?.customer_id).toBe(alfa.id)
    expect(customerSwap?.invoices.find((invoice) => invoice.id === customerSwap?.originalInvoiceId)?.status).toBe('issued')
  })

  // --- 5. B/L faturado de outra Viagem ---------------------------------------
  // A nota de 2026-08-28 da ADR 0017 trata do Importar B/L; a ADR 0078, item 14,
  // estende à carga solta: B/L de outra Viagem é recusado na prévia. A RPC pode
  // recusar o lote ou ignorar a linha; a checagem do cenário aceita os dois.
  let otherVoyage: { error: string | null; bl: BlState | null } | null = null

  it('cenário 5: Manifesto BB da Viagem B contém B/L faturado da Viagem A (mesmo CE e CNPJ)', () => {
    const blId = 'A201-BB5'
    expect(importBreakbulk(voyageA, [breakbulkLine(voyageA, blId, { kind: 'document', customer: alfa })], 'a201-bb-viagem-a.xlsx').error).toBeNull()
    expect(importCeSheet('A201-MAN-5', voyageA, [{ blId, ce: '201001000000005' }])).toMatchObject({ ok: true })
    expect(blState(blId)).toMatchObject({ voyage_id: voyageA, financial_status: 'invoiced' })
    expect(invoicesOf(blId)).toMatchObject([{ status: 'issued' }])

    const result = importBreakbulk(
      voyageB,
      [breakbulkLine(voyageB, blId, { kind: 'document', customer: alfa }, '201001000000005')],
      'a201-bb-viagem-b.xlsx',
    )
    otherVoyage = { error: result.error, bl: blState(blId) }
    // Hoje o lote é aceito; depois da correção, a recusa precisa ser pelo
    // conflito de Viagem. Um erro alheio também manteria a viagem (ROLLBACK) e
    // faria o esperado abaixo passar pelo motivo errado.
    expect(
      result.error === null || (result.error.includes(blId) && /viagem/i.test(result.error)),
      `a recusa deve nomear o B/L e a Viagem; recebido: ${result.error}`,
    ).toBe(true)
    expect(otherVoyage.bl?.id).toBe(blId)
  })

  it.fails('esperado: o Manifesto BB não move B/L faturado de outra Viagem [OUT-03] — regra: ADR 0017 nota de 2026-08-28 (docs/adr/0017-bl-fonte-ingestao-correcao-autoridade-compartilhada.md:175-181: viagem de B/L faturado só muda com override auditado) e manifesto-edi.md:294', () => {
    expect(otherVoyage?.bl?.voyage_id).toBe(voyageA)
  })

  // --- 6. Sugestão de Cliente por nome ----------------------------------------
  let suggested: BlState | null = null

  it('cenário 6: Manifesto BB sem CNPJ com consignatário igual ao nome de um Cliente', () => {
    const blId = 'A201-BB6'
    const line = breakbulkLine(voyageA, blId, { kind: 'name', consignee: beta.name, suggestedId: beta.id })
    expect(line.row.suggested_customer_id).toBe(beta.id)
    expect(importBreakbulk(voyageA, [line], 'a201-bb-sugestao.xlsx').error).toBeNull()
    suggested = blState(blId)
    expect(suggested).toMatchObject({ customer_id: null, customer_reconciliation_status: 'matched_name' })
  })

  it.fails('esperado: a sugestão por nome é gravada em suggested_customer_id [OUT-12, TST-11, BL-12] — regra: ADR 0043 (docs/adr/0043-vinculo-de-cliente-somente-por-documento.md:21), CONTEXT.md:1018-1020, RASTREABILIDADE.md:583', () => {
    expect(suggested?.suggested_customer_id).toBe(beta.id)
  })

  // --- 7. Guarda de regressão para a correção --------------------------------
  // Hoje correto. Preservar review_status/notes no ON CONFLICT sem reaplicar o
  // gate deixa o B/L, já vinculado por CNPJ, preso à pendência antiga.
  it('guarda: reimportar com o CNPJ tira a pendência de importação "Cliente nao vinculado" — regra: CONTEXT.md:1007-1009 (Revisão Operacional) e operacao-suporte.md:195 (gate por compute_bl_review_pendencies)', () => {
    const blId = 'A201-BB8'
    expect(importBreakbulk(voyageA, [breakbulkLine(voyageA, blId, { kind: 'none', consignee: 'A201 CONSIGNATARIO BB8' })], 'a201-bb-sem-cnpj.xlsx').error).toBeNull()
    expect(blState(blId)).toMatchObject({ customer_id: null, review_status: 'pending_review' })
    expect(blState(blId)?.notes).toContain('Cliente nao vinculado')

    expect(importBreakbulk(voyageA, [breakbulkLine(voyageA, blId, { kind: 'document', customer: alfa })], 'a201-bb-com-cnpj.xlsx').error).toBeNull()
    const linked = blState(blId)
    expect(linked).toMatchObject({ customer_id: alfa.id, customer_reconciliation_status: 'matched_document' })
    expect(linked?.review_status).not.toBe('pending_review')
    expect(linked?.notes ?? '').not.toContain('Cliente nao vinculado')
  })
})
