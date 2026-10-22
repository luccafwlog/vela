// Extração de texto de um B/L em .docx (modelo de formulário preenchido em
// caixas de texto sobre a imagem do B/L em branco). Módulo de leitura pura:
// devolve os blocos de texto na ordem do documento, sem regra de negócio —
// a identificação dos campos vive em blDocumentParser.ts.
import { readZipTextEntry } from '../lib/zipEntry'
import type { BlTextBlock } from './blDocumentSource'

const DOCUMENT_ENTRY = 'word/document.xml'

/**
 * Lê os blocos de texto do .docx na ordem do documento.
 *
 * O modelo de B/L em Word não tem rótulos legíveis: o formulário é uma imagem
 * e cada campo é uma caixa de texto posicionada sobre ela. Por isso o que
 * importa aqui é preservar a fronteira de cada caixa (um campo por bloco) e a
 * ordem em que aparecem, que é o que blDocumentParser usa para separar
 * shipper, consignee e notify.
 */
export async function extractDocxTextBlocks(buffer: ArrayBuffer): Promise<BlTextBlock[]> {
  return extractDocumentXmlTextBlocks(await readZipTextEntry(buffer, DOCUMENT_ENTRY))
}

/** Blocos de texto do `word/document.xml` já extraído (exportado para teste). */
export function extractDocumentXmlTextBlocks(documentXml: string): BlTextBlock[] {
  const xml = stripAlternateContentFallbacks(documentXml)
  const textBoxes = extractTextBoxBlocks(xml)
  const blocks = textBoxes.length ? textBoxes : extractParagraphBlocks(xml)
  return blocks
    .map((lines, index) => toBlock(lines, index))
    .filter((block): block is BlTextBlock => block !== null)
    .map((block, index) => ({ ...block, order: index }))
}

function toBlock(lines: string[], order: number): BlTextBlock | null {
  const cleaned = lines.map((line) => normalizeSpaces(line))
  const meaningful = cleaned.filter((line) => line.length > 0)
  if (!meaningful.length) return null
  return { order, page: 1, x: null, y: null, lines: meaningful, text: meaningful.join('\n') }
}

/**
 * Word grava a mesma caixa de texto duas vezes: `mc:Choice` (DrawingML) e
 * `mc:Fallback` (VML, para leitores antigos). Ler as duas duplicaria todo
 * campo do B/L, então a cópia de compatibilidade sai antes do parse.
 */
function stripAlternateContentFallbacks(xml: string) {
  const parts: string[] = []
  let cursor = 0

  for (;;) {
    const start = xml.indexOf('<mc:Fallback>', cursor)
    if (start < 0) {
      parts.push(xml.slice(cursor))
      return parts.join('')
    }

    parts.push(xml.slice(cursor, start))
    const end = findClosingTag(xml, start, '<mc:Fallback', '</mc:Fallback>')
    if (end < 0) return parts.join('') + xml.slice(start)
    cursor = end
  }
}

function extractTextBoxBlocks(xml: string) {
  const blocks: string[][] = []
  let cursor = 0

  for (;;) {
    const open = xml.indexOf('<w:txbxContent>', cursor)
    if (open < 0) return blocks

    const close = findClosingTag(xml, open, '<w:txbxContent', '</w:txbxContent>')
    if (close < 0) return blocks

    blocks.push(extractParagraphBlocks(xml.slice(open, close)).flat())
    cursor = close
  }
}

// O arquivo vem do usuário: toda varredura abaixo anda só para a frente. Uma
// regex preguiçosa (`<w:p>[\s\S]*?</w:p>`) sem o fechamento reexamina o resto
// do texto a cada abertura e fica quadrática num documento malformado.

/**
 * Cada `<name …>conteúdo</name>` sem aninhamento, na semântica da regex
 * `<name(?:\s[^>]*)?>([\s\S]*?)</name>`: o conteúdo vai até o primeiro
 * fechamento. Sem fechamento adiante, nenhuma abertura posterior fecha, e a
 * varredura para. `bareOpen`: a abertura é só o prefixo `<name`, sem exigir o
 * fim da tag (como `<w:instrText[\s\S]*?</w:instrText>`).
 */
function forEachElement(
  xml: string,
  name: string,
  visit: (element: { start: number; contentStart: number; contentEnd: number; end: number }) => void,
  options: { bareOpen?: boolean } = {},
) {
  const openTag = `<${name}`
  const closeTag = `</${name}>`
  let cursor = 0
  for (;;) {
    const start = xml.indexOf(openTag, cursor)
    if (start < 0) return
    let contentStart = start + openTag.length
    if (!options.bareOpen) {
      const next = xml.charAt(contentStart)
      if (next === '>') {
        contentStart += 1
      } else if (/\s/.test(next)) {
        const tagEnd = xml.indexOf('>', contentStart)
        if (tagEnd < 0) return
        contentStart = tagEnd + 1
      } else {
        // `<w:pPr>`, `<w:tbl>`: outro elemento com o mesmo prefixo.
        cursor = start + 1
        continue
      }
    }
    const contentEnd = xml.indexOf(closeTag, contentStart)
    if (contentEnd < 0) return
    const end = contentEnd + closeTag.length
    visit({ start, contentStart, contentEnd, end })
    cursor = end
  }
}

function extractParagraphBlocks(xml: string) {
  const paragraphs: string[][] = []
  forEachElement(xml, 'w:p', ({ contentStart, contentEnd }) => {
    paragraphs.push([paragraphText(xml.slice(contentStart, contentEnd))])
  })
  return paragraphs
}

/** Troca `<w:br …>` e `<w:tab …>` (até o próximo `>`) por um espaço. */
function replaceBreaksAndTabs(xml: string) {
  const parts: string[] = []
  let cursor = 0
  let search = 0
  for (;;) {
    const start = xml.indexOf('<w:', search)
    if (start < 0) break
    const name = xml.startsWith('br', start + 3) ? 'br' : xml.startsWith('tab', start + 3) ? 'tab' : null
    const after = name ? xml.charAt(start + 3 + name.length) : ''
    if (!name || /\w/.test(after)) {
      search = start + 1
      continue
    }
    const tagEnd = xml.indexOf('>', start + 3 + name.length)
    if (tagEnd < 0) break
    parts.push(xml.slice(cursor, start), ' ')
    cursor = tagEnd + 1
    search = cursor
  }
  parts.push(xml.slice(cursor))
  return parts.join('')
}

function paragraphText(paragraphXml: string) {
  const withoutFieldCodes: string[] = []
  let cursor = 0
  forEachElement(paragraphXml, 'w:instrText', ({ start, end }) => {
    withoutFieldCodes.push(paragraphXml.slice(cursor, start))
    cursor = end
  }, { bareOpen: true })
  withoutFieldCodes.push(paragraphXml.slice(cursor))
  const withBreaks = replaceBreaksAndTabs(withoutFieldCodes.join(''))
  const runs: string[] = []
  forEachElement(withBreaks, 'w:t', ({ contentStart, contentEnd }) => {
    runs.push(decodeXmlEntities(withBreaks.slice(contentStart, contentEnd)))
  })
  return runs.join('')
}

/**
 * Avança até o fechamento do bloco, respeitando aninhamento do mesmo elemento.
 * Cada busca recomeça depois da anterior, então o custo é uma passada.
 */
function findClosingTag(xml: string, from: number, openTag: string, closeTag: string) {
  let depth = 0
  let nextOpen = xml.indexOf(openTag, from)
  let nextClose = xml.indexOf(closeTag, from)

  for (;;) {
    if (nextClose < 0) return -1

    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1
      nextOpen = xml.indexOf(openTag, nextOpen + openTag.length)
      continue
    }

    depth -= 1
    const cursor = nextClose + closeTag.length
    if (depth <= 0) return cursor
    nextClose = xml.indexOf(closeTag, cursor)
  }
}

/** Referência numérica fora do Unicode (ou substituto isolado, ou NUL) vira U+FFFD. */
function codePointText(code: number) {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd'
  return String.fromCodePoint(code)
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => codePointText(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => codePointText(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

// Espaço fixo e tabulação viram espaço comum, mas a sequência de espaços é
// preservada: no modelo em Word ela é a única separação entre duas colunas do
// formulário ("VITORIA,BRAZIL     THREE").
function normalizeSpaces(value: string) {
  return value.replace(/[\u00a0\u3000\t]/g, ' ').trim()
}
