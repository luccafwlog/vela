import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mutations: [] as Array<{ onSuccess?: () => unknown; onSettled?: () => unknown }>,
  invalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: undefined })),
  useMutation: vi.fn((options: { onSuccess?: () => unknown; onSettled?: () => unknown }) => {
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
    const mutation = mocks.mutations[0]
    ;(mutation.onSettled ?? mutation.onSuccess)?.()

    const keys = mocks.invalidateQueries.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey)
    expect(keys).toContainEqual(['bl-portal-status'])
    expect(keys).toContainEqual(['review-queue'])
  })

  it('convite recusado também relê a fila do Portal', () => {
    // portal-invite-send grava o convite e a "falha no envio" antes de devolver
    // o erro: a releitura não pode depender do sucesso.
    useSendPortalInvite()
    const mutation = mocks.mutations[0]
    expect(mutation.onSuccess).toBeUndefined()
    mutation.onSettled?.()

    const keys = mocks.invalidateQueries.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey)
    expect(keys).toContainEqual(['portal-provisioning'])
  })
})
