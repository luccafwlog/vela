import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TaxasLocaisTabelas } from '../TaxasLocaisTabelas'

const authState = vi.hoisted(() => ({
  profile: { id: 'user-1' } as { id: string } | null,
  user: { id: 'user-1' } as { id: string } | null,
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    profile: authState.profile,
    user: authState.user,
  }),
}))

vi.mock('../../components/ui/Toast', async () => {
  const actual = await vi.importActual<typeof import('../../components/ui/Toast')>('../../components/ui/Toast')
  return {
    ...actual,
    useToast: () => ({ showToast: vi.fn() }),
  }
})

vi.mock('../../components/ui/ConfirmDialog', async () => {
  const actual = await vi.importActual<typeof import('../../components/ui/ConfirmDialog')>('../../components/ui/ConfirmDialog')
  return {
    ...actual,
    useConfirm: () => vi.fn(async () => true),
    useConfirmWithReason: () => vi.fn(async () => 'motivo'),
  }
})

vi.mock('../../hooks/useLocalCharges', () => ({
  useLocalChargeOperations: () => ({
    data: [
      {
        id: 'BL-BB-001',
        cargo_mode: 'carga_solta',
        pod: 'BRVIX',
        charge_status: 'review_required',
        customer_reconciliation_status: 'matched_document',
        billing_hold_reason: null,
        charges_calculated_at: '2026-05-28T10:00:00Z',
        created_at: '2026-05-28T09:00:00Z',
        voyage: { id: 1, voyage_number: 'V001', vessel: { name: 'NAVIO TESTE' } },
        customer: { id: 10, name: 'Cliente Teste', cnpj_cpf: '123' },
        totals: { total_brl: 0, total_usd: 0, line_count: 1, review_required_count: 1 },
        trail: {
          last_event_at: '2026-05-28T10:01:00Z',
          last_event_by: null,
          last_event_field: 'charge_status',
          last_event_message: 'Nao existe tabela ativa para POD/mode na data de referencia',
        },
      },
    ],
    isLoading: false,
    error: null,
  }),
  useLocalChargeTables: () => ({ data: [], isLoading: false, error: null }),
  useCustomerRateOverrides: () => ({ data: [], isLoading: false, error: null }),
  useOverrideChargeItems: () => ({ data: [] }),
  useOverrideCustomers: () => ({ data: [] }),
  useSaveCustomerRateOverride: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCustomerRateOverride: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveChargeTable: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetChargeTableActive: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetChargeTableItemActive: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetCustomerRateOverrideActive: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveChargeTableItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteChargeTableItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBatchCalculateLocalCharges: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('TaxasLocaisTabelas', () => {
  const render = (url = '/taxas-locais/tabelas') =>
    renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] }, React.createElement(TaxasLocaisTabelas)))

  it('identifica a superfície de cadastro no cabeçalho e nas abas', () => {
    authState.profile = { id: 'user-1' }
    authState.user = { id: 'user-1' }
    const html = render()

    expect(html).toContain('Tabelas de Taxas Locais')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('Condições de Cliente')
  })

  it('mantem somente cadastro de tabelas e condições, sem fila operacional de pendencias', () => {
    authState.profile = { id: 'user-1' }
    authState.user = { id: 'user-1' }
    const html = render()

    expect(html).toContain('Nova tabela')
    expect(html).not.toContain('Pendencias de calculo')
    expect(html).not.toContain('Recalcular pendencias')
    expect(html).not.toContain('BL-BB-001')
  })

  it('mostra as duas abas sem controles de escrita para quem não tem perfil (visualização é global)', () => {
    authState.profile = null
    authState.user = null
    const html = render()

    expect(html).toContain('Tabelas')
    expect(html).toContain('Condições de Cliente')
    expect(html).not.toContain('Nova tabela')
  })

  it('abre a aba de condições pelo link antigo ?tab=overrides, com a escrita para quem edita', () => {
    authState.profile = { id: 'user-1' }
    authState.user = { id: 'user-1' }
    const html = render('/taxas-locais/tabelas?tab=overrides&cliente=Atl%C3%A2ntico')

    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('Nova condição')
    expect(html).toContain('value="Atlântico"')
  })

  it('mostra a aba de condições sem escrita para quem não edita', () => {
    authState.profile = null
    authState.user = null
    const html = render('/taxas-locais/tabelas?tab=overrides')

    expect(html).toContain('Condições de Cliente')
    expect(html).not.toContain('Nova condição')
  })
})
