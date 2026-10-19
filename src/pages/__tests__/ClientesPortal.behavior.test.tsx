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
  { ...row, customer_id: 126, customer_name: 'Cliente Crítico', hasCriticalAlert: true, candidates: [{ email: 'fin@critico.example', purpose: 'financeiro', origin: 'Contato do Cliente' }] },
  { ...row, customer_id: 124, customer_name: 'Cliente Convite', account_situation: 'convite_pendente', provisioning_decision: 'convite_pendente' },
  { ...row, customer_id: 125, customer_name: 'Cliente Aguardando', account_situation: 'convite_pendente', provisioning_decision: 'aguardando_analise' },
] as const

vi.mock('../../components/customers/ClientesTabs', () => ({ ClientesTabs: () => null }))
vi.mock('../../hooks/usePortalProvisioning', () => ({
  usePortalProvisioning: () => ({ data: rows, isLoading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, can: () => true }) }))
vi.mock('../../services/supabase', () => ({ supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn() } }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { ClientesPortal } from '../ClientesPortal'

describe('ClientesPortal', () => {
  it('abre filtrado por aguardando análise, em cartões que filtram, e mostra a fila', () => {
    render(<MemoryRouter><ClientesPortal /></MemoryRouter>)
    const waiting = screen.getByRole('button', { name: /^Aguardando análise\s*3/ })
    expect(waiting.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Cliente Portal')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Informações do Portal' }).getAttribute('href')).toBe('/clientes/informacoes')
    // Sem coluna Decisão nem "Voltar para Clientes" (lote 5a).
    expect(screen.queryByRole('columnheader', { name: 'Decisão' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Voltar para Clientes/ })).toBeNull()
  })

  it('usa a mesma regra para filtrar e contar a fila de Ativação pendente', () => {
    render(<MemoryRouter><ClientesPortal /></MemoryRouter>)
    const pendingButton = screen.getByRole('button', { name: /^Ativação pendente\s*2/ })
    expect(pendingButton.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(pendingButton)

    expect(screen.getByRole('button', { name: /^Ativação pendente\s*2/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Cliente Convite')).toBeTruthy()
    expect(screen.getByText('Cliente Aguardando')).toBeTruthy()
    expect(screen.queryByText('Cliente Portal')).toBeNull()
  })

  it('o filtro Alerta mostra só quem tem alerta crítico, em vermelho', () => {
    render(<MemoryRouter><ClientesPortal /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Alerta'), { target: { value: 'critico' } })
    expect(screen.getByText('Cliente Crítico')).toBeTruthy()
    expect(screen.queryByText('Cliente Portal')).toBeNull()
    expect(screen.getByText('Crítico').classList.contains('app-status-text--danger')).toBe(true)
  })

  it('mostra só o e-mail gravado e diz o que falta na ação; Espiadinha abre a inspeção em outra aba (A4)', () => {
    render(<MemoryRouter><ClientesPortal /></MemoryRouter>)
    const critical = screen.getByText('Cliente Crítico').closest('tr') as HTMLElement
    // O contato não aparece como se fosse o e-mail de recuperação.
    expect(critical.textContent).not.toContain('fin@critico.example')
    expect(critical.querySelector('button.app-btn')?.textContent).toBe('Escolher e-mail')
    const plain = screen.getByText('Cliente Portal').closest('tr') as HTMLElement
    expect(plain.textContent).toContain('Sem e-mail')
    expect(plain.textContent).toContain('Cadastrar e-mail')
    const peek = screen.getByRole('link', { name: 'Espiadinha: ver o Portal como Cliente Portal vê' })
    expect(peek.getAttribute('href')).toBe('/clientes/portal/inspecao/123?origem=provisionamento')
    expect(peek.getAttribute('target')).toBe('_blank')
  })
})
