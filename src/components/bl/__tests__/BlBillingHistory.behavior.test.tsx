// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlFaturamentoTab } from '../BlFaturamentoTab'
import { BlHistoricoTab } from '../BlHistoricoTab'
import type { BLDetail } from '../../../types/database'

const { useActorNamesMock, useBlTimelineMock, useInvoiceLinksMock, useBlCommunicationHistoryMock } = vi.hoisted(() => ({
  useActorNamesMock: vi.fn(),
  useBlTimelineMock: vi.fn(),
  useInvoiceLinksMock: vi.fn(),
  useBlCommunicationHistoryMock: vi.fn(),
}))

vi.mock('../../../hooks/useBlTimeline', () => ({ useBlTimeline: useBlTimelineMock, useActorNames: useActorNamesMock }))
vi.mock('../../../hooks/useCustomerCommunications', () => ({ useBlCommunicationHistory: useBlCommunicationHistoryMock }))
vi.mock('../../../hooks/useBilling', () => ({ useInvoiceLinks: useInvoiceLinksMock }))
vi.mock('../BlClienteSection', () => ({ BlClienteSection: () => <div>Cliente</div> }))
vi.mock('../BlCobrancasTab', () => ({ BlCobrancasSection: () => <div>Cobrancas</div> }))
vi.mock('../BlDemurrageSection', () => ({ BlDemurrageSection: () => <div>Demurrage</div> }))

beforeEach(() => {
  useBlCommunicationHistoryMock.mockReturnValue({ data: [] })
  useInvoiceLinksMock.mockReturnValue({
    data: { 'BL-1': [{ id: 77, invoice_number: 'INV-077' }] },
  })
  useActorNamesMock.mockReturnValue({ data: undefined })
  useBlTimelineMock.mockReturnValue({
    data: {
      events: [{
        id: 1,
        family: 'edicao',
        entity_type: 'bl',
        field_name: 'shipper',
        old_value: 'A',
        new_value: 'B',
        changed_by: 'user-1',
        changed_at: '2026-06-23',
        justification: 'Correcao',
      }],
      actorNames: new Map([['user-1', 'Ana Ribeiro']]),
    },
    isLoading: false,
    isError: false,
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

  it('lista eventos e comunicados do mais recente ao mais antigo, com assunto e autor', () => {
    useBlCommunicationHistoryMock.mockReturnValue({
      data: [{ id: 9, kind: 'chegada', status: 'falha', created_by: null, created_at: '2026-06-24T10:00:00Z', anchor_port: null, attachments: [] }],
    })
    render(<MemoryRouter><BlHistoricoTab active blId="BL-1" /></MemoryRouter>)

    const rows = screen.getAllByRole('row').slice(1).map((row) => row.textContent ?? '')
    expect(rows[0]).toContain('Comunicado')
    expect(rows[0]).toContain('Falha')
    expect(rows[1]).toContain('Shipper: A → B')
    expect(rows[1]).toContain('Motivo: Correcao')
    expect(rows[1]).toContain('Ana Ribeiro')
    expect(screen.queryByText(/auditado/)).toBeNull()
  })

  it('filtra por assunto e pagina de 20 em 20', () => {
    const events = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1, family: index === 0 ? 'fatura' : 'edicao', entity_type: 'bl', field_name: index === 0 ? 'financial_status' : 'notes',
      old_value: null, new_value: index === 0 ? 'paid' : `nota ${index}`, changed_by: null, changed_at: `2026-06-${String(index + 1).padStart(2, '0')}`, justification: null,
    }))
    useBlTimelineMock.mockReturnValue({ data: { events, actorNames: new Map() }, isLoading: false, isError: false })
    render(<MemoryRouter><BlHistoricoTab active blId="BL-1" /></MemoryRouter>)

    expect(screen.getAllByRole('row')).toHaveLength(21)
    fireEvent.click(screen.getByRole('button', { name: 'Fatura' }))
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Status financeiro')
  })
})
