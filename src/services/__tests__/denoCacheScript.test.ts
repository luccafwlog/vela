import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// scripts/deno-cache.sh (passos Deno do CI): o esm.sh serve dois builds
// conferidos do tslib, e o script troca para a cópia do lock com o hash do
// outro build. Revisão da release #1117: se a borda servia o outro build só
// na 3ª tentativa, o script saía com erro sem tentar a cópia. Aqui o `npx` é
// simulado; nada é baixado.
const script = resolve(__dirname, '../../../scripts/deno-cache.sh')
const URL = 'https://esm.sh/tslib@2.8.1/denonext/tslib.mjs'
const LOCK_HASH = 'c38da5dd6da6281964435002ce204cd586634fe3bdfb24a0ee116f48cf3292e9'
const OTHER_HASH = 'ebce3cd5facb654623020337f867b426ba95f71596ba87acc9e6c6f4e55905ca'

let dir = ''

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

/** Roda o script com um `npx` que responde, a cada chamada, o passo da lista. */
function run(steps: Array<'rede' | 'outro-build' | 'ok'>) {
  dir = mkdtempSync(join(tmpdir(), 'deno-cache-'))
  const lock = join(dir, 'deno.lock')
  writeFileSync(lock, JSON.stringify({ remote: { [URL]: LOCK_HASH } }))
  writeFileSync(join(dir, 'steps'), steps.join('\n'))
  writeFileSync(join(dir, 'npx'), `#!/usr/bin/env bash
n=$(( $(cat "${dir}/count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "${dir}/count"
step=$(sed -n "\${n}p" "${dir}/steps")
for arg in "$@"; do case "$arg" in --lock=*) cp "\${arg#--lock=}" "${dir}/lock-$n";; esac; done
case "$step" in
  ok) exit 0 ;;
  outro-build) printf 'error: Integrity check failed\\n  Specifier: ${URL}\\n  Actual: ${OTHER_HASH}\\n  Expected: ${LOCK_HASH}\\n'; exit 1 ;;
  *) echo 'error: connection reset'; exit 1 ;;
esac
`)
  chmodSync(join(dir, 'npx'), 0o755)
  const result = spawnSync('bash', [script, lock, '--no-config', 'index.ts'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DENO_CACHE_RETRY_DELAY: '0' },
  })
  const calls = Number(readFileSync(join(dir, 'count'), 'utf8'))
  return { status: result.status, lockUsed: result.stdout.trim(), calls, lockOf: (call: number) => readFileSync(join(dir, `lock-${call}`), 'utf8') }
}

describe('scripts/deno-cache.sh', () => {
  it('o outro build conferido na 3ª tentativa ainda usa a cópia do lock', () => {
    const result = run(['rede', 'rede', 'outro-build', 'ok'])
    expect(result.status).toBe(0)
    expect(result.calls).toBe(4)
    expect(result.lockOf(4)).toContain(OTHER_HASH)
    expect(readFileSync(result.lockUsed, 'utf8')).toContain(OTHER_HASH)
  })

  it('três falhas de rede encerram com erro', () => {
    const result = run(['rede', 'rede', 'rede', 'ok'])
    expect(result.status).toBe(1)
    expect(result.calls).toBe(3)
  })

  it('a borda alternando os builds não prende o script em laço', () => {
    const result = run(Array.from({ length: 10 }, () => 'outro-build' as const))
    expect(result.status).toBe(1)
    expect(result.calls).toBeLessThanOrEqual(6)
  })
})
