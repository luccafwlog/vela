import { beforeEach, expect, it, vi } from 'vitest'

const { rpcMock, fromMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), fromMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock, from: fromMock } }))

import { recordAuditEntries } from '../auditEntries'
import { logOperationalEvent } from '../operationalEvents'

beforeEach(() => {
  rpcMock.mockReset()
  fromMock.mockReset()
  rpcMock.mockResolvedValue({ data: 1, error: null })
})

// F-46 (migration 403): a tela não grava direto em audit_logs; grava pela RPC,
// que toma o autor da sessão — o changed_by enviado nem sai do navegador.
it('grava pela RPC record_audit_entries, sem INSERT direto e sem o autor enviado', async () => {
  await recordAuditEntries([{ entity_type: 'voyage_pol_schedule', entity_id: '1::CNSHA', field_name: 'etd', old_value: null, new_value: '2026-11-01', changed_by: 'forjado', justification: 'x' }])
  expect(fromMock).not.toHaveBeenCalled()
  expect(rpcMock).toHaveBeenCalledWith('record_audit_entries', {
    p_entries: [{ entity_type: 'voyage_pol_schedule', entity_id: '1::CNSHA', field_name: 'etd', old_value: null, new_value: '2026-11-01', justification: 'x' }],
  })
})

it('recusa da RPC chega a quem chamou', async () => {
  rpcMock.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Registro do Histórico não aceito' } })
  await expect(recordAuditEntries([{ entity_type: 'bl', entity_id: 'B1', field_name: 'ce_mercante', old_value: null, new_value: '1' }])).rejects.toMatchObject({ code: '42501' })
})

it('evento operacional também passa pela RPC', async () => {
  await logOperationalEvent({ code: 'invoice_create_conflict', message: 'conflito', changedBy: 'user-1' })
  expect(fromMock).not.toHaveBeenCalled()
  expect(rpcMock).toHaveBeenCalledWith('record_audit_entries', { p_entries: [expect.objectContaining({ entity_type: 'system_event', field_name: 'invoice_create_conflict' })] })
})
