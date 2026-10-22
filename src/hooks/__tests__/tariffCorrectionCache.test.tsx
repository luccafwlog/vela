// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../services/queryKeys'

vi.mock('../../services/charges/chargeTableService', () => ({
  listLocalChargeTables: vi.fn(), listChargeTablesInUse: vi.fn(), saveChargeTable: vi.fn(), saveChargeTableItem: vi.fn(),
  setChargeTableActive: vi.fn(), setChargeTableItemActive: vi.fn(), deleteChargeTableItem: vi.fn(),
}))
vi.mock('../../services/charges/chargeRateService', () => ({
  deleteCustomerRateOverride: vi.fn(), setCustomerRateOverrideActive: vi.fn(), listCustomerRateOverrides: vi.fn(),
  countActiveConditionsForItem: vi.fn(), listOverrideChargeItems: vi.fn(), listOverrideCustomers: vi.fn(),
  saveCustomerRateOverride: vi.fn(),
}))
vi.mock('../../services/charges/chargeOperationsService', () => ({}))
vi.mock('../../services/charges/chargeReconciliationService', () => ({}))

import {
  useDeleteCustomerRateOverride,
  useSaveChargeTableItem,
  useSaveCustomerRateOverride,
  useSetChargeTableItemActive,
  useSetCustomerRateOverrideActive,
} from '../useLocalCharges'

// Corrigir item ou Condição de tabela já usada reprecifica os B/Ls e reemite
// ou deixa desatualizadas as faturas no banco (migration 354; ADR 0093,
// decisão 2). As telas que mostram fatura, cálculo e saldo precisam reler.
const billingKeys = [
  queryKeys.invoices.pendingReissues(),
  ['invoices', { page: 1 }],
  queryKeys.bls.detail('BL1'),
  queryKeys.bls.localChargeLines('BL1'),
  ['customer-ficha', '12345678000190'],
  ['alerts', 'queue'],
] as const

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  for (const key of [...billingKeys, ['unrelated']]) client.setQueryData(key, 'old')
  return { client, wrapper }
}

describe('correção de tarifa relê as faturas', () => {
  it.each([
    ['salvar item', useSaveChargeTableItem, {}],
    ['ativar ou desativar item', useSetChargeTableItemActive, { id: 1, active: false }],
    ['salvar Condição', useSaveCustomerRateOverride, {}],
  ] as const)('%s invalida faturas, ficha do B/L, linhas do cálculo, saldo e Alertas', async (_name, useMutationHook, variables) => {
    const { client, wrapper } = harness()
    const { result } = renderHook(() => useMutationHook(), { wrapper })
    await act(async () => { await result.current.mutateAsync(variables as never) })
    for (const key of billingKeys) expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true)
    expect(client.getQueryState(['unrelated'])?.isInvalidated).toBe(false)
  })

  it.each([
    // ADR 0094, A3: ativar ou desativar Condição não mexe em B/L existente.
    ['ativar ou desativar Condição', useSetCustomerRateOverrideActive, { id: 1, active: false }],
    ['excluir Condição', useDeleteCustomerRateOverride, { id: 1, reason: 'teste' }],
  ] as const)('%s relê as linhas do cálculo de qualquer B/L', async (_name, useMutationHook, variables) => {
    const { client, wrapper } = harness()
    const { result } = renderHook(() => useMutationHook(), { wrapper })
    await act(async () => { await result.current.mutateAsync(variables as never) })
    expect(client.getQueryState(queryKeys.bls.localChargeLines('BL1'))?.isInvalidated).toBe(true)
  })
})
