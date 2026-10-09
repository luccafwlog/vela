import { describe, expect, it } from 'vitest'
import { alertEntityLink, alertEntityLinkLabel, formatAlertEntity } from '../alerts'

describe('alertEntityLink & alertEntityLinkLabel — roteador de destino compartilhado', () => {
  it('roteia entidade customer para o portal do cliente', () => {
    const link = alertEntityLink({
      type: 'portal_pendencia_geral',
      entity_type: 'customer',
      entity_id: 'cust-123',
    })
    expect(link).toBe('/clientes/portal?cliente=cust-123')
    expect(alertEntityLinkLabel({ type: 'portal_pendencia_geral', entity_type: 'customer' })).toBe('Abrir Portal')
  })

  it('roteia customer mesmo sem prefixo portal_', () => {
    const link = alertEntityLink({
      type: 'demurrage',
      entity_type: 'customer',
      entity_id: 'cust-456',
    })
    expect(link).toBe('/clientes/portal?cliente=cust-456')
  })

  // A 364 consolidou o alerta de portal por cliente; o detector varre os
  // legados por B/L da 337, mas enquanto algum seguir ativo o entity_id e um
  // id de B/L e mandá-lo como ?cliente= apontaria para cliente inexistente.
  it('roteia review_portal_not_ready por cliente para o Portal e o legado por B/L para a Revisão', () => {
    expect(
      alertEntityLink({ type: 'review_portal_not_ready', entity_type: 'customer', entity_id: '42' }),
    ).toBe('/clientes/portal?cliente=42')

    expect(
      alertEntityLink({ type: 'review_portal_not_ready', entity_type: 'bl', entity_id: 'BL12345' }),
    ).toBe('/revisao?bl=BL12345')
  })

  it('roteia voyage_pod_schedule com escala', () => {
    const link = alertEntityLink({
      type: 'voyage_schedule_date_pending',
      entity_type: 'voyage_pod_schedule',
      entity_id: '100::BRSSZ',
    })
    expect(link).toBe('/viagens/100?escala=BRSSZ')
    expect(alertEntityLinkLabel({ type: 'voyage_schedule_date_pending', entity_type: 'voyage_pod_schedule' })).toBe('Abrir Viagem')
  })

  it('roteia voyage_escala_terminal com escala e terminal', () => {
    const link = alertEntityLink({
      type: 'voyage_terminal_date_pending',
      entity_type: 'voyage_escala_terminal',
      entity_id: '100::BRSSZ::BTP',
    })
    expect(link).toBe('/viagens/100?escala=BRSSZ&terminal=BTP')
    expect(alertEntityLinkLabel({ type: 'voyage_terminal_date_pending', entity_type: 'voyage_escala_terminal' })).toBe('Abrir Viagem')
  })

  it('roteia pendências de Comunicados para a conferência e bounce para Contatos', () => {
    expect(alertEntityLink({
      type: 'comunicado_noa_pendente',
      entity_type: 'voyage_pod_schedule',
      entity_id: '100::BRSSZ',
      destination: '/clientes/comunicacao',
    })).toBe('/clientes/comunicacao')
    expect(alertEntityLinkLabel({ type: 'comunicado_nob_pendente', entity_type: 'voyage_escala_terminal' })).toBe('Abrir Comunicados')
    expect(alertEntityLink({
      type: 'cliente_contato_bounced_sem_alternativa',
      entity_type: 'customer',
      entity_id: '42',
      metadata: { customer_cnpj: '12.345.678/0001-95' },
    })).toBe('/clientes/12.345.678%2F0001-95?tab=cadastro')
    expect(alertEntityLinkLabel({ type: 'cliente_contato_bounced_sem_alternativa', entity_type: 'customer' })).toBe('Abrir Cliente')
  })

  it('roteia agency_departure_report terminalizado e legado com query params', () => {
    const linkLegacy = alertEntityLink({
      type: 'agency_report_department_pending',
      entity_type: 'agency_departure_report',
      entity_id: '10::BRVIX::documentacao',
    })
    expect(linkLegacy).toBe('/viagens/10?tab=adr&escala=BRVIX')

    const linkTerminalized = alertEntityLink({
      type: 'agency_report_department_pending',
      entity_type: 'agency_departure_report',
      entity_id: '10::BRVIX::TVV::documentacao',
      metadata: { report_id: 'rep-99' },
    })
    expect(linkTerminalized).toBe('/viagens/10?tab=adr&escala=BRVIX&terminal=TVV&report=rep-99')
  })

  it('roteia dispute de demurrage quando dispute_id está no metadata', () => {
    const link = alertEntityLink({
      type: 'portal_dispute_opened',
      entity_type: 'demurrage_invoice',
      entity_id: 'inv-1',
      metadata: { dispute_id: 42 },
    })
    expect(link).toBe('/demurrage?dispute=42')
  })

  it('roteia pix_transaction para reconciliacao', () => {
    const link = alertEntityLink({
      type: 'pix_unreconciled',
      entity_type: 'pix_transaction',
      entity_id: 'tx-123',
    })
    expect(link).toBe('/reconciliacao')
  })

  it('rebaixa destination a fallback quando o roteador não deriva rota', () => {
    const fallbackLink = alertEntityLink({
      type: 'unknown_type',
      entity_type: null,
      entity_id: null,
      destination: '/fallback-route',
    })
    expect(fallbackLink).toBe('/fallback-route')
  })

  it('formata adequadamente o label de exibição de entidades conhecidas', () => {
    expect(formatAlertEntity('customer', '123')).toBe('Cliente 123')
    expect(formatAlertEntity('bl', 'BL001')).toBe('B/L BL001')
    expect(formatAlertEntity('voyage_pod_schedule', '50::BRSSZ')).toBe('Viagem 50 · Escala BRSSZ')
    expect(formatAlertEntity('voyage_escala_terminal', '50::BRSSZ::DPW')).toBe('Viagem 50 · BRSSZ · Terminal DPW')
  })

  it('roteia baplie corretamente usando effectiveType mesmo quando type for genérico', () => {
    const link = alertEntityLink({
      type: 'generic_alert',
      item_type: 'voyage_baplie_missing',
      entity_type: 'voyage',
      entity_id: '99',
    })
    expect(link).toBe('/baplie?voyage=99')
    expect(alertEntityLinkLabel({ type: 'generic_alert', item_type: 'voyage_baplie_missing', entity_type: 'voyage' })).toBe('Abrir Baplie')
  })
})
