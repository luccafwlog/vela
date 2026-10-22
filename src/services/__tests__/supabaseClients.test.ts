import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())

vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

function fakeClient(name: string) {
  return {
    name,
    auth: { name: `${name}-auth` },
    from(this: { name: string }, table: string) {
      return `${this.name}:${table}`
    },
  }
}

describe('clientes Supabase interno e Portal', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    createClientMock.mockImplementation((_url: string, _key: string, options: { auth: { storageKey?: string } }) =>
      fakeClient(options.auth.storageKey === 'td-portal-auth' ? 'portal' : 'interno'))
  })

  it('não cria cliente algum só por importar o módulo', async () => {
    await import('../supabase')
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('o uso do Portal cria só o cliente do Portal, sem ler a sessão da URL', async () => {
    const { supabasePortal } = await import('../supabase')
    expect(supabasePortal.auth).toEqual({ name: 'portal-auth' })
    expect(createClientMock).toHaveBeenCalledTimes(1)
    expect(createClientMock.mock.calls[0][2].auth).toMatchObject({ detectSessionInUrl: false, storageKey: 'td-portal-auth' })
  })

  it('cada cliente nasce uma vez e os métodos mantêm o próprio cliente', async () => {
    const { supabase, supabasePortal } = await import('../supabase')
    const from = supabase.from as unknown as (table: string) => string
    expect(from('bls')).toBe('interno:bls')
    expect((supabasePortal.from as unknown as (table: string) => string)('bls')).toBe('portal:bls')
    void supabase.auth
    expect(createClientMock).toHaveBeenCalledTimes(2)
    expect(createClientMock.mock.calls[0][2].auth).toMatchObject({ detectSessionInUrl: true, flowType: 'pkce' })
  })
})
