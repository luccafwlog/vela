import { COMPANY } from '../../config/company'
import { documentRoot, fmtBRL, fmtCNPJ, fmtUSD } from '../shared/invoiceFormat'
import { InvoiceDocHeader } from '../shared/InvoiceDocumentKit'
import { formatDate } from '../../lib/utils'
import { DEMURRAGE_DIVISION_LABELS } from '../../services/demurrage/demurrageDivisions'
import { statementTotals, type CustomerStatement } from '../../services/demurrage/demurrageCustomerExposure'

type Props = {
  statement: CustomerStatement
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #111', fontSize: 12 }
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #e5e7eb', fontSize: 12 }
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const muted: React.CSSProperties = { fontSize: 12, color: '#6b7280', textAlign: 'center', margin: '0 0 4px' }
const section: React.CSSProperties = { ...th, borderBottom: 'none', padding: 0, margin: '18px 0 6px' }
const plain: React.CSSProperties = { ...td, borderBottom: 'none', padding: 0 }
const date = (value: string | null | undefined) => (value ? formatDate(value) : '—')

/**
 * Extrato de Demurrage de um Cliente (ADR 0112, D12), imprimível por
 * `window.print()`: as Invoices em aberto (USD líquido e BRL de hoje) e as
 * caixas ainda sem Invoice, com o US$ previsto de hoje. É como a equipe
 * informa o Cliente do que corre; o Portal segue sem mostrar (D21).
 */
export function CustomerSummaryReport({ statement }: Props) {
  const { customer, invoices, boxes } = statement
  const totals = statementTotals(statement)
  const issuedOn = new Date().toLocaleDateString('pt-BR')

  return (
    <div style={documentRoot}>
      {/* Logo escura: a tr-logo.png é branca e some no papel (lote 6b). */}
      <InvoiceDocHeader logoSrc="/branding/transhipping-logo-cropped.png" numberPrefix="" docNumber={`Emitido em ${issuedOn}`} />
      <h2 style={{ textAlign: 'center', fontSize: 16, margin: '8px 0' }}>EXTRATO DE DEMURRAGE</h2>
      <p style={muted}>
        {customer.name}{customer.cnpj_cpf ? ` · CNPJ ${fmtCNPJ(customer.cnpj_cpf)}` : ''}
      </p>
      <p style={{ ...muted, marginBottom: 12 }}>{COMPANY.name}</p>

      <h3 style={section}>Invoices em aberto</h3>
      {invoices.length ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Invoice</th>
              <th style={th}>B/L</th>
              <th style={th}>Emissão</th>
              <th style={{ ...th, textAlign: 'right' }}>USD</th>
              <th style={{ ...th, textAlign: 'right' }}>BRL hoje</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td style={td}>{invoice.doc_number}</td>
                <td style={td}>{invoice.bl_id}</td>
                <td style={td}>{date(invoice.billed_at)}</td>
                <td style={num}>{fmtUSD(invoice.total_usd)}</td>
                <td style={num}>{fmtBRL(invoice.current_total_brl)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...td, fontWeight: 700 }} colSpan={3}>Total em aberto</td>
              <td style={{ ...num, fontWeight: 700 }}>{fmtUSD(totals.invoicesUsd)}</td>
              <td style={{ ...num, fontWeight: 700 }}>{fmtBRL(totals.invoicesBrl)}</td>
            </tr>
          </tfoot>
        </table>
      ) : <p style={plain}>Nenhuma Invoice de Demurrage em aberto.</p>}

      <h3 style={section}>Containers com Demurrage ainda sem Invoice</h3>
      {boxes.length ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>B/L</th>
              <th style={th}>Container</th>
              <th style={th}>Descarga</th>
              <th style={th}>Devolução</th>
              <th style={{ ...th, textAlign: 'right' }}>Dias</th>
              <th style={{ ...th, textAlign: 'right' }}>Free time</th>
              <th style={th}>Situação</th>
              <th style={{ ...th, textAlign: 'right' }}>US$ previsto</th>
            </tr>
          </thead>
          <tbody>
            {boxes.map((box) => (
              <tr key={box.container_id}>
                <td style={td}>{box.bl_id}</td>
                <td style={td}>{box.container_number}</td>
                <td style={td}>{date(box.discharge_date)}</td>
                <td style={td}>{box.return_date ? date(box.return_date) : 'Fora'}</td>
                <td style={num}>{box.total_days ?? '—'}</td>
                <td style={num}>{box.free_days ?? '—'}</td>
                <td style={td}>{box.state === 'no_rate' ? 'Tipo sem tarifa' : DEMURRAGE_DIVISION_LABELS[box.division]}</td>
                <td style={num}>{box.usd == null ? '—' : fmtUSD(box.usd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...td, fontWeight: 700 }} colSpan={7}>Total previsto hoje</td>
              <td style={{ ...num, fontWeight: 700 }}>{fmtUSD(totals.boxesUsd)}</td>
            </tr>
          </tfoot>
        </table>
      ) : <p style={plain}>Nenhum container com Demurrage sem Invoice.</p>}
      <p style={{ ...muted, textAlign: 'left', marginTop: 12 }}>
        O valor previsto é o de hoje e muda até a devolução do container e a emissão da Invoice. O BRL das Invoices acompanha a PTAX até o pagamento.
      </p>
    </div>
  )
}
