// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  portal: { data: undefined as unknown, isLoading: false, isError: false },
  demurrage: { data: { rows: [], denied: false }, isLoading: false, isError: false },
  pendingReconciliation: { data: [] as unknown[], isLoading: false, isError: false },
  runningDemurrage: { data: [] as unknown[], isLoading: false, isError: false },
  timeline: { data: [] as unknown[], isLoading: false, isError: false },
  release: { data: null as unknown, isLoading: false, isError: false },
}))

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ effectiveRole: 'administrativo' }) }))
vi.mock('../../../hooks/usePortalProvisioning', () => ({
  usePortalProvisioningForCustomer: () => mocks.portal,
}))
vi.mock('../../../hooks/useBillingPortalRelease', () => ({
  useBillingPortalRelease: () => mocks.release,
}))
vi.mock('../../../hooks/useCustomerFicha', () => ({
  useCustomerDemurrageInvoices: () => mocks.demurrage,
  useCustomerPendingReconciliation: () => mocks.pendingReconciliation,
  useCustomerRunningDemurrage: () => mocks.runningDemurrage,
  useCustomerTimeline: () => mocks.timeline,
}))

import { VisaoGeralTab } from '../VisaoGeralTab'

const baseData = { id: 101, cnpj_cpf: '12345678000195', city: null, state: null, customer_contacts: [], bls: [], invoices: [], invoices_access_denied: false } as never

afterEach(() => {
  cleanup()
  mocks.portal = { data: undefined, isLoading: false, isError: false }
  mocks.demurrage = { data: { rows: [], denied: false }, isLoading: false, isError: false }
  mocks.pendingReconciliation = { data: [], isLoading: false, isError: false }
  mocks.runningDemurrage = { data: [], isLoading: false, isError: false }
  mocks.timeline = { data: [], isLoading: false, isError: false }
  mocks.release = { data: null, isLoading: false, isError: false }
})

function renderTab(data = baseData) {
  render(<MemoryRouter><VisaoGeralTab data={data} onNavigateTab={() => {}} /></MemoryRouter>)
}

describe('VisaoGeralTab — pendencias', () => {
  it('mostra estado de carregamento explicito, nao "nenhuma pendencia", enquanto as fontes ainda buscam', () => {
    mocks.pendingReconciliation = { data: [], isLoading: true, isError: false }
    renderTab()
    expect(screen.getByText(/Verificando: Reconciliação de cliente…/)).toBeTruthy()
    expect(screen.queryByText('Nenhuma pendência aberta.')).toBeNull()
  })

  it('mostra erro explicito, nao "nenhuma pendencia", quando uma fonte falha', () => {
    mocks.runningDemurrage = { data: [], isLoading: false, isError: true }
    renderTab()
    expect(screen.getByText(/Não foi possível verificar: Demurrage correndo/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy()
    expect(screen.queryByText('Nenhuma pendência aberta.')).toBeNull()
  })

  it('não transforma falha de Demurrage em saldo zero', () => {
    mocks.demurrage = { data: { rows: [], denied: false }, isLoading: false, isError: true }
    renderTab()
    expect(screen.getAllByText('Erro ao carregar')).toHaveLength(3)
    expect(screen.queryByText('R$ 0,00')).toBeNull()
  })

  it('trata conta suspensa como pendência de Portal após a remoção da exceção', () => {
    mocks.portal = {
      data: { account_situation: 'suspenso', provisioning_decision: 'aguardando_analise' },
      isLoading: false,
      isError: false,
    }
    renderTab()
    expect(screen.getByText(/Portal não provisionado/)).toBeTruthy()
  })

  it('mantem pendencia de Portal para situacoes realmente pendentes', () => {
    mocks.portal = {
      data: { account_situation: 'convite_pendente', provisioning_decision: 'aprovado_para_provisionar' },
      isLoading: false,
      isError: false,
    }
    renderTab()
    expect(screen.getByText(/Portal não provisionado/)).toBeTruthy()
  })

  it('não conta fatura local como vencida: taxa local não tem vencimento praticado', () => {
    renderTab(Object.assign({}, baseData, {
      invoices: [{ id: 7, status: 'overdue' }],
    }) as never)

    expect(screen.queryByText(/invoice vencida/)).toBeNull()
    expect(screen.queryByText(/invoices vencidas/)).toBeNull()
  })

  it('não apresenta um contato adicional como se fosse o principal', () => {
    renderTab(Object.assign({}, baseData, {
      customer_contacts: [{
        id: 7,
        name: 'Contato adicional',
        email: 'adicional@cliente.com',
        phone: null,
        is_primary: false,
        deactivated_at: null,
      }],
    }) as never)

    expect(screen.getByText('Sem contato principal com e-mail')).toBeTruthy()
    expect(screen.queryByText('adicional@cliente.com')).toBeNull()
  })

  it('trata um principal ativo sem e-mail como configuração pendente', () => {
    renderTab(Object.assign({}, baseData, {
      customer_contacts: [{
        id: 8,
        name: 'Principal incompleto',
        email: '   ',
        phone: '+55 13 99999-0000',
        is_primary: true,
        deactivated_at: null,
      }],
    }) as never)

    expect(screen.getByText('Sem contato principal com e-mail')).toBeTruthy()
    expect(screen.queryByText(/Principal incompleto/)).toBeNull()
  })

  it('com a Liberação vigente, o Portal deixa de ser trava e mostra até quando vale', () => {
    mocks.portal = { data: { account_situation: 'sem_conta', provisioning_decision: 'aguardando_analise' }, isLoading: false, isError: false }
    mocks.release = {
      data: { id: 1, customer_id: 101, justification: 'x', granted_by: 'u', granted_at: '2026-10-01T10:00:00Z', review_at: '2999-12-20T23:59:59-03:00', revoked_at: null, revoked_by: null, revoke_reason: null },
      isLoading: false,
      isError: false,
    }
    renderTab()
    expect(screen.getByText(/faturamento liberado sem Portal até \d{2}\/12\/2999/)).toBeTruthy()
    expect(screen.queryByText(/Portal não provisionado/)).toBeNull()
  })

  it('falha parcial: mostra o que verificou e diz o que faltou', () => {
    mocks.portal = { data: { account_situation: 'suspenso', provisioning_decision: 'aguardando_analise' }, isLoading: false, isError: false }
    mocks.demurrage = { data: { rows: [], denied: false }, isLoading: false, isError: true }
    renderTab()
    expect(screen.getByText(/Portal não provisionado/)).toBeTruthy()
    expect(screen.getByText(/Não foi possível verificar: Faturas de Demurrage/)).toBeTruthy()
  })
})
