// Captura as telas das páginas-modelo do Manual do Operador e grava, para
// cada imagem, a posição real dos elementos marcados (marcações numeradas e
// destaque do botão), lida da própria tela.
//
// Precisa do Vela local rodando com dados fictícios (ver README desta pasta).
// Uso: node scripts/manual/pdf/capturar-modelo.cjs
// Saída: artifacts/manual/imagens/<id>.png e <id>.json
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const BASE = process.env.VELA_URL || 'http://127.0.0.1:5173'
const EMAIL = process.env.VELA_EMAIL || 'auditor@local.test'
const PASSWORD = process.env.VELA_PASSWORD || 'audit-local'
const OUT = path.resolve(__dirname, '../../../artifacts/manual/imagens')
// Como nos scripts de scripts/perf: aponte para um Chromium já instalado
// quando o navegador da versão do Playwright do projeto não estiver baixado.
const executablePath = process.env.MANUAL_BROWSER_EXECUTABLE_PATH || undefined

// Caixa de um elemento relativa ao recorte, em pixels CSS. A marcação fica no
// canto do elemento (padrão), dentro do campo à direita (`campo`, para não
// cobrir o rótulo nem o valor) ou à esquerda dele (`esquerda`).
async function boxIn(locator, clip) {
  const b = await locator.boundingBox()
  if (!b) throw new Error(`Elemento sem posição na tela: ${locator}`)
  return { x: b.x - clip.x, y: b.y - clip.y, w: b.width, h: b.height }
}

async function save(page, id, clip, marks) {
  await page.screenshot({ path: path.join(OUT, `${id}.png`), clip })
  const data = { id, width: clip.width, height: clip.height, marks }
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(data, null, 2))
  console.log(`${id}: ${marks.length} marcações`)
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type=email]').fill(EMAIL)
  await page.locator('input[type=password]').fill(PASSWORD)
  await page.keyboard.press('Enter')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 })
}

// 4.1 Cadastrar uma Viagem nova — passos 1 e 2: menu Viagens e Nova Viagem.
async function viagensTopo(page) {
  await page.goto(`${BASE}/viagens`, { waitUntil: 'networkidle' })
  const nav = page.locator('header').getByRole('link', { name: 'Viagens', exact: true })
  const nova = page.getByRole('button', { name: 'Nova Viagem' })
  await nova.waitFor()
  const barra = await page.locator('header.app-header').boundingBox()
  const novaBox = await nova.boundingBox()
  const width = page.viewportSize().width
  const top = barra.y
  const clip = { x: 0, y: top, width, height: novaBox.y + novaBox.height + 18 - top }
  await save(page, 'viagens-topo', clip, [
    { n: 1, ...(await boxIn(nav, clip)), destaque: true },
    { n: 2, ...(await boxIn(nova, clip)), destaque: true },
  ])
}

// 4.1 — passos 3 a 8: janela Nova Viagem preenchida com o cenário.
async function novaViagem(page) {
  await page.goto(`${BASE}/viagens`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Nova Viagem' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.waitFor()
  await dlg.getByLabel('Navio').fill('COSCO SHIPPING LEO')
  await dlg.getByLabel('IMO').fill('9783627')
  await dlg.getByLabel('Numero da viagem').fill('102W')
  const chave = dlg.getByRole('switch')
  await chave.click()
  await dlg.getByLabel('Navio').blur()
  await page.waitForTimeout(300)
  const b = await dlg.boundingBox()
  const clip = { x: b.x, y: b.y, width: b.width, height: b.height }
  await save(page, 'nova-viagem', clip, [
    { n: 3, ...(await boxIn(dlg.getByLabel('Armador'), clip)), posicao: 'campo' },
    { n: 4, ...(await boxIn(dlg.getByLabel('Navio'), clip)), posicao: 'campo' },
    { n: 5, ...(await boxIn(dlg.getByLabel('IMO'), clip)), posicao: 'campo' },
    { n: 6, ...(await boxIn(dlg.getByLabel('Numero da viagem'), clip)), posicao: 'campo' },
    { n: 7, ...(await boxIn(chave, clip)), posicao: 'esquerda' },
    { n: 8, ...(await boxIn(dlg.getByRole('button', { name: 'Cadastrar viagem' }), clip)), destaque: true },
  ])
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath })
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 2 })
  try {
    await login(page)
    await viagensTopo(page)
    await novaViagem(page)
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
