#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MANIFEST_VERSION = 1

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(scriptDir, '../..')
const legacyRemovalLedgerName = 'legacy-removed-skills-2026-09-18.json'

export function targetRoots(homeDir = os.homedir()) {
  return {
    agents: path.join(homeDir, '.agents', 'skills'),
    claude: path.join(homeDir, '.claude', 'skills'),
    codex: path.join(homeDir, '.codex', 'skills'),
    antigravity: path.join(homeDir, '.gemini', 'config', 'skills'),
    'antigravity-user': path.join(homeDir, '.gemini', 'skills'),
  }
}

export function manifestPathFor(homeDir, targetName) {
  return path.join(homeDir, '.vela', 'skill-sync', `${targetName}.json`)
}

function sourceSkillsRoot(repoRoot) {
  return path.join(repoRoot, 'skills')
}

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex')
}

function collectFiles(directory, relativeTo = directory) {
  const files = []
  if (!fs.existsSync(directory)) return files

  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath, relativeTo))
    } else {
      files.push(path.relative(relativeTo, absolutePath))
    }
  }

  return files.sort()
}

export function snapshotSkill(skillDirectory) {
  const files = collectFiles(skillDirectory)
  if (!files.includes('SKILL.md')) return null

  const treeHasher = crypto.createHash('sha256')
  for (const relativePath of files) {
    const contents = fs.readFileSync(path.join(skillDirectory, relativePath))
    treeHasher.update(relativePath)
    treeHasher.update('\0')
    treeHasher.update(contents)
    treeHasher.update('\0')
  }

  const entrypoint = fs.readFileSync(path.join(skillDirectory, 'SKILL.md'))
  return {
    treeHash: treeHasher.digest('hex'),
    entrypointHash: sha256(entrypoint),
    files,
  }
}

export function inspectSkills(skillsRoot) {
  const skills = {}
  if (!fs.existsSync(skillsRoot)) return skills

  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const snapshot = snapshotSkill(path.join(skillsRoot, entry.name))
    if (snapshot) skills[entry.name] = snapshot
  }

  return skills
}

function readManifest(manifestFile) {
  if (!fs.existsSync(manifestFile)) return null
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  if (
    !manifest
    || manifest.version !== MANIFEST_VERSION
    || !manifest.managedSkills
    || typeof manifest.managedSkills !== 'object'
    || Array.isArray(manifest.managedSkills)
  ) {
    throw new Error(`Unsupported skill-sync manifest: ${manifestFile}`)
  }
  return manifest
}

function readLegacyRemovalLedger(repoRoot) {
  const ledgerPath = path.join(repoRoot, 'scripts', 'skills', legacyRemovalLedgerName)
  if (!fs.existsSync(ledgerPath)) return []

  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  if (ledger.version !== 1 || !Array.isArray(ledger.skills) || ledger.skills.some((name) => typeof name !== 'string')) {
    throw new Error(`Unsupported legacy skill removal ledger: ${ledgerPath}`)
  }
  return [...new Set(ledger.skills)].sort()
}

function bootstrapLegacyManifest({ repoRoot, targetName, targetSkills }) {
  const managedSkills = {}
  for (const name of readLegacyRemovalLedger(repoRoot)) {
    if (targetSkills[name]) managedSkills[name] = targetSkills[name]
  }
  if (Object.keys(managedSkills).length === 0) return null

  return {
    version: MANIFEST_VERSION,
    target: targetName,
    source: path.resolve(repoRoot),
    generatedAt: new Date().toISOString(),
    managedSkills,
  }
}

function safeSkillPath(skillsRoot, skillName) {
  const root = path.resolve(skillsRoot)
  const destination = path.resolve(root, skillName)
  if (destination === root || !destination.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Unsafe skill name: ${skillName}`)
  }
  return destination
}

function sameSnapshot(left, right) {
  return Boolean(left && right && left.treeHash === right.treeHash)
}

function createManifest({ repoRoot, targetName, previous, sourceSkills, pruneOwned, generatedAt }) {
  const managedSkills = { ...(previous?.managedSkills ?? {}) }

  for (const [name, snapshot] of Object.entries(sourceSkills)) {
    managedSkills[name] = snapshot
  }

  if (pruneOwned) {
    for (const name of Object.keys(managedSkills)) {
      if (!sourceSkills[name]) delete managedSkills[name]
    }
  }

  return {
    version: MANIFEST_VERSION,
    target: targetName,
    source: path.resolve(repoRoot),
    generatedAt,
    managedSkills,
  }
}

function pathExists(filePath) {
  try {
    fs.lstatSync(filePath)
    return true
  } catch {
    return false
  }
}

function replaceDirectoryAtomically(source, destination) {
  const parent = path.dirname(destination)
  fs.mkdirSync(parent, { recursive: true })
  const stageBase = fs.mkdtempSync(path.join(parent, '.vela-skill-stage-'))
  const staged = path.join(stageBase, path.basename(destination))
  let previous = null

  try {
    fs.cpSync(source, staged, { recursive: true, errorOnExist: true })

    if (pathExists(destination)) {
      if (fs.lstatSync(destination).isSymbolicLink()) {
        throw new Error(`Refusing to replace symbolic-link skill destination: ${destination}`)
      }
      previous = path.join(parent, `.vela-skill-previous-${process.pid}-${crypto.randomUUID()}`)
      fs.renameSync(destination, previous)
    }

    fs.renameSync(staged, destination)
    if (previous) fs.rmSync(previous, { recursive: true, force: true })
  } catch (error) {
    if (previous && pathExists(destination)) fs.rmSync(destination, { recursive: true, force: true })
    if (previous && pathExists(previous) && !pathExists(destination)) fs.renameSync(previous, destination)
    throw error
  } finally {
    fs.rmSync(stageBase, { recursive: true, force: true })
  }
}

function writeJsonAtomically(filePath, value) {
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true })
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`)
    fs.renameSync(temporaryPath, filePath)
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
}

function applyAction(action, sourceRoot, targetRoot) {
  const destination = safeSkillPath(targetRoot, action.skill)
  if (action.action === 'add' || action.action === 'update') {
    replaceDirectoryAtomically(path.join(sourceRoot, action.skill), destination)
  } else if (action.action === 'remove-owned') {
    fs.rmSync(destination, { recursive: true, force: true })
  }
}

export function syncTarget({
  repoRoot = defaultRepoRoot,
  homeDir = os.homedir(),
  targetName,
  targetRoot = targetRoots(homeDir)[targetName],
  manifestPath = manifestPathFor(homeDir, targetName),
  dryRun = false,
  check = false,
  pruneOwned = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!targetName) throw new Error('targetName is required')
  if (dryRun && check) throw new Error('dryRun and check cannot be used together')
  if (!targetRoot) throw new Error(`Unknown target: ${targetName}`)

  const sourceRoot = sourceSkillsRoot(repoRoot)
  const sourceSkills = inspectSkills(sourceRoot)
  const targetSkills = inspectSkills(targetRoot)
  const storedManifest = readManifest(manifestPath)
  const previous = storedManifest ?? (pruneOwned
    ? bootstrapLegacyManifest({ repoRoot, targetName, targetSkills })
    : null)
  const ownershipSource = storedManifest ? 'manifest' : previous ? 'legacy-ledger' : 'none'
  const actions = []
  const errors = []

  if (check && !previous) {
    errors.push(`${targetName}: manifest missing`)
  }

  for (const name of Object.keys(sourceSkills).sort()) {
    const sourceSkill = sourceSkills[name]
    const targetSkill = targetSkills[name]
    const previousSkill = previous?.managedSkills?.[name]

    if (!targetSkill) {
      actions.push({ action: 'add', skill: name })
      if (check) errors.push(`${targetName}/${name}: target missing`)
    } else if (
      previousSkill
      && !sameSnapshot(targetSkill, sourceSkill)
      && !sameSnapshot(targetSkill, previousSkill)
    ) {
      actions.push({ action: 'conflict', skill: name })
      errors.push(`${targetName}/${name}: target changed outside Vela ownership`)
    } else if (!sameSnapshot(sourceSkill, targetSkill)) {
      actions.push({ action: 'update', skill: name })
      if (check) errors.push(`${targetName}/${name}: target differs from source`)
    } else {
      actions.push({ action: 'unchanged', skill: name })
    }

    if (check && previousSkill && previousSkill.treeHash !== sourceSkill.treeHash) {
      errors.push(`${targetName}/${name}: manifest differs from source`)
    }
  }

  const managedSkills = previous?.managedSkills ?? {}
  for (const name of Object.keys(managedSkills).sort()) {
    if (sourceSkills[name]) continue

    const destination = safeSkillPath(targetRoot, name)
    if (pruneOwned) {
      if (fs.existsSync(destination)) actions.push({ action: 'remove-owned', skill: name })
      if (check) errors.push(`${targetName}/${name}: source missing`)
    } else if (check) {
      errors.push(`${targetName}/${name}: source missing but still owned`)
    }
  }

  const result = {
    ok: errors.length === 0,
    target: targetName,
    actions,
    errors,
    manifestPath,
    ownershipSource,
  }

  if (!dryRun && !check) {
    fs.mkdirSync(targetRoot, { recursive: true })
    for (const action of actions) {
      if (action.action === 'conflict') continue
      applyAction(action, sourceRoot, targetRoot)
    }

    const manifest = createManifest({
      repoRoot,
      targetName,
      previous,
      sourceSkills,
      pruneOwned,
      generatedAt,
    })
    writeJsonAtomically(manifestPath, manifest)
  }

  return result
}

export function syncAll({
  repoRoot = defaultRepoRoot,
  homeDir = os.homedir(),
  targetNames = Object.keys(targetRoots(homeDir)),
  ...options
} = {}) {
  const roots = targetRoots(homeDir)
  return targetNames.map((targetName) => syncTarget({
    repoRoot,
    homeDir,
    targetName,
    targetRoot: roots[targetName],
    manifestPath: manifestPathFor(homeDir, targetName),
    ...options,
  }))
}

function parseArgs(argv) {
  const options = { targetNames: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--repo-root') options.repoRoot = path.resolve(argv[++index])
    else if (argument === '--home') options.homeDir = path.resolve(argv[++index])
    else if (argument === '--target') options.targetNames.push(argv[++index])
    else if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--check') options.check = true
    else if (argument === '--prune-owned') options.pruneOwned = true
    else if (argument === '--help' || argument === '-h') {
      console.log(`Usage: node scripts/skills/skill-sync.mjs [options]

Options:
  --repo-root <path>  Vela clone root (default: inferred from this script)
  --home <path>       Home directory used for targets and manifests
  --target <name>     Sync only one target; repeatable (default: all)
  --dry-run           Report add/update/remove-owned without changing files
  --check             Fail when a managed target differs from the source
  --prune-owned       Remove only skills recorded in the target manifest
`)
      return null
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (options.dryRun && options.check) throw new Error('dryRun and check cannot be used together')
  if (options.targetNames.length === 0) delete options.targetNames
  return options
}

function printResults(results) {
  for (const result of results) {
    const ownershipNote = result.ownershipSource === 'legacy-ledger' ? ' [legacy ownership ledger]' : ''
    console.log(`${result.target}${ownershipNote}: ${result.actions.map(({ action, skill }) => `${action} ${skill}`).join(', ') || 'no changes'}`)
    for (const error of result.errors) console.error(`ERROR ${error}`)
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options === null) return
  const results = syncAll(options)
  printResults(results)
  if (results.some((result) => !result.ok)) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
