import { canonicalizeDocument } from '../lib/cnpj'
import { extractNcmCodes } from '../lib/ncm'
import { normalizeIsoContainerNumber } from '../lib/containerNumber'
import { canonicalizeVesselName } from '../lib/vesselAlias'
import { extractConsigneeShortName } from '../lib/consigneeName'
import type { BL, BLContainer, BlFreightLine, Vehicle } from '../types/database'
import { extractTaxId, type ParsedBLDocument } from './blParser'
import { findMatchedCustomer, loadCustomerMaps, resolveCustomerLink, type CustomerMaps } from './customerReconciliation'
import { normalizePortCode } from './portCode'
import { supabase } from './supabase'

export type BlFreightImportDiff = {
  field: string
  /** operator-facing name of the field; the raw column name means nothing outside the code */
  label: string
  from: string | number | null
  to: string | number | null
  /** true when this change touches a billing variable and needs an explicit override */
  billingImpact: boolean
}

/** Invoice attached to the B/L whose payer follows (or cannot follow) the consignee change. */
export type BlCustomerChangeInvoice = {
  invoiceNumber: string
  kind: 'local' | 'demurrage'
  status: string | null
  totalBrl: number | null
  /** null when the invoice follows the B/L; the reason when it cannot */
  blockedReason: string | null
}

/**
 * Troca de consignatario detectada na reimportacao. O B/L muda de dono, e o que
 * ja foi faturado precisa acompanhar: mesmo valor, outro cliente.
 */
export type BlCustomerChange = {
  fromCustomerId: number | null
  fromCustomerName: string | null
  fromDocument: string | null
  toCustomerId: number | null
  toCustomerName: string | null
  toDocument: string | null
  /** true when the incoming CNPJ has no customer registered yet */
  targetMissing: boolean
  invoices: BlCustomerChangeInvoice[]
  /** reasons that stop the relink entirely; the rest of the B/L still imports */
  blockedReasons: string[]
  messages: string[]
}

export type BlFreightImportRow = {
  blNumber: string
  status: 'new' | 'updated' | 'unchanged' | 'blocked'
  existing: boolean
  voyageId: number | null
  /** Numero da viagem declarado no B/L (nao o id interno), para exibicao no preview. */
  voyageNumber: string | null
  pol: string | null
  pod: string | null
  /** Laden on Board normalizado para alimentar ATD do POL no pos-commit; nao vai no payload documental. */
  ladenOnBoard: string | null
  consigneeDocumentMatches: boolean | null
  /** hard blocks that prevent importing the row at all (wrong file, missing voyage) */
  blockedReasons: string[]
  /** human-readable changes that affect billing; shown so the operator can decide to override */
  billingImpacts: string[]
  /** true when the row changes a billing variable on an already-billed B/L */
  requiresBillingOverride: boolean
  /** set when the re-import moves the B/L to another consignee/CNPJ */
  customerChange: BlCustomerChange | null
  /** true when the operator has to confirm the customer change before it applies */
  requiresCustomerConfirmation: boolean
  diffs: BlFreightImportDiff[]
  payload: BlFreightRpcPayload | null
}

export type BlFreightImportPreview = {
  rows: BlFreightImportRow[]
  summary: {
    total: number
    newCount: number
    updatedCount: number
    unchangedCount: number
    blockedCount: number
    billingOverrideCount: number
    customerChangeCount: number
  }
}

export type BlFreightRpcPayload = {
  id: string
  voyage_id: number | null
  customer_id: number | null
  suggested_customer_id: number | null
  customer_reconciliation_status: BL['customer_reconciliation_status']
  customer_reconciliation_notes: string | null
  billing_hold_reason: string | null
  shipper: string | null
  consignee: string | null
  notify_party: string | null
  consignee_block: string | null
  shipper_block: string | null
  notify_block: string | null
  notify2_block: string | null
  notify_cnpj_cpf: string | null
  cargo_description: string | null
  place_of_receipt: string | null
  movement_from: string | null
  movement_to: string | null
  issue_place: string | null
  total_packages: number | null
  packages_unit: string | null
  consignee_phone: string | null
  pol: string | null
  pod: string | null
  place_of_delivery: string | null
  total_weight_kg: number | null
  total_cbm: number | null
  payment_type: 'PREPAID' | 'COLLECT' | null
  bl_emission_date: string | null
  /** Documental Laden on Board; persisted independently from the emission date. */
  laden_on_board: string | null
  manifest_customer_cnpj_cpf: string | null
  manifest_customer_name: string | null
  manifest_customer_email: string | null
  /** true when this B/L touches a billing variable (drives audit labeling in the RPC) */
  billing_impact: boolean
  /** authorizes applying billing-relevant physical changes (containers/vehicles/carga-solta weight) to a billed B/L */
  override_billing: boolean
  /** authorizes moving the B/L (and its invoices) to the consignee the file now declares */
  relink_customer: boolean
  /** NCM declarado no documento; vazio nunca apaga o cadastro manual (migration 358) */
  ncm_codes: string[]
  freight_lines: Array<{
    seq: number
    description: string
    category: string
    mercante_code: string | null
    currency: string | null
    amount: number | null
    payment: 'PREPAID' | 'COLLECT' | null
  }>
  containers: Array<{
    container_number: string
    seal_number: string | null
    type: string | null
    tare_weight_kg: number | null
    gross_weight_kg: number | null
    cbm: number | null
    is_oog: boolean
    is_imo: boolean
    imo_class: string | null
    un_number: string | null
  }>
  vehicles: Array<{
    chassis: string
    container_number: string | null
    brand: string
    model: string
    weight_kg: number
    cbm: number
  }>
}

type ExistingBl = Pick<
  BL,
  | 'id'
  | 'voyage_id'
  | 'cargo_mode'
  | 'shipper'
  | 'consignee'
  | 'notify_party'
  | 'pol'
  | 'pod'
  | 'place_of_delivery'
  | 'total_weight_kg'
  | 'total_cbm'
  | 'payment_type'
  | 'bl_emission_date'
  | 'manifest_customer_cnpj_cpf'
  | 'manifest_customer_name'
> & {
  cargo_description?: string | null
  place_of_receipt?: string | null
  movement_from?: string | null
  movement_to?: string | null
  issue_place?: string | null
  total_packages?: number | null
  packages_unit?: string | null
  consignee_phone?: string | null
  customer_id?: number | null
  shipper_block?: string | null
  consignee_block?: string | null
  notify_block?: string | null
  notify2_block?: string | null
  notify_cnpj_cpf?: string | null
  manifest_customer_email?: string | null
  ncm_codes?: string[] | null
  vehicles?: Pick<Vehicle, 'chassis'>[] | null
  bl_containers?: Pick<BLContainer, 'container_number' | 'seal_number' | 'type' | 'tare_weight_kg' | 'gross_weight_kg' | 'cbm' | 'is_imo' | 'is_oog' | 'imo_class' | 'un_number'>[] | null
  bl_freight_lines?: Pick<BlFreightLine, 'seq' | 'description' | 'category' | 'mercante_code' | 'currency' | 'amount' | 'payment'>[] | null
}

export type BlFreightSelectedVoyage = {
  id: number
  vesselName?: string | null
  voyageNumber?: string | null
}

/** Billing variables recomputed per B/L; see chargeTableService application bases. */
type BillingImpact = {
  messages: string[]
  container: boolean
  /** chassis apagados/alterados em B/L faturado: a unidade cobrada e o veiculo */
  vehicles: boolean
  weight: boolean
  cnpj: boolean
  /** POD drives the charge table, and voyage/cargo mode drive where the charges live */
  route: boolean
}

/** Cliente vigente do B/L, para o preview dizer de quem para quem a carga muda. */
export type BlCustomerSnapshot = {
  id: number
  name: string | null
  document: string | null
}

/** Fatura viva do B/L, usada para dizer o que acompanha a troca de cliente. */
export type BlInvoiceSnapshot = {
  blId: string
  invoiceNumber: string
  kind: 'local' | 'demurrage'
  status: string | null
  totalBrl: number | null
  totalPaidBrl: number | null
  /** quantos B/Ls a fatura cobre; > 1 significa fatura consolidada */
  blCount: number
}

/**
 * Recebivel do razao do B/L. Ele nao aparece como fatura, mas `relink_bl_customer`
 * bloqueia a troca por causa dele: sem recebivel no preview, o operador confirmava
 * uma troca que o servidor recusa.
 */
export type BlReceivableSnapshot = {
  blId: string
  status: string | null
  settledAmountBrl: number | null
}

export type BuildBlFreightPreviewArgs = {
  documents: ParsedBLDocument[]
  existingBls?: ExistingBl[]
  billingLockedBlIds?: Set<string>
  /** container numbers that already belong to a different B/L (container_distinct_voyage billing) */
  sharedContainerNumbers?: Set<string>
  selectedVoyage?: BlFreightSelectedVoyage | null
  onlyBlId?: string | null
  /** customers indexed by document/name so the import links each B/L to its payer */
  customerMaps?: CustomerMaps | null
  /** current payer of each existing B/L, indexed by customer id */
  customersById?: Map<number, BlCustomerSnapshot> | null
  /** live invoices of each existing B/L, indexed by B/L id */
  invoicesByBl?: Map<string, BlInvoiceSnapshot[]> | null
  /** ledger receivables of each existing B/L, indexed by B/L id */
  receivablesByBl?: Map<string, BlReceivableSnapshot[]> | null
}

export async function previewBlFreightImport(args: {
  documents: ParsedBLDocument[]
  voyageId: number
  onlyBlId?: string | null
}): Promise<BlFreightImportPreview> {
  const blNumbers = args.documents.map((doc) => doc.blNumber).filter(Boolean)
  const [existingBls, customerMaps] = await Promise.all([fetchExistingBls(blNumbers), loadCustomerMaps()])
  const existingIds = new Set(existingBls.map((bl) => bl.id))
  const billingLockedBlIds = await fetchBillingLockedBlIds([...existingIds])
  const containerNumbers = args.documents.flatMap((doc) => doc.containers.map((container) => container.containerNumber))
  // Also check the containers a billed B/L already has: replacing a shared container
  // with a unique one (same count) still changes container_distinct_voyage billing.
  const existingContainerNumbers = existingBls.flatMap((bl) => (bl.bl_containers ?? []).map((container) => container.container_number))
  const sharedContainerNumbers = await fetchSharedContainerNumbers(blNumbers, [...containerNumbers, ...existingContainerNumbers])
  const selectedVoyage = await fetchSelectedVoyage(args.voyageId)
  if (!selectedVoyage) throw new Error('Viagem selecionada nao encontrada.')

  // Troca de consignatario: o preview precisa dizer de quem para quem o B/L vai
  // e o que acontece com a fatura ja emitida, antes de o operador confirmar.
  // Os clientes envolvidos sao os dois lados: o dono atual do B/L e o cliente
  // que o documento passa a declarar (resolvido pelo mesmo casamento do payload).
  const targetCustomerIds = args.documents.map((doc) => {
    const payload = buildBlFreightPayload(doc, selectedVoyage.id)
    return findMatchedCustomer(
      { cnpjCpf: payload.manifest_customer_cnpj_cpf, consignee: payload.consignee },
      customerMaps,
    )?.customer.id ?? null
  })
  const [customersById, invoicesByBl, receivablesByBl] = await Promise.all([
    fetchCustomerSnapshots([...existingBls.map((bl) => bl.customer_id ?? null), ...targetCustomerIds]),
    fetchBlInvoiceSnapshots([...existingIds]),
    fetchBlReceivableSnapshots([...existingIds]),
  ])

  return buildBlFreightPreview({
    documents: args.documents,
    existingBls,
    billingLockedBlIds,
    sharedContainerNumbers,
    selectedVoyage,
    onlyBlId: args.onlyBlId,
    customerMaps,
    customersById,
    invoicesByBl,
    receivablesByBl,
  })
}

export function buildBlFreightPreview({
  documents,
  existingBls = [],
  billingLockedBlIds = new Set(),
  sharedContainerNumbers = new Set(),
  selectedVoyage = null,
  onlyBlId = null,
  customerMaps = null,
  customersById = null,
  invoicesByBl = null,
  receivablesByBl = null,
}: BuildBlFreightPreviewArgs): BlFreightImportPreview {
  const existingById = new Map(existingBls.map((bl) => [bl.id, bl]))
  const rows = documents.map((doc) => {
    const existing = existingById.get(doc.blNumber) ?? null
    const voyageId = selectedVoyage?.id ?? null
    const payload = voyageId ? buildBlFreightPayload(doc, voyageId) : null
    if (payload && existing) {
      preserveExistingContainerPhysicalAttributes(payload, existing)
    }
    const matchedCustomer = payload && customerMaps
      ? findMatchedCustomer(
        { cnpjCpf: payload.manifest_customer_cnpj_cpf, consignee: payload.consignee },
        customerMaps,
      )
      : null
    if (payload && customerMaps) {
      applyCustomerReconciliation(payload, matchedCustomer)
    }
    const blockedReasons: string[] = []

    if (onlyBlId && doc.blNumber !== onlyBlId) {
      blockedReasons.push(`Arquivo contem B/L ${doc.blNumber}, mas a ficha aberta e ${onlyBlId}.`)
    }
    if (!selectedVoyage) {
      blockedReasons.push('Selecione uma viagem para importar o B/L.')
    } else {
      const mismatchReason = getDeclaredVoyageMismatchReason(doc, selectedVoyage)
      if (mismatchReason) blockedReasons.push(mismatchReason)
    }
    const incompleteVehicles = doc.vehicles.filter((vehicle) => (
      !vehicle.brand?.trim() || !vehicle.model?.trim() || !(vehicle.weightKg && vehicle.weightKg > 0) || !(vehicle.cbm && vehicle.cbm > 0)
    ))
    if (incompleteVehicles.length > 0) {
      blockedReasons.push(`${incompleteVehicles.length} VIN(s) sem marca, modelo, peso e cubagem positivos; revise o veículo antes de importar.`)
    }

    const consigneeDocumentMatches = payload && existing?.manifest_customer_cnpj_cpf
      ? canonicalizeDocument(existing.manifest_customer_cnpj_cpf) === canonicalizeDocument(payload.manifest_customer_cnpj_cpf)
      : null

    const billed = billingLockedBlIds.has(doc.blNumber)
    const impact = existing && billed && payload
      ? computeBillingImpact(existing, payload, sharedContainerNumbers)
      : { messages: [], container: false, vehicles: false, weight: false, cnpj: false, route: false }
    const requiresBillingOverride = impact.messages.length > 0

    // Linha bloqueada nao importa nada (o payload vira null adiante): anunciar a
    // troca de consignatario dela faria o operador confirmar um relink que a
    // confirmacao nem envia.
    const customerChange = existing && payload && !blockedReasons.length
      ? describeCustomerChange(existing, payload, {
        customersById,
        invoices: invoicesByBl?.get(existing.id) ?? [],
        receivables: receivablesByBl?.get(existing.id) ?? [],
        matchedCustomerName: matchedCustomer?.customer.name ?? null,
      })
      : null
    const requiresCustomerConfirmation = Boolean(customerChange && !customerChange.blockedReasons.length)

    const diffs = existing && payload ? diffExistingBl(existing, payload, impact) : []
    // Only the operator's override decision is pending; a billing impact never nulls the payload.
    if (payload) {
      payload.billing_impact = requiresBillingOverride
      payload.override_billing = !requiresBillingOverride
      payload.relink_customer = false
    }

    const status: BlFreightImportRow['status'] = blockedReasons.length
      ? 'blocked'
      : !existing
        ? 'new'
        : diffs.length
          ? 'updated'
          : 'unchanged'

    return {
      blNumber: doc.blNumber,
      status,
      existing: Boolean(existing),
      voyageId,
      voyageNumber: doc.route.voyage?.trim() || selectedVoyage?.voyageNumber || null,
      pol: payload?.pol ?? normalizePortCode(doc.route.pol),
      pod: payload?.pod ?? normalizePortCode(doc.route.pod),
      ladenOnBoard: normalizeDate(doc.dates.ladenOnBoard),
      consigneeDocumentMatches,
      blockedReasons,
      billingImpacts: impact.messages,
      requiresBillingOverride,
      customerChange,
      requiresCustomerConfirmation,
      diffs,
      payload: blockedReasons.length ? null : payload,
    }
  })

  return {
    rows,
    summary: {
      total: rows.length,
      newCount: rows.filter((row) => row.status === 'new').length,
      updatedCount: rows.filter((row) => row.status === 'updated').length,
      unchangedCount: rows.filter((row) => row.status === 'unchanged').length,
      blockedCount: rows.filter((row) => row.status === 'blocked').length,
      billingOverrideCount: rows.filter((row) => row.requiresBillingOverride).length,
      customerChangeCount: rows.filter((row) => row.requiresCustomerConfirmation).length,
    },
  }
}

/** Troca de consignatario que o servidor recusou, com o motivo que ele devolveu. */
export type RefusedCustomerRelink = {
  blNumber: string
  blockers: string[]
}

export type BlFreightImportResult = {
  /** retorno cru da RPC de importacao */
  result: unknown
  /** trocas de cliente pedidas no preview e recusadas pelo servidor */
  refusedCustomerRelinks: RefusedCustomerRelink[]
}

/**
 * A RPC devolve `customer_relinks` com o resultado de cada troca pedida. Ler isso
 * e o que separa "importado com a fatura junto" de "importado, mas o B/L continua
 * com o cliente antigo" — sem isso a recusa do servidor virava toast de sucesso.
 */
export function readRefusedCustomerRelinks(data: unknown): RefusedCustomerRelink[] {
  const relinks = (data as { customer_relinks?: unknown } | null)?.customer_relinks
  if (!Array.isArray(relinks)) return []
  return relinks.flatMap((entry) => {
    const relink = entry as { bl_id?: unknown; applied?: unknown; blockers?: unknown; unchanged?: unknown }
    if (relink.applied === true || relink.unchanged === true) return []
    const blockers = Array.isArray(relink.blockers) ? relink.blockers.map((blocker) => String(blocker)) : []
    return [{
      blNumber: typeof relink.bl_id === 'string' ? relink.bl_id : '',
      blockers: blockers.length ? blockers : ['Troca de consignatario recusada pelo servidor.'],
    }]
  })
}

export async function confirmBlFreightImport(
  preview: BlFreightImportPreview,
  changedBy: string,
  overrideBilling = false,
  filename = 'importacao-bl.xlsx',
  confirmCustomerChange = false,
): Promise<BlFreightImportResult> {
  const payload = preview.rows.flatMap((row) => {
    if (!row.payload) return []
    // Rows that touch a billing variable only apply the physical change when the operator overrode.
    const base = row.requiresBillingOverride ? { ...row.payload, override_billing: overrideBilling } : row.payload
    // A troca de consignatario move o B/L e a fatura de dono: so acontece com
    // aceite explicito, e nunca quando o preview ja apontou um impedimento.
    if (!row.requiresCustomerConfirmation) return [base]
    return [{ ...base, relink_customer: confirmCustomerChange }]
  })
  if (!payload.length) {
    throw new Error('Nenhum B/L liberado para importar.')
  }

  // Mantém os dados extraídos do B/L para a revisão oferecer como sugestão;
  // o cadastro e a vinculação só ocorrem após confirmação do usuário. Quando
  // o lote tem uma viagem, o wrapper grava B/L + batch + efeito recuperável na
  // mesma transação. O caminho sem viagem continua avulso (ADR 0017).
  const voyageId = payload.find((bl) => bl.voyage_id != null)?.voyage_id ?? null
  const usesBatchContract = voyageId != null
  const { data: rawData, error } = usesBatchContract
    ? await supabase.rpc('import_bl_freight_with_metadata', {
        p_bls: payload,
        p_changed_by: changedBy,
        p_batch: {
          filename,
          voyage_id: voyageId,
          cargo_mode: 'container',
        },
      })
    : await supabase.rpc('import_bl_freight_transactional', {
        p_bls: payload,
        p_changed_by: changedBy,
      })
  if (error) throw error
  const wrapped = rawData as { result?: unknown } | null
  const data = usesBatchContract && wrapped && 'result' in wrapped ? wrapped.result : rawData

  return { result: data, refusedCustomerRelinks: readRefusedCustomerRelinks(data) }
}

export function buildBlFreightPayload(doc: ParsedBLDocument, voyageId: number | null): BlFreightRpcPayload {
  const isImoFromBl = Boolean(doc.cargo.dgClass || doc.cargo.unNumber)
  const containers = doc.containers.flatMap((container) => {
    const containerNumber = normalizeIsoContainerNumber(container.containerNumber)
    if (!containerNumber) return []
    return [{
      container_number: containerNumber,
      seal_number: container.sealNumber,
      type: container.type,
      tare_weight_kg: container.tareKg,
      gross_weight_kg: container.grossWeightKg,
      cbm: container.cbm,
      is_oog: false,
      is_imo: isImoFromBl,
      imo_class: doc.cargo.dgClass,
      un_number: doc.cargo.unNumber,
    }]
  })
  const oceanFreight = doc.freightCharges.find((line) => normalizeFreightCategory(line.description) === 'OCEAN_FREIGHT')

  return {
    id: doc.blNumber,
    voyage_id: voyageId,
    // Resolved from the consignee document/name during preview (see buildBlFreightPreview).
    customer_id: null,
    suggested_customer_id: null,
    customer_reconciliation_status: 'missing_customer',
    customer_reconciliation_notes: 'Cliente nao encontrado na base cadastral.',
    billing_hold_reason: CUSTOMER_RECONCILIATION_HOLD_REASON,
    shipper: doc.parties.shipperBlock || null,
    consignee: doc.parties.consigneeBlock ? extractConsigneeShortName(doc.parties.consigneeBlock) : null,
    notify_party: doc.parties.notifyBlock || null,
    // Blocos estruturados de partes p/ o C5 do EDI não sair degradado em
    // viagem só-B/L (#321). Persistidos por import_bl_freight_transactional (166).
    consignee_block: doc.parties.consigneeBlock || null,
    shipper_block: doc.parties.shipperBlock || null,
    notify_block: doc.parties.notifyBlock || null,
    notify2_block: doc.parties.alsoNotifyBlock || null,
    notify_cnpj_cpf: extractTaxId(doc.parties.notifyBlock) || null,
    cargo_description: doc.cargo.description || null,
    total_packages: doc.cargo.totalPackages,
    packages_unit: doc.cargo.packagesUnit,
    consignee_phone: extractPhone(doc.parties.consigneeBlock),
    pol: normalizePortCode(doc.route.pol),
    pod: normalizePortCode(doc.route.pod),
    place_of_delivery: normalizePortCode(doc.route.delivery),
    place_of_receipt: normalizePortCode(doc.route.receipt),
    movement_from: doc.route.movementFrom?.trim() || null,
    movement_to: doc.route.movementTo?.trim() || null,
    issue_place: doc.dates.issuePlace?.trim() || null,
    total_weight_kg: sumNumbers(containers.map((container) => container.gross_weight_kg)),
    total_cbm: sumNumbers(containers.map((container) => container.cbm)),
    payment_type: oceanFreight?.payment ?? null,
    bl_emission_date: normalizeDate(doc.dates.issueDate || doc.dates.ladenOnBoard),
    laden_on_board: normalizeDate(doc.dates.ladenOnBoard),
    manifest_customer_cnpj_cpf: doc.parties.consigneeTaxId,
    manifest_customer_name: firstLine(doc.parties.consigneeBlock),
    manifest_customer_email: doc.parties.consigneeEmail ?? null,
    billing_impact: false,
    override_billing: true,
    relink_customer: false,
    ncm_codes: [...new Set(extractNcmCodes(doc.cargo.description || ''))],
    freight_lines: doc.freightCharges.map((charge, index) => ({
      seq: index + 1,
      description: charge.description,
      category: normalizeFreightCategory(charge.description),
      mercante_code: null,
      currency: charge.currency,
      amount: charge.amount,
      payment: charge.payment,
    })),
    containers,
    vehicles: doc.vehicles.flatMap((vehicle) => {
      if (!vehicle.brand?.trim() || !vehicle.model?.trim() || !(vehicle.weightKg && vehicle.weightKg > 0) || !(vehicle.cbm && vehicle.cbm > 0)) return []
      return [{
        chassis: vehicle.chassis,
        container_number: normalizeIsoContainerNumber(vehicle.containerNumber),
        brand: vehicle.brand.trim(),
        model: vehicle.model.trim(),
        weight_kg: vehicle.weightKg,
        cbm: vehicle.cbm,
      }]
    }),
  }
}

const CUSTOMER_RECONCILIATION_HOLD_REASON = 'Aguardando reconciliacao de cliente antes do faturamento.'

function applyCustomerReconciliation(
  payload: BlFreightRpcPayload,
  match: ReturnType<typeof findMatchedCustomer>,
) {
  const link = resolveCustomerLink(match)
  payload.customer_id = link.customerId
  payload.suggested_customer_id = link.suggestedCustomerId
  payload.customer_reconciliation_status = link.status
  payload.customer_reconciliation_notes = link.notes
  payload.billing_hold_reason = link.status === 'matched_document' ? null : CUSTOMER_RECONCILIATION_HOLD_REASON
}

function preserveExistingContainerPhysicalAttributes(payload: BlFreightRpcPayload, existing: ExistingBl) {
  const existingByNumber = new Map(
    (existing.bl_containers ?? []).flatMap((container) => {
      const containerNumber = normalizeIsoContainerNumber(container.container_number)
      return containerNumber ? [[containerNumber, container]] : []
    }),
  )

  for (const container of payload.containers) {
    const current = existingByNumber.get(container.container_number)
    if (!current) continue

    container.is_imo = Boolean(current.is_imo)
    container.is_oog = Boolean(current.is_oog)
    container.imo_class = current.imo_class ?? null
    container.un_number = current.un_number ?? null
  }
}

// Billing variables (chargeTableService): container count/TEU, shared containers
// (container_distinct_voyage), IMO/OOG profile, weight for carga_solta, and the
// billed CNPJ. Everything else is freely correctable.
// ponytail: granito cargo is billed through its own weight-based workflow; if it
// starts flowing through this import, add cargo_mode 'granito' to the weight gate.
function computeBillingImpact(
  existing: ExistingBl,
  payload: BlFreightRpcPayload,
  sharedContainerNumbers: Set<string>,
): BillingImpact {
  const messages: string[] = []
  const existingContainers = existing.bl_containers ?? []

  const existingCount = existingContainers.length
  const nextCount = payload.containers.length
  const countChanged = existingCount !== nextCount
  if (countChanged) {
    messages.push(`Quantidade de containers: ${existingCount} -> ${nextCount}`)
  }

  // A shared container matters only when the container set actually changes:
  // adding/removing/swapping a container that is (or was) on another B/L shifts
  // container_distinct_voyage quantities. Check both incoming and existing sides.
  const containerSetChanged = normalizeContainerSet(existingContainers) !== normalizeContainerSet(payload.containers)
  const sharedInvolved = [
    ...payload.containers.map((container) => container.container_number),
    ...existingContainers.map((container) => container.container_number),
  ].filter((number): number is string => Boolean(number) && sharedContainerNumbers.has(number))
  const shared = containerSetChanged ? [...new Set(sharedInvolved)] : []
  if (shared.length) {
    messages.push(`Container(s) compartilhados com outro B/L afetados: ${shared.join(', ')}`)
  }

  const existingImoOog = existingContainers.some((container) => container.is_imo || container.is_oog)
  const nextImoOog = payload.containers.some((container) => container.is_imo || container.is_oog)
  const imoOogChanged = existingImoOog !== nextImoOog
  if (imoOogChanged) {
    messages.push('Perfil IMO/OOG dos containers muda')
  }

  // Veiculo e unidade faturada por si (chassis), e a reimportacao sem anexo de
  // veiculos apaga a lista inteira (migration 205). Sem entrar aqui, o diff saia
  // como mudanca comum e o override vinha ligado por padrao.
  const existingVehicleSet = normalizeVehicleSet(existing.vehicles ?? [])
  const nextVehicleSet = normalizeVehicleSet(payload.vehicles)
  const vehicles = existingVehicleSet !== nextVehicleSet
  if (vehicles) {
    const existingVehicleCount = (existing.vehicles ?? []).length
    messages.push(`Veiculos (chassis): ${existingVehicleCount} -> ${payload.vehicles.length}`)
  }

  const isBreakBulk = existing.cargo_mode === 'carga_solta' || existing.cargo_mode === 'misto'
  const weightChanged = normalizeComparable(existing.total_weight_kg) !== normalizeComparable(payload.total_weight_kg)
  const weight = isBreakBulk && weightChanged
  if (weight) {
    messages.push(`Peso (carga solta, variavel de faturamento): ${existing.total_weight_kg ?? '-'} -> ${payload.total_weight_kg ?? '-'}`)
  }

  const existingDoc = canonicalizeDocument(existing.manifest_customer_cnpj_cpf ?? '')
  const nextDoc = canonicalizeDocument(payload.manifest_customer_cnpj_cpf ?? '')
  const cnpj = Boolean(existingDoc) && Boolean(nextDoc) && existingDoc !== nextDoc
  if (cnpj) {
    messages.push(`CNPJ faturado: ${existing.manifest_customer_cnpj_cpf} -> ${payload.manifest_customer_cnpj_cpf}`)
  }

  // Rota e viagem escolhem a tabela de taxa (POD) e o lugar onde a cobranca vive.
  // Sem passar por aqui elas ficavam prometidas no preview e descartadas na RPC.
  const routeChanges = ROUTE_BILLING_FIELDS.flatMap(({ field, label, read }) => {
    const from = read(existing)
    const to = read(payload)
    if (normalizeComparable(from) === normalizeComparable(to)) return []
    return [{ field, message: `${label}: ${from ?? '-'} -> ${to ?? '-'}` }]
  })
  for (const change of routeChanges) messages.push(change.message)

  return {
    messages,
    container: countChanged || shared.length > 0 || imoOogChanged,
    vehicles,
    weight,
    cnpj,
    route: routeChanges.length > 0,
  }
}

/**
 * Campos que a RPC protege por faturamento inteiro (nao por variavel), e que por
 * isso precisam do mesmo override explicito dos demais impactos.
 */
const ROUTE_BILLING_FIELDS: Array<{
  field: string
  label: string
  read: (source: ExistingBl | BlFreightRpcPayload) => string | number | null
}> = [
  { field: 'voyage_id', label: 'Viagem do B/L', read: (source) => source.voyage_id ?? null },
  { field: 'pol', label: 'POL', read: (source) => source.pol ?? null },
  { field: 'pod', label: 'POD', read: (source) => source.pod ?? null },
]

/**
 * Nome de cada campo do diff na lingua da operacao. O preview e lido por quem
 * confere o B/L, nao por quem escreveu a tabela: `cargo_description` nao diz
 * nada, "Descricao da carga (origem do NCM)" diz.
 */
export const BL_FREIGHT_DIFF_LABELS: Record<string, string> = {
  voyage_id: 'Viagem do B/L',
  shipper: 'Shipper',
  consignee: 'Consignatario',
  notify_party: 'Notify Party',
  shipper_block: 'Shipper (bloco completo)',
  consignee_block: 'Consignatario (bloco completo)',
  notify_block: 'Notify (bloco completo)',
  notify2_block: 'Notify 2 (bloco completo)',
  notify_cnpj_cpf: 'CNPJ/CPF do notify',
  cargo_description: 'Descricao da carga (origem do NCM)',
  total_packages: 'Total de volumes',
  packages_unit: 'Unidade dos volumes',
  consignee_phone: 'Telefone do consignatario',
  pol: 'POL',
  pod: 'POD',
  place_of_delivery: 'Place of Delivery',
  place_of_receipt: 'Place of Receipt',
  movement_from: 'Movement From',
  movement_to: 'Movement To',
  issue_place: 'Local de emissao',
  payment_type: 'Pagamento do frete',
  bl_emission_date: 'Data de emissao',
  manifest_customer_cnpj_cpf: 'CNPJ/CPF do consignatario',
  manifest_customer_name: 'Razao social do consignatario',
  manifest_customer_email: 'E-mail do consignatario',
  ncm_codes: 'NCM',
  total_weight_kg: 'Peso total (kg)',
  total_cbm: 'CBM total',
  containers: 'Containers',
  vehicles: 'Veiculos (chassis)',
  bl_freight_lines: 'Frete e despesas',
}

function diffExistingBl(existing: ExistingBl, payload: BlFreightRpcPayload, impact: BillingImpact): BlFreightImportDiff[] {
  const diffs: BlFreightImportDiff[] = []
  addDiff(diffs, 'voyage_id', existing.voyage_id, payload.voyage_id, impact.route)
  addDiff(diffs, 'shipper', existing.shipper, payload.shipper, false)
  addDiff(diffs, 'consignee', existing.consignee, payload.consignee, false)
  addDiff(diffs, 'notify_party', existing.notify_party, payload.notify_party, false)
  // Blocos completos das partes: alimentam o C5 do EDI e a ficha do B/L, e eram
  // sobrescritos sem aparecer no preview.
  addDiff(diffs, 'shipper_block', existing.shipper_block, payload.shipper_block, false)
  addDiff(diffs, 'consignee_block', existing.consignee_block, payload.consignee_block, false)
  addDiff(diffs, 'notify_block', existing.notify_block, payload.notify_block, false)
  addDiff(diffs, 'notify2_block', existing.notify2_block, payload.notify2_block, false)
  addDiff(diffs, 'notify_cnpj_cpf', existing.notify_cnpj_cpf, payload.notify_cnpj_cpf, false)
  addDiff(diffs, 'cargo_description', existing.cargo_description, payload.cargo_description, false)
  addDiff(diffs, 'total_packages', existing.total_packages, payload.total_packages, false)
  addDiff(diffs, 'packages_unit', existing.packages_unit, payload.packages_unit, false)
  addDiff(diffs, 'consignee_phone', existing.consignee_phone, payload.consignee_phone, false)
  addDiff(diffs, 'pol', existing.pol, payload.pol, impact.route)
  addDiff(diffs, 'pod', existing.pod, payload.pod, impact.route)
  addDiff(diffs, 'place_of_delivery', existing.place_of_delivery, payload.place_of_delivery, false)
  addDiff(diffs, 'place_of_receipt', existing.place_of_receipt, payload.place_of_receipt, false)
  addDiff(diffs, 'movement_from', existing.movement_from, payload.movement_from, false)
  addDiff(diffs, 'movement_to', existing.movement_to, payload.movement_to, false)
  addDiff(diffs, 'issue_place', existing.issue_place, payload.issue_place, false)
  addDiff(diffs, 'payment_type', existing.payment_type, payload.payment_type, false)
  addDiff(diffs, 'bl_emission_date', existing.bl_emission_date, payload.bl_emission_date, false)
  addDiff(diffs, 'manifest_customer_cnpj_cpf', existing.manifest_customer_cnpj_cpf, payload.manifest_customer_cnpj_cpf, impact.cnpj)
  addDiff(diffs, 'manifest_customer_name', existing.manifest_customer_name, payload.manifest_customer_name, false)
  addDiff(diffs, 'manifest_customer_email', existing.manifest_customer_email, payload.manifest_customer_email, false)
  // Documento sem NCM não apaga o cadastro manual (migration 358), então só há
  // diferença a mostrar quando o arquivo declara algum código.
  if (payload.ncm_codes.length) {
    addDiff(diffs, 'ncm_codes', (existing.ncm_codes ?? []).join(', '), payload.ncm_codes.join(', '), false)
  }
  addDiff(diffs, 'total_weight_kg', existing.total_weight_kg, payload.total_weight_kg, impact.weight)
  addDiff(diffs, 'total_cbm', existing.total_cbm, payload.total_cbm, false)

  const existingContainers = normalizeContainerSet(existing.bl_containers ?? [])
  const nextContainers = normalizeContainerSet(payload.containers)
  addDiff(diffs, 'containers', existingContainers, nextContainers, impact.container)

  const existingVehicles = normalizeVehicleSet(existing.vehicles ?? [])
  const nextVehicles = normalizeVehicleSet(payload.vehicles)
  addDiff(diffs, 'vehicles', existingVehicles, nextVehicles, impact.vehicles)

  const existingFreight = normalizeFreightSet(existing.bl_freight_lines ?? [])
  const nextFreight = normalizeFreightSet(payload.freight_lines)
  addDiff(diffs, 'bl_freight_lines', existingFreight, nextFreight, false)

  return diffs
}

function addDiff(
  diffs: BlFreightImportDiff[],
  field: string,
  from: string | number | null | undefined,
  to: string | number | null | undefined,
  billingImpact: boolean,
) {
  const left = normalizeComparable(from)
  const right = normalizeComparable(to)
  if (left === right) return
  diffs.push({ field, label: BL_FREIGHT_DIFF_LABELS[field] ?? field, from: from ?? null, to: to ?? null, billingImpact })
}

/**
 * Troca de consignatario: quem paga o B/L muda. Descreve de quem para quem, o
 * que acompanha (fatura aberta do proprio B/L) e o que impede a troca — um
 * cliente ainda nao cadastrado, uma fatura ja paga ou uma fatura consolidada
 * que cobre outros B/Ls e nao pode trocar de dono inteira.
 */
function describeCustomerChange(
  existing: ExistingBl,
  payload: BlFreightRpcPayload,
  context: {
    customersById: Map<number, BlCustomerSnapshot> | null
    invoices: BlInvoiceSnapshot[]
    receivables: BlReceivableSnapshot[]
    /** nome do cliente cadastrado que o documento passa a apontar */
    matchedCustomerName: string | null
  },
): BlCustomerChange | null {
  const { customersById, invoices, receivables, matchedCustomerName } = context
  const fromDocument = canonicalizeDocument(existing.manifest_customer_cnpj_cpf ?? '')
  const toDocument = canonicalizeDocument(payload.manifest_customer_cnpj_cpf ?? '')
  const documentChanged = Boolean(toDocument) && fromDocument !== toDocument
  const linkChanged = Boolean(
    existing.customer_id && payload.customer_id && existing.customer_id !== payload.customer_id,
  )
  if (!documentChanged && !linkChanged) return null

  const current = existing.customer_id ? customersById?.get(existing.customer_id) ?? null : null
  const next = payload.customer_id
    ? customersById?.get(payload.customer_id) ?? (matchedCustomerName ? { id: payload.customer_id, name: matchedCustomerName, document: null } : null)
    : null
  const targetMissing = payload.customer_id === null
  const messages: string[] = []
  const blockedReasons: string[] = []

  messages.push(
    `Cliente do B/L: ${current?.name ?? existing.manifest_customer_name ?? 'sem vinculo'} -> ${next?.name ?? payload.manifest_customer_name ?? 'cliente nao cadastrado'}`,
  )
  if (documentChanged) {
    messages.push(`CNPJ/CPF: ${existing.manifest_customer_cnpj_cpf ?? '-'} -> ${payload.manifest_customer_cnpj_cpf ?? '-'}`)
  }

  const invoiceRows: BlCustomerChangeInvoice[] = invoices.map((invoice) => ({
    invoiceNumber: invoice.invoiceNumber,
    kind: invoice.kind,
    status: invoice.status,
    totalBrl: invoice.totalBrl,
    blockedReason: describeInvoiceTransferBlock(invoice),
  }))

  for (const invoice of invoiceRows) {
    if (invoice.blockedReason) blockedReasons.push(`Fatura ${invoice.invoiceNumber}: ${invoice.blockedReason}`)
  }

  // Recebivel do razao segue a mesma regra da fatura: com baixa registrada ele
  // carrega historico de recebimento e nao troca de dono (migration 360).
  const liveReceivables = receivables.filter((receivable) => receivable.status !== 'void')
  if (liveReceivables.some((receivable) => (receivable.settledAmountBrl ?? 0) > 0)) {
    blockedReasons.push('Recebivel do B/L ja tem baixa registrada; estorne no razao antes de trocar o cliente.')
  }

  if (targetMissing) {
    // O servidor recusa a troca quando ha qualquer financeiro vivo — fatura,
    // demurrage ou recebivel — e nao ha cliente de destino cadastrado.
    if (invoiceRows.length || liveReceivables.length) {
      blockedReasons.push(
        'Cliente do novo consignatario nao esta cadastrado; cadastre-o antes de reimportar para a fatura acompanhar.',
      )
    } else {
      messages.push('B/L volta para reconciliacao de cliente ate o novo consignatario ser cadastrado.')
    }
  } else if (invoiceRows.length) {
    messages.push(
      `Fatura(s) que acompanham o novo cliente, com o mesmo valor: ${invoiceRows.map((invoice) => invoice.invoiceNumber).join(', ')}`,
    )
  }

  return {
    fromCustomerId: existing.customer_id ?? null,
    fromCustomerName: current?.name ?? existing.manifest_customer_name ?? null,
    fromDocument: existing.manifest_customer_cnpj_cpf ?? null,
    toCustomerId: payload.customer_id,
    toCustomerName: next?.name ?? payload.manifest_customer_name ?? null,
    toDocument: payload.manifest_customer_cnpj_cpf ?? null,
    targetMissing,
    invoices: invoiceRows,
    blockedReasons,
    messages,
  }
}

/**
 * Uma fatura so troca de dono enquanto ninguem pagou nada nela e ela cobre
 * apenas este B/L. Consolidada ou com pagamento, a troca vira trabalho manual
 * do financeiro — automatizar aqui reescreveria historico de recebimento.
 */
function describeInvoiceTransferBlock(invoice: BlInvoiceSnapshot): string | null {
  if (invoice.blCount > 1) return 'consolidada com outros B/Ls; separe a cobranca antes de trocar o cliente.'
  if ((invoice.totalPaidBrl ?? 0) > 0) return 'ja tem pagamento registrado; estorne ou cancele antes de trocar o cliente.'
  if (invoice.status === 'paid') return 'ja quitada; cancele ou emita nota de correcao antes de trocar o cliente.'
  return null
}

async function fetchExistingBls(blNumbers: string[]): Promise<ExistingBl[]> {
  if (!blNumbers.length) return []
  const { data, error } = await supabase
    .from('bls')
    .select(`
      id, voyage_id, cargo_mode, shipper, consignee, notify_party, pol, pod, place_of_delivery,
      cargo_description, total_packages, packages_unit, consignee_phone,
      total_weight_kg, total_cbm, payment_type, bl_emission_date,
      manifest_customer_cnpj_cpf, manifest_customer_name,
      place_of_receipt, movement_from, movement_to, issue_place,
      customer_id, shipper_block, consignee_block, notify_block, notify2_block, notify_cnpj_cpf,
      manifest_customer_email, ncm_codes,
      bl_containers(container_number, seal_number, type, tare_weight_kg, gross_weight_kg, cbm, is_imo, is_oog, imo_class, un_number),
      bl_freight_lines(seq, description, category, mercante_code, currency, amount, payment),
      vehicles(chassis)
    `)
    .in('id', blNumbers)
  if (error) throw error
  return (data ?? []) as unknown as ExistingBl[]
}

/** Nome e documento dos clientes envolvidos na troca, para o preview nao mostrar so ids. */
async function fetchCustomerSnapshots(customerIds: Array<number | null>) {
  const ids = [...new Set(customerIds.filter((id): id is number => typeof id === 'number'))]
  if (!ids.length) return new Map<number, BlCustomerSnapshot>()
  const { data, error } = await supabase.from('customers').select('id, name, cnpj_cpf').in('id', ids)
  if (error) throw error
  return new Map(
    ((data ?? []) as Array<{ id: number; name: string | null; cnpj_cpf: string | null }>).map((customer) => [
      customer.id,
      { id: customer.id, name: customer.name, document: customer.cnpj_cpf },
    ]),
  )
}

/**
 * Faturas vivas de cada B/L (taxas locais e demurrage). `blCount` distingue a
 * fatura individual da consolidada: a consolidada cobre outros B/Ls e nao pode
 * trocar de cliente junto com este.
 */
async function fetchBlInvoiceSnapshots(blNumbers: string[]) {
  const byBl = new Map<string, BlInvoiceSnapshot[]>()
  if (!blNumbers.length) return byBl

  const push = (snapshot: BlInvoiceSnapshot) => {
    const current = byBl.get(snapshot.blId) ?? []
    current.push(snapshot)
    byBl.set(snapshot.blId, current)
  }

  const [links, demurrage] = await Promise.all([
    supabase.from('invoice_bls').select('bl_id, invoice_id').in('bl_id', blNumbers),
    // `not.in` descarta linha com status NULL, e a RPC (COALESCE(status, '')) a
    // move: o filtro fica no codigo para preview e servidor cobrirem as mesmas faturas.
    supabase
      .from('demurrage_invoices')
      .select('bl_id, doc_number, status, current_total_brl')
      .in('bl_id', blNumbers),
  ])
  if (links.error) throw links.error
  if (demurrage.error) throw demurrage.error

  const linkRows = (links.data ?? []) as Array<{ bl_id: string; invoice_id: number }>
  const invoiceIds = [...new Set(linkRows.map((row) => row.invoice_id))]

  if (invoiceIds.length) {
    const [invoices, allLinks] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, invoice_number, status, total_brl, total_paid_brl')
        .in('id', invoiceIds),
      supabase.from('invoice_bls').select('invoice_id, bl_id').in('invoice_id', invoiceIds),
    ])
    if (invoices.error) throw invoices.error
    if (allLinks.error) throw allLinks.error

    const blCountByInvoice = new Map<number, number>()
    for (const row of (allLinks.data ?? []) as Array<{ invoice_id: number; bl_id: string }>) {
      blCountByInvoice.set(row.invoice_id, (blCountByInvoice.get(row.invoice_id) ?? 0) + 1)
    }

    const invoiceById = new Map(
      ((invoices.data ?? []) as Array<{
        id: number
        invoice_number: string
        status: string | null
        total_brl: number | null
        total_paid_brl: number | null
      }>).map((invoice) => [invoice.id, invoice]),
    )

    for (const row of linkRows) {
      const invoice = invoiceById.get(row.invoice_id)
      if (!invoice || invoice.status === 'cancelled' || invoice.status === 'obsolete') continue
      push({
        blId: row.bl_id,
        invoiceNumber: invoice.invoice_number,
        kind: 'local',
        status: invoice.status,
        totalBrl: invoice.total_brl,
        totalPaidBrl: invoice.total_paid_brl,
        blCount: blCountByInvoice.get(row.invoice_id) ?? 1,
      })
    }
  }

  for (const row of (demurrage.data ?? []) as Array<{
    bl_id: string
    doc_number: string
    status: string | null
    current_total_brl: number | null
  }>) {
    if (row.status === 'cancelled' || row.status === 'obsolete') continue
    push({
      blId: row.bl_id,
      invoiceNumber: row.doc_number,
      kind: 'demurrage',
      status: row.status,
      totalBrl: row.current_total_brl,
      totalPaidBrl: row.status === 'paid' ? row.current_total_brl : 0,
      blCount: 1,
    })
  }

  return byBl
}

/**
 * Recebiveis do razao de cada B/L. `relink_bl_customer` conta com eles para
 * decidir se a troca de cliente pode acontecer, entao o preview precisa dos
 * mesmos dados para nao prometer uma troca que o servidor recusa.
 */
async function fetchBlReceivableSnapshots(blNumbers: string[]) {
  const byBl = new Map<string, BlReceivableSnapshot[]>()
  if (!blNumbers.length) return byBl

  const { data, error } = await supabase
    .from('bl_receivables')
    .select('bl_id, status, settled_amount_brl')
    .in('bl_id', blNumbers)
  if (error) throw error

  for (const row of (data ?? []) as Array<{ bl_id: string; status: string | null; settled_amount_brl: number | null }>) {
    const current = byBl.get(row.bl_id) ?? []
    current.push({ blId: row.bl_id, status: row.status, settledAmountBrl: row.settled_amount_brl })
    byBl.set(row.bl_id, current)
  }
  return byBl
}

async function fetchBillingLockedBlIds(blNumbers: string[]) {
  if (!blNumbers.length) return new Set<string>()
  const [charges, invoices] = await Promise.all([
    supabase.from('charge_calculations').select('bl_id').in('bl_id', blNumbers),
    supabase.from('invoice_bls').select('bl_id').in('bl_id', blNumbers),
  ])
  if (charges.error) throw charges.error
  if (invoices.error) throw invoices.error
  return new Set([
    ...((charges.data ?? []) as Array<{ bl_id: string | null }>).map((row) => row.bl_id).filter(Boolean),
    ...((invoices.data ?? []) as Array<{ bl_id: string | null }>).map((row) => row.bl_id).filter(Boolean),
  ] as string[])
}

async function fetchSharedContainerNumbers(blNumbers: string[], containerNumbers: string[]) {
  const numbers = [...new Set(containerNumbers.filter(Boolean))]
  if (!numbers.length) return new Set<string>()
  const { data, error } = await supabase
    .from('bl_containers')
    .select('container_number, bl_id')
    .in('container_number', numbers)
  if (error) throw error
  const importSet = new Set(blNumbers)
  return new Set(
    ((data ?? []) as Array<{ container_number: string | null; bl_id: string | null }>)
      .filter((row) => row.container_number && row.bl_id && !importSet.has(row.bl_id))
      .map((row) => row.container_number as string),
  )
}

async function fetchSelectedVoyage(voyageId: number): Promise<BlFreightSelectedVoyage | null> {
  const { data, error } = await supabase
    .from('voyages')
    .select('id, voyage_number, vessel:vessels(name)')
    .eq('id', voyageId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const voyage = data as unknown as {
    id: number
    voyage_number: string | null
    vessel?: { name?: string | null } | null
  }
  return {
    id: voyage.id,
    vesselName: voyage.vessel?.name ?? null,
    voyageNumber: voyage.voyage_number ?? null,
  }
}

function getDeclaredVoyageMismatchReason(doc: ParsedBLDocument, selectedVoyage: BlFreightSelectedVoyage) {
  const vesselMismatch = Boolean(
    doc.route.vessel
    && selectedVoyage.vesselName
    && canonicalizeVesselName(doc.route.vessel) !== canonicalizeVesselName(selectedVoyage.vesselName),
  )
  const voyageMismatch = Boolean(
    doc.route.voyage
    && selectedVoyage.voyageNumber
    && normalizeText(doc.route.voyage) !== normalizeText(selectedVoyage.voyageNumber),
  )
  if (!vesselMismatch && !voyageMismatch) return null
  return `Arquivo e da viagem ${formatVoyageRef(doc.route.vessel, doc.route.voyage)}, mas voce apontou ${formatVoyageRef(selectedVoyage.vesselName, selectedVoyage.voyageNumber)}.`
}

function formatVoyageRef(vessel?: string | null, voyage?: string | null) {
  const vesselLabel = String(vessel ?? '').trim() || 'Navio nao informado'
  const voyageLabel = String(voyage ?? '').trim() || 'viagem nao informada'
  return `${vesselLabel} / ${voyageLabel}`
}

function normalizeFreightCategory(value: string) {
  return value.toUpperCase().trim().replace(/[\s-]+/g, '_')
}

function firstLine(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
}

function extractPhone(value: string) {
  return value.match(/TEL[.:]?\s*([+0-9() -]{8,25})/i)?.[1]?.trim() ?? null
}

// B/L cells carry Brazilian dates (DD/MM/YYYY). The previous digit-slice assumed
// YYYYMMDD order, turning 21/04/2026 into "2104-20-26" and aborting the whole
// import when the RPC cast it to DATE. Parse the real order and reject anything
// that is not a valid calendar date so one bad cell never nulls the transaction.
function normalizeDate(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return isValidIsoDate(trimmed) ? trimmed : null
  // Real COSCO B/L templates write "Date Laden on Board" as plain text
  // "DD MM YYYY" (space-separated, no real date cell format) instead of
  // DD/MM/YYYY — split on whitespace too, not just -/. delimiters.
  const parts = trimmed.split(/[-/.\s]+/)
  if (parts.length === 3 && parts[0].length <= 2) {
    const [day, month, year] = parts
    const iso = `${year.padStart(4, '20')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    return isValidIsoDate(iso) ? iso : null
  }
  return null
}

function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function sumNumbers(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!numbers.length) return null
  return numbers.reduce((sum, value) => sum + value, 0)
}

function normalizeComparable(value: string | number | null | undefined) {
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000)
  return String(value ?? '').trim()
}

function normalizeContainerSet(containers: Array<Partial<BLContainer> | BlFreightRpcPayload['containers'][number]>) {
  return containers
    .map((container) => [
      container.container_number,
      container.seal_number ?? '',
      container.type ?? '',
      normalizeComparable(container.tare_weight_kg),
      normalizeComparable(container.gross_weight_kg),
      normalizeComparable(container.cbm),
    ].join('|'))
    .sort()
    .join(';')
}

// Chassis identifica o veiculo; o container em que ele viaja ja aparece no diff
// de containers, entao repeti-lo aqui so encheria a lista de ruido.
function normalizeVehicleSet(vehicles: Array<{ chassis?: string | null }>) {
  return vehicles
    .map((vehicle) => vehicle.chassis ?? '')
    .sort()
    .join(';')
}

function normalizeFreightSet(lines: Array<Partial<BlFreightLine> | BlFreightRpcPayload['freight_lines'][number]>) {
  return lines
    .map((line) => [
      line.seq,
      line.description ?? '',
      line.category ?? '',
      line.mercante_code ?? '',
      line.currency ?? '',
      normalizeComparable(line.amount),
      line.payment ?? '',
    ].join('|'))
    .sort()
    .join(';')
}

function normalizeText(value?: string | null) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}
