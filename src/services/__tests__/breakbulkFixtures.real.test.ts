import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { parseBreakbulkManifestBuffer } from '../breakbulkImport'

// breakbulkImport importa customerReconciliation que importa supabase — mock necessário para
// testes de parser que não usam o banco.
vi.mock('../supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

const fixturesPath = new URL('./fixtures/', import.meta.url)

async function readFixtureBuffer(filename: string) {
  const file = await readFile(new URL(filename, fixturesPath))
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
}

describe('breakbulkImport with real fixtures', () => {
  it('valida o manifesto carrier-style de Salvador', async () => {
    const manifest = await parseBreakbulkManifestBuffer(await readFixtureBuffer('breakbulk-salvador-carrier.xlsx'))

    expect(manifest.layout).toBe('carrier')
    expect(manifest.bls).toHaveLength(18)
    expect(manifest.rowErrors).toHaveLength(0)

    const firstBl = manifest.bls.find((bl) => bl.bl_id === 'CSC45380604J00')
    expect(firstBl).toBeDefined()
    expect(firstBl?.shipper).toBe('SNF (CHINA) FLOCCULANT CO., LTD')
    expect(firstBl?.consignee).toBe('FLOPAM DO BRASIL INDUSTRIA QUIMICA LTDA')
    expect(firstBl?.cnpj_cpf).toBe('13661609000153')
    expect(firstBl?.pol).toBe('CNTAC')
    expect(firstBl?.pod).toBe('BRSSA')
    expect(firstBl?.bb_packages_qty).toBe(2)
    expect(firstBl?.bb_packages_total).toBe(2)
    expect(firstBl?.bb_weight_ton).toBeCloseTo(47.74)
    expect(firstBl?.bb_cbm).toBe(52)
    expect(firstBl?.items[0]?.item_description).toContain('FLOCRYL DADMAC 64 HST')

    const anotherBl = manifest.bls.find((bl) => bl.bl_id === 'CSC4538060FB00')
    expect(anotherBl).toBeDefined()
    expect(anotherBl?.consignee).toBe('SCAN GLOBAL LOGISTICS DO BRASIL LTDA')
    expect(anotherBl?.bb_packages_qty).toBe(5)
    expect(anotherBl?.bb_cbm).toBeCloseTo(120.58)
  })
})
