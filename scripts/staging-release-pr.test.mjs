import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  COMMIT_PAGE_SIZE,
  LOOKUP_CAP,
  WALK_PAGE_CAP,
  buildReleaseBody,
  decisionOutput,
  numbersForTitleLookup,
  pullRequestNumbersFromSubject,
  pullRequestNumbersFromSubjects,
  releaseDecision,
  subjectsFromCompare,
  walkCommitPage,
} from './staging-release-pr.mjs'

const workflow = (name) => readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8')

function runBlocks(yaml) {
  const blocks = []
  const lines = yaml.split(/\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].match(/^(\s+)run:\s*(.*)$/)
    if (!header) continue
    const rest = header[2]
    if (rest !== '|' && rest !== '|+') {
      blocks.push(rest)
      continue
    }
    const indent = header[1].length
    const body = []
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index]
      if (line.trim() !== '' && /^ */.exec(line)[0].length <= indent) {
        index -= 1
        break
      }
      body.push(line)
    }
    blocks.push(body.join('\n'))
  }
  return blocks
}

test('assunto do GitHub vira número de PR, menção solta não', () => {
  assert.deepEqual(pullRequestNumbersFromSubject('Corrige "aspas" (#12)'), [12])
  assert.deepEqual(pullRequestNumbersFromSubject('Merge pull request #991 from luccafwlog/main'), [991])
  assert.deepEqual(pullRequestNumbersFromSubject('fix(granito): snapshots de taxa (330)'), [])
  assert.deepEqual(pullRequestNumbersFromSubject('Menciona #4 no texto'), [])
  assert.deepEqual(pullRequestNumbersFromSubject('Título (#7)\nver #8 no corpo'), [7])
  assert.deepEqual(
    pullRequestNumbersFromSubjects([
      'docs: lote',
      'Merge pull request #993 from luccafwlog/main',
      'feat: tela (#987)',
      'Merge pull request #987 from luccafwlog/feature',
    ]),
    [987, 993],
  )
})

test('compare sem commits à frente não abre PR', () => {
  assert.equal(releaseDecision({ ahead_by: 0, behind_by: 4, commits: [], total_commits: 0, status: 'behind' }).open, false)
  assert.equal(releaseDecision({ ahead_by: 0, behind_by: 0, commits: [], total_commits: 0, status: 'identical' }).open, false)
  assert.throws(() => releaseDecision({ status: 'ahead' }), /ahead_by/)
  assert.throws(() => releaseDecision(null), /inválida/)
})

test('compare com commits abre, e passa de 250 marca lista cortada', () => {
  const sha = 'a'.repeat(40)
  const open = releaseDecision({
    ahead_by: 2,
    behind_by: 1,
    total_commits: 2,
    status: 'diverged',
    merge_base_commit: { sha },
    commits: [{ commit: { message: 'Merge pull request #9 from a/b' } }, { commit: { message: 'direto' } }],
  })
  assert.equal(open.open, true)
  assert.equal(open.truncated, false)
  assert.equal(open.mergeBase, sha)
  assert.equal(open.behind, 1)
  const cut = releaseDecision({
    ahead_by: 300,
    total_commits: 300,
    commits: Array.from({ length: 250 }, () => ({ commit: { message: 'x' } })),
    merge_base_commit: { sha: 'não-é-sha' },
  })
  assert.equal(cut.truncated, true)
  assert.equal(cut.mergeBase, '')
  const output = decisionOutput(open)
  assert.match(output, /^open=true$/m)
  assert.doesNotMatch(output, /[\r]|\n.*\n.*open/s)
  assert.equal(output.split('\n').filter(Boolean).length, 6)
})

test('a caminhada para no merge-base e não o inclui', () => {
  const base = 'b'.repeat(40)
  const page = [
    { sha: 'c'.repeat(40), commit: { message: 'Merge pull request #3 from o/r\ncorpo' } },
    { sha: base, commit: { message: 'já está na main' } },
    { sha: 'd'.repeat(40), commit: { message: 'antigo (#1)' } },
  ]
  const walked = walkCommitPage(page, base)
  assert.equal(walked.status, 'done')
  assert.equal(walked.missedBase, false)
  assert.deepEqual(walked.subjects, ['Merge pull request #3 from o/r'])
  const full = Array.from({ length: COMMIT_PAGE_SIZE }, (_, index) => ({
    sha: String(index).padStart(40, '0'),
    commit: { message: `c${index}` },
  }))
  assert.equal(walkCommitPage(full, base).status, 'more')
  const short = walkCommitPage([{ sha: 'e'.repeat(40), commit: { message: 'só isso' } }], base)
  assert.equal(short.status, 'done')
  assert.equal(short.missedBase, true)
  assert.deepEqual(walkCommitPage([], base), { status: 'done', missedBase: true, subjects: [] })
})

test('títulos buscados são os números mais altos, até o teto', () => {
  const numbers = Array.from({ length: LOOKUP_CAP + 5 }, (_, index) => index + 1)
  const lookup = numbersForTitleLookup(numbers)
  assert.equal(lookup.length, LOOKUP_CAP)
  assert.equal(lookup[0], 6)
  assert.equal(lookup.at(-1), LOOKUP_CAP + 5)
  assert.equal(WALK_PAGE_CAP, 30)
})

test('corpo preserva aspas no título e não executa o texto', () => {
  const title = 'Corrige "CE" e `$(echo pwn)` no portal'
  const body = buildReleaseBody({
    repo: 'luccafwlog/vela',
    mergedNumber: 42,
    mergedTitle: title,
    mergedAuthor: 'lucca',
    ahead: 1,
    behind: 0,
    subjects: ['Merge pull request #42 from luccafwlog/feature', 'push direto'],
    pullRequests: [{ number: 42, title }],
  })
  assert.match(body, /Corrige "CE" e `\$\(echo pwn\)` no portal/)
  assert.match(body, /#42/)
  assert.match(body, /por @lucca/)
  assert.match(body, /1\*\* commit à frente/)
  assert.match(body, /Create a merge commit/)
  assert.match(body, /https:\/\/staging\.vela-internal\.pages\.dev/)
  assert.doesNotMatch(body, /\$\{/)
  const quiet = buildReleaseBody({
    repo: 'luccafwlog/vela',
    mergedNumber: 7,
    mergedTitle: 'Só a feature',
    ahead: 4,
    behind: 2,
    subjects: ['sem número'],
    pullRequests: [],
  })
  assert.match(quiet, /- #7 Só a feature/)
  assert.match(quiet, /2\*\* commits que ainda não estão na staging/)
})

test('check da main tem o nome do job e não interpola expressão no shell', async () => {
  const yaml = await workflow('main-only-from-staging.yml')
  assert.match(yaml, /^ {2}main-only-from-staging:\n {4}name: main-only-from-staging$/m)
  assert.match(yaml, /branches: \[main\]/)
  assert.match(yaml, /types: \[opened, synchronize, reopened, edited, ready_for_review\]/)
  assert.match(yaml, /contents: read/)
  assert.doesNotMatch(yaml, /contents: write/)
  assert.doesNotMatch(yaml, /pull-requests: write/)
  assert.doesNotMatch(yaml, /^ {4}uses:/m)
  assert.match(yaml, /HEAD_REF: \$\{\{ github\.head_ref \}\}/)
  assert.match(yaml, /HEAD_REPO: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \}\}/)
  for (const block of runBlocks(yaml)) assert.doesNotMatch(block, /\$\{\{/)
  assert.match(runBlocks(yaml).join('\n'), /printf '%s'/)
})

test('promoção abre ou atualiza a PR e não faz merge', async () => {
  const yaml = await workflow('staging-to-main-pr.yml')
  // Push na staging, não fechamento de PR: o environment restrito à staging
  // só libera o token quando o GITHUB_REF é a staging (auditoria run-3).
  assert.match(yaml, /on:\n {2}push:\n {4}branches: \[staging\]/)
  assert.doesNotMatch(yaml, /pull_request:/)
  assert.match(yaml, /environment: staging-release/)
  assert.match(yaml, /commits\/\$\{PUSHED_SHA\}\/pulls/)
  assert.match(yaml, /MERGED_TITLE<<%s/)
  assert.match(yaml, /secrets\.STAGING_TO_MAIN_TOKEN \|\| secrets\.GITHUB_TOKEN/)
  assert.match(yaml, /pull-requests: write/)
  assert.match(yaml, /contents: read/)
  assert.doesNotMatch(yaml, /contents: write/)
  assert.match(yaml, /cancel-in-progress: false/)
  assert.match(yaml, /group: staging-to-main-pr/)
  assert.doesNotMatch(yaml, /gh pr merge/)
  assert.match(yaml, /staging-release-pr\.mjs/)
  assert.match(yaml, /page-size/)
  assert.match(yaml, /\bcap\b/)
  assert.match(yaml, /lookup-cap/)
  assert.match(yaml, /head=\$\{owner\}:staging/)
  assert.match(yaml, /--body-file body\.md/)
  assert.doesNotMatch(yaml, /uses:/)
  for (const block of runBlocks(yaml)) assert.doesNotMatch(block, /\$\{\{/)
  const subjects = subjectsFromCompare({
    commits: [{ commit: { message: 'Merge pull request #15 from o/b\n' } }],
  })
  assert.deepEqual(subjects, ['Merge pull request #15 from o/b'])
})
