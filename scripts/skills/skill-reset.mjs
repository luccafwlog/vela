#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MANIFEST_VERSION,
  inspectSkills,
  snapshotSkill,
  targetRoots,
} from './skill-sync.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(scriptDir, '../..')
const preservedEntriesByTarget = {
  codex: ['.system'],
}

function pathExists(filePath) {
  try {
    fs.lstatSync(filePath)
    return true
  } catch {
    return false
  }
}

function assertNotSymlink(filePath, description) {
  if (pathExists(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Refusing to reset symbolic-link ${description}: ${filePath}`)
  }
}

function sourceRoot(repoRoot) {
  return path.join(repoRoot, 'skills')
}

function skillNames(skillsRoot) {
  return Object.keys(inspectSkills(skillsRoot)).sort()
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function copySkillTrees(sourceSkillsRoot, destinationSkillsRoot, names) {
  fs.mkdirSync(destinationSkillsRoot, { recursive: true })
  for (const name of names) {
    fs.cpSync(
      path.join(sourceSkillsRoot, name),
      path.join(destinationSkillsRoot, name),
      { recursive: true, errorOnExist: true },
    )
  }
}

function copyPreservedEntries(targetName, existingRoot, stagedRoot) {
  const preserved = preservedEntriesByTarget[targetName] ?? []
  for (const entry of preserved) {
    const source = path.join(existingRoot, entry)
    if (!pathExists(source)) continue
    const destination = path.join(stagedRoot, entry)
    if (fs.lstatSync(source).isSymbolicLink()) {
      throw new Error(`Refusing to preserve symbolic-link system entry: ${source}`)
    }
    fs.cpSync(source, destination, { recursive: true, errorOnExist: true })
  }
  return preserved.filter((entry) => pathExists(path.join(existingRoot, entry)))
}

function assertStagedTreeMatches(sourceSkillsRoot, stagedSkillsRoot, names) {
  const staged = inspectSkills(stagedSkillsRoot)
  const stagedNames = Object.keys(staged).sort()
  if (JSON.stringify(stagedNames) !== JSON.stringify(names)) {
    throw new Error(`Staged skill set differs from source: expected ${names.join(', ')}, got ${stagedNames.join(', ')}`)
  }

  for (const name of names) {
    const sourceSnapshot = snapshotSkill(path.join(sourceSkillsRoot, name))
    if (sourceSnapshot.treeHash !== staged[name].treeHash) {
      throw new Error(`Staged skill differs from source: ${name}`)
    }
  }
}

function buildManifest({ repoRoot, targetName, sourceSkillsRoot, generatedAt }) {
  return {
    version: MANIFEST_VERSION,
    target: targetName,
    source: path.resolve(repoRoot),
    generatedAt,
    managedSkills: inspectSkills(sourceSkillsRoot),
  }
}

function resetTarget({
  repoRoot,
  homeDir,
  targetName,
  targetRoot,
  manifestPath,
  backupRoot,
  apply = false,
  generatedAt = new Date().toISOString(),
}) {
  const sourceSkillsRoot = sourceRoot(repoRoot)
  const sourceNames = skillNames(sourceSkillsRoot)
  const existingNames = skillNames(targetRoot)
  const result = {
    target: targetName,
    targetRoot,
    manifestPath,
    sourceNames,
    existingNames,
    remove: existingNames,
    add: sourceNames,
    preserved: (preservedEntriesByTarget[targetName] ?? []).filter((entry) => pathExists(path.join(targetRoot, entry))),
    applied: false,
    backupPath: null,
  }

  if (!apply) return result

  assertNotSymlink(targetRoot, 'skill store')
  assertNotSymlink(manifestPath, 'skill manifest')
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true })

  const targetBackupPath = path.join(backupRoot, targetName)
  const manifestBackupPath = path.join(backupRoot, `${targetName}.manifest.json`)
  fs.mkdirSync(backupRoot, { recursive: true })
  if (pathExists(targetRoot)) fs.cpSync(targetRoot, targetBackupPath, { recursive: true })
  if (pathExists(manifestPath)) fs.copyFileSync(manifestPath, manifestBackupPath)

  const stageBase = fs.mkdtempSync(path.join(path.dirname(targetRoot), `.vela-skill-reset-${targetName}-`))
  const stagedRoot = path.join(stageBase, path.basename(targetRoot))
  const temporaryManifest = path.join(
    path.dirname(manifestPath),
    `.${path.basename(manifestPath)}.${crypto.randomUUID()}.tmp`,
  )
  let previousRoot = null
  let previousManifest = null
  let manifestWasReplaced = false

  try {
    copySkillTrees(sourceSkillsRoot, stagedRoot, sourceNames)
    copyPreservedEntries(targetName, targetRoot, stagedRoot)
    assertStagedTreeMatches(sourceSkillsRoot, stagedRoot, sourceNames)
    writeJsonFile(temporaryManifest, buildManifest({
      repoRoot,
      targetName,
      sourceSkillsRoot,
      generatedAt,
    }))

    if (pathExists(targetRoot)) {
      previousRoot = path.join(
        path.dirname(targetRoot),
        `.vela-skill-reset-previous-${targetName}-${crypto.randomUUID()}`,
      )
      fs.renameSync(targetRoot, previousRoot)
    }
    fs.renameSync(stagedRoot, targetRoot)

    fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
    if (pathExists(manifestPath)) {
      previousManifest = path.join(
        path.dirname(manifestPath),
        `.vela-manifest-previous-${targetName}-${crypto.randomUUID()}`,
      )
      fs.renameSync(manifestPath, previousManifest)
    }
    fs.renameSync(temporaryManifest, manifestPath)
    manifestWasReplaced = true

    if (previousRoot) fs.rmSync(previousRoot, { recursive: true, force: true })
    if (previousManifest) fs.rmSync(previousManifest, { recursive: true, force: true })
    result.applied = true
    result.backupPath = targetBackupPath
  } catch (error) {
    if (pathExists(targetRoot)) fs.rmSync(targetRoot, { recursive: true, force: true })
    if (previousRoot && pathExists(previousRoot)) fs.renameSync(previousRoot, targetRoot)

    if (manifestWasReplaced && pathExists(manifestPath)) fs.rmSync(manifestPath, { force: true })
    if (previousManifest && pathExists(previousManifest)) fs.renameSync(previousManifest, manifestPath)
    throw error
  } finally {
    fs.rmSync(stageBase, { recursive: true, force: true })
    fs.rmSync(temporaryManifest, { force: true })
  }

  return result
}

export function resetAll({
  repoRoot = defaultRepoRoot,
  homeDir = os.homedir(),
  targetNames = Object.keys(targetRoots(homeDir)),
  apply = false,
  backupRoot = path.join(homeDir, '.vela', 'skill-sync', 'backups', new Date().toISOString().replaceAll(':', '-')),
  generatedAt = new Date().toISOString(),
} = {}) {
  const roots = targetRoots(homeDir)
  return targetNames.map((targetName) => {
    if (!roots[targetName]) throw new Error(`Unknown target: ${targetName}`)
    return resetTarget({
      repoRoot,
      homeDir,
      targetName,
      targetRoot: roots[targetName],
      manifestPath: path.join(homeDir, '.vela', 'skill-sync', `${targetName}.json`),
      backupRoot,
      apply,
      generatedAt,
    })
  })
}

function parseArgs(argv) {
  const options = { targetNames: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--repo-root') options.repoRoot = path.resolve(argv[++index])
    else if (argument === '--home') options.homeDir = path.resolve(argv[++index])
    else if (argument === '--target') options.targetNames.push(argv[++index])
    else if (argument === '--backup-root') options.backupRoot = path.resolve(argv[++index])
    else if (argument === '--apply') options.apply = true
    else if (argument === '--dry-run') options.apply = false
    else if (argument === '--help' || argument === '-h') {
      console.log(`Usage: node scripts/skills/skill-reset.mjs [options]

Options:
  --repo-root <path>    Vela clone root (default: inferred from this script)
  --home <path>         Home directory used for targets and manifests
  --target <name>       Reset only one target; repeatable (default: all)
  --backup-root <path>  Backup destination (default: ~/.vela/skill-sync/backups/...)
  --apply               Perform the reset; without this flag, only simulate
`)
      return null
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (options.targetNames.length === 0) delete options.targetNames
  return options
}

function printResults(results, apply) {
  for (const result of results) {
    const mode = apply ? 'applied' : 'dry-run'
    console.log(`${result.target} (${mode}): remove ${result.remove.length}, install ${result.add.length}`)
    if (result.existingNames.length) console.log(`  existing: ${result.existingNames.join(', ')}`)
    if (result.preserved.length) console.log(`  preserved system entries: ${result.preserved.join(', ')}`)
    console.log(`  source: ${result.sourceNames.join(', ')}`)
    if (result.backupPath) console.log(`  backup: ${result.backupPath}`)
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options === null) process.exit(0)
  const results = resetAll(options)
  printResults(results, options.apply === true)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error)
    process.exitCode = 1
  }
}
