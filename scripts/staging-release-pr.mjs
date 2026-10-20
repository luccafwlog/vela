// Monta a PR staging → main depois que uma PR entra na staging
// (ADR 0091). O workflow baixa este arquivo da branch staging e não faz merge.
//
// Números de PR saem só do assunto do commit, no formato do GitHub:
// squash "título (#123)" e merge "Merge pull request #123". Menção solta
// ("ver #123") fica de fora, para a lista não misturar issue citada com PR
// que entrou.
//
// ponytail: a comparação da API devolve no máximo 250 commits. Acima disso,
// a leitura anda a lista de commits da staging até o merge-base, no teto de
// WALK_PAGE_CAP páginas. Se o teto estourar ou o merge-base não aparecer, o
// corpo usa os 250 e avisa. O upgrade é paginar por GraphQL `compare`.
// Títulos: no máximo LOOKUP_CAP (os números mais altos). O resto sai só com #.

import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const WALK_PAGE_CAP = 30
export const COMMIT_PAGE_SIZE = 100
export const LOOKUP_CAP = 100

export function firstLine(message) {
  return String(message ?? '').split(/\r?\n/, 1)[0]
}

function integer(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) return null
  return number
}

export function oneLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

/** @param {string} subject */
export function pullRequestNumbersFromSubject(subject) {
  const line = firstLine(subject)
  const found = new Set()
  const merge = /^Merge pull request #(\d+)\b/.exec(line)
  if (merge) found.add(Number(merge[1]))
  for (const match of line.matchAll(/\(#(\d+)\)/g)) found.add(Number(match[1]))
  return [...found]
}

/**
 * @param {object} compare JSON de GET /repos/{repo}/compare/main...staging
 */
export function releaseDecision(compare) {
  if (!compare || typeof compare !== 'object' || Array.isArray(compare)) {
    throw new Error('Comparação main...staging inválida.')
  }
  if (compare.ahead_by === undefined || compare.ahead_by === null) {
    throw new Error('A comparação main...staging não trouxe ahead_by.')
  }
  const ahead = integer(compare.ahead_by)
  if (ahead === null) throw new Error('ahead_by inválido.')
  const behind = integer(compare.behind_by) ?? 0
  const commits = Array.isArray(compare.commits) ? compare.commits : []
  const total = integer(compare.total_commits)
  const sha = String(compare.merge_base_commit?.sha ?? '')
  return {
    open: ahead > 0,
    ahead,
    behind,
    total: total ?? commits.length,
    truncated: (total ?? ahead) > commits.length,
    mergeBase: /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : '',
  }
}

export function decisionOutput(decision) {
  const lines = [
    `open=${decision.open ? 'true' : 'false'}`,
    `ahead=${decision.ahead}`,
    `behind=${decision.behind}`,
    `truncated=${decision.truncated ? 'true' : 'false'}`,
    `total=${decision.total}`,
    `merge_base=${decision.mergeBase}`,
  ]
  if (lines.some((line) => /[\r\n]/.test(line) || line.includes('%'))) {
    throw new Error('Saída da comparação inválida.')
  }
  return `${lines.join('\n')}\n`
}

export function subjectsFromCompare(compare) {
  const commits = Array.isArray(compare?.commits) ? compare.commits : []
  return commits.map((commit) => firstLine(commit?.commit?.message ?? ''))
}

/**
 * Página de GET /commits, da mais nova para a mais antiga.
 * O merge-base entra na página e não sai na lista.
 * @returns {{ status: 'done' | 'more', missedBase: boolean, subjects: string[] }}
 */
export function walkCommitPage(commits, mergeBaseSha) {
  const page = Array.isArray(commits) ? commits : []
  // Página vazia não viu o merge-base. Quem chama mantém os commits da comparação.
  if (page.length === 0) return { status: 'done', missedBase: true, subjects: [] }
  const subjects = []
  for (const commit of page) {
    if (commit?.sha === mergeBaseSha) return { status: 'done', missedBase: false, subjects }
    subjects.push(firstLine(commit?.commit?.message ?? ''))
  }
  const short = page.length < COMMIT_PAGE_SIZE
  return { status: short ? 'done' : 'more', missedBase: short, subjects }
}

export function pullRequestNumbersFromSubjects(subjects) {
  const found = new Set()
  for (const subject of subjects) {
    for (const number of pullRequestNumbersFromSubject(subject)) found.add(number)
  }
  return [...found].sort((left, right) => left - right)
}

export function numbersForTitleLookup(numbers, cap = LOOKUP_CAP) {
  const sorted = [...numbers].sort((left, right) => left - right)
  if (sorted.length <= cap) return sorted
  return sorted.slice(-cap)
}

function loginOrEmpty(login) {
  const value = oneLine(login)
  return /^[A-Za-z0-9-]+$/.test(value) ? value : ''
}

function repoOrEmpty(repo) {
  const value = oneLine(repo)
  return /^[\w.-]+\/[\w.-]+$/.test(value) ? value : ''
}

/**
 * @param {{
 *   repo?: string,
 *   mergedNumber?: number | null,
 *   mergedTitle?: string,
 *   mergedAuthor?: string,
 *   ahead?: number,
 *   behind?: number,
 *   listTruncated?: boolean,
 *   titlesCapped?: boolean,
 *   subjects?: string[],
 *   pullRequests?: Array<{ number: number, title?: string }>,
 * }} input
 */
export function buildReleaseBody(input) {
  const numbers = new Set(pullRequestNumbersFromSubjects(input.subjects ?? []))
  const mergedNumber = integer(input.mergedNumber)
  if (mergedNumber && mergedNumber > 0) numbers.add(mergedNumber)
  const ordered = [...numbers].sort((left, right) => left - right)

  const titles = new Map()
  for (const pullRequest of input.pullRequests ?? []) {
    const number = integer(pullRequest?.number)
    if (number) titles.set(number, oneLine(pullRequest.title))
  }

  const repo = repoOrEmpty(input.repo)
  const author = loginOrEmpty(input.mergedAuthor)
  const lines = ['## Release staging → main', '']
  if (mergedNumber && repo) {
    const who = author ? `, por @${author}` : ''
    lines.push(
      `Aberta automaticamente depois do merge de [#${mergedNumber}](https://github.com/${repo}/pull/${mergedNumber})${who} na staging.`,
    )
    const title = oneLine(input.mergedTitle)
    if (title) lines.push('', `> Título: ${title}`)
  } else {
    lines.push('Aberta automaticamente depois de um merge na staging.')
  }
  lines.push('')
  if (repo) lines.push(`Compare: https://github.com/${repo}/compare/main...staging`, '')

  const ahead = integer(input.ahead) ?? 0
  const behind = integer(input.behind) ?? 0
  lines.push(
    ahead === 1
      ? 'A staging está **1** commit à frente da main.'
      : `A staging está **${ahead}** commits à frente da main.`,
  )
  if (behind > 0) {
    lines.push(
      behind === 1
        ? 'A main tem **1** commit que ainda não está na staging. A PR pode pedir atualização antes do merge.'
        : `A main tem **${behind}** commits que ainda não estão na staging. A PR pode pedir atualização antes do merge.`,
    )
  }
  lines.push('', '### PRs que entraram na staging e ainda não estão na main', '')
  if (ordered.length === 0) {
    lines.push('Nenhum assunto de commit trouxe o número da PR. Os commits podem ter ido direto para a staging.')
  } else {
    for (const number of ordered) {
      const fromLookup = titles.has(number) ? titles.get(number) : null
      const title = fromLookup || (number === mergedNumber ? oneLine(input.mergedTitle) : '')
      if (title) lines.push(`- #${number} ${title}`)
      else if (titles.has(number)) lines.push(`- #${number} (sem título)`)
      else lines.push(`- #${number}`)
    }
    lines.push(
      '',
      'Entram PRs cujo assunto é o squash do GitHub (`título (#n)`) ou o merge (`Merge pull request #n`). Commit sem esse número não aparece.',
    )
  }
  if (input.listTruncated) {
    lines.push('', 'A lista pode estar incompleta: a staging está longe demais da main e a leitura parou no limite.')
  }
  if (input.titlesCapped) {
    lines.push('', `Os títulos foram buscados para as ${LOOKUP_CAP} PRs de número mais alto. As outras ficam só com o número.`)
  }
  lines.push(
    '',
    'Este texto é reescrito quando outra PR entra na staging. O que estiver marcado aqui volta em branco.',
    '',
    '### Antes do merge',
    '',
    '- [ ] Testado no staging (https://staging.vela-internal.pages.dev e https://staging.vela-portal.pages.dev)',
    '- [ ] Migrations conferidas (numeração sem conflito)',
    '- [ ] CI verde',
    '',
    '> Fazer o merge com **Create a merge commit** (não squash). O merge publica a produção: vela.app.br e portalfwlog.com.br.',
    '',
  )
  return lines.join('\n')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function printSubjects(subjects) {
  process.stdout.write(subjects.map((subject) => `${firstLine(subject)}\n`).join(''))
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function invokedAsCli() {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
}

if (invokedAsCli()) {
  const [command, ...args] = process.argv.slice(2)
  try {
    switch (command) {
      case 'cap':
        process.stdout.write(String(WALK_PAGE_CAP))
        break
      case 'page-size':
        process.stdout.write(String(COMMIT_PAGE_SIZE))
        break
      case 'lookup-cap':
        process.stdout.write(String(LOOKUP_CAP))
        break
      case 'decide': {
        const decision = releaseDecision(readJson(args[0]))
        process.stdout.write(decisionOutput(decision))
        break
      }
      case 'subjects':
        printSubjects(subjectsFromCompare(readJson(args[0])))
        break
      case 'walk-page': {
        const walked = walkCommitPage(readJson(args[1]), args[0])
        process.stdout.write(`${JSON.stringify(walked)}\n`)
        break
      }
      case 'walk-subjects':
        printSubjects(readJson(args[0]).subjects ?? [])
        break
      case 'walk-field': {
        const value = readJson(args[0])[args[1]]
        const token = String(value)
        if (!/^[a-z]+$/.test(token)) fail(`Campo ${args[1]} inválido.`)
        process.stdout.write(token)
        break
      }
      case 'numbers':
        printSubjects(pullRequestNumbersFromSubjects(readFileSync(args[0], 'utf8').split(/\n/)))
        break
      case 'body': {
        const subjects = readFileSync(args[0], 'utf8').split(/\n/).filter((line) => line.length > 0)
        const pullRequests = []
        if (args[1]) {
          for (const line of readFileSync(args[1], 'utf8').split(/\n/)) {
            if (!line.trim()) continue
            pullRequests.push(JSON.parse(line))
          }
        }
        process.stdout.write(buildReleaseBody({
          repo: process.env.REPO,
          mergedNumber: process.env.MERGED_NUMBER,
          mergedTitle: process.env.MERGED_TITLE,
          mergedAuthor: process.env.MERGED_AUTHOR,
          ahead: process.env.AHEAD,
          behind: process.env.BEHIND,
          listTruncated: process.env.LIST_TRUNCATED === 'true',
          titlesCapped: process.env.TITLES_CAPPED === 'true',
          subjects,
          pullRequests,
        }))
        break
      }
      default:
        fail(`Comando desconhecido: ${command ?? '(vazio)'}`)
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}
