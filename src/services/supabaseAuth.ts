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

function isLockStolenError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const message = String((error as { message?: unknown }).message ?? '')
  return message.includes('was released because another request stole it')
}

async function removeLocalSessionFallback(client: SignOutClient) {
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
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(storageKey)
      } catch {
        // Ignora erro de acesso a localStorage
      }
    }
  }
}

export async function signOutSupabaseClient(client: SignOutClient) {
  const authClient = client.auth as object
  const pendingSignOut = signOutRequests.get(authClient)
  if (pendingSignOut) return pendingSignOut

  const signOutRequest = (async () => {
    let globalError: unknown = null
    try {
      const { error } = await client.auth.signOut()
      if (error) globalError = error
    } catch (error) {
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
