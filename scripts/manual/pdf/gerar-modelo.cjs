// Gera o PDF das páginas-modelo do Manual do Operador e uma imagem PNG de
// cada página para conferência. Usa as capturas de capturar-modelo.cjs.
//
// Uso: node scripts/manual/pdf/gerar-modelo.cjs
// Saída: artifacts/manual/paginas-modelo.pdf e artifacts/manual/paginas/NN.png
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '../../..')
const OUT = path.join(ROOT, 'artifacts/manual')
const IMAGENS = path.join(OUT, 'imagens')
const executablePath = process.env.MANUAL_BROWSER_EXECUTABLE_PATH || undefined

// As fontes do Vela (src/fonts.css) apontam para /fonts; aqui viram arquivos.
function fontes() {
  const css = fs.readFileSync(path.join(ROOT, 'src/fonts.css'), 'utf8')
  const dir = pathToFileURL(path.join(ROOT, 'public/fonts')).href
  return css.replace(/url\(\/fonts\//g, `url(${dir}/`)
}

// Troca cada <div class="tela__quadro" data-captura="id"> pela imagem e pelas
// marcações gravadas na captura, em porcentagem da imagem.
function telas(html) {
  return html.replace(/<div class="tela__quadro" data-captura="([\w-]+)"><\/div>/g, (_, id) => {
    const json = path.join(IMAGENS, `${id}.json`)
    if (!fs.existsSync(json)) throw new Error(`Falta a captura ${id}: rode capturar-modelo.cjs antes.`)
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
      return `${destaque}<span class="${ponto.classe}" style="left:${pct(ponto.x, width)};top:${pct(ponto.y, height)}">${m.n}</span>`
    })
    const src = pathToFileURL(path.join(IMAGENS, `${id}.png`)).href
    return `<div class="tela__quadro"><img src="${src}" alt="">${partes.join('')}</div>`
  })
}

;(async () => {
  const modelo = fs.readFileSync(path.join(__dirname, 'paginas-modelo.html'), 'utf8')
  const estilos = `<style>${fontes()}</style>\n<link rel="stylesheet" href="${pathToFileURL(path.join(__dirname, 'manual.css')).href}">`
  const html = telas(modelo.replace('<!--ESTILOS-->', estilos))
  fs.mkdirSync(path.join(OUT, 'paginas'), { recursive: true })
  const montado = path.join(OUT, 'paginas-modelo.html')
  fs.writeFileSync(montado, html)

  const browser = await chromium.launch({ executablePath })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 })
    await page.goto(pathToFileURL(montado).href, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.pdf({ path: path.join(OUT, 'paginas-modelo.pdf'), preferCSSPageSize: true, printBackground: true })
    const paginas = page.locator('section.pagina')
    const total = await paginas.count()
    for (let i = 0; i < total; i += 1) {
      await paginas.nth(i).screenshot({ path: path.join(OUT, 'paginas', `${String(i + 1).padStart(2, '0')}.png`) })
    }
    console.log(`${total} páginas: artifacts/manual/paginas-modelo.pdf`)
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
