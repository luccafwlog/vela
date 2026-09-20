// Spec §12–§13: estado operacional derivado de fatos, nunca status manual.

export type EscalaState = 'atracada' | 'concluida'

export function deriveEscalaState(input: {
  atb?: string | null
  atd?: string | null
  atracacoes?: Array<{ atb: string | null; atd: string | null }>
}): EscalaState | null {
  if (input.atracacoes) {
    if (input.atracacoes.length === 0) return null
    if (input.atracacoes.every((atracacao) => atracacao.atd)) return 'concluida'
    // A historical ATB must not keep a scale operational after the same
    // terminalized call received its ATD.  The unfinished-berth predicate is
    // the executable form of the operational state rule.
    if (input.atracacoes.some((atracacao) => atracacao.atb && !atracacao.atd)) return 'atracada'
    return null
  }
  if (input.atd) return 'concluida'
  if (input.atb) return 'atracada'
  return null
}

/** Coluna intitulada ETA: com ATA mostra a data real (verde); removida a ATA, volta ao ETA. */
export function arrivalDisplay(input: { eta: string | null; ata: string | null }) {
  return input.ata
    ? { value: input.ata, isActual: true as const }
    : { value: input.eta, isActual: false as const }
}
