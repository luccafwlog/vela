#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(scriptDir, '../..')

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    homeDir: os.homedir(),
    format: 'markdown',
    output: null,
    markers: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--repo-root') options.repoRoot = path.resolve(argv[++index])
    else if (argument === '--home') options.homeDir = path.resolve(argv[++index])
    else if (argument === '--output') options.output = path.resolve(argv[++index])
    else if (argument === '--format') options.format = argv[++index]
    else if (argument === '--marker') options.markers.push(argv[++index])
    else if (argument === '--help' || argument === '-h') {
      console.log(`Usage: node scripts/skills/report-skill-usage.mjs [options]

Options:
  --repo-root <path>  Vela clone root (default: inferred from this script)
  --home <path>       Home directory containing local app histories
  --marker <value>    Additional project marker; repeatable
  --format markdown|json
  --output <path>     Write the aggregate report to a file
`)
      return null
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (!['markdown', 'json'].includes(options.format)) throw new Error(`Unsupported format: ${options.format}`)
  return options
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readSkillNames(repoRoot) {
  return fs.readdirSync(path.join(repoRoot, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(repoRoot, 'skills', entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort()
}

function repositoryMarkers(repoRoot, additionalMarkers = []) {
  const markers = new Set([path.resolve(repoRoot), ...additionalMarkers.filter(Boolean)])
  try {
    const remote = execFileSync(
      'git',
      ['-C', repoRoot, 'config', '--get', 'remote.origin.url'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    if (remote) {
      markers.add(remote)
      markers.add(remote.replace(/\.git$/u, ''))
      markers.add(remote.replace(/^git@([^:]+):/u, 'https://$1/').replace(/\.git$/u, ''))
    }
  } catch {
    // A clone without a remote remains searchable by its absolute repository path.
  }
  return [...markers].sort()
}

function collectFiles(root, extensions = ['.jsonl']) {
  if (!fs.existsSync(root)) return []
  const files = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(absolutePath)
      else if (extensions.includes(path.extname(entry.name))) files.push(absolutePath)
    }
  }
  walk(root)
  return files.sort()
}

function collectFilesContainingMarkers(root, markers) {
  return collectFiles(root).filter((file) => {
    try {
      const contents = fs.readFileSync(file, 'utf8')
      return markers.some((marker) => contents.includes(marker))
    } catch {
      return false
    }
  })
}

function collectProjectFiles(root, markers) {
  if (!fs.existsSync(root)) return []
  if (markers.length === 0) return []
  try {
    const expression = markers.flatMap((marker) => ['-e', marker])
    const output = execFileSync(
      'rg',
      ['-l', '--hidden', '--glob', '*.jsonl', ...expression, root],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    return output.split('\n').filter(Boolean).sort()
  } catch (error) {
    if (error?.status === 1) return []
    if (error?.code === 'ENOENT') return collectFilesContainingMarkers(root, markers)
    throw new Error(`Could not scope history at ${root}: ${error instanceof Error ? error.message : error}`)
  }
}

function makeStats(skillNames) {
  return Object.fromEntries(skillNames.map((name) => [name, {
    explicitPrompts: 0,
    explicitByApp: {},
    explicitEventKeys: new Set(),
    mentionPrompts: 0,
    mentionByApp: {},
    mentionEventKeys: new Set(),
    technicalEvidence: 0,
    technicalByApp: {},
    technicalSessionKeys: new Set(),
    sessions: new Set(),
    lastExplicit: null,
    lastTechnical: null,
  }]))
}

function textValues(value, output = []) {
  if (typeof value === 'string') {
    output.push(value)
    return output
  }
  if (!value || typeof value !== 'object') return output
  if (Array.isArray(value)) {
    for (const child of value) textValues(child, output)
    return output
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'encrypted_content' || key === 'internal_chat_message_metadata_passthrough') continue
    textValues(child, output)
  }
  return output
}

function messageText(record, app) {
  if (app === 'claude') {
    if (!['user', 'assistant'].includes(record.type)) return null
    return textValues(record.message?.content ?? record.message ?? {}).join('\n')
  }

  if (app === 'codex' || app === 't3') {
    if (record.type !== 'response_item') return null
    const payload = record.payload ?? {}
    if (!['user', 'assistant'].includes(payload.role)) return null
    return textValues(payload.content ?? payload).join('\n')
  }

  if (app === 'antigravity') {
    if (!['USER_INPUT', 'GENERIC', 'PLANNER_RESPONSE'].includes(record.type)) return null
    return textValues(record.content ?? record.tool_calls ?? record).join('\n')
  }

  return null
}

function actor(record, app) {
  if (app === 'claude') return record.type === 'user' ? 'user' : record.type === 'assistant' ? 'assistant' : null
  if (app === 'codex' || app === 't3') return record.type === 'response_item' ? record.payload?.role : null
  if (app === 'antigravity') return record.type === 'USER_INPUT' ? 'user' : record.type === 'PLANNER_RESPONSE' || record.type === 'GENERIC' ? 'assistant' : null
  return null
}

function eventTimestamp(record, app) {
  const value = app === 'antigravity'
    ? record.created_at
    : record.timestamp
  if (!value) return null
  const date = new Date(typeof value === 'number' && value < 10 ** 12 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function eventSession(record, file, app) {
  if (app === 'claude') return record.sessionId ?? path.basename(file)
  if (app === 'codex' || app === 't3') return path.basename(file)
  if (app === 'antigravity') return file.split(`${path.sep}.system_generated`)[0] ?? path.basename(file)
  return path.basename(file)
}

function normaliseEventText(text) {
  return text.replace(/\s+/gu, ' ').trim()
}

function eventKey(app, session, timestamp, text) {
  const identity = normaliseEventText(text)
  return `${timestamp ?? `${app}:${session}`}:${identity}`
}

function isSlashInvocation(text, name) {
  const token = `/${name}`
  let offset = 0
  while (true) {
    const index = text.indexOf(token, offset)
    if (index < 0) return false
    const before = text.slice(Math.max(0, index - 20), index)
    const after = text[index + token.length]
    const validBoundary = !after || /[\s.,!?;:)\]}>'"`]/u.test(after)
    const isPath = /(?:skills|\.claude|\.agents|\.codex|\.gemini)\/$/u.test(before)
    if (validBoundary && !isPath) return true
    offset = index + token.length
  }
}

function isExplicitSkillRequest(text, name) {
  const escaped = escapeRegExp(name)
  const requestPattern = new RegExp(
    `(?:use|usar|invoke|invocar|run|rodar|call|chamar|ativar|activate)\\s+(?:(?:the|a|an|skill|a\\s+skill|the\\s+skill|uma\\s+skill)\\s+)?["']?${escaped}(?=$|[\\s.,!?;:)\\]}>'"'])`,
    'iu',
  )
  return isSlashInvocation(text, name) || requestPattern.test(text)
}

function containsSkill(text, name) {
  return new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`, 'iu').test(text)
}

function hasTechnicalEvidence(text, name) {
  const escaped = escapeRegExp(name)
  return new RegExp(`(?:skills|\\.agents/skills|\\.claude/skills|\\.codex/skills|\\.gemini/skills|\\.gemini/config/skills)/${escaped}/SKILL\\.md`, 'iu').test(text)
}

function recordMatches(stats, names, text, app, role, timestamp, session) {
  if (!text) return
  const identity = role === 'user' ? eventKey(app, session, timestamp, text) : null
  for (const name of names) {
    const skill = stats[name]
    if (!skill) continue

    if (role === 'user' && isExplicitSkillRequest(text, name)) {
      if (!skill.explicitEventKeys.has(identity)) {
        skill.explicitEventKeys.add(identity)
        skill.explicitPrompts += 1
        skill.explicitByApp[app] = (skill.explicitByApp[app] ?? 0) + 1
      }
      skill.sessions.add(session)
      if (!skill.lastExplicit || (timestamp && timestamp > skill.lastExplicit)) skill.lastExplicit = timestamp
    } else if (role === 'user' && containsSkill(text, name)) {
      if (!skill.mentionEventKeys.has(identity)) {
        skill.mentionEventKeys.add(identity)
        skill.mentionPrompts += 1
        skill.mentionByApp[app] = (skill.mentionByApp[app] ?? 0) + 1
      }
    }

    if (role === 'assistant' && hasTechnicalEvidence(text, name)) {
      const technicalSessionKey = `${app}:${session}`
      if (!skill.technicalSessionKeys.has(technicalSessionKey)) {
        skill.technicalSessionKeys.add(technicalSessionKey)
        skill.technicalEvidence += 1
        skill.technicalByApp[app] = (skill.technicalByApp[app] ?? 0) + 1
      }
      if (!skill.lastTechnical || (timestamp && timestamp > skill.lastTechnical)) skill.lastTechnical = timestamp
    }
  }
}

async function scanFile(file, app, stats, names, counters) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' })
  const reader = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of reader) {
      if (!line.trim()) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        counters.invalidLines += 1
        continue
      }
      counters.events += 1
      const role = actor(record, app)
      if (!role) continue
      const text = messageText(record, app)
      const timestamp = eventTimestamp(record, app)
      const session = eventSession(record, file, app)
      recordMatches(stats, names, text, app, role, timestamp, session)
    }
  } finally {
    reader.close()
    stream.destroy()
  }
}

function detectCodexSourceApp(file) {
  const descriptor = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(128 * 1024)
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0)
    for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n').slice(0, 40)) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line)
        if (record.type !== 'session_meta') continue
        const originator = String(record.payload?.originator ?? record.originator ?? '').toLowerCase()
        return originator.includes('t3') ? 't3' : 'codex'
      } catch {
        // Continue until the session metadata appears.
      }
    }
  } finally {
    fs.closeSync(descriptor)
  }
  return 'codex'
}

function appInputFiles(homeDir, markers) {
  return {
    claude: collectProjectFiles(path.join(homeDir, '.claude', 'projects'), markers),
    codex: collectProjectFiles(path.join(homeDir, '.codex'), markers),
    antigravity: canonicaliseAntigravityFiles(collectProjectFiles(path.join(homeDir, '.gemini', 'antigravity', 'brain'), markers)),
  }
}

function sqliteRows(database, query) {
  if (!fs.existsSync(database)) return null
  try {
    const output = execFileSync('sqlite3', ['-json', database, query], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    })
    return output.trim() ? JSON.parse(output) : []
  } catch {
    return null
  }
}

function sqlLikeMarkers(column, markers) {
  return markers
    .map((marker) => `${column} LIKE '%${marker.replaceAll("'", "''")}%'`)
    .join(' OR ')
}

function scanOpenCodeDatabase(homeDir, stats, names, counters, markers) {
  const database = path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db')
  if (!fs.existsSync(database)) return false

  const rows = sqliteRows(database, `
    SELECT
      s.id AS session_id,
      m.id AS message_id,
      json_extract(m.data, '$.role') AS role,
      m.time_created AS timestamp,
      p.time_created AS part_timestamp,
      p.data AS part_data
    FROM message m
    JOIN part p ON p.message_id = m.id
    JOIN session s ON s.id = m.session_id
    WHERE ${sqlLikeMarkers('s.directory', markers)}
    ORDER BY m.time_created, p.time_created
  `)
  if (!rows) return false

  const messages = new Map()
  for (const row of rows) {
    let part
    try {
      part = JSON.parse(row.part_data)
    } catch {
      counters.invalidLines += 1
      continue
    }

    const current = messages.get(row.message_id) ?? {
      role: row.role,
      session: row.session_id,
      timestamp: row.timestamp,
      text: [],
    }
    textValues(part, current.text)
    messages.set(row.message_id, current)
  }

  counters.filesScanned += 1
  counters.events += messages.size
  for (const message of messages.values()) {
    recordMatches(
      stats,
      names,
      message.text.join('\n'),
      'opencode',
      message.role,
      eventTimestamp({ timestamp: message.timestamp }, 'opencode'),
      message.session,
    )
  }
  return true
}

function scanT3Database(homeDir, stats, names, counters, markers) {
  const database = path.join(homeDir, '.t3', 'userdata', 'state.sqlite')
  if (!fs.existsSync(database)) return false

  const rows = sqliteRows(database, `
    SELECT
      m.message_id,
      m.thread_id,
      m.role,
      m.created_at AS timestamp,
      m.text
    FROM projection_thread_messages m
    JOIN projection_threads t ON t.thread_id = m.thread_id
    JOIN projection_projects p ON p.project_id = t.project_id
    WHERE ${sqlLikeMarkers('p.workspace_root', markers)}
    ORDER BY m.created_at
  `)
  if (!rows) return false

  counters.filesScanned += 1
  counters.events += rows.length
  for (const row of rows) {
    recordMatches(
      stats,
      names,
      row.text ?? '',
      't3',
      row.role,
      eventTimestamp({ timestamp: row.timestamp }, 't3'),
      row.thread_id,
    )
  }
  return true
}

function canonicaliseAntigravityFiles(files) {
  const conversations = new Map()
  for (const file of files) {
    const conversationRoot = file.split(`${path.sep}.system_generated`)[0]
    const baseName = path.basename(file)
    const priority = baseName === 'transcript_full.jsonl'
      ? 3
      : baseName === 'transcript.jsonl'
        ? 2
        : 1
    const current = conversations.get(conversationRoot)
    if (!current || priority > current.priority) conversations.set(conversationRoot, { file, priority })
  }
  return [...conversations.values()].map(({ file }) => file).sort()
}

function serialiseStats(stats) {
  return Object.fromEntries(Object.entries(stats).map(([name, value]) => [name, {
    explicitPrompts: value.explicitPrompts,
    explicitByApp: value.explicitByApp,
    mentionPrompts: value.mentionPrompts,
    mentionByApp: value.mentionByApp,
    technicalEvidence: value.technicalEvidence,
    technicalByApp: value.technicalByApp,
    sessions: value.sessions.size,
    lastExplicit: value.lastExplicit,
    lastTechnical: value.lastTechnical,
  }]))
}

function appSummary(counters) {
  return {
    filesScanned: counters.filesScanned,
    eventsRead: counters.events,
    invalidLines: counters.invalidLines,
  }
}

function markdown(report) {
  const rows = Object.entries(report.skills)
    .sort(([leftName, left], [rightName, right]) => (
      right.explicitPrompts - left.explicitPrompts
      || right.technicalEvidence - left.technicalEvidence
      || right.mentionPrompts - left.mentionPrompts
      || leftName.localeCompare(rightName)
    ))

  const appText = (values) => Object.entries(values).map(([app, count]) => `${app}:${count}`).join(', ') || '—'
  const confidence = (value) => {
    if (value.explicitPrompts > 0) return 'alta para uso explícito'
    if (value.technicalEvidence > 0 && value.mentionPrompts > 0) return 'baixa; proxy técnico e menção'
    if (value.technicalEvidence > 0) return 'baixa; proxy técnico'
    if (value.mentionPrompts > 0) return 'baixa; apenas menção'
    return 'sem evidência observável'
  }

  const lines = [
    '# Relatório de uso observável das skills — 2026-09-18',
    '',
    '> Este relatório é conservador: conta invocações explícitas e evidências técnicas nos históricos locais, mas não afirma detectar todos os acionamentos automáticos dos harnesses.',
    '',
    `- **Repositório:** \`${report.repoRoot}\``,
    `- **Gerado em:** ${report.generatedAt}`,
    `- **Skills analisadas:** ${Object.keys(report.skills).length}`,
    `- **Marcadores de escopo:** ${report.projectMarkers.map((marker) => `\`${marker}\``).join(', ')}`,
    `- **Período dos registros:** ${report.period.earliest ?? 'não identificado'} a ${report.period.latest ?? 'não identificado'}`,
    `- **Skills com invocação explícita observável:** ${Object.values(report.skills).filter((skill) => skill.explicitPrompts > 0).length} de ${Object.keys(report.skills).length}`,
    `- **Invocações explícitas contabilizadas:** ${Object.values(report.skills).reduce((total, skill) => total + skill.explicitPrompts, 0)}`,
    '',
    '## Fontes consultadas',
    '',
    '| Aplicativo | Arquivos | Eventos lidos | Observação |',
    '| --- | ---: | ---: | --- |',
    `| Claude Code | ${report.apps.claude.filesScanned || '—'} | ${report.apps.claude.eventsRead || '—'} | históricos de projetos relacionados ao Vela |`,
    `| Codex | ${report.apps.codex.filesScanned || '—'} | ${report.apps.codex.eventsRead || '—'} | históricos originados pelo Codex |`,
    `| Antigravity | ${report.apps.antigravity.filesScanned || '—'} | ${report.apps.antigravity.eventsRead || '—'} | conversas canônicas contendo referências ao Vela |`,
    `| OpenCode | ${report.apps.opencode.filesScanned || '—'} | ${report.apps.opencode.eventsRead || '—'} | banco SQLite local, sessões do Vela |`,
    `| T3 | ${report.apps.t3.filesScanned || '—'} | ${report.apps.t3.eventsRead || '—'} | histórico do T3 e sessões do Codex originadas pelo T3 |`,
    '',
    '## Como interpretar',
    '',
    '- **Invocações explícitas:** o usuário pediu diretamente uma skill, por exemplo `/brainstorming` ou “use a skill brainstorming”. É o sinal mais forte disponível.',
    '- **Evidência técnica:** um agente leu uma entrada `SKILL.md` durante uma sessão. É um sinal útil, mas pode incluir leitura preparatória e não prova que o fluxo foi determinante.',
    '- **Menções:** o nome apareceu no prompt do usuário, mas pode ter sido apenas discussão, documentação ou comparação.',
    '- Ausência de registro não significa que a skill nunca foi acionada; significa apenas que não foi possível observá-la nos históricos coletados.',
    '',
    '## Ranking por evidência observável',
    '',
    '| Ordem | Skill | Invocações explícitas | Apps | Evidência técnica | Menções | Última invocação | Confiança |',
    '| ---: | --- | ---: | --- | ---: | ---: | --- | --- |',
  ]

  rows.forEach(([name, value], index) => {
    lines.push(`| ${index + 1} | ${name} | ${value.explicitPrompts} | ${appText(value.explicitByApp)} | ${value.technicalEvidence} | ${value.mentionPrompts} | ${value.lastExplicit ?? '—'} | ${confidence({ ...value, name })} |`)
  })

  lines.push(
    '',
    '## Limitações e próximos dados',
    '',
    '- Os históricos do Alienware ainda não foram coletados; portanto este é um relatório do MacBook.',
    '- Claude, Codex, Antigravity, OpenCode e T3 não oferecem neste inventário uma métrica universal de “skill acionada automaticamente”.',
    '- OpenCode e T3 registram partes da mesma execução quando o T3 usa um provedor externo; invocações explícitas iguais são deduplicadas quando compartilham horário e texto normalizado.',
    '- Evidência técnica continua sendo um proxy fraco: ler um `SKILL.md` pode ser preparação do agente, e não prova de que a skill mudou o resultado.',
    '- A próxima rodada deve comparar este relatório com o Alienware e validar as famílias de maior sobreposição em cenários reais do Vela.',
    '- Nenhuma exclusão deve ser decidida apenas por este ranking; importância de domínio e dependências continuam sendo critérios independentes.',
    '',
  )

  return lines.join('\n')
}

async function buildReport(options) {
  const names = readSkillNames(options.repoRoot)
  const stats = makeStats(names)
  const projectMarkers = repositoryMarkers(options.repoRoot, options.markers)
  const inputs = appInputFiles(options.homeDir, projectMarkers)
  const appNames = ['claude', 'codex', 'antigravity', 'opencode', 't3']
  const countersByApp = Object.fromEntries(appNames.map((app) => [app, {
    filesScanned: 0,
    events: 0,
    invalidLines: 0,
  }]))
  const timestamps = []

  for (const [app, files] of Object.entries(inputs)) {
    for (const file of files) {
      const sourceApp = app === 'codex' ? detectCodexSourceApp(file) : app
      const counters = countersByApp[sourceApp]
      counters.filesScanned += 1
      await scanFile(file, sourceApp, stats, names, counters)
    }
  }

  scanOpenCodeDatabase(options.homeDir, stats, names, countersByApp.opencode, projectMarkers)
  scanT3Database(options.homeDir, stats, names, countersByApp.t3, projectMarkers)

  const apps = Object.fromEntries(appNames.map((app) => [app, appSummary(countersByApp[app])]))

  for (const value of Object.values(stats)) {
    if (value.lastExplicit) timestamps.push(value.lastExplicit)
    if (value.lastTechnical) timestamps.push(value.lastTechnical)
  }

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: options.repoRoot,
    projectMarkers,
    period: {
      earliest: timestamps.sort()[0] ?? null,
      latest: timestamps.sort().at(-1) ?? null,
    },
    apps,
    skills: serialiseStats(stats),
  }
}

function writeOutput(content, output) {
  if (!output) {
    process.stdout.write(content)
    return
  }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, content)
  console.log(`Wrote ${output}`)
}

try {
  const options = parseArgs(process.argv.slice(2))
  if (options === null) process.exit(0)
  const report = await buildReport(options)
  const content = options.format === 'json'
    ? `${JSON.stringify(report, null, 2)}\n`
    : markdown(report)
  writeOutput(content, options.output)
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
}
