import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
// A leitura do Granito casa o CNPJ com a base de Clientes; aqui a base vem vazia.
vi.mock('../customerReconciliation', () => ({
  loadCustomerMaps: vi.fn(() => Promise.resolve({})),
  findMatchedCustomer: vi.fn(() => null),
  resolveCustomerLink: vi.fn(() => ({ customerId: null, suggestedCustomerId: null, status: 'missing_customer', notes: '' })),
  withoutDeactivatedCustomer: vi.fn((match: unknown) => match),
}))

import { parseGraniteManifestFile } from '../graniteImport'
import { parseBaplieBuffer } from '../baplieParser'

function template(name: string) {
  const bytes = readFileSync(resolve(process.cwd(), 'public/templates', name))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

// Lote 6a (A5): toda importação tem um modelo para baixar, e o modelo é
// aceito pelo próprio parser, sem erro.
describe('modelos do Granito e do Baplie em public/templates', () => {
  it('granito-modelo.xlsx: a planilha COSCO de exemplo é lida sem erro', async () => {
    const parsed = await parseGraniteManifestFile(new File([template('granito-modelo.xlsx')], 'granito-modelo.xlsx'))
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bls.map((bl) => bl.bl_number)).toEqual(['BL-GRANITO-01', 'BL-GRANITO-02'])
    expect(parsed.bls[0]).toMatchObject({
      real_weight_kg: 28350,
      blocks_qty: 3,
      loading_port: 'BRVIX',
      discharge_port: 'CNXMN',
      shipper_cnpj: '12345678000195',
      cargo_readiness_date: '2026-10-15',
    })
    expect(parsed.vesselVoyage).toBe('NAVIO EXEMPLO / 001N')
  })

  it('baplie-modelo.edi: o Baplie EDI de exemplo é lido sem erro', () => {
    const parsed = parseBaplieBuffer(template('baplie-modelo.edi'))
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(parsed.vessel_name).toBe('NAVIO EXEMPLO')
    expect(parsed.voyage_number).toBe('001N')
    expect(parsed.containers.map((container) => [container.container_number, container.status])).toEqual([
      ['TEMU1234567', 'full'],
      ['TGHU7654325', 'full'],
      ['CSNU2049996', 'empty'],
    ])
    expect(parsed.containers[1]).toMatchObject({ is_imo: true, imo_class: '9' })
  })
})
