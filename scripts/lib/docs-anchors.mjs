// Leitura de Markdown para o gate: o documento é lido por um parser CommonMark
// com GFM (o mesmo dialeto do GitHub), e as âncoras de seção usam o
// `github-slugger`, que é o algoritmo do GitHub. Assim, blocos de código,
// comentários HTML, código inline e ênfase têm o mesmo tratamento da página
// renderizada, sem expressão regular para cada caso de borda.
import GithubSlugger from 'github-slugger'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { toString } from 'mdast-util-to-string'
import { gfm } from 'micromark-extension-gfm'
import { visit } from 'unist-util-visit'

// O gate lê o mesmo arquivo para links, âncoras e cabeçalho de ADR: a árvore
// fica guardada pelo texto, e só é lida de novo se o texto mudar.
const trees = new Map()

export function parseMarkdown(markdown) {
  if (!trees.has(markdown)) {
    trees.set(markdown, fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }))
  }
  return trees.get(markdown)
}

const isComment = (node) => node.type === 'html' && node.value.trimStart().startsWith('<!--')

// Remove do texto os trechos dos nós escolhidos, de trás para a frente para os
// offsets continuarem válidos.
function stripNodes(markdown, predicate) {
  const ranges = []
  visit(parseMarkdown(markdown), (node) => {
    if (!predicate(node)) return undefined
    ranges.push([node.position.start.offset, node.position.end.offset])
    return 'skip'
  })
  let text = markdown
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, start) + text.slice(end)
  }
  return text
}

export function stripCodeFences(markdown) {
  return stripNodes(markdown, (node) => node.type === 'code')
}

// O que não aparece na página renderizada: blocos de código e comentários
// HTML (inclusive de várias linhas). Um `<!--` dentro de bloco de código é
// texto do bloco, não abre comentário.
export function stripNonRendered(markdown) {
  return stripNodes(markdown, (node) => node.type === 'code' || isComment(node))
}

// Destinos dos links e imagens renderizados, inclusive os de referência
// (`[texto][ref]` + `[ref]: destino`). Link em código ou comentário não conta.
export function markdownLinks(markdown) {
  const targets = []
  visit(parseMarkdown(markdown), (node) => {
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') targets.push(node.url)
  })
  return targets
}

export function githubSlug(heading) {
  return new GithubSlugger().slug(toString(parseMarkdown(heading), { includeHtml: false }))
}

// Títulos na ordem do documento, com o sufixo -N de repetição do GitHub, e as
// âncoras explícitas `<a id>`/`<a name>` fora de código e comentários.
export function headingAnchors(markdown) {
  const anchors = new Set()
  const slugger = new GithubSlugger()
  visit(parseMarkdown(markdown), (node) => {
    if (node.type === 'heading') anchors.add(slugger.slug(toString(node, { includeHtml: false })))
    if (node.type === 'html' && !isComment(node)) {
      for (const match of node.value.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1])
    }
  })
  return anchors
}

export function anchorExists(anchors, fragment) {
  let decoded
  try {
    decoded = decodeURIComponent(fragment)
  } catch {
    return false
  }
  // O navegador compara o fragmento com o id exatamente; `#Notas` não leva a `notas`.
  return anchors.has(decoded)
}
