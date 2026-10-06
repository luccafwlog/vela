import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, callPortalRpc } = vi.hoisted(() => ({ rpc: vi.fn(), callPortalRpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc } }))
vi.mock('../portalScope', () => ({
  clientPortalScope: { mode: 'client', customerId: null, basePath: '/portal' },
  callPortalRpc,
}))

import { externalInformationUrl, portalGetInformation } from '../portalInformation'

describe('Informações do Portal', () => {
  beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: {}, error: null }); callPortalRpc.mockResolvedValue({ depots: [] }) })
  it('recusa esquemas executáveis, credenciais e URLs relativas', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', '/admin', 'https://user:password@example.com']) expect(externalInformationUrl(url)).toBeNull()
    expect(externalInformationUrl('https://spe.coscoshipping.com/main/newcargotracking?label=T&value=')).toBe('https://spe.coscoshipping.com/main/newcargotracking?label=T&value=')
    expect(externalInformationUrl('http://websag.depotpontual.com.br/')).toBe('http://websag.depotpontual.com.br/')
  })
  it('consulta informações pelo dispatcher da sessão/inspeção', async () => {
    const scope = { mode: 'inspect' as const, customerId: 7, overview: null, basePath: '/inspecao/7' }
    await portalGetInformation(scope)
    expect(callPortalRpc).toHaveBeenCalledWith(scope, 'portal_get_information')
  })
})
