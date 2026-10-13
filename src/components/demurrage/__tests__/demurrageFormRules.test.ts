import { describe, expect, it } from 'vitest'
import { NEW_RATE, isPlausiblePtax, parsePtaxInput, validateAgreementDraft, validateRateDraft } from '../demurrageFormRules'

describe('tarifa padrão com as regras de demurrage_rates_intrinsic_sanity_chk', () => {
  const draft = { ...NEW_RATE, container_type: '40hc', p1_usd: '1.234,56', p2_usd: '150' }

  it('lê a diária em pt-BR e grava o tipo em maiúsculas', () => {
    expect(validateRateDraft(draft).input).toMatchObject({ container_type: '40HC', p1_usd: 1234.56, p2_usd: 150 })
  })

  it('P1 começa no dia 1 ou depois e P2 depois do fim de P1', () => {
    expect(validateRateDraft({ ...draft, p1_day_from: '0' }).errors.p1_day_from).toBe('P1 começa no dia 1 ou depois.')
    expect(validateRateDraft({ ...draft, p2_day_from: '30' }).errors.p2_day_from).toContain('dia 31 ou depois')
    expect(validateRateDraft({ ...draft, p2_day_from: '31' }).errors.p2_day_from).toBeUndefined()
  })

  it('diária em formato estranho diz o formato, não "informe"', () => {
    expect(validateRateDraft({ ...draft, p1_usd: '12abc' }).errors.p1_usd).toContain('vírgula nos centavos')
    expect(validateRateDraft({ ...draft, p1_usd: '' }).errors.p1_usd).toBe('Informe a diária de P1 em USD.')
  })
})

describe('acordo do Cliente', () => {
  const base = { customerId: 9, freeDays: '28', p1: '', p2: '1.234,56', validFrom: '2026-01-01', validTo: '' }

  it('free time até 365 e diária vazia herda a tabela', () => {
    expect(validateAgreementDraft({ ...base, freeDays: '366' }).errors.freeDays).toContain('365')
    expect(validateAgreementDraft(base)).toMatchObject({ errors: {}, p1: null, p2: 1234.56 })
  })
})

describe('PTAX digitada', () => {
  it('aceita só dígitos com vírgula ou ponto', () => {
    expect(parsePtaxInput('5,4321')).toBe(5.4321)
    expect(parsePtaxInput('5.42')).toBe(5.42)
    expect(parsePtaxInput('0x10')).toBeNull()
    expect(parsePtaxInput('1e1')).toBeNull()
    expect(parsePtaxInput('-5')).toBeNull()
    expect(parsePtaxInput('0')).toBeNull()
  })

  it('fora da faixa usual pede confirmação', () => {
    expect(isPlausiblePtax(5.42)).toBe(true)
    expect(isPlausiblePtax(54.321)).toBe(false)
  })
})
