import { describe, expect, it, vi } from 'vitest'
import { ADR_DEPARTMENT_LABELS, ADR_SECTION_LABELS, adrClosedPath, adrClosedTemplate, runAdrClosedEmail, type AdrClosedRow } from '../../../supabase/functions/_shared/adrClosedEmail'
import { AGENCY_REPORT_DEPARTMENT_LABELS, AGENCY_REPORT_SECTION_LABELS } from '../agencyReportLabels'

// Migration 611 (ADR 0131, D6): o ADR fechado vai por e-mail a todos os
// usuários internos ativos, com o resumo e o link.
const row: AdrClosedRow = {
  id: 11,
  report_id: 'rep-1',
  voyage_id: 7,
  voyage_label: 'COSCO SEREIA 024E',
  port: 'BRVIX',
  terminal_code: 'TVV',
  terminal_name: 'TVV',
  closed_at: '2026-11-06T18:30:00Z',
  closed_by_name: 'Ana Ribeiro',
  schedule: { ata: '2026-11-04T10:00:00Z', atb: '2026-11-04T12:00:00Z', atd: '2026-11-05T20:00:00Z' },
  signoffs: [
    { department: 'documentacao', signed_at: '2026-11-06T15:00:00Z', signed_by_name: 'Bia <Doc>' },
    { department: 'equipamentos', signed_at: '2026-11-06T18:29:00Z', signed_by_name: 'Caio' },
    { department: 'operacoes', signed_at: '2026-11-06T09:00:00Z', signed_by_name: null },
  ],
  sections: { datas: 'confirmed', carga_carregada: 'nothing_to_declare' },
}

describe('e-mail do ADR fechado (migration 611)', () => {
  it('os rótulos do e-mail são os mesmos da tela do ADR', () => {
    expect(ADR_SECTION_LABELS).toEqual(AGENCY_REPORT_SECTION_LABELS)
    expect(ADR_DEPARTMENT_LABELS).toEqual(AGENCY_REPORT_DEPARTMENT_LABELS)
  })

  it('leva o link do ADR na escala, no terminal e no relatório', () => {
    expect(adrClosedPath(row)).toBe('/viagens/7?tab=adr&escala=BRVIX&terminal=TVV&report=rep-1')
  })

  it('o resumo traz viagem, porto, quem fechou, as três assinaturas, as seções e o link; o HTML escapa nomes', () => {
    const mail = adrClosedTemplate(row, 'https://vela.app.br/')
    expect(mail.subject).toBe('ADR fechado — COSCO SEREIA 024E · BRVIX · TVV')
    expect(mail.text).toContain('Fechado em: 06/11/2026, 15:30 por Ana Ribeiro')
    expect(mail.text).toContain('Documentação: Bia <Doc>, 06/11/2026, 12:00')
    expect(mail.text).toContain('Operações: Pessoa sem cadastro')
    expect(mail.text).toContain('Carga carregada: Nada a declarar')
    expect(mail.text).toContain('https://vela.app.br/viagens/7?tab=adr&escala=BRVIX&terminal=TVV&report=rep-1')
    expect(mail.html).toContain('Bia &lt;Doc&gt;')
    expect(mail.html).not.toContain('Bia <Doc>')
  })

  it('manda a cada destinatário com chave por fechamento e devolve à fila o fechamento com falha', async () => {
    const send = vi.fn(async ({ to }: { to: string }) => (to === 'falha@fwlog.com.br' ? 'failed' as const : 'sent' as const))
    const finish = vi.fn(async () => {})
    const result = await runAdrClosedEmail({
      pending: async () => ({ rows: [row, { ...row, id: 12 }], recipients: ['a@fwlog.com.br', 'falha@fwlog.com.br'] }),
      recipientKey: async (email) => `k:${email}`,
      send,
      finish,
    })
    expect(send).toHaveBeenCalledTimes(4)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@fwlog.com.br', idempotencyKey: 'adr-fechado:11:k:a@fwlog.com.br' }))
    expect(finish).toHaveBeenCalledWith(11, 'retry', '1 destinatário(s) com falha')
    expect(result).toEqual({ status: 500, body: { rows: 2, sent: 2, failed: 2 } })
  })

  it('sem falha, fecha a linha como enviada', async () => {
    const finish = vi.fn(async () => {})
    const result = await runAdrClosedEmail({
      pending: async () => ({ rows: [row], recipients: ['a@fwlog.com.br'] }),
      recipientKey: async (email) => email,
      send: async () => 'sent',
      finish,
    })
    expect(finish).toHaveBeenCalledWith(11, 'sent', null)
    expect(result.status).toBe(200)
  })
})
