import { describe, expect, it } from 'vitest'
import {
  PORTAL_PASSWORD_RESET_QUARANTINE_MS,
  resetPortalPasswordFailClosed,
  type PortalPasswordResetDependencies,
} from '../../../supabase/functions/_shared/portalPasswordResetFlow'

function controlledDependencies(options: { failAt?: 'first-revoke' | 'quarantine' | 'password' | 'final-revoke' } = {}) {
  const events: string[] = []
  let revokeCount = 0
  const dependencies: PortalPasswordResetDependencies = {
    now: () => Date.parse('2026-09-20T12:00:00.000Z'),
    revokeSessions: async () => {
      revokeCount += 1
      events.push(`revoke:${revokeCount}`)
      if (options.failAt === 'first-revoke' && revokeCount === 1) throw new Error('first revoke failed')
      if (options.failAt === 'final-revoke' && revokeCount === 2) throw new Error('final revoke failed')
    },
    quarantineSessions: async (_userId, revokedUntil) => {
      events.push(`quarantine:${revokedUntil}`)
      if (options.failAt === 'quarantine') throw new Error('quarantine failed')
    },
    updatePassword: async () => {
      events.push('password')
      if (options.failAt === 'password') throw new Error('password failed')
    },
  }
  return { dependencies, events }
}

describe('resetPortalPasswordFailClosed', () => {
  it('revoga, instala a quarentena, troca a senha e revoga novamente', async () => {
    const { dependencies, events } = controlledDependencies()

    await resetPortalPasswordFailClosed('user-1', 'NovaSenha1', dependencies)

    expect(events).toEqual([
      'revoke:1',
      `quarantine:${new Date(Date.parse('2026-09-20T12:00:00.000Z') + PORTAL_PASSWORD_RESET_QUARANTINE_MS).toISOString()}`,
      'password',
      'revoke:2',
    ])
  })

  it.each(['first-revoke', 'quarantine'] as const)(
    'não altera a senha quando %s falha',
    async (failAt) => {
      const { dependencies, events } = controlledDependencies({ failAt })

      await expect(resetPortalPasswordFailClosed('user-1', 'NovaSenha1', dependencies)).rejects.toThrow()

      expect(events).not.toContain('password')
    },
  )

  it('mantém a quarentena registrada quando a revogação final falha', async () => {
    const { dependencies, events } = controlledDependencies({ failAt: 'final-revoke' })

    await expect(resetPortalPasswordFailClosed('user-1', 'NovaSenha1', dependencies)).rejects.toThrow('final revoke failed')

    expect(events).toEqual([
      'revoke:1',
      `quarantine:${new Date(Date.parse('2026-09-20T12:00:00.000Z') + PORTAL_PASSWORD_RESET_QUARANTINE_MS).toISOString()}`,
      'password',
      'revoke:2',
    ])
  })
})
