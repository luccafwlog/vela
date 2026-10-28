// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../services/charges/chargeOperationsService', async (original) => ({
  ...(await original() as object),
  addManualBlCharge: vi.fn().mockResolvedValue({ id: 1 }),
  updateManualBlCharge: vi.fn().mockResolvedValue({ id: 1 }),
}))

import { useAddManualBlCharge, useUpdateManualBlCharge } from '../useLocalCharges'

// ADR 0111 (revisão da PR luccafwlog/vela#1080): lançar e editar cobrança
// manual usam o mesmo efeito das taxas alteradas; a quantidade nova de
// cobrança manual com total alterado entra no Histórico das taxas (D7), e a
// Validação e o saldo do Cliente não esperam 30 segundos.
describe('cobrança manual atualiza as mesmas telas da taxa alterada', () => {
  function setup() {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    const invalidated = () => invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey))
    return { wrapper, invalidated }
  }

  it('editar a quantidade', async () => {
    const { wrapper, invalidated } = setup()
    const { result } = renderHook(() => useUpdateManualBlCharge(), { wrapper })
    await act(() => result.current.mutateAsync({ chargeCalculationId: 1, quantity: 3 }))
    expect(invalidated()).toEqual(expect.arrayContaining(['["bl-charge-history"]', '["bl-timeline"]', '["local-charge-operations"]', '["customer-ficha"]']))
  })

  it('lançar', async () => {
    const { wrapper, invalidated } = setup()
    const { result } = renderHook(() => useAddManualBlCharge('BL-1'), { wrapper })
    await act(() => result.current.mutateAsync({ chargeItemId: 9, quantity: 1 }))
    expect(invalidated()).toEqual(expect.arrayContaining(['["bl-charge-history"]', '["local-charge-operations"]', '["customer-ficha"]']))
  })
})
