#!/usr/bin/env node
// Build do Vercel com tratamento da corrida documentada na ADR 0056.
//
// A integração Supabase/Vercel cria a branch efêmera e só então grava
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY no ambiente de Preview,
// reimplantando o Preview em seguida. O primeiro deploy da PR costuma rodar
// nessa janela, sem as variáveis, e o guard de `vite.config.ts` derrubava o
// build — um "Error" vermelho por PR que não representa problema no código.
//
// Aqui, e SOMENTE em Preview sem as variáveis, publicamos uma página de espera
// autoexplicativa em vez de falhar: nada de app apontando para backend errado,
// nada de vermelho enganoso. O redeploy automático da integração substitui esta
// página pela build real. Em Production (ou fora do Vercel) o guard continua
// valendo e o build falha alto, como antes.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const OUT_DIR = resolve(process.cwd(), 'dist')
const ENTRYPOINTS = ['index.html', 'portal.html']

export function resolvePreviewHoldReason(env) {
  if (env.VERCEL !== '1') return null
  if (env.VERCEL_ENV !== 'preview') return null
  const missing = REQUIRED_ENV.filter((name) => !env[name])
  return missing.length > 0 ? missing : null
}

function holdingPage(missing) {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="30" />
    <title>Preview aguardando a branch Supabase</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
             background: #0d1117; color: #e6edf3;
             font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif; }
      main { max-width: 34rem; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
      p { margin: 0 0 .75rem; color: #9ba7b4; }
      code { color: #e6edf3; }
    </style>
  </head>
  <body>
    <main>
      <h1>Preview aguardando a branch Supabase</h1>
      <p>
        Este Preview foi construído antes de a integração Supabase/Vercel gravar
        <code>${missing.join('</code>, <code>')}</code> no ambiente. Nenhuma
        versão do app foi publicada aqui de propósito.
      </p>
      <p>
        A própria integração reimplanta o Preview quando as variáveis ficam
        prontas. Esta página recarrega sozinha a cada 30 segundos.
      </p>
    </main>
  </body>
</html>
`
}

function main() {
  const missing = resolvePreviewHoldReason(process.env)

  if (missing) {
    console.warn(
      `[vercel] Preview sem ${missing.join(', ')}: publicando página de espera em vez de falhar. ` +
        'A integração Supabase/Vercel reimplanta o Preview quando as variáveis estiverem gravadas (ADR 0056).',
    )
    mkdirSync(OUT_DIR, { recursive: true })
    for (const entrypoint of ENTRYPOINTS) {
      writeFileSync(resolve(OUT_DIR, entrypoint), holdingPage(missing))
    }
    return 0
  }

  const result = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) throw result.error
  if (result.status !== 0) return result.status ?? 1
  try {
    cleanProductionArtifacts(OUT_DIR)
  } catch (err) {
    console.error('[vercel-build] Erro ao limpar artefatos confidenciais de produção:', err)
    return 1
  }
  return 0
}

export function assertNoForbiddenArtifacts(dir) {
  if (!existsSync(dir)) return
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.vite') {
        throw new Error(`[vercel-build] Diretório confidencial residual encontrado: ${fullPath}`)
      }
      assertNoForbiddenArtifacts(fullPath)
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.map')) {
        throw new Error(`[vercel-build] Arquivo .map residual encontrado no build: ${fullPath}`)
      }
    }
  }
}

function removeForbiddenArtifacts(dir) {
  if (!existsSync(dir)) return
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.vite') {
        rmSync(fullPath, { recursive: true, force: true })
      } else {
        removeForbiddenArtifacts(fullPath)
      }
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      rmSync(fullPath, { force: true })
    }
  }
}

export function cleanProductionArtifacts(outDir) {
  removeForbiddenArtifacts(outDir)
  assertNoForbiddenArtifacts(outDir)
}

// ponytail: sem framework de teste aqui — o import direto de
// resolvePreviewHoldReason cobre a decisão em src/services/__tests__.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
