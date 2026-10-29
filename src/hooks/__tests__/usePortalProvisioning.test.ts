import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mutations: [] as Array<{ onSuccess?: () => unknown }>,
  invalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: undefined })),
  useMutation: vi.fn((options: { onSuccess?: () => unknown }) => {
    mocks.mutations.push(options)
    return { mutate: vi.fn() }
  }),
  useQueryClient: vi.fn(() => ({ invalidateQueries: mocks.invalidateQueries })),
}))

vi.mock('../../services/portalProvisioning', () => ({}))
vi.mock('../../services/supabase', () => ({ supabase: {} }))

import {
  useAssistedEmailChange,
  useCancelPortalInvite,
  useReleaseSuppressedEmail,
  useSendPortalInvite,
  useSuspendPortalAccount,
} from '../usePortalProvisioning'

describe('mudanças na conta do Portal', () => {
  beforeEach(() => {
    mocks.mutations.length = 0
    mocks.invalidateQueries.mockClear()
  })

  // A ficha do B/L lê o gate (Portal pronto ou Liberação) do status do Portal
  // (migration 501), e a Revisão mostra a pendência de acesso ao Portal.
  it.each([
    ['convite', useSendPortalInvite],
    ['cancelar convite', useCancelPortalInvite],
    ['suspender ou reativar', useSuspendPortalAccount],
    ['trocar o E-mail de recuperação', useAssistedEmailChange],
    ['liberar e-mail bloqueado', useReleaseSuppressedEmail],
  ])('%s relê o status do Portal da ficha do B/L e a Revisão', (_name, useHook) => {
    useHook()
    mocks.mutations[0].onSuccess?.()

    const keys = mocks.invalidateQueries.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey)
    expect(keys).toContainEqual(['bl-portal-status'])
    expect(keys).toContainEqual(['review-queue'])
  })
})
