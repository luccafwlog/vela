import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

describe('contrato CSS de impressão de invoice', () => {
  it('preserva o ancestral da página que contém o modal de impressão', () => {
    const css = fs.readFileSync('src/index.css', 'utf8')
    expect(css).toContain('.app-main > *:not(:has(.app-modal-backdrop))')
    expect(css).toContain('.app-main > *:has(.app-modal-backdrop)')
  })

  it('isola tambem o relatorio de Demurrage por consignatario', () => {
    const css = fs.readFileSync('src/index.css', 'utf8')
    expect(css).toContain(':not(.customer-report-print-content)')
    expect(css).toMatch(/\.invoice-print-content,\s*\.agency-report-print-content,\s*\.customer-report-print-content/)
  })

  it('mantem visivel o backdrop do modal quando ele e filho direto de .app-main (caso Demurrage)', () => {
    // Demurrage.tsx renderiza <CustomerReportModal> direto sob .app-main (sem
    // wrapper de pagina), diferente do caso do AgencyReportTab que motivou a
    // regra original. Nesse caso, `.app-modal-backdrop` nao "tem" um
    // `.app-modal-backdrop` descendente (:has nao alcanca o proprio elemento),
    // entao a regra de ocultar precisa excluir explicitamente essa classe, e a
    // regra de manter visivel precisa cobrir o backdrop diretamente (nao so um
    // ancestral que o contenha).
    const css = fs.readFileSync('src/index.css', 'utf8')
    expect(css).toMatch(/\.app-main > \*:not\(:has\(\.app-modal-backdrop\)\):not\(\.app-modal-backdrop\)/)
    expect(css).toMatch(/\.app-main > \.app-modal-backdrop\s*\{[^}]*display:\s*block\s*!important/s)
  })

  it('InvoiceDocumentLocal emite as classes e testids protegidos contra quebra de página', () => {
    const tsx = fs.readFileSync('src/components/billing/InvoiceDocumentLocal.tsx', 'utf8')
    expect(tsx).toContain('data-testid="invoice-totals"')
    expect(tsx).toContain('className="invoice-document__totals"')
    expect(tsx).toContain('data-testid="invoice-pix-box"')
    expect(tsx).toContain('className="invoice-document__pix-box"')
    expect(tsx).toContain('className="invoice-document__group-bar"')
    expect(tsx).toContain("wordBreak: 'break-all'")
  })

  it('folha A4 com margem em toda página e numeração, igual na página e na janela de impressão', () => {
    // Antes a margem era padding do documento e @page tinha margem zero: a
    // página 2 começava colada na borda do papel.
    const css = fs.readFileSync('src/index.css', 'utf8')
    const popup = fs.readFileSync('src/lib/printDocument.ts', 'utf8')
    expect(css).toMatch(/@page\s*\{\s*size: A4;\s*margin: 10mm 0 12mm;/)
    expect(css).toContain('content: "Página " counter(page) " de " counter(pages);')
    expect(popup).toContain('@page{size:A4;margin:10mm 0 12mm;')
    expect(popup).toContain('counter(pages)')
  })

  it('papel branco: o fundo pontilhado do app não vai para a impressão', () => {
    const css = fs.readFileSync('src/index.css', 'utf8')
    const print = css.slice(css.indexOf('@media print {'))
    expect(print).toMatch(/html,\s*body,\s*\.app-shell,\s*\.app-main\s*\{\s*background: #fff !important;/)
  })
})
