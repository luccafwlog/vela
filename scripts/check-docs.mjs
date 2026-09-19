import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractDocRoutes } from './lib/docs-routes.mjs'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
// 'archive': snapshots históricos não são verdade atual (AGENTS.md); seus
// links podem apodrecer quando assets são podados, sem quebrar o gate.
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'archive'])
const errors = []

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return []
    const absolutePath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath]
  })
}

function relative(absolutePath) {
  return path.relative(root, absolutePath).replaceAll('\\', '/')
}

function addError(file, message) {
  errors.push(`${file}: ${message}`)
}

const markdownFiles = walk(root).filter((file) => /\.mdx?$/i.test(file))
const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g

for (const file of markdownFiles) {
  const content = fs.readFileSync(file, 'utf8')
  const prose = content.replace(/```[\s\S]*?```/g, '')
  for (const match of prose.matchAll(markdownLinkPattern)) {
    let target = match[1].trim()
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    target = target.replace(/\s+["'][^"']*["']$/, '')
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue

    const pathPart = target.split('#')[0]
    if (!pathPart) continue

    let decoded
    try {
      decoded = decodeURIComponent(pathPart)
    } catch {
      addError(relative(file), `link has invalid URL encoding: ${target}`)
      continue
    }

    if (path.isAbsolute(decoded)) {
      addError(relative(file), `link must be repository-relative: ${target}`)
      continue
    }

    const resolved = path.resolve(path.dirname(file), decoded)
    if (!fs.existsSync(resolved)) {
      addError(relative(file), `broken relative link: ${target}`)
    }
  }
}

const requiredFiles = [
  'AGENTS.md',
  'docs/README.md',
  'docs/RASTREABILIDADE.md',
  'docs/adr/README.md',
]
for (const requiredFile of requiredFiles) {
  if (!fs.existsSync(path.join(root, requiredFile))) {
    addError(requiredFile, 'required documentation index is missing')
  }
}

const adrDirectory = path.join(root, 'docs', 'adr')
const adrIndexPath = path.join(adrDirectory, 'README.md')
if (fs.existsSync(adrIndexPath)) {
  const adrIndex = fs.readFileSync(adrIndexPath, 'utf8')
  const adrFiles = fs.readdirSync(adrDirectory)
    .filter((name) => /^\d{4}-.+\.md$/i.test(name))
    .sort()

  for (const adrFile of adrFiles) {
    if (!adrIndex.includes(adrFile)) {
      addError('docs/adr/README.md', `ADR is not indexed: ${adrFile}`)
    }
  }
}

const moduleDocuments = [
  'docs/modules/viagens.md',
  'docs/modules/manifesto-edi.md',
  'docs/modules/granito.md',
  'docs/modules/chegadas-saidas.md',
  'docs/modules/clientes.md',
  'docs/modules/taxas-locais.md',
  'docs/modules/faturamento.md',
  'docs/modules/demurrage.md',
  'docs/modules/reconciliacao-pix.md',
  'docs/modules/portal-cliente.md',
  'docs/modules/operacao-suporte.md',
]

const requiredModuleHeadings = [
  '## Propósito e escopo',
  '## Anatomia das telas',
  '## Catálogo de ações',
  '## Estado e dados',
  '## Fluxos e invariantes',
  '## Testes e validação',
  '## Notas e divergências',
]

for (const moduleDocument of moduleDocuments) {
  const absolutePath = path.join(root, moduleDocument)
  if (!fs.existsSync(absolutePath)) {
    addError(moduleDocument, 'living module document is missing')
    continue
  }

  const content = fs.readFileSync(absolutePath, 'utf8')
  for (const heading of requiredModuleHeadings) {
    if (!content.includes(heading)) {
      addError(moduleDocument, `required cartography heading is missing: ${heading}`)
    }
  }
  const actualHeadings = content.split('\n').filter((line) => line.startsWith('## '))
  if (JSON.stringify(actualHeadings) !== JSON.stringify(requiredModuleHeadings)) {
    addError(moduleDocument, 'module must have exactly the seven canonical sections in order')
  }
  const actionHeader = '| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |'
  if (!content.includes(actionHeader)) addError(moduleDocument, 'canonical eight-column action catalog is missing')
  for (const line of content.split('\n').filter((line) => line.startsWith('| Tela / ação'))) {
    if (line !== actionHeader) addError(moduleDocument, 'action catalog has noncanonical columns')
  }
  let inActionTable = false
  for (const line of content.split('\n')) {
    if (line.startsWith('| Tela / ação')) inActionTable = true
    else if (!line.startsWith('|')) inActionTable = false
    if (inActionTable && line.split(/(?<!\\)\|/).length - 2 !== 8) {
      addError(moduleDocument, 'action row must contain eight cells; escape literal pipes')
    }
  }
}

const routeSources = ['src/AppInterno.tsx', 'src/AppPortal.tsx']
const appRoutes = [...new Set(routeSources.flatMap((routeSource) =>
  extractDocRoutes(read(routeSource), routeSource).map((route) => route.path),
))]
const architecture = read('docs/ARCHITECTURE.md')

for (const route of appRoutes) {
  if (!architecture.includes(`\`${route}\``)) {
    addError('docs/ARCHITECTURE.md', `route from AppInterno/AppPortal is not documented: ${route}`)
  }
}

const traceabilityPath = path.join(root, 'docs', 'RASTREABILIDADE.md')
if (fs.existsSync(traceabilityPath)) {
  const traceability = fs.readFileSync(traceabilityPath, 'utf8')

  for (const route of appRoutes) {
    if (!traceability.includes(`\`${route}\``)) {
      addError('docs/RASTREABILIDADE.md', `route is not mapped: ${route}`)
    }
  }

  for (const evidenceLabel of ['Código', 'Teste', 'Runtime', 'Suspeita']) {
    if (!traceability.includes(`**${evidenceLabel}**`)) {
      addError('docs/RASTREABILIDADE.md', `evidence label is not defined: ${evidenceLabel}`)
    }
  }
}

const livingFiles = [
  'README.md',
  'WORKFLOW.md',
  'AGENTS.md',
  'docs/README.md',
  'docs/ARCHITECTURE.md',
  'docs/ROADMAP.md',
  'docs/operations/validacao.md',
  'docs/operations/reset-ambiente.md',
]

const staleClaims = [
  {
    pattern: /001_schema\.sql\s*(?:→|->)\s*053_security_hardening\.sql/i,
    message: 'fixed migration range ending at 053 is obsolete',
  },
  {
    pattern: /\b053 migrations\b/i,
    message: 'fixed migration count 053 is obsolete',
  },
  {
    pattern: /fallback(?: de)? token|token legacy em `sessionStorage`/i,
    message: 'legacy Portal token fallback is obsolete',
  },
  {
    pattern: /\bjspdf\b/i,
    message: 'jsPDF is not used; invoices print through the browser',
  },
]

for (const livingFile of livingFiles) {
  const absolutePath = path.join(root, livingFile)
  if (!fs.existsSync(absolutePath)) continue
  const content = fs.readFileSync(absolutePath, 'utf8')
  for (const claim of staleClaims) {
    if (claim.pattern.test(content)) addError(livingFile, claim.message)
  }
}

if (fs.existsSync(path.join(root, 'CLAUDE.md'))) {
  addError('AGENTS.md', 'agent guidance must live only in AGENTS.md; legacy root file still exists')
}

if (errors.length > 0) {
  console.error(`Documentation check failed with ${errors.length} issue(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(
    `Documentation checks passed: ${markdownFiles.length} Markdown files, ` +
    `${appRoutes.length} routes, and ADR index coverage verified.`,
  )
}
