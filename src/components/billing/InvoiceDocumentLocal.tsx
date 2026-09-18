import React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { InvoiceDetail } from '../../services/billing'
import type { InvoiceItem } from '../../types/database'
import { formatDate, stripBlPrefix } from '../../lib/utils'
import {
  cell,
  classifyInvoiceItem,
  dataTotalCell,
  dataTotalRow,
  describeUsdConversionNote,
  DOC_BORDER,
  DOC_GROUP,
  DOC_MUTED,
  DOC_NAVY,
  DOC_SUBTOTAL,
  documentRoot,
  fmtBRL,
  fmtCNPJ,
  labelCell,
  zebraRow,
} from '../shared/invoiceFormat'
import { InvoiceDocFooter, InvoiceDocHeader, InvoiceDocTitle } from '../shared/InvoiceDocumentKit'

type Props = { detail: InvoiceDetail; type?: 'invoice' | 'receipt' }

function displayQuantity(item: InvoiceItem): string | number {
  const snapshot = item.snapshot_payload
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const sharedQuantityLabel = (snapshot as Record<string, unknown>).shared_quantity_label
    if (typeof sharedQuantityLabel === 'string' && sharedQuantityLabel.trim()) return sharedQuantityLabel
  }
  return item.quantity ?? 1
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
      const pkgStr = packagesQty != null && Number(packagesQty) > 0 ? ` | ${packagesQty} volumes` : ''
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

function renderCategoryBlock(
  title: string,
  subtotalLabel: string,
  categoryItems: InvoiceItem[],
  itemFlatIndex: Map<number | string, number>,
) {
  if (categoryItems.length === 0) return null

  const subtotal = categoryItems.reduce((sum, item) => sum + Number(item.total_value_brl ?? 0), 0)

  return (
    <React.Fragment key={title}>
      <tr style={{ background: DOC_GROUP, borderTop: '1px solid #c8d4e8' }}>
        <td colSpan={4} style={{ padding: '6px 8px', fontWeight: 700, color: DOC_NAVY, fontSize: '11px', letterSpacing: '0.03em' }}>
          {title}
        </td>
      </tr>
      {categoryItems.map((item) => {
        const usdNote = describeUsdConversionNote(item)
        return (
          <tr key={item.id} style={zebraRow(itemFlatIndex.get(item.id) ?? 0)}>
            <td style={{ padding: '8px 8px 8px 16px' }}>
              {stripBlPrefix(item.description, item.bl_id)}
              {usdNote && <div style={{ fontSize: '10px', color: DOC_MUTED }}>{usdNote}</div>}
            </td>
            <td style={{ padding: '8px 7px', textAlign: 'center' }}>{displayQuantity(item)}</td>
            <td style={{ padding: '8px 7px', textAlign: 'right' }}>{fmtBRL(item.unit_value_brl)}</td>
            <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(item.total_value_brl)}</td>
          </tr>
        )
      })}
      <tr style={{ background: DOC_SUBTOTAL, borderBottom: '1px solid #c8d4e8' }}>
        <td colSpan={3} style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: DOC_NAVY }}>
          {subtotalLabel}
        </td>
        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: DOC_NAVY }}>
          {fmtBRL(subtotal)}
        </td>
      </tr>
    </React.Fragment>
  )
}

export function InvoiceDocumentLocal({ detail, type = 'invoice' }: Props) {
  const { invoice, bls, items } = detail
  if (!invoice) return null

  const isConsolidated = bls.length >= 2
  const paymentDate = [...(detail.payments ?? [])]
    .map((payment) => payment.paid_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null
  const title = type === 'receipt'
    ? (isConsolidated ? 'RECIBO CONSOLIDADO DE TAXAS LOCAIS' : 'RECIBO DE TAXAS LOCAIS')
    : (isConsolidated ? 'FATURA CONSOLIDADA DE TAXAS LOCAIS' : 'FATURA DE TAXAS LOCAIS')

  const blIds = bls.map((b) => b.bl_id).join(', ') || '—'

  const vesselVoyages = Array.from(
    new Set(
      bls
        .filter((b) => b.vessel_name || b.voyage_number)
        .map((b) => `${b.vessel_name ?? ''} ${b.voyage_number ?? ''}`.trim()),
    ),
  ).join(', ') || '—'

  const containersMeta = formatContainersMetadata(bls, items)
  const breakbulkMeta = formatBreakbulkMetadata(bls, items)

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
            </td>
          </tr>
          <tr>
            <td style={labelCell}>B/Ls:</td>
            <td style={{ ...cell, color: DOC_NAVY, fontWeight: 600 }}>{blIds}</td>
          </tr>
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
          <tr>
            <td style={labelCell}>Navio/Voy.:</td>
            <td style={cell}>{vesselVoyages}</td>
          </tr>
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
          {isConsolidated
            ? bls.map((blMeta) => {
                const blId = blMeta.bl_id
                const blItems = items.filter((item) => item.bl_id === blId)
                const subtotal = blItems.reduce((s, i) => s + Number(i.total_value_brl ?? 0), 0)
                const isMisto = blMeta.cargo_mode === 'misto'
                const route = `${blMeta.pol ?? ''} → ${blMeta.pod ?? ''}`.trim().replace(/^→\s*/, '').replace(/\s*→$/, '')
                const headerText = `B/L ${blId}${isMisto ? ' — MISTO (CNTR + CARGA SOLTA)' : route && route !== '→' ? ` — ${route}` : ''}`

                const cntrItems = blItems.filter((i) => classifyInvoiceItem(i) === 'container')
                const bbItems = blItems.filter((i) => classifyInvoiceItem(i) === 'carga_solta')
                const docItems = blItems.filter((i) => classifyInvoiceItem(i) === 'documental')

                return (
                  <React.Fragment key={blId}>
                    <tr style={{ background: DOC_GROUP, borderTop: '2px solid #1A2744' }}>
                      <td colSpan={4} style={{ padding: '6px 8px', fontWeight: 700, color: DOC_NAVY, fontSize: '11px' }}>
                        {headerText}
                      </td>
                    </tr>
                    {renderCategoryBlock('1. CARGA CONTEINERIZADA', 'Subtotal Contêineres:', cntrItems, itemFlatIndex)}
                    {renderCategoryBlock('2. CARGA SOLTA (BREAKBULK)', 'Subtotal Carga Solta:', bbItems, itemFlatIndex)}
                    {renderCategoryBlock('3. TAXAS ADMINISTRATIVAS E DOCUMENTAIS', 'Subtotal Taxas Documentais:', docItems, itemFlatIndex)}
                    <tr style={{ background: DOC_SUBTOTAL, borderBottom: '2px solid #c8d4e8' }}>
                      <td colSpan={3} style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: DOC_NAVY }}>
                        Subtotal {blId}:
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: DOC_NAVY }}>
                        {fmtBRL(subtotal)}
                      </td>
                    </tr>
                  </React.Fragment>
                )
              })
            : (() => {
                const blMeta = bls[0]
                const isMisto = blMeta?.cargo_mode === 'misto'
                const cntrItems = items.filter((i) => classifyInvoiceItem(i) === 'container')
                const bbItems = items.filter((i) => classifyInvoiceItem(i) === 'carga_solta')
                const docItems = items.filter((i) => classifyInvoiceItem(i) === 'documental')

                return (
                  <>
                    {isMisto && (
                      <tr style={{ background: DOC_GROUP }} className="invoice-document__group-bar">
                        <td colSpan={4} style={{ padding: '6px 8px', fontWeight: 700, color: DOC_NAVY, fontSize: '11px' }}>
                          B/L {blMeta?.bl_id ?? blIds} — MISTO (CNTR + CARGA SOLTA)
                        </td>
                      </tr>
                    )}
                    {renderCategoryBlock('1. CARGA CONTEINERIZADA', 'Subtotal Contêineres:', cntrItems, itemFlatIndex)}
                    {renderCategoryBlock('2. CARGA SOLTA (BREAKBULK)', 'Subtotal Carga Solta:', bbItems, itemFlatIndex)}
                    {renderCategoryBlock('3. TAXAS ADMINISTRATIVAS E DOCUMENTAIS', 'Subtotal Taxas Documentais:', docItems, itemFlatIndex)}
                  </>
                )
              })()}
          <tr style={dataTotalRow} data-testid="invoice-totals" className="invoice-document__totals">
            <td colSpan={3} style={dataTotalCell}>TOTAL:</td>
            <td style={dataTotalCell}>{fmtBRL(invoice.total_brl)}</td>
          </tr>
          {type === 'receipt' && paymentDate ? (
            <tr>
              <td colSpan={4} style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>Pago em {formatDate(paymentDate)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/* PIX */}
      {type === 'invoice' && invoice.pix_payload && (
        <div data-testid="invoice-pix-box" className="invoice-document__pix-box" style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${DOC_BORDER}` }}>
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0 }}>
              <QRCodeSVG value={invoice.pix_payload} size={90} level="M" />
            </div>
            <div style={{ flex: 1, fontSize: '12px', color: '#333', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: 4 }}>PAGAMENTO VIA PIX</div>
              <div>Escaneie o QR Code ao lado ou utilize o código Pix Copia e Cola abaixo para realizar o pagamento.</div>
              <div style={{ marginTop: 4 }}>Valor da fatura:</div>
              <div style={{ fontWeight: 700 }}>{fmtBRL(invoice.total_brl)}</div>
            </div>
          </div>
          <div style={{ fontSize: '10px', color: DOC_MUTED, fontWeight: 600, letterSpacing: '0.05em', margin: '10px 0 3px' }}>PIX COPIA E COLA</div>
          <span
            onClick={(event) => {
              const selection = window.getSelection()
              if (!selection) return
              const range = document.createRange()
              range.selectNodeContents(event.currentTarget)
              selection.removeAllRanges()
              selection.addRange(range)
            }}
            title="Clique para selecionar o código inteiro"
            style={{ display: 'block', fontFamily: 'monospace', fontSize: '6.5px', background: '#f3f4f6', padding: '5px 8px', borderRadius: 3, wordBreak: 'break-all', color: '#374151', cursor: 'pointer', userSelect: 'all', WebkitUserSelect: 'all' }}
          >
            {invoice.pix_payload}
          </span>
        </div>
      )}

      <InvoiceDocFooter marginTop={24} />
    </div>
  )
}
