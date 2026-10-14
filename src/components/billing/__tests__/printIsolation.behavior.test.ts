// @vitest-environment jsdom

// Regressão de comportamento das regras @media print de src/index.css: aplica o
// bloco real (sem o @page) a um DOM com a estrutura das telas e confere o que
// fica visível. O jsdom não imprime, mas avalia a cascata e o :has() das
// regras; o PDF do navegador foi conferido à parte (plano da revisão visual,
// etapa 13).
import fs from 'node:fs'
import { afterEach, beforeAll, expect, it } from 'vitest'

function block(css: string, start: number) {
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}' && --depth === 0) return { inner: css.slice(open + 1, index), end: index + 1 }
  }
  throw new Error('bloco sem fechamento')
}

let printRules = ''
beforeAll(() => {
  const css = fs.readFileSync('src/index.css', 'utf8')
  const media = block(css, css.indexOf('@media print {')).inner
  const page = media.indexOf('@page')
  const pageBlock = block(media, page)
  printRules = media.slice(0, page) + media.slice(pageBlock.end)
})

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

function mount(html: string) {
  document.head.innerHTML = `<style>${printRules}</style>`
  document.body.innerHTML = html
}
const shown = (id: string) => getComputedStyle(document.getElementById(id)!).display !== 'none'

it('ADR aberto na aba da Viagem: só o documento do modal vai para o papel', () => {
  mount(`
    <div id="root">
      <div class="app-shell" id="shell">
        <header class="app-header" id="header">Vela</header>
        <main class="app-main" id="main">
          <div id="page">
            <section id="ficha">Ficha da Viagem</section>
            <div id="tab">
              <article class="agency-report-print-content" id="preview">ADR na aba</article>
              <div class="app-modal-backdrop" id="backdrop">
                <div class="app-modal" id="modal">
                  <div class="app-modal__header" id="modal-header">Relatório de Saída do Navio (ADR)</div>
                  <div class="app-modal__body" id="modal-body">
                    <div id="toolbar"><button>Imprimir</button></div>
                    <article class="agency-report-print-content" id="doc"><p id="doc-text">Agency Departure Report</p></article>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>`)

  for (const id of ['header', 'ficha', 'preview', 'modal-header', 'toolbar']) expect(shown(id), id).toBe(false)
  for (const id of ['shell', 'main', 'page', 'tab', 'backdrop', 'modal', 'modal-body', 'doc', 'doc-text']) expect(shown(id), id).toBe(true)
})

it('Portal em Modo Inspeção: a faixa da inspeção, fora do shell, não vai para o papel', () => {
  mount(`
    <div id="root">
      <div id="banner">Modo Inspeção · Cliente</div>
      <div class="app-shell app-shell--portal" id="shell">
        <header class="app-header" id="header">FWLOG</header>
        <main class="app-main" id="main">
          <div id="page">
            <section id="list">Faturas</section>
            <div class="app-modal-backdrop" id="backdrop">
              <div class="app-modal"><div class="app-modal__body">
                <div class="invoice-print-content" id="doc"><p id="doc-text">FATURA DE TAXAS LOCAIS</p></div>
              </div></div>
            </div>
          </div>
        </main>
      </div>
    </div>`)

  for (const id of ['banner', 'header', 'list']) expect(shown(id), id).toBe(false)
  for (const id of ['shell', 'main', 'page', 'backdrop', 'doc', 'doc-text']) expect(shown(id), id).toBe(true)
})

it('modal sem documento imprimível não esconde a página (as regras só valem com documento aberto)', () => {
  mount(`
    <div id="root">
      <div id="banner">Modo Inspeção</div>
      <div class="app-shell" id="shell">
        <main class="app-main" id="main">
          <div id="page">
            <section id="list">Faturas</section>
            <div class="app-modal-backdrop" id="backdrop">
              <div class="app-modal"><div class="app-modal__body"><form id="form">Reabrir ADR</form></div></div>
            </div>
          </div>
        </main>
      </div>
    </div>`)

  for (const id of ['banner', 'list']) expect(shown(id), id).toBe(true)
})
