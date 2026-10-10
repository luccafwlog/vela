import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setImportBatchCeMaster } from '../manifestImport'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

beforeEach(() => {
  rpcMock.mockReset()
})

describe('setImportBatchCeMaster', () => {
  it('persiste valor e auditoria em uma unica RPC', async () => {
    rpcMock.mockResolvedValue({ error: null })

    await setImportBatchCeMaster(42, '  CE-123  ', 'user-7')

    // Mesma forma canônica do cadastro de Manifestos (migration 180).
    expect(rpcMock).toHaveBeenCalledWith('set_import_batch_ce_master', {
      p_batch_id: 42,
      p_ce_master: 'CE123',
      p_changed_by: 'user-7',
    })
  })

  it('propaga erro da RPC', async () => {
    rpcMock.mockResolvedValue({ error: new Error('audit failed') })

    await expect(setImportBatchCeMaster(42, null, 'user-7')).rejects.toThrow('audit failed')
  })
})

it('define uma RPC transacional e protegida para CE Master', () => {
  const sql = fs.readFileSync(
    path.resolve('supabase/migrations/145_set_import_batch_ce_master_atomic.sql'),
    'utf8',
  )

  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_import_batch_ce_master/i)
  expect(sql).toMatch(/UPDATE public\.import_batches/i)
  expect(sql).toMatch(/INSERT INTO public\.audit_logs/i)
  expect(sql).toMatch(/FOR UPDATE/i)
  expect(sql).toMatch(/SECURITY DEFINER/i)
  expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon/i)
  expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO authenticated/i)
})
