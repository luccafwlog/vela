import { appendFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeEnvDocument } from './load-branch-env.mjs'

export function selectCloudflarePreviewEnv(cliEnv, productionProjectRef) {
  const productionRef = productionProjectRef?.trim().toLowerCase()
  if (!productionRef) throw new Error('production project ref is required to reject production credentials')

  const entries = new Map(decodeEnvDocument(cliEnv))
  const url = entries.get('SUPABASE_URL')?.trim()
  const anonKey = entries.get('SUPABASE_ANON_KEY')?.trim() || entries.get('SUPABASE_PUBLISHABLE_KEY')?.trim()
  if (!url) throw new Error('Supabase branch URL is missing')
  if (!anonKey) throw new Error('Supabase branch public key is missing')

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Supabase branch URL is invalid')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Supabase branch URL must be an HTTPS endpoint without embedded credentials')
  }
  if (parsed.hostname.split('.').includes(productionRef)) {
    throw new Error('Refusing to build a preview with the production Supabase URL')
  }
  if (/\r|\n/.test(anonKey)) throw new Error('Supabase branch public key must be a single-line value')

  return { url: parsed.origin, anonKey }
}

export async function writeCloudflarePreviewOutputs({ cliEnv, productionProjectRef, outputFile }) {
  if (!outputFile?.trim()) throw new Error('GitHub Actions output file is required')
  const { url, anonKey } = selectCloudflarePreviewEnv(cliEnv, productionProjectRef)
  const delimiter = `CF_PREVIEW_${randomUUID().replaceAll('-', '')}`
  const output = [
    `supabase_url<<${delimiter}\n${url}\n${delimiter}`,
    // GitHub Actions suppresses job outputs that match a secret value. Encode
    // this public browser key in transit and decode it only in the build job.
    `supabase_anon_key_b64<<${delimiter}\n${Buffer.from(anonKey, 'utf8').toString('base64')}\n${delimiter}`,
    '',
  ].join('\n')
  await appendFile(outputFile, output, { encoding: 'utf8', flag: 'a' })
}

function main() {
  const outputFile = process.env.GITHUB_OUTPUT
  if (!outputFile) throw new Error('GITHUB_OUTPUT ausente: rode dentro do GitHub Actions.')
  const productionProjectRef = process.env.PRODUCTION_SUPABASE_PROJECT_REF
  const cliEnv = readFileSync(0, 'utf8')
  const { url } = selectCloudflarePreviewEnv(cliEnv, productionProjectRef)
  return writeCloudflarePreviewOutputs({ cliEnv, productionProjectRef, outputFile })
    .then(() => console.log(`Public Supabase preview endpoint selected: ${url}`))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
