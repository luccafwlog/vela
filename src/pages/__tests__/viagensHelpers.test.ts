import { describe, expect, it } from 'vitest'
import {
  buildVoyageRailItems,
  buildVoyageTimeline,
  collectVoyagePorts,
  countPlannedPodRows,
  countDistinctBatchIds,
  countDistinctRoutes,
  deriveEstadoConciliacao,
  getGraniteModuleStats,
  getProximaEscala,
  getVaziosModuleStats,
  splitVoyageBls,
  summarizeExportByEmbarkPort,
  summarizeImportByPod,
  summarizeModuleAvailability,
  normalizeVoyageStatus,
  summarizeContainerTypes,
  summarizeOccurrences,
  summarizeUniqueValues,
  voyageCeCoverage,
} from '../../services/voyageSummaries'
import {
  formatMetric,
  formatPortDisplayName,
  normalizePortName,
  stripFileExtension,
  tokenizeInfoValue,
} from '../../lib/voyageFormat'

describe('normalizePortName', () => {
  it('faz trim, uppercase e usa "-" como fallback', () => {
    expect(normalizePortName('  ssz  ')).toBe('SSZ')
    expect(normalizePortName(null)).toBe('-')
    expect(normalizePortName('')).toBe('-')
  })
})

describe('formatPortDisplayName', () => {
  it('mapeia códigos conhecidos para nomes', () => {
    expect(formatPortDisplayName('CNNBO')).toBe('NINGBO')
    expect(formatPortDisplayName('vix')).toBe('VITORIA')
  })

  it('usa o valor original (trim) para códigos desconhecidos', () => {
    expect(formatPortDisplayName('  Santos  ')).toBe('Santos')
    expect(formatPortDisplayName(null)).toBe('-')
  })
})

describe('summarizeContainerTypes', () => {
  it('agrupa por tipo, conta containers distintos e ordena por contagem', () => {
    const containers = [
      { container_number: 'AAAA1', type: '40HC' },
      { container_number: 'AAAA1', type: '40HC' }, // duplicado → conta 1
      { container_number: 'BBBB2', type: '40HC' },
      { container_number: 'CCCC3', type: '20GP' },
    ]
    expect(summarizeContainerTypes(containers)).toBe('40HC: 2 | 20GP: 1')
  })

  it('usa "Não informado" quando o tipo está ausente', () => {
    expect(summarizeContainerTypes([{ container_number: 'X1', type: null }])).toBe('Não informado: 1')
    expect(summarizeContainerTypes(null)).toBe('')
  })
})

describe('summarizeUniqueValues', () => {
  it('deduplica, ignora vazios e ordena alfabeticamente', () => {
    expect(summarizeUniqueValues(['SSZ', 'rio', 'SSZ', '', null, '  '])).toBe('rio | SSZ')
  })
})

describe('summarizeOccurrences', () => {
  it('conta ocorrências por rótulo, ordena por contagem desc', () => {
    const items = [{ k: 'a' }, { k: 'a' }, { k: 'b' }, { k: null }]
    expect(summarizeOccurrences(items, (i) => i.k, 'N/D')).toBe('a: 2 | b: 1 | N/D: 1')
  })
})

describe('normalizeVoyageStatus', () => {
  it('aceita completed/cancelled e default active', () => {
    expect(normalizeVoyageStatus('completed')).toBe('completed')
    expect(normalizeVoyageStatus('cancelled')).toBe('cancelled')
    expect(normalizeVoyageStatus('qualquer')).toBe('active')
    expect(normalizeVoyageStatus(null)).toBe('active')
  })
})

describe('formatMetric', () => {
  it('formata número pt-BR e trata inválidos', () => {
    expect(formatMetric(1500)).toBe((1500).toLocaleString('pt-BR'))
    expect(formatMetric(null)).toBe('0')
    expect(formatMetric(Number.NaN)).toBe('0')
  })
})

describe('tokenizeInfoValue', () => {
  it('divide por "|" apenas quando há mais de um token', () => {
    expect(tokenizeInfoValue('a | b | c')).toEqual(['a', 'b', 'c'])
    expect(tokenizeInfoValue('único')).toEqual([])
    expect(tokenizeInfoValue('-')).toEqual([])
    expect(tokenizeInfoValue('')).toEqual([])
  })
})

describe('stripFileExtension', () => {
  it('remove a última extensão', () => {
    expect(stripFileExtension('manifesto.xlsx')).toBe('manifesto')
    expect(stripFileExtension('base.clientes.csv')).toBe('base.clientes')
    expect(stripFileExtension('semext')).toBe('semext')
  })
})

describe('splitVoyageBls', () => {
  it('separa B/Ls de container e carga solta', () => {
    const bls = [
      { id: 'A', cargo_mode: 'container' },
      { id: 'B', cargo_mode: 'carga_solta' },
      { id: 'C', cargo_mode: null }, // default → container
    ] as never
    const { containerBls, breakbulkBls } = splitVoyageBls(bls)
    expect(containerBls.map((b) => b.id)).toEqual(['A', 'C'])
    expect(breakbulkBls.map((b) => b.id)).toEqual(['B'])
  })

  it('lida com null/undefined', () => {
    expect(splitVoyageBls(null)).toEqual({ containerBls: [], breakbulkBls: [] })
  })
})

describe('countDistinctBatchIds', () => {
  it('conta lotes distintos ignorando nulos/duplicados', () => {
    const bls = [{ batch_id: 1 }, { batch_id: 1 }, { batch_id: 2 }, { batch_id: null }] as never
    expect(countDistinctBatchIds(bls)).toBe(2)
  })
})

describe('getGraniteModuleStats', () => {
  it('agrega manifestos, peso (ton) e contagens por status', () => {
    const manifests = [
      {
        total_bls: 2,
        total_weight_kg: 2000,
        discharge_port: 'SSZ',
        granite_bls: [
          { id: '1', charge_status: 'ready_for_billing' },
          { id: '2', charge_status: 'invoiced' },
        ],
      },
    ] as never
    const s = getGraniteModuleStats(manifests)
    expect(s.totalManifests).toBe(1)
    expect(s.totalBls).toBe(2)
    expect(s.totalWeightTon).toBe(2)
    expect(s.readyForBillingCount).toBe(1)
    expect(s.invoicedCount).toBe(1)
    expect(s.dischargePorts).toBe('SSZ')
  })

  it('usa o tamanho de granite_bls quando total_bls é nulo', () => {
    const manifests = [{ total_bls: null, granite_bls: [{ id: '1', charge_status: null }] }] as never
    expect(getGraniteModuleStats(manifests).totalBls).toBe(1)
  })
})

describe('getVaziosModuleStats', () => {
  it('agrega Unidades Embarcadas, containers distintos, tipos e locais de origem', () => {
    const manifests = [
      {
        total_bookings: 3,
        vazios_bookings: [
          { id: '1', container_number: 'AAA1', container_type: '40HC', local: { code: 'DEP-A', name: 'Depot A', tipo: 'depot' } },
          { id: '2', container_number: 'AAA1', container_type: '40HC', local: { code: 'DEP-A', name: 'Depot A', tipo: 'depot' } },
          { id: '3', container_number: 'BBB2', container_type: '20GP', local: { code: 'TVV', name: 'Terminal TVV', tipo: 'terminal_portuario' } },
        ],
      },
    ] as never
    const s = getVaziosModuleStats(manifests)
    expect(s.totalUnits).toBe(3)
    expect(s.distinctContainers).toBe(2)
    expect(s.containerTypes).toBe('40HC: 2 | 20GP: 1')
    expect(s.origins).toBe('Depot A | Terminal TVV')
  })
})

describe('summarizeModuleAvailability', () => {
  it('lista apenas os módulos presentes', () => {
    expect(
      summarizeModuleAvailability({ hasCntrs: true, hasBreakbulk: false, hasVehicles: true, hasGranite: false, hasVazios: true }),
    ).toBe('CNTRS/VEICULOS/VAZIOS')
  })
  it('retorna "-" quando nenhum módulo está presente', () => {
    expect(
      summarizeModuleAvailability({ hasCntrs: false, hasBreakbulk: false, hasVehicles: false, hasGranite: false, hasVazios: false }),
    ).toBe('-')
  })
})

describe('collectVoyagePorts', () => {
  const bls = [
    { pol: 'BRVIX', pod: 'CNNBO' },
    { pol: 'BRVIX', pod: 'CNSHG' }, // pol duplicado
    { pol: ' brssa ', pod: null },
  ]

  it('coleta o campo pedido, faz dedup, trim e ordena', () => {
    expect(collectVoyagePorts(bls, 'pol', null)).toEqual(['BRSSA', 'BRVIX'])
    expect(collectVoyagePorts(bls, 'pod', null)).toEqual(['CNNGB', 'CNSHA'])
  })

  it('usa o fallback apenas quando não há portos', () => {
    expect(collectVoyagePorts([], 'pol', 'BRVIX')).toEqual(['BRVIX'])
    expect(collectVoyagePorts(null, 'pol', null)).toEqual([])
    // com portos, o fallback é ignorado
    expect(collectVoyagePorts(bls, 'pol', 'XPTO')).toEqual(['BRSSA', 'BRVIX'])
  })

  it('inclui extraPorts (com trim e dedup)', () => {
    expect(collectVoyagePorts([{ pol: 'BRVIX', pod: null }], 'pol', null, [' BRSSA ', 'BRVIX', null])).toEqual([
      'BRSSA',
      'BRVIX',
    ])
  })

  it('inclui portas vindas da projeção unificada de escalas', () => {
    expect(collectVoyagePorts([], 'pod', null, [{ port: ' BRVIX ' }, { port: 'BRSSZ' }])).toEqual(['BRSSZ', 'BRVIX'])
  })
})

describe('countPlannedPodRows', () => {
  it('conta toda linha POD planejada mesmo sem datas ou vinculo ESCALA', () => {
    const rows = [
      { pod: 'CNNBO', eta: null, etb: null, ata: null, atd: null, linked: false },
      { pod: 'CNSHG', eta: '2026-06-01', etb: null, ata: null, atd: null, linked: false },
      { pod: 'CNNBO', eta: null, etb: null, ata: null, atd: null, linked: true },
      { pod: '', eta: null, etb: null, ata: null, atd: null, linked: false },
    ]

    expect(countPlannedPodRows(rows)).toBe(2)
  })
})

describe('voyageCeCoverage', () => {
  it('conta B/Ls com ce_mercante preenchido', () => {
    const bls = [{ ce_mercante: 'CE1' }, { ce_mercante: '  ' }, { ce_mercante: null }, { ce_mercante: 'CE2' }]
    expect(voyageCeCoverage(bls)).toEqual({ filled: 2, total: 4 })
    expect(voyageCeCoverage(null)).toEqual({ filled: 0, total: 0 })
  })
})

describe('countDistinctRoutes', () => {
  it('conta pares POL/POD distintos, normalizando caixa/espaços', () => {
    const bls = [
      { pol: 'CNTAC', pod: 'BRVIX' },
      { pol: ' cntac ', pod: 'brvix' },
      { pol: 'CNSHA', pod: 'BRSSA' },
    ]
    expect(countDistinctRoutes(bls)).toBe(2)
  })
  it('não depende de batch: B/Ls só-B/L (sem batch) contam por rota', () => {
    const bls = [
      { pol: 'CNTAC', pod: 'BRVIX' },
      { pol: 'CNTAC', pod: 'BRRIO' },
    ]
    expect(countDistinctRoutes(bls)).toBe(2)
  })
  it('trata POL/POD ausente como "-"', () => {
    expect(countDistinctRoutes([{ pol: null, pod: null }, {}])).toBe(1)
    expect(countDistinctRoutes(null)).toBe(0)
  })
})

describe('deriveEstadoConciliacao', () => {
  it('divergente quando há divergências abertas (prioridade máxima)', () => {
    expect(deriveEstadoConciliacao({ hasOpenDivergences: true, ceFilled: 10, ceTotal: 10 })).toBe('divergente')
  })
  it('incompleto quando a cobertura de CE é parcial', () => {
    expect(deriveEstadoConciliacao({ hasOpenDivergences: false, ceFilled: 8, ceTotal: 10 })).toBe('incompleto')
  })
  it('conciliado quando CE completa — inclusive viagem só-B/L sem manifesto', () => {
    expect(deriveEstadoConciliacao({ hasOpenDivergences: false, ceFilled: 10, ceTotal: 10 })).toBe('conciliado')
    expect(deriveEstadoConciliacao({ hasOpenDivergences: false, ceFilled: 0, ceTotal: 0 })).toBe('conciliado')
  })
})

describe('getProximaEscala', () => {
  it('escolhe o menor ETA entre PODs sem ATA', () => {
    const rows = [
      { pod: 'BRSSA', eta: '2026-06-12', etb: '2026-06-13', ata: null },
      { pod: 'BRVIX', eta: '2026-06-09', etb: '2026-06-10', ata: null },
      { pod: 'CNSHA', eta: '2026-06-01', etb: '2026-06-02', ata: '2026-06-01' }, // já chegou → ignora
    ]
    expect(getProximaEscala(rows)).toEqual({ pod: 'BRVIX', eta: '2026-06-09', etb: '2026-06-10' })
  })
  it('nulo quando todas têm ATA ou não há ETA', () => {
    expect(getProximaEscala([{ pod: 'X', eta: null, ata: null }])).toBeNull()
    expect(getProximaEscala([{ pod: 'X', eta: '2026-06-01', ata: '2026-06-01' }])).toBeNull()
    expect(getProximaEscala([])).toBeNull()
  })

  it('aceita escalas unificadas de exportação e mantém ETA vencido pendente', () => {
    const rows = [
      { port: 'BRSSZ', eta: '2026-06-01', etb: '2026-06-02', ata: null, temExportacao: true },
      { port: 'BRVIX', eta: '2026-06-03', etb: '2026-06-04', ata: null, temExportacao: true },
    ]
    expect(getProximaEscala(rows)).toEqual({ pod: 'BRSSZ', eta: '2026-06-01', etb: '2026-06-02' })
  })
})

describe('summarizeImportByPod', () => {
  const bls = [
    {
      id: 'A',
      cargo_mode: 'container',
      pod: 'BRSSA',
      bl_containers: [
        { id: 1, container_number: 'GEN1', is_imo: true, is_oog: false, type: '40HC' },
        { id: 2, container_number: 'VEH1', is_imo: false, is_oog: false, type: '40HC' },
      ],
    },
    {
      id: 'B',
      cargo_mode: 'container',
      pod: 'BRVIX',
      bl_containers: [{ id: 3, container_number: 'GEN2', is_imo: false, is_oog: true, type: '20DV' }],
    },
    {
      id: 'C',
      cargo_mode: 'carga_solta',
      pod: 'BRSSA',
      bb_machine_qty: 4,
      bb_packages_qty: 100,
      bb_weight_ton: 12,
      total_cbm: 30,
    },
  ] as never

  it('segmenta containers/veículos/carga solta por POD', () => {
    const summary = summarizeImportByPod(bls, ['VEH1'])
    const ssa = summary.find((s) => s.pod === 'BRSSA')!
    const vix = summary.find((s) => s.pod === 'BRVIX')!

    expect(summary.map((s) => s.pod)).toEqual(['BRSSA', 'BRVIX'])
    expect(ssa.containers.distinct).toBe(2)
    expect(ssa.containers.imo).toBe(1)
    expect(ssa.generalCargo.distinct).toBe(1) // GEN1 (VEH1 é veículo)
    expect(ssa.vehicles.distinctContainers).toBe(1)
    expect(ssa.breakbulk).toEqual({ bls: 1, machines: 4, packages: 100, weightTon: 12, cbm: 30 })
    expect(vix.containers.oog).toBe(1)
    expect(vix.vehicles.distinctContainers).toBe(0)
  })

  it('consolida aliases de Vitoria no POD canonico', () => {
    const summary = summarizeImportByPod([
      { id: 'alias', cargo_mode: 'container', pod: 'Vitoria', bl_containers: [{ id: 4, container_number: 'VIX1' }] },
      { id: 'code', cargo_mode: 'container', pod: 'BRVIT', bl_containers: [{ id: 5, container_number: 'VIX2' }] },
    ] as never, [])

    expect(summary.map((row) => row.pod)).toEqual(['BRVIX'])
    expect(summary[0].containers.distinct).toBe(2)
  })
})

describe('buildVoyageRailItems', () => {
  const voyages = [
    {
      id: 1,
      voyage_number: 'O88E',
      status: 'active',
      vessel: { name: 'ARIES', carrier: { name: 'COSCO' } },
      pol: { name: 'CNSHA' },
      pod: { name: 'BRSSA' },
      import_batches: [{ id: 10 }],
      bls: [
        { id: 'a', cargo_mode: 'container', pol: 'CNSHA', pod: 'BRSSA', ce_mercante: 'CE1', batch_id: 10, bl_containers: [{ id: 1, container_number: 'C1' }] },
        { id: 'b', cargo_mode: 'container', pol: 'CNSHA', pod: 'BRVIX', ce_mercante: null, batch_id: 10, bl_containers: [{ id: 2, container_number: 'C2' }] },
      ],
    },
  ] as never

  it('monta item com estado, rota, contagens e próxima escala', () => {
    const podRows = new Map([
      [1, [
        { pod: 'BRSSA', eta: '2026-06-12', etb: '2026-06-13', ata: null },
        { pod: 'BRVIX', eta: '2026-06-09', etb: '2026-06-10', ata: null },
      ]],
    ])
    const [item] = buildVoyageRailItems(voyages, podRows)

    expect(item.carrierName).toBe('COSCO')
    expect(item.vesselName).toBe('ARIES')
    // 1 de 2 B/Ls com CE → incompleto
    expect(item.estado).toBe('incompleto')
    expect(item.blCount).toBe(2)
    expect(item.containerCount).toBe(2)
    expect(item.ceCoverage).toEqual({ filled: 1, total: 2 })
    expect(item.proximaEscala).toEqual({ pod: 'BRVIX', eta: '2026-06-09', etb: '2026-06-10' })
    expect(item.destinationPorts).toContain('BRSSA')
    expect(item.destinationPorts).toContain('BRVIX')
    expect(item.escalasBrasileiras).toEqual([
      { port: 'BRVIX', eta: '2026-06-09' },
      { port: 'BRSSA', eta: '2026-06-12' },
    ])
    expect(item.modules.container).toBe(true)
    expect(item.modules.cargaSolta).toBe(false)
  })

  it('usa mapa vazio de escalas sem quebrar', () => {
    const [item] = buildVoyageRailItems(voyages, new Map())
    expect(item.proximaEscala).toBeNull()
    expect(item.escalasBrasileiras).toEqual([])
  })

  it('monta rail de viagem só de exportação a partir de escala unificada sem fallback de POD', () => {
    const exportOnlyVoyages = [{
      id: 2,
      voyage_number: '001E',
      status: 'active',
      vessel: { name: 'EXPORTER', carrier: { name: 'COSCO' } },
      pol: { name: 'CNSHA' },
      pod: { name: 'CNSHA' },
      bls: [],
    }] as never
    const escalas = new Map([
      [2, [{
        port: 'BRVIX',
        eta: '2026-06-01',
        etb: '2026-06-02',
        ata: null,
        omitted: false,
        temExportacao: true,
      }]],
    ])

    const [item] = buildVoyageRailItems(exportOnlyVoyages, escalas)

    expect(item.originPorts).toEqual(['BRVIX'])
    expect(item.destinationPorts).toEqual(['BRVIX'])
    expect(item.proximaEscala).toEqual({ pod: 'BRVIX', eta: '2026-06-01', etb: '2026-06-02' })
    expect(item.escalasBrasileiras).toEqual([{ port: 'BRVIX', eta: '2026-06-01' }])
  })

  it('não ressuscita vazios de exportação por quantidades com declaração desligada', () => {
    const escalas = new Map([
      [1, [{
        port: 'BRVIX', eta: '2026-06-01', etb: null, ata: null, omitted: false,
        temExportacao: false, temVazios: true, containersQty: 10, movementsQty: 2,
      }]],
    ])

    const [item] = buildVoyageRailItems(voyages, escalas)

    expect(item.modules.vazios).toBe(false)
    expect(item.escalasBrasileiras[0]).toEqual({ port: 'BRVIX', eta: '2026-06-01' })
  })

  it('marca módulos de veículos, vazios de importação e granito a partir das stats por viagem', () => {
    const moduleStats = new Map([[1, { hasVehicles: true, hasVaziosImportacao: true, hasGranite: true }]])
    const [item] = buildVoyageRailItems(voyages, new Map(), moduleStats)
    expect(item.modules).toEqual({ container: true, cargaSolta: false, veiculos: true, vazios: true, granito: true })
  })

  it('escala omitida não entra em escalasBrasileiras', () => {
    const escalas = new Map([
      [1, [{ pod: 'BRSSA', eta: '2026-06-12', etb: null, ata: null, omitted: true }]],
    ])
    const [item] = buildVoyageRailItems(voyages, escalas)
    expect(item.escalasBrasileiras).toEqual([])
  })
})

describe('buildVoyageTimeline', () => {
  it('agrega imports, eventos de escala e resoluções, ordenando do mais recente', () => {
    const events = buildVoyageTimeline({
      importBatches: [
        { id: 1, filename: 'cosco.xlsx', cargo_mode: 'container', uploaded_at: '2026-06-10T10:00:00Z' },
        { id: 2, filename: 'sem-data', cargo_mode: 'carga_solta', uploaded_at: null }, // ignorado
      ],
      scheduleEvents: [
        { entity_id: '7::BRSSA', field_name: 'eta', new_value: '2026-06-12', changed_at: '2026-06-11T09:00:00Z' },
        { entity_id: '7::BRSSA', field_name: 'escala_number', new_value: '25BR00481', changed_at: '2026-06-11T16:00:00Z' },
        { entity_id: '7::BRSSA', field_name: 'linked', new_value: 'true', changed_at: '2026-06-11T16:05:00Z' },
        { entity_id: '7::BRSSA', field_name: 'eta', new_value: '', changed_at: '2026-06-11T17:00:00Z' }, // limpo → ignora
        { entity_id: '7::BRSSA', field_name: 'rtw', new_value: '2', changed_at: '2026-06-11T18:00:00Z' }, // não mapeado → ignora
      ],
      resolutions: [{ field_name: 'is_imo', resolved_at: '2026-06-13T08:00:00Z' }],
    })

    expect(events.map((e) => e.kind)).toEqual([
      'divergence-resolved', // 13/06
      'restow', // 11/06 18:00
      'manifestos-linked', // 11/06 16:05
      'escala-number', // 11/06 16:00
      'escala-date', // 11/06 09:00
      'import', // 10/06
    ])
    expect(events.find((event) => event.kind === 'escala-number')?.detail).toBe('Nº 25BR00481')
  })

  it('usa a rota do manifesto no detalhe do import quando informada', () => {
    const events = buildVoyageTimeline({
      importBatches: [
        { id: 1, filename: 'MANIFEST 汽车箱 BRVIT', cargo_mode: 'container', uploaded_at: '2026-06-10T10:00:00Z', route: 'CNQDG → BRVIX' },
      ],
    })
    expect(events[0].detail).toBe('CNTR · CNQDG → BRVIX')
  })

  it('cai no nome do arquivo quando a rota não é informada', () => {
    const events = buildVoyageTimeline({
      importBatches: [{ id: 1, filename: 'cosco.xlsx', cargo_mode: 'container', uploaded_at: '2026-06-10T10:00:00Z' }],
    })
    expect(events[0].detail).toBe('CNTR · cosco')
  })

  it('lida com fontes vazias', () => {
    expect(buildVoyageTimeline({})).toEqual([])
  })

  it('registra remoção de POD (field deleted=true)', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [
        { entity_id: '7::BRSSA', field_name: 'deleted', new_value: 'true', changed_at: '2026-06-14T10:00:00Z' },
      ],
    })
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('pod-removed')
    expect(events[0].title).toBe('Escala removida do planejamento · BRSSA')
  })

  it('exibe ETD do POL, mudanças de datas com autor, CE status, RTW e POD reincluído', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [
        {
          entity_id: '7::CNSHA',
          field_name: 'etd',
          old_value: null,
          new_value: '2026-06-08',
          changed_by: 'user-1',
          changed_at: '2026-06-08T12:00:00Z',
        },
        {
          entity_id: '7::BRVIX',
          field_name: 'ata',
          old_value: '2026-06-11',
          new_value: '2026-06-12',
          changed_by: 'user-2',
          changed_at: '2026-06-12T12:00:00Z',
        },
        { entity_id: '7::BRVIX', field_name: 'ces', old_value: 'received', new_value: 'approved', changed_at: '2026-06-12T13:00:00Z' },
        { entity_id: '7::BRVIX', field_name: 'rtw', old_value: null, new_value: '3', changed_at: '2026-06-12T14:00:00Z' },
        { entity_id: '7::BRVIX', field_name: 'deleted', old_value: 'true', new_value: 'false', changed_at: '2026-06-12T15:00:00Z' },
      ],
    })

    expect(events.map((event) => event.kind)).toEqual(['pod-added', 'restow', 'ce-status', 'escala-date', 'escala-date'])
    expect(events.find((event) => event.title.includes('ETD'))?.title).toBe('ETD registrado · CNSHA')
    expect(events.find((event) => event.title.includes('ATA'))?.title).toBe('ATA alterado · BRVIX')
    expect(events.find((event) => event.title.includes('ATA'))?.detail).toBe('11/06/2026 -> 12/06/2026 · por user-2')
    expect(events.find((event) => event.kind === 'ce-status')?.detail).toBe('Recebido → Aprovado')
    expect(events.find((event) => event.kind === 'restow')?.detail).toBe('RTW 3')
  })

  it('inclui eventos derivados de Baplie, divergência aberta, viagem concluída e cobertura de CE completa', () => {
    const events = buildVoyageTimeline({
      importBatches: [
        { id: 1, filename: 'manifesto.xlsx', cargo_mode: 'container', uploaded_at: '2026-06-10T10:00:00Z', ce_master: 'CE123' },
      ],
      scheduleEvents: [
        { entity_id: '7::BRVIX', field_name: 'atd', new_value: '2026-06-14', changed_at: '2026-06-14T12:00:00Z' },
        { entity_id: '7::BRSSA', field_name: 'atd', new_value: '2026-06-15', changed_at: '2026-06-15T12:00:00Z' },
      ],
      baplieImports: [{ created_at: '2026-06-09T09:00:00Z', container_count: 42 }],
      openDivergenceCount: 2,
      voyageStatus: 'completed',
      ceCoverage: { filled: 3, total: 3 },
    })

    expect(events.map((event) => event.kind)).toEqual([
      'voyage-completed',
      'escala-date',
      'escala-date',
      'ce-master',
      'ce-coverage',
      'import',
      'divergence-opened',
      'baplie-import',
    ])
    expect(events.find((event) => event.kind === 'baplie-import')?.detail).toBe('42 containers')
    expect(events.find((event) => event.kind === 'divergence-opened')?.detail).toBe('2 divergências abertas')
    expect(events.find((event) => event.kind === 'ce-master')?.detail).toBe('CE123')
  })

  it('inclui eventos auditados de dados da viagem e CE Master alterado', () => {
    const events = buildVoyageTimeline({
      auditEvents: [
        {
          entity_type: 'voyages',
          entity_id: '7',
          field_name: 'voyage_number',
          old_value: '001E',
          new_value: '002E',
          changed_by: 'user-1',
          changed_at: '2026-06-11T10:00:00Z',
        },
        {
          entity_type: 'import_batches',
          entity_id: '1',
          field_name: 'ce_master',
          old_value: 'CE000',
          new_value: 'CE999',
          changed_at: '2026-06-12T10:00:00Z',
        },
      ],
    })

    expect(events.map((event) => event.kind)).toEqual(['ce-master', 'voyage-data'])
    expect(events[0].title).toBe('Nº de Manifesto Mercante alterado')
    expect(events[0].detail).toBe('CE000 -> CE999')
    expect(events[1].title).toBe('Dados da viagem alterados')
    expect(events[1].detail).toBe('Nº da viagem: 001E -> 002E · por user-1')
  })

  it('resolve o autor pelo nome e não exibe UUID cru', () => {
    const userId = '1d9675f6-5737-4db8-bf6e-ce45414e574b'
    const eventsWithName = buildVoyageTimeline({
      actorNames: { [userId]: 'Lucca' },
      scheduleEvents: [
        { entity_id: '7::BRVIX', field_name: 'eta', new_value: '2026-06-06', changed_by: userId, changed_at: '2026-06-17T16:05:00Z' },
      ],
    })
    const eventsWithoutName = buildVoyageTimeline({
      scheduleEvents: [
        { entity_id: '7::BRVIX', field_name: 'eta', new_value: '2026-06-06', changed_by: userId, changed_at: '2026-06-17T16:05:00Z' },
      ],
    })

    expect(eventsWithName[0].detail).toBe('06/06/2026 · por Lucca')
    expect(eventsWithoutName[0].detail).toBe('06/06/2026')
  })
})

describe('summarizeExportByEmbarkPort', () => {
  it('consolida aliases de Vitoria no POL canonico', () => {
    const summary = summarizeExportByEmbarkPort(
      [{ loading_port: 'Vitoria', total_bls: 1, total_weight_kg: 1000, granite_bls: [] }] as never,
      [{ vazios_bookings: [{ id: 'vix', container_number: 'VIX1', container_type: '40HC', operation: { embark_port: 'BRVIT' }, local: { id: 'depot-vix', code: 'VIX-DP', name: 'Depot Vitória' } }] }] as never,
    )

    expect(summary.map((row) => row.embarkPort)).toEqual(['BRVIX'])
    expect(summary[0].granite.manifests).toBe(1)
    expect(summary[0].vazios.units).toBe(1)
    expect(summary[0].vazios.depots).toEqual([{ code: 'VIX-DP', name: 'Depot Vitória', units: 1, types: '40HC: 1' }])
  })

  it('agrupa dois depots no mesmo terminal de embarque', () => {
    const granite = [
      { loading_port: 'CNSHA', total_bls: 5, total_weight_kg: 2000, granite_bls: [{ id: '1', charge_status: 'invoiced' }] },
    ] as never
    const vazios = [
      {
        vazios_bookings: [
          { id: '1', container_number: 'V1', container_type: '40HC', local_id: 'local-sha', condition: 'vazio', operation: { embark_port: 'CNSHA' }, local: { id: 'local-sha', code: 'SHA-DP', name: 'Depot SHA', tipo: 'depot' } },
          { id: '2', container_number: 'V2', container_type: '20GP', local_id: 'local-nbo', condition: 'vazio', operation: { embark_port: 'CNSHA' }, local: { id: 'local-nbo', code: 'NBO-DP', name: 'Depot NBO', tipo: 'depot' } },
        ],
      },
    ] as never

    const summary = summarizeExportByEmbarkPort(granite, vazios)
    const sha = summary.find((s) => s.embarkPort === 'CNSHA')!

    expect(summary.map((s) => s.embarkPort)).toEqual(['CNSHA'])
    expect(sha.granite.manifests).toBe(1)
    expect(sha.granite.bls).toBe(5)
    expect(sha.granite.weightTon).toBe(2)
    expect(sha.granite.invoiced).toBe(1)
    expect(sha.vazios.units).toBe(2)
    expect(sha.vazios.depots).toHaveLength(2)
    expect(sha.vazios.depots.map((depot) => depot.code)).toEqual(['NBO-DP', 'SHA-DP'])
  })

  it('ordena depots pelo código mesmo quando os IDs locais tiverem ordem inversa', () => {
    const vazios = [
      {
        vazios_bookings: [
          { id: '1', container_number: 'V1', container_type: '40HC', local_id: 'uuid-z', condition: 'vazio', operation: { embark_port: 'BRSSZ' }, local: { id: 'uuid-z', code: 'AAA-DP', name: 'Depot Alpha' } },
          { id: '2', container_number: 'V2', container_type: '20GP', local_id: 'uuid-a', condition: 'vazio', operation: { embark_port: 'BRSSZ' }, local: { id: 'uuid-a', code: 'ZZZ-DP', name: 'Depot Zulu' } },
        ],
      },
    ] as never

    const summary = summarizeExportByEmbarkPort([], vazios)
    expect(summary[0].vazios.depots.map((d) => d.code)).toEqual(['AAA-DP', 'ZZZ-DP'])
  })

  it('trata terminal com apenas granito e zero vazios', () => {
    const granite = [
      { loading_port: 'BRSSA', total_bls: 3, total_weight_kg: 5000, granite_bls: [] },
    ] as never

    const summary = summarizeExportByEmbarkPort(granite, [])
    expect(summary).toHaveLength(1)
    expect(summary[0].embarkPort).toBe('BRSSA')
    expect(summary[0].granite.bls).toBe(3)
    expect(summary[0].vazios.units).toBe(0)
    expect(summary[0].vazios.distinctContainers).toBe(0)
    expect(summary[0].vazios.depots).toEqual([])
  })
})
