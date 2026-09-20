import { describe, expect, it } from 'vitest'
import { authenticatePortalLoginIdentity } from '../../../supabase/functions/_shared/portalLoginIdentity'

type Session = { access_token: string }

function dependencies(events: string[]) {
  return {
    lookupEmail: async (userId: string) => {
      events.push(`lookup:${userId}`)
      return userId === 'real-user' ? 'real@technical.invalid' : 'dummy@technical.invalid'
    },
    signIn: async (email: string, password: string): Promise<Session | null> => {
      events.push(`signin:${email}:${password}`)
      return email.startsWith('real@') ? { access_token: 'real-session' } : null
    },
  }
}

describe('authenticatePortalLoginIdentity', () => {
  it('faz um lookup e uma tentativa de senha para uma conta elegível', async () => {
    const events: string[] = []

    const result = await authenticatePortalLoginIdentity<Session>(
      { auth_user_id: 'real-user', account_situation: 'ativo' },
      'dummy-user',
      'Senha1',
      dependencies(events),
    )

    expect(events).toEqual(['lookup:real-user', 'signin:real@technical.invalid:Senha1'])
    expect(result).toEqual({ accepted: true, session: { access_token: 'real-session' } })
  })

  it('faz o mesmo lookup e tentativa de senha usando a identidade dummy quando o CNPJ não existe', async () => {
    const events: string[] = []

    const result = await authenticatePortalLoginIdentity<Session>(
      null,
      'dummy-user',
      'Senha1',
      dependencies(events),
    )

    expect(events).toEqual(['lookup:dummy-user', 'signin:dummy@technical.invalid:Senha1'])
    expect(result).toEqual({ accepted: false, session: null })
  })

  it('nunca aceita a sessão dummy mesmo se a senha coincidir', async () => {
    const result = await authenticatePortalLoginIdentity<Session>(
      { auth_user_id: null, account_situation: 'sem_conta' },
      'dummy-user',
      'SenhaDummy1',
      {
        lookupEmail: async () => 'dummy@technical.invalid',
        signIn: async () => ({ access_token: 'dummy-session' }),
      },
    )

    expect(result).toEqual({ accepted: false, session: null })
  })
})
