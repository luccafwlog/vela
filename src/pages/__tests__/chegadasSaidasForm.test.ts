import { describe, expect, it } from 'vitest'
import { buildScheduleLanes, clearedPodLabels, emptyScheduleForm, scheduleFormFromVoyage } from '../chegadasSaidasForm'

describe('buildScheduleLanes', () => {
  it('converte o form em lanes com code canonico, pulando nao escala', () => {
    const form = { ...emptyScheduleForm, dates: { ...emptyScheduleForm.dates } }
    form.dates.QINGDAO = '2026-01-04'
    form.dates.SALVADOR = '2026-01-22'
    form.dates.VITÓRIA = ''

    const lanes = buildScheduleLanes(form)

    expect(lanes).toContainEqual({ code: 'CNTAO', kind: 'pol', date: '2026-01-04' })
    expect(lanes).toContainEqual({ code: 'BRSSA', kind: 'pod', date: '2026-01-22' })
    expect(lanes.find((lane) => lane.code === 'BRVIX')?.date).toBe(null)
  })

  it('popula omitted corretamente a partir de viagem projetada', () => {
    const form = scheduleFormFromVoyage({
      voyageId: 1,
      vesselName: 'TEST SHIP',
      voyage: '100',
      imoNumber: '1234567',
      datesByLabel: { SALVADOR: '2026-01-22', QINGDAO: 'X' },
      omittedByLabel: { VITÓRIA: true },
      earliestEta: '2026-01-22',
    })

    expect(form.omitted?.SALVADOR).toBe(false)
    expect(form.omitted?.QINGDAO).toBe(true)
    expect(form.omitted?.VITÓRIA).toBe(true)
  })
})

describe('clearedPodLabels', () => {
  const withDates = (dates: Record<string, string>) => ({ ...emptyScheduleForm, dates: { ...emptyScheduleForm.dates, ...dates } })

  it('lista só o porto de descarga que tinha data e virou não escala', () => {
    const original = withDates({ QINGDAO: '2026-08-02', SALVADOR: '2026-10-14', 'VITÓRIA': '2026-10-17' })
    const next = withDates({ QINGDAO: '', SALVADOR: '2026-10-14', 'VITÓRIA': '' })
    // Qingdao é porto de embarque: limpar o ETD não remove escala.
    expect(clearedPodLabels(original, next)).toEqual(['VITÓRIA'])
  })

  it('não pede confirmação quando nada foi limpo', () => {
    const form = withDates({ SALVADOR: '2026-10-14' })
    expect(clearedPodLabels(form, withDates({ SALVADOR: '2026-10-20' }))).toEqual([])
  })
})
