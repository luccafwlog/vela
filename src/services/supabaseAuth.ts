export type SignOutScope = 'global' | 'local' | 'others'

export type SignOutClient = {
  auth: {
    signOut: (options?: { scope?: SignOutScope }) => Promise<{ error: unknown | null }>
  }
}

type InternalAuthClient = {
  signOut: (options?: { scope?: SignOutScope }) => Promise<{ error: unknown | null }>
  _removeSession?: () => Promise<void> | void
  storageKey?: string
  storage?: {
    removeItem?: (key: string) => void | Promise<void>
  }
}

const signOutRequests = new WeakMap<object, Promise<void>>()
const DEFAULT_SIGNOUT_TIMEOUT_MS = 5000

function isLockStolenError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const message = String((error as { message?: unknown }).message ?? '')
  return message.includes('was released because another request stole it')
}

export async function removeLocalSessionFallback(client: SignOutClient) {
  const internalAuth = client.auth as unknown as InternalAuthClient
  const storageKey = internalAuth.storageKey

  // N1 & N2: Purga síncrona e imediata do storageKey exclusivo desta sessão no localStorage.
  // Executado ANTES de qualquer await no cliente de auth para que, mesmo se o lock interno
  // estiver preso por uma chamada de rede pendurada, o token seja destruído imediatamente.
  // Além disso, preserva as credenciais de outra sessão no mesmo domínio (Portal x Interno).
  if (typeof window !== 'undefined' && window.localStorage && storageKey) {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Ignora erro de acesso a localStorage
    }
  }

  if (storageKey && internalAuth.storage?.removeItem) {
    try {
      await internalAuth.storage.removeItem(storageKey)
    } catch {
      // Ignora erro de adaptador de storage
    }
  }

  // N2: Limpeza em memória e estado interno em modo com timeout defensivo curto (200ms).
  // No GoTrueClient, signOut({ scope: 'local' }) passa por _acquireLock. Se a chamada global
  // anterior estiver travada na rede, o método enfileira atrás dela indefinidamente.
  try {
    await Promise.race([
      Promise.resolve(internalAuth._removeSession?.()),
      new Promise((resolve) => setTimeout(resolve, 200)),
    ])
  } catch {
    // Fallback silencioso
  }

  try {
    await Promise.race([
      internalAuth.signOut({ scope: 'local' }),
      new Promise((resolve) => setTimeout(resolve, 200)),
    ])
  } catch {
    // Ignora erro ao tentar revogação local
  }
}

export async function signOutSupabaseClient(client: SignOutClient, timeoutMs = DEFAULT_SIGNOUT_TIMEOUT_MS) {
  const authClient = client.auth as object
  const pendingSignOut = signOutRequests.get(authClient)
  if (pendingSignOut) return pendingSignOut

  const signOutRequest = (async () => {
    let globalError: unknown = null
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeoutPromise = new Promise<{ error: Error }>((resolve) => {
        timeoutTimer = setTimeout(() => {
          resolve({ error: new Error('Tempo limite excedido na revogação remota de sessão (rede indisponível).') })
        }, timeoutMs)
      })

      const executionPromise = client.auth.signOut().then(
        (res) => {
          if (timeoutTimer) clearTimeout(timeoutTimer)
          return res
        },
        (err) => {
          if (timeoutTimer) clearTimeout(timeoutTimer)
          throw err
        },
      )

      const outcome = await Promise.race([executionPromise, timeoutPromise])
      if (outcome && 'error' in outcome && outcome.error) {
        globalError = outcome.error
      }
    } catch (error) {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (!isLockStolenError(error)) {
        globalError = error
      }
    }

    if (globalError) {
      await removeLocalSessionFallback(client)
      throw globalError
    }
  })()

  signOutRequests.set(authClient, signOutRequest)

  try {
    await signOutRequest
  } finally {
    if (signOutRequests.get(authClient) === signOutRequest) {
      signOutRequests.delete(authClient)
    }
  }
}
