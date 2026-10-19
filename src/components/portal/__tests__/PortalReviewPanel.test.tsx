// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { QueueRow } from '../../../services/portalProvisioning'

const authState = vi.hoisted(() => ({ role: 'administrativo' as string }))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: authState.role === 'administrativo', can: () => authState.role !== 'operacoes', effectiveRole: authState.role }),
}))
vi.mock('../../../services/supabase', () => ({ supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(), useConfirmWithReason: () => vi.fn() }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { PortalReviewPanel } from '../PortalReviewPanel'

const row: QueueRow = {
  account_id: 1, customer_id: 1, customer_name: 'Cliente', cnpj_cpf: '123', provisioning_decision: 'aguardando_analise', account_situation: 'sem_conta', recovery_email: null, recovery_email_source: null, pending_invite_expires_at: null,
  hasCriticalAlert: false, hasOpenInvoice: false, hasActiveProcess: false, lastActivityAt: null,
  candidates: [{ email: 'financeiro@example.com', purpose: 'financeiro', origin: 'Contato do Cliente' }], sharedEmailCount: 0, latestDeliveryStatus: null, recoveryEmailStatus: 'ok', recoveryEmailSuppressed: false,
}

function renderPanel(override: Partial<QueueRow> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><PortalReviewPanel row={{ ...row, ...override }} variant="inline" /></MemoryRouter></QueryClientProvider>)
}

describe('PortalReviewPanel', () => {
  it('Operações lê e-mail de recuperação, origem e contatos, sem ações (ADR 0045; A18)', () => {
    authState.role = 'operacoes'
    try {
      renderPanel({ account_situation: 'ativo', recovery_email: 'financeiro@example.com', recovery_email_source: 'candidato' })
      expect(screen.getByText(/financeiro@example\.com · escolhido entre os contatos/)).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Contatos com e-mail' })).toBeTruthy()
      expect(screen.queryByRole('radio')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Trocar e-mail de recuperação' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Ações administrativas' })).toBeNull()
    } finally {
      authState.role = 'administrativo'
    }
  })

  it('sem e-mail gravado: a conta diz "—", não "Em ordem", e o convite espera a escolha (A4)', () => {
    renderPanel()
    expect(screen.queryByText('Em ordem')).toBeNull()
    const convite = screen.getByRole('button', { name: 'Enviar convite' })
    expect(convite).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('radio', { name: /financeiro@example\.com/ }))
    expect(screen.getByRole('button', { name: 'Enviar convite para financeiro@example.com' })).toHaveProperty('disabled', false)
  })

  it('mantém o convite desabilitado quando o e-mail informado à mão não tem formato válido', () => {
    renderPanel({ candidates: [] })
    expect(screen.getByText(/Nenhum contato do Cliente tem e-mail/)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Outro e-mail/ }))
    fireEvent.change(screen.getByLabelText('Outro e-mail'), { target: { value: 'qa-invalid-synthetic' } })
    expect(screen.getByRole('button', { name: 'Enviar convite' })).toHaveProperty('disabled', true)
  })

  // Achado G: o sinal precisa aparecer junto do Cliente, não só na fila de
  // alertas. A conta segue ativa e o cliente entra com a senha; o que quebrou
  // foi o endereço para onde a recuperação seria enviada.
  it('avisa quando o e-mail de recuperação da conta ativa está quebrado e oferece a liberação na janela', () => {
    renderPanel({ account_situation: 'ativo', recovery_email: 'financeiro@example.com', recoveryEmailStatus: 'bounce_permanente', recoveryEmailSuppressed: true })
    expect(screen.getByText(/está na lista de bloqueio de envio/)).toBeTruthy()
    expect(screen.getByText('Devolvido em definitivo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ações administrativas' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /Liberar endereço bloqueado/ })).toBeTruthy()
    expect(within(dialog).getByRole('radio', { name: /Suspender a conta/ })).toBeTruthy()
  })

  it('a janela mostra só as ações que valem para a conta e exige justificativa', () => {
    renderPanel({ account_situation: 'ativo', recovery_email: 'financeiro@example.com' })
    fireEvent.click(screen.getByRole('button', { name: 'Ações administrativas' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('radio', { name: /Liberar endereço bloqueado/ })).toBeNull()
    expect(within(dialog).queryByRole('radio', { name: /Revogar o convite/ })).toBeNull()

    fireEvent.click(within(dialog).getByRole('radio', { name: /Alterar o CNPJ/ }))
    expect((within(dialog).getByLabelText('Novo CNPJ') as HTMLInputElement).maxLength).toBe(18)
    expect(within(dialog).getByRole('button', { name: 'Alterar o CNPJ' })).toHaveProperty('disabled', true)
    fireEvent.change(within(dialog).getByLabelText('Justificativa'), { target: { value: 'CNPJ conferido no cartão' } })
    expect(within(dialog).getByRole('button', { name: 'Alterar o CNPJ' })).toHaveProperty('disabled', false)
  })

  it('Novo CNPJ não fica aberto na linha (só dentro da janela)', () => {
    renderPanel()
    expect(screen.queryByLabelText('Novo CNPJ')).toBeNull()
  })
})
