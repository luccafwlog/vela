// Gera o PDF de um guia rápido a partir de docs/manual/guias/<nome>.
//
// Uso: npm run manual:guia -- documentacao [--saida artifacts/manual/guia-documentacao.pdf]
// Usa as capturas do manual (npm run manual:capture) e o mesmo visual, mais
// enxuto: capa, sumário de uma página e as áreas em texto corrido, sem as
// páginas de abertura de parte e de capítulo.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, lerGuia, capituloHtml, escapar } from './fonte.mjs'
import { fontes, telas, alvo, pagina, imprimirComPaginas } from './impressao.mjs'

const nome = process.argv[2]
if (!nome || nome.startsWith('--')) {
  console.error('Uso: npm run manual:guia -- <nome do guia, como documentacao>')
  process.exit(1)
}
const arg = (chave) => {
  const i = process.argv.indexOf(chave)
  return i === -1 ? null : process.argv[i + 1]
}
const SAIDA = path.resolve(ROOT, arg('--saida') || `artifacts/manual/guia-${nome}.pdf`)

function capa(g) {
  return `<section class="pagina pagina--escura pagina-fixa" style="page: capa">
  <div class="capa">
    <div class="marca-vela">
      <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M34 8 L34 48 L56 48 Z" fill="#ffffff"/><path d="M29 21 L29 48 L11 48 Z" fill="#d4882e"/><rect x="6" y="53" width="52" height="3.4" rx="1.7" fill="#ffffff"/></svg>
      <span>Vela</span>
    </div>
    <div class="titulo">
      <div class="sobre">${escapar(g.sobre)}</div>
      <h1>${escapar(g.titulo)}</h1>
      <p>${escapar(g.subtitulo)}</p>
    </div>
    <div class="pe">
      <div class="versao">
        <span><b>Versão ${escapar(g.versao)}</b> · ${escapar(g.situacao)}</span>
        <span>Descreve o Vela em <b>${escapar(g.descreve)}</b></span>
      </div>
    </div>
  </div>
</section>`
}

function sumario(g, areas) {
  const linhas = []
  for (const area of g.areas) {
    linhas.push(`<li class="sum-cap"><a href="#area-${area.numero}"><span><b>${area.numero}</b> ${escapar(area.titulo)}</span>${pagina(`area-${area.numero}`)}</a></li>`)
    for (const s of areas.get(area.numero).secoes) {
      linhas.push(`<li class="sum-sec"><a href="#${s.id}"><span><b>${s.num}</b> ${s.titulo}</span>${pagina(s.id)}</a></li>`)
    }
  }
  return `<section class="sumario guia-sumario" id="sumario">${alvo('sumario')}<h1>Sumário</h1>${g.apresentacao ? `<p class="lead">${escapar(g.apresentacao)}</p>` : ''}<ol class="sum">${linhas.join('')}</ol></section>`
}

function area(a, { introducao, corpo }) {
  return `<section class="guia-area" id="area-${a.numero}" style="page: area${a.numero}">
  <div class="texto-corrido">
    <header class="guia-area__titulo">${alvo(`area-${a.numero}`)}<span class="numero">${a.numero}</span><h1>${escapar(a.titulo)}</h1></header>
    ${introducao}
    ${corpo.replace(/(<h2 class="secao-titulo" id="([^"]+)">)/g, (_, h, id) => `${h}${alvo(id)}`)}
  </div>
</section>`
}

function paginasCss(g) {
  return g.areas
    .map(
      (a) => `@page area${a.numero} {
  @top-left { content: "${g.titulo}"; }
  @top-right { content: "${a.numero} · ${a.titulo}"; }
}`,
    )
    .join('\n')
}

;(async () => {
  const g = lerGuia(nome)
  const areas = new Map()
  for (const a of g.areas) areas.set(a.numero, capituloHtml(a))

  let corpo = capa(g) + sumario(g, areas)
  for (const a of g.areas) corpo += area(a, areas.get(a.numero))
  corpo = telas(corpo)
  const head = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(g.titulo)}</title>
<style>${fontes()}</style>
<link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, 'scripts/manual/pdf/manual.css')).href}">
<style>
@page { @bottom-left { content: "${g.titulo} do Vela · versão ${g.versao}"; } }
${paginasCss(g)}
</style></head><body class="livro guia">`
  const total = await imprimirComPaginas(`${head}${corpo}</body></html>`, SAIDA)
  console.log(`${total} páginas: ${path.relative(ROOT, SAIDA)}`)
})().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
