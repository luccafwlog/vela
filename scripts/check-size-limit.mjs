import { gzipSync } from 'node:zlib'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const distDirectory = path.resolve(process.cwd(), 'dist')
const limitBytes = 250 * 1024
const pages = ['index.html', 'portal.html']

function pageAssets(page) {
  const html = readFileSync(path.join(distDirectory, page), 'utf8')
  const references = [...html.matchAll(/(?:src|href)="(\/assets\/[^"']+\.js)"/g)]
    .map((match) => match[1])
  return [...new Set(references)]
}

let failed = false

for (const page of pages) {
  const assets = pageAssets(page)
  let gzipBytes = 0

  for (const asset of assets) {
    const file = path.join(distDirectory, asset.replace(/^\//, ''))
    if (!existsSync(file)) {
      console.error(`size-limit: asset ausente para ${page}: ${asset}`)
      failed = true
      continue
    }
    gzipBytes += gzipSync(readFileSync(file)).byteLength
  }

  const display = `${(gzipBytes / 1024).toFixed(2)} KiB gzip`
  console.log(`${page}: ${display} em ${assets.length} assets (limite ${(limitBytes / 1024).toFixed(0)} KiB)`)
  if (gzipBytes > limitBytes) {
    console.error(`size-limit: ${page} excede o limite em ${((gzipBytes - limitBytes) / 1024).toFixed(2)} KiB`)
    failed = true
  }
}

process.exitCode = failed ? 1 : 0
