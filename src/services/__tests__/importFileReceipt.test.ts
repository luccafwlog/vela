import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: mockRpc } }))

import { describePreviousImport, findPreviousImport, importFilesName, importFilesSha256 } from '../importFileReceipt'

const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

beforeEach(() => mockRpc.mockReset())

describe('hash do arquivo importado (ADR 0095, decisão 3)', () => {
  it('calcula o SHA-256 do conteúdo em 64 hexadecimais minúsculos', async () => {
    await expect(importFilesSha256([new Blob(['abc'])])).resolves.toBe(ABC_SHA256)
    await expect(importFilesSha256([])).resolves.toBeNull()
  })

  it('vários arquivos: o mesmo conjunto em outra ordem é o mesmo envio; outro conjunto não', async () => {
    const a = new Blob(['bl-1'])
    const b = new Blob(['bl-2'])
    const both = await importFilesSha256([a, b])
    expect(both).toMatch(/^[0-9a-f]{64}$/)
    expect(await importFilesSha256([b, a])).toBe(both)
    expect(await importFilesSha256([a])).not.toBe(both)
  })

  it('nome do lote com vários arquivos', () => {
    expect(importFilesName([{ name: 'a.pdf' }])).toBe('a.pdf')
    expect(importFilesName([{ name: 'a.pdf' }, { name: 'b.pdf' }, { name: 'c.pdf' }])).toBe('a.pdf e mais 2')
    expect(importFilesName([])).toBeNull()
  })

  it('consulta a gravação anterior do mesmo arquivo e monta o aviso', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ uploaded_at: '2026-10-21T14:05:00Z', uploaded_by_name: 'Ana Souza', filename: 'm.xlsx' }], error: null })
    const previous = await findPreviousImport('manifesto_bb', 7, ABC_SHA256)
    expect(mockRpc).toHaveBeenCalledWith('import_file_previous_upload', { p_kind: 'manifesto_bb', p_voyage_id: 7, p_file_hash: ABC_SHA256 })
    expect(previous).toEqual({ uploadedAt: '2026-10-21T14:05:00Z', uploadedByName: 'Ana Souza', filename: 'm.xlsx' })
    expect(describePreviousImport(previous!)).toMatch(/^Este arquivo já foi importado em 21\/10\/2026 às \d{2}:\d{2} por Ana Souza\.$/)

    mockRpc.mockResolvedValueOnce({ data: [], error: null })
    await expect(findPreviousImport('granito', 7, ABC_SHA256)).resolves.toBeNull()
  })
})
