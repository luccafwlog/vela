// Captura as telas do Manual do Operador (capturas.mjs) no Vela local com o
// cenário de demonstração. Ver README desta pasta para subir o ambiente.
//
// Uso: npm run manual:capture [-- --so id1,id2]
// Saída: artifacts/manual/imagens/<id>.png e <id>.json
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { ROOT } from './fonte.mjs'
import { CAPTURAS } from './capturas.mjs'

const BASE = process.env.VELA_URL || 'http://127.0.0.1:5173'
const EMAIL = process.env.VELA_EMAIL || 'auditor@local.test'
const PASSWORD = process.env.VELA_PASSWORD || 'audit-local'
const OUT = path.join(ROOT, 'artifacts/manual/imagens')
const executablePath = process.env.MANUAL_BROWSER_EXECUTABLE_PATH || undefined
const ARQUIVOS = path.join(ROOT, 'artifacts/manual/cenario')
const cenario = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/manual/cenario/cenario.json'), 'utf8'))

const so = (() => {
  const i = process.argv.indexOf('--so')
  return i === -1 ? null : new Set(process.argv[i + 1].split(','))
})()

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type=email]').fill(EMAIL)
  await page.locator('input[type=password]').fill(PASSWORD)
  await page.keyboard.press('Enter')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 })
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  // Datas dos campos no formato brasileiro: o Chromium segue o idioma do
  // ambiente, não o da página.
  const browser = await chromium.launch({ executablePath, args: ['--lang=pt-BR'], env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } })
  const falhas = []
  try {
    const opcoes = { viewport: { width: 1200, height: 1700 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' }
    const context = await browser.newContext(opcoes)
    const page = await context.newPage()
    // Janela sem sessão, para as telas de antes de entrar (tela de entrada).
    const semSessao = async () => (await browser.newContext(opcoes)).newPage()
    await login(page)
    for (const captura of CAPTURAS) {
      if (so && !so.has(captura.id)) continue
      try {
        const { clip, marks, depois, tela = page } = await captura.fazer({ page, base: BASE, cenario, arquivos: ARQUIVOS, semSessao })
        await tela.screenshot({ path: path.join(OUT, `${captura.id}.png`), clip, fullPage: true })
        fs.writeFileSync(path.join(OUT, `${captura.id}.json`), JSON.stringify({ id: captura.id, width: clip.width, height: clip.height, marks }, null, 2))
        // Depois da foto, o procedimento segue (gravar, confirmar) para o
        // estado servir às capturas seguintes.
        if (depois) await depois()
        console.log(`ok  ${captura.id}`)
      } catch (error) {
        falhas.push(captura.id)
        console.error(`ERRO ${captura.id}: ${error.message.split('\n')[0]}`)
        await page.screenshot({ path: path.join(OUT, `${captura.id}.erro.png`) }).catch(() => {})
        await page.keyboard.press('Escape').catch(() => {})
      }
    }
  } finally {
    await browser.close()
  }
  if (falhas.length) {
    console.error(`${falhas.length} capturas falharam: a tela mudou ou o cenário não está carregado.`)
    process.exit(1)
  }
})()
