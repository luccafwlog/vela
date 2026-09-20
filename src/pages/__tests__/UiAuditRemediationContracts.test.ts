import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('contratos das telas remediadas', () => {
  it('usa Fatura, skeletons equivalentes e ações contextuais nos vazios', () => {
    const bls = fs.readFileSync('src/pages/Bls.tsx', 'utf8')
    const containers = fs.readFileSync('src/pages/Containers.tsx', 'utf8')
    expect(bls).toContain('>Fatura</th>')
    expect(bls).toContain('cols={blColumnCount}')
    expect(bls).toContain("const blSkeletonTemplate = `${isAdmin ? '44px ' : ''}")
    expect(bls).toContain('columnTemplate={blSkeletonTemplate}')
    expect(bls).toContain('action={')
    expect(containers).toContain('<SkeletonTable')
    expect(containers).toContain("const containerSkeletonTemplate = `${isAdmin ? '44px ' : ''}")
    expect(containers).toContain('columnTemplate={containerSkeletonTemplate}')
    expect(containers).not.toContain('Carregando containers...')
    expect(containers).toContain('action={')
  })

  it('mantém 44px na área de acionamento do expansor de atracações', () => {
    const source = fs.readFileSync('src/components/voyages/VoyageVisaoTab.tsx', 'utf8')
    expect(source).toContain('min-h-11 min-w-11')
    expect(source).not.toContain('h-5 w-5')
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
