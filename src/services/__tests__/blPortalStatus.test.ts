import { describe, expect, it } from 'vitest'
import { computeBlPortalVisibility } from '../blPortalStatus'

describe('computeBlPortalVisibility', () => {
  it('visivel e pronto para faturar quando ha CE, cliente, conta ativa e prontidao canonica', () => {
    expect(computeBlPortalVisibility({ ceMercante: '123456789012345', customerId: 1, accountSituation: 'ativo', portalAccessReady: true }))
      .toEqual({ visible: true, reasons: [], portalReady: true, billingReady: true, accountSituation: 'ativo' })
  })
  it('lista todos os motivos do bloqueio', () => {
    expect(computeBlPortalVisibility({ ceMercante: null, customerId: null, accountSituation: null, portalAccessReady: false }).reasons)
      .toEqual(['Sem CE Mercante', 'Sem cliente vinculado', 'Conta do Portal não está ativa'])
  })
  // POR-D12: com o e-mail de recuperação devolvido, o Cliente entra e vê o B/L; só o faturamento fica retido.
  it('conta ativa sem prontidao canonica: o Cliente ve o B/L, mas o Portal nao esta pronto para faturar', () => {
    expect(computeBlPortalVisibility({ ceMercante: 'x', customerId: 1, accountSituation: 'ativo', portalAccessReady: false }))
      .toEqual({ visible: true, reasons: [], portalReady: false, billingReady: false, accountSituation: 'ativo' })
  })
  it('trata CE com apenas espacos como ausente', () => {
    expect(computeBlPortalVisibility({ ceMercante: '   ', customerId: 1, accountSituation: 'ativo', portalAccessReady: true }))
      .toMatchObject({ visible: false, reasons: ['Sem CE Mercante'] })
  })
  it('falha fechado para faturar quando a resposta ainda nao traz a prontidao canonica', () => {
    expect(computeBlPortalVisibility({ ceMercante: 'x', customerId: 1, accountSituation: 'ativo' })).toMatchObject({ visible: true, billingReady: false })
  })
  // Liberação de faturamento sem Portal: o servidor responde a mesma condição da
  // pendência "Acesso ao portal nao provisionado" da Revisão (migration 501).
  it('sem conta do Portal e com Liberacao vigente: o Cliente nao ve o B/L, mas esta pronto para faturar', () => {
    expect(computeBlPortalVisibility({ ceMercante: 'x', customerId: 1, accountSituation: null, portalAccessReady: false, billingAccessReady: true }))
      .toEqual({ visible: false, reasons: ['Conta do Portal não está ativa'], portalReady: false, billingReady: true, accountSituation: null })
  })
  it('Portal pronto sem Liberacao continua pronto para faturar pelo servidor', () => {
    expect(computeBlPortalVisibility({ ceMercante: 'x', customerId: 1, accountSituation: 'ativo', portalAccessReady: true, billingAccessReady: false }))
      .toMatchObject({ portalReady: true, billingReady: false })
  })
  it('conta suspensa: o Cliente nao ve o B/L', () => {
    expect(computeBlPortalVisibility({ ceMercante: 'x', customerId: 1, accountSituation: 'suspenso', portalAccessReady: false }))
      .toMatchObject({ visible: false, reasons: ['Conta do Portal não está ativa'], accountSituation: 'suspenso' })
  })
})
