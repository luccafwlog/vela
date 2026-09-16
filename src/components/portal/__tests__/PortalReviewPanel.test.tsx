// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { QueueRow } from '../../../services/portalProvisioning'

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, can: () => true }) }))
vi.mock('../../../services/supabase', () => ({ supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn() } }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { PortalReviewPanel } from '../PortalReviewPanel'

const row: QueueRow = {
  account_id: 1, customer_id: 1, customer_name: 'Cliente', cnpj_cpf: '123', provisioning_decision: 'aguardando_analise', account_situation: 'sem_conta', recovery_email: null, recovery_email_source: null, pending_invite_expires_at: null,
  hasCriticalAlert: false, hasOpenInvoice: false, hasActiveProcess: false, lastActivityAt: null,
  candidates: [{ email: 'financeiro@example.com', purpose: 'financeiro', origin: 'Contato do Cliente' }], sharedEmailCount: 0, latestDeliveryStatus: null, recoveryEmailStatus: 'ok', recoveryEmailSuppressed: false,
}

describe('PortalReviewPanel', () => {
  it('mostra candidato e mantém convite desabilitado sem email selecionado', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><MemoryRouter><PortalReviewPanel row={{ ...row, candidates: [] }} /></MemoryRouter></QueryClientProvider>)
    expect(screen.getByText('Nenhum contato com email disponível.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enviar convite' })).toHaveProperty('disabled', true)
  })

  it('mantém convite desabilitado quando o email informado não tem formato válido', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><MemoryRouter><PortalReviewPanel row={row} /></MemoryRouter></QueryClientProvider>)

    fireEvent.change(screen.getByRole('textbox', { name: 'Email de Recuperação' }), {
      target: { value: 'qa-invalid-synthetic' },
    })

    expect(screen.getByRole('button', { name: 'Enviar convite' })).toHaveProperty('disabled', true)
  })

  // Achado G: o sinal precisa aparecer junto do Cliente, não só na fila de
  // alertas. A conta segue ativa e o cliente entra com a senha; o que quebrou
  // foi o endereço para onde a recuperação seria enviada.
  it('avisa quando o Email de Recuperação da conta ativa está quebrado', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const broken: QueueRow = { ...row, account_situation: 'ativo', recovery_email: 'financeiro@example.com', recoveryEmailStatus: 'bounce_permanente', recoveryEmailSuppressed: true }
    render(<QueryClientProvider client={queryClient}><MemoryRouter><PortalReviewPanel row={broken} /></MemoryRouter></QueryClientProvider>)
    expect(screen.getByText(/está na lista de bloqueio de envio/)).toBeTruthy()
    expect(screen.getByText('Devolvido em definitivo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Liberar endereço bloqueado' })).toBeTruthy()
  })

  // Achado F: sem endereço bloqueado não há o que liberar; a ação não deve
  // ficar disponível como botão de rotina.
  it('não oferece a liberação quando o endereço não está bloqueado', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><MemoryRouter><PortalReviewPanel row={{ ...row, account_situation: 'ativo', recovery_email: 'financeiro@example.com' }} /></MemoryRouter></QueryClientProvider>)
    expect(screen.queryByRole('button', { name: 'Liberar endereço bloqueado' })).toBeNull()
    expect(screen.queryByText(/lista de bloqueio de envio/)).toBeNull()
  })
})
