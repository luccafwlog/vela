import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { aoaToBuffer, jsonToBuffer } from './testWorkbook'

vi.mock('../customerReconciliation', () => ({
  loadCustomerMaps: vi.fn(() => Promise.resolve({})),
  findMatchedCustomer: vi.fn(() => null),
  resolveCustomerLink: vi.fn(() => ({ customerId: null, suggestedCustomerId: null, status: 'missing_customer', notes: 'Cliente nao encontrado na base cadastral.' })),
}))
vi.mock('../supabase', () => ({ supabase: { from: vi.fn() } }))

import { parseGraniteManifestFile } from '../graniteImport'

function cosco(rows: Array<Record<string, string | number>>) {
  return new File([jsonToBuffer(rows)], 'cosco.xlsx')
}

it('US-077: parseia a planilha COSCO mapeando colunas e reconciliando CNPJ', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([
      { '#': 1, BL: 'BL-G1', 'Navio/Viagem': 'NAVIO/14', CNPJ: '11.222.333/0001-81', Shipper: 'Granito SA', 'Real Weight': 5000 },
    ]),
  )

  expect(parsed.bls).toHaveLength(1)
  expect(parsed.bls[0]).toMatchObject({
    bl_number: 'BL-G1',
    real_weight_kg: 5000,
    vessel_voyage: 'NAVIO/14',
    shipper_name: 'Granito SA',
    reconciliationStatus: 'not_found',
  })
  expect(parsed.vesselVoyage).toBe('NAVIO/14')
})

it('S03: parseia a fixture COSCO anonimizada recebida com extensao XLS sobre conteudo XLSX', async () => {
  const source = readFileSync(new URL('../../../test-fixtures/qa-cosco-booking.xlsx', import.meta.url))
  const bytes = new Uint8Array(source.length)
  bytes.set(source)
  const parsed = await parseGraniteManifestFile(new File([bytes], 'relatorio-cosco-qa.xls'))

  expect(parsed.bls).toHaveLength(19)
  expect(parsed.rowErrors).toEqual([])
  expect(parsed.bls.map((bl) => bl.bl_number)).toEqual(
    Array.from({ length: 19 }, (_, index) => `QA-BL-${String(index + 1).padStart(2, '0')}`),
  )
  expect(parsed.bls[0]).toMatchObject({
    booking_number: 'QA-BOOKING-01',
    shipper_m3: 11.5,
    shipper_weight_kg: 602,
    real_weight_kg: 702,
    cargo_readiness_date: '2026-09-01',
  })
  expect(parsed.bls.some((bl) => bl.partial_restriction)).toBe(true)
})

it('S03: converte uma data nativa do Excel para ISO sem alterar a data local', async () => {
  const file = new File([
    aoaToBuffer([
      ['BL', 'Real Weight', 'Prontidao de Carga'],
      ['QA-BL-DATE', 702, new Date(Date.UTC(2026, 8, 1))],
    ]),
  ], 'cosco-date.xlsx')

  const parsed = await parseGraniteManifestFile(file)

  expect(parsed.rowErrors).toEqual([])
  expect(parsed.bls[0]?.cargo_readiness_date).toBe('2026-09-01')
})

it('S03: rejeita o manifesto COSCO quando o marcador estrutural Real Weight está ausente', async () => {
  await expect(parseGraniteManifestFile(
    cosco([{ BL: 'BL-G11', 'Navio/Viagem': 'NAVIO/14', 'Shipper': 'Granito SA' }]),
  )).rejects.toThrow(/Real Weight/)
})

it('S03: localiza o cabeçalho COSCO após o preâmbulo e preserva a linha de origem', async () => {
  const file = new File([
    aoaToBuffer([
      ['COSCO CARGO REPORT'],
      ['Gerado em 09/09/2026'],
      ['BL', 'Navio/Viagem', 'Real Weight'],
      ['BL-G12', 'NAVIO/14', 5000],
    ]),
  ], 'cosco.xlsx')

  const parsed = await parseGraniteManifestFile(file)

  expect(parsed.rowErrors).toEqual([])
  expect(parsed.bls[0]).toMatchObject({ bl_number: 'BL-G12', rowNumber: 4, real_weight_kg: 5000 })
})

it('US-077: registra erro de linha quando o Real Weight esta ausente ou zero', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([{ '#': 1, BL: 'BL-G2', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 0 }]),
  )

  expect(parsed.bls).toHaveLength(0)
  expect(parsed.rowErrors.length).toBeGreaterThan(0)
})

it('S03: rejeita coerção silenciosa de expoente e letras em pesos', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([
      { BL: 'BL-G7', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': '1e3' },
      { BL: 'BL-G8', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': '12abc' },
    ]),
  )

  expect(parsed.bls).toHaveLength(0)
  expect(parsed.rowErrors).toHaveLength(4)
})

it('ADR 2026-07-31 (Task 6): normaliza L/PORT para LOCODE, aceitando codigo ja limpo e texto livre', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([
      { '#': 1, BL: 'BL-G3', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000, 'L/PORT': 'BRVIX' },
      { '#': 2, BL: 'BL-G4', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000, 'L/PORT': 'VITORIA' },
      { '#': 3, BL: 'BL-G5', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000, 'L/PORT': 'Vitoria, Brazil' },
    ]),
  )

  expect(parsed.bls).toHaveLength(3)
  expect(parsed.bls.map((bl) => bl.loading_port)).toEqual(['BRVIX', 'BRVIX', 'BRVIX'])
})

it('ADR 2026-07-31 (Task 6): sem L/PORT na planilha, loading_port fica null (fallback do manifesto e' +
  ' resolvido na derivacao do ADR, nao aqui)', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([{ '#': 1, BL: 'BL-G6', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000 }]),
  )

  expect(parsed.bls).toHaveLength(1)
  expect(parsed.bls[0].loading_port).toBeNull()
})

it('S03: rejeita data de prontidao com calendario impossivel, sem descartar o B/L', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([{ BL: 'BL-G9', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000, 'Prontidao de Carga': '31/02/2026' }]),
  )

  expect(parsed.bls).toHaveLength(1)
  expect(parsed.bls[0]?.cargo_readiness_date).toBeNull()
  expect(parsed.rowErrors).toEqual([
    expect.objectContaining({ row: 2, message: expect.stringContaining('Cargo Readiness') }),
  ])
})

it('S03: normaliza data valida e bloqueia porto fora do contrato', async () => {
  const parsed = await parseGraniteManifestFile(
    cosco([{ BL: 'BL-G10', 'Navio/Viagem': 'NAVIO/14', 'Real Weight': 5000, 'Prontidao de Carga': '29/02/2024', 'D/PORT': 'porto inexistente' }]),
  )

  expect(parsed.bls[0]?.cargo_readiness_date).toBe('2024-02-29')
  expect(parsed.bls[0]?.discharge_port).toBeNull()
  expect(parsed.rowErrors).toEqual([
    expect.objectContaining({ row: 2, message: expect.stringContaining('D/PORT') }),
  ])
})
