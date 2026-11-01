import { describe, expect, it } from 'vitest'
import { activeNavItem, buildNavGroups, exportNavItems, financialNavItems, importNavItems, voyagesNavItems } from '../appLayoutNav'

const COUNTS = { pendingReview: 0, chargeReviewRequired: 0, readyForBilling: 0, openAlerts: 0, blsWithoutCustomer: 0 }

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
  it('as sete telas estão no menu, cada uma no seu grupo', () => {
    const groups = Object.fromEntries(buildNavGroups(COUNTS).map((group) => [group.id, group.items.map((item) => item.to)]))
    expect(groups.viagens).toEqual(expect.arrayContaining(['/chegadas-saidas', '/line-up-tv/display']))
    expect(groups.exportacao).toContain('/embarquevazios/depots')
    expect(groups.financeiro).toEqual(expect.arrayContaining(['/taxas-locais/tabelas', '/demurrage/taxas']))
    expect(groups.alertas).toContain('/alertas/regras')
    expect(groups.clientes).toContain('/clientes/informacoes')
  })

  it('Line Up TV abre em outra aba', () => {
    expect(voyagesNavItems.find((item) => item.to === '/line-up-tv/display')?.external).toBe(true)
  })

  it('marca só o item da tela: o endereço mais longo que casa', () => {
    expect(activeNavItem(financialNavItems, '/taxas-locais/tabelas')?.to).toBe('/taxas-locais/tabelas')
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
