import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  createVoyage: vi.fn(),
  setShow: vi.fn(),
  findVoyage: vi.fn(),
  record: vi.fn(),
  listPod: vi.fn(),
  listPol: vi.fn(),
  blSelect: vi.fn(),
}))

vi.mock('../voyages', async (importOriginal) => ({
  duplicateVoyageMessage: (await importOriginal<typeof import('../voyages')>()).duplicateVoyageMessage,
  voyageRegistrationRefusal: (await importOriginal<typeof import('../voyages')>()).voyageRegistrationRefusal,
  createVoyage: calls.createVoyage,
  setVoyageShowOnPortal: calls.setShow,
  findVoyageByNumberAndVessel: calls.findVoyage,
}))

// Os construtores das linhas de Histórico são os reais; só a leitura do que
// está gravado e a gravação (uma chamada, uma transação) são simuladas.
vi.mock('../voyageRouteSchedules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../voyageRouteSchedules')>()),
  listVoyagePodSchedules: calls.listPod,
  listVoyagePolSchedules: calls.listPol,
}))

vi.mock('../auditEntries', () => ({
  recordAuditEntries: calls.record,
}))

vi.mock('../supabase', () => ({
  supabase: { from: (...args: unknown[]) => calls.blSelect(...args) },
}))

import { createOrAttachVoyageFromSchedule } from '../voyageFromSchedule'

type Entry = { entity_type: string; entity_id: string; field_name: string; old_value: string | null; new_value: string | null }

/** Linhas enviadas na única gravação, como "porto campo antes→depois". */
function written(): string[] {
  expect(calls.record).toHaveBeenCalledTimes(1)
  return (calls.record.mock.calls[0][0] as Entry[]).map((entry) => `${entry.entity_id} ${entry.field_name} ${entry.old_value}→${entry.new_value}`)
}

function pod(entityId: string, fields: Record<string, unknown> = {}) {
  const [voyageId, port] = entityId.split('::')
  return { entityId, voyageId: Number(voyageId), pod: port, temImportacao: true, eta: null, etb: null, ata: null, atb: null, etd: null, atd: null, rtw: null, ceStatus: null, linked: false, escalaNumber: null, ...fields }
}

function pol(entityId: string, etd: string | null) {
  const [voyageId, port] = entityId.split('::')
  return { entityId, voyageId: Number(voyageId), pol: port, etd, atd: null, escalaNumber: null }
}

function blQuery(rows: Array<{ id: string }>, revision: number | null = null) {
  const result = Promise.resolve({ data: rows, error: null })
  const builder = {
    select: () => builder,
    eq: () => builder,
    or: () => builder,
    limit: () => result,
    maybeSingle: () => Promise.resolve({ data: revision == null ? null : { revision }, error: null }),
  }
  return builder
}

function reset() {
  Object.values(calls).forEach((call) => call.mockReset())
  calls.listPod.mockResolvedValue(new Map())
  calls.listPol.mockResolvedValue(new Map())
  calls.record.mockResolvedValue(undefined)
  calls.blSelect.mockReturnValue(blQuery([]))
}

describe('createOrAttachVoyageFromSchedule', () => {
  beforeEach(reset)

  it('anexa a viagem existente, publica no Portal e salva so ETD/ETA', async () => {
    calls.findVoyage.mockResolvedValue(42)

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [
        { code: 'CNTAO', kind: 'pol', date: '2026-01-04' },
        { code: 'CNSHA', kind: 'pol', date: null },
        { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
      ],
    }, 'user-1')

    expect(calls.createVoyage).not.toHaveBeenCalled()
    expect(calls.setShow).toHaveBeenCalledWith(42, true)
    expect(written()).toEqual([
      '42::CNTAO etd null→2026-01-04',
      '42::BRSSA eta null→2026-01-22',
      '42::BRSSA linked null→false',
    ])
  })

  it('"Adicionar navio" com o VOY e o navio de uma Viagem cancelada recusa e não grava nada', async () => {
    calls.findVoyage.mockResolvedValue(24)
    calls.blSelect.mockImplementation((table: string) => table === 'voyages'
      ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { status: 'cancelled' }, error: null }) }) }) }
      : blQuery([]))

    await expect(createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [{ code: 'BRSSA', kind: 'pod', date: '2026-01-22' }],
    }, 'user-1', { mode: 'form' })).rejects.toThrow('Já existe a viagem GREEN PECEM / 6, cancelada. Reative-a em Viagens em vez de cadastrar outra.')

    expect(calls.record).not.toHaveBeenCalled()
    expect(calls.setShow).not.toHaveBeenCalled()
  })

  it('cria viagem quando nao encontra dedup por VOY+navio', async () => {
    calls.findVoyage.mockResolvedValue(null)
    calls.createVoyage.mockResolvedValue({ id: 7 })

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [],
    }, null)

    // A Viagem nova nasce publicada e com a origem: um evento só na linha do
    // tempo, sem o UPDATE de publicação depois (revisão de 2026-10-22, F1).
    expect(calls.createVoyage).toHaveBeenCalledWith(expect.objectContaining({
      carrierScac: 'CSSC',
      vesselName: 'GREEN PECEM',
      voyageNumber: '6',
      status: 'active',
    }), null, { origin: 'chegadas_saidas', showOnPortal: true })
    expect(calls.setShow).not.toHaveBeenCalled()
  })

  it('"Adicionar navio" sobre Viagem existente grava só os portos com data: "Não escala" não apaga nada', async () => {
    calls.findVoyage.mockResolvedValue(42)
    calls.listPol.mockResolvedValue(new Map([['42::CNSHA', pol('42::CNSHA', '2026-01-02')]]))
    calls.listPod.mockResolvedValue(new Map([
      ['42::BRSSA', pod('42::BRSSA', { eta: '2026-01-20' })],
      ['42::BRVIX', pod('42::BRVIX', { eta: '2026-01-25' })],
    ]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [
        { code: 'CNSHA', kind: 'pol', date: null },
        { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
        { code: 'BRVIX', kind: 'pod', date: null },
      ],
    }, 'user-1', { mode: 'form', canRemoveEscala: true })

    expect(written()).toEqual(['42::BRSSA eta 2026-01-20→2026-01-22'])
  })

  it('data de escala só de exportação não a marca como importação', async () => {
    calls.listPod.mockResolvedValue(new Map([['42::BRSSA', pod('42::BRSSA', { eta: '2026-01-20', temImportacao: false })]]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [{ code: 'BRSSA', kind: 'pod', date: '2026-01-22' }],
    }, 'user-1', { mode: 'form', voyageId: 42 })

    expect(written()).toEqual(['42::BRSSA eta 2026-01-20→2026-01-22'])
  })

  it('escala nova continua nascendo importadora', async () => {
    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [{ code: 'BRPEC', kind: 'pod', date: '2026-01-22' }],
    }, 'user-1', { mode: 'form', voyageId: 42 })

    expect(written()).toContain('42::BRPEC eta null→2026-01-22')
    expect(written().some((line) => line.includes('tem_importacao'))).toBe(false)
  })

  it('mesmo dia do ETA gravado não regrava nem perde a hora; dia diferente grava a data nova', async () => {
    calls.listPod.mockResolvedValue(new Map([
      ['42::BRSSA', pod('42::BRSSA', { eta: '2026-11-03T08:00' })],
      ['42::BRVIX', pod('42::BRVIX', { eta: '2026-11-05T10:00' })],
    ]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [
        { code: 'BRSSA', kind: 'pod', date: '2026-11-03' },
        { code: 'BRVIX', kind: 'pod', date: '2026-11-06' },
      ],
    }, 'user-1', { mode: 'form', voyageId: 42 })

    expect(written()).toEqual(['42::BRVIX eta 2026-11-05T10:00→2026-11-06'])
  })
})

describe('createOrAttachVoyageFromSchedule - modo form (cancelar escala)', () => {
  beforeEach(reset)

  it('POD sem ancora e sem data vira soft-delete para o Administrativo', async () => {
    calls.listPod.mockResolvedValue(new Map([['42::BRVIX', pod('42::BRVIX', { eta: '2026-01-25' })]]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [
        { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
        { code: 'BRVIX', kind: 'pod', date: null },
      ],
    }, 'user-1', { mode: 'form', voyageId: 42, canRemoveEscala: true })

    expect(calls.findVoyage).not.toHaveBeenCalled()
    expect(written()).toEqual([
      '42::BRSSA eta null→2026-01-22',
      '42::BRSSA linked null→false',
      '42::BRVIX deleted false→true',
    ])
  })

  it('escala que já estava sem data não sai quando o Administrativo edita outro porto', async () => {
    // A janela mostra o porto sem data como "Não escala" e não pede confirmação
    // (clearedPodLabels só lista o porto que tinha data): nada a retirar.
    calls.listPod.mockResolvedValue(new Map([['42::BRVIX', pod('42::BRVIX', { eta: null })]]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [
        { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
        { code: 'BRVIX', kind: 'pod', date: null },
      ],
    }, 'user-1', { mode: 'form', voyageId: 42, canRemoveEscala: true })

    expect(written()).toEqual([
      '42::BRSSA eta null→2026-01-22',
      '42::BRSSA linked null→false',
    ])
  })

  it('trava na retirada da escala: nenhuma data é gravada e a Viagem não é publicada', async () => {
    calls.listPol.mockResolvedValue(new Map([['42::CNTAO', pol('42::CNTAO', '2026-01-02')]]))
    calls.listPod.mockResolvedValue(new Map([['42::BRVIX', pod('42::BRVIX', { eta: '2026-01-25' })]]))
    // O banco recusa a transação inteira (guard_pod_schedule_removal_mark).
    calls.record.mockRejectedValue(new Error('Escala BRVIX travada: CE Mercante.'))

    await expect(createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [
        { code: 'CNTAO', kind: 'pol', date: '2026-01-04' },
        { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
        { code: 'BRVIX', kind: 'pod', date: null },
      ],
    }, 'user-1', { mode: 'form', voyageId: 42, canRemoveEscala: true })).rejects.toThrow('travada')

    // As datas e a retirada iam na mesma chamada, que é uma transação.
    expect(written()).toEqual([
      '42::CNTAO etd 2026-01-02→2026-01-04',
      '42::BRSSA eta null→2026-01-22',
      '42::BRSSA linked null→false',
      '42::BRVIX deleted false→true',
    ])
    expect(calls.setShow).not.toHaveBeenCalled()
  })

  it('para os demais Departamentos, "nao escala" so zera o ETA (ADR 0071)', async () => {
    calls.listPod.mockResolvedValue(new Map([['42::BRVIX', pod('42::BRVIX', { eta: '2026-01-25' })]]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [{ code: 'BRVIX', kind: 'pod', date: null }],
    }, 'user-1', { mode: 'form', voyageId: 42 })

    expect(written()).toEqual(['42::BRVIX eta 2026-01-25→null'])
  })

  it('B/L com o porto como POL também ancora: só o ETA sai, sem soft-delete (D2, migration 513)', async () => {
    const orFilters: string[] = []
    calls.blSelect.mockImplementation((table: string) => {
      if (table !== 'bls') return blQuery([])
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: (filter: string) => {
          orFilters.push(filter)
          return Promise.resolve({ count: filter.includes('pol.eq.BRVIX') ? 1 : 0, error: null })
        },
      }
      return builder
    })
    calls.listPod.mockResolvedValue(new Map([['42::BRVIX', pod('42::BRVIX', { eta: '2026-01-25' })]]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [{ code: 'BRVIX', kind: 'pod', date: null }],
    }, 'user-1', { mode: 'form', voyageId: 42, canRemoveEscala: true })

    expect(orFilters).toEqual(['pod.eq.BRVIX,pol.eq.BRVIX'])
    expect(written()).toEqual(['42::BRVIX eta 2026-01-25→null'])
  })

  it('POD com ancora (linked) so zera o ETA publicado, sem soft-delete', async () => {
    calls.blSelect.mockImplementation((table: string) => table === 'voyage_escala_revision_state' ? blQuery([], 1) : blQuery([]))
    calls.listPod.mockResolvedValue(new Map([['42::BRSSA', pod('42::BRSSA', { eta: '2026-01-22', linked: true })]]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [{ code: 'BRSSA', kind: 'pod', date: null }],
    }, 'user-1', { mode: 'form', voyageId: 42, canRemoveEscala: true })

    expect(written()).toEqual(['42::BRSSA eta 2026-01-22→null'])
  })

  it('modo bulk ignora lanes sem data (nao cancela)', async () => {
    calls.findVoyage.mockResolvedValue(42)
    calls.listPod.mockResolvedValue(new Map([['42::BRVIX', pod('42::BRVIX', { eta: '2026-01-25' })]]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [
        { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
        { code: 'BRVIX', kind: 'pod', date: null },
      ],
    }, 'user-1', { mode: 'bulk' })

    expect(written()).toEqual([
      '42::BRSSA eta null→2026-01-22',
      '42::BRSSA linked null→false',
    ])
  })
})
