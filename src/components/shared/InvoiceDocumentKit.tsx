import { cell, DOC_ACCENT, DOC_CODE_BG, DOC_CODE_INK, DOC_INK, DOC_MUTED, DOC_NAVY, DOC_TEXT_MIN, DOC_TEXT_TOTAL, fmtCNPJ, labelCell, longDate } from './invoiceFormat'

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

// TOTAL do documento (lote 6b): caixa âmbar compacta à direita, logo abaixo da
// tabela, no lugar da faixa âmbar na largura da tabela. `children` recebe
// linhas extras alinhadas à direita embaixo da caixa (ex.: VENCIMENTO). Na
// impressão a caixa não começa a página sozinha (`breakBefore: avoid`).
export function InvoiceTotalBox({ label = 'TOTAL:', value, testId, className, children }: {
  label?: string
  value: string
  testId?: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div data-testid={testId} className={className} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, margin: '10px 0 12px', breakBefore: 'avoid', pageBreakBefore: 'avoid' }}>
      <div style={{ display: 'inline-flex', gap: 12, background: DOC_ACCENT, color: DOC_INK, padding: '5px 14px', borderRadius: 2, fontWeight: 700, fontSize: DOC_TEXT_TOTAL, whiteSpace: 'nowrap' }}>
        <span>{label}</span><span>{value}</span>
      </div>
      {children}
    </div>
  )
}

// Linha à direita embaixo da caixa de TOTAL, sem fundo (ex.: "VENCIMENTO: 30/10/2026").
export function InvoiceTotalLine({ label, value }: { label: string; value?: string }) {
  return (
    <div style={{ display: 'inline-flex', gap: 12, fontWeight: 700, fontSize: DOC_TEXT_TOTAL, color: DOC_INK, whiteSpace: 'nowrap' }}>
      <span>{label}</span>{value ? <span>{value}</span> : null}
    </div>
  )
}

// Aviso que segue a frase do QR Code em toda fatura com Pix (mesma fonte, cor e tamanho).
export const PIX_SETTLEMENT_NOTE = 'Depois do pagamento, a baixa da fatura pode levar de 1 a 5 minutos. Para ver a fatura como paga, atualize a página no Portal do Cliente.'

// Rótulo e código Pix Copia e Cola, abaixo do QR e alinhado à esquerda. O
// código quebra em várias linhas, sem descer de 12px.
export function PixCopyPaste({ payload, selectable = false }: { payload: string; selectable?: boolean }) {
  return (
    <>
      <div style={{ fontSize: DOC_TEXT_MIN, color: DOC_MUTED, fontWeight: 600, letterSpacing: '0.05em', margin: '10px 0 3px' }}>PIX COPIA E COLA</div>
      <span
        onClick={selectable ? (event) => {
          const selection = window.getSelection()
          if (!selection) return
          const range = document.createRange()
          range.selectNodeContents(event.currentTarget)
          selection.removeAllRanges()
          selection.addRange(range)
        } : undefined}
        title={selectable ? 'Clique para selecionar o código inteiro' : undefined}
        style={{ display: 'block', fontFamily: 'monospace', fontSize: DOC_TEXT_MIN, lineHeight: 1.4, background: DOC_CODE_BG, padding: '5px 8px', borderRadius: 3, wordBreak: 'break-all', whiteSpace: 'normal', color: DOC_CODE_INK, ...(selectable ? { cursor: 'pointer', userSelect: 'all' as const, WebkitUserSelect: 'all' as const } : {}) }}
      >
        {payload}
      </span>
    </>
  )
}
