import { COMPANY } from '../../config/company'
import { documentRoot, fmtBRL, fmtCNPJ, fmtUSD } from '../shared/invoiceFormat'
import { InvoiceDocHeader } from '../shared/InvoiceDocumentKit'
import type { CustomerDemurrageSummary } from '../../services/demurrage/demurrageKpis'

type Props = {
  rows: CustomerDemurrageSummary[]
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #111', fontSize: 12 }
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #e5e7eb', fontSize: 12 }
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

/**
 * Relatório imprimível (window.print()) de demurrage em aberto por consignatário:
 * USD estável + BRL (snapshot do último recálculo). Ver ADR 0014.
 */
export function CustomerSummaryReport({ rows }: Props) {
  const totalUsd = rows.reduce((s, r) => s + r.total_usd, 0)
  const totalBrl = rows.reduce((s, r) => s + r.total_brl, 0)
  const totalInvoices = rows.reduce((s, r) => s + r.invoice_count, 0)
  const issuedOn = new Date().toLocaleDateString('pt-BR')

  return (
    <div style={documentRoot}>
      {/* Logo escura: a tr-logo.png é branca e some no papel (lote 6b). */}
      <InvoiceDocHeader logoSrc="/branding/transhipping-logo-cropped.png" numberPrefix="" docNumber={`Emitido em ${issuedOn}`} />
      <h2 style={{ textAlign: 'center', fontSize: 16, margin: '8px 0' }}>
        DEMURRAGE EM ABERTO POR CONSIGNATÁRIO
      </h2>
      <p style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', margin: '0 0 16px' }}>
        {COMPANY.name} · Valores em BRL pelo último recálculo (PTAX)
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Consignatário</th>
            <th style={th}>CNPJ</th>
            <th style={{ ...th, textAlign: 'right' }}>Faturas</th>
            <th style={{ ...th, textAlign: 'right' }}>Total USD</th>
            <th style={{ ...th, textAlign: 'right' }}>Total BRL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.customer_id}>
              <td style={td}>{r.customer_name}</td>
              <td style={td}>{r.cnpj_cpf ? fmtCNPJ(r.cnpj_cpf) : '—'}</td>
              <td style={num}>{r.invoice_count}</td>
              <td style={num}>{fmtUSD(r.total_usd)}</td>
              <td style={num}>{fmtBRL(r.total_brl)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ ...td, fontWeight: 700 }}>Total</td>
            <td style={td}></td>
            <td style={{ ...num, fontWeight: 700 }}>{totalInvoices}</td>
            <td style={{ ...num, fontWeight: 700 }}>{fmtUSD(totalUsd)}</td>
            <td style={{ ...num, fontWeight: 700 }}>{fmtBRL(totalBrl)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
