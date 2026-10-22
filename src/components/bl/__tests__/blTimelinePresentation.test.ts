import { describe, expect, it } from 'vitest'
import { describeTimelineEvent, familyLabel, isAudited, isImportContext } from '../blTimelinePresentation'

describe('describeTimelineEvent', () => {
  it('nomeia o container e o campo vindos da auditoria por coluna (migration 079)', () => {
    const devolucao = { family: 'container', entity_type: 'bl_container', field_name: 'return_date|TCLU1234567', old_value: null, new_value: '2026-10-20', justification: null } as never
    expect(describeTimelineEvent(devolucao)).toBe('Container TCLU1234567 · Devolução: vazio → 20/10/2026')
    const lacre = { family: 'container', entity_type: 'bl_container', field_name: 'seal_number|TCLU1234567', old_value: 'SL1', new_value: 'SL2', justification: 'Lacre trocado' } as never
    expect(describeTimelineEvent(lacre)).toBe('Container TCLU1234567 · Lacre: SL1 → SL2')
    const imo = { family: 'container', entity_type: 'bl_container', field_name: 'is_imo|TCLU1234567', old_value: 'false', new_value: 'true', justification: null } as never
    expect(describeTimelineEvent(imo)).toBe('Container TCLU1234567 · IMO: Não → Sim')
    const peso = { family: 'container', entity_type: 'bl_container', field_name: 'gross_weight_kg|TCLU1234567', old_value: '47900.000', new_value: '48250.5', justification: 'Balança' } as never
    expect(describeTimelineEvent(peso)).toBe('Container TCLU1234567 · Peso bruto (kg): 47.900 → 48.250,5')
  })
  it('edição das datas pela ficha mostra só as datas que mudaram, sem o JSON do evento', () => {
    const edit = {
      family: 'edicao', entity_type: 'bl', field_name: 'container_dates',
      old_value: '{"container": "TCLU0790001", "discharge_date": "2026-10-14", "return_date": "2026-10-20"}',
      new_value: '{"container": "TCLU0790001", "discharge_date": "2026-10-14", "return_date": null, "propagated_bl_ids": ["BL1"]}',
      justification: 'Terminal estornou a devolução',
    } as never
    expect(describeTimelineEvent(edit)).toBe('Container TCLU0790001 · datas: Devolução: 20/10/2026 → vazio')
  })
  it('desvínculo do Manifesto Mercante tem o nome do campo', () => {
    const unlink = { family: 'edicao', entity_type: 'bl', field_name: 'manifesto_mercante', old_value: '1226501860578', new_value: null, justification: 'Desvínculo automático' } as never
    expect(describeTimelineEvent(unlink)).toBe('Manifesto Mercante: 1226501860578 → vazio')
  })
  it('humanizes a field edit', () => {
    const e = { family: 'edicao', entity_type: 'bl', field_name: 'notify_party', old_value: 'X', new_value: 'Y', justification: 'ajuste' } as never
    expect(describeTimelineEvent(e)).toBe('Notify Party: X → Y')
  })
  it('normalizes multiple NCM values without splitting each character', () => {
    const eNcm = { family: 'edicao', entity_type: 'bl', field_name: 'ncm_codes', old_value: '{8703|8471}', new_value: '["8703","8471"]', justification: 'ajuste' } as never
    expect(describeTimelineEvent(eNcm)).toBe('NCM: 8703, 8471 → 8703, 8471')
  })

  it('translates status values only in their own fields', () => {
    const review = { family: 'edicao', entity_type: 'bl', field_name: 'review_status', old_value: 'pending_review', new_value: 'ok', justification: 'ok' } as never
    expect(describeTimelineEvent(review)).toBe('Status de revisão: Pendente → OK')

    const charge = { family: 'taxas', entity_type: 'bl', field_name: 'charge_status', old_value: 'null', new_value: 'ready_for_billing', justification: null } as never
    expect(describeTimelineEvent(charge)).toBe('Status das taxas: vazio → Pronto para faturar')

    const financial = { family: 'fatura', entity_type: 'bl', field_name: 'financial_status', old_value: 'pending', new_value: 'partially_paid', justification: null } as never
    expect(describeTimelineEvent(financial)).toBe('Status financeiro: Pendente → Parcialmente pago')

    const notes = { family: 'edicao', entity_type: 'bl', field_name: 'notes', old_value: null, new_value: 'ok', justification: 'ajuste' } as never
    expect(describeTimelineEvent(notes)).toBe('Notas: vazio → ok')
  })
  it('humanizes an invoice event', () => {
    const e = { family: 'fatura', entity_type: 'invoice', field_name: 'create_invoice', old_value: null, new_value: 'INV-2026-0103', justification: null } as never
    expect(describeTimelineEvent(e)).toMatch(/Fatura/i)
  })
  it('maps family labels', () => {
    expect(familyLabel('taxas')).toBe('Taxas')
  })
  it('flags audited entries (with justification)', () => {
    expect(isAudited({ justification: 'motivo' } as never)).toBe(true)
    expect(isAudited({ justification: null } as never)).toBe(false)
  })
  it('o contexto gravado pela importação não conta como auditoria (migration 189)', () => {
    const context = 'Importação de B/L · Viagem NAVIO 001N'
    expect(isAudited({ justification: context } as never)).toBe(false)
    expect(isImportContext(context)).toBe(true)
    expect(isImportContext('Importacao CE Mercante: CE corrigido pelo armador')).toBe(false)
    // Troca de CE pela planilha com motivo (migration 195) é deliberada: conta como auditoria.
    const withReason = 'Importação de CE Mercante · Viagem NAVIO 001N · Manifesto 1226501860578 · Motivo: CE corrigido pelo armador'
    expect(isImportContext(withReason)).toBe(false)
    expect(isAudited({ justification: withReason } as never)).toBe(true)
  })
})

describe('Histórico do B/L: motivo e autor', () => {
  it('esconde o motivo padrão escrito pelo banco e mostra o da pessoa ou a origem da importação', async () => {
    const { timelineEventDetail } = await import('../blTimelinePresentation')
    expect(timelineEventDetail({ justification: 'Revisao manual' })).toBeNull()
    expect(timelineEventDetail({ justification: 'Correção pedida pelo Cliente' })).toBe('Motivo: Correção pedida pelo Cliente')
    expect(timelineEventDetail({ justification: 'Importação de B/L · Viagem NAVIO 001N' })).toBe('Origem: Importação de B/L · Viagem NAVIO 001N')
  })
  it('Por: nome de quem fez, Sistema no rastro automático, nada quando o registro não guarda', async () => {
    const { timelineEventActor } = await import('../blTimelinePresentation')
    const names = new Map([['u1', 'Ana Ribeiro']])
    expect(timelineEventActor({ family: 'edicao', changed_by: 'u1', justification: 'x' }, names)).toBe('Ana Ribeiro')
    expect(timelineEventActor({ family: 'sistema', changed_by: null, justification: null }, names)).toBe('Sistema')
    expect(timelineEventActor({ family: 'edicao', changed_by: null, justification: 'Importação de B/L · Viagem X' }, names)).toBe('Sistema')
    expect(timelineEventActor({ family: 'edicao', changed_by: null, justification: null }, names)).toBeNull()
  })
  it('evento de fatura sem status conhecido não mostra o nome técnico do campo', () => {
    const e = { family: 'fatura', entity_type: 'invoice', field_name: 'billing_run_id', old_value: null, new_value: '42', justification: null } as never
    expect(describeTimelineEvent(e)).toBe('Fatura alterada')
  })
})

describe('Histórico do B/L: o que a importação muda (migration 404, F-23)', () => {
  const ev = (entity_type: string, field_name: string, old_value: string | null, new_value: string | null, justification: string | null = null) =>
    ({ family: 'container', entity_type, field_name, old_value, new_value, justification }) as never

  it('container e veículo que entram e saem, desova, SOC/COC e Cliente em linguagem da operação', () => {
    expect(describeTimelineEvent(ev('bl_container', 'criado|TCLU1234567', null, null))).toBe('Container TCLU1234567 entrou no B/L')
    expect(describeTimelineEvent(ev('bl_container', 'excluido|TCLU1234567', null, null))).toBe('Container TCLU1234567 saiu do B/L')
    expect(describeTimelineEvent(ev('vehicle', 'criado|9BWZZZ377VT004251', null, null))).toBe('Veículo 9BWZZZ377VT004251 entrou no B/L')
    expect(describeTimelineEvent(ev('bl_container', 'unpacking_location|TCLU1234567', null, 'Armazém 3'))).toBe('Container TCLU1234567 · Local de desova: vazio → Armazém 3')
    expect(describeTimelineEvent(ev('bl_container', 'ownership|TCLU1234567', 'COC', 'SOC'))).toBe('Container TCLU1234567 · SOC/COC: COC → SOC')
    expect(describeTimelineEvent(ev('bl', 'customer_id', 'Cliente A · CNPJ 1', 'Cliente B · CNPJ 2'))).toBe('Cliente: Cliente A · CNPJ 1 → Cliente B · CNPJ 2')
    expect(describeTimelineEvent(ev('bl', 'pod', 'BRITJ', 'BRVIX'))).toBe('POD: BRITJ → BRVIX')
    expect(familyLabel('veiculo')).toBe('Veículo')
  })

  it('marcas técnicas e JSON viram frase, sem código', () => {
    expect(describeTimelineEvent(ev('bl', 'FATURAMENTO_SOBRESCRITO', null, 'override_billing'))).toBe('Mudança com impacto na fatura aplicada com confirmação')
    expect(describeTimelineEvent(ev('bl', 'reimportacao_carga_solta', null, '{"tipo":"reimportacao_carga_solta","campos":["bb_weight_ton","bb_cbm"]}')))
      .toBe('Carga solta reimportada: Peso (Ton), CBM carga solta')
    expect(describeTimelineEvent(ev('bl', 'container_ownership', '{"container":"TCLU1234567","ownership":"COC"}', '{"container":"TCLU1234567","ownership":"SOC"}')))
      .toBe('Container TCLU1234567 · SOC/COC: COC → SOC')
    expect(describeTimelineEvent(ev('bl', 'campo_interno_novo', 'a', 'b'))).toBe('Dado do B/L: a → b')
  })

  it('o rastro antigo da importação de frete ("Importacao de …") é origem, não motivo', () => {
    expect(isImportContext('Importacao de frete do BL: alteracao com impacto em faturamento aplicada por override do operador')).toBe(true)
  })
})
