/** Divisões da cobrança (ADR 0112, D1): as que somam nos cartões, na Exposição e em Por Cliente. */
export type DemurrageDivision = 'correndo' | 'a_emitir' | 'esperando' | 'travado'

export const DEMURRAGE_DIVISIONS: readonly DemurrageDivision[] = ['correndo', 'a_emitir', 'esperando', 'travado']

/**
 * Divisões da aba Containers, na ordem da tela: as da cobrança e Veículo LCL
 * (migration 592, ADR 0123), a sobreestadia de veículo LCL com a cobrança
 * suspensa, fora dos cartões, da Exposição e de Por Cliente.
 */
export type BoardDivision = DemurrageDivision | 'veiculo_lcl'

export const BOARD_DIVISIONS: readonly BoardDivision[] = [...DEMURRAGE_DIVISIONS, 'veiculo_lcl']

export const DEMURRAGE_DIVISION_LABELS: Record<BoardDivision, string> = {
  correndo: 'Correndo',
  a_emitir: 'A emitir',
  esperando: 'Esperando',
  travado: 'Travado',
  veiculo_lcl: 'Veículo LCL',
}

/** Divisão que soma na cobrança (fora: Veículo LCL, com a cobrança suspensa). */
export function isBillingDivision(division: BoardDivision): division is DemurrageDivision {
  return division !== 'veiculo_lcl'
}
