// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { DesbloqueioCe } from '../DesbloqueioCe'
const state = vi.hoisted(() => ({ manage: true, canExport: false }))
vi.mock('../../hooks/useBls', () => ({ useVoyageOptions: () => ({ data: [] }) }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ can: (p: string) => p === 'ce_unlock_read' || state.manage }) }))
vi.mock('../../hooks/useCeUnlock', () => ({
  useCeUnlock: () => ({ list: { data: { total: 1, items: [{ bl_id: 'BL-557', ce_mercante: '123', customer_name: 'Cliente', cnpj_cpf: '123456', state: 'no_request', reasons: ['Taxas locais sem liquidação integral confirmada'], paid: false, can_export: state.canExport }] } }, command: { isPending: false } }),
  useCeUnlockRequest: () => ({ data: null }),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => async () => true, useConfirmWithReason: () => async () => null }))
afterEach(() => { cleanup(); state.manage = true; state.canExport = false })
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><DesbloqueioCe /></MemoryRouter></QueryClientProvider>)
}
it('mostra BL sem pedido, pendência financeira e impede seleção inelegível', () => {
  mount()
  expect(screen.getByRole('link', { name: 'BL-557' })).toBeTruthy()
  expect(screen.getByLabelText('Exportar BL BL-557').hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('Taxas locais sem liquidação integral confirmada')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Registrar entrega' })).toBeTruthy()
})
it('Financeiro/Operações consultam requisitos sem ações internas ou modelo', () => {
  state.manage = false
  mount()
  expect(screen.getByRole('link', { name: 'BL-557' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Registrar entrega' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Modelo do termo' })).toBeNull()
  expect(screen.queryByRole('button', { name: /Exportar .* para ZPT/ })).toBeNull()
})

it('permite tirar da seleção BL que perdeu aptidão, para revisar lote', async () => {
 state.canExport = true;
 const view = mount();
 await userEvent.click(screen.getByLabelText('Exportar BL BL-557'));
 state.canExport = false;
 view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><DesbloqueioCe /></MemoryRouter></QueryClientProvider>);
 expect(screen.getByLabelText('Exportar BL BL-557').hasAttribute('disabled')).toBe(false);
 await userEvent.click(screen.getByLabelText('Exportar BL BL-557'));
 expect((screen.getByLabelText('Exportar BL BL-557') as HTMLInputElement).checked).toBe(false);
});
