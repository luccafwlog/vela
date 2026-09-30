// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { afterPixSimulationChanged } from '../../services/cacheEffects'
import { pixSimulationRefetchInterval, usePixSimulationRefresh } from '../usePixSimulationRefresh'

vi.mock('../../services/cacheEffects', () => ({ afterPixSimulationChanged: vi.fn().mockResolvedValue(undefined) }))

it('atualiza caches ao confirmar pagamento e encerra polling sem um ciclo de invalidação', () => {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { rerender } = renderHook(({ state }) => usePixSimulationRefresh({ pix_integration_state: state }), {
    wrapper, initialProps: { state: 'simulation:active' },
  })
  expect(afterPixSimulationChanged).not.toHaveBeenCalled()
  rerender({ state: 'simulation:paid' })
  rerender({ state: 'simulation:paid' })
  expect(afterPixSimulationChanged).toHaveBeenCalledTimes(1)
  expect(pixSimulationRefetchInterval('simulation:pending')).toBe(5000)
  expect(pixSimulationRefetchInterval('simulation:active')).toBe(30000)
  expect(pixSimulationRefetchInterval('simulation:paid')).toBe(false)
  expect(pixSimulationRefetchInterval(null)).toBe(false)
})
