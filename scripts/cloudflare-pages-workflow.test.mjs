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
