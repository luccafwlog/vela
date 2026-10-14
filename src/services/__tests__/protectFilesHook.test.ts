// A4 (ADR 0083, item 4): o hook protege só a migration existente; criar uma
// migration nova é o caminho normal. database.ts e pix.ts seguem protegidos.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const hook = resolve(process.cwd(), '.claude/hooks/protect-files.sh')

function run(filePath: string, env: Record<string, string> = {}) {
  return spawnSync('bash', [hook], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_ALLOW_PROTECTED: '0', ...env },
  }).status
}

describe('.claude/hooks/protect-files.sh', () => {
  it('bloqueia migration existente e libera migration nova', () => {
    expect(run(resolve(process.cwd(), 'supabase/migrations/001_initial_schema.sql'))).toBe(2)
    expect(run(resolve(process.cwd(), 'supabase/migrations/999_migration_que_nao_existe.sql'))).toBe(0)
  })

  it('segue bloqueando os arquivos gerados e liberando o resto', () => {
    expect(run(resolve(process.cwd(), 'src/types/database.ts'))).toBe(2)
    expect(run(resolve(process.cwd(), 'src/lib/pix.ts'))).toBe(2)
    expect(run(resolve(process.cwd(), 'src/pages/Admin.tsx'))).toBe(0)
    expect(run(resolve(process.cwd(), 'src/types/database.ts'), { CLAUDE_ALLOW_PROTECTED: '1' })).toBe(0)
  })
})
