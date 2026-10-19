import { describe, expect, it } from 'vitest'
import {
  AUDIT_SUBJECTS,
  auditSubjectLabel,
  auditValueFacts,
  describeAuditLog,
  formatAuditValue,
  formatBrasiliaDateTime,
} from '../auditLogPresentation'
import { appEnvironmentLabel } from '../../../lib/appVersion'

const log = (entity_type: string, field_name: string | null, old_value: string | null, new_value: string | null) =>
  ({ entity_type, field_name, old_value, new_value })

describe('Histórico de ações legível', () => {
  it('dá nome em português ao assunto e "Outro registro" ao que não conhece', () => {
    expect(auditSubjectLabel('granite_rates')).toBe('Tarifa do Granito')
    expect(auditSubjectLabel('voyage_pod_schedule')).toBe('Escala')
    expect(auditSubjectLabel('charge_table_items')).toBe('Tabela de Taxas Locais')
    expect(auditSubjectLabel('tabela_nova_sem_rotulo')).toBe('Outro registro')
  })

  it('cada entidade pertence a um assunto só', () => {
    const entities = AUDIT_SUBJECTS.flatMap((subject) => subject.entityTypes)
    expect(new Set(entities).size).toBe(entities.length)
  })

  it('escreve a criação, a exclusão e a troca de situação com o nome do registro', () => {
    expect(describeAuditLog(log('granite_rates', 'criado', null, '{"id": 7, "description": "THC Granito"}'))).toBe('Tarifa criada: THC Granito')
    expect(describeAuditLog(log('charge_table_items', 'excluido', '{"id": 3, "name": "THD"}', null))).toBe('Item excluído: THD')
    expect(describeAuditLog(log('depots', 'active', 'true', 'false'))).toBe('Local desativado')
    expect(describeAuditLog(log('demurrage_rates', 'reativado', 'false', 'true'))).toBe('Tarifa reativada')
  })

  it('usa os rótulos do B/L, do Cliente e da Viagem e nunca o nome técnico do campo', () => {
    expect(describeAuditLog(log('bl', 'ce_mercante', null, '123456789012345'))).toBe('CE Mercante: 123456789012345')
    expect(describeAuditLog(log('customers', 'trade_name', 'A', 'Atlântico'))).toBe('Nome fantasia: Atlântico')
    expect(describeAuditLog(log('voyages', 'voyage_number', '011S', '012S'))).toBe('Nº da viagem: 012S')
    expect(describeAuditLog(log('user_profile', 'role', 'documentacao', 'financeiro'))).toBe('Setor: Financeiro')
    expect(describeAuditLog(log('app_settings', 'communications_enabled', 'false', 'true'))).toBe('Envio real de e-mails: Sim')
    const unknown = describeAuditLog(log('vessels', 'imo_number_x', '1', '2'))
    expect(unknown).toBe('Navio alterado')
    expect(unknown).not.toContain('imo_number_x')
  })

  it('formata valores: vazio, Sim/Não, datas de Brasília', () => {
    expect(formatAuditValue('notes', null)).toBe('vazio')
    expect(formatAuditValue('applies_to_soc', 'false')).toBe('Não')
    expect(formatAuditValue('valid_from', '2026-01-01')).toBe('01/01/2026')
    expect(formatAuditValue('closed_at', '2026-10-20T00:04:00Z')).toBe('19/10/2026 21:04')
    expect(formatBrasiliaDateTime('2026-10-20T00:04:00+00:00')).toBe('19/10/2026 21:04')
  })

  it('o registro em JSON vira campos com rótulo, sem código cru', () => {
    expect(auditValueFacts('granite_rates', '{"id": 7, "description": "THC", "unit_value": 45, "currency": "BRL", "created_at": "2026-01-01", "x_interno": 1}'))
      .toEqual([
        { label: 'Descrição', value: 'THC' },
        { label: 'Valor', value: '45' },
        { label: 'Moeda', value: 'BRL' },
      ])
    expect(auditValueFacts('bl', 'texto simples')).toBeNull()
  })
})

describe('appEnvironmentLabel', () => {
  it('lê o ambiente da configuração da build, não um texto fixo', () => {
    expect(appEnvironmentLabel({ DEV: false, VITE_SENTRY_ENVIRONMENT: 'production' })).toBe('Produção')
    expect(appEnvironmentLabel({ DEV: false, VITE_SENTRY_ENVIRONMENT: 'preview' })).toBe('Prévia')
    expect(appEnvironmentLabel({ DEV: false })).toBe('Produção')
    expect(appEnvironmentLabel({ DEV: true, VITE_SENTRY_ENVIRONMENT: 'production' })).toBe('Desenvolvimento')
    expect(appEnvironmentLabel({ DEV: false, VITE_SENTRY_ENVIRONMENT: 'staging' })).toBe('Outro ambiente')
  })
})
