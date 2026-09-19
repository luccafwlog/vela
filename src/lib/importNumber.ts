// Fronteira numérica dos imports (S03 P0-1): parse explícito por formato
// declarado, sem remover letras nem inferir separador. Formato ausente nunca
// adivinha: devolve `ambiguous`. Devolve string decimal canônica (sem float)
// para o caller converter após validar precisão/faixa e regras de domínio.
export type ParsedNumber =
  | { kind: 'value'; decimal: string }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: 'syntax' | 'ambiguous' | 'non_finite' }

export type ImportNumberFormat = 'pt-BR' | 'en-US' | 'unknown'

export type ParseImportNumberOptions = {
  format?: ImportNumberFormat
  /** Desligado por padrão: `1e3` é sintaxe inválida, nunca 13 nem 1000. */
  allowExponent?: boolean
}

const NON_FINITE_PATTERN = /^[+-]?(inf(inity)?|nan)$/i
const EXPONENT_PATTERN = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))[eE]([+-]?\d+)$/
const PT_BR_PATTERN = /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/
const EN_US_PATTERN = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/
const GROUP_BODY = /^\d{1,3}$/
// ponytail: teto 1000 evita '0'.repeat() gigante em planilha hostil;
// expoente real de import cabe folgado aqui.
const MAX_EXPONENT = 1000

function normalizeZero(decimal: string): string {
  if (!decimal.startsWith('-')) return decimal
  return Number(decimal) === 0 ? '0' : decimal
}

function applyExponent(coefficient: string, exponent: number): string {
  const sign = coefficient.startsWith('-') ? '-' : ''
  const unsigned = coefficient.replace(/^[+-]/, '')
  const [intPart = '', fracPart = ''] = unsigned.split('.')
  const combined = intPart + fracPart
  const digits = combined.replace(/^0+/, '')
  if (!digits) return '0'
  const pointPos = intPart.length + exponent - (combined.length - digits.length)
  let result: string
  if (pointPos <= 0) result = `0.${'0'.repeat(-pointPos)}${digits}`
  else if (pointPos >= digits.length) result = digits + '0'.repeat(pointPos - digits.length)
  else result = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`
  if (result.includes('.')) result = result.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return normalizeZero(sign + result)
}

function canonicalize(unsigned: string, grouping: '.' | ',', decimalSep: '.' | ','): string {
  return unsigned.split(grouping).join('').split(decimalSep).join('.')
}

function splitSign(text: string): { sign: string; unsigned: string } {
  return text.startsWith('+') || text.startsWith('-')
    ? { sign: text[0] === '-' ? '-' : '', unsigned: text.slice(1) }
    : { sign: '', unsigned: text }
}

function parseBothSeparators(unsigned: string): ParsedNumber {
  const lastDot = unsigned.lastIndexOf('.')
  const lastComma = unsigned.lastIndexOf(',')
  const decimalSep = lastDot > lastComma ? '.' : ','
  const grouping: '.' | ',' = decimalSep === '.' ? ',' : '.'
  const cut = decimalSep === '.' ? lastDot : lastComma
  const intPart = unsigned.slice(0, cut)
  const fracPart = unsigned.slice(cut + 1)
  const groupingPattern = grouping === '.' ? /^\d{1,3}(?:\.\d{3})*$/ : /^\d{1,3}(?:,\d{3})*$/
  if (!intPart || !/^\d+$/.test(fracPart) || !groupingPattern.test(intPart)) {
    return { kind: 'invalid', reason: 'syntax' }
  }
  return { kind: 'value', decimal: canonicalize(unsigned, grouping, decimalSep) }
}

function parseSingleSeparator(sign: string, unsigned: string, sep: '.' | ','): ParsedNumber {
  const parts = unsigned.split(sep)
  if (parts.length === 2 && parts[0] !== '' && /^\d+$/.test(parts[0])) {
    if (parts[1].length === 3 && /^\d{3}$/.test(parts[1])) {
      return { kind: 'invalid', reason: 'ambiguous' }
    }
    if (/^\d+$/.test(parts[1])) {
      return { kind: 'value', decimal: normalizeZero(`${sign}${parts[0]}.${parts[1]}`) }
    }
    return { kind: 'invalid', reason: 'syntax' }
  }
  // Vários separadores só podem ser agrupamento (dois decimais é impossível).
  const grouped = parts.length > 2
    && GROUP_BODY.test(parts[0] ?? '')
    && parts.slice(1).every((part) => /^\d{3}$/.test(part))
  if (grouped) return { kind: 'value', decimal: normalizeZero(sign + parts.join('')) }
  return { kind: 'invalid', reason: 'syntax' }
}

function parseUnknown(text: string): ParsedNumber {
  const { sign, unsigned } = splitSign(text)
  if (/^\d+$/.test(unsigned)) return { kind: 'value', decimal: normalizeZero(sign + unsigned) }
  if (unsigned.includes('.') && unsigned.includes(',')) {
    const parsed = parseBothSeparators(unsigned)
    return parsed.kind === 'value' ? { ...parsed, decimal: normalizeZero(sign + parsed.decimal) } : parsed
  }
  if (unsigned.includes('.') || unsigned.includes(',')) {
    return parseSingleSeparator(sign, unsigned, unsigned.includes('.') ? '.' : ',')
  }
  return { kind: 'invalid', reason: 'syntax' }
}

export function parseImportNumber(
  value: unknown,
  formatOrOptions: ImportNumberFormat | ParseImportNumberOptions = 'unknown',
): ParsedNumber {
  const options: ParseImportNumberOptions =
    typeof formatOrOptions === 'string' ? { format: formatOrOptions } : formatOrOptions
  const format = options.format ?? 'unknown'

  if (value === null || value === undefined) return { kind: 'empty' }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { kind: 'invalid', reason: 'non_finite' }
    return { kind: 'value', decimal: normalizeZero(String(value)) }
  }
  if (typeof value !== 'string') return { kind: 'invalid', reason: 'syntax' }
  const text = value.trim()
  if (!text) return { kind: 'empty' }
  if (/\s/.test(text)) return { kind: 'invalid', reason: 'syntax' }
  if (NON_FINITE_PATTERN.test(text)) return { kind: 'invalid', reason: 'non_finite' }

  const exponent = text.match(EXPONENT_PATTERN)
  if (exponent) {
    if (!options.allowExponent) return { kind: 'invalid', reason: 'syntax' }
    const shift = Number(exponent[2])
    if (!Number.isSafeInteger(shift) || Math.abs(shift) > MAX_EXPONENT) {
      return { kind: 'invalid', reason: 'syntax' }
    }
    return { kind: 'value', decimal: applyExponent(exponent[1]!, shift) }
  }
  // String nunca perde letras para "virar número": 1e3/12abc/R$ são syntax.
  if (/[^0-9.,+-]/.test(text)) return { kind: 'invalid', reason: 'syntax' }

  const { sign, unsigned } = splitSign(text)
  if (!unsigned || /[+-]/.test(unsigned)) return { kind: 'invalid', reason: 'syntax' }

  if (format === 'pt-BR') {
    if (!PT_BR_PATTERN.test(text)) return { kind: 'invalid', reason: 'syntax' }
    return { kind: 'value', decimal: normalizeZero(sign + canonicalize(unsigned, '.', ',')) }
  }
  if (format === 'en-US') {
    if (!EN_US_PATTERN.test(text)) return { kind: 'invalid', reason: 'syntax' }
    return { kind: 'value', decimal: normalizeZero(sign + canonicalize(unsigned, ',', '.')) }
  }
  return parseUnknown(text)
}

/**
 * Texto numérico de uma célula de planilha, sem a unidade que venha colada.
 *
 * Existe para que a MESMA leitura valha em todo lugar. A ambiguidade de
 * separador era detectada sobre o valor cru e o número era parseado sobre o
 * valor sem a unidade: `"259.312 TON"` não casava a forma ambígua (por causa do
 * ` TON`), não entrava na evidência do arquivo (por causa do espaço e das
 * letras) e mesmo assim era lido como 259.312 — o ×1000 passava sem erro nem
 * aviso. Quem normaliza uma vez e usa o resultado nas três decisões não tem
 * como abrir essa fresta de novo.
 *
 * Devolve `null` quando não há nada numérico para ler.
 */
export function normalizeNumericText(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  return text.match(/^[+-]?\d[\d.,]*/)?.[0] ?? text
}

/**
 * Separador de milhar do formato — o que, seguido de exatamente três dígitos,
 * produz a forma que não dá para distinguir de um decimal.
 */
export function groupingSeparator(format: 'pt-BR' | 'en-US'): '.' | ',' {
  return format === 'pt-BR' ? '.' : ','
}

/**
 * `true` quando a célula tem UM separador só, ele é o separador de milhar do
 * formato em uso, e vêm exatamente três dígitos depois: `259.312` lido em
 * pt-BR, `259,312` lido em en-US.
 *
 * É a forma em que uma leitura errada não parece errada: 259,312 toneladas e
 * 259.312 toneladas são ambas plausíveis na tela, e a segunda vira uma taxa por
 * tonelada mil vezes maior. Quem chama decide o que fazer com isso; esta função
 * só diz que o número não se explica sozinho.
 */
export function isThousandsGroupShape(value: unknown, format: 'pt-BR' | 'en-US'): boolean {
  const text = normalizeNumericText(value)
  if (!text) return false
  const separator = groupingSeparator(format)
  const other = separator === '.' ? ',' : '.'
  if (text.includes(other)) return false
  return new RegExp(`^[+-]?\\d+\\${separator}\\d{3}$`).test(text)
}

/**
 * Descobre, olhando a coluna inteira, qual separador decimal a planilha usa.
 *
 * Existe porque fixar um formato é o pior dos mundos: com `pt-BR` fixo, um
 * arquivo em notação inglesa entra multiplicado por mil sem erro nenhum
 * (`259.312` t vira 259.312 t); com `unknown` puro, toda célula da forma
 * `123.456` vira erro, inclusive num arquivo pt-BR legítimo. A saída é decidir
 * pela evidência do próprio arquivo, nunca por suposição:
 *
 * - célula com os dois separadores: o da direita é o decimal;
 * - célula com um separador seguido de um número de dígitos diferente de 3:
 *   aquele separador é decimal (grupo de milhar tem exatamente três).
 *
 * Sem evidência — toda célula é inteira ou tem a forma ambígua `123.456` — e
 * também quando a evidência se contradiz, devolve `'unknown'`. Aí o chamador
 * tem de transformar a ambiguidade em erro explícito; adivinhar é justamente o
 * que esta função se recusa a fazer.
 */
export function inferSeparatorFormat(values: readonly unknown[]): ImportNumberFormat {
  let decided: ImportNumberFormat | null = null

  for (const value of values) {
    // Normaliza antes de julgar: a unidade colada (`"1.217,11 CBM"`) não pode
    // mais fazer a célula desaparecer da evidência do arquivo.
    const text = normalizeNumericText(value)
    if (!text || /[^0-9.,+-]/.test(text)) continue

    const evidence = separatorEvidence(text)
    if (!evidence) continue
    if (decided && decided !== evidence) return 'unknown'
    decided = evidence
  }

  return decided ?? 'unknown'
}

function separatorEvidence(text: string): ImportNumberFormat | null {
  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) return lastDot > lastComma ? 'en-US' : 'pt-BR'

  const separatorIndex = Math.max(lastDot, lastComma)
  if (separatorIndex < 0) return null

  const fraction = text.slice(separatorIndex + 1)
  // Três dígitos depois do separador é exatamente o caso ambíguo: pode ser
  // milhar (1.234) ou decimal (259.312). Não é evidência de nada.
  if (!/^\d+$/.test(fraction) || fraction.length === 3) return null

  return lastDot >= 0 ? 'en-US' : 'pt-BR'
}
