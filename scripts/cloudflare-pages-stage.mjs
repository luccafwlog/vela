import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SECURITY_HEADERS = `  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://olinda.bcb.gov.br https://*.ingest.us.sentry.io https://eu.i.posthog.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'
`

function headersFile() {
  return `/*\n${SECURITY_HEADERS}\n/index.html\n  Cache-Control: no-cache, no-store, must-revalidate\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`
}

function redirectsFile(app, portalOrigin) {
  if (app === 'internal') {
    return `/portal ${portalOrigin}/portal 302\n/portal/* ${portalOrigin}/portal/:splat 302\n`
  }
  return `/ /portal 302\n/* /index.html 200\n`
}

function resolvePortalOrigin(value) {
  const portalOrigin = value?.trim() || 'https://portalfwlog.com.br'
  let parsed
  try {
    parsed = new URL(portalOrigin)
  } catch {
    throw new Error('Portal origin must be a valid HTTPS origin')
  }
  const allowedHost = parsed.hostname === 'portalfwlog.com.br' || /^[a-z0-9-]+\.vela-portal\.pages\.dev$/.test(parsed.hostname)
  if (
    parsed.protocol !== 'https:' || parsed.username || parsed.password ||
    parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash || !allowedHost
  ) {
    throw new Error('Portal origin must be the production Portal domain or a Cloudflare Pages Portal preview origin')
  }
  return parsed.origin
}

async function copyPublicFiles(source, destination, rootLevel = false) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (
      entry.name.endsWith('.map') ||
      (rootLevel && (entry.name === '.vite' || entry.name.startsWith('pages-'))) ||
      (rootLevel && entry.isFile() && entry.name.endsWith('.html'))
    ) continue
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      await mkdir(destinationPath, { recursive: true })
      await copyPublicFiles(sourcePath, destinationPath)
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath)
    }
  }
}

export async function stagePagesSite({ app, input, output, portalOrigin }) {
  if (app !== 'internal' && app !== 'portal') {
    throw new Error('app must be internal or portal')
  }
  const resolvedPortalOrigin = resolvePortalOrigin(portalOrigin)

  const inputDir = path.resolve(input)
  const outputDir = path.resolve(output)
  if (
    path.dirname(outputDir) !== inputDir ||
    path.basename(outputDir) !== `pages-${app}`
  ) {
    throw new Error(`output must be the child directory pages-${app} inside input`)
  }

  const entrypoint = app === 'internal' ? 'index.html' : 'portal.html'
  const sourceEntry = path.join(inputDir, entrypoint)
  let html
  try {
    html = await readFile(sourceEntry)
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`missing ${entrypoint} in build output`)
    throw error
  }

  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  await writeFile(path.join(outputDir, 'index.html'), html)

  await copyPublicFiles(inputDir, outputDir, true)

  await writeFile(path.join(outputDir, '_headers'), headersFile())
  await writeFile(path.join(outputDir, '_redirects'), redirectsFile(app, resolvedPortalOrigin))
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [, , app, input = 'dist', output = `dist/pages-${app}`] = process.argv
  try {
    await stagePagesSite({ app, input, output, portalOrigin: process.env.CLOUDFLARE_PORTAL_ORIGIN })
  } catch (error) {
    console.error(`[cloudflare-pages-stage] ${error.message}`)
    process.exitCode = 1
  }
}
