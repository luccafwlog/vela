// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DemurrageContainersTab } from '../DemurrageContainersTab'
import type { DemurrageBillingGroup, DemurrageContainerRow } from '../../../services/demurrage/demurrageContainers'

// Cálculo determinístico: 400 USD para container com devolução ou ainda fora.
vi.mock('../../../services/demurrage/demurrageRates', () => ({
  demurrageFreeTimeDays: (_type: string, override?: number | null, agreement?: { free_days?: number | null } | null) => override ?? agreement?.free_days ?? 10,
  calculateDemurrage: (type: string, _discharge: string, _end: string, override?: number | null, _p1?: unknown, _p2?: unknown, agreement?: { free_days?: number | null } | null) => {
    if (type === 'XXXX') throw new Error('Tipo de container "XXXX" sem tarifa de Demurrage cadastrada.')
    return ({
    total_days: 40,
    free_days: override ?? agreement?.free_days ?? 10,
    days_p1: 20,
    rate_p1_usd: 10,
    days_p2: 10,
    rate_p2_usd: 20,
    total_usd: 400,
    status: 'overdue',
  })
  },
}))

afterEach(cleanup)

function row(blId: string, id: number, options: { returned?: boolean; billed?: Array<{ id: number; doc_number: string; status: string }>; agreementDays?: number; number?: string; group?: DemurrageBillingGroup } = {}): DemurrageContainerRow {
  return {
    id,
    bl_id: blId,
    container_number: options.number ?? `MSCU${id}000000`,
    type: '40HC',
    discharge_date: '2026-06-01',
    return_date: options.returned ? '2026-07-11' : null,
    demurrage_status: options.returned ? 'returned' : 'overdue',
    customer_agreement: options.agreementDays != null ? { id: 1, free_days: options.agreementDays, p1_usd: null, p2_usd: null } : null,
    billed_in: (options.billed ?? []).map((ref) => ({ ...ref, bl_id: blId })),
    billing_group: options.group ?? null,
    bl: {
      id: blId,
      voyage_id: 3,
      free_time_override: null,
      customer: { id: 1, name: `Cliente ${blId}`, cnpj_cpf: '11222333000181' },
      voyage: { id: 3, voyage_number: '001E', vessel: { id: 2, name: 'Navio Teste' } },
    },
  } as unknown as DemurrageContainerRow
}

/** Abre a linha do B/L para mostrar os containers (fechada por padrão). */
async function openBl(blId: string) {
  await userEvent.setup().click(screen.getByRole('button', { name: `Abrir os containers do B/L ${blId}` }))
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
    expect(screen.getByText('0 de 1 devolvido')).toBeTruthy()
  })

  it('B/L devolvido com sobreestadia e sem Invoice oferece Gerar Invoice', async () => {
    const user = userEvent.setup()
    const { onGenerateInvoice } = renderTab([row('BL-002', 2, { returned: true })])
    const generate = screen.getByRole('button', { name: 'Gerar Invoice do B/L BL-002' })
    // Na linha da tabela de B/Ls, só o ícone (regra 9).
    expect(generate.textContent).toBe('')
    await user.click(generate)
    expect(onGenerateInvoice).toHaveBeenCalledWith('BL-002')
  })

  it('diz em qual Invoice cada caixa foi cobrada e oferece a complementar só com as caixas ainda não cobradas', async () => {
    const user = userEvent.setup()
    const { onOpenInvoice } = renderTab([
      row('BL-100', 10, { returned: true, billed: [{ id: 5, doc_number: 'DEM-005', status: 'paid' }] }),
      row('BL-100', 11, { returned: true }),
    ])
    expect(screen.getByRole('button', { name: 'Gerar Invoice complementar do B/L BL-100' })).toBeTruthy()
    // Situação do B/L em texto: a Invoice que já cobra, a situação dela e o que falta cobrar.
    expect(screen.getByText('1 caixa sem Invoice')).toBeTruthy()
    // Em âmbar só o que falta faturar (a caixa sem Invoice), não o total do B/L.
    const table = screen.getByRole('table', { name: /B\/Ls com containers em Demurrage/ })
    expect(within(table).getByText('a faturar de US$ 800,00')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'DEM-005' }))
    expect(onOpenInvoice).toHaveBeenCalledWith(5)
    await openBl('BL-100')
    expect(screen.getByText(/A complementar cobra só a caixa ainda não cobrada: MSCU11000000/)).toBeTruthy()
    // A caixa cobrada diz em qual Invoice, num botão que abre a Invoice.
    const boxes = screen.getByRole('table', { name: 'Containers do B/L BL-100' })
    await user.click(within(boxes).getByRole('button', { name: 'DEM-005' }))
    expect(onOpenInvoice).toHaveBeenCalledTimes(2)
  })

  it('grupo com todas as caixas cobradas não oferece emissão', () => {
    renderTab([row('BL-200', 20, { returned: true, billed: [{ id: 6, doc_number: 'DEM-006', status: 'issued' }] })])
    expect(screen.getByRole('button', { name: 'DEM-006' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Gerar/ })).toBeNull()
  })

  it('quem a RPC recusa vê o estado e o motivo, sem o botão', () => {
    renderTab([row('BL-002', 2, { returned: true })], { canIssue: false })
    expect(screen.queryByRole('button', { name: /Gerar/ })).toBeNull()
    expect(screen.getByText('Pronto para faturar')).toBeTruthy()
    expect(screen.getByText('Gerar Invoice exige um perfil interno ativo.')).toBeTruthy()
  })

  it('a emissão em andamento fica no botão do B/L e trava só as outras emissões e as datas dele', async () => {
    renderTab([row('BL-001', 1, { returned: true }), row('BL-002', 2, { returned: true })], { generatingBl: 'BL-001' })
    await openBl('BL-001')
    await openBl('BL-002')
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

  it('mostra de onde vem o free time aplicado, ao passar o mouse', async () => {
    renderTab([row('BL-002', 2, { returned: true, agreementDays: 28 })])
    await openBl('BL-002')
    expect(screen.getByTitle('Free time acordo do Cliente').textContent).toBe('28')
    // Colunas da fatura do Portal: dias em âmbar além do free time e "dias × diária".
    expect(screen.getByText('20 × US$ 10,00')).toBeTruthy()
    expect(screen.getByText('10 × US$ 20,00')).toBeTruthy()
  })

  it('o recorte conta por lente e a busca sem resultado oferece limpar', async () => {
    const user = userEvent.setup()
    const { onLensChange, onSearchChange } = renderTab([row('BL-001', 1), row('BL-002', 2, { returned: true })], { search: 'nada-aqui' })
    expect(screen.getByText('Nenhum container neste recorte')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Limpar busca e recorte' }))
    expect(onSearchChange).toHaveBeenCalledWith('')
    expect(onLensChange).toHaveBeenCalledWith('todos')
  })

  it('container devolvido que não se calcula continua visível, com o erro e a edição de datas', async () => {
    renderTab([{ ...row('BL-009', 9, { returned: true }), type: 'XXXX' } as DemurrageContainerRow])
    await openBl('BL-009')
    expect(screen.getByText(/sem tarifa de Demurrage cadastrada/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Editar datas de MSCU9000000' })).toBeTruthy()
    expect(screen.queryByText('Nenhum container em Demurrage')).toBeNull()
  })

  it('a lente não esconde a caixa irmã ainda fora: o B/L continua aguardando a devolução', () => {
    renderTab([row('BL-001', 1, { returned: true }), row('BL-001', 2)], { lens: 'devolvidos' })
    expect(screen.getByText('Aguarda devolução de 1 container')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Gerar/ })).toBeNull()
  })

  it('buscar a caixa já cobrada não esconde a irmã sem Invoice', () => {
    renderTab([
      row('BL-001', 1, { returned: true, billed: [{ id: 9, doc_number: 'DEM-009', status: 'issued' }] }),
      row('BL-001', 2, { returned: true }),
    ], { search: 'MSCU1000000' })
    expect(screen.queryByText('Todas as caixas cobradas')).toBeNull()
    expect(screen.getByRole('button', { name: 'Gerar Invoice complementar do B/L BL-001' })).toBeTruthy()
  })

  it('caixa do grupo ainda fora no free time (fora da lista) segura a emissão, como no banco', () => {
    const group: DemurrageBillingGroup = { anchorBlId: 'BL-001', blIds: ['BL-001'], boxes: 2, stillOut: 1, uncovered: 2, invoices: [] }
    renderTab([row('BL-001', 1, { returned: true, group })])
    expect(screen.getByText('Aguarda devolução de 1 container')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Gerar/ })).toBeNull()
  })

  it('container compartilhado entre B/Ls do grupo conta uma vez e tem uma só ação, no primeiro B/L', () => {
    const group: DemurrageBillingGroup = { anchorBlId: 'BL-001', blIds: ['BL-001', 'BL-002'], boxes: 1, stillOut: 0, uncovered: 1, invoices: [] }
    renderTab([
      row('BL-001', 1, { returned: true, number: 'SHAR1234567', group }),
      row('BL-002', 2, { returned: true, number: 'SHAR1234567', group }),
    ])
    expect(screen.getAllByRole('button', { name: /Gerar Invoice/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Gerar Invoice do B/L BL-001' })).toBeTruthy()
    expect(screen.getByText('Cobrança junto com o B/L BL-001')).toBeTruthy()
    const strip = screen.getByLabelText('Resumo dos containers')
    expect(within(strip).getAllByText('US$ 400,00').length).toBeGreaterThan(0)
    expect(within(strip).queryByText('US$ 800,00')).toBeNull()
  })

  it('erro de consulta não vira "nenhum container"', () => {
    renderTab([], { containers: undefined, error: new Error('falhou') })
    expect(screen.getByText(/Não foi possível carregar os containers/)).toBeTruthy()
    expect(screen.queryByText('Nenhum container em Demurrage')).toBeNull()
  })
})
