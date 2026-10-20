/**
 * Nomes de tela do Embarque de vazios e do cadastro de locais (lote 5b da
 * identidade visual): os mesmos em tabela, resumo, formulário e confirmação.
 * O banco guarda `vazio`/`material` e `armazenagem`/`transporte`/`geral`.
 */
export const CONDICAO_LABELS: Record<string, string> = {
  vazio: 'Vazio',
  material: 'Com material',
}

export const NATUREZA_SERVICO_LABELS: Record<string, string> = {
  armazenagem: 'Armazenagem',
  transporte: 'Transporte',
  geral: 'Geral',
}

export function condicaoLabel(condition: string | null | undefined): string {
  if (!condition) return ''
  return CONDICAO_LABELS[condition] ?? condition
}

export function naturezaServicoLabel(natureza: string | null | undefined): string {
  if (!natureza) return ''
  return NATUREZA_SERVICO_LABELS[natureza] ?? natureza
}

/** "1 dia", "39 dias", "0 dias": sem "dia(s)". */
export function diasLabel(days: number): string {
  return `${days.toLocaleString('pt-BR')} ${Math.abs(days) === 1 ? 'dia' : 'dias'}`
}

/** Tipo do local do cadastro. */
export function tipoLocalLabel(tipo: string | null | undefined): string {
  return tipo === 'terminal_portuario' ? 'Terminal portuário' : 'Depot'
}
