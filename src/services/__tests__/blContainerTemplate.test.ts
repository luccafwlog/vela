// A5 (lote 6a, ADR 0091 item 7): o modelo do B/L de container é um B/L no
// layout posicional COSCO e tem de passar pelo parser e pela prévia reais sem
// erro nem aviso.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

const { parseBLBuffer } = await import('../blParser')
const { buildBlFreightPreview } = await import('../blFreightImport')

function readTemplate(relativePath: string): ArrayBuffer {
  const raw = readFileSync(relativePath)
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
}

describe('modelo de B/L de container', () => {
  it('xlsx: lido pelo parser COSCO e importável na prévia, sem erro nem aviso', async () => {
    const parsed = await parseBLBuffer(readTemplate('public/templates/bl-container-modelo.xlsx'))

    expect(parsed.blNumber).toBe('COSU0000000001')
    expect(parsed.route).toMatchObject({ pol: 'CNSHA', pod: 'BRSSZ', vessel: 'GREEN SANTOS', voyage: '14' })
    expect(parsed.parties.consigneeTaxId).toBe('12345678000195')
    expect(parsed.dates).toEqual({ ladenOnBoard: '19 02 2026', issueDate: '20 02 2026', issuePlace: 'SHANGHAI' })
    expect(parsed.containers).toEqual([expect.objectContaining({ containerNumber: 'TCLU1234567', type: '40HC', grossWeightKg: 7600, cbm: 68.5 })])
    expect(parsed.vinSheet).toBe(true)
    expect(parsed.vehicles.map((vehicle) => vehicle.chassis)).toEqual(['LGXCE4CB0P0000001', 'LGXCE4CB0P0000002'])
    expect(parsed.freightCharges.map((charge) => charge.description)).toEqual(['OCEAN FREIGHT', 'THD', 'BAF'])

    const preview = buildBlFreightPreview({
      documents: [parsed],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      knownPorts: [{ name: 'SANTOS', locode: 'BRSSZ' }, { name: 'SHANGHAI', locode: 'CNSHA' }],
    })
    const [row] = preview.rows
    expect(row?.status).toBe('new')
    expect(row?.blockedReasons).toEqual([])
    expect(row?.warnings ?? []).toEqual([])
    expect(row?.ladenOnBoard).toBe('2026-02-19')
    expect(row?.payload?.containers).toHaveLength(1)
    expect(row?.payload?.vehicles).toHaveLength(2)
  })
})
