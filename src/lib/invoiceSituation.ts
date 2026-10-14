/**
 * Situação da fatura de Taxas Locais em texto (regra 5, tabela limpa):
 * Emitida e Parcialmente paga em tinta normal, Paga (e Coberta pela
 * consolidada) com o ✓ verde, Cancelada em cinza. Vale em toda tela que
 * mostra a situação da fatura (Taxas Locais, ficha do Cliente, Portal).
 */
export function invoiceSituation(status: string | null | undefined): { label: string; tone: 'default' | 'paid' | 'muted' } {
  if (status === 'paid') return { label: 'Paga', tone: 'paid' }
  if (status === 'covered') return { label: 'Coberta', tone: 'paid' }
  if (status === 'cancelled' || status === 'obsolete') return { label: 'Cancelada', tone: 'muted' }
  if (status === 'partially_paid') return { label: 'Parcialmente paga', tone: 'default' }
  return { label: 'Emitida', tone: 'default' }
}
