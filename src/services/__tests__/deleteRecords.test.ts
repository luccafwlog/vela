import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteRecords } from '../deleteRecords'
import { checkBlDependencies, deleteBls } from '../bls'
import { formatDeleteOutcome } from '../deleteDependencies'

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { rpc: mockRpc } }))

beforeEach(() => {
  mockRpc.mockReset()
})

describe('deleteRecords', () => {
  it('devolve os ids no tipo original e os bloqueados com o motivo do banco', async () => {
    mockRpc.mockResolvedValue({
      data: { deleted: ['1'], blocked: [{ id: '2', reasons: ['vinculado a fatura'] }] },
      error: null,
    })

    const report = await deleteRecords('container', [1, 2])

    expect(mockRpc).toHaveBeenCalledWith('delete_records', {
      p_kind: 'container', p_ids: ['1', '2'], p_dry_run: false, p_reason: null,
    })
    expect(report).toEqual({ deletableIds: [1], blockedIds: [{ id: 2, reasons: ['vinculado a fatura'] }] })
  })

  it('não chama o banco para lista vazia', async () => {
    await expect(deleteRecords('bl', [])).resolves.toEqual({ deletableIds: [], blockedIds: [] })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('propaga a recusa do banco para quem não é Administrativo', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('Somente o Administrativo pode excluir.') })
    await expect(deleteBls(['BL1'])).rejects.toThrow('Somente o Administrativo')
  })

  it('a prévia de B/L usa o modo prévia da mesma RPC', async () => {
    mockRpc.mockResolvedValue({ data: { deleted: ['BL1'], blocked: [] }, error: null })
    await checkBlDependencies(['BL1'])
    expect(mockRpc).toHaveBeenCalledWith('delete_records', expect.objectContaining({ p_kind: 'bl', p_dry_run: true }))
  })
})

describe('formatDeleteOutcome', () => {
  it('não anuncia sucesso quando o banco recusou tudo', () => {
    const outcome = formatDeleteOutcome('B/L(s)', { deletableIds: [], blockedIds: [{ id: 'BL1', reasons: ['vinculado a fatura'] }] })
    expect(outcome.tone).toBe('error')
    expect(outcome.message).toContain('Nenhum B/L(s) excluído')
    expect(outcome.message).toContain('BL1 (vinculado a fatura)')
  })

  it('conta só o que saiu e menciona os recusados', () => {
    const outcome = formatDeleteOutcome('B/L(s)', {
      deletableIds: ['BL2'], blockedIds: [{ id: 'BL1', reasons: ['vinculado a fatura'] }],
    })
    expect(outcome).toEqual({ tone: 'success', message: '1 B/L(s) excluído(s). 1 bloqueado(s): BL1 (vinculado a fatura).' })
  })
})
