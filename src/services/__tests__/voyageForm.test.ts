import { describe, expect, it } from 'vitest'
import { initialVoyageFormValues, normalizeVoyageFormValues, voyageFormSchema } from '../voyageForm'

describe('normalizeVoyageFormValues', () => {
  it('normaliza os dados cadastrais da viagem', () => {
    const result = normalizeVoyageFormValues({
      ...initialVoyageFormValues,
      carrierName: '  Cosco  ', carrierScac: ' cssc ', vesselName: ' green santos ',
      vesselImo: ' 9876543 ', voyageNumber: ' 14n ', status: 'active',
    })
    expect(result).toMatchObject({ carrierName: 'Cosco', carrierScac: 'CSSC', vesselName: 'GREEN SANTOS', vesselImo: '9876543', voyageNumber: '14N' })
  })

  it('normaliza o 1º porto brasileiro indicado', () => {
    const result = normalizeVoyageFormValues({
      ...initialVoyageFormValues, vesselName: 'NAV', voyageNumber: '1',
      indicatedFirstBrazilianPort: '  brssz  ', indicatedFirstBrazilianEta: ' 2026-07-01 ',
    })
    expect(result.indicatedFirstBrazilianPort).toBe('BRSSZ')
    expect(result.indicatedFirstBrazilianEta).toBe('2026-07-01')
  })
})

describe('voyageFormSchema', () => {
  it('rejeita navio/viagem ausentes e aceita um formulário cadastral válido', () => {
    expect(voyageFormSchema.safeParse({ ...initialVoyageFormValues, vesselName: '', voyageNumber: '' }).success).toBe(false)
    expect(voyageFormSchema.safeParse({ ...initialVoyageFormValues, vesselName: 'GREEN SANTOS', voyageNumber: '14N' }).success).toBe(true)
  })

  it('mantém apenas a validação local de paridade do porto indicado', () => {
    expect(voyageFormSchema.safeParse({ ...initialVoyageFormValues, vesselName: 'NAV', voyageNumber: '1', indicatedFirstBrazilianPort: 'BRSSZ' }).success).toBe(false)
    expect(voyageFormSchema.safeParse({ ...initialVoyageFormValues, vesselName: 'NAV', voyageNumber: '1', indicatedFirstBrazilianEta: '2026-07-01' }).success).toBe(false)
  })
})
