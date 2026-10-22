import { describe, expect, it } from 'vitest'
import { readSqlAlertCatalog } from './alertCatalogSql'
import { ALERT_RULES } from '../alertRulesCatalog'
import { alertEntityLink, alertEntityLinkLabel, getAlertTypeLabel } from '../alerts'

// ADR 0095, decisão 20 (migration 396): "CE fora do Manifesto da rota" é da
// Documentação, normal, e abre a ficha do B/L do alerta.
describe('alerta CE fora do Manifesto da rota', () => {
  const alert = { type: 'ce_fora_do_manifesto_da_rota', entity_type: 'bl', entity_id: 'MSCU 1/2', destination: '/bls/MSCU 1/2' }

  it('está no catálogo SQL como normal da Documentação e no manual da tela', () => {
    const entry = readSqlAlertCatalog().find((e) => e.type === 'ce_fora_do_manifesto_da_rota')
    expect(entry).toBeDefined()
    expect(entry).toMatchObject({ active: true, severity: 'normal' })
    const rule = ALERT_RULES.find((r) => r.type === 'ce_fora_do_manifesto_da_rota')
    expect(rule).toMatchObject({ severity: 'normal', entityType: 'bl', responsibleDepartments: ['documentacao'] })
  })

  it('tem rótulo e abre a ficha do B/L', () => {
    expect(getAlertTypeLabel('ce_fora_do_manifesto_da_rota')).toBe('CE fora do Manifesto da rota')
    expect(alertEntityLink(alert)).toBe('/bls/MSCU%201%2F2')
    expect(alertEntityLinkLabel(alert)).toBe('Abrir B/L')
  })
})
