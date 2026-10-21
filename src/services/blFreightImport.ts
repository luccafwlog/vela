import { canonicalizeDocument } from '../lib/cnpj'
import { atomicImportRefusalMessage } from '../lib/errors'
import { importDateOrNull } from '../lib/importDate'
import { extractNcmCodes } from '../lib/ncm'
import { normalizeIsoContainerNumber } from '../lib/containerNumber'
import { canonicalizeVesselName } from '../lib/vesselAlias'
import { extractConsigneeShortName } from '../lib/consigneeName'
import type { BL, BLContainer, BlFreightLine, Vehicle } from '../types/database'
import { extractTaxId, type ParsedBLDocument } from './blParser'
import { findMatchedCustomer, loadCustomerMaps, resolveCustomerLink, type CustomerMaps } from './customerReconciliation'
import { normalizePortCode, resolvePortCode } from './portCode'
import { fetchAllPages } from './reports'
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
  /** skipped: B/L cancelado no arquivo; não é tocado (ADR 0095, decisão 8) */
  status: 'new' | 'updated' | 'unchanged' | 'blocked' | 'skipped'
  existing: boolean
  /** contêineres que o B/L já tem no banco */
  existingContainerNumbers?: string[]
  /** contêineres gravados que o arquivo não traz: saem do B/L ao confirmar (ADR 0071, item 10) */
  removedContainers?: string[]
  /**
   * Preço do dia da importação → preço de hoje, quando diferem (B/L gravado e
   * não faturado; ADR 0094, A2). Só refixa com o aceite por B/L.
   */
  priceRefix?: BlPriceRefix | null
  /** avisos que não bloqueiam (ex.: Laden on Board ilegível mantém a data gravada) */
  warnings?: string[]
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
    skippedCount?: number
    billingOverrideCount: number
    customerChangeCount: number
    priceRefixCount?: number
  }
}

/** Retrato do preço de um B/L (`_bl_price_snapshot`, migration 392). */
export type BlPriceSnapshot = {
  referenceDate: string | null
  roe: number | null
  tables: string[]
  conditionItems: number
  totalBrl: number | null
  totalUsd: number | null
}

export type BlPriceRefix = { before: BlPriceSnapshot; after: BlPriceSnapshot }

/** Estado de um B/L gravado para a prévia, pela régua do servidor (`bl_file_import_preview`). */
export type BlImportState = {
  blId: string
  voyageId: number | null
  voyageLabel: string | null
  cancelled: boolean
  /** fatura local emitida: só então existe a confirmação de faturamento */
  invoiced: boolean
  /** preço de hoje diferente do fixado; null quando não se aplica ou é igual */
  priceRefix: BlPriceRefix | null
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
  /**
   * Confirmação de faturamento do operador. Só vale com fatura emitida e com o
   * impacto mostrado na prévia; o servidor confere (migration 392).
   */
  override_billing: boolean
  /** FCL/LCL do Type of Movement; null quando o arquivo não diz (migration 392) */
  container_load_type: 'FCL' | 'LCL' | null
  /** aceite de refixar o preço (preço de hoje) do B/L não faturado (migration 392) */
  refix_prices?: boolean
  /** authorizes moving the B/L (and its invoices) to the consignee the file now declares */
  relink_customer: boolean
  /** NCM declarado no documento; vazio nunca apaga o cadastro manual (migration 358) */
  ncm_codes: string[]
  /** contêineres que a prévia mostrou saindo; os demais ausentes ficam (migration 175) */
  remove_containers?: string[]
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
    /** SOC/COC declarado no B/L; o B/L é soberano sobre o Baplie (migration 121) */
    ownership: 'SOC' | 'COC' | null
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
  container_load_type?: string | null
  vehicles?: (Pick<Vehicle, 'chassis'> & Partial<Pick<Vehicle, 'brand' | 'model' | 'weight_kg' | 'cbm' | 'container_id'>>)[] | null
  bl_containers?: (Pick<BLContainer, 'container_number' | 'seal_number' | 'type' | 'tare_weight_kg' | 'gross_weight_kg' | 'cbm' | 'is_imo' | 'is_oog' | 'imo_class' | 'un_number'> & { id?: number; ownership?: string | null; ownership_source?: string | null })[] | null
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
  /** B/Ls com fatura emitida: só eles pedem a confirmação de faturamento (ADR 0095, decisão 10) */
  billingLockedBlIds?: Set<string>
  /** estado de cada B/L gravado pela régua do servidor (outra Viagem, cancelado, preço de hoje) */
  importStates?: Map<string, BlImportState> | null
  /** container numbers that already belong to a different B/L (container_distinct_voyage billing) */
  sharedContainerNumbers?: Set<string>
  /**
   * B/Ls de outro arquivo que dividem cada container na Viagem escolhida, com o
   * Cliente: container FCL não é dividido entre Clientes diferentes (ADR 0078, item 11).
   */
  containerSiblings?: Map<string, ContainerSibling[]> | null
  selectedVoyage?: BlFreightSelectedVoyage | null
  onlyBlId?: string | null
  /** B/Ls em COD vivo: a reimportação não muda o POD (ADR 0078, item 13) */
  codBlIds?: Set<string> | null
  /** portos omitidos (não revertidos) na Viagem escolhida */
  omittedPods?: Set<string> | null
  /** customers indexed by document/name so the import links each B/L to its payer */
  customerMaps?: CustomerMaps | null
  /** current payer of each existing B/L, indexed by customer id */
  customersById?: Map<number, BlCustomerSnapshot> | null
  /** live invoices of each existing B/L, indexed by B/L id */
  invoicesByBl?: Map<string, BlInvoiceSnapshot[]> | null
  /** ledger receivables of each existing B/L, indexed by B/L id */
  receivablesByBl?: Map<string, BlReceivableSnapshot[]> | null
  /**
   * Cadastro de portos (nome e LOCODE). Presente, o POD que nem a tabela de
   * apelidos nem o cadastro reconhecem bloqueia a linha (ADR 0078, item 17).
   */
  knownPorts?: PortCatalogEntry[] | null
  /**
   * O que impede cada contêiner gravado de sair do B/L, pelo id da linha em
   * `bl_containers`. Presente, a prévia recusa a linha que a gravação recusaria
   * (migration 175, P0006) em vez de deixar o lote inteiro cair.
   */
  containerRemovalBlockers?: ContainerRemovalBlockers | null
}

export type ContainerRemovalBlockers = {
  /** contêineres com item de Invoice de Demurrage, de qualquer status */
  demurrageContainerIds: Set<number>
  /** chassis dos veículos gravados em cada contêiner */
  vehiclesByContainer: Map<number, string[]>
}

export type PortCatalogEntry = { name: string | null; locode: string | null }

export type ContainerSibling = {
  blId: string
  customerId: number | null
  customerName: string | null
  loadType: string | null
}

export async function previewBlFreightImport(args: {
  documents: ParsedBLDocument[]
  voyageId: number
  onlyBlId?: string | null
}): Promise<BlFreightImportPreview> {
  const blNumbers = args.documents.map((doc) => doc.blNumber).filter(Boolean)
  const [existingBls, customerMaps] = await Promise.all([fetchExistingBls(blNumbers), loadCustomerMaps()])
  const existingIds = new Set(existingBls.map((bl) => bl.id))
  const importStates = await fetchBlImportStates(args.voyageId, [...existingIds])
  const billingLockedBlIds = new Set([...importStates.values()].filter((state) => state.invoiced).map((state) => state.blId))
  const containerNumbers = args.documents.flatMap((doc) => doc.containers.map((container) => container.containerNumber))
  // Also check the containers a billed B/L already has: replacing a shared container
  // with a unique one (same count) still changes container_distinct_voyage billing.
  const existingContainerNumbers = existingBls.flatMap((bl) => (bl.bl_containers ?? []).map((container) => container.container_number))
  const sharedContainerNumbers = await fetchSharedContainerNumbers(blNumbers, [...containerNumbers, ...existingContainerNumbers])
  const [selectedVoyage, knownPorts, containerSiblings, codBlIds, omittedPods] = await Promise.all([
    fetchSelectedVoyage(args.voyageId),
    fetchPortCatalog(),
    fetchContainerSiblings(args.voyageId, blNumbers, containerNumbers),
    fetchCodBlIds([...existingIds]),
    fetchOmittedPods(args.voyageId),
  ])
  if (!selectedVoyage) throw new Error('Viagem selecionada não encontrada.')

  // Troca de consignatario: o preview precisa dizer de quem para quem o B/L vai
  // e o que acontece com a fatura ja emitida, antes de o operador confirmar.
  // Os clientes envolvidos sao os dois lados: o dono atual do B/L e o cliente
  // que o documento passa a declarar (resolvido pelo mesmo casamento do payload).
  const existingById = new Map(existingBls.map((bl) => [bl.id, bl]))
  const targetCustomerIds: Array<number | null> = []
  // Contêineres gravados que o arquivo não traz: a prévia confere o que impede
  // a saída de cada um antes de prometê-la.
  const removalCandidateIds: number[] = []
  for (const doc of args.documents) {
    const payload = buildBlFreightPayload(doc, selectedVoyage.id)
    targetCustomerIds.push(findMatchedCustomer(
      { cnpjCpf: payload.manifest_customer_cnpj_cpf, consignee: payload.consignee, readTexts: [payload.consignee_block, payload.cargo_description] },
      customerMaps,
    )?.customer.id ?? null)
    const existing = existingById.get(doc.blNumber)
    if (existing) {
      const incoming = payload.containers.map((container) => container.container_number)
      removalCandidateIds.push(...missingContainerEntries(existing, incoming).flatMap((entry) => entry.ids))
    }
  }
  const [customersById, invoicesByBl, receivablesByBl, containerRemovalBlockers] = await Promise.all([
    fetchCustomerSnapshots([...existingBls.map((bl) => bl.customer_id ?? null), ...targetCustomerIds]),
    fetchBlInvoiceSnapshots([...existingIds]),
    fetchBlReceivableSnapshots([...existingIds]),
    fetchContainerRemovalBlockers(removalCandidateIds),
  ])

  return buildBlFreightPreview({
    documents: args.documents,
    existingBls,
    billingLockedBlIds,
    importStates,
    sharedContainerNumbers,
    selectedVoyage,
    onlyBlId: args.onlyBlId,
    customerMaps,
    customersById,
    invoicesByBl,
    receivablesByBl,
    knownPorts,
    containerSiblings,
    codBlIds,
    omittedPods,
    containerRemovalBlockers,
  })
}

export function buildBlFreightPreview({
  documents,
  existingBls = [],
  billingLockedBlIds = new Set(),
  importStates = null,
  sharedContainerNumbers = new Set(),
  selectedVoyage = null,
  onlyBlId = null,
  customerMaps = null,
  customersById = null,
  invoicesByBl = null,
  receivablesByBl = null,
  knownPorts = null,
  containerSiblings = null,
  codBlIds = null,
  omittedPods = null,
  containerRemovalBlockers = null,
}: BuildBlFreightPreviewArgs): BlFreightImportPreview {
  const existingById = new Map(existingBls.map((bl) => [bl.id, bl]))
  const rows = documents.map((doc) => {
    const existing = existingById.get(doc.blNumber) ?? null
    const voyageId = selectedVoyage?.id ?? null
    const payload = voyageId ? buildBlFreightPayload(doc, voyageId) : null
    if (payload && existing) {
      preserveExistingContainerPhysicalAttributes(payload, existing)
    }
    const warnings: string[] = []
    const portBlock = knownPorts && payload ? applyPortCatalog(payload, doc, knownPorts) : null
    const matchedCustomer = payload && customerMaps
      ? findMatchedCustomer(
        { cnpjCpf: payload.manifest_customer_cnpj_cpf, consignee: payload.consignee, readTexts: [payload.consignee_block, payload.cargo_description] },
        customerMaps,
      )
      : null
    if (payload && customerMaps) {
      applyCustomerReconciliation(payload, matchedCustomer)
    }
    const blockedReasons: string[] = []
    const state = importStates?.get(doc.blNumber) ?? null

    // ADR 0095, decisão 5: a importação não move B/L entre Viagens.
    if (state && selectedVoyage && state.voyageId !== selectedVoyage.id) {
      const label = state.voyageLabel ?? String(state.voyageId ?? '')
      blockedReasons.push(state.cancelled
        ? `O B/L ${doc.blNumber} está cancelado na Viagem ${label}: o número continua lá. Exclua o B/L na Viagem ${label} e importe de novo.`
        : `O B/L ${doc.blNumber} já está na Viagem ${label}: cancele ou exclua o B/L lá e importe de novo.`)
    }
    // ADR 0095, decisão 8: B/L cancelado é aviso, não é tocado, e o resto entra.
    const skippedCancelled = Boolean(state?.cancelled && !blockedReasons.length)
    if (skippedCancelled) {
      warnings.push(`B/L ${doc.blNumber} está cancelado e não será alterado: para importar, reative o B/L pela ficha (Administrativo) e importe de novo.`)
    }
    // ADR 0095, decisão 26: veículos só pela planilha de Veículos.
    if (doc.vinSheet || doc.vehicles.length) {
      warnings.push('Aba VIN ignorada: veículos entram só pela planilha de Veículos; os veículos já gravados no B/L ficam.')
    }
    // ADR 0095, decisão 27: FCL/LCL do Type of Movement.
    if (payload && !payload.container_load_type) {
      warnings.push(`Modalidade FCL/LCL não lida no Type of Movement ("${doc.route.movementFrom?.trim() || 'vazio'}"): o B/L ${existing ? 'mantém a gravada' : 'entra sem modalidade'}.`)
    }

    if (onlyBlId && doc.blNumber !== onlyBlId) {
      blockedReasons.push(`Arquivo contém o B/L ${doc.blNumber}, mas a ficha aberta é a do ${onlyBlId}.`)
    }
    if (!selectedVoyage) {
      blockedReasons.push('Selecione uma viagem para importar o B/L.')
    } else {
      const mismatchReason = getDeclaredVoyageMismatchReason(doc, selectedVoyage)
      if (mismatchReason) blockedReasons.push(mismatchReason)
    }
    if (portBlock) blockedReasons.push(portBlock)
    // Números do arquivo (blParser): separador ambíguo bloqueia, número
    // descartado avisa — nenhum dos dois entra calado (F-30).
    for (const issue of doc.numberIssues ?? []) {
      if (issue.severity === 'error') blockedReasons.push(issue.message)
      else warnings.push(issue.message)
    }
    const fclConflict = payload && containerSiblings ? describeFclConflict(payload, existing, containerSiblings) : null
    if (fclConflict) blockedReasons.push(fclConflict)
    const removedContainers = existing && payload ? missingContainers(existing, payload) : []
    // Antes da troca de consignatário: a linha que a gravação recusaria fica
    // bloqueada aqui, e linha bloqueada não anuncia troca nem pede confirmação.
    const removal = existing && payload && containerRemovalBlockers
      ? describeContainerRemovalBlocks(existing, payload, containerRemovalBlockers)
      : []
    blockedReasons.push(...removal)
    // COD vivo: o POD do B/L é o destino do COD; o arquivo não o troca
    // (o servidor também mantém, migration 183). Mudar POD aqui é correção, nunca COD.
    if (payload && existing && codBlIds?.has(existing.id) && payload.pod && existing.pod && payload.pod !== existing.pod) {
      warnings.push(`B/L em COD: o POD continua ${existing.pod} (o arquivo traz ${payload.pod}); os demais campos atualizam.`)
      payload.pod = existing.pod
    }
    if (payload && !existing && payload.pod && omittedPods?.has(payload.pod)) {
      warnings.push(`POD ${payload.pod} foi omitido nesta Viagem: o B/L entra como afetado pela omissão, com disposição Transbordo.`)
    }
    if (!normalizeDate(doc.dates.ladenOnBoard)) {
      warnings.push(doc.dates.ladenOnBoard.trim()
        ? `Embarque ilegível ("${doc.dates.ladenOnBoard.trim()}"): a data gravada não muda.`
        : 'Embarque vazio no arquivo: a data gravada não muda.')
    }

    const consigneeDocumentMatches = payload && existing?.manifest_customer_cnpj_cpf
      ? canonicalizeDocument(existing.manifest_customer_cnpj_cpf) === canonicalizeDocument(payload.manifest_customer_cnpj_cpf)
      : null

    const billed = billingLockedBlIds.has(doc.blNumber)
    const impact = existing && billed && payload
      ? computeBillingImpact(existing, payload, sharedContainerNumbers)
      : { messages: [], container: false, weight: false, cnpj: false, route: false }
    const requiresBillingOverride = impact.messages.length > 0
    if (requiresBillingOverride && existing) {
      const invoices = (invoicesByBl?.get(existing.id) ?? []).filter((invoice) => invoice.kind === 'local')
      for (const invoice of invoices) {
        impact.messages.push(Number(invoice.totalPaidBrl ?? 0) > 0
          ? impact.cnpj ? `Fatura ${invoice.invoiceNumber}: devolver ao Cliente original; nova cobrança aguarda confirmação da restituição.` : `Fatura ${invoice.invoiceNumber} ficará desatualizada. Com pagamento: aumento usa avulsa; redução abate o saldo e depois restitui.`
          : `Fatura ${invoice.invoiceNumber} será cancelada e reemitida automaticamente com o valor novo (com a consolidada que incluir o B/L).`)
      }
    }

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
    const priceRefix = !skippedCancelled && !blockedReasons.length ? state?.priceRefix ?? null : null
    // Only the operator's override decision is pending; a billing impact never nulls the payload.
    // F-05: a confirmação nunca vai ligada por padrão; só o aceite do operador a liga.
    if (payload) {
      payload.billing_impact = requiresBillingOverride
      payload.override_billing = false
      payload.relink_customer = false
      // A remoção vai explícita: só sai o que a prévia mostrou (migration 175).
      if (existing) payload.remove_containers = removedContainers
    }

    const status: BlFreightImportRow['status'] = blockedReasons.length
      ? 'blocked'
      : skippedCancelled
        ? 'skipped'
        : !existing
        ? 'new'
        : diffs.length
          ? 'updated'
          : 'unchanged'

    return {
      blNumber: doc.blNumber,
      status,
      existing: Boolean(existing),
      existingContainerNumbers: (existing?.bl_containers ?? []).flatMap((container) => {
        const number = normalizeIsoContainerNumber(container.container_number)
        return number ? [number] : []
      }),
      removedContainers: skippedCancelled ? [] : removedContainers,
      priceRefix,
      warnings,
      voyageId,
      voyageNumber: doc.route.voyage?.trim() || selectedVoyage?.voyageNumber || null,
      pol: payload?.pol ?? normalizePortCode(doc.route.pol),
      pod: payload?.pod ?? normalizePortCode(doc.route.pod),
      ladenOnBoard: normalizeDate(doc.dates.ladenOnBoard),
      consigneeDocumentMatches,
      blockedReasons,
      billingImpacts: skippedCancelled ? [] : impact.messages,
      requiresBillingOverride: requiresBillingOverride && !skippedCancelled,
      customerChange: skippedCancelled ? null : customerChange,
      requiresCustomerConfirmation: requiresCustomerConfirmation && !skippedCancelled,
      diffs: skippedCancelled ? [] : diffs,
      payload: blockedReasons.length || skippedCancelled ? null : payload,
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
      skippedCount: rows.filter((row) => row.status === 'skipped').length,
      billingOverrideCount: rows.filter((row) => row.requiresBillingOverride).length,
      customerChangeCount: rows.filter((row) => row.requiresCustomerConfirmation).length,
      priceRefixCount: rows.filter((row) => row.priceRefix).length,
    },
  }
}

/** Troca de consignatario que o servidor recusou, com o motivo que ele devolveu. */
export type RefusedCustomerRelink = {
  blNumber: string
  blockers: string[]
}

export type LocalChargeCalculationError = {
  blNumber: string
  message: string
}

/** O que a RPC fez em cada B/L: contêineres e veículos que entraram, mudaram ou saíram. */
export type BlImportChangeSummary = {
  blNumber: string
  inserted: string[]
  updated: string[]
  removed: string[]
}

export type BlFreightImportResult = {
  /** retorno cru da RPC de importação (o arquivo inteiro numa chamada, migration 335) */
  result: unknown[]
  containerChanges: BlImportChangeSummary[]
  /** B/Ls cancelados no arquivo: não foram tocados (ADR 0095, decisão 8), com a mensagem do servidor */
  cancelledSkipped: Array<{ blNumber: string; message: string }>
  /** B/Ls cujo preço foi refixado com o aceite (ADR 0094, A2) */
  pricesRefixed: string[]
  /** trocas de cliente pedidas no preview e recusadas pelo servidor */
  refusedCustomerRelinks: RefusedCustomerRelink[]
  /**
   * B/Ls com Troca de Consignatário sem aceite: Cliente, consignatário, CNPJ,
   * razão social e e-mail gravados ficaram (migration 213).
   */
  customerChangesIgnored: string[]
  /** B/Ls persistidos cuja tentativa de cálculo imediato falhou */
  calculationErrors: LocalChargeCalculationError[]
}

/** B/Ls cuja Troca de Consignatário o servidor ignorou por falta de aceite (migration 213). */
export function readCustomerChangesIgnored(data: unknown): string[] {
  const ignored = (data as { customer_changes_ignored?: unknown } | null)?.customer_changes_ignored
  if (!Array.isArray(ignored)) return []
  return ignored.flatMap((entry) => {
    const blId = (entry as { bl_id?: unknown } | null)?.bl_id
    return typeof blId === 'string' && blId ? [blId] : []
  })
}

/**
 * Campos do consignatário (e a reconciliação de Cliente que vem com ele) que só
 * mudam com a Troca de Consignatário aceita. Sem o aceite eles não vão: o B/L
 * fica com o consignatário gravado, sem a retenção do consignatário novo (a RPC
 * também os mantém, migration 213, como a carga solta desde a 192).
 */
const CUSTOMER_SWAP_FIELDS = [
  'consignee',
  'consignee_block',
  'manifest_customer_cnpj_cpf',
  'manifest_customer_name',
  'manifest_customer_email',
  'customer_reconciliation_status',
  'customer_reconciliation_notes',
  'billing_hold_reason',
] as const

function withoutCustomerSwapFields<T extends Partial<Record<(typeof CUSTOMER_SWAP_FIELDS)[number], unknown>>>(payload: T): T {
  const kept = { ...payload }
  for (const field of CUSTOMER_SWAP_FIELDS) delete kept[field]
  return kept
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
      blockers: blockers.length ? blockers : ['Troca de consignatário recusada na gravação.'],
    }]
  })
}

function readChangeSummaries(data: unknown, key: 'container_changes'): BlImportChangeSummary[] {
  const entries = (data as Record<string, unknown> | null)?.[key]
  if (!Array.isArray(entries)) return []
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : [])
  return entries.map((entry) => {
    const item = entry as { bl_id?: unknown; inserted?: unknown; updated?: unknown; removed?: unknown }
    return { blNumber: String(item.bl_id ?? ''), inserted: list(item.inserted), updated: list(item.updated), removed: list(item.removed) }
  })
}

/** Lê do retorno da RPC o que mudou nos contêineres, por B/L. */
export function readImportChanges(data: unknown) {
  return { containerChanges: readChangeSummaries(data, 'container_changes') }
}

/** B/Ls cancelados que o servidor deixou de fora, e os de preço refixado (migration 392). */
export function readFileImportOutcome(data: unknown) {
  const raw = data as { cancelled_skipped?: unknown; prices_refixed?: unknown } | null
  return {
    cancelledSkipped: Array.isArray(raw?.cancelled_skipped)
      ? raw.cancelled_skipped.map((entry) => {
        const item = entry as { bl_id?: unknown; message?: unknown }
        return { blNumber: String(item.bl_id ?? ''), message: String(item.message ?? '') }
      })
      : [],
    pricesRefixed: Array.isArray(raw?.prices_refixed) ? raw.prices_refixed.map(String) : [],
  }
}

export function readLocalChargeCalculationErrors(data: unknown): LocalChargeCalculationError[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((entry) => {
    const error = entry as { bl_id?: unknown; blNumber?: unknown; message?: unknown }
    const blNumber = typeof error.bl_id === 'string'
      ? error.bl_id
      : typeof error.blNumber === 'string'
        ? error.blNumber
        : ''
    const message = typeof error.message === 'string' && error.message.trim()
      ? error.message
      : 'Erro no cálculo automático das Taxas Locais.'
    return [{ blNumber, message }]
  })
}

/**
 * Recusa da gravação do B/L de container: nada foi gravado. `refused` lista o
 * que o banco recusou (hoje, linhas da aba VIN), para a tela mostrar.
 */
export class BlFreightImportRefused extends Error {
  readonly refused: string[]
  constructor(message: string, refused: string[] = [], options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BlFreightImportRefused'
    this.refused = refused
  }
}

export async function confirmBlFreightImport(
  preview: BlFreightImportPreview,
  changedBy: string,
  /** Confirmação de faturamento: todos os B/Ls (true) ou só os marcados na prévia, por B/L. */
  overrideBilling: boolean | ReadonlySet<string> = false,
  filename = 'importacao-bl.xlsx',
  confirmCustomerChange = false,
  /** B/Ls cujo preço o operador aceitou refixar (ADR 0094, A2) */
  refixPrices: ReadonlySet<string> = new Set(),
): Promise<BlFreightImportResult> {
  // ADR 0092: B/L bloqueado é erro do arquivo e recusa a importação inteira;
  // nenhum B/L liberado é gravado sem os outros. B/L cancelado (`skipped`) é
  // aviso: fica fora e o resto entra (ADR 0095, decisão 8).
  const blocked = preview.rows.filter((row) => row.status === 'blocked' || (!row.payload && row.status !== 'skipped'))
  if (blocked.length) {
    throw new BlFreightImportRefused(
      `Nada foi gravado: ${blocked.length === 1 ? 'o B/L' : 'os B/Ls'} ${blocked.map((row) => row.blNumber).join(', ')} ${blocked.length === 1 ? 'está bloqueado' : 'estão bloqueados'}. Corrija o arquivo e escolha de novo.`,
    )
  }
  if (!preview.rows.some((row) => row.payload)) {
    throw new BlFreightImportRefused(preview.rows.length
      ? 'Nada foi gravado: todos os B/Ls do arquivo estão cancelados. Reative pela ficha (Administrativo) e importe de novo.'
      : 'Nada foi gravado: o arquivo não tem B/L.')
  }
  const overrides = (blNumber: string) => (typeof overrideBilling === 'boolean' ? overrideBilling : overrideBilling.has(blNumber))
  // Troca de Consignatário de B/L que já tem Cliente, sem aceite (ou impedida
  // na prévia): o consignatário gravado fica e o resultado avisa. É decisão de
  // campo, não erro de linha: o B/L entra com os demais campos. O mesmo vale
  // para a troca aceita que o banco recusa (`customer_relinks`): exceção
  // registrada no item 3 da ADR 0092, não desfaz o arquivo.
  const keptCustomer = new Set<string>()
  const payload = preview.rows.flatMap((row) => {
    if (!row.payload) return []
    // Rows that touch a billing variable only apply the physical change when the operator overrode.
    const withBilling = row.requiresBillingOverride ? { ...row.payload, override_billing: overrides(row.blNumber) } : row.payload
    const base = row.priceRefix && refixPrices.has(row.blNumber) ? { ...withBilling, refix_prices: true } : withBilling
    // A troca muda o B/L; documentos e recebimentos anteriores ficam preservados. Só acontece com
    // aceite explicito, e nunca quando o preview ja apontou um impedimento.
    const accepted = row.requiresCustomerConfirmation && confirmCustomerChange
    const change = row.customerChange
    // Troca de Cliente: o B/L tem Cliente e o arquivo aponta outro, ou um
    // consignatário não cadastrado. O mesmo Cliente com outro CNPJ não é troca.
    const swapsCustomer = change?.fromCustomerId != null && change.toCustomerId !== change.fromCustomerId
    if (swapsCustomer && !accepted) {
      keptCustomer.add(row.blNumber)
      return [{ ...withoutCustomerSwapFields(base), relink_customer: false }]
    }
    if (!row.requiresCustomerConfirmation) return [base]
    return [{ ...base, relink_customer: confirmCustomerChange }]
  })

  // Mantém os dados extraídos do B/L para a revisão oferecer como sugestão;
  // o cadastro e a vinculação só ocorrem após confirmação do usuário. Quando
  // o arquivo tem uma viagem, a gravação registra o batch e calcula as taxas
  // na mesma transação. O caminho sem viagem continua avulso (ADR 0017).
  const voyageId = payload.find((bl) => bl.voyage_id != null)?.voyage_id ?? null
  // ADR 0092: o arquivo inteiro numa chamada e numa transação (migration 335).
  // Antes dela a tela mandava lotes de 20 B/Ls / 300 contêineres, cada um uma
  // transação, para caber nos 8 s do papel authenticated; uma falha no meio
  // deixava os lotes anteriores gravados.
  // ponytail: a RPC declara `statement_timeout = 60s`, que o PostgREST aplica à
  // transação da chamada; a ~8 ms por contêiner (medido em 08/10/2026), o teto
  // é de uns 7.000 contêineres por arquivo (uns 1.000 se o tempo da função não
  // valer). Acima disso a chamada é cancelada e nada é gravado. Upgrade: gravar
  // em etapas numa tabela de preparo e publicar tudo numa RPC final, ou tirar o
  // cálculo das taxas e as flags do Baplie da transação.
  const { data: rawData, error } = await supabase.rpc('import_bl_freight_file_atomic' as never, {
    p_bls: payload,
    p_changed_by: changedBy,
    p_batch: voyageId != null ? { filename, voyage_id: voyageId, cargo_mode: 'container' } : null,
  } as never)
  if (error) {
    const raw = error as { code?: string }
    if (raw.code === '57014') {
      throw new BlFreightImportRefused(
        'Nada foi gravado: o arquivo é grande demais para gravar de uma vez. Divida os B/Ls em arquivos menores e importe cada um.',
        [],
        { cause: error },
      )
    }
    throw new BlFreightImportRefused(atomicImportRefusalMessage(error), [], { cause: error })
  }
  const wrapped = rawData as { result?: unknown; calculation_errors?: unknown } | null
  const data = wrapped && typeof wrapped === 'object' && 'result' in wrapped ? wrapped.result : rawData
  const changes = { ...readImportChanges(data), ...readFileImportOutcome(rawData) }
  for (const blNumber of readCustomerChangesIgnored(data)) keptCustomer.add(blNumber)

  return {
    result: [data],
    ...changes,
    refusedCustomerRelinks: readRefusedCustomerRelinks(data),
    customerChangesIgnored: [...keptCustomer].sort(),
    // Passo técnico depois da gravação (ADR 0092, D2): falha no cálculo não
    // desfaz a importação; a ficha do B/L recalcula.
    calculationErrors: readLocalChargeCalculationErrors(wrapped?.calculation_errors),
  }
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
      ownership: container.ownership,
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
    container_load_type: containerLoadTypeFromMovement(doc.route.movementFrom, doc.route.movementTo),
    total_weight_kg: sumNumbers(containers.map((container) => container.gross_weight_kg)),
    total_cbm: sumNumbers(containers.map((container) => container.cbm)),
    payment_type: oceanFreight?.payment ?? null,
    bl_emission_date: normalizeDate(doc.dates.issueDate || doc.dates.ladenOnBoard),
    laden_on_board: normalizeDate(doc.dates.ladenOnBoard),
    manifest_customer_cnpj_cpf: doc.parties.consigneeTaxId,
    manifest_customer_name: firstLine(doc.parties.consigneeBlock),
    manifest_customer_email: doc.parties.consigneeEmail ?? null,
    billing_impact: false,
    override_billing: false,
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
    // ADR 0095, decisão 26: a aba VIN não vai à gravação; veículos só pela
    // planilha de Veículos.
  }
}

/**
 * FCL/LCL pelo "Type of Movement" do B/L COSCO (ADR 0095, decisão 27): a
 * primeira caixa traz "FCL/FCL" ou "LCL/LCL"; a segunda, "CY-CY" (FCL) ou
 * "CFS-CFS" (LCL). Sem nenhum dos dois, null (a prévia avisa).
 */
export function containerLoadTypeFromMovement(movementFrom: string | null | undefined, movementTo?: string | null): 'FCL' | 'LCL' | null {
  const from = (movementFrom ?? '').trim().toUpperCase()
  if (from.startsWith('LCL')) return 'LCL'
  if (from.startsWith('FCL')) return 'FCL'
  const to = (movementTo ?? '').trim().toUpperCase().replace(/\s+/g, '')
  if (to.startsWith('CFS')) return 'LCL'
  if (to.startsWith('CY')) return 'FCL'
  return null
}

/** Contêineres gravados que o arquivo não traz. */
function missingContainers(existing: ExistingBl, payload: BlFreightRpcPayload) {
  return missingContainerEntries(existing, payload.containers.map((container) => container.container_number)).map((entry) => entry.number)
}

/** Contêineres gravados que o arquivo não traz, com os ids das linhas em `bl_containers`. */
function missingContainerEntries(existing: ExistingBl, incomingNumbers: Iterable<string>) {
  const incoming = new Set(incomingNumbers)
  const idsByNumber = new Map<string, number[]>()
  for (const container of existing.bl_containers ?? []) {
    const number = normalizeIsoContainerNumber(container.container_number)
    if (!number || incoming.has(number)) continue
    const ids = idsByNumber.get(number) ?? []
    if (container.id != null) ids.push(container.id)
    idsByNumber.set(number, ids)
  }
  return [...idsByNumber.keys()].sort().map((number) => ({ number, ids: idsByNumber.get(number) ?? [] }))
}

/**
 * Contêiner que sai do B/L e que a gravação não deixa sair (P0006, que
 * derruba o lote inteiro): item de Invoice de Demurrage, de qualquer status
 * (cancelar a invoice não destrava), ou veículo gravado nele. A aba VIN não é
 * lida (ADR 0095, decisão 26): os veículos saem pela planilha de Veículos ou
 * pela ficha. A prévia recusa só a linha do B/L.
 */
function describeContainerRemovalBlocks(
  existing: ExistingBl,
  payload: BlFreightRpcPayload,
  blockers: ContainerRemovalBlockers,
): string[] {
  const blockedReasons: string[] = []
  const incomingContainers = new Set(payload.containers.map((container) => container.container_number))
  for (const { number, ids } of missingContainerEntries(existing, incomingContainers)) {
    if (ids.some((id) => blockers.demurrageContainerIds.has(id))) {
      blockedReasons.push(`O container ${number} tem Invoice de Demurrage e não sai por reimportação.`)
      continue
    }
    const chassis = ids.flatMap((id) => blockers.vehiclesByContainer.get(id) ?? [])
    if (chassis.length) {
      blockedReasons.push(`O container ${number} sai pelo arquivo, mas tem veículos (${chassis.join(', ')}): mova ou exclua os veículos dele (planilha de Veículos ou ficha) antes de tirar o container.`)
    }
  }
  return blockedReasons
}

/**
 * POD pelo apelido conhecido ou pelo cadastro de portos (nome ou LOCODE). POD
 * que nenhum dos dois reconhece recusa a linha; o POL reconhecido pelo
 * cadastro também é gravado como LOCODE.
 */
function applyPortCatalog(payload: BlFreightRpcPayload, doc: ParsedBLDocument, ports: PortCatalogEntry[]): string | null {
  const pod = resolveCatalogPort(doc.route.pod, ports)
  const pol = resolveCatalogPort(doc.route.pol, ports)
  if (pol) payload.pol = pol
  if (pod) {
    payload.pod = pod
    return null
  }
  const declared = doc.route.pod.trim()
  return declared
    ? `POD "${declared}" não está no cadastro de portos: cadastre o porto ou corrija o arquivo.`
    : 'POD ausente no arquivo: informe o porto de descarga.'
}

function resolveCatalogPort(value: string, ports: PortCatalogEntry[]): string | null {
  const known = resolvePortCode(value)
  if (known.recognized) return known.code
  const text = normalizeText(value)
  if (!text) return null
  const byCode = ports.find((port) => port.locode && normalizeText(port.locode) === text)
  if (byCode?.locode) return byCode.locode.toUpperCase()
  const byName = ports
    .filter((port) => port.locode && port.name && normalizeText(port.name).length >= 3 && text.includes(normalizeText(port.name)))
    .sort((left, right) => normalizeText(right.name).length - normalizeText(left.name).length)[0]
  return byName?.locode ? byName.locode.toUpperCase() : null
}

/**
 * Container FCL em B/Ls de Clientes diferentes recusa a linha, como a RPC
 * (`assert_no_fcl_shared_between_customers`). B/L LCL (veículos) é aceito.
 */
function describeFclConflict(
  payload: BlFreightRpcPayload,
  existing: ExistingBl | null,
  siblings: Map<string, ContainerSibling[]>,
): string | null {
  const customerId = payload.customer_id ?? existing?.customer_id ?? null
  // B/L LCL divide container (ADR 0095, decisão 27); sem a modalidade no
  // arquivo vale a gravada. Veículos gravados também dividem (como o servidor).
  const loadType = payload.container_load_type ?? existing?.container_load_type ?? null
  const hasVehicles = (existing?.vehicles?.length ?? 0) > 0
  if (customerId == null || hasVehicles || loadType === 'LCL') return null
  for (const container of payload.containers) {
    const other = (siblings.get(container.container_number) ?? []).find((sibling) => (
      sibling.blId !== payload.id
      && sibling.customerId != null
      && sibling.customerId !== customerId
      && (sibling.loadType ?? 'FCL') !== 'LCL'
    ))
    if (other) {
      return `Container ${container.container_number} já está no B/L ${other.blId}${other.customerName ? ` (${other.customerName})` : ''}: container FCL não é dividido entre Clientes diferentes.`
    }
  }
  return null
}

async function fetchContainerSiblings(voyageId: number, blNumbers: string[], containerNumbers: string[]) {
  const siblings = new Map<string, ContainerSibling[]>()
  const numbers = [...new Set(containerNumbers.map((number) => normalizeIsoContainerNumber(number)).filter((number): number is string => Boolean(number)))]
  if (!numbers.length) return siblings
  // O container se repete em B/Ls de todas as Viagens: em páginas, porque o
  // servidor entrega no máximo 1.000 linhas por consulta (`max_rows`).
  const links = await fetchContainerLinks(numbers)
  const importing = new Set(blNumbers)
  const linkRows = links.filter((row) => row.container_number && row.bl_id && !importing.has(row.bl_id))
  const blIds = [...new Set(linkRows.map((row) => row.bl_id as string))]
  if (!blIds.length) return siblings
  type SiblingBl = { id: string; voyage_id: number | null; customer_id: number | null; container_load_type: string | null; cancelled_at: string | null }
  // ponytail: `blIds` vai inteiro na URL do `in`; com milhares de B/Ls
  // (container reutilizado em muitas Viagens) a URL cresce. Upgrade: filtrar
  // pela Viagem num join `bl_containers` → `bls!inner` em vez da lista de ids.
  const { rows: bls } = await fetchAllPages<SiblingBl>((from, to) => supabase
    .from('bls')
    .select('id, voyage_id, customer_id, container_load_type, cancelled_at')
    .in('id', blIds)
    .eq('voyage_id', voyageId)
    .order('id')
    .range(from, to)
    .overrideTypes<SiblingBl[], { merge: false }>())
  const blRows = bls.filter((bl) => bl.voyage_id === voyageId && !bl.cancelled_at)
  const customerIds = [...new Set(blRows.map((bl) => bl.customer_id).filter((id): id is number => id != null))]
  const names = customerIds.length ? await fetchCustomerSnapshots(customerIds) : new Map<number, BlCustomerSnapshot>()
  const byId = new Map(blRows.map((bl) => [bl.id, bl]))
  for (const row of linkRows) {
    const bl = byId.get(row.bl_id as string)
    if (!bl) continue
    const number = normalizeIsoContainerNumber(row.container_number)
    if (!number) continue
    siblings.set(number, [...(siblings.get(number) ?? []), {
      blId: bl.id,
      customerId: bl.customer_id,
      customerName: bl.customer_id != null ? names.get(bl.customer_id)?.name ?? null : null,
      loadType: bl.container_load_type,
    }])
  }
  return siblings
}

async function fetchPortCatalog(): Promise<PortCatalogEntry[]> {
  const { data, error } = await supabase.from('ports').select('name, locode')
  if (error) throw error
  return (data ?? []) as PortCatalogEntry[]
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

  // SOC/COC decide Drop Off e Damage Protection. Linha sem declaração no B/L
  // não muda nada por si (o Baplie preenche depois).
  const ownershipChanged = ownershipChanges(existingContainers, payload.containers).length > 0
  if (ownershipChanged) {
    messages.push('SOC/COC dos containers muda')
  }


  // B21 (ADR 0017): no B/L misto, o peso que esta importação traz é o dos
  // contêineres; o peso faturado da carga solta vem do manifesto de carga
  // solta. Só o B/L de carga solta pura tem aqui a variável de faturamento.
  const isBreakBulk = existing.cargo_mode === 'carga_solta'
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
    container: countChanged || shared.length > 0 || imoOogChanged || ownershipChanged,
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
  total_packages: 'Total de packages',
  packages_unit: 'Unidade dos packages',
  consignee_phone: 'Telefone do consignatário',
  pol: 'POL',
  pod: 'POD',
  place_of_delivery: 'Place of Delivery',
  place_of_receipt: 'Place of Receipt',
  movement_from: 'Movement From',
  movement_to: 'Movement To',
  issue_place: 'Local de emissao',
  payment_type: 'Pagamento do frete',
  bl_emission_date: 'Data de emissao',
  manifest_customer_cnpj_cpf: 'CNPJ/CPF do consignatário',
  manifest_customer_name: 'Razão social do consignatário',
  manifest_customer_email: 'E-mail do consignatário',
  ncm_codes: 'NCM',
  total_weight_kg: 'Peso total (kg)',
  total_cbm: 'CBM total',
  containers: 'Containers',
  container_ownership: 'SOC/COC dos containers',
  container_load_type: 'Modalidade (FCL/LCL)',
  bl_freight_lines: 'Frete e despesas',
}

function diffExistingBl(existing: ExistingBl, payload: BlFreightRpcPayload, impact: BillingImpact): BlFreightImportDiff[] {
  const diffs: BlFreightImportDiff[] = []
  // A Viagem não muda pela importação (ADR 0095, decisão 5): outra Viagem bloqueia a linha.
  if (payload.container_load_type) addDiff(diffs, 'container_load_type', existing.container_load_type ?? null, payload.container_load_type, false)
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
  // SOC/COC fica fora do conjunto acima; sem esta linha o B/L saia "Sem mudanca"
  // enquanto o faturamento avisava que a propriedade mudava.
  const ownership = ownershipChanges(existing.bl_containers ?? [], payload.containers)
  if (ownership.length) {
    addDiff(
      diffs,
      'container_ownership',
      ownership.map((change) => `${change.containerNumber}: ${change.from ?? '-'}`).join(', '),
      ownership.map((change) => `${change.containerNumber}: ${change.to}`).join(', '),
      impact.container,
    )
  }

  const existingFreight = normalizeFreightSet(existing.bl_freight_lines ?? [])
  const nextFreight = normalizeFreightSet(payload.freight_lines)
  addDiff(diffs, 'bl_freight_lines', existingFreight, nextFreight, false)

  return diffs
}

/**
 * Containers cujo SOC/COC declarado no B/L difere do gravado. Linha sem
 * declaracao no arquivo nao muda nada (o Baplie preenche depois); container
 * novo entra pela diferenca de conjunto, nao aqui. SOC/COC corrigido à mão
 * (`ownership_source = 'manual'`) fica: a gravação o preserva (migration 175).
 */
function ownershipChanges(
  existingContainers: NonNullable<ExistingBl['bl_containers']>,
  nextContainers: BlFreightRpcPayload['containers'],
) {
  const existingByNumber = new Map(existingContainers.map((container) => [normalizeIsoContainerNumber(container.container_number), container]))
  return nextContainers.flatMap((container) => {
    if (!container.ownership) return []
    const current = existingByNumber.get(normalizeIsoContainerNumber(container.container_number))
    if (!current || current.ownership_source === 'manual') return []
    const before = current.ownership ?? null
    if (before === container.ownership) return []
    return [{ containerNumber: container.container_number, from: before, to: container.ownership }]
  })
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
    `Cliente do B/L: ${current?.name ?? existing.manifest_customer_name ?? 'sem vínculo'} -> ${next?.name ?? payload.manifest_customer_name ?? 'cliente não cadastrado'}`,
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

  // O histórico do recebível fica com o pagador original; o novo Cliente terá outra cobrança.
  const liveReceivables = receivables.filter((receivable) => receivable.status !== 'void')
  if (liveReceivables.some((receivable) => (receivable.settledAmountBrl ?? 0) > 0)) {
    messages.push('Devolver o recebido ao Cliente original; a nova cobrança local aguarda a confirmação da restituição.')
  }

  if (targetMissing) {
    // O servidor recusa a troca quando ha qualquer financeiro vivo — fatura,
    // demurrage ou recebivel — e nao ha cliente de destino cadastrado.
    if (invoiceRows.length || liveReceivables.length) {
      blockedReasons.push(
        'Cliente do novo consignatário não está cadastrado; cadastre-o antes de reimportar para a fatura acompanhar.',
      )
    } else {
      messages.push('B/L volta para a reconciliação de Cliente até o novo consignatário ser cadastrado.')
    }
  } else if (invoiceRows.length) {
    messages.push(
      `Documentos preservados: ${invoiceRows.map((invoice) => invoice.invoiceNumber).join(', ')}. Taxas locais sem pagamento são reemitidas; com pagamento, devolver ao Cliente original antes da nova cobrança.`,
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
 * Taxas locais usam restituição/reemissão; Demurrage recebida exige devolver
 * primeiro pelo fluxo excepcional. Nenhum pagamento muda de Cliente. A Invoice
 * isenta (desconto integral, `paid` com R$ 0, migration 306) não recebeu nada:
 * não bloqueia, como em `_bl_customer_change_cash_blockers`.
 */
function describeInvoiceTransferBlock(invoice: BlInvoiceSnapshot): string | null {
  if (invoice.kind === 'demurrage' && (invoice.totalPaidBrl ?? 0) > 0) return 'devolva ao Cliente original e confirme a restituição excepcional antes de trocar o CNPJ.'
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
      manifest_customer_email, ncm_codes, container_load_type,
      bl_containers(id, container_number, seal_number, type, tare_weight_kg, gross_weight_kg, cbm, is_imo, is_oog, imo_class, un_number, ownership, ownership_source),
      bl_freight_lines(seq, description, category, mercante_code, currency, amount, payment),
      vehicles(chassis, brand, model, weight_kg, cbm, container_id)
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

/**
 * O que impede a saída de cada contêiner que o arquivo não traz, as mesmas
 * consultas da gravação (migration 175): item de Invoice de Demurrage, de
 * qualquer status, e veículos gravados no contêiner.
 */
async function fetchContainerRemovalBlockers(containerIds: number[]): Promise<ContainerRemovalBlockers> {
  const blockers: ContainerRemovalBlockers = { demurrageContainerIds: new Set(), vehiclesByContainer: new Map() }
  const ids = [...new Set(containerIds)]
  if (!ids.length) return blockers
  const [items, vehicles] = await Promise.all([
    supabase.from('demurrage_invoice_items').select('container_id').in('container_id', ids),
    supabase.from('vehicles').select('container_id, chassis').in('container_id', ids),
  ])
  if (items.error) throw items.error
  if (vehicles.error) throw vehicles.error
  for (const row of (items.data ?? []) as Array<{ container_id: number | null }>) {
    if (row.container_id != null) blockers.demurrageContainerIds.add(row.container_id)
  }
  for (const row of (vehicles.data ?? []) as Array<{ container_id: number | null; chassis: string | null }>) {
    if (row.container_id == null) continue
    blockers.vehiclesByContainer.set(row.container_id, [...(blockers.vehiclesByContainer.get(row.container_id) ?? []), row.chassis?.trim() || '(sem chassi)'])
  }
  return blockers
}

async function fetchCodBlIds(blIds: string[]) {
  if (!blIds.length) return new Set<string>()
  const { data, error } = await supabase
    .from('bl_transshipments')
    .select('bl_id, omission:voyage_omissions(reverted_at)')
    .eq('disposition', 'cod')
    .in('bl_id', blIds)
  if (error) throw error
  return new Set(
    ((data ?? []) as unknown as Array<{ bl_id: string; omission: { reverted_at: string | null } | null }>)
      .filter((row) => !row.omission?.reverted_at)
      .map((row) => row.bl_id),
  )
}

async function fetchOmittedPods(voyageId: number) {
  const { data, error } = await supabase
    .from('voyage_omissions')
    .select('omitted_pod')
    .eq('voyage_id', voyageId)
    .is('reverted_at', null)
  if (error) throw error
  return new Set(((data ?? []) as Array<{ omitted_pod: string | null }>).map((row) => row.omitted_pod).filter((pod): pod is string => Boolean(pod)))
}

type BlImportStateRow = {
  bl_id: string
  voyage_id: number | null
  voyage_label: string | null
  cancelled: boolean
  invoiced: boolean
  refix: { before: Record<string, unknown>; after: Record<string, unknown>; differs: boolean } | null
}

function readPriceSnapshot(raw: Record<string, unknown>): BlPriceSnapshot {
  const num = (value: unknown) => (value == null || value === '' ? null : Number(value))
  return {
    referenceDate: typeof raw.reference_date === 'string' ? raw.reference_date : null,
    roe: num(raw.roe),
    tables: Array.isArray(raw.tables) ? raw.tables.map(String) : [],
    conditionItems: Number(raw.condition_items ?? 0),
    totalBrl: num(raw.total_brl),
    totalUsd: num(raw.total_usd),
  }
}

/**
 * Estado dos B/Ls gravados pela régua do servidor (migration 392): Viagem,
 * cancelado, fatura emitida e preço de hoje. Uma chamada, sem o teto de 1.000
 * linhas das consultas diretas (F-05).
 */
async function fetchBlImportStates(voyageId: number, blIds: string[]) {
  const states = new Map<string, BlImportState>()
  if (!blIds.length) return states
  const { data, error } = await supabase.rpc('bl_file_import_preview' as never, { p_voyage_id: voyageId, p_bl_ids: blIds } as never)
  if (error) throw error
  for (const row of ((data ?? []) as BlImportStateRow[])) {
    const refix = row.refix && row.refix.differs && !('error' in row.refix.after)
      ? { before: readPriceSnapshot(row.refix.before), after: readPriceSnapshot(row.refix.after) }
      : null
    states.set(row.bl_id, {
      blId: row.bl_id,
      voyageId: row.voyage_id,
      voyageLabel: row.voyage_label,
      cancelled: Boolean(row.cancelled),
      invoiced: Boolean(row.invoiced),
      priceRefix: refix,
    })
  }
  return states
}

async function fetchSharedContainerNumbers(blNumbers: string[], containerNumbers: string[]) {
  const numbers = [...new Set(containerNumbers.filter(Boolean))]
  if (!numbers.length) return new Set<string>()
  const importSet = new Set(blNumbers)
  return new Set(
    (await fetchContainerLinks(numbers))
      .filter((row) => row.container_number && row.bl_id && !importSet.has(row.bl_id))
      .map((row) => row.container_number as string),
  )
}

type ContainerLink = { id: number; container_number: string | null; bl_id: string | null }

/**
 * Todos os vínculos B/L ↔ container dos números dados, de todas as Viagens, em
 * páginas: o servidor entrega no máximo 1.000 linhas por consulta (`max_rows`)
 * e o resto sumiria em silêncio.
 */
async function fetchContainerLinks(numbers: string[]): Promise<ContainerLink[]> {
  const { rows } = await fetchAllPages<ContainerLink>((from, to) => supabase
    .from('bl_containers')
    .select('id, container_number, bl_id')
    .in('container_number', numbers)
    .order('id')
    .range(from, to)
    .overrideTypes<ContainerLink[], { merge: false }>())
  return rows
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
  return `Arquivo é da viagem ${formatVoyageRef(doc.route.vessel, doc.route.voyage)}, mas você apontou ${formatVoyageRef(selectedVoyage.vesselName, selectedVoyage.voyageNumber)}.`
}

function formatVoyageRef(vessel?: string | null, voyage?: string | null) {
  const vesselLabel = String(vessel ?? '').trim() || 'Navio não informado'
  const voyageLabel = String(voyage ?? '').trim() || 'viagem não informada'
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
  // Real COSCO B/L templates write "Date Laden on Board" as plain text
  // "DD MM YYYY" (space-separated, no real date cell format) instead of
  // DD/MM/YYYY. Data civil única dos imports: ano de quatro dígitos.
  const text = /^\d{1,2}\s+\d{1,2}\s+\d{4}$/.test(trimmed) ? trimmed.split(/\s+/).join('/') : trimmed
  return importDateOrNull(text)
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
