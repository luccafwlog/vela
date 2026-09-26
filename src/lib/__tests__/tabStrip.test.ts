import { describe, expect, it } from 'vitest'
import { revealInTabStrip } from '../tabStrip'

// Faixa de 300px de largura visível e 600px de conteúdo, na posição x=16.
function strip(scrollLeft = 0) {
  return {
    scrollLeft,
    scrollWidth: 600,
    clientWidth: 300,
    getBoundingClientRect: () => ({ left: 16, right: 316 }),
  }
}

// Aba na posição de conteúdo [from, to), convertida para a tela conforme a
// rolagem atual da faixa.
function tab(parent: ReturnType<typeof strip>, from: number, to: number) {
  return {
    parentElement: parent,
    getBoundingClientRect: () => ({ left: 16 + from - parent.scrollLeft, right: 16 + to - parent.scrollLeft }),
  }
}

describe('revealInTabStrip', () => {
  it('rola para a direita até a última aba ficar inteira à vista', () => {
    const s = strip()
    revealInTabStrip(tab(s, 480, 600))
    expect(s.scrollLeft).toBe(300)
  })

  it('rola para a esquerda quando a aba ativa ficou antes da área visível', () => {
    const s = strip(300)
    revealInTabStrip(tab(s, 100, 200))
    expect(s.scrollLeft).toBe(100)
  })

  it('não mexe quando a aba já está à vista', () => {
    const s = strip(50)
    revealInTabStrip(tab(s, 100, 200))
    expect(s.scrollLeft).toBe(50)
  })

  it('não mexe quando a faixa cabe inteira (desktop)', () => {
    const s = { ...strip(), scrollWidth: 300 }
    revealInTabStrip(tab(s, 480, 600))
    expect(s.scrollLeft).toBe(0)
  })
})
