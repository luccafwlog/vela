import React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { InvoiceDetail } from '../../services/billing'
import type { InvoiceItem } from '../../types/database'
import { formatDate, stripBlPrefix } from '../../lib/utils'
import {
  cell,
  classifyInvoiceItem,
  describeUsdConversionNote,
  DOC_BORDER,
  DOC_GROUP,
  DOC_MUTED,
  DOC_NAVY,
  DOC_SUBTOTAL,
  documentRoot,
  fmtBRL,
  fmtCNPJ,
  fmtQuantity,
  labelCell,
  zebraRow,
} from '../shared/invoiceFormat'
import {
  InvoiceDocFooter,
  InvoiceDocHeader,
  InvoiceDocTitle,
  InvoiceTotalBox,
  InvoiceTotalLine,
  PIX_SETTLEMENT_NOTE,
  PixCopyPaste,
  PixPreparingNotice,
} from '../shared/InvoiceDocumentKit'

type Props = { detail: InvoiceDetail; type?: 'invoice' | 'receipt' }

function sharedQuantityLabel(item: InvoiceItem): string | null {
  const snapshot = item.snapshot_payload
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const label = (snapshot as Record<string, unknown>).shared_quantity_label
    if (typeof label === 'string' && label.trim()) return label
  }
  return null
}

function invoiceQuantity(item: InvoiceItem) {
  const sharedQuantity = sharedQuantityLabel(item)
  return (
    <>
      {sharedQuantity ?? fmtQuantity(item.quantity ?? 1)}
      {sharedQuantity && (
        <div style={{ marginTop: 2, fontSize: '12px', lineHeight: 1.2, color: DOC_MUTED }}>
          Fração do container compartilhado
        </div>
      )}
    </>
  )
}

function formatContainersMetadata(bls: InvoiceDetail['bls'], items: InvoiceItem[]): string | null {
  const list: string[] = []
  for (const bl of bls) {
    const raw = (bl as Record<string, unknown>).containers
    if (Array.isArray(raw) && raw.length > 0) {
      const formatted = raw
        .map((c) => {
          if (typeof c === 'string') return c
          if (c && typeof c === 'object') {
            const num = (c as { container_number?: string }).container_number
            const typ = (c as { type?: string }).type
            return typ ? `${num} (${typ})` : num
          }
          return String(c)
        })
        .filter(Boolean)
        .join(', ')
      if (formatted) list.push(formatted)
    } else if (typeof (bl as Record<string, unknown>).containers_display === 'string') {
      list.push((bl as Record<string, unknown>).containers_display as string)
    }
  }

  if (list.length > 0) return list.join('; ')

  const found: string[] = []
  for (const item of items) {
    const matches = item.description?.match(/[A-Z]{4}\d{7}/g)
    if (matches) {
      for (const m of matches) {
        if (!found.includes(m)) found.push(m)
      }
    }
  }
  return found.length > 0 ? found.join(', ') : null
}

function formatBreakbulkMetadata(bls: InvoiceDetail['bls'], items: InvoiceItem[]): string | null {
  const list: string[] = []
  for (const bl of bls) {
    const rawDisplay = (bl as Record<string, unknown>).bb_display
    if (typeof rawDisplay === 'string' && rawDisplay.trim()) {
      list.push(rawDisplay.trim())
      continue
    }
    const weightTon = (bl as Record<string, unknown>).bb_weight_ton
    const packagesQty = (bl as Record<string, unknown>).bb_packages_qty
    if (weightTon != null && Number(weightTon) > 0) {
      const wFormatted = Number(weightTon).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
      const pkgStr = packagesQty != null && Number(packagesQty) > 0 ? ` | ${packagesQty} packages` : ''
      list.push(`Peso BB: ${wFormatted} ton${pkgStr}`)
    }
  }

  if (list.length > 0) return list.join('; ')

  for (const item of items) {
    if (classifyInvoiceItem(item) === 'carga_solta') {
      const match = item.description?.match(/(\d+(?:[.,]\d+)?)\s*ton/i)
      if (match) {
        return `Peso BB: ${match[1]} ton`
      }
    }
  }
  return null
}

// Linhas de item da fatura. Lote 6b: as taxas do B/L ficam logo abaixo da
// linha do B/L, sem a antiga divisão por tipo de carga (contêiner, carga
// solta, documental) nem os subtotais dessas divisões.
function renderItemRows(rowItems: InvoiceItem[], itemFlatIndex: Map<number | string, number>) {
  return rowItems.map((item) => {
    const usdNote = describeUsdConversionNote(item)
    return (
      <tr key={item.id} style={zebraRow(itemFlatIndex.get(item.id) ?? 0)}>
        <td style={{ padding: '8px 8px 8px 16px' }}>
          {stripBlPrefix(item.description, item.bl_id)}
          {usdNote && <div style={{ fontSize: '12px', color: DOC_MUTED }}>{usdNote}</div>}
        </td>
        <td style={{ padding: '8px 7px', textAlign: 'center' }}>{invoiceQuantity(item)}</td>
        <td style={{ padding: '8px 7px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtBRL(item.unit_value_brl)}</td>
        <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtBRL(item.total_value_brl)}</td>
      </tr>
    )
  })
}

export function InvoiceDocumentLocal({ detail, type = 'invoice' }: Props) {
  const { invoice, bls, items } = detail
  if (!invoice) return null

  const isManual = invoice.invoice_type === 'manual'
  const isCovered = invoice.status === 'covered'
  const coveredBy = detail.financial_summary?.covered_by_invoice_number ?? null
  const valueCell: React.CSSProperties = { ...cell, whiteSpace: 'nowrap' }
  const isConsolidated = bls.length >= 2
  const paymentDate = detail.financial_summary?.paid_at ?? [...(detail.payments ?? [])]
    .map((payment) => payment.paid_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null
  const title = type === 'receipt'
    ? (isManual ? 'RECIBO' : isConsolidated ? 'RECIBO CONSOLIDADO DE TAXAS LOCAIS' : 'RECIBO DE TAXAS LOCAIS')
    : (isManual ? 'FATURA' : isConsolidated ? 'FATURA CONSOLIDADA DE TAXAS LOCAIS' : 'FATURA DE TAXAS LOCAIS')

  // Pix: "Saldo a pagar" só quando a fatura está parcialmente paga (saldo
  // diferente do total); com saldo igual ao total repetiria o TOTAL.
  const showPartialBalance = invoice.balance_brl != null && Number(invoice.balance_brl) !== Number(invoice.total_brl)

  const blIds = bls.map((b) => b.bl_id).join(', ') || '—'

  const vesselVoyages = Array.from(
    new Set(
      bls
        .filter((b) => b.vessel_name || b.voyage_number)
        .map((b) => `${b.vessel_name ?? ''} ${b.voyage_number ?? ''}`.trim()),
    ),
  ).join(', ') || [invoice.vessel_name, invoice.voyage_number].filter(Boolean).join(' · ') || '—'

  const hasVesselVoyage = Boolean(
    bls.some((b) => Boolean(b.vessel_name?.trim() || b.voyage_number?.trim())) ||
    (invoice.vessel_name && invoice.vessel_name.trim() !== '-' && invoice.vessel_name.trim() !== '—') ||
    (invoice.voyage_number && invoice.voyage_number.trim() !== '-' && invoice.voyage_number.trim() !== '—'),
  )
  const showVesselVoyages = !isManual || hasVesselVoyage

  const containersMeta = isManual ? null : formatContainersMetadata(bls, items)
  const breakbulkMeta = isManual ? null : formatBreakbulkMetadata(bls, items)

  // Flat item indexing for zebra striping
  const itemFlatIndex = new Map<number | string, number>()
  let flatIdx = 0
  for (const item of items) {
    itemFlatIndex.set(item.id, flatIdx++)
  }

  return (
    <div style={documentRoot}>
      <InvoiceDocHeader logoSrc="/branding/transhipping-logo-cropped.png" docNumber={invoice.invoice_number ?? `INV-${invoice.id}`} />

      <InvoiceDocTitle uppercase>{title}</InvoiceDocTitle>

      {/* Metadata */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <tbody>
          <tr>
            <td style={labelCell}>Cliente:</td>
            <td style={cell}>
              {invoice.customer_name ?? '—'}
              {invoice.customer_cnpj_cpf ? <><br />CNPJ: {fmtCNPJ(invoice.customer_cnpj_cpf)}</> : ''}
              {invoice.customer_address ? <><br />{invoice.customer_address}</> : ''}
            </td>
          </tr>
          {!isManual || bls.length > 0 ? (
            <tr>
              <td style={labelCell}>B/Ls:</td>
              <td style={{ ...cell, color: DOC_NAVY, fontWeight: 600 }}>{blIds}</td>
            </tr>
          ) : null}
          {containersMeta ? (
            <tr>
              <td style={labelCell}>Contêineres:</td>
              <td style={cell}>{containersMeta}</td>
            </tr>
          ) : null}
          {breakbulkMeta ? (
            <tr>
              <td style={labelCell}>Carga Solta:</td>
              <td style={cell}>{breakbulkMeta}</td>
            </tr>
          ) : null}
          {showVesselVoyages ? (
            <tr>
              <td style={labelCell}>Navio / Viagem:</td>
              <td style={cell}>{vesselVoyages}</td>
            </tr>
          ) : null}
          {isManual && invoice.notes ? (
            <tr>
              <td style={labelCell}>Descrição:</td>
              <td style={cell}>{invoice.notes}</td>
            </tr>
          ) : null}
          <tr>
            <td style={labelCell}>Emitida em:</td>
            <td style={cell}>{formatDate(invoice.issued_at)}</td>
          </tr>
        </tbody>
      </table>

      {/* Items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '16px 0', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: DOC_NAVY, color: 'white' }}>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'left' }}>Descrição</th>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'center' }}>Qtd</th>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'right' }}>Unit. BRL</th>
            <th scope="col" style={{ padding: '9px 7px', textAlign: 'right' }}>Total BRL</th>
          </tr>
        </thead>
        <tbody>
          {isManual
            ? renderItemRows(items, itemFlatIndex)
            : isConsolidated
            ? bls.map((blMeta) => {
                const blId = blMeta.bl_id
                const blItems = items.filter((item) => item.bl_id === blId)
                const subtotal = blItems.reduce((s, i) => s + Number(i.total_value_brl ?? 0), 0)
                const isMisto = blMeta.cargo_mode === 'misto'
                const route = `${blMeta.pol ?? ''} → ${blMeta.pod ?? ''}`.trim().replace(/^→\s*/, '').replace(/\s*→$/, '')
                const headerText = `B/L ${blId}${isMisto ? ' — MISTO (CNTR + CARGA SOLTA)' : route && route !== '→' ? ` — ${route}` : ''}`

                return (
                  <React.Fragment key={blId}>
                    <tr style={{ background: DOC_GROUP, borderTop: '2px solid #1A2744' }}>
                      <td colSpan={4} style={{ padding: '6px 8px', fontWeight: 700, color: DOC_NAVY, fontSize: '12px' }}>
                        {headerText}
                      </td>
                    </tr>
                    {renderItemRows(blItems, itemFlatIndex)}
                    <tr style={{ background: DOC_SUBTOTAL, borderBottom: '2px solid #c8d4e8' }}>
                      <td colSpan={3} style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: DOC_NAVY }}>
                        Subtotal {blId}:
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: DOC_NAVY, whiteSpace: 'nowrap' }}>
                        {fmtBRL(subtotal)}
                      </td>
                    </tr>
                  </React.Fragment>
                )
              })
            : (() => {
                const blMeta = bls[0]
                const isMisto = blMeta?.cargo_mode === 'misto'

                return (
                  <>
                    {isMisto && (
                      <tr style={{ background: DOC_GROUP }} className="invoice-document__group-bar">
                        <td colSpan={4} style={{ padding: '6px 8px', fontWeight: 700, color: DOC_NAVY, fontSize: '12px' }}>
                          B/L {blMeta?.bl_id ?? blIds} — MISTO (CNTR + CARGA SOLTA)
                        </td>
                      </tr>
                    )}
                    {renderItemRows(items, itemFlatIndex)}
                  </>
                )
              })()}
          {type === 'receipt' ? <>
            <tr style={{ background: DOC_SUBTOTAL, fontWeight: 700 }} data-testid="invoice-totals" className="invoice-document__totals">
              <td colSpan={3} style={{ ...cell, textAlign: 'right' }}>Total da fatura emitida:</td>
              <td style={{ ...valueCell, textAlign: 'right' }}>{fmtBRL(invoice.total_brl)}</td>
            </tr>
            {/* Individual coberta: o dinheiro entrou na consolidada e foi
                atribuído aos B/Ls deste documento; não foi pago nesta fatura. */}
            <tr><td colSpan={3} style={cell}>{isCovered ? `Recebido pela consolidada${coveredBy ? ` ${coveredBy}` : ''} (atribuído a estes B/Ls):` : 'Valor recebido:'}</td><td style={valueCell}>{fmtBRL(detail.financial_summary?.gross_received_brl ?? invoice.total_paid_brl ?? 0)}</td></tr>
            <tr><td colSpan={3} style={cell}>Abatido do saldo:</td><td style={valueCell}>{fmtBRL(detail.financial_summary?.offset_brl ?? Math.max(Number(invoice.total_brl ?? 0) - Number(invoice.total_paid_brl ?? 0) - Number(invoice.balance_brl ?? 0), 0))}</td></tr>
            <tr><td colSpan={3} style={cell}>Devolvido ao Cliente:</td><td style={valueCell}>{fmtBRL(detail.financial_summary?.refunded_brl ?? 0)}</td></tr>
            <tr><td colSpan={3} style={cell}>Restituição pendente:</td><td style={valueCell}>{fmtBRL(detail.financial_summary?.pending_refund_brl ?? 0)}</td></tr>
            {detail.financial_summary?.covered_by_invoice_number ? <tr><td colSpan={4} style={cell}>Quitação pela fatura consolidada {detail.financial_summary.covered_by_invoice_number}. Valores atribuídos aos B/Ls deste documento.</td></tr> : null}
          </> : null}
        </tbody>
      </table>

      {/* Lote 6b: o total sai da faixa âmbar na largura da tabela e vira caixa
          compacta à direita, logo abaixo dela. No recibo a caixa traz o valor
          líquido recebido; o total emitido fica na última linha da tabela. */}
      {type === 'receipt' ? (
        <InvoiceTotalBox
          label={isCovered ? 'Valor líquido atribuído a estes B/Ls:' : 'Valor líquido recebido:'}
          value={fmtBRL(detail.financial_summary?.net_received_brl ?? invoice.total_paid_brl ?? 0)}
        >
          {paymentDate ? <InvoiceTotalLine label={`Pago em ${formatDate(paymentDate)}`} /> : null}
        </InvoiceTotalBox>
      ) : (
        <InvoiceTotalBox testId="invoice-totals" className="invoice-document__totals" value={fmtBRL(invoice.total_brl)} />
      )}

      {/* PIX */}
      {type === 'invoice' && invoice.pix_payload && ['issued', 'partially_paid', 'overdue'].includes(invoice.status ?? 'issued') && (
        <div data-testid="invoice-pix-box" className="invoice-document__pix-box" style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${DOC_BORDER}` }}>
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0 }}>
              <QRCodeSVG value={invoice.pix_payload} size={90} level="M" />
            </div>
            <div style={{ flex: 1, fontSize: '12px', color: '#333', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: 4 }}>PAGAMENTO VIA PIX</div>
              <div>Escaneie o QR Code ao lado ou utilize o código Pix Copia e Cola abaixo para realizar o pagamento.</div>
              <div>{PIX_SETTLEMENT_NOTE}</div>
              {showPartialBalance ? (
                <div style={{ marginTop: 4 }}>Saldo a pagar: <strong>{fmtBRL(invoice.balance_brl)}</strong></div>
              ) : null}
            </div>
          </div>
          <PixCopyPaste payload={invoice.pix_payload} selectable />
        </div>
      )}

      {type === 'invoice' && !invoice.pix_payload && ['issued', 'partially_paid', 'overdue'].includes(invoice.status ?? 'issued')
        && Number(invoice.balance_brl ?? invoice.total_brl) > 0 && <PixPreparingNotice />}

      <InvoiceDocFooter marginTop={24} />
    </div>
  )
}
