// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const open = { id: 1, item_id: 101, status: 'open', severity: 'normal', type: 'demurrage', message: 'Container vencendo', entity_type: 'container', entity_id: 'CNTR1', department: null, created_at: '2026-06-20T00:00:00Z' }
const ack = { id: 2, item_id: 102, status: 'open', severity: 'normal', type: 'invoice_overdue', message: 'Fatura vencida 123', entity_type: 'invoice', entity_id: '123', department: 'administrativo', created_at: '2026-06-19T00:00:00Z', dismissed_until: '2026-08-22T12:00:00Z', dismissal_reason: 'Aguardando o financeiro', dismissed_by_name: 'Ana Ribeiro' }
const portalInvoice = { id: 3, status: 'open', severity: 'critical', type: 'portal_excecao_critica_fatura', message: 'Portal sem email para fatura', entity_type: 'invoice', entity_id: '456', department: 'documentacao', created_at: '2026-06-18T00:00:00Z' }
const adrLegacy = { id: 4, status: 'open', severity: 'normal', type: 'agency_report_department_pending', message: 'ADR legado', entity_type: 'agency_departure_report', entity_id: '10::BRVIX::documentacao', created_at: '2026-06-17T00:00:00Z' }
const reviewCustomer = { id: 6, item_id: 106, status: 'open', severity: 'critical', type: 'review_customer_unlinked', message: 'Cliente VALE: 5 B/Ls pendentes de vínculo com cliente', entity_type: 'customer', entity_id: 'VALE', department: 'documentacao', created_at: '2026-06-15T00:00:00Z', metadata: { bl_ids: ['MEDU1234567', 'MEDU7654321'] } }
const unlinked = { id: 8, item_id: 108, status: 'open', severity: 'critical', type: 'review_customer_unlinked', message: '', entity_type: 'customer', entity_id: 'sem_cliente', department: 'documentacao', created_at: '2026-06-15T00:00:00Z' }
const ceChanged = { id: 7, item_id: 107, status: 'open', severity: 'critical', type: 'ce_trocado_com_desbloqueio', message: 'CE trocado depois do Desbloqueio', entity_type: 'bl', entity_id: 'BL-CE-1', department: 'documentacao', created_at: '2026-06-14T00:00:00Z' }

const ACTIVE = [open, portalInvoice, adrLegacy, reviewCustomer, unlinked, ceChanged]
const summary = [
  { department: 'documentacao', active_count: 4, dismissed_count: 0, is_legacy: false },
  { department: 'administrativo', active_count: 0, dismissed_count: 1, is_legacy: false },
  { department: 'sem_departamento', active_count: 2, dismissed_count: 0, is_legacy: true },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'alert-department-summary') return { data: summary, isLoading: false, error: null }
    if (queryKey[1] === 'entity-labels') return { data: { 'voyage:10': 'COSCO SHIPPING ARIES / 088E' }, isLoading: false, error: null }
    const filter = queryKey[1] as string
    const data = filter === 'dismissed' ? [ack] : ACTIVE
    return { data, isLoading: false, error: null }
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
const confirmWithReason = vi.hoisted(() => vi.fn())
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirmWithReason: () => confirmWithReason }))
const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}))
vi.mock('../../services/alerts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/alerts')>()
  return {
    ...actual,
    listAlerts: vi.fn(),
    dismissAlertItem: vi.fn().mockResolvedValue(undefined),
  }
})

import { Alertas } from '../Alertas'
import { getMaxReviewDateString } from '../../services/alerts'

function renderAlertas(initialEntries: string[] = ['/alertas']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Alertas />
    </MemoryRouter>,
  )
}

function rowOf(text: string) {
  return screen.getByText(text).closest('tr') as HTMLElement
}

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

it('abre em Ativos, sem "Todos" nem Atualizar, com o título igual ao menu', () => {
  renderAlertas()

  expect(screen.getByRole('heading', { level: 1, name: 'Alertas' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Ativos/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByRole('button', { name: 'Todos' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Atualizar' })).toBeNull()
  expect(screen.getByText('Container vencendo')).toBeTruthy()
  expect(screen.queryByText('Fatura vencida 123')).toBeNull()
})

it('cartões contam a fila pelo resumo por setor e filtram críticos e dispensados', () => {
  renderAlertas()

  expect(screen.getByRole('button', { name: /Ativos\s*6/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Críticos\s*4/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Dispensados\s*1/ })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /Críticos/ }))
  expect(screen.queryByText('Container vencendo')).toBeNull()
  expect(screen.getByText('Portal sem email para fatura')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /Dispensados/ }))
  expect(screen.queryByText('Container vencendo')).toBeNull()
  const dismissed = rowOf('Ana Ribeiro')
  expect(within(dismissed).getByText('22/08/2026')).toBeTruthy()
  fireEvent.click(within(dismissed).getByRole('button', { name: /Abrir/ }))
  expect(screen.getByText('Aguardando o financeiro')).toBeTruthy()
})

it('gravidade em texto: Crítico em vermelho, Normal em tinta normal, sem selo', () => {
  renderAlertas()

  const critical = within(rowOf('Portal sem email para fatura')).getByText('Crítico')
  expect(critical.classList.contains('app-status-text--danger')).toBe(true)
  const normal = within(rowOf('Container vencendo')).getByText('Normal')
  expect(normal.closest('.app-badge')).toBeNull()
  expect(normal.closest('.app-status-text')).toBeNull()
})

it('Registro diz onde, sem o tipo na frente, e não repete o grupo técnico sem_cliente', () => {
  renderAlertas()

  expect(within(rowOf('ADR legado')).getByRole('link', { name: 'COSCO SHIPPING ARIES / 088E · BRVIX' }).getAttribute('href')).toBe('/viagens/10')
  expect(within(rowOf('CE trocado depois do Desbloqueio')).getByRole('link', { name: 'BL-CE-1' }).getAttribute('href')).toBe('/bls/BL-CE-1')
  const unlinkedRow = screen.getByText('B/Ls sem Cliente').closest('tr') as HTMLElement
  expect(within(unlinkedRow).queryByText(/sem_cliente/)).toBeNull()
  // Mensagem vazia: "—" discreto, não a repetição do Alerta ou do Registro.
  expect(within(unlinkedRow).getByText('—')).toBeTruthy()
})

it('toda linha tem "Resolver", que leva ao lugar da resolução, e "Dispensar" para alerta por item', () => {
  renderAlertas()

  const container = rowOf('Container vencendo')
  const resolve = within(container).getByRole('button', { name: /^Resolver / })
  expect(resolve.getAttribute('aria-label')).toBe('Resolver Demurrage · CNTR1')
  expect(resolve.getAttribute('title')).toBe('Ver Demurrage')
  fireEvent.click(resolve)
  expect(navigate).toHaveBeenCalledWith('/demurrage?busca=CNTR1')
  expect(within(container).getByRole('button', { name: /^Dispensar / })).toBeTruthy()

  fireEvent.click(within(rowOf('Cliente VALE: 5 B/Ls pendentes de vínculo com cliente')).getByRole('button', { name: /^Resolver / }))
  expect(navigate).toHaveBeenCalledWith('/revisao?cliente=VALE')

  // Alerta antigo, sem item: não dispensa.
  expect(within(rowOf('Portal sem email para fatura')).queryByRole('button', { name: /^Dispensar/ })).toBeNull()
})

it('A23: nos alertas de conferência sem fato de origem, "Resolver" abre a justificativa', async () => {
  confirmWithReason.mockResolvedValue(null)
  renderAlertas()

  fireEvent.click(within(rowOf('CE trocado depois do Desbloqueio')).getByRole('button', { name: /^Resolver / }))
  await waitFor(() => expect(confirmWithReason).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Resolver com justificativa',
    confirmLabel: 'Resolver',
  })))
  expect(navigate).not.toHaveBeenCalled()
})

// Ponto 9: a lista colada casa também os B/Ls que o alerta guarda em metadata (alerta por Cliente ou escala).
it('lista de B/Ls colada acha o alerta que guarda os B/Ls em metadata', () => {
  renderAlertas()
  fireEvent.change(screen.getByLabelText('Buscar alertas'), { target: { value: 'MSCU0000001 MEDU7654321' } })
  expect(screen.getByText('Cliente VALE: 5 B/Ls pendentes de vínculo com cliente')).toBeTruthy()
  expect(screen.queryByText('Container vencendo')).toBeNull()
})

it('oferece as regras de alertas no topo', () => {
  renderAlertas()

  expect(screen.getByRole('link', { name: 'Regras de alertas' }).getAttribute('href')).toBe('/alertas/regras')
})

it('sincroniza o filtro de setor a partir da URL e faz fallback para valores desconhecidos', () => {
  const { unmount } = renderAlertas(['/alertas?departamento=administrativo'])
  expect((screen.getByLabelText('Setor') as HTMLSelectElement).value).toBe('administrativo')
  unmount()

  const legacy = renderAlertas(['/alertas?departamento=sem_departamento'])
  expect((screen.getByLabelText('Setor') as HTMLSelectElement).value).toBe('sem_departamento')
  legacy.unmount()

  renderAlertas(['/alertas?departamento=setor_inexistente'])
  expect((screen.getByLabelText('Setor') as HTMLSelectElement).value).toBe('all')
})

it('janela de dispensa: peça comum, data mínima futura, botão com a data e campos limpos ao voltar', () => {
  renderAlertas()

  fireEvent.click(within(rowOf('Container vencendo')).getByRole('button', { name: /^Dispensar / }))
  const dialog = screen.getByRole('dialog')
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(within(dialog).getByText(/não resolve a pendência/)).toBeTruthy()
  expect(within(dialog).getByText(/volta sozinho/)).toBeTruthy()

  const dateInput = within(dialog).getByLabelText('Volta para a fila em') as HTMLInputElement
  expect(dateInput.min).toBeTruthy()
  // Até o 30º dia (migration 433): o calendário não oferece data além.
  expect(dateInput.max).toBe(getMaxReviewDateString())
  const inRange = new Date()
  inRange.setUTCDate(inRange.getUTCDate() + 10)
  const [, month, day] = inRange.toISOString().slice(0, 10).split('-')
  fireEvent.change(dateInput, { target: { value: inRange.toISOString().slice(0, 10) } })
  expect(within(dialog).getByRole('button', { name: `Dispensar até ${day}/${month}` })).toBeTruthy()

  const reasonInput = within(dialog).getByLabelText('Motivo') as HTMLTextAreaElement
  fireEvent.change(reasonInput, { target: { value: 'Aguardando armador' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }))
  expect(screen.queryByRole('dialog')).toBeNull()

  fireEvent.click(within(rowOf('Container vencendo')).getByRole('button', { name: /^Dispensar / }))
  expect((screen.getByLabelText('Motivo') as HTMLTextAreaElement).value).toBe('')
})

it('limite da dispensa é o 30º dia a partir de hoje, em UTC como a data enviada ao banco', () => {
  expect(getMaxReviewDateString(new Date('2026-10-22T10:00:00Z'))).toBe('2026-11-21')
  expect(getMaxReviewDateString(new Date('2026-12-15T23:30:00Z'))).toBe('2027-01-14')
})

it('filtra por busca, gravidade e registro, e limpa os filtros', () => {
  renderAlertas()

  const searchInput = screen.getByRole('searchbox', { name: 'Buscar alertas' })
  fireEvent.change(searchInput, { target: { value: 'VALE' } })
  expect(screen.getByText('Cliente VALE: 5 B/Ls pendentes de vínculo com cliente')).toBeTruthy()
  expect(screen.queryByText('Container vencendo')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
  expect(screen.getByText('Container vencendo')).toBeTruthy()

  fireEvent.change(screen.getByLabelText('Gravidade'), { target: { value: 'critical' } })
  expect(screen.queryByText('Container vencendo')).toBeNull()
  fireEvent.change(screen.getByLabelText('Registro'), { target: { value: 'bl' } })
  expect(screen.getByText('CE trocado depois do Desbloqueio')).toBeTruthy()
  expect(screen.queryByText('Portal sem email para fatura')).toBeNull()
})
