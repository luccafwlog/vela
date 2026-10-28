/**
 * Inatividade de 8 horas da pessoa, não de cada aba (ACE-D15 de 2026-10-27):
 * cada aba grava a última atividade no armazenamento do navegador, que as abas
 * do Vela dividem, e a saída só acontece quando nenhuma aba foi usada no
 * período. Sem armazenamento (janela privada, bloqueio), cada aba conta só a
 * própria atividade, como antes.
 */
export const SHARED_ACTIVITY_KEY = 'vela:last-activity'

type ActivityStorage = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): ActivityStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function recordSharedActivity(at: number, storage: ActivityStorage | null = browserStorage()): void {
  try {
    storage?.setItem(SHARED_ACTIVITY_KEY, String(at))
  } catch {
    // Armazenamento indisponível: vale a atividade da própria aba.
  }
}

export function readSharedActivity(storage: ActivityStorage | null = browserStorage()): number | null {
  try {
    const value = Number(storage?.getItem(SHARED_ACTIVITY_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/** A sessão cai quando a atividade mais recente de todas as abas passou do limite. */
export function idleExpired(now: number, localActivity: number, timeoutMs: number, storage: ActivityStorage | null = browserStorage()): boolean {
  const last = Math.max(localActivity, readSharedActivity(storage) ?? 0)
  return now - last >= timeoutMs
}
