import { describe, expect, it } from 'vitest'
import { SHARED_ACTIVITY_KEY, idleExpired, recordSharedActivity } from '../sharedIdle'

const HOUR = 60 * 60 * 1000
function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

// ACE-D15 de 2026-10-27: a aba esquecida não derruba a sessão da aba em uso.
describe('inatividade de todas as abas juntas', () => {
  it('a aba parada há 8 horas não sai enquanto outra aba foi usada', () => {
    const storage = memoryStorage()
    const morning = 0
    recordSharedActivity(morning + 7 * HOUR, storage) // outra aba usada às 7h
    expect(idleExpired(morning + 8 * HOUR, morning, 8 * HOUR, storage)).toBe(false)
    expect(idleExpired(morning + 15 * HOUR, morning, 8 * HOUR, storage)).toBe(true)
  })

  it('sem armazenamento, vale a atividade da própria aba', () => {
    const broken = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    expect(() => recordSharedActivity(1, broken)).not.toThrow()
    expect(idleExpired(8 * HOUR, 0, 8 * HOUR, broken)).toBe(true)
    expect(idleExpired(8 * HOUR - 1, 0, 8 * HOUR, null)).toBe(false)
  })

  it('valor estranho no armazenamento é ignorado', () => {
    const storage = memoryStorage()
    storage.setItem(SHARED_ACTIVITY_KEY, 'abc')
    expect(idleExpired(8 * HOUR, 0, 8 * HOUR, storage)).toBe(true)
  })
})
