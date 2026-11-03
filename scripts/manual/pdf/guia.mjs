// Gera o PDF de um guia rápido a partir de docs/manual/guias/<nome>.
//
// Uso: npm run manual:guia -- viagem [--saida artifacts/manual/guia-viagem.pdf]
// O guia é um método de trabalho: a capa, o mapa das etapas (um fluxo em
// raias por equipe, que serve de sumário) e uma etapa por página, com a faixa
// "Quando / Onde / Pronto quando" do guia.json, a imagem e poucos passos. Usa as capturas do manual
// (npm run manual:capture) e o mesmo visual.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, lerGuia, capituloHtml, escapar, chip } from './fonte.mjs'
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

const equipes = (a) => (a.equipes?.length ? `<span class="equipes">${a.equipes.map(chip).join('')}</span>` : '')

// O mapa é um fluxo em raias: uma coluna por equipe e o tempo de cima para
// baixo, em faixas (guia.json › fluxo). Etapas na mesma faixa correm ao
// mesmo tempo; a seta liga só o que depende do anterior. A etapa das três
// equipes ocupa as três colunas (ou as do "colunas" do cartão); a etapa que
// nem sempre existe tem a borda tracejada, e o ponto crítico, a borda dourada.
// Medidas em mm, para a página A4 do livro.
const RAIAS = ['Operações', 'Documentação', 'Equipamentos']
const F = { largura: 174, rotulo: 31, topo: 9, passo: 13, cartao: 10.6, entreFases: 2.4, margem: 2.4 }

function fluxo(g) {
  const { fases, etapas, setas } = g.fluxo
  const xRaias = F.rotulo + 1
  const raia = (F.largura - xRaias) / RAIAS.length
  const faseDaLinha = (l) => fases.findIndex((f) => l >= f.linhas[0] && l <= f.linhas[1])
  const yLinha = (l) => F.topo + l * F.passo + faseDaLinha(l) * F.entreFases
  const caixa = {}
  for (const a of g.areas) {
    const e = etapas[a.numero]
    if (!e) throw new Error(`fluxo: falta a etapa ${a.numero} no guia.json`)
    const [de, ate] = e.colunas ?? (a.equipes.length === RAIAS.length ? [0, RAIAS.length - 1] : [RAIAS.indexOf(a.equipes[0]), RAIAS.indexOf(a.equipes[0])])
    if (a.equipes.length === 1 && de < 0) throw new Error(`fluxo: a etapa ${a.numero} não tem equipe de uma das raias`)
    if (de < 0 || ate < de || (a.equipes.length > 1 && a.equipes.length < RAIAS.length && !e.colunas)) throw new Error(`fluxo: a etapa ${a.numero} precisa de "colunas"`)
    const x = xRaias + de * raia + F.margem
    const w = (ate - de + 1) * raia - 2 * F.margem
    const y = yLinha(e.linha) + (F.passo - F.cartao) / 2
    // A cor é a da equipe só quando o cartão é dela, numa coluna.
    const cor = a.equipes.length === 1 ? ['ope', 'doc', 'equ'][de] : 'todas'
    caixa[a.numero] = { a, e, cor, x, y, w, h: F.cartao, cx: x + w / 2, cy: y + F.cartao / 2 }
  }
  const ultima = Math.max(...fases.map((f) => f.linhas[1]))
  const altura = yLinha(ultima) + F.passo + 1
  const n = (v) => v.toFixed(2)

  // Faixas de fundo, alternadas, com o nome do momento à esquerda.
  const faixas = fases
    .map((f, i) => {
      const y = yLinha(f.linhas[0]) - F.entreFases / 2
      const h = yLinha(f.linhas[1]) + F.passo - yLinha(f.linhas[0]) + F.entreFases
      return `<rect x="0" y="${n(y)}" width="${F.largura}" height="${n(h)}" rx="1.6" class="fx-faixa${i % 2 ? ' fx-faixa--par' : ''}"/>`
    })
    .join('')
  const rotulos = fases
    .map((f) => {
      const y = yLinha(f.linhas[0]) - F.entreFases / 2
      const h = yLinha(f.linhas[1]) + F.passo - yLinha(f.linhas[0]) + F.entreFases
      return `<div class="fx-fase" style="top:${n(y)}mm;height:${n(h)}mm;width:${F.rotulo}mm">${escapar(f.titulo)}</div>`
    })
    .join('')
  const cabecalho = RAIAS.map((r, i) => `<div class="fx-raia" style="left:${n(xRaias + i * raia)}mm;width:${n(raia)}mm">${chip(r)}</div>`).join('')

  // Setas: na mesma coluna, reta; "lado" sai da lateral e desce até o topo do
  // destino; "fundo" desce da origem e entra pela lateral do destino.
  const caminhos = setas
    .map(([de, para, via]) => {
      const o = caixa[de]
      const d = caixa[para]
      if (!o || !d) throw new Error(`fluxo: seta ${de} → ${para} sem etapa`)
      if (via === 'lado') {
        const dir = d.cx > o.cx
        return `M${n(dir ? o.x + o.w : o.x)} ${n(o.cy)} H${n(d.cx)} V${n(d.y - 0.4)}`
      }
      if (via === 'fundo') {
        const dir = d.cx < o.cx
        return `M${n(o.cx)} ${n(o.y + o.h)} V${n(d.cy)} H${n(dir ? d.x + d.w + 0.4 : d.x - 0.4)}`
      }
      return `M${n(o.cx)} ${n(o.y + o.h)} V${n(d.y - 0.4)}`
    })
    .map((c) => `<path d="${c}" class="fx-seta" marker-end="url(#fx-ponta)"/>`)
    .join('')

  const cartoes = Object.values(caixa)
    .map(({ a, e, cor, x, y, w, h }) => {
      return `<a class="fx-cartao fx-cartao--${cor}${e.opcional ? ' fx-cartao--opcional' : ''}${e.critico ? ' fx-cartao--critico' : ''}" href="#area-${a.numero}" style="left:${n(x)}mm;top:${n(y)}mm;width:${n(w)}mm;height:${n(h)}mm">
  <span class="fx-n">${a.numero}</span>
  <span class="fx-texto"><b>${escapar(e.rotulo)}</b>${e.nota ? `<span>${escapar(e.nota)}</span>` : ''}</span>
  ${pagina(`area-${a.numero}`)}
</a>`
    })
    .join('')

  return `<div class="fx" style="width:${F.largura}mm;height:${n(altura)}mm">
<svg class="fx-fundo" viewBox="0 0 ${F.largura} ${n(altura)}" width="${F.largura}mm" height="${n(altura)}mm" aria-hidden="true">
  <defs><marker id="fx-ponta" viewBox="0 0 6 6" refX="5.4" refY="3" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0 0 L6 3 L0 6 Z" class="fx-ponta"/></marker></defs>
  ${faixas}${caminhos}
</svg>
${cabecalho}${rotulos}${cartoes}
</div>`
}

function mapa(g) {
  return `<section class="sumario guia-mapa" id="sumario">${alvo('sumario')}<h1>${escapar(g.mapaTitulo || 'O caminho')}</h1>${g.apresentacao ? `<p class="lead">${escapar(g.apresentacao)}</p>` : ''}${fluxo(g)}</section>`
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
    <header class="guia-area__titulo">${alvo(`area-${a.numero}`)}<span class="numero">${a.numero}</span><h1>${escapar(a.titulo)}</h1>${equipes(a)}</header>
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
</style></head><body class="livro guia-rapido">`
  const total = await imprimirComPaginas(`${head}${corpo}</body></html>`, SAIDA)
  console.log(`${total} páginas: ${path.relative(ROOT, SAIDA)}`)
})().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
