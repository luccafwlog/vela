/**
 * Relatorio de dependencias para exclusao. Separa os ids que podem ser
 * excluidos dos que estao bloqueados (com o motivo legivel do bloqueio),
 * permitindo que uma exclusao em massa prossiga apenas com os deletaveis.
 */
export type DeleteDependencyReport<K extends string | number> = {
  deletableIds: K[]
  blockedIds: Array<{ id: K; reasons: string[] }>
}

/**
 * Helper para tabular contagens por id a partir de linhas que carregam uma
 * coluna de chave estrangeira, acumulando motivos de bloqueio em um mapa.
 */
export function tallyReasons<K extends string | number>(
  reasons: Map<K, string[]>,
  rows: Array<Record<string, unknown>>,
  fkColumn: string,
  describe: (count: number) => string,
) {
  const counts = new Map<K, number>()
  for (const row of rows) {
    const key = row[fkColumn] as K
    if (key == null) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const [key, count] of counts) {
    const list = reasons.get(key) ?? []
    list.push(describe(count))
    reasons.set(key, list)
  }
}

/** Monta o relatorio final a partir do conjunto de ids e dos motivos coletados. */
export function buildDependencyReport<K extends string | number>(
  ids: K[],
  reasons: Map<K, string[]>,
): DeleteDependencyReport<K> {
  const blockedIds = [...reasons.entries()].map(([id, rs]) => ({ id, reasons: rs }))
  const deletableIds = ids.filter((id) => !reasons.has(id))
  return { deletableIds, blockedIds }
}

/**
 * Texto curto descrevendo os bloqueados, para uso em toasts/confirmacoes.
 * Lista ate 3 itens com seus motivos.
 */
export function formatBlockedSummary<K extends string | number>(
  blocked: Array<{ id: K; reasons: string[] }>,
): string {
  if (blocked.length === 0) return ''
  const shown = blocked.slice(0, 3).map((b) => `${b.id} (${b.reasons.join(', ')})`)
  const extra = blocked.length > 3 ? ` e mais ${blocked.length - 3}` : ''
  return `${blocked.length} bloqueado(s): ${shown.join('; ')}${extra}.`
}

/**
 * Mensagem final de uma exclusao a partir do que o banco de fato apagou: nunca
 * anuncia sucesso para o que foi recusado. `noun` e o rotulo no plural
 * abreviado, ex: "B/L(s)".
 */
export function formatDeleteOutcome<K extends string | number>(
  noun: string,
  result: DeleteDependencyReport<K>,
): { message: string; tone: 'success' | 'error' } {
  const blocked = formatBlockedSummary(result.blockedIds)
  if (result.deletableIds.length === 0) {
    return { message: `Nenhum ${noun} excluído. ${blocked}`.trim(), tone: 'error' }
  }
  const done = `${result.deletableIds.length} ${noun} excluído(s).`
  return { message: blocked ? `${done} ${blocked}` : done, tone: 'success' }
}
