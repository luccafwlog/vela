import { describe, expect, it } from 'vitest'
import { computeIsoContainerCheckDigit, isValidIsoContainerNumber, normalizeIsoContainerNumber } from '../containerNumber'

describe('normalizeIsoContainerNumber — formato apenas', () => {
  it('aceita o formato AAAA9999999 sem validar o dígito verificador', () => {
    // MSCU9999999 tem formato ISO valido mas o digito verificador correto
    // seria 4 (MSCU999999 -> 4), nao 9. normalizeIsoContainerNumber so olha
    // o formato — e o contrato documentado do manifesto-edi.md.
    expect(normalizeIsoContainerNumber('MSCU9999999')).toBe('MSCU9999999')
  })
})

describe('computeIsoContainerCheckDigit — Anexo A da ISO 6346', () => {
  it('calcula o dígito verificador do exemplo canônico da norma (CSQU3054383)', () => {
    expect(computeIsoContainerCheckDigit('CSQU305438')).toBe(3)
  })

  it('devolve null quando as 10 primeiras posições não têm o formato owner+serial', () => {
    expect(computeIsoContainerCheckDigit('AB1234567X')).toBeNull()
  })
})

describe('isValidIsoContainerNumber — checksum completo (P3-21, não ligado a parser algum)', () => {
  it('aceita o container do exemplo canônico da norma', () => {
    expect(isValidIsoContainerNumber('CSQU3054383')).toBe(true)
  })

  it('rejeita dígito verificador incorreto', () => {
    expect(isValidIsoContainerNumber('CSQU3054384')).toBe(false)
  })

  it('rejeita formato inválido antes mesmo de calcular o checksum', () => {
    expect(isValidIsoContainerNumber('MSC12345678')).toBe(false)
  })
})
