import { afterEach, describe, expect, it, vi } from 'vitest'
import { Query, QueryCache, QueryClient } from '@tanstack/react-query'
import { createAppQueryClient } from '../queryClient'
import { createPortalQueryClient } from '../portalQueryClient'
import { reportCaughtException } from '../telemetry'

vi.mock('../telemetry', () => ({
  reportCaughtException: vi.fn(),
}))

afterEach(() => {
  vi.mocked(reportCaughtException).mockClear()
})

function triggerQueryError(client: QueryClient, error: unknown) {
  const query = client.getQueryCache().build(client, { queryKey: ['voyages'], queryFn: async () => [] })
  ;(client.getQueryCache() as QueryCache).config.onError?.(error as Error, query as unknown as Query<unknown, unknown, unknown>)
}

function triggerMutationError(client: QueryClient, error: unknown) {
  const mutation = client.getMutationCache().build(client, { mutationKey: ['voyages'], mutationFn: async () => {} })
  const cache = client.getMutationCache() as unknown as {
    config: { onError?: (error: unknown, variables: unknown, onMutateResult: unknown, mutation: unknown, context: unknown) => void }
  }
  cache.config.onError?.(error, undefined, undefined, mutation, undefined)
}

// VELA-28 a VELA-2B e PORTAL-4: a tela já mostrava o toast; a issue era ruído.
const recusasJaExplicadas = [
  ['22023 (documento x B/L)', { code: '22023', message: 'Documento não corresponde ao B/L.' }],
  ['23505 (registro já existe)', { code: '23505', message: 'duplicate key value violates unique constraint "x"' }],
  ['28000 (sessão expirada)', { code: '28000', message: 'invalid authorization' }],
] as const

describe.each([
  ['Vela', createAppQueryClient],
  ['Portal', createPortalQueryClient],
])('filtro de recusas esperadas (%s)', (_surface, createClient) => {
  it.each(recusasJaExplicadas)('não reporta %s em query nem em mutation', (_label, error) => {
    const client = createClient()
    triggerQueryError(client, error)
    triggerMutationError(client, error)
    expect(reportCaughtException).not.toHaveBeenCalled()
  })

  it('continua reportando falha não esperada, permissão negada com sessão ativa e guarda interna do banco', () => {
    const client = createClient()
    const crash = new Error('Cannot read properties of undefined')
    const denied = { code: '42501', message: 'permission denied for table invoices' }
    const internalGuard = { code: 'P0001', message: '210: effect_kind invalido' }
    triggerQueryError(client, crash)
    triggerMutationError(client, denied)
    triggerMutationError(client, internalGuard)
    expect(vi.mocked(reportCaughtException).mock.calls.map(([reported]) => reported)).toEqual([crash, denied, internalGuard])
  })
})

describe('createAppQueryClient', () => {
  it('reporta erros de query enriquecidos com tags semânticas e diagnósticos didáticos', () => {
    const error = new Error('query falhou')
    const client = createAppQueryClient()
    const query = client.getQueryCache().build(client, {
      queryKey: ['portal-invoices'],
      queryFn: async () => [],
    })

    ;(client.getQueryCache() as QueryCache).config.onError?.(error, query as unknown as Query<unknown, unknown, unknown>)

    expect(reportCaughtException).toHaveBeenCalledWith(
      error,
      'TanStack Query',
      expect.objectContaining({
        queryKey: '["portal-invoices"]',
        resumo_didatico: expect.stringContaining('Portal do Cliente'),
        diagnostico: 'query falhou',
      }),
      expect.objectContaining({
        modulo: 'Portal do Cliente',
        tela: 'Faturas do Cliente',
        tarefa: 'Carregar faturas disponíveis no portal',
        categoria_falha: 'Erro Não Tratado',
      }),
    )
  })

  it('reporta erros de conciliação PIX com contexto exato de negócio', () => {
    const error = Object.assign(new Error('permission denied for table'), { code: '42501' })
    const client = createAppQueryClient()
    const query = client.getQueryCache().build(client, {
      queryKey: ['pix-reconciliation-exceptions'],
      queryFn: async () => [],
    })

    ;(client.getQueryCache() as QueryCache).config.onError?.(error, query as unknown as Query<unknown, unknown, unknown>)

    expect(reportCaughtException).toHaveBeenCalledWith(
      error,
      'TanStack Query',
      expect.objectContaining({
        queryKey: '["pix-reconciliation-exceptions"]',
      }),
      expect.objectContaining({
        modulo: 'Financeiro',
        tela: 'Conciliação PIX',
        tarefa: 'Listar pendências PIX',
        categoria_falha: 'Segurança / Permissão',
        codigo_erro: '42501',
      }),
    )
  })

  it('reporta erros de mutation com tags didáticas', () => {
    const error = new Error('falha de mutacao')
    const client = createAppQueryClient()
    const mutation = client.getMutationCache().build(client, {
      mutationKey: ['demurrage-invoices'],
      mutationFn: async () => {},
    })

    const cacheWithConfig = client.getMutationCache() as unknown as {
      config: {
        onError?: (error: Error, variables: unknown, onMutateResult: unknown, mutation: unknown, context: unknown) => void
      }
    }
    cacheWithConfig.config.onError?.(
      error,
      undefined,
      undefined,
      mutation,
      undefined,
    )

    expect(reportCaughtException).toHaveBeenCalledWith(
      error,
      'TanStack Query',
      expect.objectContaining({
        mutationKey: '["demurrage-invoices"]',
      }),
      expect.objectContaining({
        modulo: 'Demurrage',
        tela: 'Faturas Demurrage',
        categoria_falha: 'Erro Não Tratado',
      }),
    )
  })
})
