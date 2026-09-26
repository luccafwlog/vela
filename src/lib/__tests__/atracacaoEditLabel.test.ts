import { describe, expect, it } from 'vitest'
import { atracacaoEditLabel } from '../voyageFormat'

describe('atracacaoEditLabel', () => {
  it('usa o código do terminal e a ATB quando a Atracação já aconteceu', () => {
    expect(atracacaoEditLabel({ terminalCode: 'TVV', etb: '2026-08-19', atb: '2026-08-20' }, 'BRVIX'))
      .toBe('Editar atracação TVV, ATB 20/08/2026, da escala BRVIX')
  })

  it('usa a ETB enquanto não há ATB', () => {
    expect(atracacaoEditLabel({ terminalCode: 'PORTMAC', etb: '2026-08-23', atb: null }, 'BRVIX'))
      .toBe('Editar atracação PORTMAC, ETB 23/08/2026, da escala BRVIX')
  })

  it('lê o marcador TBC como terminal a definir', () => {
    expect(atracacaoEditLabel({ terminalCode: 'TBC', etb: '2026-08-23' }, 'BRVIX'))
      .toBe('Editar atracação terminal a definir, ETB 23/08/2026, da escala BRVIX')
  })

  it('diz "terminal a definir" sem código, em vez de expor o UUID do terminal', () => {
    const atracacao = { terminalId: 'd0000000-0000-4000-8000-000000000001', terminalCode: null, etb: null, atb: null }
    const label = atracacaoEditLabel(atracacao, 'BRVIX')
    expect(label).toBe('Editar atracação terminal a definir, da escala BRVIX')
    expect(label).not.toContain('d0000000')
  })
})
