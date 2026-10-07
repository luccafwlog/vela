// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { DesbloqueioCe } from '../DesbloqueioCe'
import { ToastProvider } from '../../components/ui/Toast'
const state = vi.hoisted(() => ({
  manage: true, canExport: false, delivered: false, mutateAsync: vi.fn(async () => ({})), filters: [] as unknown[],
}))
vi.mock('../../hooks/useBls', () => ({ useVoyageOptions: () => ({ data: [] }) }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ can: (p: string) => p === 'ce_unlock_read' || state.manage }) }))
vi.mock('../../hooks/useCeUnlock', () => ({
  useCeUnlock: (filters: unknown) => {
    state.filters.push(filters)
    return {
      list: { data: { total: 1, items: [{
        bl_id: 'BL-557', ce_mercante: '123', customer_name: 'Cliente', cnpj_cpf: '123456', state: 'no_request',
        reasons: ['Taxas locais sem liquidação integral confirmada'], paid: false, termo: true, procuracao: false,
        delivered: state.delivered, delivery_version: 4, can_export: state.canExport, export_state: 'not_exported',
        sla_started_at: null, exported_at: null,
      }] } },
      command: { isPending: false, mutateAsync: state.mutateAsync },
    }
  },
  useCeUnlockRequest: () => ({ data: null }),
  useCeUnlockReviewQueue: () => ({
    isLoading: false, error: null, refetch: vi.fn(),
    data: { total: 1, items: [{
      id: 'req-1', protocol: 'CE-ABC', state: 'submitted', version: 1, created_at: '2026-10-07T10:00:00Z', customer_name: 'Cliente Fila',
      cnpj_cpf: '999', sla_started_at: '2026-10-07T10:00:00-03:00', bl_ids: ['BL-1', 'BL-2'], termo_status: 'uploaded', procuracao_status: 'changes_requested',
    }] },
  }),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => async () => true, useConfirmWithReason: () => async () => 'Entrega lançada por engano' }))
afterEach(() => { cleanup(); state.manage = true; state.canExport = false; state.delivered = false; state.mutateAsync.mockClear(); state.filters.length = 0 })
function mount(path = '/?aba=controle') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={[path]}><DesbloqueioCe /></MemoryRouter></ToastProvider></QueryClientProvider>)
}
it('abre na aba Solicitações: uma linha por pedido com o status de cada documento', () => {
  mount('/')
  expect(screen.getByRole('tab', { name: 'Solicitações', selected: true })).toBeTruthy()
  expect(screen.getByText('Cliente Fila')).toBeTruthy()
  expect(screen.getByText('Aguardando análise')).toBeTruthy()
  expect(screen.getByText('Recusado — aguardando cliente')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Analisar CE-ABC' })).toBeTruthy()
  expect(screen.queryByLabelText('Exportar BL BL-557')).toBeNull()
})
it('Controle ZPT mostra BL sem pedido com os quatro requisitos e impede seleção inelegível', () => {
  mount()
  expect(screen.getByRole('link', { name: 'BL-557' })).toBeTruthy()
  expect(screen.getByLabelText('Exportar BL BL-557').hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('Taxas locais sem liquidação integral confirmada')).toBeTruthy()
  expect(screen.getByRole('img', { name: 'T. de Devolução BL-557: atendido' })).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Procuração BL-557: pendente' })).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Financeiro BL-557: pendente' })).toBeTruthy()
  // Só BL de Entrega é manual; as demais caixas são resultado do sistema.
  for (const label of ['T. de Devolução', 'Procuração', 'Financeiro']) expect(screen.queryByRole('checkbox', { name: new RegExp(`^${label}`) })).toBeNull()
  expect(screen.getByLabelText('BL de Entrega: BL-557').hasAttribute('disabled')).toBe(false)
})
it('filtro padrão é "Aptos — não exportados"', () => {
  mount()
  expect(state.filters.at(-1)).toMatchObject({ situation: 'ready_not_exported' })
})
it('marcar BL de Entrega registra a entrega; desmarcar pede motivo', async () => {
  const view = mount()
  await userEvent.click(screen.getByLabelText('BL de Entrega: BL-557'))
  expect(state.mutateAsync).toHaveBeenCalledWith({ action: 'delivery', payload: expect.objectContaining({ bl_id: 'BL-557', delivered: true, expected_version: 4, reason: null }) })
  view.unmount()
  state.delivered = true
  state.mutateAsync.mockClear()
  mount()
  await userEvent.click(screen.getByLabelText('BL de Entrega: BL-557'))
  expect(state.mutateAsync).toHaveBeenCalledWith({ action: 'delivery', payload: expect.objectContaining({ delivered: false, reason: 'Entrega lançada por engano' }) })
})
it('Financeiro/Operações consultam requisitos sem ações internas ou modelo', () => {
  state.manage = false
  mount()
  expect(screen.getByRole('link', { name: 'BL-557' })).toBeTruthy()
  expect(screen.getByLabelText('BL de Entrega: BL-557').hasAttribute('disabled')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Modelo do termo de devolução' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Conciliar com a ZPT' })).toBeNull()
  expect(screen.queryByRole('button', { name: /Exportar .* para ZPT/ })).toBeNull()
})
it('não há mais botão para registrar envio nem confirmar desbloqueio', async () => {
  mount()
  await userEvent.click(screen.getByRole('button', { name: 'Histórico ZPT' }))
  expect(screen.queryByRole('button', { name: /Registrar envio/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Confirmar desbloqueio/ })).toBeNull()
})
it('permite tirar da seleção BL que perdeu aptidão, para revisar lote', async () => {
  state.canExport = true
  const view = mount()
  await userEvent.click(screen.getByLabelText('Exportar BL BL-557'))
  state.canExport = false
  view.rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><MemoryRouter initialEntries={['/?aba=controle']}><DesbloqueioCe /></MemoryRouter></ToastProvider></QueryClientProvider>)
  expect(screen.getByLabelText('Exportar BL BL-557').hasAttribute('disabled')).toBe(false)
  await userEvent.click(screen.getByLabelText('Exportar BL BL-557'))
  expect((screen.getByLabelText('Exportar BL BL-557') as HTMLInputElement).checked).toBe(false)
})
