// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlFaturamentoTab } from '../BlFaturamentoTab'
import { BlHistoricoTab } from '../BlHistoricoTab'
import type { BLDetail } from '../../../types/database'

const { fetchNextPage, useBlTimelineMock, useInvoiceLinksMock, useBlCommunicationHistoryMock } = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  useBlTimelineMock: vi.fn(),
  useInvoiceLinksMock: vi.fn(),
  useBlCommunicationHistoryMock: vi.fn(),
}))

vi.mock('../../../hooks/useBlTimeline', () => ({ useBlTimeline: useBlTimelineMock }))
vi.mock('../../../hooks/useCustomerCommunications', () => ({ useBlCommunicationHistory: useBlCommunicationHistoryMock }))
vi.mock('../../../hooks/useBilling', () => ({ useInvoiceLinks: useInvoiceLinksMock }))
vi.mock('../BlClienteSection', () => ({ BlClienteSection: () => <div>Cliente</div> }))
vi.mock('../BlCobrancasTab', () => ({ BlCobrancasSection: () => <div>Cobrancas</div> }))
vi.mock('../BlDemurrageSection', () => ({ BlDemurrageSection: () => <div>Demurrage</div> }))

beforeEach(() => {
  fetchNextPage.mockReset()
  useBlCommunicationHistoryMock.mockReturnValue({ data: [] })
  useInvoiceLinksMock.mockReturnValue({
    data: { 'BL-1': [{ id: 77, invoice_number: 'INV-077' }] },
  })
  useBlTimelineMock.mockReturnValue({
    data: {
      pages: [[{
        id: 1,
        family: 'edicao',
        entity_type: 'bl',
        field_name: 'shipper',
        old_value: 'A',
        new_value: 'B',
        changed_by: 'user-1',
        changed_at: '2026-06-23',
        justification: 'Correcao',
      }]],
    },
    fetchNextPage,
    hasNextPage: true,
    isFetchingNextPage: false,
  })
})

describe('faturamento e historico do B/L', () => {
  it('mostra Demurrage só quando o B/L tem container', () => {
    const { rerender } = render(
      <MemoryRouter>
        <BlFaturamentoTab active bl={{ id: 'BL-1', cargo_mode: 'container' } as BLDetail} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Demurrage')).toBeTruthy()
    expect(screen.queryByText('Cliente')).toBeNull()

    rerender(
      <MemoryRouter>
        <BlFaturamentoTab active bl={{ id: 'BL-1', cargo_mode: 'carga_solta' } as BLDetail} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Demurrage')).toBeNull()
  })

  it('lista eventos e comunicados do mais recente ao mais antigo', () => {
    useBlCommunicationHistoryMock.mockReturnValue({
      data: [{ id: 9, kind: 'chegada', status: 'enviado', created_at: '2026-06-24T10:00:00Z', anchor_port: null, attachments: [] }],
    })
    render(<MemoryRouter><BlHistoricoTab active blId="BL-1" /></MemoryRouter>)

    const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '')
    expect(items[0]).toContain('Comunicado')
    expect(items[1]).toContain('Shipper')
  })

  it('renderiza eventos e carrega a proxima pagina', () => {
    render(<BlHistoricoTab active blId="BL-1" />)

    expect(screen.getByText(/Shipper/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })
})
