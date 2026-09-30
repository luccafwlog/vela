import { describe, expect, it } from 'vitest'
import { formatCsv } from '../csv'
import { sanitizeCellValue } from '../spreadsheetSafe'
import { redactTelemetryUrl } from '../telemetryContract'
import { formatIssuesAsCsv } from '../../services/importValidation'

describe('reforços de front-end da auditoria run-2', () => {
  it('telemetria remove query e fragmento com token', () => {
    expect(redactTelemetryUrl('https://vela.app.br/perfil#access_token=abc&type=email_change')).toBe('https://vela.app.br/perfil')
    expect(redactTelemetryUrl('https://vela.app.br/x?token=1#y')).toBe('https://vela.app.br/x')
    expect(redactTelemetryUrl('https://vela.app.br/x')).toBe('https://vela.app.br/x')
  })

  it('CSV põe aspas em valor com CR', () => {
    expect(formatCsv(['a'], [['linha1\rlinha2']])).toBe('﻿a\n"linha1\rlinha2"')
  })

  it('prefixo de fórmula cobre espaço à esquerda e largura total', () => {
    expect(sanitizeCellValue(' =1+1')).toBe("' =1+1")
    expect(sanitizeCellValue('＝HYPERLINK("x")')).toBe("'＝HYPERLINK(\"x\")")
    expect(sanitizeCellValue('texto')).toBe('texto')
  })

  it('CSV de pendências de importação neutraliza fórmula vinda da planilha', () => {
    const csv = formatIssuesAsCsv([{ row: 2, field: 'bl', code: 'invalid_date', severity: 'error', message: '=cmd|/c calc' }])
    expect(csv).toContain("'=cmd|/c calc")
  })
})
