// Regras estruturais da ADR 0082: status da ADR concorda com o índice, ADR
// estendida/supersedida tem faixa "Situação atual" e documento datado vive no
// arquivo histórico (ou é plano/spec vivo).

import { stripNonRendered } from './docs-anchors.mjs'

export const ADR_STATUSES = ['aceito', 'estendida', 'supersedida parcialmente', 'substituída', 'obsoleta']

// A linha pode abrir com o status ou trazê-lo depois de outro campo separado
// por "·" (ex.: "**Data:** 2026-10-13 · **Status:** aceito").
const statusPattern = new RegExp(
  `^(?:[^\\n]*·\\s*)?\\**Status:?\\**:?\\s*\\**\\s*(${ADR_STATUSES.join('|')})\\b`,
  'im',
)

// Cabeçalho da ADR: as linhas entre o título `# ` e a primeira seção `## `,
// fora de blocos de código e de comentários HTML. Status e faixa só valem ali;
// um exemplo no corpo, num bloco de código ou comentado não conta. Sem título,
// não há cabeçalho (null).
export function adrHeader(content) {
  const lines = stripNonRendered(content).split(/\r?\n/)
  const title = lines.findIndex((line) => /^# /.test(line))
  if (title < 0) return null
  const firstSection = lines.findIndex((line, index) => index > title && /^## /.test(line))
  return lines.slice(title + 1, firstSection < 0 ? undefined : firstSection)
}

export function adrFileStatus(content) {
  const header = adrHeader(content)
  const match = header?.join('\n').match(statusPattern)
  return match ? match[1].toLowerCase() : null
}

// A faixa abre a ADR: é a primeira linha não vazia depois do título, para o
// leitor ver o que mudou antes do contexto original (CONVENCOES.md).
export function hasSituationBanner(content) {
  const opening = adrHeader(content)?.find((line) => line.trim() !== '')
  return /^> \*\*Situação atual \(\d{4}-\d{2}-\d{2}\)\.\*\*/.test(opening ?? '')
}

export function adrNeedsBanner(status) {
  return status !== null && status !== 'aceito'
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim())
}

// Devolve { statuses: Map<"0001-titulo.md", status>, duplicates: [arquivo] }
// a partir da tabela do índice, pela
// chave do arquivo linkado na primeira coluna: duas ADRs com o mesmo número
// não dividem uma linha. A coluna é achada pelo cabeçalho "Status", para o
// índice poder ganhar colunas sem quebrar o gate.
export function parseAdrIndex(markdown) {
  const statuses = new Map()
  const duplicates = []
  let statusColumn = -1
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) {
      statusColumn = -1
      continue
    }
    const cells = splitRow(line)
    if (cells[0] === 'ADR' && cells.includes('Status')) {
      statusColumn = cells.indexOf('Status')
      continue
    }
    if (statusColumn < 0) continue
    const link = cells[0].match(/\]\((?:\.\/)?(\d{4}-[^)\s]+\.md)\)/)
    if (!link) continue
    // Duas linhas para a mesma ADR mostrariam dois status; a segunda não
    // pode sobrescrever a primeira em silêncio.
    if (statuses.has(link[1])) duplicates.push(link[1])
    else statuses.set(link[1], (cells[statusColumn] ?? '').toLowerCase())
  }
  return { statuses, duplicates }
}

export function isDatedLivingDocument(relativePath) {
  if (/^docs\/(archive|plans|spec)\//.test(relativePath)) return false
  const name = relativePath.split('/').pop() ?? ''
  return /\.mdx?$/i.test(name) && /\d{4}-\d{2}-\d{2}/.test(name)
}
