import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import { containerOwnershipLabel } from '../lib/containerOwnership'
import type { BLListItem, ContainerListItem, CustomerListItem, VehicleListItem, VaziosImportacaoContainerListItem } from '../types/database'
import type { BaplieContainer } from '../types/database'
import type { LocalChargeOperationalRow } from './charges/chargeOperationsService'
import {
  reportReviewLabel,
  type CustomerReportRow,
  type FinancialReportRow,
  type OperationalReportRow,
} from './reports'
import { REPORT_LOCAL_CHARGES_STATE_LABELS, reportLocalChargesState } from '../lib/chargeStatus'
import { getInvoiceBls, getInvoicePaymentDate, invoiceTypeLabel, type InvoiceListRow } from './billing'
import { invoiceStatusLabel } from '../pages/faturamentoInvoiceStatus'
import { DEMURRAGE_INVOICE_STATUS_LABELS, FINANCIAL_STATUS_LABELS, INVOICE_STATUS_LABELS, REVIEW_STATUS_LABELS, simNao, statusLabel } from '../lib/statusLabels'
import type { DemurrageExposureRow, DemurrageItemReportRow, DemurrageReportRow } from './reports'
import { DEMURRAGE_DIVISION_LABELS } from './demurrage/demurrageDivisions'
import { boxShareLabel } from './demurrage/demurragePresentation'
import { arrivalDisplay } from '../lib/escalaState'
import { formatDate } from '../lib/utils'
import { sanitizeCellValue } from '../lib/spreadsheetSafe'
import { CARRIER_REPORT_TITLE, type CarrierReport, type CarrierReportLine } from './demurrage/demurrageCarrierReport'
import type { LineUpRow } from './lineup'
import type { PortalScheduleVoyage } from './portalScheduleVoyages'
import { scheduleExportRows, scheduleTemplateColumns } from './portalScheduleBulkImport'
import type { PortalDemurrageInvoice, PortalInvoiceSummary } from './portalBilling'
import type { PortalOperationBL } from './portalOperation'
import { blReturnSummary, localChargesView, type PortalFlatContainer } from '../lib/portalOperationViews'
import type { QueueRow } from './portalProvisioning'
import { portalProvisioningExportRow } from '../lib/portalProvisioningViewModel'
import type { CeUnlockItem, CeUnlockRequirementDates } from '../types/ceUnlock'
import { ceDateTime, ceStateLabel, ceUnlockZptText, ceVipAnnualCovered } from '../lib/ceUnlockLabels'
import { ceUnlockDeadline, formatCeUnlockDeadline } from './ceUnlockSla'
import { blTotalCbm, blTotalWeightKg, cargoModeLabel, isBreakbulkCargoMode } from '../lib/cargoMode'
import { describeChargeAdjustments } from '../lib/chargeAdjustmentSummary'
import { exportTimestamp, writeWorkbook, type SheetSpec, type WorkbookSpec } from './exportWorkbook'

// Toda planilha sai por `writeWorkbook` (src/services/exportWorkbook.ts), o
// dono da aparência (ADR 0120). Aqui ficam só as linhas de cada tela, com o
// rótulo em português que vira o cabeçalho, e o que o rótulo não diz sozinho
// (tipo da coluna, grupos, substantivo da faixa). Data sai como está no banco
// (ISO) e vira data de verdade na célula; a formatada só onde é texto.

const sheet = (name: string, rows: Record<string, unknown>[], extra: Omit<SheetSpec, 'name' | 'rows'> = {}): SheetSpec => ({ name, rows, ...extra })
const vela = (title: string, fileSlug: string, sheets: SheetSpec[], filters?: string[]): WorkbookSpec =>
  ({ product: 'vela', title, sheets, filters, fileName: `${fileSlug}-${exportTimestamp()}.xlsx` })
const portal = (title: string, fileSlug: string, sheets: SheetSpec[]): WorkbookSpec =>
  ({ product: 'portal', title, sheets, fileName: `${fileSlug}-${exportTimestamp()}.xlsx` })

export async function exportManifestWorkbook(rows: BLListItem[]) {
  const manifestRows = rows.map((row) => ({
    'B/L': row.id,
    'CE Mercante': row.ce_mercante ?? '',
    Modalidade: cargoModeLabel(row.cargo_mode),
    Armador: row.voyage?.vessel?.carrier?.name ?? '',
    SCAC: row.voyage?.vessel?.carrier?.scac ?? '',
    Navio: row.voyage?.vessel?.name ?? '',
    Viagem: row.voyage?.voyage_number ?? '',
    Consignatário: row.customer?.name ?? row.consignee ?? '',
    CNPJ: row.customer?.cnpj_cpf ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    'Containers distintos': countDistinctContainerNumbers(row.bl_containers),
    'Containers OOG distintos': countDistinctContainerNumbersBy(row.bl_containers, (container) => Boolean(container.is_oog)),
    'Containers IMO distintos': countDistinctContainerNumbersBy(row.bl_containers, (container) => Boolean(container.is_imo)),
    'Peso (kg)': blTotalWeightKg(row),
    CBM: blTotalCbm(row),
    Revisão: statusLabel(REVIEW_STATUS_LABELS, row.review_status, ''),
    Financeiro: statusLabel(FINANCIAL_STATUS_LABELS, row.financial_status, ''),
  }))

  const containerRows = rows.flatMap((row) =>
    (row.bl_containers ?? []).map((container) => ({
      Container: container.container_number,
      'B/L': row.id,
      'CE Mercante': row.ce_mercante ?? '',
      Tipo: container.type ?? '',
      Lacre: container.seal_number ?? '',
      'Peso bruto (kg)': container.gross_weight_kg ?? '',
      CBM: container.cbm ?? '',
      OOG: simNao(Boolean(container.is_oog)),
      IMO: simNao(Boolean(container.is_imo)),
      'Classe IMO': container.imo_class ?? '',
      'UN Number': container.un_number ?? '',
      Consignatário: row.customer?.name ?? row.consignee ?? '',
      CNPJ: row.customer?.cnpj_cpf ?? '',
      Armador: row.voyage?.vessel?.carrier?.name ?? '',
      Navio: row.voyage?.vessel?.name ?? '',
      Viagem: row.voyage?.voyage_number ?? '',
      POL: row.pol ?? '',
      POD: row.pod ?? '',
    })),
  )

  // Mesmas colunas do molde de importação do manifesto de carga solta: sai plana, para voltar como veio.
  const breakbulkRows = rows
    .filter((row) => isBreakbulkCargoMode(row.cargo_mode))
    .map((row) => ({
      BL: row.id,
      CE: row.ce_mercante ?? '',
      MAQUINAS: row.bb_machine_qty ?? '',
      PACKAGES: row.bb_packages_qty ?? '',
      'PACKAGES TOTAL': row.bb_packages_total ?? row.bb_packages_qty ?? '',
      'WEIGHT (TON)': row.bb_weight_ton ?? '',
      'CBM (M3)': row.bb_cbm ?? '',
      SHIPPER: row.shipper ?? '',
      CONSIGNEE: row.customer?.name ?? row.consignee ?? '',
      NOTIFY: row.notify_party ?? '',
      POL: row.pol ?? '',
      POD: row.pod ?? '',
      CNPJ: row.customer?.cnpj_cpf ?? '',
      Navio: row.voyage?.vessel?.name ?? '',
      Viagem: row.voyage?.voyage_number ?? '',
    }))

  await writeWorkbook(vela('B/Ls', 'manifestos', [
    sheet('Manifestos', manifestRows, {
      unit: 'B/Ls',
      groups: [
        { label: 'B/L', from: 'B/L', to: 'Modalidade' },
        { label: 'Viagem', from: 'Armador', to: 'Viagem' },
        { label: 'Cliente', from: 'Consignatário', to: 'CNPJ' },
        { label: 'Carga', from: 'POL', to: 'CBM' },
        { label: 'Situação', from: 'Revisão', to: 'Financeiro' },
      ],
    }),
    sheet('Containers', containerRows, { unit: 'containers' }),
    sheet('CargaSolta', breakbulkRows, { unit: 'B/Ls', plain: true, types: { 'WEIGHT (TON)': 'decimal', 'CBM (M3)': 'cbm' } }),
  ]))
}

/** Molde de reimportação de Chegadas e Saídas: cabeçalhos do importador, sem faixa nem total. */
export async function exportScheduleWorkbook(voyages: PortalScheduleVoyage[]): Promise<void> {
  const columns = scheduleTemplateColumns()
  const rows = scheduleExportRows(voyages).map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ''])))
  await writeWorkbook(vela('Programação de navios', 'programacao-navios', [
    sheet('Programacao', rows, { unit: 'viagens', plain: true, types: Object.fromEntries(columns.map((column) => [column, 'text' as const])) }),
  ]))
}

export async function exportPortalProvisioningWorkbook(rows: QueueRow[]): Promise<void> {
  await writeWorkbook(vela('Portal do Cliente', 'portal-clientes', [
    sheet('Provisionamento', rows.map(portalProvisioningExportRow), { unit: 'Clientes' }),
  ]))
}

export async function exportContainerWorkbook(rows: ContainerListItem[]) {
  const exportRows = rows.map((row) => ({
    Container: row.container_number,
    'B/L': row.bl?.id ?? '',
    Armador: row.bl?.voyage?.vessel?.carrier?.name ?? '',
    Navio: row.bl?.voyage?.vessel?.name ?? '',
    Viagem: row.bl?.voyage?.voyage_number ?? '',
    Consignatário: row.bl?.customer?.name ?? row.bl?.consignee ?? '',
    CNPJ: row.bl?.customer?.cnpj_cpf ?? '',
    POL: row.bl?.pol ?? '',
    POD: row.bl?.pod ?? '',
    Tipo: row.type ?? '',
    Lacre: row.seal_number ?? '',
    'Peso bruto (kg)': row.gross_weight_kg ?? '',
    CBM: row.cbm ?? '',
    OOG: simNao(Boolean(row.is_oog)),
    IMO: simNao(Boolean(row.is_imo)),
    'Classe IMO': row.imo_class ?? '',
    'UN Number': row.un_number ?? '',
    'SOC/COC': containerOwnershipLabel(row.ownership),
    // Rótulos da tela, sem código cru (EQU-006 até 2026-11-03 saía "pending_review").
    'Revisão do B/L': statusLabel(REVIEW_STATUS_LABELS, row.bl?.review_status, ''),
    'Financeiro do B/L': statusLabel(FINANCIAL_STATUS_LABELS, row.bl?.financial_status, ''),
  }))

  await writeWorkbook(vela('Containers', 'containers', [
    sheet('Containers', exportRows, {
      unit: 'containers',
      groups: [
        { label: 'Container', from: 'Container', to: 'Viagem' },
        { label: 'Cliente', from: 'Consignatário', to: 'CNPJ' },
        { label: 'Carga', from: 'POL', to: 'SOC/COC' },
        { label: 'B/L', from: 'Revisão do B/L', to: 'Financeiro do B/L' },
      ],
    }),
  ]))
}

export async function exportVehicleWorkbook(rows: VehicleListItem[]) {
  const exportRows = rows.map((row) => ({
    Chassi: row.chassis,
    Marca: row.brand ?? '',
    Modelo: row.model ?? '',
    'Peso (kg)': row.weight_kg ?? '',
    Cubagem: row.cbm ?? '',
    Container: row.container?.container_number ?? '',
    'Tipo Container': row.container?.type ?? '',
    Lacre: row.container?.seal_number ?? '',
    'B/L': row.bl?.id ?? '',
    'Local desova': (row.container as (typeof row.container & { unpacking_location?: string | null }) | null)?.unpacking_location ?? '',
  }))
  await writeWorkbook(vela('Veículos', 'veiculos', [sheet('Veiculos', exportRows, { unit: 'veículos', types: { Chassi: 'code', Cubagem: 'cbm' } })]))
}

export async function exportInvoicesWorkbook(rows: InvoiceListRow[]) {
  const invoiceRows = rows.map((row) => {
    const bls = getInvoiceBls(row)
    const navios = Array.from(new Set(bls.map((bl) => bl.vessel_name).filter(Boolean))).join(' / ')
      || row.voyage?.vessel?.name
      || row.bl?.voyage?.vessel?.name
      || ''
    const viagens = Array.from(new Set(bls.map((bl) => bl.voyage_number).filter(Boolean))).join(' / ')
      || row.voyage?.voyage_number
      || row.bl?.voyage?.voyage_number
      || ''
    const pods = Array.from(new Set(bls.map((bl) => bl.pod).filter(Boolean))).join(' / ')
      || row.bl?.pod
      || ''
    return {
      Fatura: row.invoice_number ?? `INV-${row.id}`,
      Cliente: row.customer?.name ?? '',
      CNPJ: row.customer?.cnpj_cpf ?? '',
      Tipo: invoiceTypeLabel(row.invoice_type),
      Situação: invoiceStatusLabel(row.status),
      Emissão: row.issued_at ?? '',
      Pagamento: getInvoicePaymentDate(row) ?? '',
      'Qtd. B/Ls': bls.length,
      'B/Ls': bls.map((bl) => bl.bl_id).join(' • '),
      Navio: navios,
      Viagem: viagens,
      POD: pods,
      'Total (R$)': Number(row.total_brl ?? 0),
      'Pago (R$)': Number(row.total_paid_brl ?? 0),
      'Saldo (R$)': Number(row.balance_brl ?? 0),
    }
  })

  const blRows = rows.flatMap((row) =>
    getInvoiceBls(row).map((bl) => ({
      Fatura: row.invoice_number ?? `INV-${row.id}`,
      Cliente: row.customer?.name ?? '',
      CNPJ: row.customer?.cnpj_cpf ?? '',
      Tipo: invoiceTypeLabel(row.invoice_type),
      'B/L': bl.bl_id,
      Navio: bl.vessel_name ?? '',
      Viagem: bl.voyage_number ?? '',
      POD: bl.pod ?? '',
      Emissão: row.issued_at ?? '',
      Pagamento: getInvoicePaymentDate(row) ?? '',
      Situação: invoiceStatusLabel(row.status),
      'Total (R$)': Number(row.total_brl ?? 0),
      'Pago (R$)': Number(row.total_paid_brl ?? 0),
      'Saldo (R$)': Number(row.balance_brl ?? 0),
    })),
  )

  await writeWorkbook(vela('Faturas · Taxas Locais', 'faturas', [
    sheet('Faturas', invoiceRows, {
      unit: 'faturas',
      groups: [
        { label: 'Fatura', from: 'Fatura', to: 'Situação' },
        { label: 'Datas', from: 'Emissão', to: 'Pagamento' },
        { label: 'Operação', from: 'Qtd. B/Ls', to: 'POD' },
        { label: 'Financeiro', from: 'Total (R$)', to: 'Saldo (R$)' },
      ],
    }),
    // Uma linha por B/L da fatura: o total é o da fatura, não se soma.
    sheet('BLs', blRows, { unit: 'B/Ls', totals: false }),
  ]))
}

/** Filtro aplicado no relatório, uma linha por filtro na aba "Filtros" da planilha e na faixa de identidade. */
export type ReportFilterLine = { Filtro: string; Valor: string }

function filtersSheet(filters: ReportFilterLine[]): SheetSpec {
  const rows = filters.length ? filters : [{ Filtro: 'Filtros', Valor: 'Nenhum' }]
  return sheet('Filtros', rows, { plain: true, types: { Filtro: 'long', Valor: 'long' } })
}

const filterLines = (filters: ReportFilterLine[]) => filters.map((line) => `${line.Filtro} = ${line.Valor}`)

/** Histórico de ações (Administração): uma linha por campo, montada na tela com os nomes. */
export async function exportActionHistoryWorkbook(rows: Record<string, unknown>[], filters: ReportFilterLine[] = []) {
  await writeWorkbook(vela('Histórico de ações', 'historico-de-acoes', [
    sheet('Histórico', rows, { unit: 'linhas', types: { 'O que mudou': 'long', Motivo: 'long', De: 'long', Para: 'long' } }),
    filtersSheet(filters),
  ], filterLines(filters)))
}

/** Relatórios › Prazo do ADR: uma linha por ADR fechado, por equipe, nunca por pessoa. */
export async function exportAdrDeadlineWorkbook(rows: Record<string, unknown>[], filters: ReportFilterLine[] = []) {
  await writeWorkbook(vela('Prazo do ADR', 'prazo-do-adr', [
    sheet('Prazo do ADR', rows, { unit: 'ADRs' }),
    filtersSheet(filters),
  ], filterLines(filters)))
}

/** Colunas da planilha do relatório com os mesmos rótulos da tela, sem código cru. */
export async function exportOperationalReportWorkbook(rows: OperationalReportRow[], filters: ReportFilterLine[] = []) {
  const exportRows = rows.map((row) => ({
    // Rótulos da tela (ACE-D08).
    'B/L': row.id,
    Modalidade: cargoModeLabel(row.cargo_mode),
    Armador: row.voyage?.vessel?.carrier?.name ?? '',
    Navio: row.voyage?.vessel?.name ?? '',
    Viagem: row.voyage?.voyage_number ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Cliente: row.customer?.name ?? '',
    CNPJ: row.customer?.cnpj_cpf ?? '',
    Containers: (row.bl_containers ?? []).length,
    'Peso (kg)': blTotalWeightKg(row),
    CBM: blTotalCbm(row),
    Revisão: reportReviewLabel(row.review_status),
    'Taxas locais': REPORT_LOCAL_CHARGES_STATE_LABELS[reportLocalChargesState(row.charge_status, row.financial_status, row.cancelled_at)],
    'Criação do B/L': row.created_at ?? '',
  }))

  await writeWorkbook(vela('Relatório operacional', 'relatorio-operacional', [
    sheet('Operacional', exportRows, { unit: 'B/Ls', types: { 'Taxas locais': 'status' } }),
    filtersSheet(filters),
  ], filterLines(filters)))
}

export async function exportFinancialReportWorkbook(rows: FinancialReportRow[], filters: ReportFilterLine[] = []) {
  const exportRows = rows.map((row) => ({
    Fatura: row.invoice_number ?? `INV-${row.id}`,
    Cliente: row.customer?.name ?? '',
    CNPJ: row.customer?.cnpj_cpf ?? '',
    Emissão: row.issued_at ?? '',
    'Total (R$)': Number(row.total_brl ?? 0),
    'Saldo (R$)': Number(row.balance_brl ?? 0),
    Situação: statusLabel(INVOICE_STATUS_LABELS, row.status, ''),
  }))

  await writeWorkbook(vela('Relatório financeiro', 'relatorio-financeiro', [
    sheet('Financeiro', exportRows, { unit: 'faturas' }),
    filtersSheet(filters),
  ], filterLines(filters)))
}

export async function exportCustomerReportWorkbook(rows: CustomerReportRow[], filters: ReportFilterLine[] = []) {
  const exportRows = rows.map((row) => ({
    Cliente: row.name,
    CNPJ: row.cnpj_cpf,
    'B/Ls': row.blCount,
    'Peso (kg)': row.totalWeightKg,
    CBM: row.totalCbm,
    Faturas: row.invoiceCount,
    'Emitido (R$)': row.totalIssued,
    'Em aberto (R$)': row.totalBalance,
  }))

  await writeWorkbook(vela('Relatório por Cliente', 'relatorio-clientes', [
    sheet('Clientes', exportRows, { unit: 'Clientes', types: { 'B/Ls': 'int' }, totals: ['B/Ls', 'Faturas'] }),
    filtersSheet(filters),
  ], filterLines(filters)))
}

const usdCell = (value: number | string | null | undefined) => (value == null ? '' : Number(value))

/** Colunas da Exposição (ADR 0112, D13): a mesma da tela e da aba Containers. */
export function demurrageExposureSheetRows(rows: readonly DemurrageExposureRow[]) {
  return rows.map((row) => ({
    Divisão: DEMURRAGE_DIVISION_LABELS[row.division],
    Motivo: row.division === 'travado' ? row.reason ?? '' : '',
    Cliente: row.customer_name ?? 'Sem Cliente',
    'Navio / Viagem': row.voyage_label ?? '',
    'B/L': row.bl_id,
    Container: row.container_number,
    Tipo: row.type ?? '',
    Descarga: row.discharge_date ?? '',
    Devolução: row.return_date ? row.return_date : 'Fora',
    Dias: row.total_days ?? '',
    'Free time': row.free_days ?? '',
    'US$ previsto': row.state === 'no_rate' ? 'Tipo sem tarifa' : usdCell(row.usd),
  }))
}

export function demurrageInvoiceSheetRows(rows: readonly DemurrageReportRow[]) {
  return rows.map((row) => ({
    Invoice: row.doc_number ?? '',
    Tipo: row.kind.doc ? `${row.kind.label} ${row.kind.doc}` : row.kind.label,
    'B/L': row.bl_id ?? '',
    'Navio / Viagem': [row.bl?.voyage?.vessel?.name, row.bl?.voyage?.voyage_number].filter(Boolean).join(' / '),
    Cliente: row.customer?.name ?? '',
    CNPJ: row.customer?.cnpj_cpf ?? '',
    Emissão: row.billed_at ?? '',
    'USD líquido': row.net_usd,
    'Desconto US$': row.discount_usd,
    'R$ hoje': row.status === 'issued' || row.status === 'overdue' ? Number(row.current_total_brl ?? 0) : '',
    'R$ pago': row.status === 'paid' ? Number(row.current_total_brl ?? 0) : '',
    'Paga em': row.paid_at ?? '',
    Disputa: row.dispute_open ? 'Aberta' : '',
    Situação: statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, row.status, ''),
  }))
}

export function demurrageItemSheetRows(rows: readonly DemurrageItemReportRow[]) {
  return rows.map((row) => ({
    Invoice: row.invoice.doc_number,
    Situação: statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, row.invoice.status, ''),
    Emissão: row.invoice.billed_at ?? '',
    Cliente: row.invoice.customer?.name ?? '',
    'Navio / Viagem': [row.invoice.bl?.voyage?.vessel?.name, row.invoice.bl?.voyage?.voyage_number].filter(Boolean).join(' / '),
    'B/L': row.invoice.bl_id,
    Container: row.container_number,
    Tipo: row.container_type ?? '',
    Descarga: row.discharge_date ?? '',
    Devolução: row.return_date ?? '',
    Dias: row.total_days ?? '',
    'Free time': row.free_days ?? '',
    '1º período (dias)': row.days_p1 ?? '',
    '1º período (US$/dia)': usdCell(row.rate_p1_usd),
    '2º período (dias)': row.days_p2 ?? '',
    '2º período (US$/dia)': usdCell(row.rate_p2_usd),
    US$: usdCell(row.subtotal_usd),
    'Parte do container': boxShareLabel(row.box_share_count) ?? '',
  }))
}

/** Planilha de Demurrage de /relatorios (D14): uma aba por recorte, mais Filtros. */
export async function exportDemurrageReportWorkbook(
  report: { exposure: readonly DemurrageExposureRow[]; invoices: readonly DemurrageReportRow[]; items: readonly DemurrageItemReportRow[] },
  filters: ReportFilterLine[] = [],
) {
  await writeWorkbook(vela('Relatório de Demurrage', 'relatorio-demurrage', [
    sheet('Exposição', demurrageExposureSheetRows(report.exposure), { unit: 'containers' }),
    sheet('Invoices', demurrageInvoiceSheetRows(report.invoices), { unit: 'Invoices' }),
    // A tarifa por dia não se soma; o subtotal em US$ sim.
    sheet('Itens por container', demurrageItemSheetRows(report.items), { unit: 'containers', types: { '1º período (US$/dia)': 'decimal', '2º período (US$/dia)': 'decimal' } }),
    filtersSheet(filters),
  ], filterLines(filters)))
}

const CARRIER_HEADERS = ['INVOICE', 'BL', 'VESSEL', 'POL', 'POD', 'CNEE', 'CONTAINER', 'TYPE', 'DISCHARGE', 'RETURN', 'USE DAYS', 'EXCESS', 'TOTAL USD']
/** Larguras do modelo enviado ao armador (caracteres). */
const CARRIER_WIDTHS = [15, 21, 23, 11, 11, 37, 15, 8, 13, 13, 11, 10, 12]
/** Formato 14 do Excel, o do modelo: a data aparece no padrão regional de quem abre. */
const CARRIER_DATE_FORMAT = 'm/d/yy'
const CARRIER_USD_FORMAT = '"US$"\\ #,##0.00'
const CARRIER_DATE_COLUMNS = [8, 9]
const CARRIER_USD_COLUMN = 12

/** Data `YYYY-MM-DD` como número de série do Excel (dias desde 30/12/1899), sem fuso. */
export function excelDateSerial(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000
}

function carrierRow(line: CarrierReportLine): Array<string | number | null> {
  return [
    line.first, line.bl, line.vessel, line.pol, line.pod, line.cnee, line.container, line.type,
    line.discharge ? excelDateSerial(line.discharge) : null,
    line.returned ? excelDateSerial(line.returned) : null,
    line.useDays, line.excess, line.totalUsd,
  ].map((value) => (value == null ? null : sanitizeCellValue(value)))
}

/**
 * Uma aba no layout do armador: título mesclado na linha 1, linha 2 mesclada
 * (vazia no modelo; no não faturado, a data da posição), cabeçalho na linha 3
 * e uma linha por container a partir da 4.
 * ponytail: a biblioteca de planilha da aplicação não grava estilo (negrito,
 * borda, quebra de linha do CNEE); o conteúdo, a ordem, os formatos de data e
 * US$ e as larguras são os do modelo. Para estilizar, trocar por uma
 * biblioteca que grave estilos só nesta planilha.
 */
function carrierSheet(XLSX: typeof import('@e965/xlsx'), firstHeader: string, subtitle: string, lines: readonly CarrierReportLine[]) {
  const headers = [firstHeader, ...CARRIER_HEADERS.slice(1)]
  const sheet = XLSX.utils.aoa_to_sheet([[CARRIER_REPORT_TITLE], [subtitle || null], headers, ...lines.map(carrierRow)])
  lines.forEach((_line, index) => {
    const row = index + 3
    for (const column of [...CARRIER_DATE_COLUMNS, CARRIER_USD_COLUMN]) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]
      if (cell) cell.z = column === CARRIER_USD_COLUMN ? CARRIER_USD_FORMAT : CARRIER_DATE_FORMAT
    }
  })
  const last = headers.length - 1
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: last } }, { s: { r: 1, c: 0 }, e: { r: 1, c: last } }]
  sheet['!cols'] = CARRIER_WIDTHS.map((wch, column) => ({ wch: column === 0 && firstHeader !== 'INVOICE' ? 46 : wch }))
  return sheet
}

/**
 * Planilha do armador (issue #1139): aba `Demurrage` com as Invoices em
 * aberto, no layout que a equipe já envia, e aba `Not Invoiced` com a
 * Demurrage ainda sem Invoice, calculada até a data da posição.
 */
export function buildDemurrageCarrierWorkbook(XLSX: typeof import('@e965/xlsx'), report: CarrierReport) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, carrierSheet(XLSX, 'INVOICE', '', report.invoiced), 'Demurrage')
  const position = formatDate(report.positionDate)
  XLSX.utils.book_append_sheet(
    workbook,
    carrierSheet(XLSX, 'STATUS', `Demurrage ainda não faturada — posição em ${position}; container não devolvido calculado até essa data.`, report.pending),
    'Not Invoiced',
  )
  return workbook
}

export async function exportDemurrageCarrierWorkbook(report: CarrierReport) {
  const XLSX = await import('@e965/xlsx')
  XLSX.writeFile(buildDemurrageCarrierWorkbook(XLSX, report), `Demurrage_Report_${report.positionDate}.xlsx`)
}

/** Exportar de uma aba da central de Demurrage (D14): o que está na tela, com as colunas da tela. */
export async function exportDemurrageScreenWorkbook(sheetName: string, fileSlug: string, rows: Array<Record<string, unknown>>) {
  await writeWorkbook(vela(`Demurrage · ${sheetName}`, `demurrage-${fileSlug}`, [sheet(sheetName, rows)]))
}

/**
 * Linhas da planilha comum do Desbloqueio de CE. Requisito atendido mostra a data
 * e a hora em que se cumpriu (migration 590, pedido do dono de 2026-11-04; antes,
 * "Atendido"); sem a data na fonte, "Atendido". Pendente, dispensado e isento
 * seguem em texto.
 */
export function ceUnlockWorkbookRows(rows: CeUnlockItem[], dates: ReadonlyMap<string, CeUnlockRequirementDates> = new Map()) {
  const when = (value: string | null | undefined) => (value ? ceDateTime(value).replace(', ', ' ') : 'Atendido')
  const met = (ok: boolean, at: string | null | undefined) => (ok ? when(at) : 'Pendente')
  // Sem solicitação ou em rascunho VIP, o VIP coberto pelos anuais (migrations 576 e 579) diz que é o anual.
  const doc = (row: CeUnlockItem, ok: boolean, at: string | null | undefined) =>
    ceVipAnnualCovered(row) && ok ? `${when(at)} · anual VIP` : met(ok, at)
  return rows.map((row) => {
    const at = dates.get(row.bl_id)
    return {
    'B/L': row.bl_id,
    'CE Mercante': row.ce_mercante ?? '',
    Cliente: row.customer_name ?? '',
    'CNPJ/CPF': row.cnpj_cpf ?? '',
    Navio: row.vessel_name ?? '',
    Viagem: row.voyage_number ?? '',
    POD: row.pod ?? '',
    Solicitação: row.protocol ?? (row.documents_dispensed ? 'Dispensada · veículo LCL' : row.direct && row.vip_direct ? 'Dispensada · VIP' : ''),
    Situação: ceStateLabel(row.state),
    // Veículo LCL isento (migration 575): termo e procuração dispensados, não "atendidos".
    'Termo de devolução': row.documents_dispensed ? 'Dispensado' : doc(row, row.termo, at?.termo_at),
    Procuração: row.documents_dispensed ? 'Dispensada' : doc(row, row.procuracao, at?.procuracao_at),
    // Taxas Locais isentas (migration 279): atendido sem pagamento, sem data.
    'Taxas locais': row.paid && row.paid_exempt ? 'Isentas' : met(row.paid, at?.paid_at),
    'B/L original': met(row.delivered, at?.delivered_at),
    Prazo: row.sla_started_at ? formatCeUnlockDeadline(ceUnlockDeadline(row.sla_started_at)) : '',
    'Na ZPT': ceUnlockZptText(row).text,
    }
  })
}

/** Planilha comum do recorte inteiro do Desbloqueio de CE (aba Andamento dos B/Ls); a planilha da ZPT é outra. */
export async function exportCeUnlockWorkbook(rows: CeUnlockItem[], dates?: ReadonlyMap<string, CeUnlockRequirementDates>) {
  const exportRows = ceUnlockWorkbookRows(rows, dates)
  await writeWorkbook(vela('Desbloqueio de CE', 'desbloqueio-ce', [
    sheet('Desbloqueio de CE', exportRows, {
      unit: 'B/Ls',
      groups: [
        { label: 'B/L', from: 'B/L', to: 'POD' },
        { label: 'Desbloqueio', from: 'Solicitação', to: 'Situação' },
        { label: 'Requisitos', from: 'Termo de devolução', to: 'B/L original' },
        { label: 'ZPT', from: 'Prazo', to: 'Na ZPT' },
      ],
    }),
  ]))
}

export function customerExportEmails(contacts: CustomerListItem['customer_contacts']) {
  const active = (contacts ?? []).filter((contact) => !contact.deactivated_at && String(contact.email ?? '').trim())
  const ordered = [...active.filter((contact) => contact.is_primary), ...active.filter((contact) => !contact.is_primary)]
  return Array.from(new Set(ordered.map((contact) => String(contact.email).trim()))).join('; ')
}

/** Base de Clientes no formato da importação: cabeçalhos do importador, sem faixa nem total, para corrigir e importar de volta. */
export async function exportCustomerBaseWorkbook(rows: CustomerListItem[]) {
  const exportRows = rows.map((row) => ({
    CNPJ: row.cnpj_cpf ?? '',
    'Razao Social': row.name ?? '',
    'Nome Fantasia': row.trade_name ?? '',
    // Mesma coluna que a importação lê: e-mails ativos, o principal primeiro.
    Email: customerExportEmails(row.customer_contacts),
    Endereco: row.address ?? '',
    Cidade: row.city ?? '',
    UF: row.state ?? '',
    CEP: row.zip ?? '',
  }))

  await writeWorkbook(vela('Base de Clientes', 'base-clientes', [
    sheet('BaseClientes', exportRows, { unit: 'Clientes', plain: true, types: { CNPJ: 'text', CEP: 'text' } }),
  ]))
}

const VAZIO_NATUREZA_LABELS: Record<string, string> = { cama: 'Cama', cover_plate: 'Cover plate' }

/**
 * Planilha de Vazios de importação: as colunas da tela, com a Natureza (único
 * dado editado na tela, achado V5 do lote 5b) e o Nº do manifesto Mercante da
 * rota, que quem chama resolve (`vazioManifestoNumero`).
 */
export async function exportVaziosImportacaoWorkbook(rows: Array<VaziosImportacaoContainerListItem & { manifesto_numero?: string | null }>) {
  const exportRows = rows.map((row) => ({
    Container: row.container_number,
    Tipo: row.container_type ?? '',
    'Tara (kg)': row.tare_kg ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Natureza: row.natureza ? VAZIO_NATUREZA_LABELS[row.natureza] ?? row.natureza : '',
    Navio: row.manifest?.voyage?.vessel?.name ?? '',
    Viagem: row.manifest?.voyage?.voyage_number ?? '',
    'Manifesto Mercante': row.manifesto_numero ?? '',
    'Importado em': row.manifest?.imported_at ?? '',
  }))

  await writeWorkbook(vela('Vazios de importação', 'vazios-importacao', [
    sheet('VaziosImportacao', exportRows, { unit: 'containers', types: { Natureza: 'text', 'Manifesto Mercante': 'text' } }),
  ]))
}

export async function exportBaplieWorkbook(rows: BaplieContainer[]) {
  const exportRows = rows.map((row) => ({
    Container: row.container_number,
    Situação: row.status === 'empty' ? 'Vazio' : row.status === 'full' ? 'Cheio' : (row.status ?? ''),
    Tipo: row.size_type ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Slot: row.slot ?? '',
    'B/L ref': row.bl_ref ?? '',
    'Destino final': row.final_dest ?? '',
    Perfil: row.is_imo ? 'IMO' : row.is_oog ? 'OOG' : 'Padrão',
    IMO: simNao(Boolean(row.is_imo)),
    'Classe IMO': row.imo_class ?? '',
    'UN Number': row.un_number ?? '',
    OOG: simNao(Boolean(row.is_oog)),
    'SOC/COC': containerOwnershipLabel(row.ownership),
    'Peso (kg)': row.weight_kg ?? '',
    'Importado em': row.imported_at ?? '',
  }))

  await writeWorkbook(vela('Baplie EDI', 'baplie-edi', [sheet('Baplie EDI', exportRows, { unit: 'containers', types: { Perfil: 'text' } })]))
}

// --- Portal do cliente ---------------------------------------------------
// Exportacoes do portal espelham as colunas exibidas nas telas, escopadas ao
// cliente autenticado. Sempre .xlsx, nunca CSV.

export async function exportPortalLocalInvoicesWorkbook(rows: PortalInvoiceSummary[]) {
  const exportRows = rows.map((row) => ({
    'B/L': (row.bls ?? []).join(' • '),
    Fatura: row.invoice_number ?? `INV-${row.id}`,
    Tipo: invoiceTypeLabel(row.invoice_type),
    'Navio/Viagem': (row.vessel_voyages ?? []).join(' / '),
    POD: (row.pods ?? []).join(' / '),
    Emissão: row.issued_at ?? '',
    'Total (R$)': Number(row.total_brl ?? 0),
    'Pago (R$)': Number(row.total_paid_brl ?? 0),
    'Saldo (R$)': Number(row.balance_brl ?? 0),
    Situação: row.status ?? '',
  }))

  await writeWorkbook(portal('Faturas de Taxas locais', 'faturas-taxas-locais', [
    sheet('TaxasLocais', exportRows, {
      unit: 'faturas',
      groups: [
        { label: 'Fatura', from: 'B/L', to: 'Tipo' },
        { label: 'Operação', from: 'Navio/Viagem', to: 'Emissão' },
        { label: 'Financeiro', from: 'Total (R$)', to: 'Situação' },
      ],
    }),
  ]))
}

export async function exportPortalDemurrageWorkbook(rows: PortalDemurrageInvoice[]) {
  const exportRows = rows.map((row) => ({
    Documento: row.doc_number,
    'B/L': row.bl_id,
    'Navio/Viagem': [row.vessel_name, row.voyage_number].filter(Boolean).join(' / '),
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Emissão: row.billed_at ?? row.doc_date ?? '',
    Vencimento: row.due_date ?? '',
    'Total (US$)': Number(row.total_usd ?? 0),
    'Total (R$)': row.current_total_brl != null ? Number(row.current_total_brl) : '',
    Situação: row.status ?? '',
  }))

  await writeWorkbook(portal('Faturas de Demurrage', 'faturas-demurrage', [sheet('Demurrage', exportRows, { unit: 'Invoices' })]))
}

export async function exportPortalBlsWorkbook(rows: PortalOperationBL[]) {
  const exportRows = rows.map((row) => ({
    'B/L': row.bl_id,
    'CE Mercante': row.ce_mercante ?? '',
    Navio: row.vessel_name ?? '',
    Viagem: row.voyage_number ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Containers: row.container_count,
    Devolvidos: row.containers_returned,
    // Mesma regra da tela: sem SOC e sem container ainda não descarregado.
    'Sem devolução': blReturnSummary(row).awaiting,
    'Em demurrage': row.containers_in_demurrage,
    // Mesma conta da coluna Demurrage da tela (observação de 2026-11-01).
    'Devolvidos com demurrage': blReturnSummary(row).returnedWithDemurrage,
    ...portalBlLocalChargesColumns(row),
  }))

  await writeWorkbook(portal('B/Ls', 'bls', [
    sheet('BLs', exportRows, {
      unit: 'B/Ls',
      types: { 'Taxas locais': 'brl', Pagamento: 'status', 'Em demurrage': 'int' },
      groups: [
        { label: 'B/L', from: 'B/L', to: 'POD' },
        { label: 'Containers', from: 'Containers', to: 'Devolvidos com demurrage' },
        { label: 'Taxas locais', from: 'Taxas locais', to: 'Pagamento' },
      ],
    }),
  ]))
}

// Taxas locais e Pagamento com a mesma regra da tela: valores só de fatura
// visível; "Aguardando fatura" sem valor.
function portalBlLocalChargesColumns(row: PortalOperationBL) {
  const { total, payment } = localChargesView(row.local_charges)
  return {
    'Taxas locais': total ?? '',
    Pagamento: payment?.label ?? '',
  }
}

export async function exportPortalContainersWorkbook(rows: PortalFlatContainer[]) {
  const exportRows = rows.map((row) => ({
    Container: row.container_number,
    Tipo: row.type ?? '',
    'B/L': row.bl_id,
    'CE Mercante': row.ce_mercante ?? '',
    Navio: row.vessel_name ?? '',
    Viagem: row.voyage_number ?? '',
    POL: row.pol ?? '',
    POD: row.pod ?? '',
    Descarga: row.discharge_date ?? '',
    Devolução: row.return_date ?? '',
    'Dias de uso': row.usage_days ?? '',
    'Free time': row.free_time_days ?? '',
    'Dias em demurrage': row.demurrage_days ?? '',
    Situação: row.status,
  }))

  await writeWorkbook(portal('Containers', 'containers', [
    sheet('Containers', exportRows, {
      unit: 'containers',
      groups: [
        { label: 'Container', from: 'Container', to: 'POD' },
        { label: 'Demurrage', from: 'Descarga', to: 'Situação' },
      ],
    }),
  ]))
}

export async function exportLineUpWorkbook(rows: LineUpRow[]) {
  const exportRows = rows.map((row) => ({
    Navio: row.vesselName,
    Viagem: row.voyageNumber,
    POD: row.pod,
    Situação: row.voyageStatus === 'completed' ? 'Concluída' : row.voyageStatus === 'cancelled' ? 'Cancelada' : row.voyageStatus === 'active' ? 'Ativa' : row.voyageStatus ?? '',
    ETA: arrivalDisplay({ eta: row.eta, ata: row.ata }).value ?? '',
    ETB: row.etb ?? '',
    VIN: row.vin,
    'VIN CNTR': row.car,
    CG: row.cg,
    Total: row.total,
    MTY: row.mty,
    RTW: row.rtw ?? '',
    'BB Máquinas': row.bbMachines,
    'BB Pacotes': row.bbPackages,
    'BB Total': row.bbTotal,
    CEs: row.rowType === 'export' ? row.exportCeStatus ?? 'waiting' : row.ceStatus,
    Linked: (row.rowType === 'export' ? row.exportLinked : row.linked) ? 'Sim' : 'Não',
  }))
  await writeWorkbook(vela('Line-Up', 'painel-lineup', [
    sheet('Line-Up', exportRows, { unit: 'escalas', types: { VIN: 'int', Total: 'int', CEs: 'text' }, totals: ['VIN', 'VIN CNTR', 'CG', 'Total', 'MTY', 'BB Máquinas', 'BB Pacotes', 'BB Total'] }),
  ]))
}

/** Aba Containers da ficha do Cliente: a lista filtrada, em português, sem campos de sistema. */
export async function exportCustomerContainersWorkbook(customerName: string, rows: Array<{ row: import('./demurrage/demurrageContainers').DemurrageContainerRow; view: import('./demurrage/customerContainers').CustomerContainerView }>) {
  const demurrageText = (view: import('./demurrage/customerContainers').CustomerContainerView) => {
    const d = view.demurrage
    if (d.kind === 'soc') return 'Não se aplica (SOC)'
    // Como a tela (decisão do dono de 2026-11-03): correndo ou a emitir.
    if (d.kind === 'running') return 'Correndo'
    if (d.kind === 'to_bill') return 'A emitir'
    if (d.kind === 'invoice') return `${d.invoice.doc_number} (${statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, d.invoice.status)})`
    if (d.kind === 'waived') return 'Cobrança dispensada'
    if (d.kind === 'lcl_vehicle') return 'Cobrança suspensa (veículo LCL)'
    if (d.kind === 'error') return 'Sem tarifa para calcular'
    return ''
  }
  const exportRows = rows.map(({ row, view }) => ({
    'Container': row.container_number ?? '',
    'B/L': row.bl_id ?? '',
    'Navio / Viagem': row.bl?.voyage ? `${row.bl.voyage.vessel?.name ?? ''} / ${row.bl.voyage.voyage_number ?? ''}` : '',
    Tipo: row.type ?? '',
    'COC/SOC': containerOwnershipLabel(row.ownership),
    Descarga: row.discharge_date ?? '',
    'Devolução': row.return_date ?? '',
    Dias: view.days ?? '',
    'Free time (dias)': view.freeTimeDays ?? '',
    'Origem do free time': view.freeTimeSourceLabel ?? '',
    'Demurrage (US$)': view.demurrage.kind === 'running' || view.demurrage.kind === 'to_bill' ? view.demurrage.usd : '',
    Demurrage: demurrageText(view),
  }))
  const slug = customerName.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40)
  await writeWorkbook(vela(`Containers · ${customerName}`, `conteineres-${slug || 'cliente'}`, [
    sheet('Containers', exportRows, { unit: 'containers', types: { Demurrage: 'status' }, tones: { 'nao se aplica (soc)': 'muted', 'cobranca dispensada': 'muted' } }),
  ]))
}

/**
 * Exportação da Validação (decisão de 2026-10-14): uma planilha, uma linha por
 * B/L, colunas fixas em português e uma coluna por taxa com o total da taxa no
 * B/L; taxa em US$ ganha coluna própria "(US$)".
 */
export function buildValidacaoSheetRows(
  rows: Array<{ row: LocalChargeOperationalRow; block: { label: string; detail: string } }>,
  { totals, sharedContainers }: import('./charges/chargeOperationsService').ValidacaoExportData,
) {
  const brlCharges = new Set<string>()
  const usdCharges = new Set<string>()
  for (const byCharge of totals.values()) {
    for (const [name, value] of byCharge) (value.currency === 'USD' ? usdCharges : brlCharges).add(name)
  }
  const sorted = (set: Set<string>) => [...set].sort((left, right) => left.localeCompare(right, 'pt-BR'))
  return rows.map(({ row, block }) => {
    const byCharge = totals.get(row.id)
    const charges: Record<string, number | string> = {}
    for (const name of sorted(brlCharges)) charges[name] = byCharge?.get(name) ? Number(byCharge.get(name)!.brl.toFixed(2)) : ''
    for (const name of sorted(usdCharges)) charges[`${name} (US$)`] = byCharge?.get(name) ? Number(byCharge.get(name)!.usd.toFixed(2)) : ''
    return {
      'B/L': row.id,
      Cliente: row.customer?.name ?? '',
      CNPJ: row.customer?.cnpj_cpf ?? '',
      'Navio / Viagem': [row.voyage?.vessel?.name, row.voyage?.voyage_number].filter(Boolean).join(' / '),
      Trecho: `${row.pol ?? ''} → ${row.pod ?? ''}`,
      'Modo de carga': cargoModeLabel(row.cargo_mode),
      Motivo: block.label,
      'Detalhe do motivo': block.detail,
      'Último cálculo': row.charges_calculated_at ?? '',
      Subtotal: Number(Number(row.totals.total_brl ?? 0).toFixed(2)),
      // ADR 0038: o rateio por container tem contraparte em outro B/L da Viagem.
      'Container compartilhado': sharedContainers.get(row.id) ?? '',
      // ADR 0111: "THD: R$ 1.420,00 → R$ 1.200,00 por container; Taxa X: excluída; Isento à mão".
      'Taxas alteradas à mão': describeChargeAdjustments(row.adjustments),
      ...charges,
    }
  })
}

export async function exportValidacaoWorkbook(
  rows: Array<{ row: LocalChargeOperationalRow; block: { label: string; detail: string } }>,
  totals: import('./charges/chargeOperationsService').ValidacaoExportData,
) {
  const sheetRows = buildValidacaoSheetRows(rows, totals)
  // Toda coluna de taxa é dinheiro: a sem "(US$)" é em real, mesmo com o nome que o cadastro der.
  const fixed = new Set(['B/L', 'Cliente', 'CNPJ', 'Navio / Viagem', 'Trecho', 'Modo de carga', 'Motivo', 'Detalhe do motivo', 'Último cálculo', 'Subtotal', 'Container compartilhado', 'Taxas alteradas à mão'])
  const chargeTypes = Object.fromEntries(
    Object.keys(sheetRows[0] ?? {}).filter((key) => !fixed.has(key)).map((key) => [key, key.endsWith('(US$)') ? 'usd' as const : 'brl' as const]),
  )
  await writeWorkbook({
    product: 'vela',
    title: 'Validação de Taxas Locais',
    sheets: [sheet('Validação', sheetRows, { unit: 'B/Ls', types: { Motivo: 'status', Subtotal: 'brl', 'Container compartilhado': 'long', ...chargeTypes } })],
    fileName: `validacao-taxas-locais-${new Date().toLocaleDateString('en-CA')}.xlsx`,
  })
}
