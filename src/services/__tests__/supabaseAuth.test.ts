// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { signOutSupabaseClient } from '../supabaseAuth'

function createClient(signOut: () => Promise<{ error: Error | null }>) {
  return {
    auth: {
      signOut,
    },
  }
}

describe('signOutSupabaseClient', () => {
  it('reuses the in-flight logout for concurrent calls to the same auth client', async () => {
    let releaseLogout!: () => void
    const signOut = vi.fn(
      () => new Promise<{ error: null }>((resolve) => {
        releaseLogout = () => resolve({ error: null })
      }),
    )
    const client = createClient(signOut)

    const first = signOutSupabaseClient(client)
    const second = signOutSupabaseClient(client)

    expect(signOut).toHaveBeenCalledTimes(1)

    releaseLogout()

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  })

  it('does not surface the Supabase auth lock-stolen error during logout', async () => {
    const error = new Error('Lock "lock:sb-project-auth-token" was released because another request stole it') as Error & {
      isAcquireTimeout: boolean
    }
    error.isAcquireTimeout = true

    const client = createClient(vi.fn(async () => {
      throw error
    }))

    await expect(signOutSupabaseClient(client)).resolves.toBeUndefined()
  })

  it('still throws regular Supabase logout errors, but ensures local cleanup before throwing', async () => {
    const error = new Error('network failed')
    const removeSession = vi.fn()
    const removeItem = vi.fn()
    const signOut = vi.fn(async (options?: { scope?: string }) => {
      if (options?.scope === 'local') {
        return { error: null }
      }
      return { error }
    })

    const client = {
      auth: {
        signOut,
        _removeSession: removeSession,
        storageKey: 'td-portal-auth',
        storage: {
          removeItem,
        },
      },
    }

    await expect(signOutSupabaseClient(client)).rejects.toThrow('network failed')
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(removeSession).toHaveBeenCalledTimes(1)
    expect(removeItem).toHaveBeenCalledWith('td-portal-auth')
  })

  it('purges local session and throws if remote logout hangs beyond timeout', async () => {
    const removeSession = vi.fn()
    const removeItem = vi.fn()
    const signOut = vi.fn(async (options?: { scope?: string }) => {
      if (options?.scope === 'local') {
        return { error: null }
      }
      return new Promise<{ error: null }>(() => {})
    })

    const client = {
      auth: {
        signOut,
        _removeSession: removeSession,
        storageKey: 'td-portal-auth',
        storage: {
          removeItem,
        },
      },
    }

    await expect(signOutSupabaseClient(client, 50)).rejects.toThrow(/Tempo limite excedido/)
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(removeSession).toHaveBeenCalledTimes(1)
    expect(removeItem).toHaveBeenCalledWith('td-portal-auth')
  })

  it('N1: purga apenas o storageKey do cliente que está saindo, preservando outra sessão no mesmo domínio', async () => {
    localStorage.setItem('td-portal-auth', 'token-portal')
    localStorage.setItem('sb-app-auth-token', 'token-interno')

    const client = {
      auth: {
        signOut: vi.fn(async () => ({ error: new Error('rede instável') })),
        storageKey: 'td-portal-auth',
      },
    }

    await expect(signOutSupabaseClient(client)).rejects.toThrow('rede instável')

    expect(localStorage.getItem('td-portal-auth')).toBeNull()
    expect(localStorage.getItem('sb-app-auth-token')).toBe('token-interno')

    localStorage.clear()
  })

  it('N2: purga localStorage imediatamente e resolve o fallback mesmo se signOut local bloquear no lock de GoTrue', async () => {
    localStorage.setItem('td-portal-auth', 'token-portal')

    // Simula a situação onde signOut global nunca resolve e o signOut local enfileira atrás do lock indefinidamente
    const client = {
      auth: {
        signOut: vi.fn((options?: { scope?: string }) => {
          if (options?.scope === 'local') {
            return new Promise<{ error: null }>(() => {}) // trava no lock
          }
          return new Promise<{ error: null }>(() => {}) // trava na rede
        }),
        _removeSession: vi.fn(() => new Promise<void>(() => {})), // trava no lock
        storageKey: 'td-portal-auth',
      },
    }

    const start = Date.now()
    await expect(signOutSupabaseClient(client, 50)).rejects.toThrow(/Tempo limite excedido/)
    const elapsed = Date.now() - start

    // localStorage foi purgado imediatamente sem ficar preso nas chamadas bloqueadas
    expect(localStorage.getItem('td-portal-auth')).toBeNull()
    // O fallback resolveu com timeout curto defensivo (~200ms) sem travar a thread
    expect(elapsed).toBeLessThan(1000)

    localStorage.clear()
  })
})
