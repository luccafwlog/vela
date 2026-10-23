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

// Revisão manual de 2026-10-22 (bloco F da linha do tempo).
describe('linha do tempo da viagem — revisão de 2026-10-22', () => {
  const actorNames = { 'u-1': 'Ana Lima' }

  it('F1: o cadastro pelo botão Nova viagem é um único "Viagem criada", com origem e autor', () => {
    const events = buildVoyageTimeline({
      actorNames,
      auditEvents: [
        { entity_type: 'voyages', entity_id: '7', field_name: 'criado', new_value: '{"id":7,"show_on_portal":false,"voyage_number":"11"}', changed_by: 'u-1', changed_at: '2026-10-22T10:00:00Z' },
        { entity_type: 'voyages', entity_id: '7', field_name: 'created', old_value: null, new_value: '11', changed_by: 'u-1', justification: 'Origem: botão Nova viagem', changed_at: '2026-10-22T10:00:01Z' },
      ],
    })
    expect(events).toEqual([expect.objectContaining({
      kind: 'voyage-data', title: 'Viagem criada', at: '2026-10-22T10:00:00Z',
      detail: 'Origem: botão Nova viagem · Fora de Chegadas e Saídas · por Ana Lima',
    })])
  })

  it('F1: a criação por Chegadas e Saídas junta a aparição ligada logo depois e esconde as cópias internas', () => {
    const events = buildVoyageTimeline({
      actorNames,
      auditEvents: [
        { entity_type: 'voyages', entity_id: '7', field_name: 'criado', new_value: '{"id":7,"show_on_portal":false}', changed_by: 'u-1', changed_at: '2026-10-22T10:00:00Z' },
        { entity_type: 'voyages', entity_id: '7', field_name: 'created', new_value: '11', changed_by: 'u-1', justification: 'Origem: Chegadas e Saídas', changed_at: '2026-10-22T10:00:01Z' },
        { entity_type: 'voyages', entity_id: '7', field_name: 'show_on_portal', old_value: 'false', new_value: 'true', changed_by: 'u-1', changed_at: '2026-10-22T10:00:02Z' },
        { entity_type: 'voyages', entity_id: '7', field_name: 'pol_schedule_snapshot', old_value: '{}', new_value: '{"CNSHA":{"etd":"2026-10-01"}}', changed_by: 'u-1', changed_at: '2026-10-22T10:00:03Z' },
      ],
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ title: 'Viagem criada', detail: 'Origem: Chegadas e Saídas · Aparece em Chegadas e Saídas · por Ana Lima' })
  })

  it('F1: a viagem da planilha de Chegadas e Saídas tira a origem do contexto da importação', () => {
    const events = buildVoyageTimeline({
      auditEvents: [
        { entity_type: 'voyages', entity_id: '7', field_name: 'criado', new_value: '{"show_on_portal":false}', justification: 'Importação de Programação', changed_at: '2026-10-22T10:00:00Z' },
        { entity_type: 'voyages', entity_id: '7', field_name: 'created', new_value: '11', justification: 'Atualizacao de dados da viagem', changed_at: '2026-10-22T10:00:00Z' },
        { entity_type: 'voyages', entity_id: '7', field_name: 'show_on_portal', old_value: 'false', new_value: 'true', changed_at: '2026-10-22T10:00:00Z' },
      ],
    })
    expect(events).toEqual([expect.objectContaining({ title: 'Viagem criada', detail: 'Origem: planilha de Chegadas e Saídas · Aparece em Chegadas e Saídas' })])
  })

  it('F3: mudança posterior da aparição diz o campo e o valor anterior → novo', () => {
    const events = buildVoyageTimeline({
      auditEvents: [
        { entity_type: 'voyages', entity_id: '7', field_name: 'created', new_value: '11', justification: 'Origem: botão Nova viagem', changed_at: '2026-10-22T10:00:00Z' },
        { entity_type: 'voyages', entity_id: '7', field_name: 'show_on_portal', old_value: 'false', new_value: 'true', changed_at: '2026-10-23T09:00:00Z' },
      ],
    })
    expect(events.map((event) => [event.title, event.detail])).toEqual([
      ['Dados da viagem alterados', 'Aparece em Chegadas e Saídas: Não → Sim'],
      ['Viagem criada', 'Origem: botão Nova viagem'],
    ])
  })

  it('F2: a importação de B/Ls é um evento só, com o ATD do POL e o status de BLs e CEs que ela mudou', () => {
    const events = buildVoyageTimeline({
      actorNames,
      importBatches: [{
        id: 30, filename: 'bls.xlsx', cargo_mode: 'container', uploaded_at: '2026-10-22T12:00:00Z', uploaded_by: 'u-1',
        routes: [{ pol: 'CNSHA', pod: 'BRVIX', blCount: 40 }],
      }],
      scheduleEvents: [
        { entity_id: '7::CNSHA', field_name: 'atd', old_value: null, new_value: '2026-10-01', changed_by: 'u-1', changed_at: '2026-10-22T12:00:00Z',
          justification: 'ATD derivado do menor Laden on Board dos B/Ls ativos, na importação do B/L (ADR 0025; ADR 0095, decisão 23)' },
        { entity_id: '7::BRVIX', field_name: 'ces', old_value: 'waiting', new_value: 'received', changed_by: 'u-1', changed_at: '2026-10-22T12:00:04Z',
          justification: 'Atualização automática de BLs e CEs pela conciliação documental: os 672 containers cheios do Baplie em BRVIX têm B/L ativo (Importação de B/L · Viagem GREEN ITAJAI 11)' },
      ],
    })
    expect(events).toEqual([expect.objectContaining({
      kind: 'import',
      title: '40 B/Ls importados · CNSHA → BRVIX',
      detail: 'CNTR · ATD do POL CNSHA: 01/10/2026 · BLs e CEs BRVIX: Aguardando → Recebido · por Ana Lima',
    })])
  })

  it('F4: status automático fora da importação de B/L mostra o fato e o que o disparou, não "justificativa"', () => {
    const events = buildVoyageTimeline({
      importBatches: [{ id: 31, filename: 'bls.xlsx', cargo_mode: 'container', uploaded_at: '2026-10-22T12:00:00Z', routes: [{ pol: 'CNSHA', pod: 'BRVIX', blCount: 1 }] }],
      scheduleEvents: [
        { entity_id: '7::BRVIX', field_name: 'ces', old_value: 'waiting', new_value: 'received', changed_at: '2026-10-22T12:01:00Z',
          justification: 'Atualização automática de BLs e CEs pela conciliação documental: os 2 containers cheios do Baplie em BRVIX têm B/L ativo (Importação de Baplie · Viagem GREEN ITAJAI 11)' },
      ],
    })
    const ce = events.find((event) => event.kind === 'ce-status')
    expect(ce?.title).toBe('CE atualizado · BRVIX')
    expect(ce?.detail).toBe('Aguardando → Recebido · Automático: os 2 containers cheios do Baplie em BRVIX têm B/L ativo (Importação de Baplie · Viagem GREEN ITAJAI 11)')
  })
  it('F2: status automático sem contexto de importação (edição manual) não entra no lote importado logo antes', () => {
    const events = buildVoyageTimeline({
      importBatches: [{ id: 32, filename: 'bls.xlsx', cargo_mode: 'container', uploaded_at: '2026-10-22T12:00:00Z', routes: [{ pol: 'CNSHA', pod: 'BRVIX', blCount: 1 }] }],
      scheduleEvents: [
        { entity_id: '7::BRVIX', field_name: 'ces', old_value: 'waiting', new_value: 'received', changed_at: '2026-10-22T12:01:00Z',
          justification: 'Atualização automática de BLs e CEs pela conciliação documental: os 2 containers cheios do Baplie em BRVIX têm B/L ativo' },
      ],
    })
    expect(events.find((event) => event.kind === 'ce-status')?.title).toBe('CE atualizado · BRVIX')
    expect(events.find((event) => event.kind === 'import')?.detail).not.toContain('BLs e CEs')
  })
})
