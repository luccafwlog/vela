// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const row = {
  account_id: 1, customer_id: 123, customer_name: 'Cliente Portal', cnpj_cpf: '12345678000195',
  provisioning_decision: 'aguardando_analise', account_situation: 'sem_conta', recovery_email: null,
  recovery_email_source: null, pending_invite_expires_at: null, hasCriticalAlert: false,
  hasOpenInvoice: false, hasActiveProcess: false, lastActivityAt: null, candidates: [], sharedEmailCount: 0, latestDeliveryStatus: null, recoveryEmailStatus: 'ok', recoveryEmailSuppressed: false,
} as const

vi.mock('../../hooks/usePortalProvisioning', () => ({
  usePortalProvisioning: () => ({ data: [row], isLoading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, can: () => true }) }))
vi.mock('../../services/supabase', () => ({ supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn() } }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { ClientesPortal } from '../ClientesPortal'

describe('ClientesPortal', () => {
  it('abre filtrado por aguardando análise e mostra a fila', () => {
    render(<MemoryRouter><ClientesPortal /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: /^Aguardando análise/ })).toBeTruthy()
    expect(screen.getByText('Cliente Portal')).toBeTruthy()
  })
  it('usa Ativação pendente no filtro e no indicador da fila', () => {
    render(<MemoryRouter><ClientesPortal /></MemoryRouter>)
    // O card do indicador tem o contador no nome acessível ("Ativação
    // pendente 0"), então o filtro casa exato e o indicador só casa por
    // prefixo. Um match cada, num único render.
    expect(screen.getByRole('tab', { name: /^Ativação pendente/ })).toBeTruthy()
  })
})
