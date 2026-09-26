import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  createVoyage: vi.fn(),
  setShow: vi.fn(),
  findVoyage: vi.fn(),
  savePol: vi.fn(),
  savePod: vi.fn(),
  deletePod: vi.fn(),
  listPod: vi.fn(),
  listPol: vi.fn(),
  blSelect: vi.fn(),
}))

vi.mock('../voyages', () => ({
  createVoyage: calls.createVoyage,
  setVoyageShowOnPortal: calls.setShow,
  findVoyageByNumberAndVessel: calls.findVoyage,
}))

vi.mock('../voyageRouteSchedules', () => ({
  saveVoyagePolSchedule: calls.savePol,
  saveVoyagePodSchedule: calls.savePod,
  deleteVoyagePodSchedule: calls.deletePod,
  listVoyagePodSchedules: calls.listPod,
  listVoyagePolSchedules: calls.listPol,
  buildVoyagePodEntityId: (id: number, pod: string) => `${id}::${pod}`,
  buildVoyagePolEntityId: (id: number, pol: string) => `${id}::${pol}`,
}))

vi.mock('../supabase', () => ({
  supabase: { from: (...args: unknown[]) => calls.blSelect(...args) },
}))

import { createOrAttachVoyageFromSchedule } from '../voyageFromSchedule'

function blQuery(rows: Array<{ id: string }>, revision: number | null = null) {
  const result = Promise.resolve({ data: rows, error: null })
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => result,
    maybeSingle: () => Promise.resolve({ data: revision == null ? null : { revision }, error: null }),
  }
  return builder
}

describe('createOrAttachVoyageFromSchedule', () => {
  beforeEach(() => {
    Object.values(calls).forEach((call) => call.mockReset())
    calls.listPod.mockResolvedValue(new Map())
    calls.listPol.mockResolvedValue(new Map())
    calls.blSelect.mockReturnValue(blQuery([]))
  })

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
    expect(calls.savePol).toHaveBeenCalledWith({ voyageId: 42, pol: 'CNTAO', etd: '2026-01-04', changedBy: 'user-1' })
    expect(calls.savePod).toHaveBeenCalledWith(expect.objectContaining({
      voyageId: 42,
      pod: 'BRSSA',
      eta: '2026-01-22',
      ata: null,
      linked: false,
    }))
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

    expect(calls.createVoyage).toHaveBeenCalledWith(expect.objectContaining({
      carrierScac: 'CSSC',
      vesselName: 'GREEN PECEM',
      voyageNumber: '6',
      status: 'active',
    }), null)
    expect(calls.setShow).toHaveBeenCalledWith(7, true)
  })
})

describe('createOrAttachVoyageFromSchedule - modo form (cancelar escala)', () => {
  beforeEach(() => {
    Object.values(calls).forEach((call) => call.mockReset())
    calls.listPod.mockResolvedValue(new Map())
    calls.listPol.mockResolvedValue(new Map())
    calls.blSelect.mockReturnValue(blQuery([]))
  })

  it('POD sem ancora e sem data vira soft-delete para o Administrativo', async () => {
    calls.findVoyage.mockResolvedValue(42)
    calls.listPod.mockResolvedValue(new Map([
      ['42::BRVIX', { entityId: '42::BRVIX', voyageId: 42, pod: 'BRVIX', eta: '2026-01-25', etb: null, ata: null, atd: null, rtw: null, ceStatus: null, linked: false }],
    ]))

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
    expect(calls.deletePod).toHaveBeenCalledWith({ voyageId: 42, pod: 'BRVIX', changedBy: 'user-1' })
    expect(calls.savePod).toHaveBeenCalledWith(expect.objectContaining({ pod: 'BRSSA', eta: '2026-01-22' }))
  })

  it('para os demais Departamentos, "nao escala" so zera o ETA (ADR 0071)', async () => {
    calls.findVoyage.mockResolvedValue(42)
    calls.listPod.mockResolvedValue(new Map([
      ['42::BRVIX', { entityId: '42::BRVIX', voyageId: 42, pod: 'BRVIX', eta: '2026-01-25', etb: null, ata: null, atd: null, rtw: null, ceStatus: null, linked: false }],
    ]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [{ code: 'BRVIX', kind: 'pod', date: null }],
    }, 'user-1', { mode: 'form', voyageId: 42 })

    expect(calls.deletePod).not.toHaveBeenCalled()
    expect(calls.savePod).toHaveBeenCalledWith(expect.objectContaining({ pod: 'BRVIX', eta: null }))
  })

  it('POD com ancora (linked) so zera o ETA publicado, sem soft-delete', async () => {
    calls.blSelect.mockImplementation((table: string) => table === 'voyage_escala_revision_state' ? blQuery([], 1) : blQuery([]))
    calls.listPod.mockResolvedValue(new Map([
      ['42::BRSSA', { entityId: '42::BRSSA', voyageId: 42, pod: 'BRSSA', eta: '2026-01-22', etb: null, ata: null, atd: null, rtw: null, ceStatus: null, linked: true }],
    ]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [{ code: 'BRSSA', kind: 'pod', date: null }],
    }, 'user-1', { mode: 'form', voyageId: 42 })

    expect(calls.deletePod).not.toHaveBeenCalled()
    expect(calls.savePod).toHaveBeenCalledWith(expect.objectContaining({ pod: 'BRSSA', eta: null, linked: true }))
  })

  it('modo bulk ignora lanes sem data (nao cancela)', async () => {
    calls.findVoyage.mockResolvedValue(42)
    calls.listPod.mockResolvedValue(new Map())

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM',
      vesselImo: '9976501',
      voyageNumber: '6',
      lanes: [
        { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
        { code: 'BRVIX', kind: 'pod', date: null },
      ],
    }, 'user-1', { mode: 'bulk' })

    expect(calls.deletePod).not.toHaveBeenCalled()
    expect(calls.savePod).toHaveBeenCalledTimes(1)
    expect(calls.savePod).toHaveBeenCalledWith(expect.objectContaining({ pod: 'BRSSA' }))
  })
})
