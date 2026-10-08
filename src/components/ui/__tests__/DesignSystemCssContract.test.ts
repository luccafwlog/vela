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
    expect(css).toMatch(/\.app-market-refresh::after\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s)
    expect(css).toMatch(/\.app-header__brand\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-header__icon-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-header__user-dropdown button\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-nav-dropdown__item\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-modal__close\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.app-toast__close\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s)
  })

  it('dá ao botão-ícone de tabela a densidade do contrato: 36px com mouse e 44px no toque', () => {
    expect(css).toMatch(/\.app-table__icon-button\s*\{[^}]*min-width:\s*var\(--app-control-h\)[^}]*min-height:\s*var\(--app-control-h\)/s)
    expect(css).toMatch(/@media \(pointer: fine\)[^{]*\{[^}]*--app-control-h:\s*36px/s)
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.app-segmented__option\s*\{\s*min-height:\s*44px/s)
    expect(css).toMatch(/button\[aria-label\]:has\(> svg:only-child\),\s*button\[title\]:has\(> svg:only-child\)\s*\{\s*min-width:\s*44px;\s*min-height:\s*44px/s)
  })

  it('deixa a herança de cor do link na camada base, abaixo dos utilitários', () => {
    expect(css).toMatch(/@layer base\s*\{\s*a\s*\{\s*color:\s*inherit/s)
    expect(css).not.toMatch(/^a\s*\{\s*color:\s*inherit/m)
  })

  it('usa a escala de sete degraus e aliases semânticos nos toasts', () => {
    expect(css).toMatch(/\.app-confirm__message\s*\{[^}]*font-size:\s*var\(--app-size-body\)/s)
    expect(css).toMatch(/\.app-empty-state__title\s*\{[^}]*font-size:\s*var\(--app-size-section\)/s)
    expect(css).toMatch(/\.app-workspace-nav__label\s*\{[^}]*font-size:\s*var\(--app-size-body\)/s)
    for (const [variant, role] of [['success', 'success'], ['error', 'danger'], ['info', 'info']]) {
      expect(css).toMatch(new RegExp(`\\.app-toast--${variant}\\s*\\{[^}]*background:\\s*var\\(--app-${role}-bg\\)[^}]*color:\\s*var\\(--app-${role}-fg\\)`, 's'))
    }
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

  it('usa cabeçalho de tabela azul-marinho com texto branco, em caixa normal', () => {
    expect(css.match(/--app-thead-bg:\s*var\(--app-navy\)/g)?.length).toBeGreaterThanOrEqual(3)
    expect(css.match(/--app-thead-text:\s*#ffffff/g)?.length).toBeGreaterThanOrEqual(3)
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

  it('shell da etapa 02: faixa de 28px, barra única e dourado só na navegação ativa', () => {
    expect(css).toMatch(/\.app-market-strip__content\s*\{[^}]*min-height:\s*28px/s)
    // O aviso operacional cede por último; o câmbio encolhe antes.
    expect(css).toMatch(/\.app-market-strip__center\s*\{[^}]*flex:\s*0 1 auto[^}]*overflow:\s*hidden/s)
    expect(css).not.toMatch(/\.app-nav-bar\s*\{/)
    expect(css).toMatch(/\.app-nav-link\.active\s*\{[^}]*box-shadow:\s*inset 0 -3px 0 var\(--app-gold\)/s)
    expect(css).toMatch(/@media \(max-width: 1100px\)[\s\S]*?\.app-nav-scroll--open\s*\{[^}]*position:\s*absolute[^}]*top:\s*100%/s)
  })

  it('shell da etapa 02: nenhum texto abaixo de 12px na faixa, na navegação e nos sinos', () => {
    const shellBlock = css.slice(css.indexOf('/* ─── Shell (etapa 02)'), css.indexOf('.app-main {'))
    const notificationBlock = css.slice(css.indexOf('.app-notifications {'), css.indexOf('.app-notifications__pager'))
    for (const block of [shellBlock, notificationBlock]) {
      expect(block.length).toBeGreaterThan(0)
      const sizes = [...block.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]))
      expect(sizes.filter((size) => size < 12)).toEqual([])
    }
  })
})
