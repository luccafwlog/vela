// Toda migration que reescreve ou apaga linhas existentes depende da afirmação
// "Data status" do AGENTS.md (o banco de produção não tem dados de negócio).
// A regra exige que o arquivo declare essa dependência no próprio cabeçalho.
// Este script transforma a regra em porta de CI: sem a declaração, o gate falha.
//
// Um hook do Claude Code não serviria: ele só vale para agentes rodando neste
// harness. Uma pessoa escrevendo a migration no editor, ou um agente de outra
// ferramenta, passaria direto. A checagem em CI vale para todo mundo.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const migrationsDir = path.join(root, 'supabase', 'migrations')

// Statements que reescrevem ou apagam dados já gravados. CREATE/INSERT ficam
// de fora: uma migration aditiva não depende da afirmação.
const DESTRUCTIVE = [
  { name: 'UPDATE', re: /\bUPDATE\s+(?:public\.)?[a-z_][a-z0-9_]*\s+SET\b/i },
  { name: 'DELETE FROM', re: /\bDELETE\s+FROM\b/i },
  { name: 'TRUNCATE', re: /\bTRUNCATE\b/i },
  { name: 'DROP TABLE', re: /\bDROP\s+TABLE\b/i },
  { name: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/i },
]

// O cabeçalho precisa nomear a afirmação e o arquivo onde ela vive, para que o
// leitor consiga verificar se ainda está vigente.
const DECLARATION = [/data\s+status/i, /AGENTS\.md/]

// A regra nasceu com a migration 061. As anteriores ja foram aplicadas e sao
// historico: reescrever o cabecalho delas nao muda nada no banco e apagaria o
// registro do que de fato foi executado. O gate vale daqui para frente; o
// relatorio abaixo continua contando as antigas, para que a divida fique
// visivel em vez de silenciosa.
const RULE_FROM = 61

/**
 * Remove corpos de função/procedure (dollar-quoted). Um UPDATE dentro de um
 * `CREATE FUNCTION` é código que roda depois, a pedido da aplicação -- não uma
 * reescrita de dados no momento em que a migration e aplicada. Blocos `DO`
 * PERMANECEM: esses sim executam durante o deploy.
 */
export function stripFunctionBodies(sql) {
  let out = ''
  let i = 0
  while (i < sql.length) {
    // `g`, não `y`: precisamos procurar a próxima abertura adiante, não exigir
    // que ela esteja exatamente em `i`.
    const open = /\$([a-z_][a-z0-9_]*)?\$/gi
    open.lastIndex = i
    const match = open.exec(sql)
    if (!match) {
      out += sql.slice(i)
      break
    }
    out += sql.slice(i, match.index)
    const tag = match[0]
    const close = sql.indexOf(tag, match.index + tag.length)
    const end = close === -1 ? sql.length : close + tag.length
    const precedingText = sql.slice(Math.max(0, match.index - 400), match.index)
    const isFunctionBody = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i.test(precedingText)
      && !/\bDO\s*$/i.test(precedingText.trimEnd())
    if (!isFunctionBody) out += sql.slice(match.index, end)
    i = end
  }
  return out
}

/** Comentários `--` antes do primeiro statement. É onde a declaração deve estar. */
export function headerComment(sql) {
  const lines = []
  for (const line of sql.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('--')) lines.push(trimmed)
    else break
  }
  return lines.join('\n')
}

export function auditMigration(sql, { legacy = false } = {}) {
  const body = stripFunctionBodies(sql)
  const statements = DESTRUCTIVE.filter(({ re }) => re.test(body)).map(({ name }) => name)
  if (statements.length === 0) return { destructive: false, statements, declared: true }
  const header = headerComment(sql)
  const declared = DECLARATION.every((re) => re.test(header))
    || (legacy && /data\s+status/i.test(header) && /CLAUDE\.md/i.test(header))
  return { destructive: true, statements, declared }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
  const offenders = []
  let destructiveCount = 0
  let legacyCount = 0
  for (const name of files) {
    const result = auditMigration(fs.readFileSync(path.join(migrationsDir, name), 'utf8'), {
      legacy: Number.parseInt(name.slice(0, 3), 10) <= RULE_FROM,
    })
    if (!result.destructive) continue
    destructiveCount++
    if (result.declared) continue
    if (Number.parseInt(name.slice(0, 3), 10) <= RULE_FROM) {
      legacyCount++
      continue
    }
    offenders.push({ name, statements: result.statements })
  }

  if (offenders.length > 0) {
    console.error('Migrations destrutivas sem a declaração exigida no cabeçalho:\n')
    for (const { name, statements } of offenders) {
      console.error(`  ${name} — contém ${statements.join(', ')}`)
    }
    console.error(`
Toda migration que reescreve ou apaga linhas existentes depende da afirmação
"Data status" do AGENTS.md (seção Gotchas) e precisa dizer isso no cabeçalho,
citando o nome da afirmação e o AGENTS.md. Exemplo em
supabase/migrations/061_bl_weight_semantics_and_triggers.sql.

Se a afirmação já tiver sido revogada, a migration não é aceitável como está:
escreva um plano de preservação em vez de declarar a dependência.`)
    process.exit(1)
  }

  console.log(
    `Destructive migration check passed: ${files.length} migrations, ${destructiveCount} destrutiva(s); `
    + `${legacyCount} migration(s) até ${String(RULE_FROM).padStart(3, '0')} sem declaracao (historico, nao bloqueia).`,
  )
}
