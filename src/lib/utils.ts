import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatCnpj as formatCanonicalCnpj } from './cnpj'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Remove caracteres que podem alterar o parser de filtros do PostgREST
// (vírgula, parênteses, ponto, dois-pontos, aspas, asterisco, barra) ou os
// curingas do LIKE (% e _). Evita injeção de filtro e enumeração/DoS via
// curingas em chamadas .or()/.ilike() que interpolam input do usuário.
export function escapeFilterTerm(value: string) {
  return value.replace(/[%_,.():*"\\]/g, ' ').trim()
}

// Para uso em .ilike(coluna, valor): o valor é parametrizado pelo PostgREST,
// então só os curingas do LIKE (% _) e a barra de escape representam risco
// (enumeração via `_`, varredura completa via `%`). Mantém o restante da
// pontuação do termo, ao contrário de escapeFilterTerm (usado em .or()).
export function sanitizeLikeTerm(value: string) {
  return value.replace(/[%_\\]/g, '').trim()
}

export function formatBRL(value?: number | string | null) {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(amount) ? amount : 0)
}

export function formatCountLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function formatUSD(value?: number | string | null) {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)
}

export function formatDate(value?: string | null) {
  if (!value) return '-'

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch
    return `${day}/${month}/${year}`
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value))
}

export function splitIsoDateTime(value?: string | null): { date: string; time: string } {
  if (!value) return { date: '', time: '' }
  const trimmed = value.trim()
  if (!trimmed) return { date: '', time: '' }

  const dateOnlyMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/)
  if (dateOnlyMatch) return { date: dateOnlyMatch[1], time: '' }

  // Valor com fuso (timestamptz, ex. atracação) é um instante: exibe a hora de
  // Brasília. Sem fuso, é a hora de parede digitada e fica como está.
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(trimmed) && /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(trimmed)) {
    const instant = new Date(trimmed.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
    if (!Number.isNaN(instant.getTime())) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(instant).map((part) => [part.type, part.value]))
      return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
    }
  }

  const dateTimeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/)
  if (dateTimeMatch) return { date: dateTimeMatch[1], time: dateTimeMatch[2] }

  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear()
    const month = String(parsed.getMonth() + 1).padStart(2, '0')
    const day = String(parsed.getDate()).padStart(2, '0')
    const hours = String(parsed.getHours()).padStart(2, '0')
    const mins = String(parsed.getMinutes()).padStart(2, '0')
    return { date: `${year}-${month}-${day}`, time: `${hours}:${mins}` }
  }

  return { date: trimmed.slice(0, 10), time: '' }
}

export function combineIsoDateTime(date: string, time?: string | null): string | null {
  const cleanDate = date.trim()
  if (!cleanDate) return null
  const cleanTime = (time ?? '').trim()
  if (!cleanTime) return cleanDate
  return `${cleanDate}T${cleanTime}:00`
}

// Atracação (ETB/ATB/ETD/ATD) é gravada como timestamptz: a hora digitada é de
// Brasília e precisa levar o fuso, senão o banco a lê como UTC (3 h de erro).
// ponytail: fuso fixo -03:00; o Brasil não tem horário de verão desde 2019.
export function combineBrasiliaDateTime(date: string, time?: string | null): string | null {
  const combined = combineIsoDateTime(date, time)
  return combined && combined.includes('T') ? `${combined}-03:00` : combined
}

export function formatDateTimeBR(value?: string | null): string {
  if (!value) return '-'
  const { date, time } = splitIsoDateTime(value)
  if (!date) return '-'
  const formattedDate = formatDate(date)
  if (!time) return formattedDate
  return `${formattedDate} às ${time}`
}

// Timestamps de auditoria só são conferíveis com a hora: dois eventos no mesmo
// dia ficam indistinguíveis quando a UI mostra apenas a data.
export function formatDateTime(value?: string | null) {
  if (!value) return '-'
  if (isDateOnly(value)) return formatDate(value)

  return formatDateTimeBR(value)
}

export function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function formatDateOnlyToBRShort(value: string) {
  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!dateOnlyMatch) return null
  const [, , month, day] = dateOnlyMatch
  return `${day}/${month}`
}

export function formatShortDateSafe(value?: string | null) {
  if (!value) return '-'

  const shortDate = formatDateOnlyToBRShort(value)
  if (shortDate) return shortDate

  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(value))
}

export function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

export function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function onlyDigits(value?: string | null) {
  return (value ?? '').replace(/\D/g, '')
}

// Gera uma senha forte aleatoria (sem caracteres ambiguos) para o sistema
// provisionar acesso ao portal sem o operador precisar definir/ver senha fixa.
export function generateStrongPassword(length = 16) {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_'
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  let result = ''
  for (let index = 0; index < length; index += 1) {
    result += charset[values[index] % charset.length]
  }
  return result
}

export function formatCnpjCpf(value?: string | null) {
  return formatCanonicalCnpj(value)
}

export function asString(value: unknown) {
  return String(value ?? '').trim()
}

export function toNumber(value: unknown) {
  // Legado fora de import: mantém strip de letras/inferência (ex.: '1e3' vira
  // 13). Código novo de import usa parseImportNumber (src/lib/importNumber.ts).
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/[A-Z]+/gi, '')
    .replace(/\s+/g, '')

  if (!cleaned) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  const decimalSeparator = lastComma > lastDot ? ',' : lastDot > -1 ? '.' : ''
  const normalized = decimalSeparator
    ? cleaned
        .replace(new RegExp(`\\${decimalSeparator === ',' ? '.' : ','}`, 'g'), '')
        .replace(decimalSeparator, '.')
    : cleaned
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

export function chunkArray<T>(values: T[], chunkSize: number) {
  if (!values.length) return []
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }
  return chunks
}

// Remove o prefixo redundante "BL <id> - " da descricao de um item de fatura,
// usado tanto no PDF quanto no detalhe da invoice (o B/L ja aparece em coluna propria).
export function stripBlPrefix(description: string | null | undefined, blId: string | null | undefined): string {
  if (!description) return ''
  if (!blId) return description
  const prefix = `BL ${blId} - `
  return description.startsWith(prefix) ? description.slice(prefix.length) : description
}

// `voyages.id` e uma chave surrogate: o operador reconhece a viagem por
// "navio / numero da viagem". `voyageDisplayName` devolve a chave natural (ou
// null, quando nem o navio nem o numero vieram) e `voyageLabel` acrescenta o
// fallback para o id, para a tela nunca ficar vazia.
export function voyageDisplayName(
  vesselName: string | null | undefined,
  voyageNumber: string | null | undefined,
): string | null {
  const label = [vesselName?.trim(), voyageNumber?.trim()].filter(Boolean).join(' / ')
  return label || null
}

export function voyageLabel(
  vesselName: string | null | undefined,
  voyageNumber: string | null | undefined,
  voyageId: string | number | null | undefined,
): string {
  return voyageDisplayName(vesselName, voyageNumber)
    ?? (voyageId == null ? 'Viagem' : `Viagem ${voyageId}`)
}
