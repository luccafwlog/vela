import { describe, expect, it } from 'vitest'
import { recipientKey } from '../../../supabase/functions/_shared/email.ts'
import { resolveCommunicationAttemptKey } from '../../../supabase/functions/_shared/customerCommunicationAttemptKey.ts'

// Plano dos e-mails, 5.1: a chave da tentativa de Comunicado não leva o e-mail
// em claro, mas a tentativa gravada antes com a chave antiga continua achada.
describe('chave da tentativa de Comunicado', () => {
  const input = { communicationId: 42, attemptDiscriminator: 0, recipient: 'Docs@Cliente.test' }

  it('usa o hash do destinatário quando não há tentativa antiga', async () => {
    const seen: string[] = []
    const key = await resolveCommunicationAttemptKey(input, async (candidate) => {
      seen.push(candidate)
      return false
    })
    expect(key).toBe(`comunicado:42:0:${await recipientKey('docs@cliente.test')}`)
    expect(key).not.toContain('@')
    expect(seen).toEqual(['comunicado:42:0:docs@cliente.test'])
  })

  it('reaproveita a chave antiga quando a tentativa já existe, para não duplicar o envio', async () => {
    const key = await resolveCommunicationAttemptKey(input, async (candidate) => candidate === 'comunicado:42:0:docs@cliente.test')
    expect(key).toBe('comunicado:42:0:docs@cliente.test')
  })

  it('erro na consulta sobe, em vez de criar uma tentativa nova', async () => {
    await expect(resolveCommunicationAttemptKey(input, async () => {
      throw new Error('banco indisponível')
    })).rejects.toThrow('banco indisponível')
  })
})
