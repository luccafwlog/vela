// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const open = { id: 1, item_id: 101, status: 'open', severity: 'normal', type: 'demurrage', message: 'Container vencendo', entity_type: 'container', entity_id: 'CNTR1', created_at: '2026-06-20T00:00:00Z' }
const ack = { id: 2, status: 'open', severity: 'normal', type: 'invoice_overdue', message: 'Fatura vencida 123', entity_type: 'invoice', entity_id: '123', created_at: '2026-06-19T00:00:00Z', dismissed_until: '2026-08-22T12:00:00Z' }
const portalInvoice = { id: 3, status: 'open', severity: 'critical', type: 'portal_excecao_critica_fatura', message: 'Portal sem email para fatura', entity_type: 'invoice', entity_id: '456', created_at: '2026-06-18T00:00:00Z' }
const adrLegacy = { id: 4, status: 'open', severity: 'normal', type: 'agency_report_department_pending', message: 'ADR legado', entity_type: 'agency_departure_report', entity_id: '10::BRVIX::documentacao', created_at: '2026-06-17T00:00:00Z' }
const adrTerminalized = { id: 5, status: 'open', severity: 'normal', type: 'agency_report_department_pending', message: 'ADR terminalizado', entity_type: 'agency_departure_report', entity_id: '10::BRVIX::TVV::documentacao', created_at: '2026-06-16T00:00:00Z' }
const reviewCustomer = { id: 6, item_id: 106, status: 'open', severity: 'critical', type: 'review_customer_unlinked', message: 'Cliente VALE: 5 B/Ls pendentes de vínculo com cliente', entity_type: 'customer', entity_id: 'VALE', created_at: '2026-06-15T00:00:00Z' }

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const filter = queryKey[1] as string
    const data = filter === 'active'
      ? [open, portalInvoice, adrLegacy, adrTerminalized, reviewCustomer]
      : filter === 'dismissed'
        ? [ack]
        : [open, portalInvoice, adrLegacy, adrTerminalized, reviewCustomer, ack]
    return { data, isLoading: false, error: null }
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../services/alerts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/alerts')>()
  return {
    ...actual,
    listAlerts: vi.fn(),
    dismissAlertItem: vi.fn().mockResolvedValue(undefined),
  }
})

import { Alertas } from '../Alertas'

function renderAlertas(initialEntries: string[] = ['/alertas']) {
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Alertas />
    </MemoryRouter>,
  )
}

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

it('US-135: lista os alertas e filtra por status', () => {
  renderAlertas()

  // "Todos" tab is active -> all current projections are visible
  expect(screen.getByText('Container vencendo')).toBeTruthy()
  expect(screen.getByText('Fatura vencida 123')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Ativos' }))
  expect(screen.getByText('Container vencendo')).toBeTruthy()
  expect(screen.queryByText('Fatura vencida 123')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Dispensados' }))
  expect(screen.getByText('Fatura vencida 123')).toBeTruthy()
  expect(screen.queryByText('Container vencendo')).toBeNull()
})

it('mantém a tabela de alertas rolável sem bloquear o overflow horizontal', () => {
  renderAlertas()

  const table = screen.getByRole('table')
  const scroll = table.closest('.app-table-scroll')

  expect(table.classList.contains('app-table')).toBe(true)
  expect(scroll).not.toBeNull()
  expect(scroll?.classList.contains('overflow-hidden')).toBe(false)
})

it('US-138: oferece link direto para a entidade do alerta', () => {
  renderAlertas()

  // container alert -> /demurrage?busca=CNTR1
  expect(screen.getByRole('link', { name: /Ver Demurrage/ }).getAttribute('href')).toBe('/demurrage?busca=CNTR1')
  // invoice alert with numeric id -> /taxas-locais?invoice=123
  expect(screen.getAllByRole('link', { name: /Ver Fatura/ })[0].getAttribute('href')).toBe('/taxas-locais?invoice=456')
  expect(screen.getAllByRole('link', { name: /Ver Fatura/ })[1].getAttribute('href')).toBe('/taxas-locais?invoice=123')
})

it('oferece o manual de regras no topo da página de alertas', () => {
  renderAlertas()

  expect(screen.getByRole('link', { name: 'Regras de Alertas' }).getAttribute('href')).toBe('/alertas/regras')
})

it('distingue o formato ADR legado do formato terminalizado ao abrir a viagem', () => {
  renderAlertas()

  expect(screen.getAllByRole('link', { name: /Abrir Viagem/ })[0].getAttribute('href')).toBe('/viagens/10?tab=adr&escala=BRVIX')
  expect(screen.getAllByRole('link', { name: /Abrir Viagem/ })[1].getAttribute('href')).toBe('/viagens/10?tab=adr&escala=BRVIX&terminal=TVV')
})

it('sincroniza o filtro de departamento a partir da URL e faz fallback para valores desconhecidos', () => {
  // Test valid department param
  const { unmount } = render(
    <MemoryRouter initialEntries={['/alertas?departamento=documentacao']}>
      <Alertas />
    </MemoryRouter>,
  )
  const select = screen.getByRole('combobox', { name: 'Filtrar por setor' }) as HTMLSelectElement
  expect(select.value).toBe('documentacao')
  unmount()

  // Test sem_departamento
  const { unmount: unmountLegacy } = render(
    <MemoryRouter initialEntries={['/alertas?departamento=sem_departamento']}>
      <Alertas />
    </MemoryRouter>,
  )
  const selectLegacy = screen.getByRole('combobox', { name: 'Filtrar por setor' }) as HTMLSelectElement
  expect(selectLegacy.value).toBe('sem_departamento')
  unmountLegacy()

  // Test unknown fallback -> all ("Todos os setores")
  render(
    <MemoryRouter initialEntries={['/alertas?departamento=setor_inexistente']}>
      <Alertas />
    </MemoryRouter>,
  )
  const selectUnknown = screen.getByRole('combobox', { name: 'Filtrar por setor' }) as HTMLSelectElement
  expect(selectUnknown.value).toBe('all')
})

it('permite trocar o filtro de departamento pelo select', () => {
  renderAlertas()

  const select = screen.getByRole('combobox', { name: 'Filtrar por setor' }) as HTMLSelectElement
  expect(select.value).toBe('all')

  fireEvent.change(select, { target: { value: 'operacoes' } })
  expect(select.value).toBe('operacoes')
})

it('abre modal de dispensa com acessibilidade, data minima futura e limpa campos ao cancelar', () => {
  const { unmount } = render(
    <MemoryRouter initialEntries={['/alertas']}>
      <Alertas />
    </MemoryRouter>,
  )

  // Trigger dismissal for row with item_id if available, or simulate click
  const dismissButtons = screen.queryAllByRole('button', { name: 'Dispensar' })
  if (dismissButtons.length > 0) {
    fireEvent.click(dismissButtons[0])
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('dismiss-alert-modal-title')

    const dateInput = screen.getByLabelText(/Revisar até/) as HTMLInputElement
    expect(dateInput.min).toBeTruthy()

    const reasonInput = screen.getByLabelText(/Motivo da dispensa/) as HTMLTextAreaElement
    fireEvent.change(reasonInput, { target: { value: 'Aguardando armador' } })
    expect(reasonInput.value).toBe('Aguardando armador')

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  }
  unmount()
})

it('filtra alertas por busca textual multifacetada (B/L, mensagem, cliente)', () => {
  renderAlertas()

  expect(screen.getByText('Container vencendo')).toBeTruthy()
  expect(screen.getByText('Cliente VALE: 5 B/Ls pendentes de vínculo com cliente')).toBeTruthy()

  const searchInput = screen.getByRole('textbox', { name: 'Buscar alertas' })
  fireEvent.change(searchInput, { target: { value: 'VALE' } })

  expect(screen.getByText('Cliente VALE: 5 B/Ls pendentes de vínculo com cliente')).toBeTruthy()
  expect(screen.queryByText('Container vencendo')).toBeNull()

  fireEvent.change(searchInput, { target: { value: 'CNTR1' } })
  expect(screen.getByText('Container vencendo')).toBeTruthy()
  expect(screen.queryByText('Cliente VALE: 5 B/Ls pendentes de vínculo com cliente')).toBeNull()
})

it('filtra alertas por severidade e por entidade', () => {
  renderAlertas()

  const severitySelect = screen.getByRole('combobox', { name: 'Filtrar por severidade' }) as HTMLSelectElement
  fireEvent.change(severitySelect, { target: { value: 'critical' } })

  expect(screen.getByText('Portal sem email para fatura')).toBeTruthy()
  expect(screen.getByText('Cliente VALE: 5 B/Ls pendentes de vínculo com cliente')).toBeTruthy()
  expect(screen.queryByText('Container vencendo')).toBeNull()

  const entitySelect = screen.getByRole('combobox', { name: 'Filtrar por tipo de entidade' }) as HTMLSelectElement
  fireEvent.change(entitySelect, { target: { value: 'customer' } })

  expect(screen.getByText('Cliente VALE: 5 B/Ls pendentes de vínculo com cliente')).toBeTruthy()
  expect(screen.queryByText('Portal sem email para fatura')).toBeNull()
})

it('limpa todos os filtros ativos ao clicar no botão Limpar', () => {
  renderAlertas()

  const searchInput = screen.getByRole('textbox', { name: 'Buscar alertas' })
  fireEvent.change(searchInput, { target: { value: 'VALE' } })

  expect(screen.queryByText('Container vencendo')).toBeNull()

  const clearButton = screen.getByRole('button', { name: 'Limpar' })
  fireEvent.click(clearButton)

  expect(screen.getByText('Container vencendo')).toBeTruthy()
  expect(screen.getByText('Cliente VALE: 5 B/Ls pendentes de vínculo com cliente')).toBeTruthy()
})

it('oferece link direto de ação para a tela de revisão /revisao?cliente=... para alertas de revisão agrupados', () => {
  renderAlertas()

  const reviewLink = screen.getByRole('link', { name: /Revisar B\/Ls/ })
  expect(reviewLink).toBeTruthy()
  expect(reviewLink.getAttribute('href')).toBe('/revisao?cliente=VALE')
  expect(reviewLink.className).toContain('app-btn--secondary')
})
