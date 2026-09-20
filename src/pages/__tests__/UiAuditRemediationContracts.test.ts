import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('contratos das telas remediadas', () => {
  it('usa Fatura, skeletons equivalentes e ações contextuais nos vazios', () => {
    const bls = fs.readFileSync('src/pages/Bls.tsx', 'utf8')
    const containers = fs.readFileSync('src/pages/Containers.tsx', 'utf8')
    expect(bls).toContain('>Fatura</th>')
    expect(bls).toContain('cols={blColumnCount}')
    expect(bls).toContain('action={')
    expect(containers).toContain('<SkeletonTable')
    expect(containers).not.toContain('Carregando containers...')
    expect(containers).toContain('action={')
  })

  it('mantém 44px na área de acionamento do expansor de atracações', () => {
    const source = fs.readFileSync('src/components/voyages/VoyageVisaoTab.tsx', 'utf8')
    expect(source).toContain('min-h-11 min-w-11')
    expect(source).not.toContain('h-5 w-5')
  })
})
