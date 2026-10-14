// Regras estruturais da ADR 0082: status da ADR concorda com o índice, ADR
// estendida/supersedida tem faixa "Situação atual" e documento datado vive no
// arquivo histórico (ou é plano/spec vivo).

export const ADR_STATUSES = ['aceito', 'estendida', 'supersedida parcialmente', 'substituída', 'obsoleta']

// A linha pode abrir com o status ou trazê-lo depois de outro campo separado
// por "·" (ex.: "**Data:** 2026-10-13 · **Status:** aceito").
const statusPattern = new RegExp(
  `^(?:[^\\n]*·\\s*)?\\**Status:?\\**:?\\s*\\**\\s*(${ADR_STATUSES.join('|')})\\b`,
  'im',
)

export function adrFileStatus(content) {
  const match = content.match(statusPattern)
  return match ? match[1].toLowerCase() : null
}

// A faixa abre a ADR: é a primeira linha não vazia depois do título, para o
// leitor ver o que mudou antes do contexto original (CONVENCOES.md).
export function hasSituationBanner(content) {
  const lines = content.split(/\r?\n/)
  const title = lines.findIndex((line) => /^# /.test(line))
  const opening = lines.slice(title + 1).find((line) => line.trim() !== '')
  return /^> \*\*Situação atual \(\d{4}-\d{2}-\d{2}\)\.\*\*/.test(opening ?? '')
}

export function adrNeedsBanner(status) {
  return status !== null && status !== 'aceito'
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim())
}

// Devolve Map<"0001", status> a partir da tabela do índice. A coluna é achada
// pelo cabeçalho "Status", para o índice poder ganhar colunas sem quebrar o gate.
export function parseAdrIndex(markdown) {
  const statuses = new Map()
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
    const number = cells[0].match(/\[(\d{4})\]/)
    if (number) statuses.set(number[1], (cells[statusColumn] ?? '').toLowerCase())
  }
  return statuses
}

export function isDatedLivingDocument(relativePath) {
  if (/^docs\/(archive|plans|spec)\//.test(relativePath)) return false
  const name = relativePath.split('/').pop() ?? ''
  return /\.mdx?$/i.test(name) && /\d{4}-\d{2}-\d{2}/.test(name)
}
