import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

import { parseCustomerBaseFile } from '../customerBase'
import { parseVaziosManifestBuffer } from '../vaziosImport'

function template(name: string) {
  const bytes = readFileSync(resolve(process.cwd(), 'public/templates', name))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

// Revisão da PR 929: o modelo baixado da tela precisa importar sem erro. Os
// CNPJs de exemplo são sintéticos, com dígitos verificadores válidos.
describe('modelos publicados em public/templates', () => {
  for (const name of ['base-clientes-modelo.csv', 'base-clientes-modelo.xlsx']) {
    it(`${name}: importa todas as linhas, sem "Linha sem CNPJ válido"`, async () => {
      const parsed = await parseCustomerBaseFile(new File([template(name)], name))
      expect(parsed.rowErrors).toEqual([])
      expect(new Set(parsed.rows.map((row) => row.cnpj_cpf))).toEqual(new Set(['12345678000195', '11222333000181', '99888777000100']))
    })
  }

  // vazios-modelo.xlsx não tem link em tela (o Embarque de Vazios publica
  // unidades-embarcadas-modelo.xlsx); quem o tiver baixado recebe o mesmo
  // cabeçalho que o parser do Embarque exige.
  it('vazios-modelo.xlsx: lido pelo parser do Embarque de Vazios', async () => {
    const parsed = await parseVaziosManifestBuffer(template('vazios-modelo.xlsx'))
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bookings[0]).toMatchObject({ container_number: 'ABCD1234567', local_code: 'VBR', condition: 'vazio' })
  })
})
