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
})
