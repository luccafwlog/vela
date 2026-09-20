import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync('src/index.css', 'utf8')

describe('contrato visual compartilhado', () => {
  it('define tokens usados por links e estados de hover nos dois temas', () => {
    expect(css.match(/--app-link:/g)).toHaveLength(3)
    expect(css.match(/--app-surface-hover:/g)).toHaveLength(3)
  })

  it('mantem controles compartilhados com alvo minimo de 40px', () => {
    expect(css).toMatch(/\.app-skip-link\s*\{[^}]*min-height:\s*40px/s)
    expect(css).toMatch(/\.app-breadcrumb__link\s*\{[^}]*min-height:\s*40px/s)
    expect(css).toMatch(/\.app-touch-link\s*\{[^}]*min-height:\s*40px/s)
    expect(css).toMatch(/\.app-tab\s*\{[^}]*min-height:\s*40px/s)
    expect(css).toMatch(/\.app-table__icon-button\s*\{[^}]*min-width:\s*40px[^}]*min-height:\s*40px/s)
    expect(css).toMatch(/\.app-market-refresh::after\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/s)
    expect(css).toMatch(/\.app-header__brand\s*\{[^}]*min-height:\s*40px/s)
    expect(css).toMatch(/\.app-modal__close\s*\{[^}]*min-width:\s*40px[^}]*min-height:\s*40px/s)
    expect(css).toMatch(/\.app-toast__close\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/s)
  })

  it('remove movimento de interacao quando o usuario prefere menos animacao', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('alinha valores financeiros pela casa decimal com numerais tabulares', () => {
    expect(css).toMatch(/\.app-table__cell-value--financial\s*\{[^}]*text-align:\s*right[^}]*font-variant-numeric:\s*tabular-nums/s)
  })

  it('ancora notificacoes do Portal dentro do viewport mobile', () => {
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.portal-notifications__panel\s*\{[^}]*position:\s*fixed[^}]*left:\s*12px[^}]*right:\s*12px/s)
  })

  it('libera largura para a marca do Portal no cabecalho mobile', () => {
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.app-header__actions \.app-user-pill\s*\{[^}]*display:\s*none/s)
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.app-header__logout\s*\{[^}]*font-size:\s*0/s)
  })
})
