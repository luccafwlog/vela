import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

describe('contratos CSS do design system', () => {
  it('faz dark: seguir o tema escolhido no Vela, não a preferência do sistema', () => {
    expect(css).toContain(
      "@custom-variant dark (&:where([data-visual-theme='dark'], [data-visual-theme='dark'] *));",
    )
  })

  it('a ficha da Viagem não emoldura tabelas em card dentro de card (etapa 03)', () => {
    // O quadro arredondado com sombra em volta das tabelas da Viagem saiu: a
    // seção é separada por filete e título, com o cabeçalho de tabela comum.
    expect(css).not.toContain('.app-voyage-table-frame')
    expect(css).toContain('.app-voyage-section {')
  })

  it('documenta que os tons Tailwind legados têm remapeamento transversal nos temas claros', () => {
    expect(css).toContain('/* Legacy Tailwind status colors are remapped globally for Vela and Portal. */')
    expect(css).toContain(":root[data-visual-theme='light'] .text-amber-400")
    expect(css).toContain(":root[data-visual-theme='current'] .text-yellow-400")
  })
})
