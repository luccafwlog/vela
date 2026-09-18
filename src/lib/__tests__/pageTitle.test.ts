import { describe, expect, it } from 'vitest'

import { routeTitle } from '../pageTitle'
import { portalRouteTitle } from '../portalPageTitle'

describe('routeTitle (WCAG 2.4.2 — título por rota)', () => {
  it('antepõe o nome da tela e mantém o sufixo do produto', () => {
    expect(routeTitle('/painel')).toBe('Painel · Vela')
    expect(routeTitle('/taxas-locais')).toBe('Taxas Locais · Vela')
    expect(routeTitle('/taxas-locais/tabelas')).toBe('Tabelas de Taxas Locais · Vela')
    expect(routeTitle('/faturamento')).toBe('Vela')
  })

  it('prioriza rotas específicas sobre genéricas', () => {
    expect(routeTitle('/demurrage/taxas')).toBe('Tarifas de Demurrage · Vela')
    expect(routeTitle('/demurrage')).toBe('Demurrage · Vela')
    expect(routeTitle('/embarquevazios/depots')).toBe('Cadastro de Terminais · Vela')
    expect(routeTitle('/embarquevazios')).toBe('Embarque de Vazios · Vela')
    expect(routeTitle('/bls/COSU6401234501')).toBe('Detalhe do B/L · Vela')
    expect(routeTitle('/bls')).toBe('B/Ls · Vela')
    expect(routeTitle('/clientes/12.345.678/0001-90')).toBe('Ficha do Cliente · Vela')
    // /clientes/portal casava com o padrão de CNPJ e era titulado "Ficha do Cliente".
    expect(routeTitle('/clientes/portal')).toBe('Clientes · Provisionamento do Portal · Vela')
    expect(routeTitle('/admin')).toBe('Administração · Vela')
    expect(routeTitle('/admin/logs')).toBe('Administração · Log de Ações · Vela')
  })

  it('distingue portal de app interno', () => {
    expect(portalRouteTitle('/portal')).toBe('Portal · Painel · Fwlog')
    expect(portalRouteTitle('/portal/billing')).toBe('Portal · Faturas · Fwlog')
  })

  it('cai no nome do produto para rota desconhecida', () => {
    expect(routeTitle('/rota-inexistente')).toBe('Vela')
    expect(portalRouteTitle('/rota-inexistente')).toBe('Fwlog')
  })
})
