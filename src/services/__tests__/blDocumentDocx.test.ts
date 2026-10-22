import { describe, expect, it } from 'vitest'
import { extractDocumentXmlTextBlocks } from '../blDocumentDocx'

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const textBox = (...paragraphs: string[]) => `<w:txbxContent>${paragraphs.join('')}</w:txbxContent>`
const lines = (xml: string) => extractDocumentXmlTextBlocks(xml).map((block) => block.lines)

// Folga larga para não oscilar em CI; a leitura quadrática destes documentos
// levaria minutos.
const TIME_LIMIT_MS = 2_000

function timed<T>(run: () => T): { result: T; ms: number } {
  const started = performance.now()
  const result = run()
  return { result, ms: performance.now() - started }
}

describe('extractDocumentXmlTextBlocks — documento malformado ou grande', () => {
  it('lê caixas de texto aninhadas e ignora a cópia de compatibilidade (mc:Fallback)', () => {
    const xml = `<w:body>${textBox(paragraph('SHIPPER'), paragraph('ACME &amp; CO'))}`
      + `<mc:Fallback>${textBox(paragraph('SHIPPER'))}</mc:Fallback>`
      + `${textBox(paragraph('CONSIGNEE'), `<w:p><w:r><w:t>A</w:t><w:instrText>PAGE</w:instrText><w:t xml:space="preserve"> B</w:t></w:r></w:p>`)}</w:body>`
    expect(lines(xml)).toEqual([['SHIPPER', 'ACME & CO'], ['CONSIGNEE', 'A B']])
  })

  it('muitas aberturas sem fechamento não ficam quadráticas', () => {
    const count = 200_000
    const unclosedParagraphs = paragraph('ANTES') + '<w:p>'.repeat(count)
    const unclosedRuns = `<w:p>${'<w:t>X'.repeat(count)}</w:p>`
    const unclosedBreaks = `<w:p><w:t>Y</w:t>${'<w:br '.repeat(count)}</w:p>`
    const unclosedFieldCodes = `<w:p><w:t>Z</w:t>${'<w:instrText>'.repeat(count)}</w:p>`
    const nestedBoxes = '<w:txbxContent>'.repeat(count) + paragraph('FUNDO') + '</w:txbxContent>'.repeat(count)
    const unclosedFallback = paragraph('FORA') + '<mc:Fallback>'.repeat(count)

    const { result, ms } = timed(() => [
      lines(unclosedParagraphs),
      lines(unclosedRuns),
      lines(unclosedBreaks),
      lines(unclosedFieldCodes),
      lines(nestedBoxes),
      lines(unclosedFallback),
    ])

    expect(ms).toBeLessThan(TIME_LIMIT_MS)
    expect(result).toEqual([
      [['ANTES']],
      [],
      [['Y']],
      [['Z']],
      [['FUNDO']],
      [['FORA']],
    ])
  })

  it('referência numérica fora do Unicode vira U+FFFD em vez de abortar a leitura', () => {
    const xml = paragraph('A&#1114112;B&#x110000;C&#xD800;D&#0;E&#99999999999999999999;F&#65;&#x42;')
    expect(lines(xml)).toEqual([['A�B�C�D�E�FAB']])
  })
})
