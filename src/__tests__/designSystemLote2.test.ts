import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

/**
 * `display` que vence para um seletor simples numa largura de tela: a última
 * declaração, em ordem do arquivo, entre as regras com exatamente esse seletor
 * cujas `@media` de largura valem para a largura.
 * ponytail: cascata só por ordem (mesma especificidade), entende min-width e
 * max-width em px e ignora regras dentro de outras at-rules; para mais que
 * isso, medir no navegador.
 */
function displayAt(selector: string, width: number): string | undefined {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const stack: Array<boolean> = []
  let start = 0
  let display: string | undefined
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (char === ';') start = i + 1
    else if (char === '}') {
      stack.pop()
      start = i + 1
    } else if (char === '{') {
      const prelude = source.slice(start, i).trim()
      if (prelude.startsWith('@')) {
        stack.push(prelude.startsWith('@media') && mediaMatches(prelude, width))
        start = i + 1
        continue
      }
      const end = source.indexOf('}', i)
      const applies = stack.every(Boolean)
      if (applies && prelude.split(',').map((part) => part.trim()).includes(selector)) {
        const match = /display\s*:\s*([a-z-]+)/.exec(source.slice(i + 1, end))
        if (match) display = match[1]
      }
      i = end
      start = end + 1
    }
  }
  return display
}

function mediaMatches(prelude: string, width: number) {
  const min = /min-width:\s*([\d.]+)px/.exec(prelude)
  const max = /max-width:\s*([\d.]+)px/.exec(prelude)
  if (!min && !max) return false
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
}

describe('contratos CSS do design system', () => {
  it('não tem tema escuro (retirado em 2026-10-15)', () => {
    expect(css).not.toContain("data-visual-theme='dark'")
    expect(css).not.toContain('@custom-variant dark')
  })

  it('não usa a variante dark: do Tailwind, que sem o tema escuro seguiria o sistema operacional', () => {
    const srcDir = new URL('../', import.meta.url)
    const offenders = (readdirSync(srcDir, { recursive: true }) as string[])
      .filter((file) => /\.(tsx?|css)$/.test(file) && !file.includes('__tests__'))
      .filter((file) => /(^|[\s"'`{])dark:[a-z[]/.test(readFileSync(new URL(file, srcDir), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('programação de navios do Portal: cartões no celular, tabela no computador', () => {
    expect(displayAt('.app-schedule__cards', 360)).toBe('grid')
    expect(displayAt('.app-schedule__table', 360)).toBe('none')
    expect(displayAt('.app-schedule__cards', 1440)).toBe('none')
    expect(displayAt('.app-schedule__table', 1440)).toBe('block')
  })

  it('documenta que os tons Tailwind legados têm remapeamento transversal nos temas claros', () => {
    expect(css).toContain('/* Legacy Tailwind status colors are remapped globally for Vela and Portal. */')
    expect(css).toContain(":root[data-visual-theme='light'] .text-amber-400")
    expect(css).toContain(":root[data-visual-theme='current'] .text-yellow-400")
  })
})
