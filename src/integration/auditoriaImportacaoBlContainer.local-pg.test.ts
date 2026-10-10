// Checagens de aceitação da revisão das importações (2026-10-09; docs/archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md).
// As referências `arquivo:linha` apontam para o checkout `fa5f238` da revisão; as regras decididas depois estão na ADR 0078.
// Os casos nasceram como it.fails e viraram it com a migration 174 (Etapa 2 do plano
// docs/plans/2026-10-09-correcao-importacoes-ce-mercante.md); as checagens novas da Etapa 2 estão no fim da suíte.
//
// Problema-raiz M02: a reimportação de B/L de container apaga e recria
// `bl_containers` mesmo quando a prévia diz "Sem mudança". A prévia marca a
// linha sem impacto com `override_billing=true` (src/services/blFreightImport.ts:406),
// a confirmação envia toda linha com payload, inclusive a inalterada
// (blFreightImport.ts:518-526), e a definição efetiva
// `import_bl_freight_transactional_legacy_205` faz DELETE + INSERT dos
// containers (supabase/migrations/002_business_logic_and_security.sql:8417-8421
// e 8424; padrão herdado de migrations_archive/162 e 205). O INSERT volta a
// descarga à ATA (`set_container_discharge_date`, 002:20766/23737), perde
// devolução, status de Demurrage, local de desova e o id; esbarra na FK de
// `demurrage_invoice_items` (001:7931) e na guarda de container compartilhado
// faturado (066:391-416); e, em B/L faturado, os gatilhos de modalidade
// (`_recalculate_bl_cargo_mode`, 064:114-220) devolvem o B/L à Revisão.
//
// Problema-raiz M14: na Troca de Consignatário aceita, o e-mail do novo
// consignatário é capturado no Cliente antigo, porque a captura
// (002:1505 em `apply_bl_review_gate_after_import` e 002:8661 em
// `..._legacy_322`) roda antes de `relink_bl_customer` (002:8787, `..._legacy_357`).
//
// A prévia e a confirmação são as funções reais do serviço
// (`previewBlFreightImport` e `confirmBlFreightImport`); o cliente Supabase é
// trocado por uma ponte que executa as mesmas consultas e a mesma RPC no
// Postgres local como `authenticated` (SET ROLE: RLS e grants valem). Os passos
// de fixture usam as RPCs reais com o payload dos serviços: datas
// (containerDatesImport.ts:113-130), CE Mercante (ceMercanteImport.ts:197-208),
// Demurrage (`create_demurrage_invoice_authoritative`) e local de desova
// (vaziosNatureza.ts:137-145, UPDATE direto como authenticated).
//
// Namespace exclusivo: ids 99202xxx, CNPJ syntheticCnpj(202001..202002), B/Ls
// 'A202-*', containers 'AZCU202xxxx', usuário ...0202001. A limpeza (antes e
// depois) remove também faturas, recebíveis, Demurrage, efeitos, alertas,
// auditoria, notificações, contatos e a conta de Portal criada pelo gatilho de
// inserção de Cliente.
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ParsedBLDocument } from '../services/blParser'
import {
  buildBlFreightPayload,
  confirmBlFreightImport,
  previewBlFreightImport,
  type BlFreightImportPreview,
  type BlFreightImportResult,
} from '../services/blFreightImport'
import { syntheticCnpj } from './localTestData'

type BridgeError = { code: string | null; message: string; details: string }
type BridgeResult = { data: unknown; error: BridgeError | null }

// A fábrica de vi.mock é içada para antes dos imports; a ponte é preenchida abaixo.
const bridge = vi.hoisted(() => ({
  rpc: null as null | ((name: string, args: Record<string, unknown>) => BridgeResult),
  from: null as null | ((table: string) => unknown),
}))

vi.mock('../services/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (!bridge.rpc) throw new Error('Ponte de RPC não inicializada.')
      return bridge.rpc(name, args)
    },
    from: (table: string) => {
      if (!bridge.from) throw new Error('Ponte de consulta não inicializada.')
      return bridge.from(table)
    },
  },
  supabasePortal: {},
}))

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000202001'
const alfa = { id: 99202001, cnpj: syntheticCnpj(202001), name: 'A202 CLIENTE ALFA LTDA', email: 'a202-alfa@example.test' }
const beta = { id: 99202002, cnpj: syntheticCnpj(202002), name: 'A202 CLIENTE BETA LTDA', email: 'a202-beta@example.test' }
const carrierId = 99202010
const vesselId = 99202011
const vesselName = 'A202 NAVIO'
const voyageId = 99202021
const voyageNumber = 'A202V'
// ATA da Viagem: o gatilho de inserção copia esta data para a descarga do container novo.
const voyageAta = '2026-08-30'
const chargeTableId = 99202031
const chargeItemBlId = 99202032
const chargeItemContainerId = 99202033
const pod = 'BRNAT'

function psqlArgs(sql: string, role: boolean): string[] {
  const setRole = role ? 'SET ROLE authenticated; ' : ''
  return [
    '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-q', '-d', databaseUrl,
    '-c', `${setRole}SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ]
}

/** Superusuário com o ator na sessão (fixture, inspeção e limpeza). */
function localPsql(sql: string): string {
  return execFileSync('psql', psqlArgs(sql, false), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Papel `authenticated`, como o PostgREST executa a chamada do navegador. */
function asOperator(sql: string): string {
  return execFileSync('psql', psqlArgs(sql, true), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function tryAsOperator(sql: string): { output: string | null; error: BridgeError | null } {
  try {
    return { output: asOperator(sql), error: null }
  } catch (error) {
    const stderr = String((error as { stderr?: string | Buffer }).stderr ?? error)
    const line = stderr.split('\n').find((candidate) => candidate.startsWith('ERROR:')) ?? stderr
    const match = line.match(/^ERROR:\s+([0-9A-Z]{5}):\s+(.*)$/)
    return { output: null, error: { code: match?.[1] ?? null, message: (match?.[2] ?? line).trim(), details: stderr.trim() } }
  }
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return `'${String(value).replace(/'/g, "''")}'`
}

function jsonLiteral(value: unknown): string {
  return `$a202json$${JSON.stringify(value)}$a202json$::jsonb`
}

// --- Ponte: a mesma RPC que confirmBlFreightImport chama -----------------------
bridge.rpc = (name, args) => {
  if (name !== 'import_bl_freight_with_metadata') throw new Error(`RPC não emulada nesta suíte: ${name}`)
  const result = tryAsOperator(`
    SELECT public.import_bl_freight_with_metadata(
      p_bls => ${jsonLiteral(args.p_bls)},
      p_changed_by => ${sqlLiteral(args.p_changed_by)}::uuid,
      p_batch => ${jsonLiteral(args.p_batch)}
    );
  `)
  if (result.error) return { data: null, error: result.error }
  return { data: JSON.parse(result.output ?? 'null') as unknown, error: null }
}

// --- Ponte: as consultas que previewBlFreightImport faz (.from) ---------------
// Só as relações embutidas que o serviço pede: filhos de `bls` por bl_id e o
// navio da Viagem por vessel_id.
const childRelations: Record<string, string> = {
  'bls.bl_containers': 'bl_id',
  'bls.bl_freight_lines': 'bl_id',
  'bls.vehicles': 'bl_id',
}
const parentRelations: Record<string, { table: string; fk: string }> = {
  'voyages.vessels': { table: 'vessels', fk: 'vessel_id' },
  'bl_transshipments.voyage_omissions': { table: 'voyage_omissions', fk: 'omission_id' },
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function selectList(table: string, columns: string, alias: string): string {
  return splitTopLevel(columns.replace(/\s+/g, ' ')).map((item) => {
    const embed = item.match(/^(?:(\w+):)?(\w+)\((.*)\)$/)
    if (!embed) return item === '*' ? `${alias}.*` : `${alias}.${item}`
    const [, as, relation, inner] = embed
    const key = `${table}.${relation}`
    const sub = `${alias}_${relation}`
    const child = childRelations[key]
    if (child) {
      return `(SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) FROM (SELECT ${selectList(relation, inner, sub)} FROM public.${relation} AS ${sub} WHERE ${sub}.${child} = ${alias}.id) AS x) AS ${as ?? relation}`
    }
    const parent = parentRelations[key]
    if (parent) {
      return `(SELECT row_to_json(x) FROM (SELECT ${selectList(parent.table, inner, sub)} FROM public.${parent.table} AS ${sub} WHERE ${sub}.id = ${alias}.${parent.fk}) AS x) AS ${as ?? relation}`
    }
    throw new Error(`Relação embutida não emulada: ${key}`)
  }).join(', ')
}

class LocalQuery implements PromiseLike<BridgeResult> {
  private columns = '*'
  private readonly filters: string[] = []
  private readonly ordering: string[] = []
  private window = ''
  private readonly table: string

  constructor(table: string) {
    this.table = table
  }

  select(columns: string) { this.columns = columns; return this }
  eq(column: string, value: unknown) { this.filters.push(`m.${column} = ${sqlLiteral(value)}`); return this }
  in(column: string, values: unknown[]) {
    this.filters.push(values.length ? `m.${column} IN (${values.map(sqlLiteral).join(', ')})` : 'false')
    return this
  }
  is(column: string, value: null) {
    this.filters.push(value === null ? `m.${column} IS NULL` : 'false')
    return this
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.ordering.push(`m.${column} ${options?.ascending === false ? 'DESC' : 'ASC'}`)
    return this
  }
  range(from: number, to: number) { this.window = `OFFSET ${from} LIMIT ${to - from + 1}`; return this }

  maybeSingle(): Promise<BridgeResult> {
    const result = this.run()
    if (result.error) return Promise.resolve(result)
    return Promise.resolve({ data: (result.data as unknown[])[0] ?? null, error: null })
  }

  then<TResult1 = BridgeResult, TResult2 = never>(
    onfulfilled?: ((value: BridgeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }

  private run(): BridgeResult {
    const where = this.filters.length ? `WHERE ${this.filters.join(' AND ')}` : ''
    const orderBy = this.ordering.length ? `ORDER BY ${this.ordering.join(', ')}` : ''
    const result = tryAsOperator(`
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (SELECT ${selectList(this.table, this.columns, 'm')} FROM public.${this.table} AS m ${where} ${orderBy} ${this.window}) AS t;
    `)
    if (result.error) return { data: null, error: result.error }
    return { data: JSON.parse(result.output ?? '[]') as unknown[], error: null }
  }
}

bridge.from = (table) => new LocalQuery(table)

// --- Documento do B/L (o que parseBLFile entrega ao preview) -------------------
type DocumentOptions = {
  containers: string[]
  consignee?: { name: string; cnpj: string }
  consigneeEmail?: string | null
  shipper?: string
  /** aba VIN do arquivo; ausente, o documento não tem a aba */
  vehicles?: Array<{ chassis: string; container: string; model?: string }>
}

function blDocument(blNumber: string, options: DocumentOptions): ParsedBLDocument {
  const consignee = options.consignee ?? alfa
  return {
    blNumber,
    parties: {
      shipperBlock: options.shipper ?? 'A202 SHIPPER CO LTD\nNO 1 HARBOUR ROAD',
      consigneeBlock: `${consignee.name}\nCNPJ: ${consignee.cnpj}`,
      consigneeTaxId: consignee.cnpj,
      consigneeEmail: options.consigneeEmail ?? null,
      notifyBlock: 'SAME AS CONSIGNEE',
      alsoNotifyBlock: '',
    },
    route: {
      receipt: 'SHANGHAI',
      pol: 'SHANGHAI',
      pod,
      delivery: pod,
      vessel: vesselName,
      voyage: voyageNumber,
      movementFrom: 'CY',
      movementTo: 'CY',
    },
    dates: { ladenOnBoard: '15/08/2026', issueDate: '16/08/2026', issuePlace: 'SHANGHAI' },
    cargo: { description: 'AUTO PARTS A202', totalPackages: 10, packagesUnit: 'PACKAGES', dgClass: null, unNumber: null },
    containers: options.containers.map((containerNumber) => ({
      containerNumber,
      sealNumber: `S${containerNumber.slice(-4)}`,
      tareKg: 3800,
      ownership: null,
      packages: '10 PKG',
      type: '40HC',
      grossWeightKg: 12000,
      cbm: 30,
    })),
    vehicles: (options.vehicles ?? []).map((vehicle) => ({
      chassis: vehicle.chassis,
      containerNumber: vehicle.container,
      blNumber,
      brand: 'A202 MARCA',
      model: vehicle.model ?? 'A202 MODELO',
      weightKg: 1500,
      cbm: 10,
    })),
    vinSheet: options.vehicles !== undefined,
    freightCharges: [{
      description: 'OCEAN FREIGHT', rateCurrency: 'USD', rateAmount: 1500, per: 'CNTR', currency: 'USD', amount: 1500, payment: 'PREPAID',
    }],
  }
}

type ImportOutcome = {
  preview: BlFreightImportPreview
  result: BlFreightImportResult | null
  error: string | null
}

/** Fluxo do BlImportModal: prévia real e confirmação real, sem override e sem aceite por padrão. */
async function importBls(
  documents: ParsedBLDocument[],
  filename: string,
  options: { overrideBilling?: boolean; confirmCustomerChange?: boolean; confirmVehicleChanges?: boolean } = {},
): Promise<ImportOutcome> {
  const preview = await previewBlFreightImport({ documents, voyageId, onlyBlId: null })
  try {
    const result = await confirmBlFreightImport(
      preview,
      actorId,
      options.overrideBilling ?? false,
      filename,
      options.confirmCustomerChange ?? false,
      options.confirmVehicleChanges ?? false,
    )
    return { preview, result, error: null }
  } catch (error) {
    return { preview, result: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function previewRow(outcome: ImportOutcome, blNumber: string) {
  const row = outcome.preview.rows.find((candidate) => candidate.blNumber === blNumber)
  if (!row) throw new Error(`B/L ${blNumber} ausente da prévia.`)
  return row
}

type ContainerState = {
  id: number
  container_number: string
  discharge_date: string | null
  return_date: string | null
  demurrage_status: string | null
  unpacking_location: string | null
}

function containersOf(blId: string): ContainerState[] {
  return JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'container_number', container_number, 'discharge_date', discharge_date,
      'return_date', return_date, 'demurrage_status', demurrage_status, 'unpacking_location', unpacking_location
    ) ORDER BY container_number), '[]'::jsonb)
    FROM public.bl_containers WHERE bl_id = '${blId}';
  `)) as ContainerState[]
}

type BlState = {
  id: string
  customer_id: number | null
  shipper: string | null
  review_status: string | null
  financial_status: string | null
  charge_status: string | null
  billing_hold_reason: string | null
  ce_mercante: string | null
}

function blState(blId: string): BlState | null {
  const raw = localPsql(`
    SELECT row_to_json(t) FROM (
      SELECT id, customer_id, shipper, review_status, financial_status, charge_status, billing_hold_reason, ce_mercante
      FROM public.bls WHERE id = '${blId}'
    ) AS t;
  `)
  return raw ? (JSON.parse(raw) as BlState) : null
}

type InvoiceState = { id: number; status: string; total_brl: number }

function invoicesOf(blId: string): InvoiceState[] {
  return JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'total_brl', i.total_brl) ORDER BY i.id), '[]'::jsonb)
    FROM public.invoices AS i
    WHERE i.id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id = '${blId}');
  `)) as InvoiceState[]
}

function provisionalEffects(blId: string): number {
  return Number(localPsql(`
    SELECT count(*) FROM public.import_pending_effects
    WHERE entity_id = '${blId}' AND effect_kind = 'provisional_charges';
  `))
}

/** Importar datas (containerDatesImport.ts:113-130): mesmo payload, com o estado visto na prévia. */
function importContainerDates(blId: string, rows: Array<{ container: string; discharge: string; return: string | null }>): void {
  const current = new Map(containersOf(blId).map((container) => [container.container_number, container]))
  const payload = rows.map((row) => ({
    container_number: row.container,
    discharge_date: row.discharge,
    return_date: row.return,
    expected_discharge_date: current.get(row.container)?.discharge_date ?? null,
    expected_return_date: current.get(row.container)?.return_date ?? null,
  }))
  asOperator(`
    SELECT public.apply_container_dates_atomic(gen_random_uuid(), '${blId}', ${jsonLiteral(payload)}, '${actorId}'::uuid);
  `)
}

/** Importar CE Mercante por planilha (ceMercanteImport.ts:197-208). */
function importCeSheet(manifestoNumero: string, rows: Array<{ blId: string; ce: string }>) {
  return JSON.parse(asOperator(`
    SELECT public.apply_ce_mercante_rows_atomic(
      ${jsonLiteral(rows.map((row, index) => ({ row: index + 2, bl_id: row.blId, ce: row.ce })))},
      '${actorId}'::uuid, 'bls', '${manifestoNumero}', ${voyageId}
    );
  `)) as { ok: boolean; errors?: unknown }
}

function contactEmails(customerId: number): string[] {
  return JSON.parse(localPsql(`
    SELECT COALESCE(jsonb_agg(email_normalized ORDER BY email_normalized), '[]'::jsonb)
    FROM public.customer_contacts WHERE customer_id = ${customerId};
  `)) as string[]
}

const cleanupSql = `
  SET session_replication_role = replica;
  CREATE TEMP TABLE a202_bls AS SELECT id FROM public.bls WHERE id LIKE 'A202-%';
  CREATE TEMP TABLE a202_customers AS SELECT unnest(ARRAY[${alfa.id}, ${beta.id}]::bigint[]) AS id;
  CREATE TEMP TABLE a202_containers AS
    SELECT id FROM public.bl_containers WHERE bl_id IN (SELECT id FROM a202_bls) OR container_number LIKE 'AZCU202%';
  CREATE TEMP TABLE a202_vehicles AS
    SELECT id FROM public.vehicles WHERE bl_id IN (SELECT id FROM a202_bls) OR voyage_id = ${voyageId};
  CREATE TEMP TABLE a202_invoices AS
    SELECT id FROM public.invoices
    WHERE bl_id IN (SELECT id FROM a202_bls)
       OR customer_id IN (SELECT id FROM a202_customers)
       OR voyage_id = ${voyageId}
       OR id IN (SELECT invoice_id FROM public.invoice_bls WHERE bl_id IN (SELECT id FROM a202_bls));
  CREATE TEMP TABLE a202_demurrage AS
    SELECT id FROM public.demurrage_invoices
    WHERE bl_id IN (SELECT id FROM a202_bls) OR customer_id IN (SELECT id FROM a202_customers);
  CREATE TEMP TABLE a202_receivables AS
    SELECT id FROM public.bl_receivables
    WHERE bl_id IN (SELECT id FROM a202_bls) OR customer_id IN (SELECT id FROM a202_customers);
  CREATE TEMP TABLE a202_batches AS
    SELECT id FROM public.import_batches WHERE voyage_id = ${voyageId} OR uploaded_by = '${actorId}';
  CREATE TEMP TABLE a202_calcs AS SELECT id FROM public.charge_calculations WHERE bl_id IN (SELECT id FROM a202_bls);
  CREATE TEMP TABLE a202_contacts AS SELECT id FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM a202_customers);
  CREATE TEMP TABLE a202_accounts AS SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM a202_customers);
  CREATE TEMP TABLE a202_effects AS
    SELECT id FROM public.import_pending_effects
    WHERE entity_id IN (SELECT id FROM a202_bls) OR entity_id = '${voyageId}' OR created_by = '${actorId}';
  CREATE TEMP TABLE a202_alerts AS
    SELECT id FROM public.alerts
    WHERE message LIKE '%A202-%' OR message LIKE '%A202 %' OR entity_id LIKE 'A202-%'
       OR (entity_type = 'customer' AND entity_id IN (SELECT id::text FROM a202_customers))
       OR (entity_type = 'voyage' AND entity_id = '${voyageId}');
  CREATE TEMP TABLE a202_alert_items AS
    SELECT id FROM public.alert_items
    WHERE alert_id IN (SELECT id FROM a202_alerts)
       OR message LIKE '%A202-%' OR message LIKE '%A202 %'
       OR metadata::text LIKE '%A202-%' OR metadata::text LIKE '%A202 %'
       OR metadata->>'customer_id' IN (SELECT id::text FROM a202_customers)
       OR metadata->>'voyage_id' = '${voyageId}';

  DELETE FROM public.internal_notifications
  WHERE alert_item_id IN (SELECT id FROM a202_alert_items)
     OR alert_id IN (SELECT id FROM a202_alerts)
     OR recipient_id = '${actorId}';
  DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM a202_alert_items);
  DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM a202_alert_items);
  DELETE FROM public.alert_notification_failures
  WHERE alert_item_id IN (SELECT id FROM a202_alert_items) OR alert_id IN (SELECT id FROM a202_alerts);
  DELETE FROM public.alert_items WHERE id IN (SELECT id FROM a202_alert_items);
  DELETE FROM public.alerts WHERE id IN (SELECT id FROM a202_alerts);

  DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM a202_effects);
  DELETE FROM public.import_pending_effects WHERE id IN (SELECT id FROM a202_effects);

  DELETE FROM public.portal_notifications
  WHERE bl_id IN (SELECT id FROM a202_bls) OR customer_id IN (SELECT id FROM a202_customers);
  DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN (SELECT id FROM a202_invoices);
  DELETE FROM public.ledger_settlements
  WHERE invoice_id IN (SELECT id FROM a202_invoices) OR receivable_id IN (SELECT id FROM a202_receivables);
  DELETE FROM public.invoice_customer_changes
  WHERE bl_id IN (SELECT id FROM a202_bls)
     OR new_invoice_id IN (SELECT id FROM a202_invoices)
     OR original_customer_id IN (SELECT id FROM a202_customers)
     OR target_customer_id IN (SELECT id FROM a202_customers);
  DELETE FROM public.invoice_lifecycle_events
  WHERE invoice_id IN (SELECT id FROM a202_invoices)
     OR related_invoice_id IN (SELECT id FROM a202_invoices)
     OR receivable_id IN (SELECT id FROM a202_receivables);
  DELETE FROM public.invoice_receivable_links
  WHERE invoice_id IN (SELECT id FROM a202_invoices)
     OR bl_id IN (SELECT id FROM a202_bls)
     OR receivable_id IN (SELECT id FROM a202_receivables);
  DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM a202_invoices) OR bl_id IN (SELECT id FROM a202_bls);
  DELETE FROM public.invoice_bls WHERE invoice_id IN (SELECT id FROM a202_invoices) OR bl_id IN (SELECT id FROM a202_bls);
  DELETE FROM public.invoices WHERE id IN (SELECT id FROM a202_invoices);
  DELETE FROM public.bl_receivables WHERE id IN (SELECT id FROM a202_receivables);
  DELETE FROM public.invoice_basis_pending_changes WHERE bl_id IN (SELECT id FROM a202_bls);
  DELETE FROM public.demurrage_invoice_items
  WHERE invoice_id IN (SELECT id FROM a202_demurrage) OR container_id IN (SELECT id FROM a202_containers);
  DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (SELECT id FROM a202_demurrage);
  DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM a202_demurrage);
  DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id IN (SELECT id FROM a202_demurrage);
  DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (SELECT id FROM a202_demurrage);
  DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (SELECT id FROM a202_demurrage);
  DELETE FROM public.demurrage_invoices WHERE id IN (SELECT id FROM a202_demurrage);
  DELETE FROM public.charge_calculations WHERE id IN (SELECT id FROM a202_calcs);
  DELETE FROM public.billing_run_logs WHERE bl_id IN (SELECT id FROM a202_bls) OR manifest_id IN (SELECT id FROM a202_batches);
  DELETE FROM public.billing_runs WHERE manifest_id IN (SELECT id FROM a202_batches);
  DELETE FROM public.customer_reconciliation_queue
  WHERE bl_id IN (SELECT id FROM a202_bls)
     OR customer_id IN (SELECT id FROM a202_customers)
     OR manifest_id IN (SELECT id FROM a202_batches);
  DELETE FROM public.baplie_reconciliation_resolutions WHERE bl_container_id IN (SELECT id FROM a202_containers);
  DELETE FROM public.vehicles WHERE id IN (SELECT id FROM a202_vehicles);
  DELETE FROM public.bl_containers WHERE id IN (SELECT id FROM a202_containers);
  DELETE FROM public.bl_freight_lines WHERE bl_id IN (SELECT id FROM a202_bls);
  DELETE FROM public.bls WHERE id IN (SELECT id FROM a202_bls);
  DELETE FROM public.import_errors WHERE batch_id IN (SELECT id FROM a202_batches);
  DELETE FROM public.import_batches WHERE id IN (SELECT id FROM a202_batches);
  DELETE FROM public.manifestos_mercante WHERE voyage_id = ${voyageId} OR numero LIKE 'A202-%';
  DELETE FROM public.voyage_route_ce_master WHERE voyage_id = ${voyageId};
  DELETE FROM public.voyage_documental_pending WHERE voyage_id = ${voyageId};
  DELETE FROM public.voyage_documental_state WHERE voyage_id = ${voyageId};
  DELETE FROM public.pricing_rule_versions
  WHERE charge_table_id = ${chargeTableId}
     OR charge_item_id IN (${chargeItemBlId}, ${chargeItemContainerId})
     OR customer_id IN (SELECT id FROM a202_customers);
  DELETE FROM public.charge_table_items WHERE id IN (${chargeItemBlId}, ${chargeItemContainerId});
  DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
  DELETE FROM public.voyages WHERE id = ${voyageId};
  DELETE FROM public.vessels WHERE id = ${vesselId};
  DELETE FROM public.carriers WHERE id = ${carrierId};

  DELETE FROM public.portal_provisioning_events
  WHERE customer_id IN (SELECT id FROM a202_customers) OR account_id IN (SELECT id FROM a202_accounts);
  DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM a202_accounts);
  DELETE FROM public.portal_invites WHERE account_id IN (SELECT id FROM a202_accounts);
  DELETE FROM public.customer_portal_sessions
  WHERE account_id IN (SELECT id FROM a202_accounts) OR customer_id IN (SELECT id FROM a202_customers);
  DELETE FROM public.portal_inspection_events WHERE customer_id IN (SELECT id FROM a202_customers);
  DELETE FROM public.portal_rate_limits WHERE customer_id IN (SELECT id FROM a202_customers);
  DELETE FROM public.customer_portal_accounts WHERE id IN (SELECT id FROM a202_accounts);
  DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM a202_contacts);
  DELETE FROM public.customer_contact_preferences WHERE contact_id IN (SELECT id FROM a202_contacts);
  DELETE FROM public.customer_contact_change_events WHERE customer_id IN (SELECT id FROM a202_customers);
  DELETE FROM public.customer_contacts WHERE id IN (SELECT id FROM a202_contacts);
  DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (SELECT id FROM a202_customers);
  DELETE FROM public.customers WHERE id IN (SELECT id FROM a202_customers);

  DELETE FROM public.audit_logs
  WHERE changed_by = '${actorId}'
     OR entity_id LIKE 'A202-%'
     OR (entity_type IN ('customers', 'customer') AND entity_id IN (SELECT id::text FROM a202_customers))
     OR (entity_type IN ('voyages', 'voyage') AND entity_id = '${voyageId}')
     OR (entity_type = 'vessels' AND entity_id = '${vesselId}')
     OR (entity_type = 'carriers' AND entity_id = '${carrierId}')
     OR (entity_type = 'charge_tables' AND entity_id = '${chargeTableId}')
     OR (entity_type = 'charge_table_items' AND entity_id IN ('${chargeItemBlId}', '${chargeItemContainerId}'))
     OR (entity_type = 'customer_contacts' AND entity_id IN (SELECT id::text FROM a202_contacts))
     OR (entity_type = 'bl_containers' AND (entity_id IN (SELECT id::text FROM a202_containers) OR old_value LIKE '%A202-%' OR new_value LIKE '%A202-%'))
     OR (entity_type = 'vehicles' AND entity_id IN (SELECT id::text FROM a202_vehicles))
     OR (entity_type = 'import_batches' AND entity_id IN (SELECT id::text FROM a202_batches))
     OR (entity_type IN ('invoices', 'invoice') AND entity_id IN (SELECT id::text FROM a202_invoices))
     OR (entity_type IN ('demurrage_invoices', 'demurrage_invoice') AND entity_id IN (SELECT id::text FROM a202_demurrage))
     OR (entity_type = 'bl_receivables' AND entity_id IN (SELECT id::text FROM a202_receivables))
     OR (entity_type = 'charge_calculations' AND entity_id IN (SELECT id::text FROM a202_calcs));
  DELETE FROM public.user_profiles WHERE id = '${actorId}';
  DELETE FROM auth.users WHERE id = '${actorId}';
  SET session_replication_role = origin;
`

function cleanup(): void {
  localPsql(cleanupSql)
}

describeLocal('M02/M14 — reimportação de B/L de container', () => {
  beforeAll(() => {
    cleanup()
    localPsql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'a202-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'A202 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${alfa.id}, '${alfa.cnpj}', '${alfa.name}'),
        (${beta.id}, '${beta.cnpj}', '${beta.name}');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A202 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, '${vesselName}', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status, ata)
      VALUES (${voyageId}, ${vesselId}, '${voyageNumber}', 'active', TIMESTAMPTZ '${voyageAta} 12:00:00-03');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${chargeTableId}, 'Tabela A202 container', '${pod}', CURRENT_DATE - 30, true, 'container');
      INSERT INTO public.charge_table_items (
        id, charge_table_id, name, applies_to, value_brl, unit_value_brl,
        application_basis, category, cargo_profile, currency, applies_to_soc
      ) VALUES
        (${chargeItemBlId}, ${chargeTableId}, 'B/L Fee A202', 'bl', 600, 600, 'bl', 'base', 'any', 'BRL', true),
        (${chargeItemContainerId}, ${chargeTableId}, 'ISPS A202', 'container', 50, 50, 'container_distinct_voyage', 'base', 'any', 'BRL', true);
      -- Desde a 083/084 o CE só emite com Liberação vigente e contato com e-mail.
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary) VALUES
        (${alfa.id}, 'Financeiro A202 Alfa', '${alfa.email}', 'financeiro', true),
        (${beta.id}, 'Financeiro A202 Beta', '${beta.email}', 'financeiro', true);
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at) VALUES
        (${alfa.id}, 'Fixture A202: gate aberto para o CE', '${actorId}', now() + interval '1 day'),
        (${beta.id}, 'Fixture A202: gate aberto para o CE', '${actorId}', now() + interval '1 day');
    `)
  })

  afterAll(cleanup)

  // --- 1. Reimportação idêntica ------------------------------------------------
  let identical: { before: ContainerState[]; after: ContainerState[] } | null = null

  it('cenário 1: B/L com datas importadas e local de desova é reimportado com o mesmo arquivo', async () => {
    const blId = 'A202-IDEM'
    const document = blDocument(blId, { containers: ['AZCU2020011', 'AZCU2020012'] })
    const first = await importBls([document], 'a202-idem.xlsx')
    expect(first.error).toBeNull()
    // A descarga é só a informada: a ATA da Viagem não a preenche (ADR 0078,
    // item 19; migration 178).
    expect(containersOf(blId).map((container) => container.discharge_date)).toEqual([null, null])

    importContainerDates(blId, [
      { container: 'AZCU2020011', discharge: '2026-09-01', return: '2026-09-20' },
      { container: 'AZCU2020012', discharge: '2026-09-01', return: null },
    ])
    const target = containersOf(blId)[0]
    asOperator(`UPDATE public.bl_containers SET unpacking_location = 'A202 ARMAZEM 7' WHERE id = ${target.id};`)
    const before = containersOf(blId)
    expect(before).toMatchObject([
      { container_number: 'AZCU2020011', discharge_date: '2026-09-01', return_date: '2026-09-20', demurrage_status: 'returned', unpacking_location: 'A202 ARMAZEM 7' },
      { container_number: 'AZCU2020012', discharge_date: '2026-09-01', return_date: null, demurrage_status: 'within_free_time', unpacking_location: null },
    ])

    const reimport = await importBls(
      [document, blDocument('A202-NOVO1', { containers: ['AZCU2020019'] })],
      'a202-idem-reimportado.xlsx',
    )
    const row = previewRow(reimport, blId)
    expect(row.status).toBe('unchanged')
    expect(row.diffs).toEqual([])
    // Sem impacto na prévia, a linha inalterada segue com override ligado e é enviada.
    expect(row.payload?.override_billing).toBe(true)
    expect(reimport.error).toBeNull()
    expect(blState('A202-NOVO1')?.id).toBe('A202-NOVO1')
    identical = { before, after: containersOf(blId) }
  })

  it('esperado: reimportação "Sem mudança" preserva id, descarga, devolução, status de Demurrage e local de desova dos containers [BL-02, DAT-03, ORDCT-01, ORDCT-03, VEI-04, BL-20] — regra: ADR 0017 decisão 2 (docs/adr/0017-bl-fonte-ingestao-correcao-autoridade-compartilhada.md:41-43, nada sobrescrito em silêncio), RASTREABILIDADE.md:282 (preserva campos omitidos) e ADR 0071 item 10 (docs/adr/0071-ce-mercante-como-trava-de-exclusao.md:83-86)', () => {
    expect(identical?.after).toEqual(identical?.before)
  })

  // --- 2. B/L com Invoice de Demurrage ------------------------------------------
  let demurrage: { error: string | null; newBl: BlState | null; containerBefore: number; containerAfter: number[]; itemContainer: number | null } | null = null

  it('cenário 2: B/L com Invoice de Demurrage emitida é reimportado sem mudança junto com um B/L novo', async () => {
    const blId = 'A202-DEM'
    const document = blDocument(blId, { containers: ['AZCU2020021'] })
    expect((await importBls([document], 'a202-dem.xlsx')).error).toBeNull()
    importContainerDates(blId, [{ container: 'AZCU2020021', discharge: voyageAta, return: '2026-10-05' }])
    // ROE manual do B/L (fixture): a emissão não depende da referência cambial do dia.
    localPsql(`UPDATE public.bls SET demurrage_roe = 5.5, demurrage_roe_manual = true WHERE id = '${blId}';`)
    const [container] = containersOf(blId)
    const issued = JSON.parse(asOperator(`
      SELECT public.create_demurrage_invoice_authoritative('A202-DEM-1', '${blId}', ${alfa.id}, ARRAY[${container.id}]::bigint[]);
    `)) as unknown
    expect(issued).toBeTruthy()
    expect(localPsql(`
      SELECT string_agg(d.status || ':' || i.container_id, ',')
      FROM public.demurrage_invoices AS d JOIN public.demurrage_invoice_items AS i ON i.invoice_id = d.id
      WHERE d.bl_id = '${blId}';
    `)).toBe(`issued:${container.id}`)

    const reimport = await importBls(
      [document, blDocument('A202-NOVO2', { containers: ['AZCU2020029'] })],
      'a202-dem-reimportado.xlsx',
    )
    const row = previewRow(reimport, blId)
    // A prévia não antecipa o bloqueio: a linha sai "Sem mudança" e é enviada.
    expect(row.status).toBe('unchanged')
    expect(row.blockedReasons).toEqual([])
    expect(previewRow(reimport, 'A202-NOVO2').status).toBe('new')
    demurrage = {
      error: reimport.error,
      newBl: blState('A202-NOVO2'),
      containerBefore: container.id,
      containerAfter: containersOf(blId).map((current) => current.id),
      itemContainer: Number(localPsql(`
        SELECT i.container_id FROM public.demurrage_invoice_items AS i
        JOIN public.demurrage_invoices AS d ON d.id = i.invoice_id WHERE d.bl_id = '${blId}';
      `)) || null,
    }
    expect(demurrage.containerAfter).toHaveLength(1)
    // Enquanto o defeito existir, a recusa do lote só pode vir da FK da Invoice de Demurrage.
    // Outra causa (permissão, SQL, ponte) deixa este cenário vermelho em vez de satisfazer o
    // it.fails abaixo pelo motivo errado; depois da correção o lote é aceito e isto continua valendo.
    expect(demurrage.error ?? 'lote aceito').toMatch(/^lote aceito$|demurrage_invoice_items_container_id_fkey/)
  })

  it('esperado: o lote é aceito, o B/L novo entra e o container com Demurrage continua o mesmo [BL-04, ORDCT-02, DAT-03, BL-05] — regra: ADR 0071 itens 3 e 10 (docs/adr/0071-ce-mercante-como-trava-de-exclusao.md:56-58 e 83-86: a invoice de Demurrage trava o container; a reimportação só tira o que o arquivo não traz) e manifesto-edi.md:280 (reimportar conclui o restante)', () => {
    expect(demurrage?.error).toBeNull()
    expect(demurrage?.newBl?.id).toBe('A202-NOVO2')
    expect(demurrage?.containerAfter).toEqual([demurrage?.containerBefore])
    expect(demurrage?.itemContainer).toBe(demurrage?.containerBefore)
  })

  // --- 3. B/L faturado reimportado sem mudança ----------------------------------
  let invoiced: {
    before: BlState | null
    after: BlState | null
    invoicesBefore: InvoiceState[]
    invoicesAfter: InvoiceState[]
    calculationErrors: string[]
    effectsBefore: number
    effectsAfter: number
  } | null = null

  it('cenário 3: B/L com fatura emitida pelo CE é reimportado com o mesmo arquivo junto com um B/L novo', async () => {
    const blId = 'A202-FAT'
    const document = blDocument(blId, { containers: ['AZCU2020031'] })
    expect((await importBls([document], 'a202-fat.xlsx')).error).toBeNull()
    expect(importCeSheet('A202MAN000003', [{ blId, ce: '202001000000003' }])).toMatchObject({ ok: true })
    const before = blState(blId)
    const invoicesBefore = invoicesOf(blId)
    expect(before).toMatchObject({ ce_mercante: '202001000000003', financial_status: 'invoiced', billing_hold_reason: null })
    expect(invoicesBefore).toMatchObject([{ status: 'issued' }])
    const effectsBefore = provisionalEffects(blId)

    const reimport = await importBls(
      [document, blDocument('A202-NOVO3', { containers: ['AZCU2020039'] })],
      'a202-fat-reimportado.xlsx',
    )
    const row = previewRow(reimport, blId)
    expect(row.status).toBe('unchanged')
    expect(row.requiresBillingOverride).toBe(false)
    expect(reimport.error).toBeNull()
    expect(blState('A202-NOVO3')?.id).toBe('A202-NOVO3')
    invoiced = {
      before,
      after: blState(blId),
      invoicesBefore,
      invoicesAfter: invoicesOf(blId),
      calculationErrors: (reimport.result?.calculationErrors ?? [])
        .filter((failure) => failure.blNumber === blId)
        .map((failure) => failure.message),
      effectsBefore,
      effectsAfter: provisionalEffects(blId),
    }
    // Só o erro conhecido do B/L faturado pode aparecer; outro erro de cálculo deixa o cenário vermelho.
    expect(invoiced.calculationErrors.filter((message) => !message.includes('recalculo bloqueado'))).toEqual([])
  })

  it('esperado: reimportação idêntica de B/L faturado não o devolve à Revisão nem acende a trava "Carga … após faturamento" (charge_status e fatura seguem os mesmos) [ORDCE-06] — regra: ADR 0077 decisão 2 (docs/adr/0077-fatura-emitida-nao-muda-de-valor.md:22-26: só há efeito se o valor ou o Cliente mudar) e manifesto-edi.md:346 (reimportação idêntica não reemite nem alerta)', () => {
    expect(invoiced?.after).toEqual(invoiced?.before)
    expect(invoiced?.invoicesAfter).toEqual(invoiced?.invoicesBefore)
  })

  it('esperado: a reimportação idêntica de B/L faturado não devolve "recálculo bloqueado. Cancele e reemita" nem enfileira provisional_charges [BL-V01, ORDCT-13, ORDCE-11] — regra: ADR 0077 decisão 2 (docs/adr/0077-fatura-emitida-nao-muda-de-valor.md:17-21: não há cancelar e reemitir; o sistema trata a fatura) e taxas-locais.md:134 (B/L faturado não é recalculado)', () => {
    expect(invoiced?.calculationErrors).toEqual([])
    expect(invoiced?.effectsAfter).toBe(invoiced?.effectsBefore)
  })

  // --- 4. Container compartilhado com irmão faturado ----------------------------
  let sibling: { error: string | null; correctedShipper: string | null; containerBefore: number[]; containerAfter: number[] } | null = null

  it('cenário 4: B/L que divide container com irmão faturado é reimportado sem mudança junto com a correção de outro B/L', async () => {
    const shared = 'AZCU2020041'
    const invoicedSibling = 'A202-IRMAO-K'
    const unchangedSibling = 'A202-IRMAO-L'
    const corrected = 'A202-CORR'
    const documents = [
      blDocument(invoicedSibling, { containers: [shared] }),
      blDocument(unchangedSibling, { containers: [shared] }),
      blDocument(corrected, { containers: ['AZCU2020049'] }),
    ]
    expect((await importBls(documents, 'a202-irmaos.xlsx')).error).toBeNull()
    expect(importCeSheet('A202MAN000004', [{ blId: invoicedSibling, ce: '202001000000004' }])).toMatchObject({ ok: true })
    expect(blState(invoicedSibling)?.financial_status).toBe('invoiced')
    expect(blState(unchangedSibling)?.financial_status).not.toBe('invoiced')
    const containerBefore = containersOf(unchangedSibling).map((container) => container.id)

    const reimport = await importBls(
      [documents[1], blDocument(corrected, { containers: ['AZCU2020049'], shipper: 'A202 SHIPPER CORRIGIDO LTDA' })],
      'a202-irmaos-reimportado.xlsx',
    )
    expect(previewRow(reimport, unchangedSibling).status).toBe('unchanged')
    expect(previewRow(reimport, corrected).status).toBe('updated')
    sibling = {
      error: reimport.error,
      correctedShipper: blState(corrected)?.shipper ?? null,
      containerBefore,
      containerAfter: containersOf(unchangedSibling).map((container) => container.id),
    }
    expect(sibling.containerAfter).toHaveLength(1)
    // Enquanto o defeito existir, a recusa só pode vir da guarda de container compartilhado
    // faturado; outra causa deixa este cenário vermelho. Depois da correção o lote é aceito.
    expect(sibling.error ?? 'lote aceito').toMatch(/^lote aceito$|Container compartilhado AZCU2020041 já está faturado em outra B\/L/)
  })

  it('esperado: o B/L irmão sem mudança não derruba o lote e a correção do outro B/L é gravada [BL-04, BL-05] — regra: ADR 0077 decisão 2 (docs/adr/0077-fatura-emitida-nao-muda-de-valor.md:22-26: sem mudança de valor nada acontece) e ADR 0071 item 10 (docs/adr/0071-ce-mercante-como-trava-de-exclusao.md:83-86: reimportação só tira o que o arquivo não traz)', () => {
    expect(sibling?.error).toBeNull()
    expect(sibling?.correctedShipper).toBe('A202 SHIPPER CORRIGIDO LTDA')
    expect(sibling?.containerAfter).toEqual(sibling?.containerBefore)
  })

  // --- 5. Troca de Consignatário aceita: e-mail do novo consignatário -----------
  const newConsigneeEmail = 'a202-novo-consignatario@example.test'
  let swap: { alfaEmails: string[]; betaEmails: string[] } | null = null

  it('cenário 5: B/L reimportado com CNPJ e e-mail de outro Cliente, com aceite da troca', async () => {
    const blId = 'A202-TROCA'
    expect((await importBls([blDocument(blId, { containers: ['AZCU2020051'] })], 'a202-troca.xlsx')).error).toBeNull()
    expect(blState(blId)?.customer_id).toBe(alfa.id)

    const reimport = await importBls(
      [blDocument(blId, { containers: ['AZCU2020051'], consignee: beta, consigneeEmail: newConsigneeEmail })],
      'a202-troca-reimportado.xlsx',
      { confirmCustomerChange: true },
    )
    const row = previewRow(reimport, blId)
    expect(row.requiresCustomerConfirmation).toBe(true)
    expect(row.customerChange).toMatchObject({ fromCustomerId: alfa.id, toCustomerId: beta.id, blockedReasons: [] })
    expect(reimport.error).toBeNull()
    expect(reimport.result?.refusedCustomerRelinks).toEqual([])
    expect(blState(blId)?.customer_id).toBe(beta.id)
    swap = { alfaEmails: contactEmails(alfa.id), betaEmails: contactEmails(beta.id) }
    // O novo dono recebe o endereço do documento (E-mail Capturado do B/L).
    expect(swap.betaEmails).toContain(newConsigneeEmail)
  })

  it('esperado: o e-mail do novo consignatário não vira contato do Cliente antigo [BL-03] — regra: CONTEXT.md:1023-1031 (Troca de Consignatário: o B/L muda de dono e o vínculo é refeito) e CONTEXT.md:1062-1064 (E-mail Capturado do B/L entra no cadastro do Cliente do B/L)', () => {
    expect(swap?.alfaEmails).not.toContain(newConsigneeEmail)
  })

  // --- Checagens novas da Etapa 2 (ADR 0078, item 16) ---------------------------
  function vehiclesOf(blId: string): Array<{ chassis: string; model: string; container_id: number }> {
    return JSON.parse(localPsql(`
      SELECT COALESCE(jsonb_agg(jsonb_build_object('chassis', chassis, 'model', model, 'container_id', container_id) ORDER BY chassis), '[]'::jsonb)
      FROM public.vehicles WHERE bl_id = '${blId}';
    `)) as Array<{ chassis: string; model: string; container_id: number }>
  }

  function vehicleAlerts(blId: string): number {
    return Number(localPsql(`
      SELECT count(*) FROM public.alert_items AS i JOIN public.alerts AS a ON a.id = i.alert_id
      WHERE i.item_type = 'bl_vehicles_changed_on_reimport' AND a.entity_id = '${blId}';
    `))
  }

  it('arquivo sem aba VIN preserva os veículos gravados', async () => {
    const blId = 'A202-VIN1'
    const withVin = blDocument(blId, {
      containers: ['AZCU2020061'],
      vehicles: [{ chassis: 'A202VIN0000000001', container: 'AZCU2020061' }, { chassis: 'A202VIN0000000002', container: 'AZCU2020061' }],
    })
    expect((await importBls([withVin], 'a202-vin1.xlsx')).error).toBeNull()
    const before = vehiclesOf(blId)
    expect(before.map((vehicle) => vehicle.chassis)).toEqual(['A202VIN0000000001', 'A202VIN0000000002'])

    const withoutVin = await importBls([blDocument(blId, { containers: ['AZCU2020061'] })], 'a202-vin1-sem-aba.xlsx')
    expect(withoutVin.error).toBeNull()
    expect(previewRow(withoutVin, blId).requiresVehicleConfirmation).toBe(false)
    expect(vehiclesOf(blId)).toEqual(before)
  })

  it('aba VIN com chassis diferentes exige confirmação e abre o alerta do B/L', async () => {
    const blId = 'A202-VIN2'
    const first = blDocument(blId, {
      containers: ['AZCU2020071'],
      vehicles: [{ chassis: 'A202VIN0000000011', container: 'AZCU2020071' }, { chassis: 'A202VIN0000000012', container: 'AZCU2020071' }],
    })
    expect((await importBls([first], 'a202-vin2.xlsx')).error).toBeNull()
    const before = vehiclesOf(blId)
    const changed = blDocument(blId, {
      containers: ['AZCU2020071'],
      vehicles: [
        { chassis: 'A202VIN0000000011', container: 'AZCU2020071', model: 'A202 MODELO NOVO' },
        { chassis: 'A202VIN0000000013', container: 'AZCU2020071' },
      ],
    })

    // A lista de chassis é variável de faturamento: com taxas calculadas, a linha
    // também pede a confirmação de faturamento; aqui ela vem marcada e só a dos
    // veículos varia.
    const unconfirmed = await importBls([changed], 'a202-vin2-sem-confirmacao.xlsx', { overrideBilling: true })
    expect(unconfirmed.error).toBeNull()
    expect(previewRow(unconfirmed, blId).vehicleChanges).toEqual({
      added: ['A202VIN0000000013'], removed: ['A202VIN0000000012'], changed: ['A202VIN0000000011'],
    })
    expect(unconfirmed.result?.vehicleChangesPending).toEqual([blId])
    expect(vehiclesOf(blId)).toEqual(before)
    expect(vehicleAlerts(blId)).toBe(0)

    const confirmed = await importBls([changed], 'a202-vin2-confirmado.xlsx', { overrideBilling: true, confirmVehicleChanges: true })
    expect(confirmed.error).toBeNull()
    expect(confirmed.result?.vehicleChanges).toEqual([{
      blNumber: blId, inserted: ['A202VIN0000000013'], updated: ['A202VIN0000000011'], removed: ['A202VIN0000000012'],
    }])
    expect(vehiclesOf(blId).map((vehicle) => [vehicle.chassis, vehicle.model])).toEqual([
      ['A202VIN0000000011', 'A202 MODELO NOVO'],
      ['A202VIN0000000013', 'A202 MODELO'],
    ])
    expect(vehicleAlerts(blId)).toBe(1)
  })

  it('chassi que já está em outro B/L recusa só a linha', async () => {
    const blId = 'A202-VIN3'
    const result = await importBls([blDocument(blId, {
      containers: ['AZCU2020081'],
      vehicles: [{ chassis: 'A202VIN0000000001', container: 'AZCU2020081' }, { chassis: 'A202VIN0000000021', container: 'AZCU2020081' }],
    })], 'a202-vin3.xlsx')
    expect(result.error).toBeNull()
    expect(result.result?.vehiclesDiscarded).toEqual([{ blNumber: blId, chassis: 'A202VIN0000000001', reason: 'Chassi ja esta no B/L A202-VIN1' }])
    expect(vehiclesOf(blId).map((vehicle) => vehicle.chassis)).toEqual(['A202VIN0000000021'])
  })

  it('container ausente do arquivo sai e é informado no resultado; o que continua mantém o id', async () => {
    const blId = 'A202-REM'
    expect((await importBls([blDocument(blId, { containers: ['AZCU2020091', 'AZCU2020092'] })], 'a202-rem.xlsx')).error).toBeNull()
    const kept = containersOf(blId).find((container) => container.container_number === 'AZCU2020091')
    const reimport = await importBls([blDocument(blId, { containers: ['AZCU2020091'] })], 'a202-rem-reimportado.xlsx', { overrideBilling: true })
    expect(reimport.error).toBeNull()
    expect(previewRow(reimport, blId).removedContainers).toEqual(['AZCU2020092'])
    expect(reimport.result?.containerChanges).toEqual([{ blNumber: blId, inserted: [], updated: [], removed: ['AZCU2020092'] }])
    expect(containersOf(blId).map((container) => container.id)).toEqual([kept?.id])
  })

  // --- Etapa 5 (ADR 0078, item 11): container FCL entre Clientes diferentes ----
  it('container FCL de outro Cliente na Viagem é recusado na prévia e no servidor', async () => {
    expect((await importBls([blDocument('A202-FCL1', { containers: ['AZCU2020101'] })], 'a202-fcl1.xlsx')).error).toBeNull()

    const other = await importBls(
      [blDocument('A202-FCL2', { containers: ['AZCU2020101'], consignee: beta })],
      'a202-fcl2.xlsx',
    )
    const row = previewRow(other, 'A202-FCL2')
    expect(row.status).toBe('blocked')
    expect(row.blockedReasons).toContain(`Container AZCU2020101 já está no B/L A202-FCL1 (${alfa.name}): container FCL não é dividido entre Clientes diferentes.`)
    expect(blState('A202-FCL2')).toBeNull()

    // O servidor recusa o mesmo estado mesmo sem a prévia.
    const direct = tryAsOperator(`
      SELECT public.import_bl_freight_transactional(
        ${jsonLiteral([{ ...buildBlFreightPayload(blDocument('A202-FCL2', { containers: ['AZCU2020101'], consignee: beta }), voyageId), customer_id: beta.id }])}, '${actorId}'::uuid
      );
    `)
    expect(direct.error?.code).toBe('P0008')
    expect(direct.error?.message).toContain('container FCL nao e dividido entre Clientes diferentes')
    expect(blState('A202-FCL2')).toBeNull()

    // Mesmo Cliente divide o container normalmente.
    expect((await importBls([blDocument('A202-FCL3', { containers: ['AZCU2020101'] })], 'a202-fcl3.xlsx')).error).toBeNull()
    expect(blState('A202-FCL3')?.customer_id).toBe(alfa.id)
  })
})
