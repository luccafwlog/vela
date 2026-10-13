// Catraca da identidade visual (ADR 0081). Falha quando um arquivo TSX ganha
// cor solta, tamanho fora da escala, caixa alta, cor do Tailwind ou a fonte de
// marca, ou quando src/index.css ganha regras numa família de página. A linha
// de base (scripts/design-baseline.json) guarda o que já existia e só desce:
// ao migrar uma tela, rode `npm run design:check -- --update`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare, countCssFamilies, countTsx } from './lib/design-rules.mjs'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const baselinePath = path.join(root, 'scripts/design-baseline.json')
// Peças comuns da identidade: podem crescer sem atualizar a linha de base.
const SHARED_FAMILIES = new Set(['app-block', 'app-lead', 'app-facts', 'app-identity', 'app-next', 'app-no'])

function walk(dir, ext, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      walk(full, ext, files)
    } else if (entry.name.endsWith(ext) && !/\.test\.tsx$/.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

const rel = (file) => path.relative(root, file).split(path.sep).join('/')

function measure() {
  const tsx = {}
  for (const file of walk(path.join(root, 'src'), '.tsx').sort()) {
    const counts = countTsx(fs.readFileSync(file, 'utf8'))
    if (Object.keys(counts).length) tsx[rel(file)] = counts
  }
  // Toda folha de estilo de src/ entra: um .css novo importado por uma tela
  // não escapa da catraca. Arquivo sem regra de classe (fontes) não aparece.
  const css = {}
  for (const file of walk(path.join(root, 'src'), '.css').sort()) {
    const families = countCssFamilies(fs.readFileSync(file, 'utf8'))
    const pageFamilies = Object.fromEntries(Object.entries(families).filter(([family]) => !SHARED_FAMILIES.has(family)).sort())
    if (Object.keys(pageFamilies).length) css[rel(file)] = pageFamilies
  }
  return { tsx, css }
}

const current = measure()
const flatten = (data) => ({ ...data.tsx, ...data.css })

if (process.argv.includes('--update')) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`Linha de base atualizada em ${path.relative(root, baselinePath)}.`)
  process.exit(0)
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const { increases, decreases } = compare(flatten(baseline), flatten(current))

if (decreases.length) {
  console.log(`Melhorou em ${decreases.length} ponto(s) desde a linha de base; rode \`npm run design:check -- --update\` para travar o ganho.`)
}

if (increases.length) {
  console.error('A identidade visual (docs/identidade-visual.md) foi violada:')
  for (const { scope, key, previous, value } of increases) {
    const what = scope.endsWith('.css')
      ? `família de CSS "${key}" foi de ${previous} para ${value} regra(s); componha as peças comuns em vez de criar CSS de página`
      : `"${key}" foi de ${previous} para ${value}`
    console.error(`- ${scope}: ${what}`)
  }
  console.error('Use tokens --app-*, a escala de letra e as peças de src/components/ui/. Uma peça comum nova é registrada no documento da identidade antes de atualizar a linha de base.')
  process.exitCode = 1
} else {
  console.log('Identidade visual: nenhuma violação nova.')
}
