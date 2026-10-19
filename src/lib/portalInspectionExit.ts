import { canonicalizeDocument } from './cnpj'

/**
 * Para onde a faixa do Modo Inspeção volta (lote 5a, achado A5): à ficha do
 * Cliente ou ao Provisionamento, conforme onde a inspeção foi aberta. Aberta
 * em outra aba (a Espiadinha da fila), o botão fecha a aba, porque a tela de
 * origem continua aberta na anterior.
 */
export function inspectionExit(origin: string | null, newTab: boolean, customerId: number, cnpj: string | null | undefined) {
  if (newTab) return { label: 'Fechar inspeção', to: `/clientes/portal?cliente=${customerId}`, closeTab: true }
  if (origin === 'ficha' && cnpj) return { label: 'Voltar à ficha do Cliente', to: `/clientes/${encodeURIComponent(canonicalizeDocument(cnpj))}`, closeTab: false }
  return { label: 'Voltar ao Provisionamento', to: `/clientes/portal?cliente=${customerId}`, closeTab: false }
}
