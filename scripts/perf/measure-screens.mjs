// Mede, no navegador, o que o usuário sente: abertura fria autenticada, abertura
// de cada tela por navegação interna (SPA), rolagem das listas e páginas antigas.
// Roda contra um build local (`vite preview`) apontado para o stack local
// (scripts/design-audit/win/README.md); nunca contra produção.
//
// Required: PERF_BASE_URL (http://localhost:4173), PERF_USER_EMAIL, PERF_USER_PASSWORD
// Optional: PERF_ROUNDS (5), PERF_LATENCY_MS (80), PERF_CPU_THROTTLE (2),
//           PERF_BROWSER_EXECUTABLE_PATH (Chrome/Edge instalado),
//           PERF_SCREENS (lista separada por vírgula), PERF_OUTPUT.
//
// "Pronto" = nenhuma requisição ao Supabase em voo, nenhum aria-busy e nenhum
// "Carregando" no <main> por 600 ms; o tempo reportado é o da última mudança
// do <main> (ou da última resposta) antes desse silêncio.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.PERF_BASE_URL
const email = process.env.PERF_USER_EMAIL
const password = process.env.PERF_USER_PASSWORD
const rounds = Number(process.env.PERF_ROUNDS ?? 5)
const latency = Number(process.env.PERF_LATENCY_MS ?? 80)
const cpuThrottle = Number(process.env.PERF_CPU_THROTTLE ?? 2)
const output = resolve(process.env.PERF_OUTPUT ?? 'artifacts/perf/screens.json')

if (!baseUrl || !email || !password) {
  console.error('Set PERF_BASE_URL, PERF_USER_EMAIL and PERF_USER_PASSWORD.')
  process.exit(2)
}
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) {
  console.error('measure-screens só roda contra o stack local.')
  process.exit(2)
}

// path: rota aberta; scroll: mede rolagem; older: botão que leva ao conteúdo
// mais antigo (próxima página / mais antigos), clicado uma vez após pronto.
const ALL_SCREENS = [
  { name: 'painel', path: '/painel', older: /Carregar mais viagens/i },
  { name: 'viagens', path: '/viagens', scroll: true },
  { name: 'bls', path: '/bls', scroll: true, older: /Próxima|Próximo|Carregar mais|Mais antig/i },
  { name: 'containers', path: '/containers', scroll: true, older: /Próxima|Próximo|Carregar mais|Mais antig/i },
  { name: 'veiculos', path: '/veiculos', scroll: true },
  // Viagem ro-ro do seed-volume.sql (id % 4 = 0): lista de veículos e página seguinte.
  { name: 'veiculos-viagem', path: '/veiculos?voyage=1004', scroll: true, older: /Próxima/i },
  { name: 'clientes', path: '/clientes', scroll: true, older: /Próxima|Próximo|Carregar mais|Mais antig/i },
  { name: 'alertas', path: '/alertas', scroll: true, older: /Próxima|Próximo|Carregar mais|Mais antig/i },
  { name: 'demurrage', path: '/demurrage', scroll: true, older: /Próxima|Próximo|Carregar mais|Mais antig/i },
  { name: 'taxas-locais', path: '/taxas-locais', scroll: true, older: /Próxima|Próximo|Carregar mais|Mais antig/i },
  { name: 'revisao', path: '/revisao', scroll: true },
  { name: 'relatorios', path: '/relatorios' },
]
const wanted = process.env.PERF_SCREENS?.split(',').map((s) => s.trim()).filter(Boolean)
const screens = wanted?.length ? ALL_SCREENS.filter((s) => wanted.includes(s.name)) : ALL_SCREENS

// Instrumentação injetada antes de qualquer script da página.
function instrument() {
  const state = { inflight: 0, lastNet: 0, lastMain: 0, requests: 0, longTasks: [] }
  window.__perf = state
  const origFetch = window.fetch
  window.fetch = async (...args) => {
    const url = String(args[0]?.url ?? args[0])
    const tracked = url.includes('/sb-proxy/')
    if (tracked) { state.inflight++; state.requests++ }
    try {
      const res = await origFetch(...args)
      if (tracked) await res.clone().arrayBuffer().catch(() => {})
      return res
    } finally {
      if (tracked) { state.inflight--; state.lastNet = performance.now() }
    }
  }
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) state.longTasks.push({ start: e.startTime, duration: e.duration })
  }).observe({ type: 'longtask', buffered: true })
  const watch = () => {
    const main = document.querySelector('main')
    if (!main) return requestAnimationFrame(watch)
    new MutationObserver(() => { state.lastMain = performance.now() }).observe(document.getElementById('root'), {
      subtree: true, childList: true, characterData: true,
    })
    state.lastMain = performance.now()
  }
  document.addEventListener('DOMContentLoaded', watch)
}

async function waitReady(page, startedAt, { quietMs = 600, timeoutMs = 30_000 } = {}) {
  const begin = Date.now()
  let quietSince = null
  while (Date.now() - begin < timeoutMs) {
    const s = await page.evaluate(() => {
      const main = document.querySelector('main')
      const busy = !main
        || main.querySelector('[aria-busy="true"]') != null
        || /Carregando/i.test(main.innerText)
        || /Carregando sessão/i.test(document.body.innerText)
      return { busy, inflight: window.__perf.inflight, lastNet: window.__perf.lastNet, lastMain: window.__perf.lastMain, now: performance.now() }
    })
    // Navegação em transição mantém a tela anterior até o chunk chegar: só
    // conta como pronto depois que o <main> mudou.
    const idle = !s.busy && s.inflight === 0 && s.lastMain > startedAt
    if (idle) {
      quietSince ??= s.now
      if (s.now - quietSince >= quietMs) {
        return Math.round(Math.max(s.lastNet, Math.min(s.lastMain, quietSince)) - startedAt)
      }
    } else quietSince = null
    await page.waitForTimeout(25)
  }
  return null
}

async function snapshot(page, since) {
  return page.evaluate((t0) => {
    const tasks = window.__perf.longTasks.filter((t) => t.start >= t0)
    return {
      requests: window.__perf.requests,
      longTaskMs: Math.round(tasks.reduce((sum, t) => sum + t.duration, 0)),
      // Total blocking time: o que passa de 50 ms em cada tarefa longa.
      tbtMs: Math.round(tasks.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0)),
      domNodes: document.getElementsByTagName('*').length,
    }
  }, since)
}

async function measureScroll(page) {
  return page.evaluate(async () => {
    const scroller = document.scrollingElement
    scroller.scrollTop = 0
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const max = scroller.scrollHeight - innerHeight
    if (max < 200) return { scrollable: false }
    const frames = []
    const t0 = performance.now()
    let last = t0
    // 120 quadros a passo fixo, como uma roda de mouse contínua.
    const step = Math.max(40, max / 120)
    await new Promise((done) => {
      const tick = (now) => {
        frames.push(now - last)
        last = now
        scroller.scrollTop += step
        if (scroller.scrollTop >= max - 1 || frames.length > 240) return done()
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    frames.shift()
    const sorted = [...frames].sort((a, b) => a - b)
    const tasks = window.__perf.longTasks.filter((t) => t.start >= t0)
    return {
      scrollable: true,
      frames: frames.length,
      p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
      jankyPct: Math.round((frames.filter((f) => f > 34).length / frames.length) * 100),
      longTaskMs: Math.round(tasks.reduce((sum, t) => sum + t.duration, 0)),
    }
  })
}

async function spaNavigate(page, path) {
  return page.evaluate((target) => {
    const t = performance.now()
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
    return t
  }, path)
}

async function newPage(context) {
  const page = await context.newPage()
  // Telemetria de terceiros fica fora do benchmark (e não recebe dados locais).
  await page.route(/sentry\.io|posthog\.com|olinda\.bcb\.gov\.br/, (route) => route.abort())
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency, downloadThroughput: (20 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle })
  return page
}

const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b)
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PERF_BROWSER_EXECUTABLE_PATH || undefined,
})
const results = { cold: [], screens: Object.fromEntries(screens.map((s) => [s.name, []])) }
try {
  // Sessão salva uma vez; cada rodada abre um contexto novo (cache HTTP frio)
  // já autenticado, que é o F5/abertura do dia a dia.
  const loginContext = await browser.newContext()
  const loginPage = await loginContext.newPage()
  await loginPage.goto(new URL('/login', baseUrl).href)
  await loginPage.getByLabel('E-mail').fill(email)
  await loginPage.getByRole('textbox', { name: 'Senha' }).fill(password)
  await loginPage.getByRole('button', { name: 'Entrar' }).click()
  await loginPage.waitForURL(/\/painel/, { timeout: 30_000 })
  const storageState = await loginContext.storageState()
  await loginContext.close()

  for (let round = 0; round < rounds; round++) {
    const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } })
    await context.addInitScript(instrument)
    const page = await newPage(context)

    await page.goto(new URL('/painel', baseUrl).href, { waitUntil: 'commit' })
    const coldReady = await waitReady(page, 0)
    const paint = await page.evaluate(() => ({
      fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0),
      js: performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.js')).reduce((s, r) => s + r.encodedBodySize, 0),
      css: performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.css')).reduce((s, r) => s + r.encodedBodySize, 0),
      font: performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.woff2')).reduce((s, r) => s + r.encodedBodySize, 0),
    }))
    results.cold.push({
      readyMs: coldReady, fcpMs: paint.fcp,
      jsKB: Math.round(paint.js / 1024), cssKB: Math.round(paint.css / 1024), fontKB: Math.round(paint.font / 1024),
      ...(await snapshot(page, 0)),
    })

    for (const screen of screens) {
      await spaNavigate(page, '/perfil')
      await waitReady(page, 0, { quietMs: 300 })
      const before = await page.evaluate(() => window.__perf.requests)
      const t0 = await spaNavigate(page, screen.path)
      const readyMs = await waitReady(page, t0)
      const snap = await snapshot(page, t0)
      const row = { readyMs, requests: snap.requests - before, tbtMs: snap.tbtMs, domNodes: snap.domNodes }
      if (screen.scroll) row.scroll = await measureScroll(page)
      if (screen.older) {
        await page.evaluate(() => { document.scrollingElement.scrollTop = 0 })
        const button = page.locator('main').getByRole('button', { name: screen.older }).first()
        if (await button.count() && await button.isEnabled()) {
          const r0 = await page.evaluate(() => window.__perf.requests)
          // olderRowsMs: até a primeira linha da lista trocar (o que o usuário vê);
          // olderMs: até a rede silenciar, inclusive a pré-carga da página seguinte.
          const t1 = await page.evaluate(() => {
            const firstRow = () => document.querySelector('main tbody tr, main [data-bl-card]')?.textContent ?? ''
            const initial = firstRow()
            const start = performance.now()
            window.__perf.olderRows = new Promise((resolve) => {
              const poll = () => {
                if (firstRow() !== initial && !document.querySelector('main [aria-busy="true"]')) resolve(performance.now() - start)
                else if (performance.now() - start > 30_000) resolve(null)
                else requestAnimationFrame(poll)
              }
              requestAnimationFrame(poll)
            })
            return start
          })
          await button.click()
          row.olderMs = await waitReady(page, t1, { quietMs: 400 })
          row.olderRowsMs = await page.evaluate(() => window.__perf.olderRows.then((ms) => (ms == null ? null : Math.round(ms))))
          row.olderRequests = (await page.evaluate(() => window.__perf.requests)) - r0
        }
      }
      results.screens[screen.name].push(row)
    }
    await context.close()
  }
} finally {
  await browser.close()
}

const summarize = (rows) => {
  const keys = new Set(rows.flatMap((r) => Object.keys(r)))
  return Object.fromEntries([...keys].map((k) => [k, typeof rows.find((r) => r[k] != null)?.[k] === 'object'
    ? summarize(rows.map((r) => r[k]).filter(Boolean))
    : median(rows.map((r) => r[k]))]))
}
const report = {
  generatedAt: new Date().toISOString(),
  settings: { rounds, latencyMs: latency, cpuThrottle },
  cold: summarize(results.cold),
  screens: Object.fromEntries(Object.entries(results.screens).map(([k, v]) => [k, summarize(v)])),
  raw: results,
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log('cold', JSON.stringify(report.cold))
for (const [name, s] of Object.entries(report.screens)) console.log(name.padEnd(14), JSON.stringify(s))
