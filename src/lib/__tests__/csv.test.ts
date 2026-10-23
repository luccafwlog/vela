// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadCsv, formatCsv } from '../csv'

// Captura o conteudo do CSV gerado interceptando o Blob entregue a
// URL.createObjectURL, sem disparar download real no jsdom.
async function captureCsv(run: () => void): Promise<string> {
  let captured: Blob | null = null
  const createObjectURL = vi.fn((blob: Blob) => {
    captured = blob
    return 'blob:mock'
  })
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() })
  // a.click() nao deve navegar no jsdom.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  run()
  if (!captured) throw new Error('nenhum blob capturado')
  return await (captured as Blob).text()
}

describe('downloadCsv', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('neutraliza injecao de formula prefixando com aspa simples', async () => {
    const text = await captureCsv(() =>
      downloadCsv('x.csv', ['nome'], [['=SUM(A1:A9)'], ['+1'], ['-2'], ['@cmd'], ['ok']]),
    )
    const lines = text.replace('﻿', '').split('\n')
    expect(lines[1]).toBe(`'=SUM(A1:A9)`)
    expect(lines[2]).toBe(`'+1`)
    expect(lines[3]).toBe(`'-2`)
    expect(lines[4]).toBe(`'@cmd`)
    expect(lines[5]).toBe('ok') // valor benigno permanece intacto
  })
})

describe('formatCsv', () => {
  it('põe entre aspas o campo com ; ou tab, para o Excel pt-BR não abrir outra célula', () => {
    const csv = formatCsv(['nome'], [['ACME;=HYPERLINK("http://x")'], ['a\tb'], ['ok']])
    const lines = csv.replace('﻿', '').split('\n')
    expect(lines[1]).toBe('"ACME;=HYPERLINK(""http://x"")"')
    expect(lines[2]).toBe('"a\tb"')
    expect(lines[3]).toBe('ok')
  })

  it('cabeçalho passa pelo mesmo escape dos valores, inclusive a fórmula', () => {
    const csv = formatCsv(['=cmd|/c calc', 'Peso, kg', 'Obs;x', 'BL'], [])
    expect(csv).toBe('﻿\'=cmd|/c calc,"Peso, kg","Obs;x",BL')
  })
})
