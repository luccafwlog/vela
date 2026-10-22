import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc } }))

import { claimImportEffects, completeImportEffect, enqueueImportEffect, listImportEffects, retryImportEffect } from '../importEffects'
import { userFacingErrorMessage } from '../../lib/errors'

const effect = {
  id: 17,
  source_action_id: 'action-17',
  effect_kind: 'physical_flags',
  entity_id: 'BL-17',
  status: 'pending',
  attempts: 0,
  created_at: '2026-09-07T12:00:00Z',
  created_by: 'user-17',
  source_revision: 1,
  source_snapshot: { import: 'test' },
  depends_on_effect_id: null,
  next_attempt_at: '2026-09-07T12:00:00Z',
  lease_until: null,
  leased_by: null,
  last_error_code: null,
  last_error_message: null,
  result: null,
  superseded_by_effect_id: null,
  updated_at: '2026-09-07T12:00:00Z',
}

describe('importEffects service', () => {
  beforeEach(() => rpc.mockReset())

  it('enfileira com snapshot e dependencia e preserva idempotencia do RPC', async () => {
    rpc.mockResolvedValue({ data: { effect, idempotent: false }, error: null })

    const result = await enqueueImportEffect({
      sourceActionId: 'action-17',
      effectKind: 'physical_flags',
      entityId: 'BL-17',
      createdBy: 'user-17',
      sourceRevision: 2,
      dependsOnEffectId: 9,
      sourceSnapshot: { filename: 'manifest.csv' },
    })

    expect(result).toMatchObject({ effect, idempotent: false })
    expect(rpc).toHaveBeenCalledWith('enqueue_import_effect', {
      p_source_action_id: 'action-17',
      p_effect_kind: 'physical_flags',
      p_entity_id: 'BL-17',
      p_created_by: 'user-17',
      p_source_revision: 2,
      p_depends_on_effect_id: 9,
      p_source_snapshot: { filename: 'manifest.csv' },
    })
  })

  it('normaliza claim/lista e envia a conclusao com estado de retry', async () => {
    rpc
      .mockResolvedValueOnce({ data: [effect], error: null })
      .mockResolvedValueOnce({ data: [effect], error: null })
      .mockResolvedValueOnce({ data: { effect: { ...effect, status: 'retry_wait' }, idempotent: false }, error: null })

    await expect(claimImportEffects({ workerId: 'worker-1', limit: 4, leaseSeconds: 90 })).resolves.toEqual([effect])
    await expect(listImportEffects({ entityId: 'BL-17', status: 'pending', limit: 20 })).resolves.toEqual([effect])
    await expect(completeImportEffect({
      effectId: 17,
      workerId: 'worker-1',
      status: 'retry_wait',
      errorCode: 'timeout',
      errorMessage: 'timeout externo',
      retryAt: '2026-09-07T12:05:00Z',
    })).resolves.toMatchObject({ idempotent: false })

    expect(rpc).toHaveBeenNthCalledWith(1, 'claim_import_effects', {
      p_worker_id: 'worker-1',
      p_limit: 4,
      p_lease_seconds: 90,
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'list_import_effects', {
      p_entity_id: 'BL-17',
      p_status: 'pending',
      p_limit: 20,
    })
    expect(rpc).toHaveBeenNthCalledWith(3, 'complete_import_effect', expect.objectContaining({
      p_effect_id: 17,
      p_worker_id: 'worker-1',
      p_status: 'retry_wait',
      p_error_code: 'timeout',
      p_retry_at: '2026-09-07T12:05:00Z',
    }))
  })

  it('propaga falha do RPC em vez de declarar efeito aplicado', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('lease expirou') })
    await expect(completeImportEffect({ effectId: 17, workerId: 'worker-1', status: 'succeeded' })).rejects.toThrow('lease expirou')
  })

  it('recusa do Reprocessar chega à tela com a mensagem do banco, não com a genérica', async () => {
    // Formato real do supabase-js em `{ data, error }`: objeto, não `Error`.
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'Somente efeitos bloqueados podem ser reabertos.', details: null, hint: null } })
    const failure = await retryImportEffect(17, 'corrigir payload e repetir lote').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(userFacingErrorMessage(failure, 'fallback')).toBe('Somente efeitos bloqueados podem ser reabertos.')
  })

  it('reabre bloqueio somente com justificativa encaminhada ao servidor', async () => {
    rpc.mockResolvedValue({ data: { effect: { ...effect, status: 'retry_wait' }, idempotent: false }, error: null })
    await retryImportEffect(17, 'corrigir payload e repetir lote')
    expect(rpc).toHaveBeenCalledWith('retry_import_effect', {
      p_effect_id: 17,
      p_justification: 'corrigir payload e repetir lote',
    })
  })
})
