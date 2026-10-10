// Checagens de aceitação da revisão das importações (2026-10-09; docs/archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md).
// As referências `arquivo:linha` apontam para o checkout `fa5f238` da revisão; as regras decididas depois estão na ADR 0078.
// Os defeitos foram corrigidos na migration 176 (etapa 6 do plano de correção): os it.fails viraram it e rodam no job local-pg do CI.
//
// Problema-raiz M06: a unicidade CE × B/L não é imposta. A regra está decidida:
// "A relação CE × B/L é 1:1: um número de CE não pode ser usado por mais de um
// B/L" e a unicidade vale entre B/Ls não cancelados (CONTEXT.md:963-966; ADR 0071
// item 9, docs/adr/0071-ce-mercante-como-trava-de-exclusao.md:76-82); o CE existe
// "nos sentidos de importação e exportação" (CONTEXT.md:956-957), logo o B/L de
// Granito entra na mesma regra. A nota de implementação da ADR 0071 (:14) e a
// migration 089:16-17 registram a não imposição como desvio aceito, não como
// regra: o comportamento correto continua sendo o do item 9.
//
// Causa no banco (definições efetivas após as 168 migrations):
// - `idx_bls_ce_mercante` não é único (001_initial_schema.sql:6054); em Granito
//   já existe `idx_granite_bls_ce_mercante` único (001:6390), sem cruzar com `bls`.
// - `apply_ce_mercante_update` (016:229-277) grava sem olhar outros B/Ls, e
//   `apply_ce_mercante_rows_atomic` (164:28-172) não confere CE repetido no lote.
//   A checagem "CE duplicado no arquivo" existia só na função do EDI de CE
//   (`apply_ce_mercante_manifest`, 016:282-420; checagem em :315-322),
//   removida em 164:25.
// - O parser da planilha só recusa B/L repetido (ceMercanteImport.ts:232-280; :263-270).
// - `save_bl_review_legacy_070` (corpo de 002:18521, renomeado em 070:38-39)
//   grava o texto da ficha como veio (:58 da definição efetiva), e
//   `import_breakbulk_manifest_transactional` grava o CE do Manifesto BB no
//   INSERT (064:403-608).
// - `reactivate_bl` (089:99-127) não confere se o CE passou a outro B/L.
// - `ce_unlock_reconcile` (161:276-308) casa a linha da ZPT com todos os B/Ls
//   ativos que têm o CE.
//
// As ações usam as RPCs reais, como `authenticated`, com os payloads dos
// serviços: planilha de CE (ceMercanteImport.ts:197-207), ficha do B/L
// (useBlEditForm.ts:162-210), Manifesto BB (breakbulkImport.ts:54-148), Cancelar e
// Reativar (blState.ts:10-24) e conciliação ZPT (ceUnlockZptReconcile.ts:54-94).
// Os B/Ls entram por INSERT direto e não têm Cliente: a unicidade não depende de
// faturamento, e assim nenhum cenário emite fatura.
//
// Fora daqui, por dependerem de decisão de negócio (M08): formato de 15 dígitos
// fora da planilha, CE pela ficha e pelo Manifesto BB e escrita direta em
// `bls.ce_mercante`. A documentação viva diverge sobre esses caminhos
// (CONTEXT.md:992-993 "o CE Mercante entra só por planilha" × manifesto-edi.md:157
// e ADR 0071 item 5, que contam com a correção do CE). Por isso os cenários 4
// (ficha) e 5 (Manifesto BB) só exigem o que está decidido: o CE não chega a um
// segundo B/L ativo. Se a porta recusa a gravação ou passa a ignorar o CE, isso
// depende dessa decisão.
//
// Cada cenário traz um controle positivo: a mesma chamada, com um CE que nenhum
// B/L usa, roda numa transação desfeita (BEGIN … ROLLBACK) e tem de ser aceita.
// Assim, quando it.fails virar it, uma recusa por fixture, permissão ou SQL
// quebrado falha no cenário em vez de passar como "CE recusado".
//
// Namespace exclusivo: ids 99206xxx, B/Ls 'A206-*', manifestos 'A206MAN*' (13 caracteres),
// usuário e Granito com UUID ...0000002060NN, CEs iniciados por '992062'. Containers
// 'ADCU206xxxx' (a checagem ISO de `bl_containers` exige 4 letras + 7 dígitos);
// saem pela limpeza do B/L. Nenhum Cliente é criado; a limpeza (antes e depois)
// ainda remove, pelo namespace, contatos, conta de Portal e eventos do Portal,
// além de lotes, efeitos, alertas, auditoria e o estado da conciliação ZPT.
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseCeMercanteBuffer } from '../services/ceMercanteImport'
import { jsonToBuffer } from '../services/__tests__/testWorkbook'

// O parser não usa o cliente Supabase; o módulo só não pode exigir ambiente.
vi.mock('../services/supabase', () => ({ supabase: {} }))

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000206001'
const carrierId = 99206010
const vesselId = 99206011
const voyageId = 99206021
const graniteManifestId = '00000000-0000-0000-0000-000000206051'
const graniteBlId = '00000000-0000-0000-0000-000000206052'
const graniteBlNumber = 'A206-GRA-G1'
const customerRange = [99206001, 99206099] as const
const pol = 'A206O'
const pod = 'A206P'

const ce = {
  parser: '992062000000101',
  sameSheet: '992062000000201',
  otherSheet: '992062000000301',
  ficha: '992062000000401',
  breakbulk: '992062000000501',
  granite: '992062000000601',
  reactivate: '992062000000701',
  zpt: '992062000000801',
  correct: '992062000000901',
  corrected: '992062000000902',
  remove: '992062000000911',
} as const

// CEs que nenhum B/L usa: só aparecem nos controles positivos desfeitos.
const freeCe = {
  sameSheet: '992062000000202',
  otherSheet: '992062000000302',
  ficha: '992062000000402',
  breakbulk: '992062000000502',
  granite: '992062000000602',
} as const

// B/L de container já importado, sem Cliente, com rota (a planilha de CE exige POL/POD).
const containerBls: Array<{ id: string; container: string }> = [
  { id: 'A206-DUP-1', container: 'ADCU2060001' },
  { id: 'A206-DUP-2', container: 'ADCU2060002' },
  { id: 'A206-OUT-1', container: 'ADCU2060003' },
  { id: 'A206-OUT-2', container: 'ADCU2060004' },
  { id: 'A206-FIC-1', container: 'ADCU2060005' },
  { id: 'A206-FIC-2', container: 'ADCU2060006' },
  { id: 'A206-BB-H1', container: 'ADCU2060007' },
  { id: 'A206-GRA-1', container: 'ADCU2060008' },
  { id: 'A206-REA-1', container: 'ADCU2060009' },
  { id: 'A206-REA-2', container: 'ADCU2060010' },
  { id: 'A206-ZPT-1', container: 'ADCU2060011' },
  { id: 'A206-ZPT-2', container: 'ADCU2060012' },
  { id: 'A206-COR-1', container: 'ADCU2060013' },
  { id: 'A206-REM-1', container: 'ADCU2060014' },
]

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

type Attempt = { output: string | null; error: string | null }

function tryAsOperator(sql: string): Attempt {
  try {
    return { output: asOperator(sql), error: null }
  } catch (error) {
    const stderr = (error as { stderr?: string | Buffer }).stderr
    const message = String(stderr ?? error).split('\n').find((line) => line.startsWith('ERROR:')) ?? String(stderr ?? error)
    return { output: null, error: message.trim() }
  }
}

/** A mesma chamada como operador, desfeita no fim: controle positivo sem rastro. */
function probeAsOperator(sql: string): Attempt {
  return tryAsOperator(`BEGIN; ${sql} ROLLBACK;`)
}

function jsonLiteral(value: unknown): string {
  return `$json$${JSON.stringify(value)}$json$::jsonb`
}

type CeSheetResult = { ok: boolean; inserted?: number; overwritten?: number; errors?: Array<{ message: string }> }

// Payload de importCeMercanteRows (ceMercanteImport.ts:197-207): uma linha por B/L
// com o número da linha da planilha; para B/L, Nº de Manifesto e viagem.
function ceSheetCall(manifestoNumero: string, rows: Array<{ blId: string; ce: string }>): string {
  return `
    SELECT public.apply_ce_mercante_rows_atomic(
      ${jsonLiteral(rows.map((row, index) => ({ row: index + 2, bl_id: row.blId, ce: row.ce })))},
      '${actorId}'::uuid, 'bls', '${manifestoNumero}', ${voyageId}
    );
  `
}

// Mesmo serviço com target 'granite': bl_id é o id do B/L de Granito e não há manifesto.
function graniteCeSheetCall(rows: Array<{ graniteId: string; ce: string }>): string {
  return `
    SELECT public.apply_ce_mercante_rows_atomic(
      ${jsonLiteral(rows.map((row, index) => ({ row: index + 2, bl_id: row.graniteId, ce: row.ce })))},
      '${actorId}'::uuid, 'granite'
    );
  `
}

function importCeSheet(manifestoNumero: string, rows: Array<{ blId: string; ce: string }>): CeSheetResult {
  return JSON.parse(asOperator(ceSheetCall(manifestoNumero, rows))) as CeSheetResult
}

function importGraniteCeSheet(rows: Array<{ graniteId: string; ce: string }>): CeSheetResult {
  return JSON.parse(asOperator(graniteCeSheetCall(rows))) as CeSheetResult
}

/** Controle positivo da planilha: sem erro de SQL e com o resultado da RPC. */
function probeCeSheet(sql: string): CeSheetResult | { error: string | null } {
  const attempt = probeAsOperator(sql)
  return attempt.output === null ? { error: attempt.error } : (JSON.parse(attempt.output) as CeSheetResult)
}

/** B/Ls não cancelados que têm o CE (comparação sem espaços nas pontas). */
function activeHolders(ceNumber: string): string[] {
  const raw = localPsql(`
    SELECT COALESCE(string_agg(id, ',' ORDER BY id), '') FROM public.bls
    WHERE cancelled_at IS NULL AND btrim(ce_mercante) = '${ceNumber}';
  `)
  return raw ? raw.split(',') : []
}

function graniteHolders(ceNumber: string): string[] {
  const raw = localPsql(`
    SELECT COALESCE(string_agg(bl_number, ',' ORDER BY bl_number), '') FROM public.granite_bls
    WHERE btrim(ce_mercante) = '${ceNumber}';
  `)
  return raw ? raw.split(',') : []
}

function blRow(blId: string): { ce_mercante: string | null; cancelled: boolean } | null {
  const raw = localPsql(`
    SELECT row_to_json(t) FROM (
      SELECT ce_mercante, cancelled_at IS NOT NULL AS cancelled FROM public.bls WHERE id = '${blId}'
    ) AS t;
  `)
  return raw ? (JSON.parse(raw) as { ce_mercante: string | null; cancelled: boolean }) : null
}

const cleanupSql = `
  SET session_replication_role = replica;
  CREATE TEMP TABLE a206_bls AS SELECT id FROM public.bls WHERE id LIKE 'A206-%';
  CREATE TEMP TABLE a206_customers AS
    SELECT id FROM public.customers WHERE id BETWEEN ${customerRange[0]} AND ${customerRange[1]};
  CREATE TEMP TABLE a206_invoices AS
    SELECT id FROM public.invoices
    WHERE bl_id IN (SELECT id FROM a206_bls)
       OR customer_id IN (SELECT id FROM a206_customers)
       OR voyage_id = ${voyageId}
       OR id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id IN (SELECT id FROM a206_bls))
       OR id IN (SELECT invoice_id FROM public.invoice_items WHERE bl_id IN (SELECT id FROM a206_bls));
  CREATE TEMP TABLE a206_receivables AS
    SELECT id FROM public.bl_receivables
    WHERE bl_id IN (SELECT id FROM a206_bls) OR customer_id IN (SELECT id FROM a206_customers);
  CREATE TEMP TABLE a206_batches AS
    SELECT id FROM public.import_batches WHERE voyage_id = ${voyageId} OR uploaded_by = '${actorId}';
  CREATE TEMP TABLE a206_calcs AS SELECT id FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM a206_bls);
  CREATE TEMP TABLE a206_containers AS SELECT id FROM public.bl_containers WHERE bl_id IN (SELECT id FROM a206_bls);
  CREATE TEMP TABLE a206_contacts AS SELECT id FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM a206_customers);
  CREATE TEMP TABLE a206_accounts AS SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM a206_customers);
  CREATE TEMP TABLE a206_manifestos AS
    SELECT id FROM public.manifestos_mercante WHERE voyage_id = ${voyageId} OR numero LIKE 'A206-%';
  -- 'A206' só conta como palavra inteira: 'CMA206 ' ou 'QA206-77' são de outra suíte.
  CREATE TEMP TABLE a206_alerts AS
    SELECT id FROM public.alerts
    WHERE message ~ '(^|[^[:alnum:]])A206[- ]'
       OR entity_id LIKE 'A206-%' OR entity_id LIKE 'A206 %'
       OR (entity_type = 'granite_bl' AND entity_id = '${graniteBlId}')
       OR (entity_type = 'voyage' AND entity_id = '${voyageId}')
       OR (entity_type = 'customer' AND entity_id IN (SELECT id::text FROM a206_customers));
  CREATE TEMP TABLE a206_alert_items AS
    SELECT id FROM public.alert_items
    WHERE alert_id IN (SELECT id FROM a206_alerts)
       OR message ~ '(^|[^[:alnum:]])A206[- ]'
       OR metadata::text ~ '(^|[^[:alnum:]])A206[- ]'
       OR metadata->>'voyage_id' = '${voyageId}'
       OR metadata->>'customer_id' IN (SELECT id::text FROM a206_customers);

  DELETE FROM public.internal_notifications
  WHERE alert_item_id IN (SELECT id FROM a206_alert_items)
     OR alert_id IN (SELECT id FROM a206_alerts)
     OR recipient_id = '${actorId}';
  DELETE FROM public.alert_item_events
  WHERE alert_item_id IN (SELECT id FROM a206_alert_items) OR actor_id = '${actorId}';
  DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM a206_alert_items);
  DELETE FROM public.alert_notification_failures
  WHERE alert_item_id IN (SELECT id FROM a206_alert_items) OR alert_id IN (SELECT id FROM a206_alerts);
  DELETE FROM public.alert_items WHERE id IN (SELECT id FROM a206_alert_items);
  DELETE FROM public.alerts WHERE id IN (SELECT id FROM a206_alerts);

  DELETE FROM public.ce_unlock_zpt_status WHERE bl_id IN (SELECT id FROM a206_bls) OR reconciled_by = '${actorId}';
  DELETE FROM public.ce_unlock_events WHERE actor_id = '${actorId}' OR bl_id IN (SELECT id FROM a206_bls);

  DELETE FROM public.import_effect_attempts
  WHERE effect_id IN (
    SELECT id FROM public.import_pending_effects
    WHERE entity_id IN (SELECT id FROM a206_bls) OR entity_id = '${graniteBlId}' OR created_by = '${actorId}'
  );
  DELETE FROM public.import_pending_effects
  WHERE entity_id IN (SELECT id FROM a206_bls) OR entity_id = '${graniteBlId}' OR created_by = '${actorId}';

  DELETE FROM public.portal_notifications
  WHERE bl_id IN (SELECT id FROM a206_bls) OR customer_id IN (SELECT id FROM a206_customers);
  DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN (SELECT id FROM a206_invoices);
  DELETE FROM public.ledger_settlements
  WHERE invoice_id IN (SELECT id FROM a206_invoices) OR receivable_id IN (SELECT id FROM a206_receivables);
  DELETE FROM public.invoice_lifecycle_events
  WHERE invoice_id IN (SELECT id FROM a206_invoices)
     OR related_invoice_id IN (SELECT id FROM a206_invoices)
     OR receivable_id IN (SELECT id FROM a206_receivables);
  DELETE FROM public.invoice_receivable_links
  WHERE invoice_id IN (SELECT id FROM a206_invoices)
     OR bl_id IN (SELECT id FROM a206_bls)
     OR receivable_id IN (SELECT id FROM a206_receivables);
  DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM a206_invoices) OR bl_id IN (SELECT id FROM a206_bls);
  DELETE FROM public.invoice_bls WHERE invoice_id IN (SELECT id FROM a206_invoices) OR bl_id IN (SELECT id FROM a206_bls);
  DELETE FROM public.invoices WHERE id IN (SELECT id FROM a206_invoices);
  DELETE FROM public.bl_receivables WHERE id IN (SELECT id FROM a206_receivables);
  DELETE FROM public.invoice_basis_pending_changes WHERE bl_id IN (SELECT id FROM a206_bls);
  DELETE FROM public.charge_calculations WHERE id IN (SELECT id FROM a206_calcs);
  DELETE FROM public.billing_run_logs WHERE bl_id IN (SELECT id FROM a206_bls) OR manifest_id IN (SELECT id FROM a206_batches);
  DELETE FROM public.billing_runs WHERE manifest_id IN (SELECT id FROM a206_batches);
  DELETE FROM public.customer_reconciliation_queue
  WHERE bl_id IN (SELECT id FROM a206_bls) OR customer_id IN (SELECT id FROM a206_customers);
  DELETE FROM public.bl_breakbulk_items WHERE bl_id IN (SELECT id FROM a206_bls);
  DELETE FROM public.bl_containers WHERE id IN (SELECT id FROM a206_containers);
  DELETE FROM public.bls WHERE id IN (SELECT id FROM a206_bls);
  DELETE FROM public.import_errors WHERE batch_id IN (SELECT id FROM a206_batches);
  DELETE FROM public.import_batches WHERE id IN (SELECT id FROM a206_batches);
  DELETE FROM public.manifestos_mercante WHERE id IN (SELECT id FROM a206_manifestos);
  DELETE FROM public.voyage_route_ce_master WHERE voyage_id = ${voyageId};
  DELETE FROM public.granite_bls WHERE id = '${graniteBlId}' OR manifest_id = '${graniteManifestId}';
  DELETE FROM public.granite_manifests WHERE id = '${graniteManifestId}' OR voyage_id = ${voyageId};
  DELETE FROM public.voyage_documental_pending WHERE voyage_id = ${voyageId};
  DELETE FROM public.voyage_documental_state WHERE voyage_id = ${voyageId};
  DELETE FROM public.voyages WHERE id = ${voyageId};
  DELETE FROM public.vessels WHERE id = ${vesselId};
  DELETE FROM public.carriers WHERE id = ${carrierId};

  DELETE FROM public.portal_provisioning_events
  WHERE customer_id IN (SELECT id FROM a206_customers) OR account_id IN (SELECT id FROM a206_accounts);
  DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM a206_accounts);
  DELETE FROM public.portal_invites WHERE account_id IN (SELECT id FROM a206_accounts);
  DELETE FROM public.customer_portal_sessions
  WHERE account_id IN (SELECT id FROM a206_accounts) OR customer_id IN (SELECT id FROM a206_customers);
  DELETE FROM public.portal_inspection_events WHERE customer_id IN (SELECT id FROM a206_customers);
  DELETE FROM public.portal_rate_limits WHERE customer_id IN (SELECT id FROM a206_customers);
  DELETE FROM public.customer_portal_accounts WHERE id IN (SELECT id FROM a206_accounts);
  DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM a206_contacts);
  DELETE FROM public.customer_contact_preferences WHERE contact_id IN (SELECT id FROM a206_contacts);
  DELETE FROM public.customer_contact_change_events WHERE customer_id IN (SELECT id FROM a206_customers);
  DELETE FROM public.customer_contacts WHERE id IN (SELECT id FROM a206_contacts);
  DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (SELECT id FROM a206_customers);
  DELETE FROM public.customers WHERE id IN (SELECT id FROM a206_customers);

  DELETE FROM public.audit_logs
  WHERE changed_by = '${actorId}'
     OR entity_id LIKE 'A206-%'
     OR entity_id IN ('${graniteBlId}', '${graniteManifestId}')
     OR (entity_type IN ('voyages', 'voyage') AND entity_id = '${voyageId}')
     OR (entity_type = 'vessels' AND entity_id = '${vesselId}')
     OR (entity_type = 'carriers' AND entity_id = '${carrierId}')
     OR (entity_type IN ('customers', 'customer') AND entity_id IN (SELECT id::text FROM a206_customers))
     OR (entity_type = 'customer_contacts' AND entity_id IN (SELECT id::text FROM a206_contacts))
     OR (entity_type = 'bl_containers' AND entity_id IN (SELECT id::text FROM a206_containers))
     OR (entity_type = 'manifestos_mercante' AND entity_id IN (SELECT id::text FROM a206_manifestos))
     OR (entity_type = 'import_batches' AND entity_id IN (SELECT id::text FROM a206_batches))
     OR (entity_type IN ('invoices', 'invoice') AND entity_id IN (SELECT id::text FROM a206_invoices))
     OR (entity_type = 'bl_receivables' AND entity_id IN (SELECT id::text FROM a206_receivables))
     OR (entity_type = 'charge_calculations' AND entity_id IN (SELECT id::text FROM a206_calcs));
  DELETE FROM public.user_profiles WHERE id = '${actorId}';
  DELETE FROM auth.users WHERE id = '${actorId}';
  SET session_replication_role = origin;
`

function cleanup(): void {
  localPsql(cleanupSql)
}

describeLocal('M06 — unicidade CE × B/L entre B/Ls não cancelados (todas as portas do CE)', () => {
  beforeAll(() => {
    cleanup()
    localPsql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'a206-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'A206 Administrativo', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A206 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A206 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A206', 'active');
      INSERT INTO public.bls (
        id, voyage_id, pol, pod, cargo_mode, financial_status, charge_status,
        customer_reconciliation_status, review_status, consignee
      ) VALUES ${containerBls.map((bl) =>
        `('${bl.id}', ${voyageId}, '${pol}', '${pod}', 'container', 'pending', 'not_calculated', 'missing_customer', 'ok', 'A206 CONSIGNATARIO')`).join(', ')};
      INSERT INTO public.bl_containers (bl_id, container_number, type)
      VALUES ${containerBls.map((bl) => `('${bl.id}', '${bl.container}', '40HC')`).join(', ')};
      INSERT INTO public.granite_manifests (id, voyage_id, vessel_voyage)
      VALUES ('${graniteManifestId}', ${voyageId}, 'A206 NAVIO A206');
      INSERT INTO public.granite_bls (id, manifest_id, bl_number)
      VALUES ('${graniteBlId}', '${graniteManifestId}', '${graniteBlNumber}');
    `)
  })

  afterAll(cleanup)

  // --- 1. Prévia da planilha com o mesmo CE em duas linhas -------------------
  let parsedSheet: Awaited<ReturnType<typeof parseCeMercanteBuffer>> | null = null

  it('cenário 1: a prévia lê uma planilha de CE com o mesmo CE em dois B/Ls', async () => {
    // Controle: cada linha, sozinha, é válida; um erro na planilha das duas só pode vir da repetição do CE.
    for (const blId of ['A206-DUP-1', 'A206-DUP-2']) {
      const single = await parseCeMercanteBuffer(jsonToBuffer([{ BL: blId, 'CE MERCANTE': ce.parser }]))
      expect(single.rowErrors).toEqual([])
      expect(single.rows).toEqual([expect.objectContaining({ bl_id: blId, ce_mercante: ce.parser })])
    }

    parsedSheet = await parseCeMercanteBuffer(jsonToBuffer([
      { BL: 'A206-DUP-1', 'CE MERCANTE': ce.parser },
      { BL: 'A206-DUP-2', 'CE MERCANTE': ce.parser },
    ]))
    // As duas linhas foram lidas (válidas ou com erro) e o CE tem os 15 dígitos.
    expect(parsedSheet.rows.length + parsedSheet.rowErrors.length).toBe(2)
    expect(parsedSheet.rows.every((row) => row.ce_mercante === ce.parser)).toBe(true)
    expect(parsedSheet.rows.map((row) => row.bl_id).every((id) => id.startsWith('A206-DUP-'))).toBe(true)
  })

  it('esperado: a prévia acusa o CE repetido e bloqueia a confirmação [CE-01, CED-06, ORDCE-05, TST-07] — regra: CONTEXT.md:963-966 (CE × B/L 1:1), ADR 0071 item 9, ADR 0072 item 4 (a prévia mostra o que entra) e CeMercanteImportModal.tsx:141 (erro de estrutura bloqueia a importação)', () => {
    expect(parsedSheet?.rowErrors.length ?? 0).toBeGreaterThan(0)
  })

  // --- 2. RPC da planilha com o mesmo CE em duas linhas do lote --------------
  let sameSheet: { result: CeSheetResult; holders: string[] } | null = null

  it('cenário 2: a planilha de CE chega ao banco com o mesmo CE em dois B/Ls do lote', () => {
    expect(activeHolders(ce.sameSheet)).toEqual([])
    expect(blRow('A206-DUP-1')).toMatchObject({ ce_mercante: null, cancelled: false })
    expect(blRow('A206-DUP-2')).toMatchObject({ ce_mercante: null, cancelled: false })
    // Controle desfeito: o mesmo lote, com CEs distintos, é aceito inteiro.
    expect(probeCeSheet(ceSheetCall('A206MAN000DUP', [
      { blId: 'A206-DUP-1', ce: ce.sameSheet },
      { blId: 'A206-DUP-2', ce: freeCe.sameSheet },
    ]))).toMatchObject({ ok: true, inserted: 2 })
    expect(activeHolders(freeCe.sameSheet)).toEqual([])

    const result = importCeSheet('A206MAN000DUP', [
      { blId: 'A206-DUP-1', ce: ce.sameSheet },
      { blId: 'A206-DUP-2', ce: ce.sameSheet },
    ])
    sameSheet = { result, holders: activeHolders(ce.sameSheet) }
    expect(typeof result.ok).toBe('boolean')
  })

  it('esperado: o lote é recusado inteiro e nenhum B/L recebe o CE [CE-01, CED-06, ORDCE-05, TST-07] — regra: CONTEXT.md:963-966, ADR 0071 item 9 e manifesto-edi.md:282 ("tudo ou nada": erro de linha devolve ok=false e nada é gravado)', () => {
    expect(sameSheet?.result.ok).toBe(false)
    expect(sameSheet?.holders).toEqual([])
  })

  // --- 3. Outra planilha com CE já usado por B/L não cancelado ---------------
  let otherSheet: { result: CeSheetResult; holders: string[] } | null = null

  it('cenário 3: uma segunda planilha traz para outro B/L um CE já gravado em B/L ativo', () => {
    expect(importCeSheet('A206MAN00OUT1', [{ blId: 'A206-OUT-1', ce: ce.otherSheet }])).toMatchObject({ ok: true, inserted: 1 })
    expect(activeHolders(ce.otherSheet)).toEqual(['A206-OUT-1'])
    expect(blRow('A206-OUT-2')).toMatchObject({ ce_mercante: null, cancelled: false })
    // Controle desfeito: o segundo manifesto da mesma rota aceita um CE livre.
    expect(probeCeSheet(ceSheetCall('A206MAN00OUT2', [{ blId: 'A206-OUT-2', ce: freeCe.otherSheet }])))
      .toMatchObject({ ok: true, inserted: 1 })

    const result = importCeSheet('A206MAN00OUT2', [{ blId: 'A206-OUT-2', ce: ce.otherSheet }])
    otherSheet = { result, holders: activeHolders(ce.otherSheet) }
    expect(typeof result.ok).toBe('boolean')
  })

  it('esperado: a planilha é recusada e o CE continua só no B/L que já o tinha [CE-01, ORDCE-05, TST-07, CED-06] — regra: CONTEXT.md:963-966 e ADR 0071 item 9 (unicidade entre B/Ls não cancelados)', () => {
    expect(otherSheet?.result.ok).toBe(false)
    expect(otherSheet?.holders).toEqual(['A206-OUT-1'])
  })

  // --- 4. Ficha do B/L com o CE de outro B/L ativo ---------------------------
  let ficha: { attempt: Attempt; holders: string[]; target: string | null } | null = null

  it('cenário 4: a ficha do B/L salva, entre espaços colados, o CE de outro B/L ativo', () => {
    expect(importCeSheet('A206MAN000FIC', [{ blId: 'A206-FIC-1', ce: ce.ficha }])).toMatchObject({ ok: true, inserted: 1 })
    expect(activeHolders(ce.ficha)).toEqual(['A206-FIC-1'])
    const updatedAt = localPsql(`SELECT updated_at::text FROM public.bls WHERE id = 'A206-FIC-2';`)
    expect(updatedAt).not.toBe('')

    // Payload de useBlEditForm.ts:162-210: o campo alterado vai como digitado
    // (normalizeFormValue, :319-331, não apara o texto).
    const fichaCall = (typed: string) => `
      SELECT public.save_bl_review(
        'A206-FIC-2', '${updatedAt}'::timestamptz,
        ${jsonLiteral({ ce_mercante: typed })},
        ${jsonLiteral([{ entity_type: 'bl', entity_id: 'A206-FIC-2', field_name: 'ce_mercante', old_value: '', new_value: typed, justification: 'Conferido no extrato do Mercante (A206)' }])},
        '${actorId}'::uuid
      );
    `
    // Controle desfeito: a mesma ficha, com o mesmo updated_at, salva um CE livre.
    expect(probeAsOperator(fichaCall(` ${freeCe.ficha} `)).error).toBeNull()

    const attempt = tryAsOperator(fichaCall(` ${ce.ficha} `))
    ficha = { attempt, holders: activeHolders(ce.ficha), target: blRow('A206-FIC-2')?.ce_mercante ?? null }
    expect(blRow('A206-FIC-2')?.cancelled).toBe(false)
  })

  // Decidido é só que o CE não chega ao segundo B/L ativo; recusar com erro ou
  // ignorar o campo depende da decisão sobre o CE pela ficha (M08).
  it('esperado: a ficha recusa o CE que já está em outro B/L ativo [CED-11, OUT-04, OUT-15, ORDCE-05] — regra: CONTEXT.md:963-966 (um número de CE não pode ser usado por mais de um B/L) e ADR 0071 item 9', () => {
    expect(ficha?.target).toBeNull()
    expect(ficha?.holders).toEqual(['A206-FIC-1'])
  })

  // --- 5. Manifesto BB com o CE de outro B/L ativo ---------------------------
  let breakbulk: { attempt: Attempt; holders: string[] } | null = null

  it('cenário 5: o Manifesto BB cria um B/L de carga solta com o CE de outro B/L ativo', () => {
    expect(importCeSheet('A206MAN0000BB', [{ blId: 'A206-BB-H1', ce: ce.breakbulk }])).toMatchObject({ ok: true, inserted: 1 })
    expect(activeHolders(ce.breakbulk)).toEqual(['A206-BB-H1'])
    expect(blRow('A206-BB-NEW')).toBeNull()

    // Objeto de importBreakbulkManifest (breakbulkImport.ts:54-118) para consignatário
    // sem Cliente; a chave ce_mercante vai porque o arquivo traz CE (:69).
    const row = (ceMercante: string) => ({
      id: 'A206-BB-NEW',
      voyage_id: voyageId,
      ce_mercante: ceMercante,
      bb_machine_qty: 1,
      bb_packages_qty: 2,
      bb_packages_total: 2,
      bb_weight_ton: 5,
      shipper: 'A206 SHIPPER',
      consignee: 'A206 CONSIGNATARIO',
      notify_party: null,
      customer_id: null,
      suggested_customer_id: null,
      manifest_customer_cnpj_cpf: null,
      manifest_customer_name: 'A206 CONSIGNATARIO',
      manifest_customer_email: null,
      customer_reconciliation_status: 'missing_customer',
      customer_reconciliation_notes: 'Cliente nao encontrado na base cadastral.',
      billing_hold_reason: 'Aguardando reconciliacao de cliente antes do faturamento.',
      pol,
      pod,
      cargo_description: 'MAQUINA A206',
      ncm_codes: [] as string[],
      bb_cbm: 3,
      review_status: 'pending_review',
      financial_status: 'pending',
      notes: 'Pendencias de importacao: Cliente nao vinculado automaticamente',
    })
    const item = {
      bl_id: 'A206-BB-NEW',
      item_description: 'MAQUINA A206',
      package_qty: 2,
      package_unit: 'PACKAGES',
      gross_weight_kg: 5000,
      cbm: 3,
      marks: null,
    }
    const breakbulkCall = (ceMercante: string) => `
      SELECT public.import_breakbulk_manifest_transactional(
        'a206-manifesto-bb.xlsx', ${voyageId}, '${actorId}'::uuid, 1,
        ${jsonLiteral([row(ceMercante)])}, ${jsonLiteral([item])}, '[]'::jsonb
      );
    `
    // Controle desfeito: o mesmo Manifesto BB, com um CE livre, é importado.
    expect(probeAsOperator(breakbulkCall(freeCe.breakbulk)).error).toBeNull()
    expect(blRow('A206-BB-NEW')).toBeNull()

    const attempt = tryAsOperator(breakbulkCall(ce.breakbulk))
    breakbulk = { attempt, holders: activeHolders(ce.breakbulk) }
    expect(breakbulk.holders).toContain('A206-BB-H1')
  })

  // O CE não chega ao segundo B/L ativo. Pela ADR 0078 (D-03), o Manifesto BB
  // deixa de gravar CE: a correção (migration 173, Etapa 1) importa o B/L sem
  // ele, com aviso na prévia.
  it('esperado: o CE do Manifesto BB que já está em outro B/L ativo é recusado [OUT-04, ORDCE-05, CED-11, TST-13] — regra: CONTEXT.md:963-966 e ADR 0071 item 9', () => {
    expect(breakbulk?.holders).toEqual(['A206-BB-H1'])
  })

  // --- 6. B/L de Granito recebe o CE de um B/L de carga ----------------------
  let granite: { result: CeSheetResult; cargo: string[]; granite: string[] } | null = null

  it('cenário 6: a planilha de CE de Granito traz o CE já gravado num B/L de carga ativo', () => {
    expect(importCeSheet('A206MAN000GRA', [{ blId: 'A206-GRA-1', ce: ce.granite }])).toMatchObject({ ok: true, inserted: 1 })
    expect(activeHolders(ce.granite)).toEqual(['A206-GRA-1'])
    expect(graniteHolders(ce.granite)).toEqual([])
    // Controle desfeito: o B/L de Granito aceita um CE livre pela mesma planilha.
    expect(probeCeSheet(graniteCeSheetCall([{ graniteId: graniteBlId, ce: freeCe.granite }])))
      .toMatchObject({ ok: true, inserted: 1 })

    const result = importGraniteCeSheet([{ graniteId: graniteBlId, ce: ce.granite }])
    granite = { result, cargo: activeHolders(ce.granite), granite: graniteHolders(ce.granite) }
    expect(typeof result.ok).toBe('boolean')
  })

  it('esperado: o CE do B/L de carga não entra no B/L de Granito [CE-01] — regra: CONTEXT.md:956-957 (CE por B/L nos sentidos de importação e exportação) e CONTEXT.md:963-964 (um número de CE não pode ser usado por mais de um B/L)', () => {
    expect(granite?.result.ok).toBe(false)
    expect(granite?.granite).toEqual([])
    expect(granite?.cargo).toEqual(['A206-GRA-1'])
  })

  // --- 7. Reativar B/L cujo CE passou ao B/L reemitido -----------------------
  let reactivation: { attempt: Attempt; holders: string[]; cancelled: boolean | null } | null = null

  it('cenário 7: o B/L cancelado é reativado depois que o B/L reemitido recebeu o mesmo CE', () => {
    expect(importCeSheet('A206MAN00REA1', [{ blId: 'A206-REA-1', ce: ce.reactivate }])).toMatchObject({ ok: true, inserted: 1 })
    // Payload de blState.ts:10-18 (cancelBl) e :21-24 (reactivateBl).
    expect(JSON.parse(asOperator(`SELECT public.cancel_bl('A206-REA-1', 'Armador reemitiu o B/L com outro número (A206)', false);`)))
      .toMatchObject({ cancelled: true })
    // Controle desfeito: sem o CE em outro B/L, o operador reativa este B/L com este motivo.
    const control = probeAsOperator(`SELECT public.reactivate_bl('A206-REA-1', 'Cancelado por engano (A206)');`)
    expect(control.error).toBeNull()
    expect(JSON.parse(control.output ?? 'null')).toMatchObject({ reactivated: true })
    expect(blRow('A206-REA-1')).toMatchObject({ cancelled: true })
    // O B/L cancelado libera o CE para o reemitido (CONTEXT.md:797; ADR 0071 item 9).
    expect(importCeSheet('A206MAN00REA2', [{ blId: 'A206-REA-2', ce: ce.reactivate }])).toMatchObject({ ok: true, inserted: 1 })
    expect(activeHolders(ce.reactivate)).toEqual(['A206-REA-2'])
    expect(blRow('A206-REA-1')).toMatchObject({ ce_mercante: ce.reactivate, cancelled: true })

    const attempt = tryAsOperator(`SELECT public.reactivate_bl('A206-REA-1', 'Cancelado por engano (A206)');`)
    reactivation = { attempt, holders: activeHolders(ce.reactivate), cancelled: blRow('A206-REA-1')?.cancelled ?? null }
    expect(reactivation.cancelled).not.toBeNull()
  })

  it('esperado: a reativação é recusada enquanto o CE estiver em outro B/L ativo [OUT-10, ORDCE-05] — regra: ADR 0071 item 9 (a unicidade CE × B/L vale entre B/Ls não cancelados) e CONTEXT.md:793-797 (o cancelado libera o CE para o B/L reemitido)', () => {
    expect(reactivation?.attempt.error).not.toBeNull()
    expect(reactivation?.cancelled).toBe(true)
    expect(reactivation?.holders).toEqual(['A206-REA-2'])
  })

  // --- 8. Conciliação ZPT com o CE em dois B/Ls ativos -----------------------
  let zpt: { summary: { rows: number; unlocked: number }; unlocked: string[] } | null = null

  it('cenário 8: a conciliação com a ZPT recebe "Desbloqueado" para um CE gravado em dois B/Ls', () => {
    expect(importCeSheet('A206MAN00ZPT1', [{ blId: 'A206-ZPT-1', ce: ce.zpt }])).toMatchObject({ ok: true, inserted: 1 })
    // Segunda planilha com o mesmo CE (o cenário 3 mostra que hoje é aceita).
    importCeSheet('A206MAN00ZPT2', [{ blId: 'A206-ZPT-2', ce: ce.zpt }])
    expect(activeHolders(ce.zpt)).toContain('A206-ZPT-1')

    // Linha de parseCeUnlockZptFile/reconcileCeUnlockZpt (ceUnlockZptReconcile.ts:54-94).
    const summary = JSON.parse(asOperator(`
      SELECT public.ce_unlock_reconcile(${jsonLiteral([{ ce: ce.zpt, status: 'Desbloqueado', description: null, updated_at: null, pending: [] }])});
    `)) as { rows: number; unlocked: number }
    expect(summary.rows).toBe(1)
    const raw = localPsql(`
      SELECT COALESCE(string_agg(bl_id, ',' ORDER BY bl_id), '') FROM public.ce_unlock_zpt_status
      WHERE bl_id LIKE 'A206-ZPT-%' AND status = 'unlocked';
    `)
    zpt = { summary, unlocked: raw ? raw.split(',') : [] }
  })

  it('esperado: a ZPT não marca como desbloqueado o B/L que não detém o CE [CE-V03, CED-06, TST-07] — regra: CONTEXT.md:963-966 (CE × B/L 1:1) e desbloqueio-ce.md:89 (a conciliação casa por CE)', () => {
    expect(zpt?.unlocked).not.toContain('A206-ZPT-2')
    // O B/L que detém o CE continua desbloqueado: "nenhum" não vale como acerto.
    expect(zpt?.unlocked).toEqual(['A206-ZPT-1'])
  })

  // --- 9. Porta única: Corrigir e Remover CE pela ficha (migration 176) ------
  function ceAudit(blId: string): Array<{ old_value: string | null; new_value: string | null; justification: string | null }> {
    const raw = localPsql(`
      SELECT COALESCE(json_agg(t ORDER BY t.id), '[]') FROM (
        SELECT id, old_value, new_value, justification FROM public.audit_logs
        WHERE entity_type = 'bl' AND entity_id = '${blId}' AND field_name = 'ce_mercante'
      ) AS t;
    `)
    return (JSON.parse(raw) as Array<{ old_value: string | null; new_value: string | null; justification: string | null }>)
  }

  it('Corrigir CE pela ficha grava o CE novo com o motivo no Histórico; UPDATE direto é recusado', () => {
    expect(importCeSheet('A206MAN000COR', [{ blId: 'A206-COR-1', ce: ce.correct }])).toMatchObject({ ok: true, inserted: 1 })

    const direct = tryAsOperator(`UPDATE public.bls SET ce_mercante = '${ce.corrected}' WHERE id = 'A206-COR-1';`)
    expect(direct.error).not.toBeNull()
    expect(blRow('A206-COR-1')?.ce_mercante).toBe(ce.correct)

    // CE de outro B/L ativo continua recusado pela porta única.
    expect(tryAsOperator(`SELECT public.correct_bl_ce_mercante('A206-COR-1', '${ce.otherSheet}', 'Teste A206');`).error).not.toBeNull()

    const attempt = tryAsOperator(`SELECT public.correct_bl_ce_mercante('A206-COR-1', '${ce.corrected}', 'CE digitado errado no extrato (A206)');`)
    expect(attempt.error).toBeNull()
    expect(blRow('A206-COR-1')?.ce_mercante).toBe(ce.corrected)
    expect(ceAudit('A206-COR-1')).toContainEqual(expect.objectContaining({
      old_value: ce.correct, new_value: ce.corrected, justification: expect.stringContaining('CE digitado errado no extrato (A206)'),
    }))
  })

  it('Remover CE com fatura viva é recusado; sem fatura viva, remove com o motivo no Histórico', () => {
    expect(importCeSheet('A206MAN000REM', [{ blId: 'A206-REM-1', ce: ce.remove }])).toMatchObject({ ok: true, inserted: 1 })
    localPsql(`
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerRange[0]}, '99206001000154', 'A206 CLIENTE');
      -- Só a fatura viva importa aqui: os gatilhos de emissão (Cliente
      -- reconciliado, Portal) ficam de fora da fixture.
      SET session_replication_role = replica;
      INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, total_brl, status, pix_payload)
      VALUES (99206901, 'A206-INV-1', ${customerRange[0]}, 'A206-REM-1', 10.00, 'issued', 'A206');
      SET session_replication_role = origin;
    `)

    const refused = tryAsOperator(`SELECT public.remove_bl_ce_mercante('A206-REM-1', 'CE do B/L errado (A206)');`)
    expect(refused.error).toMatch(/A206-INV-1/)
    expect(blRow('A206-REM-1')?.ce_mercante).toBe(ce.remove)

    localPsql(`SET session_replication_role = replica; UPDATE public.invoices SET status = 'cancelled' WHERE id = 99206901; SET session_replication_role = origin;`)
    expect(tryAsOperator(`SELECT public.remove_bl_ce_mercante('A206-REM-1', 'CE do B/L errado (A206)');`).error).toBeNull()
    expect(blRow('A206-REM-1')?.ce_mercante).toBeNull()
    expect(ceAudit('A206-REM-1')).toContainEqual(expect.objectContaining({
      old_value: ce.remove, new_value: '', justification: expect.stringContaining('CE do B/L errado (A206)'),
    }))
  })
})
