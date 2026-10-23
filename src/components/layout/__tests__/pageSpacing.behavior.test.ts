// @vitest-environment jsdom

// Regressão do espaço mínimo entre as peças da página (docs/identidade-visual.md,
// "Espaço entre as peças da página"): aplica a regra real de src/index.css a um
// DOM com a estrutura das telas e confere quem recebe a margem. O jsdom não
// desenha nem funde margens; o vão de 16px nas telas foi medido no navegador.
import fs from 'node:fs'
import { afterEach, beforeAll, expect, it } from 'vitest'

const css = fs.readFileSync('src/index.css', 'utf8')
let rule = ''
beforeAll(() => {
  const match = css.match(/(\.app-main > \* \+ :not\(p\),[^{]*)\{([^}]*)\}/)
  if (!match) throw new Error('regra de espaço entre as peças da página não encontrada')
  rule = `${match[1]}{${match[2]}}`
})

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

function mount(html: string) {
  document.head.innerHTML = `<style>${rule}</style>`
  document.body.innerHTML = html
}
const marginTop = (id: string) => getComputedStyle(document.getElementById(id)!).marginTop

it('fica em camada de componentes e só na tela: utilitária da tela vence e a impressão não muda', () => {
  expect(css).toMatch(/@layer components\s*\{\s*@media screen\s*\{\s*\.app-main > \* \+ :not\(p\),/)
})

it('lista de BLs: filtros abertos, "Mais filtros" e a tabela não encostam um no outro', () => {
  mount(`
    <main class="app-main">
      <div class="page-header" id="header">BLs</div>
      <div class="app-metric-row" id="metrics">Totais</div>
      <div class="app-filter-grid" id="filters">Busca, Viagem, POL, POD</div>
      <p id="caption">2 filtros ativos</p>
      <div class="app-filter-bar" id="more">Mais filtros</div>
      <section class="app-block" id="table">Tabela</section>
    </main>`)

  expect(marginTop('header')).not.toBe('16px')
  for (const id of ['metrics', 'filters', 'more', 'table']) expect(marginTop(id), id).toBe('16px')
  // A legenda dos filtros continua junto deles.
  expect(marginTop('caption')).not.toBe('16px')
})

it('Baplie: blocos empilhados direto na página ganham o vão; o conteúdo do bloco não', () => {
  mount(`
    <main class="app-main">
      <section class="app-block" id="carga"><div class="app-block__body"><p>15 containers</p><div id="facts">Cheios</div></div></section>
      <section class="app-block" id="conciliacao">Conciliação Baplie × B/L</section>
      <section class="app-block" id="vazios">Vazios de importação</section>
    </main>`)

  expect(marginTop('carga')).not.toBe('16px')
  expect(marginTop('conciliacao')).toBe('16px')
  expect(marginTop('vazios')).toBe('16px')
  expect(marginTop('facts')).not.toBe('16px')
})

it('painel de aba sem classe recebe o vão; painel em grade com gap próprio não soma margem', () => {
  mount(`
    <main class="app-main">
      <div role="tablist" id="tabs">Abas</div>
      <div role="tabpanel" id="report">
        <div class="app-filter-grid" id="scope">Período</div>
        <div class="app-filter-bar" id="report-more">Mais filtros</div>
      </div>
      <div role="tabpanel" class="app-bl-panel" id="bl-panel">
        <section class="app-block" id="bl-a">Carga</section>
        <section class="app-block" id="bl-b">Taxas</section>
      </div>
    </main>`)

  expect(marginTop('scope')).not.toBe('16px')
  expect(marginTop('report-more')).toBe('16px')
  expect(marginTop('bl-b')).not.toBe('16px')
})
