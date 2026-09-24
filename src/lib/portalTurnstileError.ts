export function isPortalTurnstileRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const context = (error as { context?: unknown }).context
  if (context && typeof context === 'object' && 'status' in context) {
    return (context as { status?: unknown }).status === 403
  }
  return (error as { status?: unknown }).status === 403
}

export const PORTAL_TURNSTILE_REJECTION_MESSAGE = 'A verificação de segurança expirou ou não foi validada. Faça-a novamente.'
