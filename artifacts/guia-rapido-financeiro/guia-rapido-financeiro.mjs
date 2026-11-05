// Gera guia-rapido-financeiro.pdf a partir do HTML ao lado (Chromium, A4).
// Uso: node artifacts/guia-rapido-financeiro/guia-rapido-financeiro.mjs
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`file://${path.join(dir, 'guia-rapido-financeiro.html')}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.pdf({ path: path.join(dir, 'guia-rapido-financeiro.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
await browser.close()
