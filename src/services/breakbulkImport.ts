import { isBlFinanciallyLocked } from '../lib/chargeStatus'
import { extractNcmCodes } from '../lib/ncm'
import { findMatchedCustomer, loadCustomerMaps, resolveCustomerLink, type CustomerMaps } from './customerReconciliation'
import { calculateLocalChargesBatch } from './charges/chargeOperationsService'
import { supabase } from './supabase'
import type { Json } from '../types/database'
import {
  buildBreakbulkSummaryDescription,
  hasBlockingRowErrors,
  parseBreakbulkManifestBuffer,
  parseBreakbulkManifestFile,
  type BreakbulkNumberFormat,
  type ParseBreakbulkOptions,
  type BreakbulkReimportCheck as ParsedBreakbulkReimportCheck,
  type ParsedBreakbulkManifest,
} from './breakbulkManifestParser'

export {
  hasBlockingRowErrors,
  parseBreakbulkManifestBuffer,
  parseBreakbulkManifestFile,
  type BreakbulkNumberFormat,
  type ParseBreakbulkOptions,
  type ParsedBreakbulkManifest,
}

/**
 * Conferência da prévia com os B/Ls gravados (`checkBreakbulkReimport`). O
 * parser nunca a preenche; `cancelled` é declarado aqui, onde é lido.
 */
export type BreakbulkReimportCheck = ParsedBreakbulkReimportCheck & {
  /** B/L cancelado é somente leitura: a linha é ignorada com aviso e não vai à gravação. */
  cancelled?: string[]
}

/**
 * Manifesto aceito pela importação. A cubagem pode faltar (B/L avulso sem
 * CBM): ausente vai como null e a gravação mantém a cubagem gravada (a RPC
 * só preserva NULL; zero apagaria).
 */
export type BreakbulkImportManifest = Omit<ParsedBreakbulkManifest, 'bls'> & {
  bls: Array<Omit<ParsedBreakbulkManifest['bls'][number], 'bb_cbm'> & { bb_cbm: number | null }>
}

/** Aviso da linha de B/L cancelado, o mesmo da planilha de CE Mercante (ADR 0078, item 7). */
export function describeCancelledBl(blId: string) {
  return `B/L ${blId} cancelado: a linha é ignorada. B/L cancelado é somente leitura; reative-o pela ficha para corrigir.`
}

export async function importBreakbulkManifest({
  filename,
  voyageId,
  manifest,
  uploadedBy,
  allowRowErrors = false,
  acceptCustomerChanges = false,
  overrideBilling = false,
}: {
  filename: string
  voyageId: number
  manifest: BreakbulkImportManifest
  uploadedBy: string
  /** Permite persistir as linhas válidas quando o preview tem erros de linha. */
  allowRowErrors?: boolean
  /** Troca de Consignatário aceita na prévia: o CNPJ do arquivo passa a valer. */
  acceptCustomerChanges?: boolean
  /** Confirmação de faturamento: a rota de B/L faturado também é corrigida. */
  overrideBilling?: boolean
}): Promise<BreakbulkImportResult> {
  // Só divergência bloqueante impede a importação. Um aviso de conferência
  // (separador decimal ambíguo, por exemplo) viaja para o lote como registro,
  // mas não exige override do operador.
  if (hasBlockingRowErrors(manifest.rowErrors) && !allowRowErrors) {
    throw new Error(formatBreakbulkRowErrors(manifest.rowErrors.filter((rowError) => (rowError.severity ?? 'error') === 'error')))
  }

  const { error: voyageError } = await supabase.from('voyages').select('id').eq('id', voyageId).single()
  if (voyageError) throw voyageError

  // Estado no banco agora, não o da prévia: decide o que é B/L novo e o que
  // está cancelado. B/L cancelado é somente leitura e derrubaria o lote
  // inteiro na gravação; a linha é ignorada com aviso, como na planilha de CE.
  const state = await fetchBreakbulkBlState(manifest.bls.map((bl) => bl.bl_id))
  const cancelledIgnored = [...new Set(manifest.bls.map((bl) => bl.bl_id).filter((id) => state.cancelled.has(id)))]
  const importable: BreakbulkImportManifest = { ...manifest, bls: manifest.bls.filter((bl) => !state.cancelled.has(bl.bl_id)) }
  if (manifest.bls.length && !importable.bls.length) {
    throw new Error(`Nada a importar: ${cancelledIgnored.map(describeCancelledBl).join(' ')}`)
  }

  const customerMaps = await loadCustomerMaps()
  const rowByBl = new Map(manifest.bls.map((bl) => [bl.bl_id, bl.rowNumber]))
  const importErrors = [
    ...manifest.rowErrors,
    ...cancelledIgnored.map((blId) => cancelledRowWarning(blId, rowByBl.get(blId) ?? 0)),
  ]

  const blRows = buildBreakbulkRows(importable, voyageId, customerMaps, state.existing).map((row) => ({
    ...row,
    ...(acceptCustomerChanges ? { relink_customer: true } : {}),
    ...(overrideBilling ? { override_billing: true } : {}),
  }))

  const itemRows = importable.bls.flatMap((bl) =>
    bl.items.map((item) => ({
      bl_id: bl.bl_id,
      item_description: item.item_description,
      package_qty: item.package_qty,
      package_unit: item.package_unit,
      gross_weight_kg: item.gross_weight_kg,
      cbm: item.cbm,
      marks: item.marks,
    })),
  )

  const errorRows = importErrors.map((rowError) => ({
    row_number: rowError.row > 0 ? rowError.row : null,
    error_type: 'parser',
    error_message: rowError.message,
    raw_data: rowError.raw as Json,
  }))

  const { data, error } = await supabase.rpc('import_breakbulk_manifest_transactional', {
    p_filename: filename,
    p_voyage_id: voyageId,
    p_uploaded_by: uploadedBy,
    p_total_bls: importable.bls.length,
    p_bls: blRows,
    p_items: itemRows,
    p_errors: errorRows,
  })
  if (error) throw error
  const raw = (data ?? {}) as RawBreakbulkImportResult
  const batchId = Number(raw.batch_id)
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error('A importacao BB nao retornou um lote valido.')
  }

  // A RPC BB nao calcula taxas locais (a de container calcula); sem isto o B/L
  // ficava `not_calculated` para sempre. B/L novo calcula; B/L alterado
  // recalcula, porque peso e rota mudam a base (a RPC de cálculo recusa B/L
  // faturado, cuja fatura segue a ADR 0077 pela própria importação). Falha de
  // calculo nao desfaz o import: o B/L segue para a fila de revisao.
  const inserted = raw.inserted_bl_ids ?? blRows.map((bl) => bl.id)
  const updated = raw.updated_bl_ids ?? []
  const calculationErrors: Array<{ blId: string; message: string }> = []
  const unchanged = raw.unchanged_bl_ids ?? []
  for (const [ids, recalculate] of [[[...inserted, ...unchanged], false], [updated, true]] as const) {
    if (!ids.length) continue
    const outcome = await calculateLocalChargesBatch([...ids], { actorId: uploadedBy, recalculate }).catch(() => null)
    calculationErrors.push(...(outcome?.errors ?? []).filter((failure) => !isLockedFailure(failure.message)))
  }

  return {
    batchId,
    inserted,
    updated,
    unchanged,
    ceIgnored: raw.ce_ignored ?? [],
    cancelledIgnored,
    customerChangesIgnored: (raw.customer_changes_ignored ?? []).map((entry) => entry.bl_id),
    refusedCustomerRelinks: (raw.customer_relinks ?? [])
      .filter((entry) => !entry.applied && !entry.unchanged)
      .map((entry) => ({ blId: entry.bl_id, blockers: entry.blockers ?? [] })),
    billingLocked: raw.billing_locked ?? [],
    codPodKept: (raw.cod_pod_kept ?? []).map((entry) => entry.bl_id),
    calculationErrors,
  }
}

type RawBreakbulkImportResult = {
  batch_id?: number
  inserted_bl_ids?: string[]
  updated_bl_ids?: string[]
  unchanged_bl_ids?: string[]
  ce_ignored?: string[]
  customer_changes_ignored?: Array<{ bl_id: string }>
  customer_relinks?: Array<{ bl_id: string; applied?: boolean; unchanged?: boolean; blockers?: string[] }>
  billing_locked?: Array<{ bl_id: string; fields: string[] }>
  cod_pod_kept?: Array<{ bl_id: string }>
}

/** O que a importação de carga solta gravou e o que deixou de fora, por B/L. */
export type BreakbulkImportResult = {
  batchId: number
  inserted: string[]
  updated: string[]
  unchanged: string[]
  /** B/Ls cujo arquivo trazia CE: o Manifesto BB não grava CE (ADR 0078, item 1). */
  ceIgnored: string[]
  /** B/Ls cancelados no momento da gravação: a linha foi ignorada (somente leitura). */
  cancelledIgnored: string[]
  /** CNPJ de outro Cliente sem aceite: o Cliente vinculado ficou. */
  customerChangesIgnored: string[]
  refusedCustomerRelinks: Array<{ blId: string; blockers: string[] }>
  /** Rota de B/L faturado mantida por falta da confirmação de faturamento. */
  billingLocked: Array<{ bl_id: string; fields: string[] }>
  /** B/L em COD: o POD do arquivo não foi aplicado (ADR 0078, item 15). */
  codPodKept: string[]
  calculationErrors: Array<{ blId: string; message: string }>
}

/** Pendências por B/L do resultado, em frases para a tela ou o aviso. */
export function describeBreakbulkPending(result: BreakbulkImportResult): string[] {
  return [
    result.ceIgnored.length
      ? `CE Mercante ignorado em ${result.ceIgnored.join(', ')}: informe pela planilha de CE Mercante ou pela ficha do B/L.`
      : null,
    ...(result.cancelledIgnored ?? []).map(describeCancelledBl),
    result.customerChangesIgnored.length
      ? `Cliente mantido em ${result.customerChangesIgnored.join(', ')}: a troca de Cliente não foi confirmada.`
      : null,
    ...result.refusedCustomerRelinks.map((entry) => `Troca de Cliente recusada em ${entry.blId}: ${entry.blockers.join(' ')}`),
    ...result.billingLocked.map((entry) => `${entry.bl_id}: ${entry.fields.join(' e ').toUpperCase()} mantido (B/L faturado, sem confirmação).`),
    result.codPodKept.length ? `POD mantido em ${result.codPodKept.join(', ')} (B/L em COD).` : null,
    ...result.calculationErrors.map((entry) => `${entry.blId} ficou sem cálculo automático: ${entry.message}`),
  ].filter((line): line is string => Boolean(line))
}

function isLockedFailure(message: string) {
  return /faturad|invoiced|paid/i.test(message)
}

/**
 * Objeto que a RPC recebe por B/L. Compartilhado com a prévia para que a
 * comparação com o B/L gravado use exatamente o Cliente que será enviado.
 */
function buildBreakbulkRows(
  manifest: BreakbulkImportManifest,
  voyageId: number,
  customerMaps: CustomerMaps,
  /** B/Ls que já existem: o texto montado do layout resumido não vai para eles */
  existingIds: ReadonlySet<string> = new Set(),
) {
  return manifest.bls.map((bl) => {
    const customerMatch = findMatchedCustomer(
      {
        cnpjCpf: bl.cnpj_cpf,
        consignee: bl.consignee,
      },
      customerMaps,
    )
    const link = resolveCustomerLink(customerMatch)
    const reviewReasons = new Set<string>()

    if (!link.customerId) {
      reviewReasons.add('Cliente nao vinculado automaticamente')
    }

    return {
        id: bl.bl_id,
        voyage_id: voyageId,
        // cargo_mode is derived by the database from containers, breakbulk
        // items and the BB totals. Importers must never race that trigger.
        // O CE Mercante nunca vai: o Manifesto BB não grava CE (ADR 0078, item 1).
        bb_machine_qty: bl.bb_machine_qty,
        bb_packages_qty: bl.bb_packages_qty,
        bb_packages_total: bl.bb_packages_total,
        bb_weight_ton: bl.bb_weight_ton,
        shipper: bl.shipper,
        consignee: customerMatch?.matchType === 'document' ? customerMatch.customer.name : bl.consignee,
        notify_party: bl.notify_party,
        customer_id: link.customerId,
        suggested_customer_id: link.suggestedCustomerId,
        manifest_customer_cnpj_cpf: bl.cnpj_cpf,
        manifest_customer_name: bl.consignee,
        manifest_customer_email: null,
        customer_reconciliation_status: link.status,
        customer_reconciliation_notes: link.notes,
        billing_hold_reason:
          link.status === 'matched_document' ? null : 'Aguardando reconciliacao de cliente antes do faturamento.',
        pol: bl.pol,
        pod: bl.pod,
        // O layout resumido não tem coluna de descrição: "Maquinas: 1 | Packages: 2"
        // é montado das quantidades e só serve ao B/L novo. No B/L existente vai
        // null e a gravação mantém a descrição do documento (COALESCE da 174),
        // sem marcar o B/L como corrigido a cada reimportação idêntica. (A
        // descrição montada só lê as quantidades; a cubagem não entra nela.)
        cargo_description:
          manifest.layout === 'summary'
            ? existingIds.has(bl.bl_id) ? null : buildBreakbulkSummaryDescription({ ...bl, bb_cbm: bl.bb_cbm ?? 0 })
            : bl.items.map((item) => item.item_description).filter(Boolean).slice(0, 3).join(' | ') || null,
        // A descrição acima descarta as linhas "NCM NUMBER" e guarda só os 3
        // primeiros itens; o NCM tem de sair do texto completo dos itens, senão
        // nunca chega ao B/L (migration 358).
        ncm_codes: [
          ...new Set(
            extractNcmCodes(bl.items.map((item) => item.item_description).filter(Boolean).join('\n')),
          ),
        ],
        // Cubagem da carga solta. `total_cbm` e do conteiner desde a 064.
        bb_cbm: bl.bb_cbm,
        review_status: reviewReasons.size > 0 ? ('pending_review' as const) : ('ok' as const),
        financial_status: 'pending' as const,
        notes: reviewReasons.size > 0 ? `Pendencias de importacao: ${Array.from(reviewReasons).join(', ')}` : null,
    }
  })
}

type ExistingBreakbulkBl = {
  id: string
  voyage_id: number | null
  customer_id: number | null
  pol: string | null
  pod: string | null
  financial_status: string | null
  cancelled_at: string | null
  customer: { name: string | null } | null
  voyage: { voyage_number: string | null; vessel: { name: string | null } | null } | null
}

const CHECK_CHUNK = 200

/**
 * Confere o arquivo contra os B/Ls já gravados, para a prévia mostrar o que a
 * RPC fará: recusar B/L de outra Viagem, pedir aceite da troca de Cliente e a
 * confirmação de faturamento da rota. A RPC repete as mesmas regras; esta
 * leitura só antecipa a decisão do operador. B/L cancelado é somente leitura e
 * derrubaria o lote inteiro na gravação: vai para `cancelled`, e a prévia
 * ignora a linha com aviso (`withBreakbulkReimportCheck`).
 */
export async function checkBreakbulkReimport(voyageId: number, manifest: BreakbulkImportManifest): Promise<BreakbulkReimportCheck> {
  const ids = [...new Set(manifest.bls.map((bl) => bl.bl_id))]
  const found: ExistingBreakbulkBl[] = []
  for (let i = 0; i < ids.length; i += CHECK_CHUNK) {
    const { data, error } = await supabase
      .from('bls')
      .select('id, voyage_id, customer_id, pol, pod, financial_status, cancelled_at, customer:customers!bls_customer_id_fkey(name), voyage:voyages(voyage_number, vessel:vessels(name))')
      .in('id', ids.slice(i, i + CHECK_CHUNK))
    if (error) throw error
    found.push(...((data ?? []) as unknown as ExistingBreakbulkBl[]))
  }
  const cancelled = found.filter((bl) => bl.cancelled_at).map((bl) => bl.id)
  const existing = found.filter((bl) => !bl.cancelled_at)
  const empty: BreakbulkReimportCheck = { existing: [], otherVoyage: [], customerChanges: [], billedRouteChanges: [], codPodKept: [], cancelled }
  if (!existing.length) return empty

  const existingIds = existing.map((bl) => bl.id)
  const { data: codRows, error: codError } = await supabase
    .from('bl_transshipments')
    .select('bl_id, omission:voyage_omissions(reverted_at)')
    .eq('disposition', 'cod')
    .in('bl_id', existingIds)
  if (codError) throw codError
  const cod = new Set(
    ((codRows ?? []) as unknown as Array<{ bl_id: string; omission: { reverted_at: string | null } | null }>)
      .filter((row) => !row.omission?.reverted_at)
      .map((row) => row.bl_id),
  )

  const customerMaps = await loadCustomerMaps()
  const rows = new Map(buildBreakbulkRows(manifest, voyageId, customerMaps).map((row) => [row.id, row]))
  const customerNames = new Map<number, string>()
  for (const record of customerMaps.customersByDocument.values()) customerNames.set(record.id, record.name)

  const check: BreakbulkReimportCheck = { ...empty, existing: existingIds }
  const routeChanges: Array<{ blId: string; fields: string[]; billedByStatus: boolean }> = []
  for (const bl of existing) {
    const row = rows.get(bl.id)
    if (!row) continue
    if (bl.voyage_id !== voyageId) {
      const label = [bl.voyage?.vessel?.name, bl.voyage?.voyage_number].filter(Boolean).join(' / ')
      check.otherVoyage.push({ blId: bl.id, voyageLabel: label || `#${bl.voyage_id}` })
      continue
    }
    if (bl.customer_id != null && row.customer_id != null && row.customer_id !== bl.customer_id) {
      check.customerChanges.push({
        blId: bl.id,
        currentCustomer: bl.customer?.name ?? `Cliente #${bl.customer_id}`,
        fileCustomer: customerNames.get(row.customer_id) ?? row.consignee,
      })
    }
    const podChanges = Boolean(row.pod && row.pod !== bl.pod)
    if (podChanges && cod.has(bl.id)) check.codPodKept.push(bl.id)
    const fields = [
      row.pol && row.pol !== bl.pol ? 'POL' : null,
      podChanges && !cod.has(bl.id) ? 'POD' : null,
    ].filter((field): field is string => Boolean(field))
    if (fields.length) routeChanges.push({ blId: bl.id, fields, billedByStatus: isBlFinanciallyLocked(bl.financial_status) })
  }
  // Faturado, como na gravação (migration 174): status faturado/pago ou fatura
  // viva, inclusive rascunho. Só consulta quem muda de rota sem o status.
  const withLiveInvoice = await fetchBlsWithLiveInvoice(routeChanges.filter((change) => !change.billedByStatus).map((change) => change.blId))
  for (const change of routeChanges) {
    if (change.billedByStatus || withLiveInvoice.has(change.blId)) check.billedRouteChanges.push({ blId: change.blId, fields: change.fields })
  }
  return check
}

/** Situação de taxas locais que a gravação trata como fatura viva (`_live_local_invoice_ids_for_bl`). */
const LIVE_INVOICE_STATUSES = new Set(['draft', 'issued', 'overdue', 'partially_paid', 'paid'])
const LOCAL_INVOICE_TYPES = new Set(['individual', 'consolidated'])

/**
 * B/Ls com fatura de taxas locais viva, ligada por `invoice_bls`.
 * ponytail: a gravação também conta a fatura ligada pelo razão
 * (`invoice_receivable_links`) e descarta a que está em Troca de Consignatário;
 * aqui não. Divergir só faz a prévia não pedir a confirmação, e a rota volta em
 * `billing_locked` no resultado (nada cai). Upgrade: uma RPC de leitura que
 * devolva `_live_local_invoice_ids_for_bl` por B/L.
 */
async function fetchBlsWithLiveInvoice(blIds: string[]) {
  const live = new Set<string>()
  for (let i = 0; i < blIds.length; i += CHECK_CHUNK) {
    const { data, error } = await supabase
      .from('invoice_bls')
      .select('bl_id, invoice:invoices(status, invoice_type)')
      .in('bl_id', blIds.slice(i, i + CHECK_CHUNK))
    if (error) throw error
    type InvoiceRef = { status: string | null; invoice_type: string | null }
    for (const row of (data ?? []) as unknown as Array<{ bl_id: string; invoice: InvoiceRef | InvoiceRef[] | null }>) {
      const invoices = Array.isArray(row.invoice) ? row.invoice : row.invoice ? [row.invoice] : []
      if (invoices.some((invoice) => LOCAL_INVOICE_TYPES.has(invoice.invoice_type ?? '') && LIVE_INVOICE_STATUSES.has(invoice.status ?? 'issued'))) {
        live.add(row.bl_id)
      }
    }
  }
  return live
}

/** O que existe e o que está cancelado no banco, no momento da gravação. */
async function fetchBreakbulkBlState(blIds: string[]) {
  const ids = [...new Set(blIds)]
  const existing = new Set<string>()
  const cancelled = new Set<string>()
  for (let i = 0; i < ids.length; i += CHECK_CHUNK) {
    const { data, error } = await supabase.from('bls').select('id, cancelled_at').in('id', ids.slice(i, i + CHECK_CHUNK))
    if (error) throw error
    // `cancelled_at` (migration 089) ainda não está nos tipos gerados.
    for (const row of (data ?? []) as unknown as Array<{ id: string; cancelled_at?: string | null }>) {
      if (row.cancelled_at) cancelled.add(row.id)
      else existing.add(row.id)
    }
  }
  return { existing, cancelled }
}

function cancelledRowWarning(blId: string, row: number): ParsedBreakbulkManifest['rowErrors'][number] {
  return { row, message: describeCancelledBl(blId), raw: { bl_id: blId }, severity: 'warning' }
}

/** Mensagem de bloqueio do B/L de outra Viagem, a mesma regra da RPC. */
export function describeOtherVoyage(entry: BreakbulkReimportCheck['otherVoyage'][number]) {
  return `O B/L ${entry.blId} já está na Viagem ${entry.voyageLabel}. A importação é recusada: confira a Viagem de destino ou corrija a Viagem do B/L pela ficha.`
}

/**
 * Prévia com a conferência contra o banco: B/L de outra Viagem vira erro de
 * linha (bloqueia, como na RPC); B/L cancelado sai do manifesto com aviso (a
 * linha é ignorada, como na planilha de CE Mercante); o restante segue em
 * `reimport`.
 */
export async function withBreakbulkReimportCheck(
  manifest: ParsedBreakbulkManifest,
  voyageId: number,
): Promise<ParsedBreakbulkManifest> {
  if (!manifest.bls.length) return manifest
  const reimport = await checkBreakbulkReimport(voyageId, manifest)
  const rowByBl = new Map(manifest.bls.map((bl) => [bl.bl_id, bl.rowNumber]))
  const cancelled = new Set(reimport.cancelled ?? [])
  return {
    ...manifest,
    bls: manifest.bls.filter((bl) => !cancelled.has(bl.bl_id)),
    reimport,
    rowErrors: [
      ...manifest.rowErrors,
      ...[...cancelled].map((blId) => cancelledRowWarning(blId, rowByBl.get(blId) ?? 0)),
      ...reimport.otherVoyage.map((entry) => ({
        row: rowByBl.get(entry.blId) ?? 0,
        message: describeOtherVoyage(entry),
        raw: { bl_id: entry.blId },
      })),
    ],
  }
}

function formatBreakbulkRowErrors(rowErrors: ParsedBreakbulkManifest['rowErrors']): string {
  const shown = rowErrors.slice(0, 20).map((error) => `Linha ${error.row}: ${error.message}`)
  const hidden = rowErrors.length - shown.length
  if (hidden > 0) shown.push(`... e mais ${hidden} linha${hidden === 1 ? '' : 's'} com divergências.`)
  return shown.join('\n')
}
