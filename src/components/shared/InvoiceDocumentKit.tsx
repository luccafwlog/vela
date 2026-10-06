import { cell, DOC_NAVY, fmtCNPJ, labelCell, longDate } from './invoiceFormat'

// Blocos JSX compartilhados pelos documentos imprimíveis de fatura
// (billing/InvoiceDocumentLocal e demurrage/InvoiceDocument). Extraídos para
// uma única fonte (audit F20/T14): antes, cabeçalho/título/cliente/rodapé
// eram copiados nos dois arquivos e divergiam aos poucos. As tabelas de itens
// e o bloco PIX continuam em cada documento — são estruturalmente diferentes
// (4 vs 9 colunas; layouts de PIX distintos). Helpers de formatação ficam em
// invoiceFormat.ts (regra react-refresh/only-export-components).

// `numberPrefix` existe porque nem todo documento é numerado como fatura: o
// impresso do ADR identifica a escala ("ADR · BRVIX"), sem "Nº".
export function InvoiceDocHeader({ logoSrc, docNumber, numberPrefix = 'Nº ' }: { logoSrc: string; docNumber: string; numberPrefix?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
      <img
        src={logoSrc}
        alt="Transhipping"
        style={{ height: 52 }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
      <div style={{ fontSize: '14px', fontWeight: 700, color: DOC_NAVY }}>{numberPrefix}{docNumber}</div>
    </div>
  )
}

export function InvoiceDocTitle({ children, uppercase = false }: { children: React.ReactNode; uppercase?: boolean }) {
  return (
    <>
      <div style={{ textAlign: 'center', fontSize: '16px', fontWeight: 700, margin: '12px 0 6px', ...(uppercase ? { textTransform: 'uppercase' as const } : {}) }}>
        {children}
      </div>
      <hr style={{ border: 'none', borderTop: '2px solid #111', margin: '0 0 16px' }} />
    </>
  )
}

export function InvoiceClientBlock({ name, cnpjCpf }: { name: string | null | undefined; cnpjCpf: string | null | undefined }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
      <tbody>
        <tr>
          <td style={labelCell}>Cliente:</td>
          <td style={cell}>
            {name ?? '—'}
            {cnpjCpf ? <><br />CNPJ: {fmtCNPJ(cnpjCpf)}</> : ''}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

export function InvoiceDocFooter({ marginTop = 24 }: { marginTop?: number }) {
  return (
    <div style={{ marginTop, textAlign: 'right', fontSize: '12px', color: '#555' }}>
      Vitória, {longDate()}
    </div>
  )
}

// Fatura pagável cuja cobrança Pix do Itaú ainda não foi confirmada pelo banco.
export function PixPreparingNotice() {
  return (
    <div role="status" data-testid="pix-preparing" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb', fontSize: '12px', color: '#333' }}>
      <strong>PAGAMENTO VIA PIX:</strong> QR Code em preparação. Gere o documento novamente em alguns minutos.
    </div>
  )
}
