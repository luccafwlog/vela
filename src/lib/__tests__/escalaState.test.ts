import { describe, expect, it } from 'vitest'
import { arrivalDisplay, deriveEscalaState } from '../escalaState'

describe('deriveEscalaState', () => {
  it('ATB sem ATD é Atracada', () => {
    expect(deriveEscalaState({ atb: '2026-07-10', atd: null })).toBe('atracada')
  })

  it('ATD preenchido é Concluída (mesmo sem ATB)', () => {
    expect(deriveEscalaState({ atb: '2026-07-10', atd: '2026-07-12' })).toBe('concluida')
    expect(deriveEscalaState({ atb: null, atd: '2026-07-12' })).toBe('concluida')
  })

  it('sem datas reais não há estado derivado', () => {
    expect(deriveEscalaState({ atb: null, atd: null })).toBeNull()
  })

  it('ignora ATB histórico quando todos os berços já têm ATD', () => {
    expect(deriveEscalaState({
      atracacoes: [
        { atb: '2026-07-10', atd: '2026-07-11' },
        { atb: '2026-07-12', atd: '2026-07-13' },
      ],
    })).toBe('concluida')
  })

  it('mantém atracada quando há um berço sem ATD', () => {
    expect(deriveEscalaState({
      atracacoes: [
        { atb: '2026-07-10', atd: '2026-07-11' },
        { atb: '2026-07-12', atd: null },
      ],
    })).toBe('atracada')
  })
})

describe('arrivalDisplay (precedência ATA → ETA)', () => {
  it('com ATA mostra a data real marcada como efetiva', () => {
    expect(arrivalDisplay({ eta: '2026-07-09', ata: '2026-07-10' })).toEqual({ value: '2026-07-10', isActual: true })
  })

  it('sem ATA volta ao ETA', () => {
    expect(arrivalDisplay({ eta: '2026-07-09', ata: null })).toEqual({ value: '2026-07-09', isActual: false })
  })

  it('sem nenhuma data retorna valor nulo estimado', () => {
    expect(arrivalDisplay({ eta: null, ata: null })).toEqual({ value: null, isActual: false })
  })
})
