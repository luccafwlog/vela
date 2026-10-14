// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const query = vi.hoisted(() => ({ value: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() } }))
vi.mock('../../../hooks/useCeUnlock', () => ({ useCustomerCeUnlockRequests: () => query.value }))

import { CeUnlockRequestsBlock } from '../CeUnlockRequestsBlock'

afterEach(cleanup)

describe('Solicitações de desbloqueio na ficha do Cliente', () => {
  it('uma linha por pedido, com situação e documentos em texto e o caminho para analisar', () => {
    query.value = {
      ...query.value,
      data: {
        items: [
          { id: 'r1', protocol: 'CE-2026-0042', state: 'in_review', version: 1, created_at: '2026-10-12T10:00:00Z', customer_name: 'X', cnpj_cpf: '1', sla_started_at: '2026-10-12T10:00:00Z', bl_ids: ['COSU1', 'COSU2'], termo_status: 'approved', procuracao_status: 'uploaded' },
          { id: 'r2', protocol: 'CE-2026-0031', state: 'completed', version: 3, created_at: '2026-09-08T10:00:00Z', customer_name: 'X', cnpj_cpf: '1', sla_started_at: '2026-09-08T10:00:00Z', bl_ids: ['XPDU1'], termo_status: 'approved', procuracao_status: 'approved' },
        ],
        total: 2,
        page: 1,
        page_size: 20,
      },
    }
    render(<MemoryRouter><CeUnlockRequestsBlock customerId={101} manage /></MemoryRouter>)
    const open = screen.getByText('CE-2026-0042').closest('tr')!
    expect(open.textContent).toContain('+1')
    expect(open.textContent).toContain('Aguardando análise')
    expect(screen.getByRole('link', { name: 'Analisar CE-2026-0042' }).getAttribute('href')).toBe('/desbloqueio-ce?pedido=r1')
    // Pedido concluído não se analisa: só se vê.
    expect(screen.getByRole('link', { name: 'Ver CE-2026-0031' })).toBeTruthy()
  })
})
