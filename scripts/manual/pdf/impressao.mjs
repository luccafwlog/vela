// Impressão comum ao Manual do Operador (gerar.mjs) e aos guias rápidos
// (guia.mjs): fontes, capturas com as marcações e as duas passadas que
// numeram as páginas do sumário.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { ROOT } from './fonte.mjs'

export const OUT = path.join(ROOT, 'artifacts/manual')
export const IMAGENS = path.join(OUT, 'imagens')
const executablePath = process.env.MANUAL_BROWSER_EXECUTABLE_PATH || undefined

export function fontes() {
  const css = fs.readFileSync(path.join(ROOT, 'src/fonts.css'), 'utf8')
  const dir = pathToFileURL(path.join(ROOT, 'public/fonts')).href
  return css.replace(/url\(\/fonts\//g, `url(${dir}/`)
}

// Figura com as marcações numeradas e o destaque, a partir da captura.
export function telas(html) {
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

export const alvo = (id) => `<span class="pdf-alvo">§${id}§</span>`
export const pagina = (id) => `<span class="pag" data-alvo="${id}">000</span>`

async function imprimir(browser, html, saida, arquivo) {
  const montado = saida.replace(/\.pdf$/, '') + '.montado.html'
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

// Duas passadas: a primeira imprime com marcas invisíveis nos títulos e lê
// do PDF em que página cada um caiu; a segunda preenche os números.
export async function imprimirComPaginas(html1, saida) {
  fs.mkdirSync(path.dirname(saida), { recursive: true })
  const browser = await chromium.launch({ executablePath })
  try {
    const rascunho = saida.replace(/\.pdf$/, '') + '.rascunho.pdf'
    await imprimir(browser, html1, saida, rascunho)
    const { mapa, total } = await paginasDasMarcas(rascunho)
    const faltando = [...html1.matchAll(/data-alvo="([^"]+)"/g)].map((x) => x[1]).filter((id) => !mapa[id])
    if (faltando.length) throw new Error(`Sem página para: ${[...new Set(faltando)].join(', ')}`)
    const html2 = html1
      .replace(/<span class="pag" data-alvo="([^"]+)">000<\/span>/g, (_, id) => `<span class="pag">${mapa[id]}</span>`)
      .replace(/<span class="pdf-alvo">§[^§\s]+§<\/span>/g, '')
    await imprimir(browser, html2, saida, saida)
    fs.rmSync(rascunho)
    return total
  } finally {
    await browser.close()
  }
}
