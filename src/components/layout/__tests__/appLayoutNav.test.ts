import { describe, expect, it } from 'vitest'
import { importNavItems } from '../appLayoutNav'

describe('appLayoutNav - rota canonica BLs', () => {
  it('contém item BLs apontando para /bls na secao de importacao', () => {
    const blItem = importNavItems.find((item) => item.to === '/bls')
    expect(blItem).toBeDefined()
    expect(blItem?.label).toBe('BLs')
  })

  it('guarda: nao contem rotas obsoletas /manifestos ou /carga-solta no menu', () => {
    expect(importNavItems.some((item) => item.to === '/manifestos')).toBe(false)
    expect(importNavItems.some((item) => item.to === '/carga-solta')).toBe(false)
  })
})
