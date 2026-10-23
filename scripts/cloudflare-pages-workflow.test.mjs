import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
// ADR 0091: o passo de contratos do Pages também roda o teste da promoção.
import './staging-release-pr.test.mjs'

const workflow = await readFile(new URL('../.github/workflows/cloudflare-pages-preview.yml', import.meta.url), 'utf8')
const lines = workflow.split(/\r?\n/)

function jobBlock(name) {
  const start = lines.indexOf(`  ${name}:`)
  assert.notEqual(start, -1, `workflow must define the ${name} job`)
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [a-z][\w-]*:$/.test(lines[index])) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

function jobPermissions(name) {
  const block = jobBlock(name)
  const match = block.match(/^    permissions:\n((?:      [^\n]+\n?)+)/m)
  assert.ok(match, `${name} job must declare explicit token permissions`)
  return match[1]
}

test('Cloudflare status-write permission is limited to the trusted publish job', () => {
  const globalPermissions = workflow.match(/^permissions:\n((?: {2}[^\n]+\n?)+)/m)?.[1] ?? ''
  assert.doesNotMatch(globalPermissions, /statuses:\s*write/)
  assert.doesNotMatch(jobPermissions('prepare'), /statuses:\s*write/)
  assert.doesNotMatch(jobPermissions('build'), /statuses:\s*write/)
  assert.match(jobPermissions('publish'), /statuses:\s*write/)
})

test('PR-controlled build job receives only repository read permission', () => {
  assert.match(jobPermissions('build'), /^      contents: read\n?$/)
  assert.match(jobBlock('build'), /persist-credentials: false/)
})

test('Supabase public key reaches the build by artifact, not by a job output GitHub may drop', () => {
  assert.doesNotMatch(jobBlock('prepare'), /^      supabase_anon_key:/m)
  assert.doesNotMatch(jobBlock('build'), /needs\.prepare\.outputs\.supabase_/)
  assert.match(jobBlock('build'), /name: preview-supabase-env/)
  assert.match(jobBlock('build'), /refusing to build a blank preview/)
})

test('Supabase access token is scoped only to steps that invoke the Supabase CLI', () => {
  const prepare = jobBlock('prepare')
  assert.doesNotMatch(prepare, /^      SUPABASE_ACCESS_TOKEN:/m)
  assert.equal((prepare.match(/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/g) ?? []).length, 2)
})

const readWorkflow = (name) => readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8')

test('jobs com token declaram o environment, e o build não (auditoria run-2, #14)', async () => {
  assert.match(jobBlock('prepare'), /environment: supabase-branches/)
  assert.match(jobBlock('publish'), /environment: cloudflare-pages/)
  assert.doesNotMatch(jobBlock('build'), /environment:|secrets\./)
  assert.match(await readWorkflow('cloudflare-pages-preview-cleanup.yml'), /environment: cloudflare-pages/)
  assert.match(await readWorkflow('cloudflare-pages-provision.yml'), /environment: cloudflare-pages/)
  const admin = await readWorkflow('provision-preview-admin.yml')
  assert.match(admin, /environment: supabase-branches/)
  // Secrets fora do env do job: só nos steps que os usam.
  const jobEnv = admin.slice(admin.indexOf('    env:\n'), admin.indexOf('    steps:'))
  assert.doesNotMatch(jobEnv, /SUPABASE_ACCESS_TOKEN|PREVIEW_ADMIN_PASSWORD/)
  // A PR da staging para a main não ganha admin de Preview (auditoria run-3).
  assert.match(admin, /github\.event\.pull_request\.head\.ref != 'staging'/)
  assert.match(admin, /\[\[ "\$head_ref" != staging \]\]/)
})

test('actions dos workflows com token fixadas por SHA', async () => {
  for (const name of ['cloudflare-pages-preview.yml', 'cloudflare-pages-preview-cleanup.yml', 'provision-preview-admin.yml', 'cloudflare-pages-production.yml', 'cloudflare-pages-provision.yml', 'cloudflare-pages-staging.yml']) {
    for (const [, ref] of (await readWorkflow(name)).matchAll(/uses: [\w./-]+@(\S+)/g)) {
      assert.match(ref, /^[0-9a-f]{40}$/, `${name} usa ${ref}`)
    }
  }
})

test('previews só por etiqueta; produção no push, esperando o Supabase', async () => {
  assert.match(workflow, /pull_request_target:\n {4}types: \[labeled\]/)
  assert.match(workflow, /github\.event\.label\.name == 'preview'/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /workflow_run:/)
  assert.match(jobBlock('prepare'), /github\.event\.repository\.default_branch/)
  assert.match(jobBlock('build'), /needs\.prepare\.outputs\.pr_head_sha/)
  const admin = await readWorkflow('provision-preview-admin.yml')
  assert.match(admin, /pull_request_target:\n {4}types: \[labeled\]/)
  assert.match(admin, /github\.event\.label\.name == 'preview'/)
  assert.doesNotMatch(admin, /workflow_run:/)
  const cleanup = await readWorkflow('cloudflare-pages-preview-cleanup.yml')
  assert.match(cleanup, /contains\(github\.event\.pull_request\.labels\.\*\.name, 'preview'\)/)
  const production = await readWorkflow('cloudflare-pages-production.yml')
  assert.match(production, /push:\n {4}branches:\n {6}- main/)
  assert.doesNotMatch(production, /workflow_run:/)
  assert.match(production, /checks: read/)
  const wait = production.indexOf('node scripts/wait-supabase-migrations.mjs')
  assert.ok(wait > 0 && wait < production.indexOf('wrangler pages deploy'), 'espera o Supabase antes de publicar')
  assert.match(production, /if: github\.event_name == 'push'\n/)
})

test('publish recusa Pages Functions vindas do build da PR', () => {
  const publish = jobBlock('publish')
  assert.match(publish, /_worker\.js/)
  assert.ok(publish.indexOf('_worker.js') < publish.indexOf('Publish Vela preview'))
})

test('staging publica só da branch staging, fora do production branch e sem o banco de produção', async () => {
  const staging = await readWorkflow('cloudflare-pages-staging.yml')
  assert.match(staging, /push:\n {4}branches:\n {6}- staging/)
  assert.match(staging, /github\.ref == 'refs\/heads\/staging'/)
  assert.match(staging, /environment: staging/)
  assert.match(staging, /--branch "\$STAGING_PAGES_BRANCH"/)
  assert.doesNotMatch(staging, /--branch main/)
  assert.match(staging, /PRODUCTION_SUPABASE_PROJECT_REF: fgmkhbzhaeebrsizwccx/)
  assert.match(staging, /vars\.CLOUDFLARE_PAGES_ACCESS_CONFIGURED == 'true'/)
  assert.match(staging, /cancel-in-progress: false/, 'não cancela entre o deploy do Vela e o do Portal')
  const wait = staging.indexOf('node scripts/wait-supabase-migrations.mjs')
  assert.ok(wait > 0 && wait < staging.indexOf('wrangler pages deploy'), 'espera o Supabase antes de publicar')
  const refuse = staging.indexOf('Refuse a bundle that still points to production Supabase')
  assert.ok(refuse > 0 && refuse < staging.indexOf('wrangler pages deploy'), 'confere o bundle antes de publicar')
})

test('só o staging passa token e ref para conferir as migrations aplicadas', async () => {
  const staging = await readWorkflow('cloudflare-pages-staging.yml')
  const production = await readWorkflow('cloudflare-pages-production.yml')
  const step = staging.slice(staging.indexOf("Wait for Supabase to apply this commit's migrations"), staging.indexOf('node scripts/wait-supabase-migrations.mjs'))
  assert.match(step, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_STAGING_ACCESS_TOKEN \}\}/)
  assert.match(step, /SUPABASE_PROJECT_REF: \$\{\{ vars\.SUPABASE_STAGING_PROJECT_REF \}\}/)
  assert.doesNotMatch(production, /SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF/)
})

test('staging embute a Site Key do Turnstile do environment, como a produção', async () => {
  const staging = await readWorkflow('cloudflare-pages-staging.yml')
  const production = await readWorkflow('cloudflare-pages-production.yml')
  const siteKey = 'VITE_TURNSTILE_SITE_KEY: ${{ vars.VITE_TURNSTILE_SITE_KEY }}'
  assert.equal((production.match(/VITE_TURNSTILE_SITE_KEY: \$\{\{ vars\.VITE_TURNSTILE_SITE_KEY \}\}/g) ?? []).length, 1)
  assert.equal((staging.match(/VITE_TURNSTILE_SITE_KEY: \$\{\{ vars\.VITE_TURNSTILE_SITE_KEY \}\}/g) ?? []).length, 1)
  const build = staging.indexOf('npm run cloudflare:build:sites')
  const key = staging.indexOf(siteKey)
  const deploy = staging.indexOf('wrangler pages deploy')
  assert.ok(build > 0 && key > build && key < deploy, 'a Site Key entra no build, antes de publicar')
  assert.match(staging, /Vela staging/)
  assert.doesNotMatch(staging, /Sem Turnstile/)
  assert.match(staging, /PRODUCTION_SUPABASE_PROJECT_REF: fgmkhbzhaeebrsizwccx/)
})
