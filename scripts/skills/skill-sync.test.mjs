import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { syncTarget } from './skill-sync.mjs'

const temporaryDirectories = []

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-skill-sync-'))
  temporaryDirectories.push(root)
  const repoRoot = path.join(root, 'repo')
  const homeDir = path.join(root, 'home')
  fs.mkdirSync(path.join(repoRoot, 'skills'), { recursive: true })
  fs.mkdirSync(homeDir, { recursive: true })
  return { root, repoRoot, homeDir }
}

function writeSkill(repoRoot, name, files) {
  const skillRoot = path.join(repoRoot, 'skills', name)
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(skillRoot, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, contents)
  }
}

function targetRoot(homeDir, targetName) {
  return path.join(homeDir, '.vela-test-targets', targetName)
}

function targetSkillsRoot(homeDir, targetName) {
  return path.join(targetRoot(homeDir, targetName), 'skills')
}

function manifestPath(homeDir, targetName) {
  return path.join(targetRoot(homeDir, targetName), 'manifest.json')
}

beforeEach(() => {
  temporaryDirectories.length = 0
})

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('skill synchronization', () => {
  it('reports additions in dry-run without mutating the target or manifest', () => {
    const { repoRoot, homeDir } = makeWorkspace()
    writeSkill(repoRoot, 'alpha', {
      'SKILL.md': '# Alpha\n',
      'references/guide.md': 'guide\n',
    })

    const result = syncTarget({
      repoRoot,
      homeDir,
      targetName: 'claude',
      targetRoot: targetSkillsRoot(homeDir, 'claude'),
      manifestPath: manifestPath(homeDir, 'claude'),
      dryRun: true,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.actions, [
      { action: 'add', skill: 'alpha' },
    ])
    assert.equal(fs.existsSync(targetSkillsRoot(homeDir, 'claude')), false)
    assert.equal(fs.existsSync(manifestPath(homeDir, 'claude')), false)
  })

  it('copies auxiliary files and records ownership in a manifest', () => {
    const { repoRoot, homeDir } = makeWorkspace()
    writeSkill(repoRoot, 'alpha', {
      'SKILL.md': '# Alpha\n',
      'references/guide.md': 'guide\n',
    })

    const result = syncTarget({
      repoRoot,
      homeDir,
      targetName: 'agents',
      targetRoot: targetSkillsRoot(homeDir, 'agents'),
      manifestPath: manifestPath(homeDir, 'agents'),
    })

    assert.equal(result.ok, true)
    assert.equal(fs.readFileSync(path.join(targetSkillsRoot(homeDir, 'agents'), 'alpha/references/guide.md'), 'utf8'), 'guide\n')

    const manifest = JSON.parse(fs.readFileSync(manifestPath(homeDir, 'agents'), 'utf8'))
    assert.equal(manifest.version, 1)
    assert.equal(manifest.target, 'agents')
    assert.match(manifest.managedSkills.alpha.treeHash, /^[a-f0-9]{64}$/)
    assert.deepEqual(manifest.managedSkills.alpha.files, [
      'SKILL.md',
      'references/guide.md',
    ])
  })

  it('check detects a changed managed tree without modifying it', () => {
    const { repoRoot, homeDir } = makeWorkspace()
    writeSkill(repoRoot, 'alpha', { 'SKILL.md': '# Alpha\n' })
    syncTarget({
      repoRoot,
      homeDir,
      targetName: 'codex',
      targetRoot: targetSkillsRoot(homeDir, 'codex'),
      manifestPath: manifestPath(homeDir, 'codex'),
    })

    fs.writeFileSync(path.join(targetSkillsRoot(homeDir, 'codex'), 'alpha/SKILL.md'), '# Changed\n')
    const result = syncTarget({
      repoRoot,
      homeDir,
      targetName: 'codex',
      targetRoot: targetSkillsRoot(homeDir, 'codex'),
      manifestPath: manifestPath(homeDir, 'codex'),
      check: true,
    })

    assert.equal(result.ok, false)
    assert.ok(result.errors.includes('codex/alpha: target changed outside Vela ownership'))
    assert.equal(fs.readFileSync(path.join(targetSkillsRoot(homeDir, 'codex'), 'alpha/SKILL.md'), 'utf8'), '# Changed\n')
  })

  it('prunes only owned skills and preserves unowned external skills', () => {
    const { repoRoot, homeDir } = makeWorkspace()
    writeSkill(repoRoot, 'kept', { 'SKILL.md': '# Kept\n' })
    writeSkill(repoRoot, 'obsolete', { 'SKILL.md': '# Obsolete\n' })

    syncTarget({
      repoRoot,
      homeDir,
      targetName: 'antigravity',
      targetRoot: targetSkillsRoot(homeDir, 'antigravity'),
      manifestPath: manifestPath(homeDir, 'antigravity'),
    })

    fs.rmSync(path.join(repoRoot, 'skills/obsolete'), { recursive: true, force: true })
    writeSkillAt(targetSkillsRoot(homeDir, 'antigravity'), 'external', { 'SKILL.md': '# External\n' })

    const result = syncTarget({
      repoRoot,
      homeDir,
      targetName: 'antigravity',
      targetRoot: targetSkillsRoot(homeDir, 'antigravity'),
      manifestPath: manifestPath(homeDir, 'antigravity'),
      pruneOwned: true,
    })

    assert.ok(result.actions.some((action) => action.action === 'remove-owned' && action.skill === 'obsolete'))
    assert.equal(fs.existsSync(path.join(targetSkillsRoot(homeDir, 'antigravity'), 'obsolete')), false)
    assert.equal(fs.existsSync(path.join(targetSkillsRoot(homeDir, 'antigravity'), 'external/SKILL.md')), true)
  })

  it('uses only the reviewed legacy removal ledger when no manifest exists', () => {
    const { repoRoot, homeDir } = makeWorkspace()
    writeSkill(repoRoot, 'kept', { 'SKILL.md': '# Kept\n' })
    writeSkillAt(targetSkillsRoot(homeDir, 'claude'), 'obsolete', { 'SKILL.md': '# Obsolete\n' })
    writeSkillAt(targetSkillsRoot(homeDir, 'claude'), 'external', { 'SKILL.md': '# External\n' })

    const ledgerPath = path.join(repoRoot, 'scripts', 'skills', 'legacy-removed-skills-2026-09-18.json')
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true })
    fs.writeFileSync(ledgerPath, JSON.stringify({ version: 1, skills: ['obsolete'] }))

    const dryRun = syncTarget({
      repoRoot,
      homeDir,
      targetName: 'claude',
      targetRoot: targetSkillsRoot(homeDir, 'claude'),
      manifestPath: manifestPath(homeDir, 'claude'),
      dryRun: true,
      pruneOwned: true,
    })

    assert.equal(dryRun.ownershipSource, 'legacy-ledger')
    assert.ok(dryRun.actions.some((action) => action.action === 'remove-owned' && action.skill === 'obsolete'))
    assert.equal(dryRun.actions.some((action) => action.skill === 'external'), false)
    assert.equal(fs.existsSync(path.join(targetSkillsRoot(homeDir, 'claude'), 'obsolete/SKILL.md')), true)

    syncTarget({
      repoRoot,
      homeDir,
      targetName: 'claude',
      targetRoot: targetSkillsRoot(homeDir, 'claude'),
      manifestPath: manifestPath(homeDir, 'claude'),
      pruneOwned: true,
    })

    assert.equal(fs.existsSync(path.join(targetSkillsRoot(homeDir, 'claude'), 'obsolete')), false)
    assert.equal(fs.existsSync(path.join(targetSkillsRoot(homeDir, 'claude'), 'external/SKILL.md')), true)
  })
})

function writeSkillAt(skillsRoot, name, files) {
  const skillRoot = path.join(skillsRoot, name)
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(skillRoot, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, contents)
  }
}
