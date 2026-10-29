// Gera o PDF do Manual do Operador a partir de docs/manual/texto.
//
// Uso: npm run manual:build [-- --saida artifacts/manual/manual-do-operador.pdf]
// Precisa das capturas de `npm run manual:capture` (artifacts/manual/imagens).
//
// Duas passadas: a primeira imprime com marcas invisíveis nos títulos e lê
// do PDF em que página cada um caiu; a segunda preenche o sumário e as
// listas "Quero fazer…" com esses números.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { ROOT, lerManual, capituloHtml, escapar, chip } from './fonte.mjs'

const OUT = path.join(ROOT, 'artifacts/manual')
const IMAGENS = path.join(OUT, 'imagens')
const arg = (nome) => {
  const i = process.argv.indexOf(nome)
  return i === -1 ? null : process.argv[i + 1]
}
const SAIDA = path.resolve(ROOT, arg('--saida') || 'artifacts/manual/manual-do-operador.pdf')
const executablePath = process.env.MANUAL_BROWSER_EXECUTABLE_PATH || undefined

function fontes() {
  const css = fs.readFileSync(path.join(ROOT, 'src/fonts.css'), 'utf8')
  const dir = pathToFileURL(path.join(ROOT, 'public/fonts')).href
  return css.replace(/url\(\/fonts\//g, `url(${dir}/`)
}

// Figura com as marcações numeradas e o destaque, a partir da captura.
function telas(html) {
  return html.replace(/<div class="tela__quadro" data-captura="([\w-]+)"><\/div>/g, (_, id) => {
    const json = path.join(IMAGENS, `${id}.json`)
    if (!fs.existsSync(json)) throw new Error(`Falta a captura "${id}": rode npm run manual:capture.`)
    const { width, height, marks } = JSON.parse(fs.readFileSync(json, 'utf8'))
    const pct = (v, total) => `${((v / total) * 100).toFixed(3)}%`
    const pad = 4
    const partes = marks.map((m) => {
      const destaque = m.destaque
        ? `<span class="destaque" style="left:${pct(m.x - pad, width)};top:${pct(m.y - pad, height)};width:${pct(m.w + pad * 2, width)};height:${pct(m.h + pad * 2, height)}"></span>`
        : ''
      let ponto = { x: m.x, y: m.y, classe: 'marca' }
      if (m.posicao === 'campo') ponto = { x: m.x + m.w - 22, y: m.y + m.h / 2, classe: 'marca marca--centro' }
      if (m.posicao === 'esquerda') ponto = { x: m.x - 6, y: m.y + m.h / 2, classe: 'marca marca--esquerda' }
      if (m.posicao === 'direita') ponto = { x: m.x + m.w + 6, y: m.y + m.h / 2, classe: 'marca marca--direita' }
      return `${destaque}<span class="${ponto.classe}" style="left:${pct(ponto.x, width)};top:${pct(ponto.y, height)}">${m.n}</span>`
    })
    const src = pathToFileURL(path.join(IMAGENS, `${id}.png`)).href
    const largura = Math.round(width) >= 900 ? 'tela__quadro--larga' : width < 520 ? 'tela__quadro--estreita' : ''
    // A proporção deixa o CSS limitar a altura da tela pela largura.
    return `<div class="tela__quadro ${largura}" style="--proporcao:${(width / height).toFixed(4)}"><img src="${src}" alt="">${partes.join('')}</div>`
  })
}

const alvo = (id) => `<span class="pdf-alvo">§${id}§</span>`
const pagina = (id) => `<span class="pag" data-alvo="${id}">000</span>`

function capa(m) {
  return `<section class="pagina pagina--escura pagina-fixa" style="page: capa">
  <div class="capa">
    <div class="marca-vela">
      <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M34 8 L34 48 L56 48 Z" fill="#ffffff"/><path d="M29 21 L29 48 L11 48 Z" fill="#d4882e"/><rect x="6" y="53" width="52" height="3.4" rx="1.7" fill="#ffffff"/></svg>
      <span>Vela</span>
    </div>
    <div class="titulo">
      <div class="sobre">${escapar(m.sobre)}</div>
      <h1>${escapar(m.titulo)}</h1>
      <p>${escapar(m.subtitulo)}</p>
    </div>
    <div class="pe">
      <div>
        <div class="rotulo" style="color:#c9d2e0;margin-bottom:2mm">Cada equipe tem sua cor nas aberturas, nos quadros "Quem faz" e no guia de bolso</div>
        <div class="trilhas">
          <div style="--cor:var(--team-doc)">Documentação</div>
          <div style="--cor:var(--team-ope)">Operações</div>
          <div style="--cor:var(--team-equ)">Equipamentos</div>
          <div style="--cor:var(--team-fin)">Financeiro</div>
          <div style="--cor:var(--team-adm)">Administrativo</div>
        </div>
      </div>
      <div class="versao">
        <span><b>Versão ${escapar(m.versao)}</b> · ${escapar(m.situacao)}</span>
        <span>Descreve o Vela em <b>${escapar(m.descreve)}</b></span>
      </div>
    </div>
  </div>
</section>`
}

function sumario(m, caps) {
  const linhas = []
  for (const parte of m.partes) {
    linhas.push(`<li class="sum-parte"><a href="#parte-${parte.numero}"><span>Parte ${parte.romano} · ${escapar(parte.titulo)}</span>${pagina(`parte-${parte.numero}`)}</a></li>`)
    for (const cap of parte.capitulos) {
      const { secoes } = caps.get(cap.numero)
      linhas.push(`<li class="sum-cap"><a href="#cap-${cap.numero}"><span><b>${cap.numero}</b> ${escapar(cap.titulo)}</span>${pagina(`cap-${cap.numero}`)}</a></li>`)
      for (const s of secoes) {
        linhas.push(`<li class="sum-sec"><a href="#${s.id}"><span><b>${s.num}</b> ${s.titulo}</span>${pagina(s.id)}</a></li>`)
      }
    }
  }
  return `<section class="sumario" id="sumario">${alvo('sumario')}<h1>Sumário</h1><ol class="sum">${linhas.join('')}</ol></section>`
}

function aberturaParte(parte) {
  const caps = parte.capitulos
    .map(
      (c) =>
        `<a href="#cap-${c.numero}"><span class="n">${c.numero}</span><span class="nome">${escapar(c.titulo)}${c.resumo ? `<small>${escapar(c.resumo)}</small>` : ''}</span><span class="equipes">${(c.equipesParte || c.equipes).map(chip).join(' ')}</span></a>`,
    )
    .join('')
  return `<section class="pagina pagina-fixa" style="page: parte" id="parte-${parte.numero}">${alvo(`parte-${parte.numero}`)}
  <div class="abertura-parte">
    <div class="texto">
      <div class="sobre">Parte ${parte.romano}</div>
      <h1>${escapar(parte.titulo)}</h1>
      <p class="lead">${escapar(parte.texto)}</p>
      <nav class="lista-capitulos">${caps}</nav>
    </div>
    <div class="lateral"><span>${parte.romano}</span></div>
  </div>
</section>`
}

function capitulo(cap, { introducao, corpo, secoes }) {
  const algumas = (cap.algumas || [])
    .map((a) => `<div>${escapar(a.texto)}: ${a.equipes.map(chip).join(' ')}</div>`)
    .join('')
  const quero = secoes
    .map((s) => `<tr><td class="sec"><a href="#${s.id}">${s.num}</a></td><td><a href="#${s.id}">${s.titulo}</a></td><td class="pag">${pagina(s.id)}</td></tr>`)
    .join('')
  return `<section class="capitulo" id="cap-${cap.numero}">
  <div class="abertura" style="page: ab${cap.numero}">${alvo(`cap-${cap.numero}`)}
    <div class="abertura-cap">
      <div class="numero">${cap.numero}</div>
      <div style="display:grid;gap:2mm"><div class="sobre">Capítulo ${cap.numero}</div><h1>${escapar(cap.titulo)}</h1></div>
    </div>
    <div class="intro">${introducao.replace(/<div class="bloco bloco--aprende">[\s\S]*$/, '')}</div>
    <div class="ficha-cap">
      <div class="fato"><span class="rotulo">Quem usa</span><div class="equipes" style="margin-top:1mm">${cap.equipes.map(chip).join(' ')}</div></div>
      <div class="fato"><span class="rotulo">Só algumas equipes</span><div class="valor">${algumas || '—'}</div></div>
      <div class="fato"><span class="rotulo">Tempo de leitura</span><div class="valor"><b>${escapar(cap.leitura)}</b>${cap.antes ? `<br><span class="rotulo">${escapar(cap.antes)}</span>` : ''}</div></div>
    </div>
    ${(introducao.match(/<div class="bloco bloco--aprende">[\s\S]*$/) || [''])[0]}
    <div class="bloco bloco--quero">
      <div class="faixa">Quero fazer… <span class="aside">clique para ir à seção</span></div>
      <div class="conteudo"><table class="quero">${quero}</table></div>
    </div>
  </div>
  <div class="texto-corrido" style="page: cap${cap.numero}">${corpo.replace(/(<h2 class="secao-titulo" id="([^"]+)">)/g, (_, h, id) => `${h}${alvo(id)}`)}</div>
</section>`
}

function paginasCss(m) {
  const regras = []
  m.partes.forEach((parte) => {
    for (const cap of parte.capitulos) {
      // A abertura do capítulo (ab) não tem cabeçalho; o texto (cap) tem.
      const aba = `@right-top { content: "PARTE ${parte.romano}"; margin-top: ${13 + (Number(parte.numero) - 1) * 26}mm; }`
      regras.push(`@page ab${cap.numero} { ${aba} }
@page cap${cap.numero} {
  @top-left { content: "Parte ${parte.romano} · ${parte.titulo}"; }
  @top-right { content: "Capítulo ${cap.numero} · ${cap.titulo}"; }
  ${aba}
}`)
    }
  })
  return regras.join('\n')
}

async function imprimir(browser, html, arquivo) {
  const montado = SAIDA.replace(/\.pdf$/, '') + '.montado.html'
  fs.writeFileSync(montado, html)
  const page = await browser.newPage()
  await page.goto(pathToFileURL(montado).href, { waitUntil: 'networkidle' })
  await page.addScriptTag({ path: path.join(path.dirname(new URL(import.meta.url).pathname), 'pagina.js') })
  await page.evaluate(() => document.fonts.ready)
  await page.pdf({ path: arquivo, preferCSSPageSize: true, printBackground: true })
  await page.close()
}

// Página de cada marca §id§ no PDF.
async function paginasDasMarcas(arquivo) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(arquivo)), verbosity: 0 }).promise
  const mapa = {}
  for (let n = 1; n <= doc.numPages; n += 1) {
    const texto = (await (await doc.getPage(n)).getTextContent()).items.map((it) => it.str).join('')
    for (const m of texto.matchAll(/§([^§\s]+)§/g)) mapa[m[1]] ??= n
  }
  return { mapa, total: doc.numPages }
}

;(async () => {
  const m = lerManual()
  const caps = new Map()
  for (const parte of m.partes) for (const cap of parte.capitulos) caps.set(cap.numero, capituloHtml(cap))

  let corpo = capa(m) + sumario(m, caps)
  for (const parte of m.partes) {
    corpo += aberturaParte(parte)
    for (const cap of parte.capitulos) corpo += capitulo(cap, caps.get(cap.numero))
  }
  corpo = telas(corpo)
  const head = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(m.titulo)}</title>
<style>${fontes()}</style>
<link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, 'scripts/manual/pdf/manual.css')).href}">
<style>
@page { @bottom-left { content: "${m.titulo} do Vela · versão ${m.versao}"; } }
${paginasCss(m)}
</style></head><body class="livro">`
  const html1 = `${head}${corpo}</body></html>`

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true })
  const browser = await chromium.launch({ executablePath })
  try {
    const rascunho = SAIDA.replace(/\.pdf$/, '') + '.rascunho.pdf'
    await imprimir(browser, html1, rascunho)
    const { mapa, total } = await paginasDasMarcas(rascunho)
    const faltando = [...html1.matchAll(/data-alvo="([^"]+)"/g)].map((x) => x[1]).filter((id) => !mapa[id])
    if (faltando.length) throw new Error(`Sem página para: ${[...new Set(faltando)].join(', ')}`)
    const html2 = html1
      .replace(/<span class="pag" data-alvo="([^"]+)">000<\/span>/g, (_, id) => `<span class="pag">${mapa[id]}</span>`)
      .replace(/<span class="pdf-alvo">§[^§\s]+§<\/span>/g, '')
    await imprimir(browser, html2, SAIDA)
    fs.rmSync(rascunho)
    console.log(`${total} páginas: ${path.relative(ROOT, SAIDA)}`)
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
