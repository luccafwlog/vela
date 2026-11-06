import { describe, expect, it } from 'vitest'
import { activeNavItem, buildNavGroups, exportNavItems, getNavIndicator, financialNavItems, importNavItems, voyagesNavItems } from '../appLayoutNav'

const COUNTS = { pendingReview: 0, pendingCeUnlockRequests: 0, chargeReviewRequired: 0, readyForBilling: 0, openAlerts: 0, blsWithoutCustomer: 0 }

describe('appLayoutNav - rota canonica B/Ls', () => {
  it('contém item B/Ls apontando para /bls na secao de importacao', () => {
    const blItem = importNavItems.find((item) => item.to === '/bls')
    expect(blItem).toBeDefined()
    expect(blItem?.label).toBe('B/Ls')
  })

  it('guarda: nao contem rotas obsoletas /manifestos ou /carga-solta no menu', () => {
    expect(importNavItems.some((item) => item.to === '/manifestos')).toBe(false)
    expect(importNavItems.some((item) => item.to === '/carga-solta')).toBe(false)
  })
})

describe('telas que só abriam por botão entram no grupo do seu assunto (2026-11-01)', () => {
  it('as telas estão no menu, cada uma no seu grupo', () => {
    const groups = Object.fromEntries(buildNavGroups(COUNTS).map((group) => [group.id, group.items.map((item) => item.to)]))
    expect(groups.viagens).toEqual(expect.arrayContaining(['/chegadas-saidas', '/line-up-tv/display']))
    expect(groups.exportacao).toContain('/embarquevazios/depots')
    // Tabelas e Tarifas abrem pelos botões das suas telas, não pelo menu (2026-11-02).
    expect(groups.financeiro).not.toContain('/taxas-locais/tabelas')
    expect(groups.financeiro).not.toContain('/demurrage/taxas')
    // Regras de alertas abre pelo botão da tela Alertas, não pelo menu (2026-11-04).
    expect(groups.alertas).toEqual(['/alertas'])
    // Informações do Portal abre pelo botão da tela Portal, não pelo menu (2026-11-03).
    expect(groups.clientes).not.toContain('/clientes/informacoes')
  })

  it('Desbloqueio de CE fica logo acima de Revisão (2026-11-04)', () => {
    const importacao = importNavItems.map((item) => item.to)
    expect(importacao.indexOf('/desbloqueio-ce')).toBe(importacao.indexOf('/revisao') - 1)
  })

  it('Revisão mostra o número de clientes e Desbloqueio de CE o de solicitações à espera; o grupo soma os dois (2026-11-05)', () => {
    const importacao = buildNavGroups({ ...COUNTS, pendingReview: 17, pendingCeUnlockRequests: 3 }).find((group) => group.id === 'importacao')?.items ?? []
    expect(importacao.find((item) => item.to === '/revisao')?.badge).toBe(17)
    expect(importacao.find((item) => item.to === '/desbloqueio-ce')?.badge).toBe(3)
    expect(getNavIndicator(importacao)).toEqual({ type: 'badge', count: 20 })
    // Sem solicitação à espera, o item fica sem número.
    const vazio = buildNavGroups(COUNTS).find((group) => group.id === 'importacao')?.items ?? []
    expect(vazio.find((item) => item.to === '/desbloqueio-ce')?.badge).toBeUndefined()
  })

  it('a tela de contas do Portal se chama só Portal no menu (2026-11-03)', () => {
    const clientes = buildNavGroups(COUNTS).find((group) => group.id === 'clientes')?.items ?? []
    expect(clientes.map((item) => item.label)).toEqual(['Clientes', 'Portal', 'Comunicação'])
  })

  it('Tela TV abre em outra aba, com o mesmo nome do botão do Painel', () => {
    const tv = voyagesNavItems.find((item) => item.to === '/line-up-tv/display')
    expect(tv?.external).toBe(true)
    expect(tv?.label).toBe('Tela TV')
  })

  it('marca só o item da tela: o endereço mais longo que casa', () => {
    expect(activeNavItem(financialNavItems, '/taxas-locais/tabelas')?.to).toBe('/taxas-locais')
    expect(activeNavItem(financialNavItems, '/demurrage/taxas')?.to).toBe('/demurrage')
    expect(activeNavItem(financialNavItems, '/taxas-locais')?.to).toBe('/taxas-locais')
    expect(activeNavItem(exportNavItems, '/embarquevazios/depots')?.to).toBe('/embarquevazios/depots')
    expect(activeNavItem(exportNavItems, '/embarquevazios')?.to).toBe('/embarquevazios')
    // A ficha do Cliente continua marcando Clientes.
    const clientes = buildNavGroups(COUNTS).find((group) => group.id === 'clientes')?.items ?? []
    expect(activeNavItem(clientes, '/clientes/12345678000190')?.to).toBe('/clientes')
    expect(activeNavItem(clientes, '/clientes/portal')?.to).toBe('/clientes/portal')
    expect(activeNavItem(voyagesNavItems, '/line-up-tv/display')).toBeNull()
  })
})
