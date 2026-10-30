import type { BoardBox, BoardGroup } from './demurrageBoard'
import type { CustomerDemurrageDetailItem, CustomerDemurrageSummary } from './demurrageKpis'

/**
 * Por Cliente (ADR 0112, D11): o que corre, o que falta emitir e o que está
 * travado, lido da classificação do banco (`list_demurrage_billing_board`,
 * migration 515), junto com as Invoices emitidas e não pagas. O grupo sem
 * Cliente (Travado por falta de Cliente) não entra: não há a quem atribuir.
 * Esperando tem coluna própria (decisão do dono de 2026-10-30, além das três
 * de D11), para o total por Cliente bater com a aba Containers.
 */
export type CustomerExposureRow = {
  customer_id: number
  customer_name: string
  cnpj_cpf: string | null
  correndo_usd: number
  a_emitir_usd: number
  esperando_usd: number
  travado_usd: number
  /** Grupos em Travado sem valor (tipo sem tarifa): o Cliente aparece mesmo sem US$ (D11). */
  travado_sem_valor: number
  invoice_count: number
  open_usd: number
  open_brl: number
}

export function buildCustomerExposure(
  groups: readonly BoardGroup[],
  invoices: readonly CustomerDemurrageSummary[],
): CustomerExposureRow[] {
  const rows = new Map<number, CustomerExposureRow>()
  const row = (id: number, name: string | null, cnpj: string | null) => {
    const existing = rows.get(id)
    if (existing) return existing
    const created: CustomerExposureRow = {
      customer_id: id, customer_name: name ?? `Cliente ${id}`, cnpj_cpf: cnpj,
      correndo_usd: 0, a_emitir_usd: 0, esperando_usd: 0, travado_usd: 0, travado_sem_valor: 0, invoice_count: 0, open_usd: 0, open_brl: 0,
    }
    rows.set(id, created)
    return created
  }
  for (const group of groups) {
    if (group.customer_id == null) continue
    // O travado por tipo sem tarifa não tem valor e ainda assim é "algo travado" (D11).
    if (group.usd <= 0 && group.division !== 'travado') continue
    const target = row(group.customer_id, group.customer_name, group.customer_cnpj)
    if (group.division === 'travado' && group.usd <= 0) target.travado_sem_valor += 1
    if (group.division === 'correndo') target.correndo_usd += group.usd
    else if (group.division === 'a_emitir') target.a_emitir_usd += group.usd
    else if (group.division === 'esperando') target.esperando_usd += group.usd
    else if (group.division === 'travado') target.travado_usd += group.usd
  }
  for (const invoice of invoices) {
    const target = row(invoice.customer_id, invoice.customer_name, invoice.cnpj_cpf)
    target.invoice_count += invoice.invoice_count
    target.open_usd += invoice.total_usd
    target.open_brl += invoice.total_brl
  }
  const exposure = (item: CustomerExposureRow) => item.correndo_usd + item.a_emitir_usd + item.esperando_usd + item.travado_usd + item.open_usd
  return Array.from(rows.values())
    .filter((item) => exposure(item) > 0 || item.invoice_count > 0 || item.travado_sem_valor > 0)
    .sort((left, right) => exposure(right) - exposure(left) || left.customer_name.localeCompare(right.customer_name, 'pt-BR'))
}

export type StatementBox = BoardBox & { division: BoardGroup['division'] }

/** Caixa com Demurrage ainda sem Invoice: correndo, devolvida com sobreestadia ou de tipo sem tarifa. */
const UNBILLED_STATES = new Set<BoardBox['state']>(['running', 'returned_overstay', 'no_rate'])

/** Extrato de um Cliente (D12): as caixas sem Invoice, pela ordem de B/L e container. */
export function customerUnbilledBoxes(groups: readonly BoardGroup[], customerId: number): StatementBox[] {
  return groups
    .filter((group) => group.customer_id === customerId)
    .flatMap((group) => group.boxes.filter((box) => UNBILLED_STATES.has(box.state)).map((box) => ({ ...box, division: group.division })))
    .sort((left, right) => left.bl_id.localeCompare(right.bl_id) || left.container_number.localeCompare(right.container_number))
}

export type CustomerStatement = {
  customer: { id: number; name: string; cnpj_cpf: string | null }
  invoices: CustomerDemurrageDetailItem[]
  boxes: StatementBox[]
}

export function statementTotals(statement: CustomerStatement) {
  return {
    invoicesUsd: statement.invoices.reduce((sum, invoice) => sum + invoice.total_usd, 0),
    invoicesBrl: statement.invoices.reduce((sum, invoice) => sum + Number(invoice.current_total_brl ?? 0), 0),
    boxesUsd: statement.boxes.reduce((sum, box) => sum + Number(box.usd ?? 0), 0),
  }
}
