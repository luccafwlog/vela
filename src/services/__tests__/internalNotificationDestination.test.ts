// Ponto 14 das observações de 2026-10-23: cada tipo de notificação do sino leva
// à tela onde a pendência se resolve; sem tela específica, à fila de Alertas.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALERT_RULES } from '../alertRulesCatalog'
import { internalNotificationDestination } from '../alerts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const ROUTES = [...readFileSync(path.join(root, 'src/AppInterno.tsx'), 'utf8').matchAll(/path="(\/[^"]*)"/g)].map((m) => m[1])
  .filter((route) => route !== '/login' && !route.startsWith('/clientes/portal/inspecao'))

function routeExists(pathname: string) {
  return ROUTES.some((route) => new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+').replace(/\*$/, '.*')}/?$`).test(pathname))
}

// Registro de exemplo de cada tipo de entidade, no formato que o banco grava.
const SAMPLE_ENTITY: Record<string, string> = {
  bl: 'MEDU1234567',
  customer: '42',
  demurrage_invoice: '7',
  invoice: '9',
  pix_transaction: 'tx-1',
  agency_departure_report: '5::BRSSZ',
  voyage: '5',
  voyage_pod_schedule: '5::BRSSZ',
  voyage_escala_terminal: '5::BRSSZ::t1',
}

describe('destino das notificações do sino (ponto 14)', () => {
  it.each(ALERT_RULES.map((rule) => [rule.type, rule] as const))('%s leva a uma tela que existe', (_type, rule) => {
    const destination = internalNotificationDestination({
      item_type: rule.type,
      type: rule.type,
      entity_type: rule.entityType,
      entity_id: SAMPLE_ENTITY[rule.entityType] ?? 'registro-1',
      payload: { customer_cnpj: '12345678000190', voyage_id: 5, port: 'BRSSZ' },
      destination: rule.destination,
    })
    expect(destination.startsWith('/')).toBe(true)
    expect(routeExists(new URL(destination, 'https://vela.app.br').pathname), `${rule.type} → ${destination}`).toBe(true)
  })

  it('sem tela específica nem destino gravado, leva à fila de Alertas, origem do aviso', () => {
    expect(internalNotificationDestination({ item_type: 'tipo_novo', type: undefined, entity_type: null, entity_id: null, payload: null, destination: null })).toBe('/alertas')
    expect(internalNotificationDestination({ item_type: 'tipo_novo', type: undefined, entity_type: 'algo_sem_tela', entity_id: 'x', payload: null, destination: null })).toBe('/alertas')
  })

  it('destino gravado que não é rota interna não é seguido', () => {
    expect(internalNotificationDestination({ item_type: 'tipo_novo', type: undefined, entity_type: null, entity_id: null, payload: null, destination: 'https://evil.example/x' })).toBe('/alertas')
  })

  it('exemplos de destino específico', () => {
    const base = { type: undefined, payload: null, destination: null }
    expect(internalNotificationDestination({ ...base, item_type: 'voyage_baplie_missing', entity_type: 'voyage', entity_id: '88' })).toBe('/baplie?voyage=88')
    expect(internalNotificationDestination({ ...base, item_type: 'fatura_desatualizada', entity_type: 'invoice', entity_id: '9' })).toBe('/taxas-locais?invoice=9')
    expect(internalNotificationDestination({ ...base, item_type: 'voyage_schedule_date_pending', entity_type: 'voyage_pod_schedule', entity_id: '5::BRSSZ' })).toBe('/viagens/5?escala=BRSSZ')
  })
})
