import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, callPortalRpc } = vi.hoisted(() => ({ rpc: vi.fn(), callPortalRpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc } }))
vi.mock('../portalScope', () => ({
  clientPortalScope: { mode: 'client', customerId: null, basePath: '/portal' },
  callPortalRpc,
}))

import { externalInformationUrl, portalGetInformation, trackingUrlForBl, trackingUrlHasBlMarker } from '../portalInformation'

describe('Informações do Portal', () => {
  beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: {}, error: null }); callPortalRpc.mockResolvedValue({ depots: [] }) })
  it('recusa esquemas executáveis, credenciais e URLs relativas', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', '/admin', 'https://user:password@example.com']) expect(externalInformationUrl(url)).toBeNull()
    expect(externalInformationUrl('https://spe.coscoshipping.com/main/newcargotracking?label=T&value=')).toBe('https://spe.coscoshipping.com/main/newcargotracking?label=T&value=')
    expect(externalInformationUrl('http://websag.depotpontual.com.br/')).toBe('http://websag.depotpontual.com.br/')
  })
  it('aceita a marca {BL} no link de tracking e a mantém legível', () => {
    expect(externalInformationUrl('https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=BILLOFLADING&number={BL}'))
      .toBe('https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=BILLOFLADING&number={BL}')
    // No caminho, o navegador escreve %7BBL%7D; a marca volta a {BL}.
    expect(externalInformationUrl('https://carrier.example/track/{BL}')).toBe('https://carrier.example/track/{BL}')
    expect(trackingUrlHasBlMarker('https://carrier.example/track/{BL}')).toBe(true)
    expect(trackingUrlHasBlMarker('https://carrier.example/track')).toBe(false)
    expect(trackingUrlHasBlMarker('javascript:alert("{BL}")')).toBe(false)
  })
  it('troca a marca pelo número do B/L codificado, sem mudar o site', () => {
    expect(trackingUrlForBl('https://carrier.example/cargoTracking?number={BL}', 'NSTR2113000001')).toBe('https://carrier.example/cargoTracking?number=NSTR2113000001')
    expect(trackingUrlForBl('https://carrier.example/track/{BL}', ' NSTR2113000001 ')).toBe('https://carrier.example/track/NSTR2113000001')
    // Número com caracteres de endereço não sai do parâmetro nem troca o site.
    expect(trackingUrlForBl('https://carrier.example/t?n={BL}', 'A/B?c=1#x@evil.example')).toBe('https://carrier.example/t?n=A%2FB%3Fc%3D1%23x%40evil.example')
    expect(trackingUrlForBl('https://carrier.example/track', 'BL1')).toBeNull()
    expect(trackingUrlForBl('https://carrier.example/t?n={BL}', '  ')).toBeNull()
    expect(trackingUrlForBl('javascript:alert(1)//{BL}', 'BL1')).toBeNull()
  })
  it('consulta informações pelo dispatcher da sessão/inspeção', async () => {
    const scope = { mode: 'inspect' as const, customerId: 7, overview: null, basePath: '/inspecao/7' }
    await portalGetInformation(scope)
    expect(callPortalRpc).toHaveBeenCalledWith(scope, 'portal_get_information')
  })
})
