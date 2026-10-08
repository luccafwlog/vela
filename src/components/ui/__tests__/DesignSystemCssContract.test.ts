import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync('src/index.css', 'utf8')

describe('contrato visual compartilhado', () => {
  it('define tokens usados por links e estados de hover nos dois temas', () => {
    expect(css.match(/--app-link:/g)).toHaveLength(3)
    expect(css.match(/--app-surface-hover:/g)).toHaveLength(3)
  })

  it('mantem controles compartilhados com alvo minimo de 44px', () => {
    expect(css).toMatch(/\.app-skip-link\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-breadcrumb__link\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-touch-link\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-tab\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-table__icon-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-market-refresh::after\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s)
    expect(css).toMatch(/\.app-header__brand\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-header__icon-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-header__user-dropdown button\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-nav-dropdown__item\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-modal__close\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-toast__close\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s)
  })

  it('ancora o indicador de carregamento ao proprio botao', () => {
    expect(css).toMatch(/\.app-btn\s*\{[^}]*position:\s*relative/s)
  })

  it('usa superfícies temáticas nos campos e aliases semânticos com par escuro nas tags', () => {
    expect(css).toMatch(/\.app-input\s*\{[^}]*background:\s*var\(--app-surface-strong\)/s)
    for (const role of ['success', 'warning', 'danger', 'info', 'neutral']) {
      for (const part of ['fg', 'bg', 'border']) {
        // current, light e dark
        expect(css.match(new RegExp(`--app-${role}-${part}:`, 'g'))).toHaveLength(3)
      }
    }
    expect(css).toMatch(/\.app-badge--green\s*\{[^}]*color:\s*var\(--app-success-fg\)/s)
    expect(css).toMatch(/\.app-badge--yellow\s*\{[^}]*color:\s*var\(--app-warning-fg\)/s)
    expect(css).toMatch(/\.app-badge--blue\s*\{[^}]*color:\s*var\(--app-info-fg\)/s)
  })

  it('aplica a densidade compacta do Vela só com ponteiro fino e devolve a confortável ao Portal', () => {
    expect(css).toMatch(/@media \(pointer: fine\)\s*\{\s*\.app-shell--vela\s*\{[^}]*--app-control-h:\s*36px[^}]*--app-row-h:\s*40px/s)
    expect(css).toMatch(/\.app-shell--portal\s*\{[^}]*--app-control-h:\s*44px[^}]*--app-row-h:\s*52px/s)
    expect(css).toMatch(/\.app-btn\s*\{[^}]*min-height:\s*var\(--app-control-h\)/s)
    expect(css).toMatch(/\.app-input\s*\{[^}]*min-height:\s*var\(--app-control-h\)/s)
  })

  it('usa cabeçalho de tabela claro em caixa normal, com azul-marinho só no Line Up', () => {
    expect(css.match(/--app-thead-bg:\s*var\(--app-surface-muted\)/g)).toHaveLength(3)
    expect(css).toMatch(/\.app-shell table thead th\s*\{[^}]*color:\s*var\(--app-thead-text\)[^}]*text-transform:\s*none/s)
    expect(css).toMatch(/\.app-table--lineup\s*\{[^}]*--app-thead-bg:\s*var\(--app-navy\)/s)
  })

  it('mantém rótulos, tags e títulos das primitivas na escala tipográfica', () => {
    for (const selector of ['app-field__label', 'app-badge', 'app-metric-tile__label', 'app-tab', 'app-modal__title', 'page-header__title']) {
      const block = css.match(new RegExp(`^\\.${selector}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? ''
      expect(block, selector).not.toMatch(/text-transform:\s*uppercase/)
      expect(block, selector).toMatch(/font-size:\s*var\(--app-size-/)
    }
    expect(css).toMatch(/\.app-modal__title\s*\{[^}]*font-family:\s*var\(--app-font-body\)/s)
    expect(css).not.toMatch(/\.page-header__copy::after/)
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

  it('define a ação do estado vazio com alinhamento e espaçamento dedicados', () => {
    expect(css).toMatch(/\.app-empty-state__action\s*\{[^}]*display:\s*inline-flex/s)
  })
})
