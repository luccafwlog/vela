import { describe, expect, it } from 'vitest'
import type { UnifiedPixMatch } from '../../../services/reconciliacao'
import {
  countPixPending,
  describeConfirmation,
  describeItauPoll,
  extractLineReason,
  formatBrasiliaInstant,
  formatExtractDay,
  historyRowStatus,
  itauChargeState,
  pendingExceptionReason,
  readyAmountNote,
  shortTxid,
  sortItauCharges,
  splitExtractLines,
} from '../pixReconciliationPresentation'

function match(overrides: Partial<UnifiedPixMatch> = {}): UnifiedPixMatch {
  return {
    transaction: { txid: 'TX1', cnpj: '', date: '2026-10-10', amount: 100, lineNumber: 5 },
    source: 'local', invoiceId: 1, docNumber: 'FAT-1', customerName: 'ACME', customerCnpj: '', amount: 100,
    ambiguous: false, matchType: 'txid',
    ...overrides,
  }
}

describe('Conciliação PIX — leituras', () => {
  it('horário Itaú em Brasília e dia do extrato como foi escrito', () => {
    expect(formatBrasiliaInstant('2026-10-06T15:00:00+00:00')).toBe('06/10/2026 às 12:00')
    expect(formatBrasiliaInstant('2026-10-07T01:30:00Z')).toBe('06/10/2026 às 22:30')
    expect(formatBrasiliaInstant(null)).toBe('—')
    // Meia-noite UTC do dia do extrato não vira o dia anterior.
    expect(formatExtractDay('2026-06-23T00:00:00+00:00')).toBe('23/06/2026')
    expect(formatExtractDay('')).toBe('—')
  })

  it('consulta parada a partir de 15 min sem avançar', () => {
    const now = new Date('2026-10-13T12:00:00Z')
    expect(describeItauPoll('2026-10-13T11:58:00Z', now)).toEqual({ text: 'há 2 min', stale: false })
    expect(describeItauPoll('2026-10-13T11:45:00Z', now)).toEqual({ text: 'há 15 min', stale: true })
    expect(describeItauPoll('2026-10-13T09:00:00Z', now).text).toBe('há 3 h')
    expect(describeItauPoll(null, now).stale).toBe(true)
  })

  it('separa o lote das exceções e soma só o que entra', () => {
    const lines = splitExtractLines([
      match(),
      match({ ambiguous: true, ambiguityReason: 'x', transaction: { txid: 'TX2', cnpj: '', date: '', amount: 50 } }),
      match({ source: 'unmatched', ambiguous: true, transaction: { txid: 'TX3', cnpj: '', date: '', amount: 30 } }),
    ])
    expect(lines.ready).toHaveLength(1)
    expect(lines).toEqual(expect.objectContaining({ ambiguous: 1, unmatched: 1, readyTotal: 100 }))
  })

  it('só explica valor diferente quando o Pix não bate com o documento', () => {
    expect(readyAmountNote(match())).toBeNull()
    expect(readyAmountNote(match({ source: 'demurrage', amount: 104.2 }))).toMatch(/janela das duas PTAX/)
  })

  it('motivo da exceção persistida: o do matching primeiro, depois o que os dados dizem', () => {
    const base = { reason: 'ambiguous' as const, txid: 'TX', candidateCount: 2, metadata: {} }
    // O matching ainda diz "TXID"; a tela diz "identificador do Pix".
    expect(pendingExceptionReason({ ...base, metadata: { ambiguity_reason: 'TXID repetido no mesmo extrato.' } })).toBe('Identificador repetido no mesmo extrato')
    expect(pendingExceptionReason({ ...base, metadata: { ambiguity_reason: 'Valor diferente do saldo da FAT-1.' } })).toBe('Valor diferente do saldo da FAT-1')
    expect(pendingExceptionReason({ ...base, txid: ' ', metadata: { ambiguity_reason: 'Nenhum documento aberto usa este TXID.' } })).toBe('Linha sem identificador no extrato')
    expect(pendingExceptionReason(base)).toBe('2 faturas usam o mesmo identificador')
    expect(pendingExceptionReason({ ...base, reason: 'unmatched', candidateCount: 0 })).toBe('Nenhuma fatura aberta com este identificador')
  })

  it('conferência do extrato: linha sem identificador não é "nenhuma fatura usa" (mesmo motivo de Pendências)', () => {
    const noTxid = match({ source: 'unmatched', ambiguous: true, ambiguityReason: 'Nenhum documento aberto usa este TXID.', transaction: { txid: '', cnpj: '', date: '', amount: 300 } })
    expect(extractLineReason(noTxid)).toBe('Linha sem identificador no extrato')
    expect(extractLineReason(match({ source: 'unmatched', ambiguous: true, ambiguityReason: 'Nenhum documento aberto usa este TXID.' }))).toBe('Nenhuma fatura aberta com este identificador')
    expect(extractLineReason(match({ ambiguous: true, ambiguityReason: '2 documentos usam o mesmo TXID.' }))).toBe('2 faturas usam o mesmo identificador')
  })

  it('identificador encurtado no começo e no fim; curto fica inteiro', () => {
    expect(shortTxid('VELA00000000000000000000099999')).toBe('VELA0000…0099999')
    expect(shortTxid('TX1')).toBe('TX1')
    expect(shortTxid(null)).toBe('')
  })

  it('fila Itaú: incerta e erro pedem ação e vêm primeiro; a contagem da aba ignora a fila normal', () => {
    const charge = (id: string, extra: object) => ({ status: 'pending_create' as const, uncertain: false, lastError: null, updatedAt: id, ...extra })
    expect(itauChargeState(charge('a', { status: 'pending_cancel' }))).toEqual({ label: 'Cancelamento pendente', needsAction: false })
    expect(itauChargeState(charge('a', { lastError: '500' }))).toEqual({ label: 'Emissão com erro', needsAction: true })
    expect(itauChargeState(charge('a', { status: 'pending_update', uncertain: true })).label).toBe('Alteração sem resposta do banco')
    const sorted = sortItauCharges([charge('1', {}), charge('2', { uncertain: true }), charge('0', {})])
    expect(sorted.map((c) => c.updatedAt)).toEqual(['2', '0', '1'])
    expect(countPixPending({ receipts: [{}, {}] as never, charges: sorted as never }, [{}])).toBe(4)
    expect(countPixPending(undefined, [])).toBeNull()
  })

  it('resultado do lote: completa o que voltou e conta o que não voltou', () => {
    const sent = [match(), match({ invoiceId: 2, docNumber: 'FAT-2', transaction: { txid: 'TX2', cnpj: '', date: '2026-10-11', amount: 70 } })]
    const { items, missing } = describeConfirmation(sent, { local: 1, demurrage: 0, items: [{ source: 'local', invoice_id: 2, doc_number: 'FAT-2', status: 'ok' }] })
    expect(missing).toBe(1)
    expect(items).toEqual([expect.objectContaining({ docNumber: 'FAT-2', amount: 70, txid: 'TX2', customerName: 'ACME', paidAt: '2026-10-11' })])
  })

  it('histórico: parcial e coberta não aparecem como paga', () => {
    expect(historyRowStatus({ source: 'local', status: 'paid' }).label).toBe('Paga')
    expect(historyRowStatus({ source: 'local', status: 'partially_paid' })).toEqual({ label: 'Parcialmente paga', kind: 'partial' })
    expect(historyRowStatus({ source: 'local', status: 'covered' }).label).toBe('Coberta pela consolidada')
  })
})
