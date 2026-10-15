import { describe, expect, it } from 'vitest'
import { blBelongsToTerminal } from '../agencyDepartureReport'

// B2 (ADR 0068): a carga do ADR por terminal segue a regra de bl_belongs_to_atracacao.
const fronts = [
  { sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'T1' },
  { sentido: 'importacao', modalidade: 'carga_solta', terminalId: 'T2' },
]

describe('blBelongsToTerminal', () => {
  it('sem exceção, o B/L segue a frente da sua modalidade', () => {
    expect(blBelongsToTerminal({ terminal_id: null, cargo_mode: 'container' }, fronts, 'T1')).toBe(true)
    expect(blBelongsToTerminal({ terminal_id: null, cargo_mode: 'container' }, fronts, 'T2')).toBe(false)
    expect(blBelongsToTerminal({ terminal_id: null, cargo_mode: 'carga_solta' }, fronts, 'T2')).toBe(true)
  })

  it('a exceção de terminal do B/L vence a frente', () => {
    expect(blBelongsToTerminal({ terminal_id: 'T2', cargo_mode: 'container' }, fronts, 'T2')).toBe(true)
    expect(blBelongsToTerminal({ terminal_id: 'T2', cargo_mode: 'container' }, fronts, 'T1')).toBe(false)
  })

  it('misto sem exceção só pertence quando as duas frentes estão no terminal', () => {
    expect(blBelongsToTerminal({ terminal_id: null, cargo_mode: 'misto' }, fronts, 'T1')).toBe(false)
    expect(blBelongsToTerminal({ terminal_id: null, cargo_mode: 'misto' }, fronts, 'T2')).toBe(false)
    const sameTerminal = fronts.map((front) => ({ ...front, terminalId: 'T1' }))
    expect(blBelongsToTerminal({ terminal_id: null, cargo_mode: 'misto' }, sameTerminal, 'T1')).toBe(true)
  })
})
