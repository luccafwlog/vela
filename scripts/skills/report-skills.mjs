#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(scriptDir, '../..')

function parseArgs(argv) {
  const options = {
    format: 'markdown',
    label: 'local',
    output: null,
    repoRoot: defaultRepoRoot,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--format') options.format = argv[++index]
    else if (argument === '--label') options.label = argv[++index]
    else if (argument === '--output') options.output = argv[++index]
    else if (argument === '--repo-root') options.repoRoot = path.resolve(argv[++index])
    else if (argument === '--help' || argument === '-h') {
      console.log(`Usage: node scripts/skills/report-skills.mjs [options]

Options:
  --format markdown|json  Output format (default: markdown)
  --label <name>          Machine/report label (default: local)
  --output <path>         Write output to a file instead of stdout
  --repo-root <path>      Vela clone root (default: inferred from this script)
`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (!['markdown', 'json'].includes(options.format)) {
    throw new Error(`Unsupported format: ${options.format}`)
  }

  return options
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function treeHash(directory, files) {
  const hasher = crypto.createHash('sha256')
  for (const relativePath of files) {
    hasher.update(relativePath)
    hasher.update('\0')
    hasher.update(fs.readFileSync(path.join(directory, relativePath)))
    hasher.update('\0')
  }
  return hasher.digest('hex')
}

function collectFiles(directory, relativeTo = directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(absolutePath, relativeTo))
    else files.push(path.relative(relativeTo, absolutePath))
  }
  return files.sort()
}

function inspectRoot(rootPath) {
  const result = {
    exists: fs.existsSync(rootPath),
    path: rootPath,
    skills: {},
  }

  if (!result.exists) return result

  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const skillDirectory = path.join(rootPath, entry.name)
    const entrypoint = path.join(skillDirectory, 'SKILL.md')
    if (!fs.existsSync(entrypoint)) continue

    const files = collectFiles(skillDirectory)
    result.skills[entry.name] = {
      auxiliaryFiles: files.filter((file) => file !== 'SKILL.md'),
      fileCount: files.length,
      hash: sha256(entrypoint),
      treeHash: treeHash(skillDirectory, files),
    }
  }

  return result
}

function statusFor(sourceSkill, targetSkill) {
  if (!sourceSkill && !targetSkill) return 'absent'
  if (!sourceSkill) return `extra:${targetSkill.hash.slice(0, 12)}`
  if (!targetSkill) return 'missing'
  return sourceSkill.treeHash === targetSkill.treeHash
    ? `same:${targetSkill.hash.slice(0, 12)}`
    : `different:${targetSkill.hash.slice(0, 12)}`
}

function buildReport(options) {
  const home = os.homedir()
  const roots = {
    repo: path.join(options.repoRoot, 'skills'),
    agents: path.join(home, '.agents', 'skills'),
    claude: path.join(home, '.claude', 'skills'),
    codex: path.join(home, '.codex', 'skills'),
    antigravity: path.join(home, '.gemini', 'config', 'skills'),
    antigravityUser: path.join(home, '.gemini', 'skills'),
  }

  const inspectedRoots = Object.fromEntries(
    Object.entries(roots).map(([name, rootPath]) => [name, inspectRoot(rootPath)]),
  )
  const repoSkills = inspectedRoots.repo.skills
  const names = [...new Set(
    Object.values(inspectedRoots).flatMap((root) => Object.keys(root.skills)),
  )].sort()

  const comparison = names.map((name) => ({
    name,
    repo: statusFor(repoSkills[name], inspectedRoots.repo.skills[name]),
    agents: statusFor(repoSkills[name], inspectedRoots.agents.skills[name]),
    claude: statusFor(repoSkills[name], inspectedRoots.claude.skills[name]),
    codex: statusFor(repoSkills[name], inspectedRoots.codex.skills[name]),
    antigravity: statusFor(repoSkills[name], inspectedRoots.antigravity.skills[name]),
    antigravityUser: statusFor(repoSkills[name], inspectedRoots.antigravityUser.skills[name]),
    repoFileCount: repoSkills[name]?.fileCount ?? null,
  }))

  return {
    generatedAt: new Date().toISOString(),
    label: options.label,
    repoRoot: options.repoRoot,
    roots: inspectedRoots,
    comparison,
  }
}

function rootSummary(root) {
  if (!root.exists) return 'ausente'
  return `${Object.keys(root.skills).length} skills`
}

function markdown(report) {
  const rootNames = ['repo', 'agents', 'claude', 'codex', 'antigravity', 'antigravityUser']
  const rootLabels = {
    repo: 'Repo',
    agents: 'Agents',
    claude: 'Claude',
    codex: 'Codex',
    antigravity: 'Antigravity config',
    antigravityUser: 'Antigravity usuário',
  }
  const lines = [
    '# Inventário de skills',
    '',
    `- **Rótulo:** ${report.label}`,
    `- **Gerado em:** ${report.generatedAt}`,
    `- **Repositório:** \`${report.repoRoot}\``,
    '',
    '> Este inventário mede disponibilidade e divergência de arquivos. Ele não representa frequência real de invocação.',
    '',
    '## Resumo por raiz',
    '',
    '| Raiz | Caminho | Estado | Quantidade |',
    '| --- | --- | --- | ---: |',
  ]

  for (const name of rootNames) {
    const root = report.roots[name]
    lines.push(`| ${rootLabels[name]} | \`${root.path}\` | ${root.exists ? 'presente' : 'ausente'} | ${rootSummary(root).replace(' skills', '')} |`)
  }

  lines.push('', '## Comparação com o repositório', '', '| Skill | Repo | Agents | Claude | Codex | Antigravity config | Antigravity usuário | Arquivos no repo |', '| --- | --- | --- | --- | --- | --- | --- | ---: |')
  for (const row of report.comparison) {
    lines.push(`| ${row.name} | ${row.repo} | ${row.agents} | ${row.claude} | ${row.codex} | ${row.antigravity} | ${row.antigravityUser} | ${row.repoFileCount ?? '—'} |`)
  }

  lines.push('', '## Arquivos auxiliares por skill no repositório', '', '| Skill | Arquivos auxiliares |', '| --- | --- |')
  for (const name of Object.keys(report.roots.repo.skills).sort()) {
    const files = report.roots.repo.skills[name].auxiliaryFiles
    lines.push(`| ${name} | ${files.length ? files.map((file) => `\`${file}\``).join(', ') : '—'} |`)
  }

  return `${lines.join('\n')}\n`
}

function writeOutput(content, outputPath) {
  if (!outputPath) {
    process.stdout.write(content)
    return
  }

  const absolutePath = path.resolve(outputPath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, content)
  console.log(`Wrote ${absolutePath}`)
}

try {
  const options = parseArgs(process.argv.slice(2))
  const report = buildReport(options)
  const content = options.format === 'json'
    ? `${JSON.stringify(report, null, 2)}\n`
    : markdown(report)
  writeOutput(content, options.output)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
