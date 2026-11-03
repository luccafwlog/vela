import { describe, expect, it } from 'vitest'
import { extractNcmCodes, formatNcm, listBlNcms } from '../ncm'

describe('extractNcmCodes', () => {
  it('extracts a full 8-digit NCM (Modelo Vitória)', () => {
    expect(extractNcmCodes('NCM : 8703.80.00')).toEqual(['87038000'])
  })

  it('extracts a 4-digit NCM NUMBER (Modelo Salvador)', () => {
    expect(extractNcmCodes('NCM NUMBER:2923')).toEqual(['2923'])
  })

  it('excludes UN dangerous-goods numbers written as "UN NCM."', () => {
    expect(extractNcmCodes('NCM : 8703.80.00\nUN NCM.:3556')).toEqual(['87038000'])
  })

  it('splits comma-separated 4-digit lists instead of joining pairs', () => {
    expect(extractNcmCodes('NCM:8715,3926,4819\nWOODEN PACKAGE:NOT APPLICABLE')).toEqual(['8715', '3926', '4819'])
  })

  it('reads long lists that continue on the next line after a separator', () => {
    const desc = 'TOOLS\nNCM:8205/8510/8504/8506/8513/9617/\n8414/8544/3926/3924/3923\n\nWOODEN PACKAGE:NOT APPLICABLE'
    expect(extractNcmCodes(desc)).toEqual(['8205', '8510', '8504', '8506', '8513', '9617', '8414', '8544', '3926', '3924', '3923'])
  })

  it('reads a list that starts on the line after the label', () => {
    expect(extractNcmCodes('NCM:\n3926,4006,4009,\n7326,7412\nWOODEN PACKAGE')).toEqual(['3926', '4006', '4009', '7326', '7412'])
  })

  it('keeps dotted codes whole and does not read the next line as NCM', () => {
    expect(extractNcmCodes('NCM:8479.60.00/4819.10.00\n1234 CARTONS')).toEqual(['84796000', '48191000'])
    expect(extractNcmCodes('NCM:8427\n21 DAYS FREE TIME')).toEqual(['8427'])
  })

  it('returns empty for blank or NCM-less text', () => {
    expect(extractNcmCodes('')).toEqual([])
    expect(extractNcmCodes('WOODEN PACKAGE: NOT APPLICABLE')).toEqual([])
  })
})

describe('formatNcm', () => {
  it('dots 8-digit codes', () => expect(formatNcm('87038000')).toBe('8703.80.00'))
  it('dots 6-digit codes', () => expect(formatNcm('870380')).toBe('8703.80'))
  it('leaves 4-digit codes as-is', () => expect(formatNcm('2923')).toBe('2923'))
  // 5 e 7 digitos existem no cadastro (a coluna aceita de 4 a 8): formatar nao pode perder digito
  it('keeps every digit of a 7-digit code', () => expect(formatNcm('8703800')).toBe('8703.80.0'))
  it('keeps every digit of a 5-digit code', () => expect(formatNcm('87038')).toBe('8703.8'))
})

describe('listBlNcms', () => {
  it('dedupes and formats NCMs from a description, UN excluded', () => {
    const desc = 'BYD DOLPHIN\nNCM : 8703.80.00\nUN NCM.: 3556\nNCM : 8703.80.00'
    expect(listBlNcms(desc)).toEqual(['8703.80.00'])
  })

  it('returns empty list for null', () => {
    expect(listBlNcms(null)).toEqual([])
  })
})

describe('extractNcmCodes: lista na linha de baixo do rótulo', () => {
  it('aceita a linha de baixo só de códigos', () => {
    expect(extractNcmCodes('NCM:\n3926,4006 PLASTIC PARTS')).toEqual(['3926', '4006'])
    expect(extractNcmCodes('NCM:\n8429\nEXCAVATOR')).toEqual(['8429'])
  })

  it('não lê quantidade da linha de baixo como NCM', () => {
    expect(extractNcmCodes('NCM:\n2100 CARTONS OF SPARE PARTS')).toEqual([])
  })
})
