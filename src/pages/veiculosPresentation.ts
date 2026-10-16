// Apresentação da lista /veiculos. O Local de desova é atributo do container
// (CONTEXT.md); desde o lote 2 (2026-10-16) a lista tem uma linha por veículo,
// ordenada por container, e o local se define pela janela, para vários de uma vez.

/** Os agregados do hook usam "Nao informado" como rótulo de ausência. */
export function isMissingLabel(label: string) {
  return label.trim().toLowerCase() === 'nao informado'
}

export function displayAggregateLabel(label: string) {
  return isMissingLabel(label) ? 'Não informado' : label
}
