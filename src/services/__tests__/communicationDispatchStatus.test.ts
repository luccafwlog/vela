import { describe, expect, it } from 'vitest'
import { resolveDispatchStatus, statusToPersist } from '../../../supabase/functions/_shared/communicationDispatchStatus.ts'

// Plano dos e-mails, item 1B: com a chave ligada, um envio que não se concluiu
// nunca pode terminar "simulado" (a régua e a cobrança o tratariam como feito).
describe('status final do Comunicado depois do envio', () => {
  const on = { communicationsEnabled: true }
  const off = { communicationsEnabled: false }

  it('aceita a decisão do banco quando ela existe', () => {
    expect(resolveDispatchStatus({ ...on, refreshed: 'enviado', succeeded: 1, failed: 0 })).toBe('enviado')
    expect(resolveDispatchStatus({ ...on, refreshed: 'parcial', succeeded: 1, failed: 1 })).toBe('parcial')
    expect(resolveDispatchStatus({ ...on, refreshed: 'falha', succeeded: 0, failed: 1 })).toBe('falha')
    expect(resolveDispatchStatus({ ...off, refreshed: 'simulado', succeeded: 1, failed: 0 })).toBe('simulado')
  })

  it('com a chave ligada, "simulado" ou "pendente" do banco sem sucesso vira falha', () => {
    expect(resolveDispatchStatus({ ...on, refreshed: 'simulado', succeeded: 0, failed: 0 })).toBe('falha')
    expect(resolveDispatchStatus({ ...on, refreshed: 'pendente', succeeded: 0, failed: 1 })).toBe('falha')
    expect(resolveDispatchStatus({ ...on, refreshed: null, succeeded: 0, failed: 0 })).toBe('falha')
  })

  it('aceito pelo provedor sem id gravado conta como enviado', () => {
    expect(resolveDispatchStatus({ ...on, refreshed: 'pendente', succeeded: 1, failed: 0 })).toBe('enviado')
  })

  it('destinatário que falhou sem registrar tentativa não deixa o Comunicado como enviado', () => {
    expect(resolveDispatchStatus({ ...on, refreshed: 'enviado', succeeded: 0, failed: 0, unrecordedFailures: 1 })).toBe('parcial')
    expect(resolveDispatchStatus({ ...on, refreshed: 'pendente', succeeded: 0, failed: 0, unrecordedFailures: 1 })).toBe('falha')
    expect(resolveDispatchStatus({ ...off, refreshed: 'simulado', succeeded: 0, failed: 0, unrecordedFailures: 1 })).toBe('parcial')
  })

  it('grava só falha e parcial que o banco não tem', () => {
    expect(statusToPersist('pendente', 'falha')).toBe('falha')
    expect(statusToPersist('enviado', 'parcial')).toBe('parcial')
    expect(statusToPersist('falha', 'falha')).toBeNull()
    expect(statusToPersist('pendente', 'enviado')).toBeNull()
  })
})
