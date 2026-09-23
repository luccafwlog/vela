import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { stagePagesSite } from './cloudflare-pages-stage.mjs'

test('stages separate internal and Portal Pages sites with SPA routing and security headers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vela-pages-stage-'))
  const input = path.join(root, 'dist')
  const internalOutput = path.join(input, 'pages-internal')
  const portalOutput = path.join(input, 'pages-portal')
  await mkdir(path.join(input, 'assets'), { recursive: true })
  await mkdir(path.join(input, 'branding'), { recursive: true })
  await mkdir(path.join(input, 'fonts'), { recursive: true })
  await mkdir(path.join(input, 'templates'), { recursive: true })
  await writeFile(path.join(input, 'index.html'), '<html>internal</html>')
  await writeFile(path.join(input, 'portal.html'), '<html>portal</html>')
  await writeFile(path.join(input, 'assets', 'app.js'), 'bundle')
  await writeFile(path.join(input, 'assets', 'app.js.map'), '{"sources":["../../src/main.tsx"]}')
  await writeFile(path.join(input, 'branding', 'logo.svg'), '<svg/>')
  await writeFile(path.join(input, 'fonts', 'app.woff2'), 'font')
  await writeFile(path.join(input, 'templates', 'report.html'), 'template')
  await writeFile(path.join(input, 'favicon.svg'), '<svg/>')

  try {
    await stagePagesSite({ app: 'internal', input, output: internalOutput })
    assert.equal(await readFile(path.join(internalOutput, 'index.html'), 'utf8'), '<html>internal</html>')
    assert.equal(await readFile(path.join(internalOutput, 'assets', 'app.js'), 'utf8'), 'bundle')
    await assert.rejects(readFile(path.join(internalOutput, 'assets', 'app.js.map')), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(internalOutput, 'branding', 'logo.svg'), 'utf8'), '<svg/>')
    assert.equal(await readFile(path.join(internalOutput, 'fonts', 'app.woff2'), 'utf8'), 'font')
    assert.equal(await readFile(path.join(internalOutput, 'templates', 'report.html'), 'utf8'), 'template')
    assert.equal(await readFile(path.join(internalOutput, 'favicon.svg'), 'utf8'), '<svg/>')
    const internalRedirects = await readFile(path.join(internalOutput, '_redirects'), 'utf8')
    assert.match(internalRedirects, /^\/portal\s+https:\/\/portalfwlog\.com\.br\/portal\s+302/m)
    assert.match(internalRedirects, /^\/portal\/\*\s+https:\/\/portalfwlog\.com\.br\/portal\/:splat\s+302/m)

    await stagePagesSite({
      app: 'internal',
      input,
      output: internalOutput,
      portalOrigin: 'https://pr-123.vela-portal.pages.dev',
    })
    const previewRedirects = await readFile(path.join(internalOutput, '_redirects'), 'utf8')
    assert.match(previewRedirects, /^\/portal\s+https:\/\/pr-123\.vela-portal\.pages\.dev\/portal\s+302/m)
    assert.match(previewRedirects, /^\/portal\/\*\s+https:\/\/pr-123\.vela-portal\.pages\.dev\/portal\/:splat\s+302/m)

    const headers = await readFile(path.join(internalOutput, '_headers'), 'utf8')
    for (const header of ['Content-Security-Policy:', 'X-Frame-Options: DENY', 'Strict-Transport-Security:', 'Cache-Control: public, max-age=31536000, immutable']) {
      assert.ok(headers.includes(header), `missing ${header}`)
    }
    assert.match(headers, /^\/index\.html\s*\n(?:  .*\n)*  Cache-Control: no-cache, no-store, must-revalidate/m)

    await stagePagesSite({ app: 'portal', input, output: portalOutput })
    assert.equal(await readFile(path.join(portalOutput, 'index.html'), 'utf8'), '<html>portal</html>')
    const portalRedirects = await readFile(path.join(portalOutput, '_redirects'), 'utf8')
    assert.match(portalRedirects, /^\/\s+\/portal\s+302/m)
    assert.match(portalRedirects, /^\/\*\s+\/index\.html\s+200/m)
    assert.deepEqual((await readdir(portalOutput)).sort(), ['_headers', '_redirects', 'assets', 'branding', 'favicon.svg', 'fonts', 'index.html', 'templates'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects invalid app names and missing entrypoints', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vela-pages-stage-'))
  const input = path.join(root, 'dist')
  try {
    await assert.rejects(stagePagesSite({ app: 'other', input: root, output: path.join(root, 'pages-other') }), /app must be internal or portal/i)
    await assert.rejects(stagePagesSite({ app: 'internal', input, output: path.join(input, 'pages-internal') }), /index\.html/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects Portal redirect origins outside the production domain and Pages preview domain', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vela-pages-stage-'))
  const input = path.join(root, 'dist')
  const output = path.join(input, 'pages-internal')
  await mkdir(input, { recursive: true })
  await writeFile(path.join(input, 'index.html'), '<html>internal</html>')
  await mkdir(output, { recursive: true })
  await writeFile(path.join(output, 'keep.txt'), 'existing output')
  try {
    await assert.rejects(
      stagePagesSite({
        app: 'internal',
        input,
        output,
        portalOrigin: 'https://attacker.example',
      }),
      /production Portal domain or a Cloudflare Pages Portal preview origin/i,
    )
    assert.equal(await readFile(path.join(output, 'keep.txt'), 'utf8'), 'existing output')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
