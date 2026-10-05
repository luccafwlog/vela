import { describe, expect, it } from 'vitest'
import { buildVoyageTimeline } from '../voyageSummaries'

describe('timeline operacional de transbordo', () => {
  it('usa o mesmo formato objetivo para registros de escala', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [{
        entity_type: 'voyage_pod_schedule',
        entity_id: '9::BRVIX',
        field_name: 'eta',
        old_value: null,
        new_value: '2026-08-26',
        changed_at: '2026-08-24T20:41:00Z',
      }],
    })

    expect(events[0].title).toBe('ETA registrado · BRVIX')
    expect(events[0].detail).toBe('26/08/2026')
  })

  it('leva a justificativa da edição da escala para a linha do tempo', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [
        { entity_type: 'voyage_pod_schedule', entity_id: '9::BRVIX', field_name: 'terminal_dates', old_value: JSON.stringify({ terminal_etb: '2026-08-20' }), new_value: JSON.stringify({ terminal_etb: '2026-08-22' }), justification: 'Berço ocupado pelo navio anterior', changed_at: '2026-08-18T11:00:00Z' },
        { entity_type: 'voyage_pod_schedule', entity_id: '9::BRVIX', field_name: 'eta', old_value: '2026-08-19', new_value: '2026-08-21', justification: 'Atualizacao manual de ETA por POD', changed_at: '2026-08-18T10:00:00Z' },
      ],
    })

    expect(events.find((event) => event.title.includes('Datas do terminal'))?.detail).toContain('Justificativa: Berço ocupado pelo navio anterior')
    // Texto automático do sistema não é justificativa do operador.
    expect(events.find((event) => event.title.startsWith('ETA'))?.detail).not.toContain('Justificativa')
  })

  it('humaniza alterações de operações e datas terminalizadas', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [
        { entity_type: 'voyage_pod_schedule', entity_id: '9::BRVIX', field_name: 'front_created', old_value: null, new_value: JSON.stringify({ sentido: 'exportacao', modalidade: 'granito', terminal_id: 'terminal-1' }), changed_at: '2026-08-18T10:00:00Z' },
        { entity_type: 'voyage_pod_schedule', entity_id: '9::BRVIX', field_name: 'terminal_dates', old_value: null, new_value: JSON.stringify({ terminal_atb: '2026-08-20' }), changed_at: '2026-08-18T11:00:00Z' },
      ],
    })
    expect(events.map((event) => event.kind)).toEqual(['escala-terminal', 'escala-terminal'])
    expect(events.find((event) => event.title.includes('granito'))?.title).toBe('Terminal definido para granito de exportação · BRVIX')
    expect(events.find((event) => event.title.includes('Datas do terminal'))?.title).toBe('Datas do terminal alteradas · BRVIX')
    expect(events.find((event) => event.title.includes('granito'))?.detail).not.toContain('terminal-1')
  })

  it('traduz carga cheia para uma descrição de negócio compreensível', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [{
        entity_type: 'voyage_pod_schedule',
        entity_id: '9::BRSSA',
        field_name: 'front_created',
        old_value: null,
        new_value: JSON.stringify({ sentido: 'importacao', modalidade: 'carga_cheia', terminal_id: 't-1', terminal_code: 'TCP' }),
        changed_at: '2026-08-24T21:41:00Z',
      }],
    })

    expect(events[0].title).toBe('Terminal definido para carga cheia de importação · BRSSA')
    expect(events[0].detail).toBe('Terminal: TCP')
    expect(events[0].detail).not.toContain('carga_cheia')
  })

  it('registra a exclusão de B/L com número e motivo', () => {
    const events = buildVoyageTimeline({
      auditEvents: [{ entity_type: 'voyages', entity_id: '9', field_name: 'bl_deleted', old_value: 'BL123', new_value: 'excluído', justification: 'duplicado', changed_at: '2026-08-24T21:41:00Z' }],
    })
    expect(events[0].title).toBe('B/L BL123 excluído')
    expect(events[0].detail).toContain('Motivo: duplicado')
  })

  it('não exibe inicialização implícita: frente sem terminal e terminal sem datas', () => {
    const base = { entity_type: 'voyage_pod_schedule', entity_id: '9::BRVIX', old_value: null, changed_at: '2026-08-24T21:41:00Z' }
    const events = buildVoyageTimeline({
      scheduleEvents: [
        { ...base, field_name: 'front_created', new_value: JSON.stringify({ sentido: 'importacao', modalidade: 'carga_cheia', terminal_id: null }) },
        { ...base, field_name: 'terminal_dates', new_value: JSON.stringify({ terminal_id: 't-1', terminal_atb: null, terminal_atd: null, terminal_rtw: null }) },
      ],
    })
    expect(events).toEqual([])
  })

  it('não exibe alteração de CE quando o valor novo é igual ao anterior', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [{
        entity_type: 'voyage_pod_schedule',
        entity_id: '9::BRSSA',
        field_name: 'ces',
        old_value: 'received',
        new_value: 'received',
        changed_at: '2026-08-24T21:41:00Z',
      }],
    })

    expect(events.filter((event) => event.kind === 'ce-status')).toHaveLength(0)
  })

  it('não exibe a inicialização implícita de CE como evento operacional', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [{
        entity_type: 'voyage_pod_schedule',
        entity_id: '9::BRSSA',
        field_name: 'ces',
        old_value: null,
        new_value: 'waiting',
        changed_at: '2026-08-24T21:41:00Z',
      }],
    })

    expect(events).toHaveLength(0)
  })

  it('não exibe alteração quando o JSON da auditoria só mudou de ordem', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [{
        entity_type: 'voyage_pod_schedule',
        entity_id: '9::BRSSA',
        field_name: 'export_expectation',
        old_value: JSON.stringify({ granito: true, has_empty: false }),
        new_value: '{"has_empty":false,"granito":true}',
        changed_at: '2026-08-24T21:41:00Z',
      }],
    })

    expect(events).toHaveLength(0)
  })

  it('descreve a declaração de exportação sem atribuí-la a um terminal', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [{
        entity_type: 'voyage_pod_schedule',
        entity_id: '9::BRSSA',
        field_name: 'export_expectation',
        old_value: null,
        new_value: JSON.stringify({ tem_exportacao: true, granito: true, has_empty: true, containers_qty: 12, discharge_ports: ['ITGOA'] }),
        changed_at: '2026-08-24T21:41:00Z',
      }],
    })

    expect(events[0].title).toBe('Exportação atualizada · BRSSA')
    expect(events[0].detail).toContain('Granito')
    expect(events[0].detail).toContain('Vazios (12)')
    expect(events[0].detail).not.toContain('terminal')
  })

  it.each(['ces', 'export_ces'])('resume a mudança de CE (%s) sem repetir o contexto no título e no detalhe', (field) => {
    const events = buildVoyageTimeline({
      scheduleEvents: [{
        entity_type: 'voyage_pod_schedule',
        entity_id: '9::BRSSA',
        field_name: field,
        old_value: 'waiting',
        new_value: 'received',
        changed_at: '2026-08-24T21:41:00Z',
      }],
    })

    expect(events[0].title).toBe('CE atualizado · BRSSA')
    expect(events[0].detail).toBe('Aguardando → Recebido')
  })

  it('explica a troca da origem da operação em linguagem de negócio', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [{
        entity_type: 'voyage_pod_schedule',
        entity_id: '9::BRSSA',
        field_name: 'front_source',
        old_value: 'operational_data',
        new_value: 'export_declaration',
        changed_at: '2026-08-24T21:41:00Z',
      }],
    })

    expect(events[0].detail).toContain('dados operacionais para declaração de exportação')
    expect(events[0].detail).not.toContain('operational_data')
  })

  it('consolida importações de B/L por lote e rota', () => {
    const events = buildVoyageTimeline({
      importBatches: [{
        id: 10,
        filename: 'bl.xlsx',
        cargo_mode: 'container',
        uploaded_at: '2026-07-16T10:00:00Z',
        routes: [
          { pol: 'TAICANG', pod: 'VITÓRIA', blCount: 4 },
          { pol: 'TAICANG', pod: 'VITÓRIA', blCount: 5 },
        ],
      }],
    })

    expect(events.filter((event) => event.kind === 'import')).toHaveLength(1)
    expect(events.find((event) => event.kind === 'import')?.title).toBe('9 B/Ls importados · TAICANG → VITÓRIA')
  })

  it('formata omissão com motivo e sem motivo', () => {
    const withReason = buildVoyageTimeline({ auditEvents: [{
      entity_type: 'voyage', entity_id: '2', field_name: 'escala_omitida',
      old_value: 'VITÓRIA', new_value: 'SANTOS', justification: 'congestionamento portuário',
      changed_at: '2026-07-16T11:00:00Z',
    }] })
    const withoutReason = buildVoyageTimeline({ auditEvents: [{
      entity_type: 'voyage', entity_id: '2', field_name: 'escala_omitida',
      old_value: 'VITÓRIA', new_value: 'SANTOS', justification: 'Omissao de escala',
      changed_at: '2026-07-16T11:00:00Z',
    }] })

    expect(withReason[0].title).toBe('Escala de VITÓRIA omitida · Porto de Transbordo — SANTOS · motivo: congestionamento portuário')
    expect(withoutReason[0].title).toBe('Escala de VITÓRIA omitida · Porto de Transbordo — SANTOS')
  })

  it('exibe a correção como evento próprio após reverter uma omissão', () => {
    const events = buildVoyageTimeline({ auditEvents: [{
      entity_type: 'voyage', entity_id: '2', field_name: 'omissao_revertida',
      old_value: 'VITÓRIA', new_value: 'SANTOS', justification: 'POD informado incorretamente',
      changed_at: '2026-07-16T12:00:00Z',
    }] })

    expect(events[0].kind).toBe('omission')
    expect(events[0].title).toContain('Omissão de VITÓRIA revertida')
    expect(events[0].title).toContain('correção')
    expect(events[0].detail).toContain('Correção de omissão')
  })

  it('mostra complementação do registro global', () => {
    const events = buildVoyageTimeline({ auditEvents: [{
      entity_type: 'voyage', entity_id: '2', field_name: 'transshipment_info',
      old_value: null, new_value: 'Informacoes de Transbordo complementadas',
      changed_at: '2026-07-16T12:00:00Z',
    }] })

    expect(events[0].title).toBe('Informações de Transbordo complementadas')
  })

  it('não emite cobertura de CE para valores numéricos não comparáveis', () => {
    const events = buildVoyageTimeline({
      ceCoverage: { filled: Number.NaN, total: Number.NaN },
      importBatches: [{
        id: 1,
        filename: 'manifesto.edi',
        cargo_mode: 'container',
        uploaded_at: '2026-07-16T10:00:00Z',
      }],
    })

    expect(events.some((event) => event.kind === 'ce-coverage')).toBe(false)
  })
})

describe('fallback de importação de B/L', () => {
  it('exibe contagem e rota do lote quando os B/Ls ainda não estão carregados no detalhe', () => {
    const events = buildVoyageTimeline({
      importBatches: [{
        id: 11,
        filename: 'bl.xlsx',
        cargo_mode: 'container',
        uploaded_at: '2026-07-16T10:00:00Z',
        total_bls: 7,
        route: 'BRSSZ → BRVIX',
      }],
    })

    const event = events.find((item) => item.kind === 'import')
    expect(event?.title).toContain('7 B/Ls importados')
    expect(event?.title).toContain('BRSSZ')
    expect(event?.title).toContain('BRVIX')
    expect(event?.detail).toContain('CNTR')
  })

  it('mostra nome e setor do usuário que alterou o evento, congelado no próprio evento', () => {
    const events = buildVoyageTimeline({
      actorNames: { 'user-1': 'Ana Ribeiro' },
      auditEvents: [{
        entity_type: 'voyage', entity_id: '2', field_name: 'status',
        old_value: null, new_value: 'planning', changed_by: 'user-1', actor_role: 'operacoes',
        changed_at: '2026-07-16T12:00:00Z',
      }],
    })

    expect(events[0].detail).toContain('por Ana Ribeiro (Operações)')
  })

  it('não mistura o setor de um evento mais antigo do mesmo usuário', () => {
    const events = buildVoyageTimeline({
      actorNames: { 'user-1': 'Ana Ribeiro' },
      auditEvents: [
        {
          entity_type: 'voyage', entity_id: '2', field_name: 'status',
          old_value: null, new_value: 'planning', changed_by: 'user-1', actor_role: 'operacoes',
          changed_at: '2026-07-16T12:00:00Z',
        },
        {
          entity_type: 'voyage', entity_id: '2', field_name: 'voyage_number',
          old_value: null, new_value: '001', changed_by: 'user-1', actor_role: 'financeiro',
          changed_at: '2026-01-01T09:00:00Z',
        },
      ],
    })

    expect(events.some((event) => event.detail.includes('por Ana Ribeiro (Operações)'))).toBe(true)
    expect(events.some((event) => event.detail.includes('por Ana Ribeiro (Financeiro)'))).toBe(true)
  })
})
