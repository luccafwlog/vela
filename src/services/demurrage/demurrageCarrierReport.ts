import { supabase } from '../supabase'
import { formatPortDisplayName } from '../../lib/voyageFormat'
import { formatCnpjCpf } from '../../lib/utils'
import {
  OPEN_DEMURRAGE_STATUSES,
  fetchDemurrageExposure,
  fetchDemurrageItemsReport,
  type DemurrageExposureRow,
  type DemurrageItemReportRow,
  type DemurrageReportFilters,
} from '../reports'

/**
 * Planilha de Demurrage no formato enviado ao armador (issue #1139): o layout
 * que a equipe de Demurrage já manda ao Gao, uma linha por container, com as
 * colunas INVOICE … TOTAL USD. Aba `Demurrage`: os containers das Invoices em
 * aberto (decisão do dono de 2026-11-03). Aba `Not Invoiced`: todo container
 * com sobreestadia ainda sem Invoice (a Exposição), inclusive o do B/L que
 * ainda tem container fora, calculado até hoje.
 */

export const CARRIER_REPORT_TITLE = 'TRANSHIPPING AGENCIAMENTO MARÍTIMO — Relatório de Demurrage'

export type CarrierReportLine = {
  /** Aba Demurrage: número da Invoice; aba Not Invoiced: a situação em inglês. */
  first: string
  bl: string
  vessel: string
  pol: string
  pod: string
  cnee: string
  container: string
  type: string
  /** Datas `YYYY-MM-DD`. */
  discharge: string | null
  returned: string | null
  useDays: number | null
  excess: number | null
  totalUsd: number | null
}

export type CarrierReport = {
  invoiced: CarrierReportLine[]
  pending: CarrierReportLine[]
  /** Dia de Brasília em que o não faturado foi calculado. */
  positionDate: string
}

export type CarrierReportBl = {
  id: string
  pol: string | null
  pod: string | null
  consignee: string | null
  consignee_address: string | null
  consignee_phone: string | null
  consignee_block: string | null
  customer: { name: string; cnpj_cpf: string | null; address: string | null; city: string | null; state: string | null; zip: string | null } | null
  voyage: { voyage_number: string | null; vessel: { name: string | null } | null } | null
}

const clean = (value: string | null | undefined) => (value ?? '').trim()

/**
 * CNEE em bloco de texto, como no modelo: o bloco do consignatário lido do
 * manifesto; sem ele, os campos do consignatário do B/L; sem eles, o cadastro
 * do Cliente. Nada é inventado: campo vazio fica de fora.
 */
export function carrierCneeBlock(bl: CarrierReportBl | undefined): string {
  if (!bl) return ''
  const block = clean(bl.consignee_block)
  if (block) return block
  const fromBl = [bl.consignee, bl.consignee_address, bl.consignee_phone].map(clean).filter(Boolean)
  if (fromBl.length) return fromBl.join('\n')
  const customer = bl.customer
  if (!customer) return ''
  const cityLine = [clean(customer.city), clean(customer.state)].filter(Boolean).join('-')
  const place = [cityLine, clean(customer.zip)].filter(Boolean).join(' ')
  return [
    clean(customer.name),
    clean(customer.address),
    place,
    customer.cnpj_cpf ? `CNPJ ${formatCnpjCpf(customer.cnpj_cpf)}` : '',
  ].filter(Boolean).join('\n')
}

export function carrierVesselLabel(bl: CarrierReportBl | undefined): string {
  return [clean(bl?.voyage?.vessel?.name), clean(bl?.voyage?.voyage_number)].filter(Boolean).join(' ')
}

const isoDay = (value: string | null | undefined) => (value ? value.slice(0, 10) : null)

/** Dias além do free time: os dias cobrados (1º + 2º período) ou, sem eles, dias menos free time. */
function excessDays(row: { total_days: number | null; free_days: number | null; days_p1: number | null; days_p2: number | null }) {
  if (row.days_p1 != null || row.days_p2 != null) return Number(row.days_p1 ?? 0) + Number(row.days_p2 ?? 0)
  if (row.total_days == null || row.free_days == null) return null
  return Math.max(0, Number(row.total_days) - Number(row.free_days))
}

function blColumns(bl: CarrierReportBl | undefined, blId: string) {
  return {
    bl: blId,
    vessel: carrierVesselLabel(bl),
    pol: bl?.pol ? formatPortDisplayName(bl.pol) : '',
    pod: bl?.pod ? formatPortDisplayName(bl.pod) : '',
    cnee: carrierCneeBlock(bl),
  }
}

/** Aba Demurrage: um item de Invoice em aberto por linha, da emissão mais antiga para a mais recente. */
export function carrierInvoicedLines(items: readonly DemurrageItemReportRow[], bls: ReadonlyMap<string, CarrierReportBl>): CarrierReportLine[] {
  return [...items]
    .sort((left, right) => (left.invoice.billed_at ?? '').localeCompare(right.invoice.billed_at ?? '')
      || left.invoice.doc_number.localeCompare(right.invoice.doc_number)
      || left.container_number.localeCompare(right.container_number))
    .map((item) => {
      const blId = item.container?.bl_id ?? item.invoice.bl_id
      return {
        first: item.invoice.doc_number,
        ...blColumns(bls.get(blId), blId),
        container: item.container_number,
        type: item.container_type ?? '',
        discharge: isoDay(item.discharge_date),
        returned: isoDay(item.return_date),
        useDays: item.total_days,
        excess: excessDays(item),
        // Já é a parte do Cliente quando o container é dividido (migration 521); o desconto fica na Invoice.
        totalUsd: item.subtotal_usd == null ? null : Number(item.subtotal_usd),
      }
    })
}

/**
 * Situação do container sem Invoice, para o armador, sem o motivo interno
 * (CE, Portal, Cliente): fora; devolvido esperando os outros do B/L; ou
 * pronto para faturar. Tipo sem tarifa sai sem valor.
 */
export function carrierPendingStatus(row: Pick<DemurrageExposureRow, 'state' | 'return_date' | 'division'>): string {
  if (row.state === 'no_rate') return 'RATE UNDER REVIEW'
  if (!row.return_date) return 'NOT RETURNED (CALCULATED TO DATE)'
  if (row.division === 'correndo' || row.division === 'esperando') return 'RETURNED - AWAITING OTHER CONTAINERS OF THE B/L'
  return 'RETURNED - TO BE INVOICED'
}

/** Aba Not Invoiced: cada container com sobreestadia sem Invoice, por B/L e container. */
export function carrierPendingLines(rows: readonly DemurrageExposureRow[], bls: ReadonlyMap<string, CarrierReportBl>): CarrierReportLine[] {
  return [...rows]
    .sort((left, right) => left.bl_id.localeCompare(right.bl_id) || left.container_number.localeCompare(right.container_number))
    .map((row) => ({
      first: carrierPendingStatus(row),
      ...blColumns(bls.get(row.bl_id), row.bl_id),
      container: row.container_number,
      type: row.type ?? '',
      discharge: isoDay(row.discharge_date),
      returned: isoDay(row.return_date),
      useDays: row.total_days,
      excess: excessDays(row),
      totalUsd: row.state === 'no_rate' || row.usd == null ? null : Number(row.usd),
    }))
}

// ponytail: ids em lotes de 200 para a URL não estourar, como os irmãos das Invoices em reports.ts.
const BL_BATCH = 200

async function fetchCarrierReportBls(ids: readonly string[]): Promise<Map<string, CarrierReportBl>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const bls = new Map<string, CarrierReportBl>()
  for (let start = 0; start < unique.length; start += BL_BATCH) {
    const { data, error } = await supabase
      .from('bls')
      .select(`id, pol, pod, consignee, consignee_address, consignee_phone, consignee_block,
        customer:customers!bls_customer_id_fkey(name, cnpj_cpf, address, city, state, zip),
        voyage:voyages(voyage_number, vessel:vessels(name))`)
      .in('id', unique.slice(start, start + BL_BATCH))
      .overrideTypes<CarrierReportBl[], { merge: false }>()
    if (error) throw error
    for (const bl of data ?? []) bls.set(bl.id, bl)
  }
  return bls
}

/**
 * Lê as duas abas com os filtros da tela: Invoices em aberto pela emissão,
 * Cliente e Navio / Viagem; o não faturado é o de hoje (sem período nem
 * Divisão), só com Cliente e Navio / Viagem.
 */
export async function fetchDemurrageCarrierReport(filters: DemurrageReportFilters, positionDate: string): Promise<CarrierReport> {
  const [items, exposure] = await Promise.all([
    fetchDemurrageItemsReport(filters, { ceiling: Number.POSITIVE_INFINITY, statuses: OPEN_DEMURRAGE_STATUSES }),
    fetchDemurrageExposure({ ...filters, division: '' }),
  ])
  const bls = await fetchCarrierReportBls([
    ...items.rows.map((item) => item.container?.bl_id ?? item.invoice.bl_id),
    ...exposure.rows.map((row) => row.bl_id),
  ])
  return {
    invoiced: carrierInvoicedLines(items.rows, bls),
    pending: carrierPendingLines(exposure.rows, bls),
    positionDate,
  }
}
