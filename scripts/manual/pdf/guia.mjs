// Gera o PDF de um guia rápido a partir de docs/manual/guias/<nome>.
//
// Uso: npm run manual:guia -- documentacao [--saida artifacts/manual/guia-documentacao.pdf]
// O guia é um método de trabalho: a capa, o mapa das etapas (que serve de
// sumário) e uma etapa por página, com a faixa "Quando / Onde / Pronto quando"
// do guia.json, a imagem e poucos passos. Usa as capturas do manual
// (npm run manual:capture) e o mesmo visual.
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

// O mapa: as etapas em ordem, cada uma com quando começa, quando está pronta
// e a página. A ordem dos arquivos fica numa faixa embaixo.
function mapa(g) {
  const etapas = g.areas
    .map(
      (a) => `<a class="etapa" href="#area-${a.numero}">
  <span class="n">${a.numero}</span>
  <span class="texto"><b>${escapar(a.titulo)}</b>${a.quando ? `<span><i>Quando:</i> ${escapar(a.quando)}</span>` : ''}${a.pronto ? `<span><i>Pronto quando:</i> ${escapar(a.pronto)}</span>` : ''}</span>
  ${pagina(`area-${a.numero}`)}
</a>`,
    )
    .join('')
  const ordem = g.ordem?.length
    ? `<div class="guia-ordem"><span class="rotulo">${escapar(g.ordemTitulo || 'A ordem dos arquivos')}</span><ol>${g.ordem.map((o) => `<li>${escapar(o)}</li>`).join('')}</ol></div>`
    : ''
  return `<section class="sumario guia-mapa" id="sumario">${alvo('sumario')}<h1>${escapar(g.mapaTitulo || 'O caminho')}</h1>${g.apresentacao ? `<p class="lead">${escapar(g.apresentacao)}</p>` : ''}<nav class="etapas">${etapas}</nav>${ordem}</section>`
}

function faixa(a) {
  const fatos = [
    ['Quando', a.quando],
    ['Onde', a.onde],
    ['Pronto quando', a.pronto],
  ].filter(([, v]) => v)
  if (!fatos.length) return ''
  return `<div class="guia-faixa">${fatos.map(([r, v]) => `<div><span class="rotulo">${r}</span><span>${escapar(v)}</span></div>`).join('')}</div>`
}

function area(a, { introducao, corpo }) {
  return `<section class="guia-area" id="area-${a.numero}" style="page: area${a.numero}">
  <div class="texto-corrido">
    <header class="guia-area__titulo">${alvo(`area-${a.numero}`)}<span class="numero">${a.numero}</span><h1>${escapar(a.titulo)}</h1></header>
    ${faixa(a)}
    ${introducao}
    ${corpo}
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
  let corpo = capa(g) + mapa(g)
  for (const a of g.areas) corpo += area(a, capituloHtml(a))
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
