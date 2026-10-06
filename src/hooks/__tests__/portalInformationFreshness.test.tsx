// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../services/queryKeys'
import { afterCargaAlterada, afterViagemAlterada, afterManifestoImportado } from '../../services/cacheEffects'

vi.mock('../usePortalScope', () => ({ usePortalScope: () => ({ mode: 'inspect', customerId: 7 }) }))
vi.mock('../usePortalAuth', () => ({ usePortalAuth: () => ({ isAuthenticated: true }) }))
vi.mock('../../services/portalScope', () => ({ isPortalReadOnly: () => true }))
vi.mock('../../services/portalOperation', () => ({ portalListOperationBls: vi.fn() }))
vi.mock('../../services/portalInformation', () => ({ internalGetPortalInformation: vi.fn(), portalGetInformation: vi.fn(), internalSavePortalInformation: vi.fn() }))
vi.mock('../../services/depots', () => ({ listDepots: vi.fn(), upsertDepot: vi.fn(), deleteDepot: vi.fn() }))
vi.mock('../../services/demurrage/demurrageRates', () => ({ listDemurrageRates: vi.fn(), upsertDemurrageRate: vi.fn(), deleteDemurrageRate: vi.fn(), toggleDemurrageRateActive: vi.fn() }))
vi.mock('../../services/demurrage/customerDemurrageAgreements', () => ({ listCustomerDemurrageAgreements: vi.fn(), saveCustomerDemurrageAgreement: vi.fn(), deleteCustomerDemurrageAgreement: vi.fn(), toggleCustomerDemurrageAgreementActive: vi.fn() }))
vi.mock('../../services/charges/chargeTableService', () => ({ listLocalChargeTables: vi.fn(), saveChargeTable: vi.fn(), saveChargeTableItem: vi.fn(), setChargeTableActive: vi.fn(), setChargeTableItemActive: vi.fn(), deleteChargeTableItem: vi.fn() }))
vi.mock('../../services/charges/chargeOperationsService', () => ({}))
vi.mock('../../services/charges/chargeRateService', () => ({}))
vi.mock('../../services/charges/chargeReconciliationService', () => ({}))

import { useDeleteDepot, useUpsertDepot } from '../useDepots'
import { useDeleteDemurrageRate, useSaveDemurrageRate, useToggleDemurrageRateActive } from '../useDemurrageRates'
import { useSaveCustomerDemurrageAgreement, useDeleteCustomerDemurrageAgreement, useToggleCustomerDemurrageAgreementActive } from '../useCustomerDemurrageAgreements'
import { useSaveChargeTable, useSaveChargeTableItem, useSetChargeTableActive, useSetChargeTableItemActive, useDeleteChargeTableItem } from '../useLocalCharges'
import { useInternalPortalInformation, usePortalInformation } from '../usePortalInformation'
import { usePortalOperationBls } from '../usePortalOperation'
import { internalGetPortalInformation, portalGetInformation } from '../../services/portalInformation'
import { portalListOperationBls } from '../../services/portalOperation'

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false, refetchOnReconnect: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}
const informationKeys = [queryKeys.portalInformation.internal(), queryKeys.portalInformation.catalog('inspect', 7)]
const operationKey = ['portal-operation-bls', 'inspect', 7]
function seed(client: QueryClient) {
  for (const key of [...informationKeys, operationKey, ['unrelated']]) client.setQueryData(key, 'old')
}
function expectInformationInvalidated(client: QueryClient) {
  for (const key of informationKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  expect(client.getQueryState(['unrelated'])?.isInvalidated).toBe(false)
}

describe('information cache dependencies', () => {
  it.each([
    ['save depot', useUpsertDepot, {}], ['delete depot', useDeleteDepot, { id: 'depot', reason: 'test' }],
    ['save demurrage rate', useSaveDemurrageRate, {}], ['delete demurrage rate', useDeleteDemurrageRate, { id: 1, reason: 'test' }], ['toggle demurrage rate', useToggleDemurrageRateActive, { id: 1, active: false }],
    ['save agreement', useSaveCustomerDemurrageAgreement, { customer_id: 7 }], ['delete agreement', useDeleteCustomerDemurrageAgreement, { id: 1, reason: 'test', customerId: 7 }], ['toggle agreement', useToggleCustomerDemurrageAgreementActive, { id: 1, active: false, customerId: 7 }],
    ['save local table', useSaveChargeTable, {}], ['toggle local table', useSetChargeTableActive, { id: 1, active: false }], ['toggle local item', useSetChargeTableItemActive, { id: 1, active: false }], ['save local item', useSaveChargeTableItem, {}], ['delete local item', useDeleteChargeTableItem, { id: 1, reason: 'test' }],
  ] as const)('%s refreshes cached internal and inspection information', async (_name, useMutationHook, variables) => {
    const { client, wrapper } = harness()
    seed(client)
    const { result } = renderHook(() => useMutationHook(), { wrapper })
    await act(async () => { await result.current.mutateAsync(variables as never) })
    expectInformationInvalidated(client)
    if (/depot|demurrage|agreement/.test(_name)) expect(client.getQueryState(operationKey)?.isInvalidated).toBe(true)
    client.clear()
  })

  it.each([
    ['cargo', (client: QueryClient) => afterCargaAlterada(client)],
    ['voyage', (client: QueryClient) => afterViagemAlterada(client, { voyageId: 1 })],
    ['manifest import', (client: QueryClient) => afterManifestoImportado(client, { voyageId: 1 })],
  ] as const)('%s updates information and operation context', async (_name, effect) => {
    const { client } = harness()
    seed(client)
    await effect(client)
    expectInformationInvalidated(client)
    expect(client.getQueryState(operationKey)?.isInvalidated).toBe(true)
    client.clear()
  })
})

afterEach(() => { focusManager.setFocused(undefined); onlineManager.setOnline(true) })
describe('current operation context freshness', () => {
  it.each([
    ['internal information', useInternalPortalInformation, internalGetPortalInformation],
    ['inspection information', usePortalInformation, portalGetInformation],
    ['operation B/Ls', usePortalOperationBls, portalListOperationBls],
  ] as const)('%s refetches on focus and reconnect despite global defaults', async (_name, useReadHook, service) => {
    let revision = 1
    vi.mocked(service).mockImplementation(async () => ({ revision }) as never)
    const { client, wrapper } = harness()
    const { result, unmount } = renderHook(() => useReadHook(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual({ revision: 1 }))
    revision = 2
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true) })
    await waitFor(() => expect(result.current.data).toEqual({ revision: 2 }))
    revision = 3
    await act(async () => { onlineManager.setOnline(false); onlineManager.setOnline(true) })
    await waitFor(() => expect(result.current.data).toEqual({ revision: 3 }))
    unmount()
    client.clear()
  })
})
