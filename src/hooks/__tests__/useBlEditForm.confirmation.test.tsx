// @vitest-environment jsdom
import { act, fireEvent, renderHook, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { BLDetail } from '../../types/database'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), showToast: vi.fn() }))

vi.mock('../../services/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))

import { ConfirmDialogProvider } from '../../components/ui/ConfirmDialog'
import { useBlEditForm } from '../useBlEditForm'

const bl = {
  id: 'bl-1',
  bl_number: 'BL-001',
  updated_at: '2026-09-28T12:00:00.000Z',
  shipper: 'Armador antigo',
  consignee: 'Consignatário',
  notify_party: null,
  place_of_receipt: null,
  movement_from: null,
  movement_to: null,
  issue_place: null,
  ncm_codes: null,
  place_of_delivery: null,
  bl_emission_date: null,
  ce_mercante: null,
  bb_machine_qty: null,
  bb_packages_qty: null,
  bb_packages_total: null,
  bb_weight_ton: null,
  pol: null,
  pod: null,
  cargo_description: null,
  total_weight_kg: null,
  total_cbm: null,
  bb_cbm: null,
  payment_type: null,
  free_time_override: null,
  notes: null,
} as unknown as BLDetail

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
      </QueryClientProvider>
    )
  }
}

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ error: null })
  mocks.showToast.mockReset()
})

it('shows the before-and-after values and does not save when the user goes back', async () => {
  const { result } = renderHook(() => useBlEditForm(bl), { wrapper: makeWrapper() })
  act(() => {
    result.current.setField('shipper', 'Armador novo')
    result.current.setJustification('Correção do documento')
  })

  let submitted: Promise<void> | undefined
  act(() => {
    submitted = result.current.handleSubmit({ preventDefault: vi.fn() } as never)
  })

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('table', { name: 'Campos alterados' })).toBeTruthy()
  expect(within(dialog).getByText('Armador antigo')).toBeTruthy()
  expect(within(dialog).getByText('Armador novo')).toBeTruthy()
  expect(mocks.rpc).not.toHaveBeenCalled()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }))
  await act(async () => submitted)
  expect(mocks.rpc).not.toHaveBeenCalled()
})

it('saves only after the user confirms the displayed changes', async () => {
  const { result } = renderHook(() => useBlEditForm(bl), { wrapper: makeWrapper() })
  act(() => {
    result.current.setField('shipper', 'Armador novo')
    result.current.setJustification('Correção do documento')
  })

  let submitted: Promise<void> | undefined
  act(() => {
    submitted = result.current.handleSubmit({ preventDefault: vi.fn() } as never)
  })

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('Shipper')).toBeTruthy()
  expect(within(dialog).getByText('Armador antigo')).toBeTruthy()
  expect(within(dialog).getByText('Armador novo')).toBeTruthy()
  expect(mocks.rpc).not.toHaveBeenCalled()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }))
  await act(async () => submitted)
  expect(mocks.rpc).toHaveBeenCalledWith('save_bl_review', expect.objectContaining({
    p_bl_id: 'bl-1',
    p_update_payload: { shipper: 'Armador novo' },
  }))
})
