// Regras de apresentação comuns às importações (etapa 04). Só formatam o que o
// parser e o importador já decidiram; nenhuma regra de leitura vive aqui.
import { MAX_UPLOAD_BYTES } from '../../lib/fileGuard'
import type { ImportIssue } from '../../services/importValidation'

/** ".xlsx,.xls,.csv" → "XLSX, XLS ou CSV". */
export function describeAccept(accept: string): string {
  const formats = Array.from(new Set(
    accept
      .split(',')
      .map((item) => item.trim().replace(/^\./, '').toUpperCase())
      .filter(Boolean),
  ))
  if (formats.length <= 1) return formats[0] ?? ''
  return `${formats.slice(0, -1).join(', ')} ou ${formats[formats.length - 1]}`
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('pt-BR')} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

/** O mesmo teto que `assertUploadSize` aplica antes de ler o arquivo. */
export function uploadLimitLabel(maxBytes: number = MAX_UPLOAD_BYTES): string {
  return `até ${Math.round(maxBytes / (1024 * 1024))} MB`
}

const FIELD_LABELS: Record<string, string> = {
  row: '',
  value: 'valor',
  date: 'data',
  container_number: 'container',
  pol: 'POL',
  pod: 'POD',
  weight_kg: 'peso',
  customer_id: 'cliente',
  voyage_id: 'viagem',
  eta: 'ETA',
  status: 'situação',
  eof: 'fim do arquivo',
}

/**
 * Nome do campo como o operador o reconhece. `row` é o campo genérico de
 * `rowErrorsToImportIssues` e não acrescenta nada à "Linha N".
 */
export function issueFieldLabel(field: string): string {
  const known = FIELD_LABELS[field] ?? FIELD_LABELS[field.toLowerCase()]
  if (known !== undefined) return known
  return field.replace(/_/g, ' ')
}

export function countIssues(issues: readonly ImportIssue[]) {
  const errors = issues.filter((issue) => issue.severity === 'error').length
  return { errors, warnings: issues.length - errors }
}

export function plural(count: number, singular: string, pluralForm: string) {
  return `${count.toLocaleString('pt-BR')} ${count === 1 ? singular : pluralForm}`
}
