// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { DesbloqueioCe } from '../DesbloqueioCe'
import { ToastProvider } from '../../components/ui/Toast'
const state = vi.hoisted(() => ({
  manage: true, canExport: false, delivered: false, mutateAsync: vi.fn(async () => ({})), filters: [] as unknown[],
  extra: [] as Record<string, unknown>[], command: vi.fn(async (...args: unknown[]) => args && {}), confirms: [] as unknown[],
}))
const row = (patch: Record<string, unknown> = {}) => ({
  bl_id: 'BL-557', ce_mercante: '123', customer_name: 'Cliente', cnpj_cpf: '123456', state: 'no_request',
  reasons: ['Taxas locais sem liquidação integral confirmada'], paid: false, termo: true, procuracao: false,
  delivered: state.delivered, delivery_version: 4, can_export: state.canExport, export_state: 'not_exported',
  sla_started_at: null, exported_at: null, vessel_name: 'Navio', voyage_number: '001', pod: 'BRSSZ', ...patch,
})
vi.mock('../../hooks/useBls', () => ({ useVoyageOptions: () => ({ data: [] }) }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ can: (p: string) => p === 'ce_unlock_read' || state.manage }) }))
vi.mock('../../services/ceUnlockService', async (orig) => ({
  ...(await orig<typeof import('../../services/ceUnlockService')>()),
  ceUnlockCommand: state.command,
}))
vi.mock('../../hooks/useCeUnlock', () => ({
  useCeUnlock: (filters: unknown) => {
    state.filters.push(filters)
    const items = [row(), ...state.extra.map((p) => row(p))]
    return { list: { data: { total: items.length, items } }, command: { isPending: false, mutateAsync: state.mutateAsync } }
  },
  useCeUnlockSituationCounts: () => ({ ready_not_exported: 1, exported: 1, divergent: 1, unlocked: 2, '': 12 }),
  useCeUnlockRequest: () => ({ data: null }),
  useCeUnlockReviewQueue: () => ({
    isLoading: false, error: null, refetch: vi.fn(),
    data: { total: 1, items: [{
      id: 'req-1', protocol: 'CE-ABC', state: 'submitted', version: 1, created_at: '2026-10-07T10:00:00Z', customer_name: 'Cliente Fila',
      cnpj_cpf: '999', sla_started_at: '2026-10-07T10:00:00-03:00', bl_ids: ['BL-1', 'BL-2'], termo_status: 'uploaded', procuracao_status: 'changes_requested',
    }] },
  }),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => async (opts: unknown) => { state.confirms.push(opts); return true },
  useConfirmWithReason: () => async () => 'Entrega lançada por engano',
}))
afterEach(() => {
  cleanup(); state.manage = true; state.canExport = false; state.delivered = false; state.mutateAsync.mockClear(); state.filters.length = 0
  state.extra = []; state.command.mockReset(); state.command.mockImplementation(async () => ({})); state.confirms.length = 0
})
function mount(path = '/?aba=controle') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={[path]}><DesbloqueioCe /></MemoryRouter></ToastProvider></QueryClientProvider>)
}
it('cabeçalho só com o título; aba Solicitações com contagem e tabela limpa', () => {
  mount('/')
  expect(screen.getByRole('heading', { name: 'Desbloqueio de CE' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: /Solicitações/, selected: true }).textContent).toContain('1')
  expect(screen.getByRole('tab', { name: 'Andamento dos B/Ls' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Cliente Fila' }).getAttribute('href')).toBe('/clientes/999?tab=desbloqueio-ce')
  expect(screen.getByText('Aguardando análise')).toBeTruthy()
  expect(screen.getByText('Recusada')).toBeTruthy()
  expect(screen.getByText('+1')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Abrir solicitação CE-ABC' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Analisar/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Modelo do termo de devolução' })).toBeTruthy()
  expect(screen.queryByLabelText('Selecionar B/L BL-557')).toBeNull()
})
it('Andamento dos B/Ls: cartões filtram pela situação', async () => {
  mount()
  const card = screen.getByRole('button', { name: /Exportados, aguardando a ZPT/ })
  await userEvent.click(card)
  expect(state.filters.at(-1)).toMatchObject({ situation: 'exported' })
  expect(screen.getByRole('button', { name: /B\/Ls com CE\s*12/ }).getAttribute('aria-pressed')).toBe('false')
})
it('mostra os quatro requisitos com os ícones de hoje e Na ZPT só com o estado da ZPT', () => {
  mount()
  expect(screen.getByRole('link', { name: 'BL-557' })).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Termo de devolução BL-557: atendido' })).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Procuração BL-557: pendente' })).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Taxas locais BL-557: pendente' })).toBeTruthy()
  expect(screen.queryByText('Taxas locais sem liquidação integral confirmada')).toBeNull()
  expect(screen.getByText('Não exportado')).toBeTruthy()
  expect(screen.getByLabelText('B/L original: BL-557').hasAttribute('disabled')).toBe(false)
  // Seleção em qualquer B/L, não só nos aptos.
  expect(screen.getByLabelText('Selecionar B/L BL-557').hasAttribute('disabled')).toBe(false)
})
it('filtro padrão é "Todas"', () => {
  mount()
  expect(state.filters.at(-1)).toMatchObject({ situation: '' })
})
it('marcar B/L original registra a entrega; desmarcar pede motivo', async () => {
  const view = mount()
  await userEvent.click(screen.getByLabelText('B/L original: BL-557'))
  expect(state.mutateAsync).toHaveBeenCalledWith({ action: 'delivery', payload: expect.objectContaining({ bl_id: 'BL-557', delivered: true, expected_version: 4, reason: null }) })
  view.unmount()
  state.delivered = true
  state.mutateAsync.mockClear()
  mount()
  await userEvent.click(screen.getByLabelText('B/L original: BL-557'))
  expect(state.mutateAsync).toHaveBeenCalledWith({ action: 'delivery', payload: expect.objectContaining({ delivered: false, reason: 'Entrega lançada por engano' }) })
})
it('Financeiro/Operações consultam requisitos sem ações internas ou modelo', () => {
  state.manage = false
  mount()
  expect(screen.getByRole('link', { name: 'BL-557' })).toBeTruthy()
  expect(screen.getByLabelText('B/L original: BL-557').hasAttribute('disabled')).toBe(true)
  expect(screen.getByLabelText('Selecionar B/L BL-557').hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: /Exportar planilha/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Conciliar com a ZPT' })).toBeNull()
  expect(screen.queryByRole('button', { name: /para a ZPT/ })).toBeNull()
})
it('Planilhas enviadas à ZPT não tem botão para registrar envio nem confirmar desbloqueio', async () => {
  mount()
  await userEvent.click(screen.getByRole('button', { name: 'Planilhas enviadas à ZPT' }))
  expect(screen.queryByRole('button', { name: /Registrar envio/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Confirmar desbloqueio/ })).toBeNull()
})
it('faixa de seleção conta aptos e sem entrega; exportar leva só os aptos selecionados', async () => {
  state.extra = [{ bl_id: 'BL-600', can_export: true, delivered: true }, { bl_id: 'BL-700', can_export: false }]
  mount()
  const exportButton = () => screen.getByRole('button', { name: /aptos? para a ZPT$/ })
  expect(exportButton().hasAttribute('disabled')).toBe(true)
  await userEvent.click(screen.getByLabelText('Selecionar os B/Ls da página'))
  const bar = screen.getByRole('region', { name: 'Seleção' })
  expect(bar.textContent).toContain('3 selecionados · 1 apto para a ZPT · 2 sem a entrega do B/L original')
  expect(within(bar).getByRole('button', { name: 'Registrar entrega de 2 B/Ls' })).toBeTruthy()
  expect(exportButton().textContent).toContain('Exportar 1 apto para a ZPT')
  await userEvent.click(within(bar).getByRole('button', { name: /Limpar seleção/ }))
  expect(screen.queryByRole('region', { name: 'Seleção' })).toBeNull()
})
it('registra a entrega em massa B/L por B/L e diz quais falharam', async () => {
  state.extra = [{ bl_id: 'BL-600', delivered: true }, { bl_id: 'BL-700', delivery_version: 9 }]
  state.command.mockImplementation(async (_action: unknown, payload: unknown) => {
    if ((payload as { bl_id: string }).bl_id === 'BL-700') throw new Error('Entrega alterada; atualize a página')
    return {}
  })
  mount()
  await userEvent.click(screen.getByLabelText('Selecionar os B/Ls da página'))
  await userEvent.click(screen.getByRole('button', { name: 'Registrar entrega de 2 B/Ls' }))
  expect(state.confirms.at(-1)).toMatchObject({ affected: { items: ['BL-557', 'BL-700'] } })
  await waitFor(() => expect(state.command).toHaveBeenCalledTimes(2))
  expect(state.command.mock.calls.map((c) => (c[1] as { bl_id: string }).bl_id)).toEqual(['BL-557', 'BL-700'])
  expect(state.command.mock.calls[1][1]).toMatchObject({ delivered: true, expected_version: 9, reason: null })
  expect(await screen.findByText(/Entrega registrada em 1 B\/L/)).toBeTruthy()
  expect(screen.getByText(/Não gravou em 1 B\/L: BL-700: Entrega alterada/)).toBeTruthy()
  // O que falhou continua selecionado para tentar de novo.
  expect((screen.getByLabelText('Selecionar B/L BL-700') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText('Selecionar B/L BL-557') as HTMLInputElement).checked).toBe(false)
})
it('B/L desbloqueado na ZPT sem exportação pelo Vela continua com o prazo aberto', () => {
  // O cumprimento do prazo é medido pela exportação (docs/modules/desbloqueio-ce.md, "Prazo"); a conciliação não o encerra.
  state.extra = [{ bl_id: 'BL-800', sla_started_at: '2026-10-07T09:00:00-03:00', zpt_status: 'unlocked', zpt_updated_at: '2026-10-07T10:00:00-03:00', zpt_without_export: true }]
  mount()
  const line = screen.getByRole('link', { name: 'BL-800' }).closest('tr') as HTMLElement
  expect(line.querySelector('[data-sla="overdue"]')?.textContent).toBe('Venceu 07/10, 17:00')
})
