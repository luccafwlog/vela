import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queries: [] as Array<{ queryKey: readonly unknown[]; enabled?: boolean }>,
  mutations: [] as Array<{ mutationFn: unknown; onSuccess?: unknown; onSettled?: unknown }>,
  useQuery: vi.fn((options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    mocks.queries.push(options)
    return { data: undefined }
  }),
  useMutation: vi.fn((options: { mutationFn: unknown; onSuccess?: unknown; onSettled?: unknown }) => {
    mocks.mutations.push(options)
    return { mutate: vi.fn() }
  }),
  invalidateQueries: vi.fn(),
  useQueryClient: vi.fn(() => ({ invalidateQueries: mocks.invalidateQueries })),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery,
  useMutation: mocks.useMutation,
  useQueryClient: mocks.useQueryClient,
}))

vi.mock('../../services/appSettings', () => ({
  fetchAppSettings: vi.fn(),
  setCommunicationsEnabled: vi.fn(),
  setDemurrageDunningIntervalDays: vi.fn(),
}))

import { useAppSettings, useSetCommunicationsEnabled, useSetDemurrageDunningIntervalDays } from '../useAppSettings'

describe('hooks de app settings', () => {
  beforeEach(() => {
    mocks.queries.length = 0
    mocks.mutations.length = 0
  })

  it('usa a chave estável e permite desabilitar a consulta', () => {
    useAppSettings(false)

    expect(mocks.queries.at(-1)).toMatchObject({
      queryKey: ['app-settings'],
      enabled: false,
    })
  })

  it('expõe a mutação da chave de envio, que relê o singleton também quando falha', () => {
    useSetCommunicationsEnabled()

    expect(mocks.mutations).toHaveLength(1)
    expect(mocks.mutations[0].mutationFn).toBeTypeOf('function')
    // onSettled roda no sucesso e na falha, com o erro no segundo argumento.
    ;(mocks.mutations[0].onSettled as (data: unknown, error: unknown) => void)(undefined, new Error('Failed to fetch'))
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['app-settings'] })
  })

  it('expõe a mutação administrativa do intervalo da régua', () => {
    useSetDemurrageDunningIntervalDays()

    expect(mocks.mutations).toHaveLength(1)
    expect(mocks.mutations[0].mutationFn).toBeTypeOf('function')
    expect(mocks.mutations[0].onSuccess).toBeTypeOf('function')
  })
})
