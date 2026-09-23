import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeCloudflarePreviewOutputs } from './cloudflare-preview-env.mjs'

test('exports only the matching branch URL and public key, never its database secret', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-preview-env-'))
  const output = path.join(directory, 'github-output')
  const cliEnv = [
    'SUPABASE_URL="https://branch-ref.supabase.co"',
    'SUPABASE_ANON_KEY="public-anon-key"',
    'SUPABASE_DB_URL="postgres://private-database-secret"',
  ].join('\n')
  try {
    await writeCloudflarePreviewOutputs({ cliEnv, productionProjectRef: 'fgmkhbzhaeebrsizwccx', outputFile: output })
    const result = await readFile(output, 'utf8')
    assert.match(result, /supabase_url<<[^\n]+\nhttps:\/\/branch-ref\.supabase\.co/)
    assert.match(result, /supabase_anon_key<<[^\n]+\npublic-anon-key/)
    assert.ok(!result.includes('private-database-secret'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects missing branch credentials and a production URL', async () => {
  await assert.rejects(
    writeCloudflarePreviewOutputs({ cliEnv: 'SUPABASE_URL="https://branch-ref.supabase.co"', productionProjectRef: 'fgmkhbzhaeebrsizwccx', outputFile: 'unused' }),
    /public key/i,
  )
  await assert.rejects(
    writeCloudflarePreviewOutputs({
      cliEnv: 'SUPABASE_URL="https://fgmkhbzhaeebrsizwccx.supabase.co"\nSUPABASE_ANON_KEY="prod-anon-key"',
      productionProjectRef: 'fgmkhbzhaeebrsizwccx',
      outputFile: 'unused',
    }),
    /production/i,
  )
})

test('rejects multiline public keys before writing GitHub outputs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-preview-env-'))
  const output = path.join(directory, 'github-output')
  await writeFile(output, '')
  try {
    await assert.rejects(
      writeCloudflarePreviewOutputs({
        cliEnv: 'SUPABASE_URL="https://branch-ref.supabase.co"\nSUPABASE_ANON_KEY="line1\\nline2"',
        productionProjectRef: 'fgmkhbzhaeebrsizwccx',
        outputFile: output,
      }),
      /single-line/i,
    )
    assert.equal(await readFile(output, 'utf8'), '')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
