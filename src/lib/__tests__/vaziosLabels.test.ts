import { describe, expect, it } from 'vitest'
import { condicaoLabel, diasLabel, naturezaServicoLabel, tipoLocalLabel } from '../vaziosLabels'

// Lote 5b: os mesmos nomes no Embarque de vazios e no cadastro de locais
// (sai "EMPTY W/ MATERIAL", "material" e "dia(s)").
describe('nomes de tela dos vazios', () => {
  it('condição: Vazio e Com material', () => {
    expect(condicaoLabel('vazio')).toBe('Vazio')
    expect(condicaoLabel('material')).toBe('Com material')
    expect(condicaoLabel(null)).toBe('')
  })

  it('natureza do serviço: Armazenagem, Transporte e Geral', () => {
    expect(naturezaServicoLabel('armazenagem')).toBe('Armazenagem')
    expect(naturezaServicoLabel('transporte')).toBe('Transporte')
    expect(naturezaServicoLabel('geral')).toBe('Geral')
  })

  it('dias no singular e no plural, sem "dia(s)"', () => {
    expect(diasLabel(1)).toBe('1 dia')
    expect(diasLabel(39)).toBe('39 dias')
    expect(diasLabel(1200)).toBe('1.200 dias')
  })

  it('tipo do local', () => {
    expect(tipoLocalLabel('terminal_portuario')).toBe('Terminal portuário')
    expect(tipoLocalLabel('depot')).toBe('Depot')
  })
})
