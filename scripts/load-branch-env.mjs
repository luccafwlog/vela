import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Decodifica a saída `KEY="valor"` do `supabase branches get -o env` e anexa
// ao $GITHUB_ENV sem as aspas literais do formato dotenv.
//
// Contexto: o `-o env` do Supabase CLI emite cada linha como `KEY="VALUE"`
// (valores entre aspas duplas, com escapes). O arquivo $GITHUB_ENV, porém,
// espera `KEY=VALUE` cru — ele não remove aspas. Anexar a saída do CLI sem
// decodificar deixava cada credencial com aspas literais no valor (ex.:
// SUPABASE_URL valia `"https://<ref>.supabase.co"`), e o provisionamento da
// Preview quebrava em `Invalid supabaseUrl` antes de criar o qa-admin.
//
// Uso no workflow: `supabase ... branches get ... -o env | node scripts/load-branch-env.mjs`

const DELIMITER = 'LOAD_BRANCH_ENV_EOF'

export function decodeEnvLine(line) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s)
  if (!match) throw new Error(`Linha inesperada do CLI, abortando: ${line}`)
  const [, name, raw] = match
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return [name, JSON.parse(raw)]
    } catch {
      throw new Error(`Valor com aspas inválidas para ${name}, abortando.`)
    }
  }
  return [name, raw]
}

export function decodeEnvDocument(text) {
  const entries = []
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    entries.push(decodeEnvLine(line))
  }
  return entries
}

function toGithubEnvBody(entries) {
  return (
    entries.map(([name, value]) => {
      if (value.split('\n').includes(DELIMITER)) {
        throw new Error(`Valor de ${name} colide com o delimitador interno, abortando.`)
      }
      return `${name}<<${DELIMITER}\n${value}\n${DELIMITER}`
    }).join('\n') + '\n'
  )
}

// Credenciais da branch (service role, JWT secret, senha do banco) entram no
// log mascaradas antes de qualquer step poder imprimi-las (auditoria run-2).
export function maskCommands(entries) {
  return entries
    .filter(([, value]) => value.trim().length >= 8)
    .flatMap(([, value]) => value.split('\n').filter((line) => line.trim()).map((line) => `::add-mask::${line}`))
}

function main() {
  const githubEnv = process.env.GITHUB_ENV
  if (!githubEnv) throw new Error('GITHUB_ENV ausente: rode dentro do GitHub Actions.')
  const entries = decodeEnvDocument(readFileSync(0, 'utf8'))
  if (entries.length === 0) throw new Error('O CLI não devolveu nenhuma variável; abortando.')
  for (const command of maskCommands(entries)) console.log(command)
  appendFileSync(githubEnv, toGithubEnvBody(entries))
  console.log(`Credenciais da branch carregadas: ${entries.map(([name]) => name).join(', ')}`)
}

// Comparação por caminho resolvido (não por concatenação de `file://`):
// a forma ingênua falha no Windows, onde argv usa `\` e a file URL usa `/`.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
