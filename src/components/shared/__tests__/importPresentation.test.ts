import { expect, it } from 'vitest'
import { countIssues, describeAccept, formatFileSize, issueFieldLabel, uploadLimitLabel } from '../importPresentation'

it('descreve os formatos aceitos como o operador os lê', () => {
  expect(describeAccept('.xlsx,.xls,.csv')).toBe('XLSX, XLS ou CSV')
  expect(describeAccept('.pdf,.docx')).toBe('PDF ou DOCX')
  expect(describeAccept('.edi')).toBe('EDI')
  expect(describeAccept('.edi, .EDI,.txt')).toBe('EDI ou TXT')
})

it('formata o tamanho do arquivo e o limite do upload', () => {
  expect(formatFileSize(21)).toBe('21 bytes')
  expect(formatFileSize(1)).toBe('1 byte')
  expect(formatFileSize(1536)).toBe('2 KB')
  expect(formatFileSize(3.5 * 1024 * 1024)).toBe('3,5 MB')
  expect(formatFileSize(Number.NaN)).toBe('—')
  // Mesmo teto de assertUploadSize: anunciar um limite diferente do aplicado
  // faria o operador escolher um arquivo que a leitura recusa.
  expect(uploadLimitLabel()).toBe('até 10 MB')
})

it('traduz o campo do problema e omite o campo genérico de linha', () => {
  expect(issueFieldLabel('row')).toBe('')
  expect(issueFieldLabel('container_number')).toBe('container')
  expect(issueFieldLabel('POL')).toBe('POL')
  expect(issueFieldLabel('gross_weight')).toBe('gross weight')
})

it('separa erros de avisos', () => {
  const issue = (severity: 'error' | 'warning') => ({ row: 2, field: 'row', code: 'invalid_group' as const, severity, message: 'x' })
  expect(countIssues([issue('error'), issue('warning'), issue('warning')])).toEqual({ errors: 1, warnings: 2 })
})
