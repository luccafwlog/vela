// Gera guia-rapido-financeiro.pdf a partir do HTML ao lado (Chromium, A4).
// Antes de imprimir, grava no bloco "marcas" do HTML a posição das marcações
// de cada tela (telas/<id>.json, escrito por capturar.mjs).
//
// Uso: node artifacts/guia-rapido-financeiro/gerar.mjs
// Se o Chromium da versão do Playwright do projeto não estiver baixado,
// aponte outro com MANUAL_BROWSER_EXECUTABLE_PATH (como no manual).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const dir = path.dirname(fileURLToPath(import.meta.url))
const html = path.join(dir, 'guia-rapido-financeiro.html')
const telas = path.join(dir, 'telas')

// posicoes.json: o centro de cada número, escolhido à mão em espaço livre da tela.
const posicoes = JSON.parse(fs.readFileSync(path.join(telas, 'posicoes.json'), 'utf8'))
const marcas = {}
for (const nome of fs.readdirSync(telas).filter((f) => f.endsWith('.json') && f !== 'posicoes.json').sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(telas, nome), 'utf8'))
  const pos = posicoes[d.id] || {}
  marcas[d.id] = { width: d.width, height: d.height, marks: d.marks.map((m) => ({ ...m, pos: pos[m.n] })) }
}
const fonte = fs.readFileSync(html, 'utf8')
const bloco = /<script id="marcas" type="application\/json">[\s\S]*?<\/script>/
if (!bloco.test(fonte)) throw new Error('Bloco "marcas" não encontrado no HTML.')
fs.writeFileSync(html, fonte.replace(bloco, `<script id="marcas" type="application/json">${JSON.stringify(marcas)}</script>`))

const browser = await chromium.launch({ executablePath: process.env.MANUAL_BROWSER_EXECUTABLE_PATH || undefined })
const page = await browser.newPage()
await page.goto(`file://${html}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.pdf({ path: path.join(dir, 'guia-rapido-financeiro.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
await browser.close()
console.log('PDF gerado:', path.join(dir, 'guia-rapido-financeiro.pdf'))
