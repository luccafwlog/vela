import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

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

  it('mostra os cartões da programação de navios abaixo de 640 px (a regra do celular vem depois da que esconde)', () => {
    const hide = css.indexOf('.app-schedule__cards {\n  display: none;')
    const show = css.indexOf('.app-schedule__cards { display: grid; }')
    expect(hide).toBeGreaterThan(-1)
    expect(show).toBeGreaterThan(hide)
  })

  it('documenta que os tons Tailwind legados têm remapeamento transversal nos temas claros', () => {
    expect(css).toContain('/* Legacy Tailwind status colors are remapped globally for Vela and Portal. */')
    expect(css).toContain(":root[data-visual-theme='light'] .text-amber-400")
    expect(css).toContain(":root[data-visual-theme='current'] .text-yellow-400")
  })
})
