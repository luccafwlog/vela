import { describe, expect, it } from 'vitest'
import { describePageRange } from '../pagination'

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
