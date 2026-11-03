// Toda migration que reescreve ou apaga linhas existentes precisa justificar a
// perda no próprio cabeçalho. O que conta como justificativa depende da
// afirmação "Data status" do AGENTS.md vigente quando a migration foi escrita:
//
// - até a 061: histórico, a regra ainda não existia (não bloqueia);
// - 062 a 574: produção sem dados reais (afirmação de 2026-09-18). Bastava
//   declarar a dependência dessa afirmação, citando o AGENTS.md;
// - depois da 574: produção com dados reais desde 2026-11-03. Declarar a
//   dependência não vale mais; o cabeçalho traz um plano de preservação.
//
// Este script transforma a regra em porta de CI: sem a justificativa, o gate
// falha. Um hook do Claude Code não serviria: ele só vale para agentes rodando
// neste harness. Uma pessoa escrevendo a migration no editor, ou um agente de
// outra ferramenta, passaria direto. A checagem em CI vale para todo mundo.
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
  // Como comando, em qualquer posição (inclusive depois de BEGIN). O
  // privilégio (`REVOKE TRUNCATE ON`, `GRANT SELECT, TRUNCATE ON`) não apaga
  // linha nenhuma; comentários saem antes do teste (stripLineComments).
  { name: 'TRUNCATE', re: /\bTRUNCATE\b(?!\s*(?:,|ON\b))/i },
  { name: 'DROP TABLE', re: /\bDROP\s+TABLE\b/i },
  { name: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/i },
]

// Regra de 062 a 574: o cabeçalho nomeia a afirmação e o arquivo onde ela
// vive, para que o leitor consiga verificar se ainda estava vigente.
const DECLARATION = [/data\s+status/i, /AGENTS\.md/]

// Regra depois da 574: o cabeçalho traz `Plano de preservação:` seguido do
// plano (linhas afetadas, onde ficam os valores anteriores, como conferir e
// como desfazer).
// ponytail: o gate confere que o plano existe e tem corpo (PLAN_MIN_CHARS
// caracteres não brancos), não que ele preserva de fato. A adequação é da
// revisão; um teste local-pg que prove a preservação é o passo seguinte.
const PRESERVATION_PLAN = /plano\s+de\s+preserva[cç][aã]o\s*:/i
const PLAN_MIN_CHARS = 80

// A regra nasceu com a migration 061. As anteriores ja foram aplicadas e sao
// historico: reescrever o cabecalho delas nao muda nada no banco e apagaria o
// registro do que de fato foi executado. O gate vale daqui para frente; o
// relatorio abaixo continua contando as antigas, para que a divida fique
// visivel em vez de silenciosa.
const RULE_FROM = 61

// Última migration escrita sob a afirmação "sem dados reais" (2026-09-18 a
// 2026-11-03). As seguintes rodam sobre dados reais e precisam de plano.
export const DATA_STATUS_UNTIL = 574

/** Regra que vale para a migration de número `version`. */
export function ruleFor(version) {
  if (version <= RULE_FROM) return 'historica'
  if (version <= DATA_STATUS_UNTIL) return 'data-status'
  return 'plano'
}

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
    // 2000: assinaturas longas (11 parâmetros) passam de 400 caracteres até o `AS $$`.
    const precedingText = sql.slice(Math.max(0, match.index - 2000), match.index)
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

/** Remove comentários de linha (`-- ...`), que citam comandos sem executá-los. */
function stripLineComments(sql) {
  return sql.replace(/--[^\n]*/g, '')
}

/** Texto do plano de preservação no cabeçalho, sem os `--`; null se ausente. */
export function preservationPlan(header) {
  const match = PRESERVATION_PLAN.exec(header)
  if (!match) return null
  return header.slice(match.index + match[0].length).replace(/^--/gm, '').trim()
}

/**
 * `rule` vem de `ruleFor(versão)`. Sem ela, vale a regra atual ('plano'): quem
 * audita um SQL avulso recebe a exigência de hoje, não a de uma época passada.
 */
export function auditMigration(sql, { rule = 'plano' } = {}) {
  const body = stripLineComments(stripFunctionBodies(sql))
  const statements = DESTRUCTIVE.filter(({ re }) => re.test(body)).map(({ name }) => name)
  if (statements.length === 0) return { destructive: false, statements, declared: true }
  const header = headerComment(sql)
  const citesDataStatus = DECLARATION.every((re) => re.test(header))
  if (rule === 'plano') {
    const plan = preservationPlan(header)
    const planned = plan !== null && plan.replace(/\s/g, '').length >= PLAN_MIN_CHARS
    return { destructive: true, statements, declared: planned, citesDataStatus }
  }
  const declared = citesDataStatus
    || (rule === 'historica' && /data\s+status/i.test(header) && /CLAUDE\.md/i.test(header))
  return { destructive: true, statements, declared, citesDataStatus }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
  const versions = new Map()
  for (const name of files) {
    const version = /^(\d+)_/.exec(name)?.[1]
    if (!version) {
      console.error(`Nome de migration sem versão: ${name}`)
      process.exit(1)
    }
    const names = versions.get(version) ?? []
    names.push(name)
    versions.set(version, names)
  }
  const duplicates = [...versions].filter(([, names]) => names.length > 1)
  if (duplicates.length > 0) {
    console.error('Versões de migrations duplicadas (o Supabase identifica pelo prefixo):')
    for (const [version, names] of duplicates) console.error(`  ${version}: ${names.join(', ')}`)
    process.exit(1)
  }
  const offenders = []
  let destructiveCount = 0
  let legacyCount = 0
  for (const name of files) {
    const rule = ruleFor(Number.parseInt(/^(\d+)_/.exec(name)[1], 10))
    const result = auditMigration(fs.readFileSync(path.join(migrationsDir, name), 'utf8'), { rule })
    if (!result.destructive) continue
    destructiveCount++
    if (result.declared) continue
    if (rule === 'historica') {
      legacyCount++
      continue
    }
    offenders.push({ name, rule, statements: result.statements, citesDataStatus: result.citesDataStatus })
  }

  if (offenders.length > 0) {
    console.error('Migrations destrutivas sem a justificativa exigida no cabeçalho:\n')
    for (const { name, rule, statements, citesDataStatus } of offenders) {
      const falta = rule === 'plano'
        ? (citesDataStatus ? 'declara o "Data status" revogado em vez de um plano de preservação' : 'sem plano de preservação')
        : 'sem a declaração do "Data status"'
      console.error(`  ${name} — contém ${statements.join(', ')}; ${falta}`)
    }
    console.error(`
Produção tem dados reais desde 2026-11-03 (afirmação "Data status" do AGENTS.md,
seção Gotchas). Depois da ${String(DATA_STATUS_UNTIL).padStart(3, '0')}, declarar dependência da afirmação antiga não
autoriza perda de dados: a migration que reescreve ou apaga linhas traz no
cabeçalho a linha "Plano de preservação:" seguida do plano (linhas afetadas,
onde ficam os valores anteriores, como conferir e como desfazer). Formato em
WORKFLOW.md, "Migration que reescreve ou apaga dados".`)
    process.exit(1)
  }

  console.log(
    `Destructive migration check passed: ${files.length} migrations, ${destructiveCount} destrutiva(s); `
    + `${legacyCount} migration(s) até ${String(RULE_FROM).padStart(3, '0')} sem declaracao (historico, nao bloqueia); `
    + `plano de preservação exigido a partir da ${String(DATA_STATUS_UNTIL + 1).padStart(3, '0')}.`,
  )
}
