import { describe, expect, it } from 'vitest'
import { describeOpenPageRange, describePageRange } from '../pagination'

describe('describePageRange', () => {
  it('descreve o intervalo da página com separador de milhar', () => {
    expect(describePageRange({ page: 3, pageSize: 50, totalCount: 1234 })).toBe('Exibindo 101–150 de 1.234')
  })

  it('corta o fim do intervalo na última página e aceita base zero', () => {
    expect(describePageRange({ page: 1, pageBase: 0, pageSize: 20, totalCount: 35 })).toBe('Exibindo 21–35 de 35')
  })

  it('usa "Nenhum registro" para lista vazia', () => {
    expect(describePageRange({ page: 0, pageSize: 20, totalCount: 0 })).toBe('Nenhum registro')
  })
})

describe('describeOpenPageRange', () => {
  it('diz "de mais de" quando a busca parou de contar no teto, com o fim pelas linhas da página', () => {
    expect(describeOpenPageRange({ page: 0, pageBase: 0, pageSize: 50, rowsOnPage: 50, floor: 10_000 })).toBe('Exibindo 1–50 de mais de 10.000')
    expect(describeOpenPageRange({ page: 210, pageBase: 0, pageSize: 50, rowsOnPage: 12, floor: 10_000 })).toBe('Exibindo 10.501–10.512 de mais de 10.000')
  })

  it('usa "Nenhum registro" quando a página veio vazia', () => {
    expect(describeOpenPageRange({ page: 3, pageSize: 50, rowsOnPage: 0, floor: 10_000 })).toBe('Nenhum registro')
  })
})
