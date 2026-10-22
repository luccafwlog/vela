import { describe, expect, it } from 'vitest'
import { initialVoyageFormValues, normalizeVoyageFormValues, parseCarrierBaplieCodes, voyageFormSchema } from '../voyageForm'

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

// ADR 0095, decisão 14 (migration 410): códigos do armador no Baplie.
describe('códigos do armador no Baplie', () => {
  it('separa por vírgula, ponto e vírgula ou espaço, em maiúsculas e sem repetir', () => {
    expect(parseCarrierBaplieCodes(' cos; COSCO  cos,, ')).toEqual(['COS', 'COSCO'])
    expect(parseCarrierBaplieCodes('')).toEqual([])
  })

  it('o formulário só mexe nos códigos quando o operador os editou', () => {
    expect(normalizeVoyageFormValues({ ...initialVoyageFormValues, vesselName: 'N', voyageNumber: '1' })).not.toHaveProperty('carrierBaplieCodes')
    expect(normalizeVoyageFormValues({ ...initialVoyageFormValues, vesselName: 'N', voyageNumber: '1', carrierBaplieCodes: 'cos cosco' }).carrierBaplieCodes).toBe('COS, COSCO')
  })
})
