import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

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

test('jobs com token declaram o environment restrito a main (auditoria run-2, #14)', async () => {
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
})

test('actions dos workflows com token fixadas por SHA', async () => {
  for (const name of ['cloudflare-pages-preview.yml', 'cloudflare-pages-preview-cleanup.yml', 'provision-preview-admin.yml', 'cloudflare-pages-production.yml', 'cloudflare-pages-provision.yml']) {
    for (const [, ref] of (await readWorkflow(name)).matchAll(/uses: [\w./-]+@(\S+)/g)) {
      assert.match(ref, /^[0-9a-f]{40}$/, `${name} usa ${ref}`)
    }
  }
})

test('publish recusa Pages Functions vindas do build da PR', () => {
  const publish = jobBlock('publish')
  assert.match(publish, /_worker\.js/)
  assert.ok(publish.indexOf('_worker.js') < publish.indexOf('Publish Vela preview'))
})
