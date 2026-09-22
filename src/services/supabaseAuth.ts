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

  try {
    await internalAuth.signOut({ scope: 'local' })
  } catch {
    // Ignora erro de transporte ao tentar revogação local
  }

  try {
    await internalAuth._removeSession?.()
  } catch {
    // Fallback silencioso
  }

  const storageKey = internalAuth.storageKey
  if (storageKey) {
    try {
      await internalAuth.storage?.removeItem?.(storageKey)
    } catch {
      // Ignora erro de adaptador de storage
    }
  }

  // M5: Purga forçada em localStorage como caminho principal garantido
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (storageKey) window.localStorage.removeItem(storageKey)
      window.localStorage.removeItem('td-portal-auth')
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const key = window.localStorage.key(i)
        if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
          window.localStorage.removeItem(key)
        }
      }
    } catch {
      // Ignora erro de acesso a localStorage
    }
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
