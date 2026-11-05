// Arquivo de Retorno do Mercante (RETFWL…TXT): a resposta do Siscomex Mercante
// ao manifesto enviado. Traz o Nº do Manifesto e, por conhecimento, o CE
// emitido e o número do B/L — o que a planilha de CE informa à mão. Registros
// de largura fixa (1226 posições nos retornos conferidos em 2026-11-05):
//   M5 — manifesto: Nº nas posições 6–18; POL e POD (código do Mercante) em
//        1167–1171 e 1172–1176.
//   C5 — conhecimento: Nº do manifesto em 6–18, CE em 21–35, B/L a partir da
//        1182 (até 18 caracteres, o limite do número do B/L no Mercante).
//   I5 — item do conhecimento (contêiner, carga solta, veículo): não é lido.
//   V5 — contêiner vazio: o retorno de vazios não tem CE.
// ponytail: só as posições conferidas nos retornos de contêiner, carga solta
// e vazios do GREEN GUANGZHOU V.6. Upgrade: se o Mercante trouxer outro layout,
// ler a versão do arquivo e escolher as posições por ela.

export type RetornoMercanteEntry = {
  /** Linha do arquivo (base 1), para a prévia e os erros. */
  line: number
  manifesto: string
  ce: string
  bl: string
}

export type RetornoMercante = {
  manifesto: string
  /** POL e POD como o Mercante os escreve (ex.: CNQIN, não CNTAO). */
  pol: string
  pod: string
  entries: RetornoMercanteEntry[]
}

const field = (line: string, position: number, width: number) => line.slice(position - 1, position - 1 + width).trim()

const MANIFESTO = { position: 6, width: 13 }
const M5_POL = { position: 1167, width: 5 }
const M5_POD = { position: 1172, width: 5 }
const C5_CE = { position: 21, width: 15 }
const C5_BL = { position: 1182, width: 18 }

/**
 * Lê o Retorno Mercante. Recusa (lança) o que não é retorno de um manifesto de
 * carga: sem M5, mais de um M5, retorno de vazios, sem conhecimento ou C5 sem
 * o número do B/L. CE e B/L de cada C5 são conferidos depois, com as mesmas
 * regras da planilha (`ceMercanteImport.ts`).
 */
export function parseRetornoMercanteText(text: string): RetornoMercante {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const headers = lines.map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.startsWith('M5'))
  if (!headers.length) {
    throw new Error('O arquivo não é um Retorno Mercante: falta o registro do manifesto (M5).')
  }
  if (headers.length > 1) {
    const numbers = headers.map(({ line }) => field(line, MANIFESTO.position, MANIFESTO.width)).join(', ')
    throw new Error(`O Retorno tem mais de um manifesto (${numbers}). Importe um Retorno por manifesto.`)
  }
  const header = headers[0].line
  const manifesto = field(header, MANIFESTO.position, MANIFESTO.width).toUpperCase()
  const pol = field(header, M5_POL.position, M5_POL.width).toUpperCase()
  const pod = field(header, M5_POD.position, M5_POD.width).toUpperCase()

  const entries: RetornoMercanteEntry[] = []
  let vazios = 0
  lines.forEach((line, index) => {
    if (line.startsWith('V5')) vazios += 1
    if (!line.startsWith('C5')) return
    const bl = field(line, C5_BL.position, C5_BL.width).toUpperCase()
    if (!bl) {
      throw new Error(`Linha ${index + 1} do Retorno sem o número do B/L (posição ${C5_BL.position}). Confira se o arquivo é o Retorno Mercante completo.`)
    }
    entries.push({
      line: index + 1,
      manifesto: field(line, MANIFESTO.position, MANIFESTO.width).toUpperCase(),
      ce: field(line, C5_CE.position, C5_CE.width),
      bl,
    })
  })

  if (!entries.length) {
    throw new Error(vazios
      ? `Retorno do manifesto de vazios ${manifesto} (${vazios} ${vazios === 1 ? 'contêiner' : 'contêineres'}): vazio não tem CE, não há nada a importar aqui. O Nº de Manifesto dos vazios é informado na importação de vazios.`
      : `O Retorno do manifesto ${manifesto} não tem nenhum conhecimento (C5): não há CE a importar.`)
  }
  return { manifesto, pol, pod, entries }
}
