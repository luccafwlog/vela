#!/usr/bin/env node
// Check de cobertura do Manual do Operador (plano
// docs/plans/2026-10-26-manual-do-operador.md, Etapa 1.6).
//
// Extrai de novo o inventário do sistema (scripts/manual/inventory.mjs) e
// falha quando:
// - um item do inventário não é citado em docs/manual/cobertura/*.md (tela,
//   função, regra automática, restrição, rotina, alerta, e-mail, mensagem…);
// - a cobertura cita um item que não existe mais no sistema;
// - uma linha de Regras ou Mensagens usa destino fora da lista do plano.
//
// Uma tela, regra ou alerta novo quebra este check até ganhar lugar no manual.
//
//   Uso: LOCAL_DATABASE_URL=... npm run manual:coverage
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectInventory } from './inventory.mjs'

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const coverageDir = path.join(root, 'docs', 'manual', 'cobertura')
const KINDS = ['rota', 'servidor', 'email', 'permissao', 'funcao', 'gatilho', 'restricao', 'unico', 'politica', 'rotina', 'alerta', 'parametro', 'arquivo']
const DESTINATION = /^(?:Op (?:[1-9]|1[0-7])|Ap\. [A-D]|Fin|Adm|Fora)$/

/** Linhas de tabela da seção `## <title>`, como listas de células. */
function sectionRows(markdown, title) {
  const rows = []
  let inside = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) inside = line.slice(3).trim() === title
    else if (inside && line.startsWith('|') && !/^\|\s*-/.test(line)) {
      rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim()))
    }
  }
  return rows.slice(1) // sem o cabeçalho
}

const files = fs.existsSync(coverageDir)
  ? fs.readdirSync(coverageDir).filter((name) => name.endsWith('.md')).sort()
  : []
const cited = new Map()
const listedMessages = new Map()
const errors = []

for (const name of files) {
  const relative = `docs/manual/cobertura/${name}`
  const markdown = fs.readFileSync(path.join(coverageDir, name), 'utf8')
  for (const [, token] of markdown.matchAll(/`([^`]+)`/g)) {
    if (!cited.has(token)) cited.set(token, relative)
  }
  for (const [title, column] of [['Regras', 2], ['Mensagens', 2]]) {
    for (const cells of sectionRows(markdown, title)) {
      const destination = cells[column] ?? ''
      for (const code of destination.split(';').map((part) => part.trim()).filter(Boolean)) {
        if (!DESTINATION.test(code)) errors.push(`${relative}: destino desconhecido "${code}" na linha "${cells[0]}"`)
      }
      if (!destination.trim()) errors.push(`${relative}: linha sem destino "${cells[0]}"`)
    }
  }
  for (const cells of sectionRows(markdown, 'Mensagens')) {
    const message = cells[0]?.match(/^`([^`]+)`$/)?.[1]
    if (message) listedMessages.set(message, relative)
  }
}

const inventory = collectInventory()
const ids = new Set(inventory.map((item) => item.id))
const messages = new Set(inventory.filter((item) => item.kind === 'mensagem').map((item) => item.name))
const missing = inventory.filter((item) => !(cited.has(item.id) || (item.kind === 'mensagem' && cited.has(item.name))))

for (const item of missing) {
  errors.push(`sem lugar no manual: ${item.kind === 'mensagem' ? `mensagem "${item.name}"` : item.id}`)
}
for (const [token, file] of cited) {
  const kind = token.split(':', 1)[0]
  if (KINDS.includes(kind) && token.includes(':') && !ids.has(token)) {
    errors.push(`${file}: cita ${token}, que não existe mais no sistema`)
  }
}
for (const [message, file] of listedMessages) {
  if (!messages.has(message)) errors.push(`${file}: mensagem "${message}" não existe mais no sistema`)
}

const byKind = inventory.reduce((acc, item) => ({ ...acc, [item.kind]: (acc[item.kind] ?? 0) + 1 }), {})
const summary = Object.entries(byKind).map(([kind, count]) => `${kind} ${count}`).join(' · ')
if (errors.length) {
  console.error(errors.join('\n'))
  console.error(`\nCobertura do manual: ${inventory.length - missing.length}/${inventory.length} itens com lugar; ${errors.length} problema(s).`)
  process.exit(1)
}
console.log(`Cobertura do manual: ${inventory.length}/${inventory.length} itens com lugar em ${files.length} arquivo(s) (${summary}).`)
