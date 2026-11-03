// Extração de NCM a partir de texto livre (descrição da carga do manifesto).
// Fonte da verdade do NCM é a descrição; este helper é reaproveitado pelo
// importador breakbulk e pela tela do B/L (evita divergência de regex).

const NCM_LABEL = /\bNCM(?:\s*(?:NO\.?|NUMBER|CODE))?\s*[:.]?[ \t]*/gi

// Lista que segue o rótulo: dígitos, pontos e separadores. Passa para a linha
// de baixo só quando a lista ainda não começou ("NCM:\n3926,...") ou quando a
// linha termina num separador ("8513/9617/\n8414/..."); assim uma linha seguinte
// que começa com número ("21 DAYS") não vira NCM.
// A lista que começa na linha de baixo do rótulo ("NCM:\n3926,4006") só vale se
// a linha for só de códigos: "NCM:\n2100 CARTONS" não vira o NCM 2100.
function readNcmList(text: string): string {
  let list = ''
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const run = /^[\d.,/;\s-]*/.exec(line)?.[0] ?? ''
    const startsWithLetter = run.length < line.length
    if (index > 0 && !list.trim() && startsWithLetter && !/[,/;]/.test(run)) break
    list += `${run} `
    const trimmed = list.trim()
    if (startsWithLetter || (trimmed && !/[,/;-]$/.test(trimmed))) break
  }
  return list
}

// Retorna os códigos NCM (somente dígitos) encontrados no texto, em ordem.
// Cada código é separado por vírgula, barra, ponto e vírgula, hífen ou espaço;
// os pontos internos ("8703.80.00") ficam no mesmo código. A lista não tem
// limite de tamanho (há B/L com 38 códigos). Exclui números UN de carga
// perigosa, que aparecem como "UN NCM.:3556".
export function extractNcmCodes(value: string): string[] {
  if (!value) return []
  const codes: string[] = []
  for (const match of value.matchAll(NCM_LABEL)) {
    const start = match.index ?? 0
    const preceding = value.slice(Math.max(0, start - 4), start)
    if (/\bUN\s$/i.test(preceding)) continue // "UN NCM." → número UN, não NCM
    const list = readNcmList(value.slice(start + match[0].length))
    for (const token of list.split(/[,/;\s-]+/)) {
      const digits = token.replace(/\D/g, '')
      if (digits.length >= 4 && digits.length <= 8) codes.push(digits)
    }
  }
  return codes
}

// Formata um código NCM (somente dígitos) para exibição: 8703.80.00 / 8703.80 / 2923.
// Nenhum dígito é descartado: o campo aceita de 4 a 8 dígitos (migration 358), e
// um código de 5 ou 7 formatado com perda voltava mais curto na próxima edição.
export function formatNcm(code: string): string {
  if (code.length <= 4) return code
  const groups = [code.slice(0, 4), code.slice(4, 6), code.slice(6)]
  return groups.filter(Boolean).join('.')
}

// Lista deduplicada e formatada de NCMs de uma descrição de carga (para a UI).
export function listBlNcms(cargoDescription: string | null | undefined): string[] {
  if (!cargoDescription) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const code of extractNcmCodes(cargoDescription)) {
    if (seen.has(code)) continue
    seen.add(code)
    result.push(formatNcm(code))
  }
  return result
}
