// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DemurrageContainersTab } from '../DemurrageContainersTab'
import type { DemurrageContainerRow } from '../../../services/demurrage/demurrageContainers'

// Cálculo determinístico: 400 USD para container com devolução ou ainda fora.
vi.mock('../../../services/demurrage/demurrageRates', () => ({
  calculateDemurrage: (_type: string, _discharge: string, _end: string, override?: number | null, _p1?: unknown, _p2?: unknown, agreement?: { free_days?: number | null } | null) => ({
    total_days: 40,
    free_days: override ?? agreement?.free_days ?? 10,
    days_p1: 20,
    rate_p1_usd: 10,
    days_p2: 10,
    rate_p2_usd: 20,
    total_usd: 400,
    status: 'overdue',
  }),
}))

afterEach(cleanup)

function row(blId: string, id: number, options: { returned?: boolean; billed?: Array<{ id: number; doc_number: string; status: string }>; agreementDays?: number } = {}): DemurrageContainerRow {
  return {
    id,
    bl_id: blId,
    container_number: `MSCU${id}000000`,
    type: '40HC',
    discharge_date: '2026-06-01',
    return_date: options.returned ? '2026-07-11' : null,
    demurrage_status: options.returned ? 'returned' : 'overdue',
    customer_agreement: options.agreementDays != null ? { id: 1, free_days: options.agreementDays, p1_usd: null, p2_usd: null } : null,
    billed_in: (options.billed ?? []).map((ref) => ({ ...ref, bl_id: blId })),
    bl: {
      id: blId,
      voyage_id: 3,
      free_time_override: null,
      customer: { id: 1, name: `Cliente ${blId}`, cnpj_cpf: '11222333000181' },
      voyage: { id: 3, voyage_number: '001E', vessel: { id: 2, name: 'Navio Teste' } },
    },
  } as unknown as DemurrageContainerRow
}

function renderTab(containers: DemurrageContainerRow[], props: Partial<Parameters<typeof DemurrageContainersTab>[0]> = {}) {
  const handlers = {
    onGenerateInvoice: vi.fn(),
    onEditContainer: vi.fn(),
    onOpenInvoice: vi.fn(),
    onLensChange: vi.fn(),
    onSearchChange: vi.fn(),
  }
  render(
    <MemoryRouter>
      <DemurrageContainersTab
        containers={containers}
        search=""
        lens="todos"
        loading={false}
        error={null}
        canIssue
        generatingBl={null}
        onRetry={vi.fn()}
        {...handlers}
        {...props}
      />
    </MemoryRouter>,
  )
  return handlers
}

describe('DemurrageContainersTab', () => {
  it('B/L com container ainda fora espera a devolução em vez de oferecer uma emissão que o banco recusa', () => {
    renderTab([row('BL-001', 1)])
    expect(screen.getByText('Aguarda devolução de 1 container')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Gerar Invoice/ })).toBeNull()
    expect(screen.getByText(/Fora há \d+ dias/)).toBeTruthy()
  })

  it('B/L devolvido com sobreestadia e sem Invoice oferece Gerar Invoice', async () => {
    const user = userEvent.setup()
    const { onGenerateInvoice } = renderTab([row('BL-002', 2, { returned: true })])
    await user.click(screen.getByRole('button', { name: 'Gerar Invoice do B/L BL-002' }))
    expect(onGenerateInvoice).toHaveBeenCalledWith('BL-002')
  })

  it('diz em qual Invoice cada caixa foi cobrada e oferece a complementar só com as caixas ainda não cobradas', async () => {
    const user = userEvent.setup()
    const { onOpenInvoice } = renderTab([
      row('BL-100', 10, { returned: true, billed: [{ id: 5, doc_number: 'DEM-005', status: 'paid' }] }),
      row('BL-100', 11, { returned: true }),
    ])
    expect(screen.getByRole('button', { name: 'Gerar Invoice complementar do B/L BL-100' })).toBeTruthy()
    expect(screen.getByText(/A complementar cobra só a caixa ainda não cobrada: MSCU11000000/)).toBeTruthy()
    expect(screen.getByText('Sem Invoice')).toBeTruthy()
    const situation = screen.getByText(/Cobrada em/)
    await user.click(within(situation).getByRole('button', { name: 'DEM-005' }))
    expect(onOpenInvoice).toHaveBeenCalledWith(5)
  })

  it('grupo com todas as caixas cobradas não oferece emissão', () => {
    renderTab([row('BL-200', 20, { returned: true, billed: [{ id: 6, doc_number: 'DEM-006', status: 'issued' }] })])
    expect(screen.getByText('Todas as caixas cobradas')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Gerar/ })).toBeNull()
  })

  it('quem a RPC recusa vê o estado e o motivo, sem o botão', () => {
    renderTab([row('BL-002', 2, { returned: true })], { canIssue: false })
    expect(screen.queryByRole('button', { name: /Gerar/ })).toBeNull()
    expect(screen.getByText('Pronto para faturar')).toBeTruthy()
    expect(screen.getByText('Gerar Invoice é do Administrativo.')).toBeTruthy()
  })

  it('a emissão em andamento fica no botão do B/L e trava só as outras emissões e as datas dele', () => {
    renderTab([row('BL-001', 1, { returned: true }), row('BL-002', 2, { returned: true })], { generatingBl: 'BL-001' })
    const busy = screen.getByRole('button', { name: 'Gerar Invoice do B/L BL-001' }) as HTMLButtonElement
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect((screen.getByRole('button', { name: 'Gerar Invoice do B/L BL-002' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Editar datas de MSCU1000000' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Editar datas de MSCU2000000' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('mostra a recusa do banco na linha do B/L que pediu a emissão', () => {
    renderTab([row('BL-002', 2, { returned: true })], { generateError: { blId: 'BL-002', message: 'Aguardando a devolução de todos os containers do B/L (grupo do B/L BL-001).' } })
    expect(screen.getByRole('alert').textContent).toContain('grupo do B/L BL-001')
  })

  it('mostra de onde vem o free time aplicado', () => {
    renderTab([row('BL-002', 2, { returned: true, agreementDays: 28 })])
    expect(screen.getByText('28 dias')).toBeTruthy()
    expect(screen.getByText('acordo do Cliente')).toBeTruthy()
  })

  it('o recorte conta por lente e a busca sem resultado oferece limpar', async () => {
    const user = userEvent.setup()
    const { onLensChange, onSearchChange } = renderTab([row('BL-001', 1), row('BL-002', 2, { returned: true })], { search: 'nada-aqui' })
    expect(screen.getByText('Nenhum container neste recorte')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Limpar busca e recorte' }))
    expect(onSearchChange).toHaveBeenCalledWith('')
    expect(onLensChange).toHaveBeenCalledWith('todos')
  })

  it('erro de consulta não vira "nenhum container"', () => {
    renderTab([], { containers: undefined, error: new Error('falhou') })
    expect(screen.getByText(/Não foi possível carregar os containers/)).toBeTruthy()
    expect(screen.queryByText('Nenhum container em Demurrage')).toBeNull()
  })
})
