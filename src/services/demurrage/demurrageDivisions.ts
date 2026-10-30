/** Divisões da aba Containers (ADR 0112, D1), na ordem da tela. */
export type DemurrageDivision = 'correndo' | 'a_emitir' | 'esperando' | 'travado'

export const DEMURRAGE_DIVISIONS: readonly DemurrageDivision[] = ['correndo', 'a_emitir', 'esperando', 'travado']

export const DEMURRAGE_DIVISION_LABELS: Record<DemurrageDivision, string> = {
  correndo: 'Correndo',
  a_emitir: 'A emitir',
  esperando: 'Esperando',
  travado: 'Travado',
}
