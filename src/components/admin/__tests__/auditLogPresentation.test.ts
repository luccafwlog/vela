import { describe, expect, it } from 'vitest'
import {
  AUDIT_SUBJECTS,
  auditSubjectLabel,
  auditValueFacts,
  describeAuditLog,
  displayAuditValue,
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

  it('mostra a exclusão do Embarque de vazios (migration 544) no assunto Vazios', () => {
    // A 544 grava `vazios_export_operation` (singular); o filtro consulta por entityTypes.
    expect(auditSubjectLabel('vazios_export_operation')).toBe('Vazios')
    expect(AUDIT_SUBJECTS.find((subject) => subject.id === 'vazios')?.entityTypes).toContain('vazios_export_operation')
    expect(describeAuditLog(log('vazios_export_operation', 'deleted', 'false', 'true'))).toBe('Embarque de vazios excluído')
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
    // Migration 468: a declaração da tela Veículos, gravada em `voyage`.
    expect(describeAuditLog(log('voyage', 'sem_veiculos', null, 'declarada'))).toBe('Viagem sem veículos: declarada')
    expect(describeAuditLog(log('user_profile', 'role', 'documentacao', 'financeiro'))).toBe('Setor: Financeiro')
    expect(describeAuditLog(log('app_settings', 'communications_enabled', 'false', 'true'))).toBe('Envio real de e-mails: Sim')
    const unknown = describeAuditLog(log('vessels', 'imo_number_x', '1', '2'))
    expect(unknown).toBe('Navio alterado')
    expect(unknown).not.toContain('imo_number_x')
  })

  it('ADR de Saída reaberto ou fechado, com a situação em português', () => {
    expect(describeAuditLog(log('agency_departure_report', 'status', 'closed', 'open'))).toBe('ADR de Saída reaberto')
    expect(describeAuditLog(log('agency_departure_report', 'status', 'open', 'closed'))).toBe('ADR de Saída fechado')
    expect(formatAuditValue('status', 'open', 'agency_departure_report')).toBe('Aberto')
    expect(formatAuditValue('status', 'closed', 'agency_departure_report')).toBe('Fechado')
    // A situação de outra entidade não ganha a tradução do ADR.
    expect(formatAuditValue('status', 'open', 'invoices')).toBe('open')
  })

  it('senha redefinida e usuário criado com nome e setor, sem o código do setor', () => {
    expect(describeAuditLog(log('user_profile', 'password', null, 'redefinida pelo administrador'))).toBe('Senha redefinida')
    expect(describeAuditLog(log('user_profile', 'created', null, 'Ana Souza (financeiro)'))).toBe('Usuário criado: Ana Souza · Financeiro')
    expect(formatAuditValue('created', 'Ana Souza (financeiro)', 'user_profile')).toBe('Ana Souza · Financeiro')
    expect(formatAuditValue('created', 'José (Zé) Lima (operator)', 'user_profile')).toBe('José (Zé) Lima · Documentação')
    expect(formatAuditValue('created', 'Texto sem setor', 'user_profile')).toBe('Texto sem setor')
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

describe('ALE-D08: resolução de alerta com justificativa (migration 476)', () => {
  it('aparece no assunto Alerta com o nome do tipo', () => {
    expect(auditSubjectLabel('alert_item')).toBe('Alerta')
    expect(describeAuditLog(log('alert_item', 'status', 'itau_pix_consulta_parada', 'resolved'))).toBe('Alerta resolvido com justificativa: Consulta de Pix do Itaú parada')
  })
})

describe('Histórico de ações — taxa alterada à mão (ADR 0111)', () => {
  it('lê o evento da taxa alterada com taxa, antes e depois', () => {
    const newValue = JSON.stringify({
      event: 'altered', charge_name: 'THD',
      before: { kind: 'unit', unit: 500, total: 1000, currency: 'BRL' },
      after: { kind: 'unit', unit: 400, total: 800, currency: 'BRL' },
    })
    const text = describeAuditLog({ entity_type: 'charge_calculation', field_name: 'charge_adjustment', old_value: null, new_value: newValue })
    expect(text.replace(/\s/g, ' ')).toBe('THD · Valor por unidade: R$ 500,00 → R$ 400,00')
  })

  it('a edição da cobrança manual mostra a quantidade, não o código', () => {
    expect(describeAuditLog({ entity_type: 'charge_calculation', field_name: 'manual_update', old_value: 'qty=2 | note=', new_value: 'qty=3 | note=x' }))
      .toBe('Cobrança manual: quantidade 2 → 3')
  })

  it('chave de outro cadastro: o nome do banco, nunca o número (558)', () => {
    expect(describeAuditLog({ ...log('voyages', 'vessel_id', '37', '41'), old_label: 'Rio de Janeiro 2', new_label: 'Santos' })).toBe('Navio: Santos')
    expect(describeAuditLog(log('voyages', 'vessel_id', '37', '41'))).toBe('Navio alterado')
    expect(displayAuditValue('vessel_id', '37', 'voyages', 'Rio de Janeiro 2')).toBe('Rio de Janeiro 2')
    expect(displayAuditValue('vessel_id', '37', 'voyages')).toBe('Registro vinculado')
    expect(displayAuditValue('omission_id', '9f1c2e4a-0000-4000-8000-000000000001', 'bl_transshipments')).toBe('Registro vinculado')
    expect(displayAuditValue('city', 'Santos', 'customers')).toBe('Santos')
    const json = '{"id": 41, "name": "Santos", "carrier_id": 9, "customer_id": 12}'
    expect(auditValueFacts('vessels', json, { carrier_id: 'Armador Nove' })).toEqual([
      { label: 'Nome', value: 'Santos' },
      { label: 'Armador', value: 'Armador Nove' },
    ])
  })

  it('Pix tratado, exceção de Pix e fechamento do ADR em português (559)', () => {
    expect(auditSubjectLabel('itau_pix_receipts')).toBe('Conciliação PIX')
    expect(auditSubjectLabel('pix_reconciliation_exceptions')).toBe('Conciliação PIX')
    expect(describeAuditLog(log('itau_pix_receipts', 'handled_note', null, 'Pix devolvido'))).toBe('Observação do tratamento: Pix devolvido')
    expect(describeAuditLog(log('pix_reconciliation_exceptions', 'criado', null, '{"id": 3, "txid": "X"}'))).toBe('Exceção de Pix criada')
    expect(describeAuditLog(log('agency_departure_report', 'status', 'open', 'closed'))).toBe('ADR de Saída fechado')
    expect(describeAuditLog({ ...log('agency_departure_report', 'terminal_id', null, 'uuid'), new_label: 'Terminal Norte' })).toBe('Terminal: Terminal Norte')
    expect(describeAuditLog(log('customer_billing_portal_releases', 'criado', null, '{"id": 1, "customer_id": 9}'))).toBe('Liberação de faturamento criada')
  })
})
