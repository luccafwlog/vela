// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const row = {
  account_id: 1, customer_id: 123, customer_name: 'Cliente Portal', cnpj_cpf: '12345678000195',
  provisioning_decision: 'aguardando_analise', account_situation: 'sem_conta', recovery_email: null,
  recovery_email_source: null, pending_invite_expires_at: null, hasCriticalAlert: false,
  hasOpenInvoice: false, hasActiveProcess: false, lastActivityAt: null, candidates: [], sharedEmailCount: 0, latestDeliveryStatus: null, recoveryEmailStatus: 'ok', recoveryEmailSuppressed: false,
} as const
const rows = [
  row,
  { ...row, customer_id: 124, customer_name: 'Cliente Convite', account_situation: 'convite_pendente', provisioning_decision: 'convite_pendente' },
  { ...row, customer_id: 125, customer_name: 'Cliente Aguardando', account_situation: 'convite_pendente', provisioning_decision: 'aguardando_analise' },
] as const

vi.mock('../../hooks/usePortalProvisioning', () => ({
  usePortalProvisioning: () => ({ data: rows, isLoading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, can: () => true }) }))
vi.mock('../../services/supabase', () => ({ supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn() } }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { ClientesPortal } from '../ClientesPortal'

describe('ClientesPortal', () => {
  it('abre filtrado por aguardando análise e mostra a fila', () => {
    render(<MemoryRouter><ClientesPortal /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /^Aguardando análise\s*2$/ })).toBeTruthy()
    expect(screen.getByText('Cliente Portal')).toBeTruthy()
  })
  it('usa a mesma regra para filtrar e contar a fila de Ativação pendente', () => {
    render(<MemoryRouter><ClientesPortal /></MemoryRouter>)
    const pendingButton = screen.getByRole('button', { name: /^Ativação pendente\s*2$/ })
    expect(pendingButton.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(pendingButton)

    expect(screen.getByRole('button', { name: /^Ativação pendente\s*2$/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Cliente Convite')).toBeTruthy()
    expect(screen.getByText('Cliente Aguardando')).toBeTruthy()
    expect(screen.queryByText('Cliente Portal')).toBeNull()
  })
})
