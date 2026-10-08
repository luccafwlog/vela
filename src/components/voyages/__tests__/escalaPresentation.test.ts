import { describe, expect, it } from 'vitest'
import { buildEscalaTrail, describeArrival, describeDeparture, escalaStateTag } from '../escalaPresentation'

const NOW = new Date('2026-10-08T12:00:00')

describe('describeArrival', () => {
  it('distingue ETA vencido, ETA não informado, previsão, chegada real e OMIT', () => {
    expect(describeArrival({ port: 'BRSSA', eta: '2026-10-03', ata: null }, NOW)).toEqual({
      state: 'overdue', date: '2026-10-03', caption: 'ETA vencido — ATA pendente',
    })
    expect(describeArrival({ port: 'BRSSZ', eta: null, ata: null }, NOW)).toEqual({
      state: 'missing', date: null, caption: 'ETA não informado',
    })
    expect(describeArrival({ port: 'BRPEC', eta: '2026-10-20', ata: null }, NOW).state).toBe('forecast')
    // ATA não apaga a previsão: a legenda guarda o ETA quando diferente.
    expect(describeArrival({ port: 'BRVIX', eta: '2026-10-01', ata: '2026-10-02' }, NOW)).toEqual({
      state: 'actual', date: '2026-10-02', caption: 'ATA real · prev. 01/10/2026',
    })
    // OMIT vence até uma data vencida: a escala não vai acontecer.
    expect(describeArrival({ port: 'BRIOA', eta: '2026-10-01', ata: null, omitted: true }, NOW).state).toBe('omitted')
  })
})

describe('describeDeparture', () => {
  it('nomeia o terminal dono do ATD e do ETD', () => {
    const atracacoes = [
      { terminalId: 't1', terminalCode: 'PORTMAC', etd: '2026-10-05', atd: '2026-10-06' },
      { terminalId: 't2', terminalCode: 'TVV', etd: '2026-10-09', atd: '2026-10-10' },
    ]
    expect(describeDeparture({ port: 'BRVIX', eta: null, ata: null, atd: '2026-10-10', atracacoes })).toEqual({
      state: 'actual', date: '2026-10-10', caption: 'ATD · TVV',
    })
    expect(describeDeparture({ port: 'BRVIX', eta: null, ata: null, atd: null, atracacoes: [atracacoes[0], { ...atracacoes[1], atd: null }] })).toEqual({
      state: 'forecast', date: '2026-10-09', caption: 'ETD previsto · TVV',
    })
    expect(describeDeparture({ port: 'BRVIX', eta: null, ata: null, atracacoes: [{ terminalId: null, terminalCode: null }] }).caption).toBe('Aguardando ETD de TBC')
    expect(describeDeparture({ port: 'BRVIX', eta: null, ata: null }).caption).toBe('Sem atracação')
  })
})

describe('escalaStateTag', () => {
  it('lê atracada e concluída das Atracações, não de campo manual', () => {
    expect(escalaStateTag({ port: 'A', eta: null, ata: '2026-10-01', atracacoes: [{ terminalId: 't', atb: '2026-10-02', atd: null }] }, false, NOW)?.label).toBe('Atracada')
    expect(escalaStateTag({ port: 'A', eta: null, ata: '2026-10-01', atracacoes: [{ terminalId: 't', atb: '2026-10-02', atd: '2026-10-03' }] }, false, NOW)?.label).toBe('Concluída')
    expect(escalaStateTag({ port: 'A', eta: '2026-10-03', ata: null }, true, NOW)).toEqual({ label: 'ETA vencido', tone: 'danger' })
    expect(escalaStateTag({ port: 'A', eta: '2026-10-30', ata: null }, true, NOW)?.label).toBe('Próxima')
    expect(escalaStateTag({ port: 'A', eta: '2026-10-30', ata: null }, false, NOW)).toBeNull()
  })
})

describe('buildEscalaTrail', () => {
  it('ordena pela chegada e marca uma única escala atual', () => {
    const steps = buildEscalaTrail([
      { port: 'BRPEC', eta: '2026-10-20', ata: null },
      { port: 'BRSSZ', eta: null, ata: null },
      { port: 'BRVIX', eta: '2026-10-02', ata: '2026-10-02', atracacoes: [{ terminalId: 't', atb: '2026-10-03', atd: null }] },
      { port: 'BRSSA', eta: '2026-10-03', ata: null },
      { port: 'BRIOA', eta: '2026-10-15', ata: null, omitted: true },
    ], 'BRSSA', NOW)

    expect(steps.map((step) => step.key)).toEqual(['BRVIX', 'BRSSA', 'BRIOA', 'BRPEC', 'BRSSZ'])
    expect(steps.filter((step) => step.state === 'current').map((step) => step.key)).toEqual(['BRVIX'])
    expect(steps.find((step) => step.key === 'BRSSA')?.detail).toBe('ETA 03/10/2026 vencido')
    expect(steps.find((step) => step.key === 'BRIOA')).toMatchObject({ state: 'skipped', detail: 'OMIT' })
    expect(steps.find((step) => step.key === 'BRSSZ')?.detail).toBe('ETA não informado')
  })

  it('sem atracação aberta, a próxima escala é a atual', () => {
    const steps = buildEscalaTrail([
      { port: 'BRSSA', eta: '2026-10-25', ata: null },
      { port: 'BRVIX', eta: '2026-10-28', ata: null },
    ], 'BRSSA', NOW)
    expect(steps.map((step) => step.state)).toEqual(['current', 'pending'])
  })
})
