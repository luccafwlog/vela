import { formatDate } from '../../lib/utils'
import { boxCounts, nextStep, type BoardGroup } from './demurrageBoard'
import { DEMURRAGE_DIVISION_LABELS, type DemurrageDivision } from './demurrageDivisions'
import { invoiceNetUsd } from './demurrageNetUsd'
import { daysOpen, daysToPay, destinationText, paymentMethodLabel, voyageLabel, type DemurrageInvoiceDetails } from './demurrageInvoiceView'
import type { DemurrageInvoiceListItem } from './demurrageInvoices'
import type { CustomerExposureRow } from './demurrageCustomerExposure'

/**
 * Linhas do Exportar de cada aba da central de Demurrage (ADR 0112, D14): o
 * recorte da tela, com as colunas da tela. A visão completa, com filtros, é a
 * de `/relatorios?visao=demurrage`.
 */

const date = (value: string | null | undefined) => (value ? formatDate(value) : '')

function stepText(group: BoardGroup): string {
  const step = nextStep(group)
  switch (step.kind) {
    case 'generate': return step.complement ? 'Gerar Invoice complementar' : 'Gerar Invoice'
    case 'link': return `${step.note} (${step.label})`
    default: return step.text
  }
}

export function containerTabSheetRows(groups: readonly BoardGroup[], division: DemurrageDivision) {
  return groups.map((group) => {
    const counts = boxCounts(group)
    return {
      Divisão: DEMURRAGE_DIVISION_LABELS[division],
      'B/L': group.anchor_bl_id,
      'B/Ls do grupo': group.bl_ids.join(', '),
      Cliente: group.customer_name ?? 'Sem Cliente',
      'Navio / Viagem': group.voyage_label ?? '',
      'Containers fora': counts.out,
      'Containers devolvidos': counts.returned,
      'Containers do grupo': counts.total,
      'US$ previsto hoje': Number(group.usd ?? 0),
      'Próximo passo / motivo': stepText(group),
    }
  })
}

type InvoiceTab = 'emitidas' | 'pagas' | 'canceladas'

export function invoiceTabSheetRows(tab: InvoiceTab, invoices: readonly DemurrageInvoiceListItem[], details: ReadonlyMap<number, DemurrageInvoiceDetails>) {
  return invoices.map((invoice) => {
    const net = invoiceNetUsd(invoice)
    const detail = details.get(invoice.id)
    const base = {
      Invoice: invoice.doc_number,
      'B/L': invoice.bl_id,
      'Navio / Viagem': voyageLabel(invoice) ?? '',
      Cliente: invoice.customer?.name ?? '',
      Emissão: date(invoice.billed_at),
    }
    if (tab === 'emitidas') {
      return {
        ...base,
        'Em aberto há (dias)': daysOpen(invoice.billed_at) ?? '',
        'USD a cobrar': net.netUsd,
        'Desconto US$': net.discountUsd,
        'Motivo do desconto': net.discountUsd > 0 ? invoice.discount_justification ?? '' : '',
        'BRL hoje': Number(invoice.current_total_brl ?? 0),
        'Em disputa': invoice.dispute_open ? 'Sim' : '',
        'Fora da Régua': invoice.dunning_suspended_reason ?? '',
      }
    }
    if (tab === 'pagas') {
      return {
        ...base,
        Pagamento: date(invoice.paid_at),
        'Dias até pagar': daysToPay(invoice.billed_at, invoice.paid_at) ?? '',
        'USD pago': net.netUsd,
        'BRL pago': Number(invoice.current_total_brl ?? 0),
        'ROE do pagamento': detail?.paymentRoe ?? '',
        'Meio de pagamento': paymentMethodLabel(invoice.payment_method) ?? '',
      }
    }
    return {
      ...base,
      'USD cancelado': net.netUsd,
      BRL: Number(invoice.current_total_brl ?? 0),
      Motivo: detail?.cancelReason ?? '',
      'Cancelada por': detail?.cancelledBy ?? '',
      'Cancelada em': date(detail?.cancelledAt),
      'Destino das caixas': (detail?.destinations ?? []).map(destinationText).join('; '),
    }
  })
}

export function customerTabSheetRows(rows: readonly CustomerExposureRow[]) {
  return rows.map((row) => ({
    Cliente: row.customer_name,
    CNPJ: row.cnpj_cpf ?? '',
    'Correndo (US$)': row.correndo_usd,
    'A emitir (US$)': row.a_emitir_usd,
    'Esperando (US$)': row.esperando_usd,
    'Travado (US$)': row.travado_usd,
    'Invoices em aberto': row.invoice_count,
    'Faturado em aberto (USD)': row.open_usd,
    'Faturado em aberto (BRL hoje)': row.open_brl,
  }))
}
