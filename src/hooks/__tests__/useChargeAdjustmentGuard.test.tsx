// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), preview: vi.fn(), ack: vi.fn() }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../services/charges/chargeOperationsService', () => ({
  previewBlChargeAdjustmentImpact: mocks.preview,
  ackBlChargeAdjustmentImpact: mocks.ack,
}))

import { useChargeAdjustmentGuard } from '../useChargeAdjustmentGuard'

const discarded = [{ bl_id: 'BL1', manual_exempt: false, items: [{
  charge_name: 'THC', kind: 'unit', currency: 'BRL', basis: null, value: 1, quantity: 1, total: 1,
  outcome: 'discarded', after_quantity: null, after_total: null, reason: 'pod', table_name: 'Santos', pod: null, needs_confirmation: true,
}] }]

describe('useChargeAdjustmentGuard', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.ack.mockResolvedValue(undefined) })

  it('grava direto quando nada pede confirmação', async () => {
    mocks.preview.mockResolvedValue([])
    const save = vi.fn().mockResolvedValue('ok')
    const { result } = renderHook(() => useChargeAdjustmentGuard())
    await expect(result.current([{ bl_id: 'BL1' }], save)).resolves.toBe('ok')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('recusado o Gravar mesmo assim, não grava nem registra o aceite', async () => {
    mocks.preview.mockResolvedValue(discarded)
    mocks.confirm.mockResolvedValue(false)
    const save = vi.fn()
    const { result } = renderHook(() => useChargeAdjustmentGuard())
    await expect(result.current([{ bl_id: 'BL1' }], save)).resolves.toBeUndefined()
    expect(save).not.toHaveBeenCalled()
    expect(mocks.ack).not.toHaveBeenCalled()
  })

  it('confirmado, registra o aceite do B/L antes de gravar', async () => {
    mocks.preview.mockResolvedValue(discarded)
    mocks.confirm.mockResolvedValue(true)
    const save = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useChargeAdjustmentGuard())
    await result.current([{ bl_id: 'BL1' }], save)
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({ confirmLabel: 'Gravar mesmo assim', title: 'Taxas alteradas à mão serão afetadas' })
    expect(mocks.ack).toHaveBeenCalledWith(['BL1'])
    expect(save).toHaveBeenCalled()
  })

  it('prévia que falha não trava a gravação', async () => {
    mocks.preview.mockRejectedValue(new Error('rede'))
    const save = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useChargeAdjustmentGuard())
    await result.current([{ bl_id: 'BL1' }], save)
    expect(save).toHaveBeenCalled()
  })
})
