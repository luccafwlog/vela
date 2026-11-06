import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('useOperationalCounts realtime contract', () => {
  it('does not open a channel for alerts', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/hooks/useOperationalCounts.ts'), 'utf8')
    expect(source).not.toContain('supabase.channel')
    expect(source).toContain('staleTime: 60_000')
    expect(source).toContain('countAlertQueue')
    expect(source).not.toContain(".from('alerts')")
  })
})

describe('número da Revisão por cliente (decisão do dono de 2026-11-05)', async () => {
  const { countReviewCustomers } = await import('../useOperationalCounts')
  const { syntheticCnpj } = await import('../../integration/localTestData')
  const acme = syntheticCnpj(595101)
  const beta = syntheticCnpj(595102)
  const row = (id: string, extra: Record<string, unknown>) => ({
    id, consignee: null, shipper: null, manifest_customer_cnpj_cpf: null, consignee_block: null, cargo_description: null, customer: null, ...extra,
  })

  it('conta um por cliente, como os grupos da tela, não um por B/L', () => {
    const rows = [
      // Três B/Ls do mesmo CNPJ: um vinculado, dois só com o CNPJ do manifesto.
      row('BL1', { customer: { id: 1, cnpj_cpf: acme, name: 'ACME' } }),
      row('BL2', { manifest_customer_cnpj_cpf: acme }),
      row('BL3', { consignee_block: `ACME LTDA CNPJ ${acme}` }),
      row('BL4', { manifest_customer_cnpj_cpf: beta }),
      // Sem CNPJ: agrupa pelo nome.
      row('BL5', { consignee: 'SEM DOC' }),
      row('BL6', { consignee: 'SEM DOC' }),
    ]
    expect(countReviewCustomers(rows as never)).toBe(3)
  })

  it('fila vazia é zero', () => {
    expect(countReviewCustomers([])).toBe(0)
  })
})
