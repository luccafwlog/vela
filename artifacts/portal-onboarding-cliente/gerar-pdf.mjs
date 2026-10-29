// Gera Tutorial_Portal_Fwlog.pdf a partir do HTML desta pasta e confere o
// que um PDF quebrado esconderia: página que transborda o A4, fonte ou logo
// que não carregou, o nome interno do sistema no texto ao cliente e a
// contagem de páginas.
//
// Uso, na raiz do repositório: node artifacts/portal-onboarding-cliente/gerar-pdf.mjs
// Usa o Playwright das devDependencies; nada aqui é importado por src/.
// PDF_BROWSER_EXECUTABLE_PATH aponta outro Chromium quando o do Playwright
// não está instalado, como PERF_BROWSER_EXECUTABLE_PATH em scripts/perf/.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const htmlPath = path.join(here, 'Tutorial_Portal_Fwlog.html')
const pdfPath = path.join(here, 'Tutorial_Portal_Fwlog.pdf')

const browser = await chromium.launch({ executablePath: process.env.PDF_BROWSER_EXECUTABLE_PATH || undefined })
try {
  const page = await browser.newPage()
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)

  const report = await page.evaluate(() => {
    const problems = []
    if (!document.fonts.check('700 16px "DM Sans"')) problems.push('DM Sans não carregou')
    if (!document.fonts.check('400 12px "IBM Plex Mono"')) problems.push('IBM Plex Mono não carregou')
    for (const img of document.images) {
      if (!img.complete || img.naturalWidth === 0) problems.push(`imagem não carregou: ${img.getAttribute('src')}`)
    }
    const pages = [...document.querySelectorAll('.page')]
    pages.forEach((el, index) => {
      // .page tem altura fixa de A4 e esconde o excesso: conteúdo a mais
      // empurra o rodapé para fora sem nenhum aviso visual no PDF.
      if (el.scrollHeight > el.clientHeight + 1) problems.push(`página ${index + 1} transborda ${el.scrollHeight - el.clientHeight}px na altura`)
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`página ${index + 1} transborda ${el.scrollWidth - el.clientWidth}px na largura`)
      const footer = el.querySelector('.pf')
      if (!footer || !footer.textContent.includes('portalfwlog.com.br')) problems.push(`página ${index + 1} sem o rodapé do Portal`)
      if (!footer?.textContent.includes(`${index + 1} / ${pages.length}`)) problems.push(`página ${index + 1} com numeração errada`)
    })
    // O cliente nunca vê o nome do sistema interno.
    if (/\bvela\b/i.test(document.body.innerText)) problems.push('o texto cita o sistema interno')
    // Versão para o cliente: nenhuma marca de rascunho.
    if (/rascunho para revis/i.test(document.body.innerText)) problems.push('o texto ainda diz "Rascunho para revisão"')
    return { pages: pages.length, problems }
  })

  if (report.problems.length > 0) {
    console.error(`Tutorial com problemas:\n- ${report.problems.join('\n- ')}`)
    process.exitCode = 1
  } else {
    await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true })
    // ponytail: conta páginas por regex, porque o Chromium grava cada página
    // como objeto /Type /Page sem compressão. Se um dia comprimir os objetos,
    // a contagem dá zero e falha alto; aí, ler com pdfjs-dist (já nas dependências).
    const pdfPages = (readFileSync(pdfPath, 'latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length
    if (pdfPages !== report.pages) {
      console.error(`O PDF saiu com ${pdfPages} páginas; o HTML tem ${report.pages}.`)
      process.exitCode = 1
    } else {
      console.log(`PDF gerado: ${path.relative(process.cwd(), pdfPath)} (${pdfPages} páginas A4).`)
    }
  }
} finally {
  await browser.close()
}
