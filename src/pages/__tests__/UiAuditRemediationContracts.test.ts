import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('contratos das telas remediadas', () => {
  it('usa Fatura, skeletons equivalentes e ações contextuais nos vazios', () => {
    const bls = fs.readFileSync('src/pages/Bls.tsx', 'utf8')
    const containers = fs.readFileSync('src/pages/Containers.tsx', 'utf8')
    // Etapa 05: taxas e fatura dividem a coluna, sem cabeçalho cortado.
    expect(bls).toContain('>Taxas locais e fatura</th>')
    expect(bls).toContain('cols={blColumnCount}')
    expect(bls).toContain("const blSkeletonTemplate = `${isAdmin ? '40px ' : ''}")
    expect(bls).toContain('columnTemplate={blSkeletonTemplate}')
    expect(bls).toContain('action={')
    expect(containers).toContain('<SkeletonTable')
    expect(containers).toContain("const containerSkeletonTemplate = `${isAdmin ? '44px ' : ''}")
    expect(containers).toContain('columnTemplate={containerSkeletonTemplate}')
    expect(containers).not.toContain('Carregando containers...')
    expect(containers).toContain('action={')
  })

  it('mantém 44px na área de acionamento do expansor de atracações', () => {
    // Etapa 03: o expansor virou o texto "N atracações"; o alvo de 44 px no
    // toque passou para a regra de ponteiro grosso do CSS da Viagem.
    const source = fs.readFileSync('src/components/voyages/VoyageVisaoTab.tsx', 'utf8')
    const css = fs.readFileSync('src/index.css', 'utf8')
    expect(source).toContain('className="app-voyage-plan__toggle"')
    expect(source).not.toContain('h-5 w-5')
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.app-voyage-plan__toggle \{\s*min-height: 44px;\s*min-width: 44px;/)
  })

  it('usa mensagens amigáveis e terminologia padronizada em faturas', () => {
    const invoiceModal = fs.readFileSync('src/components/billing/InvoiceDetailModal.tsx', 'utf8')
    const taxasLocais = fs.readFileSync('src/pages/TaxasLocais.tsx', 'utf8')
    expect(invoiceModal).not.toContain('function extractMessage')
    expect(invoiceModal).toContain('userFacingErrorMessage')
    expect(invoiceModal).toContain('>Cancelar fatura<')
    expect(invoiceModal).not.toContain('>Cancelar invoice<')
    expect(taxasLocais).not.toContain('function extractMessage')
    expect(taxasLocais).toContain('userFacingErrorMessage')
  })
})
