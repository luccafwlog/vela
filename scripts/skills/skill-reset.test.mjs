import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { resetAll } from './skill-reset.mjs'

const temporaryDirectories = []

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-skill-reset-'))
  temporaryDirectories.push(root)
  const repoRoot = path.join(root, 'repo')
  const homeDir = path.join(root, 'home')
  fs.mkdirSync(path.join(repoRoot, 'skills'), { recursive: true })
  fs.mkdirSync(homeDir, { recursive: true })
  return { root, repoRoot, homeDir }
}

function writeSkill(root, name, files) {
  const skillRoot = path.join(root, 'skills', name)
  writeFiles(skillRoot, files)
}

function writeSkillAt(skillsRoot, name, files) {
  const skillRoot = path.join(skillsRoot, name)
  writeFiles(skillRoot, files)
}

function writeFiles(skillRoot, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(skillRoot, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, contents)
  }
}

function targetRoot(homeDir, targetName) {
  if (targetName === 'antigravity') return path.join(homeDir, '.gemini', 'config', 'skills')
  if (targetName === 'antigravity-user') return path.join(homeDir, '.gemini', 'skills')
  return path.join(homeDir, `.${targetName}`, 'skills')
}

beforeEach(() => {
  temporaryDirectories.length = 0
})

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('skill reset', () => {
  it('simulates a reset without modifying the target', () => {
    const { repoRoot, homeDir } = makeWorkspace()
    writeSkill(repoRoot, 'alpha', { 'SKILL.md': '# Alpha\n' })
    writeSkill(repoRoot, 'beta', { 'SKILL.md': '# Beta\n', 'references/guide.md': 'guide\n' })
    const target = targetRoot(homeDir, 'claude')
    writeSkillAt(target, 'external', { 'SKILL.md': '# External\n' })

    const results = resetAll({
      repoRoot,
      homeDir,
      targetNames: ['claude'],
    })

    assert.equal(results[0].applied, false)
    assert.deepEqual(results[0].sourceNames, ['alpha', 'beta'])
    assert.deepEqual(results[0].existingNames, ['external'])
    assert.equal(fs.existsSync(path.join(target, 'external/SKILL.md')), true)
  })

  it('backs up the personal store and installs only the source skills', () => {
    const { repoRoot, homeDir } = makeWorkspace()
    writeSkill(repoRoot, 'alpha', { 'SKILL.md': '# Alpha\n', 'references/guide.md': 'guide\n' })
    const target = targetRoot(homeDir, 'claude')
    writeSkillAt(target, 'obsolete', { 'SKILL.md': '# Obsolete\n' })
    fs.mkdirSync(path.join(homeDir, '.vela', 'skill-sync'), { recursive: true })

    const results = resetAll({
      repoRoot,
      homeDir,
      targetNames: ['claude'],
      apply: true,
      backupRoot: path.join(homeDir, '.vela', 'skill-sync', 'backups', 'test'),
    })

    assert.equal(results[0].applied, true)
    assert.equal(fs.existsSync(path.join(target, 'obsolete')), false)
    assert.equal(fs.readFileSync(path.join(target, 'alpha/references/guide.md'), 'utf8'), 'guide\n')
    assert.equal(fs.existsSync(results[0].backupPath), true)
    assert.equal(fs.existsSync(path.join(results[0].backupPath, 'obsolete/SKILL.md')), true)

    const manifest = JSON.parse(fs.readFileSync(path.join(homeDir, '.vela/skill-sync/claude.json'), 'utf8'))
    assert.deepEqual(Object.keys(manifest.managedSkills), ['alpha'])
  })

  it('preserves the Codex system store while rebuilding personal skills', () => {
    const { repoRoot, homeDir } = makeWorkspace()
    writeSkill(repoRoot, 'alpha', { 'SKILL.md': '# Alpha\n' })
    const target = targetRoot(homeDir, 'codex')
    writeSkillAt(target, '.system/skill-creator', { 'SKILL.md': '# System\n' })

    const results = resetAll({
      repoRoot,
      homeDir,
      targetNames: ['codex'],
      apply: true,
      backupRoot: path.join(homeDir, '.vela', 'skill-sync', 'backups', 'test-system'),
    })

    assert.deepEqual(results[0].preserved, ['.system'])
    assert.equal(fs.readFileSync(path.join(target, '.system/skill-creator/SKILL.md'), 'utf8'), '# System\n')
    assert.equal(fs.existsSync(path.join(target, 'alpha/SKILL.md')), true)
  })
})
