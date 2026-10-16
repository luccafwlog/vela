// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReviewRawLines } from '../ReviewEvidence'
import { describeCnpjSource, type ReviewGroup } from '../../../pages/revisaoHelpers'

vi.mock('../../../hooks/useCustomers', () => ({ useCustomerLookup: () => ({ data: [] }) }))

const item = { id: 'BL1', source: 'bl', consignee_block: 'Alfa Ltda\nCNPJ: 11.222.333/0001-81', cargo_description: null } as never

describe('ReviewEvidence', () => {
  it('mostra o texto bruto do B/L com o CNPJ marcado e diz quando falta a descrição', () => {
    const { container } = render(<ReviewRawLines items={[item]} />)
    expect(screen.getByText('Linha do consignatário · B/L BL1')).toBeTruthy()
    expect(container.querySelector('mark')?.textContent).toBe('11.222.333/0001-81')
    expect(screen.getByText('Não extraída do B/L')).toBeTruthy()
  })

  it('diz onde o CNPJ foi lido e em quantos B/Ls', () => {
    const group = {
      key: 'document:11222333000181', cnpj: '11222333000181', displayName: 'Alfa', identityKind: 'document', candidateCnpjs: ['11222333000181'], canBulkOnboard: true,
      items: [
        { id: 'BL1', source: 'bl', manifest_customer_cnpj_cpf: '11222333000181' },
        { id: 'BL2', source: 'bl', manifest_customer_cnpj_cpf: '11222333000181' },
      ],
    } as unknown as ReviewGroup
    expect(describeCnpjSource(group, '11222333000181')).toBe('lido no manifesto · 2 de 2 B/Ls')
  })
})
