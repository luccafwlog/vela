import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type RowKey = string | number

/**
 * Seleção em massa sobre o resultado filtrado inteiro (revisão de 2026-10-22,
 * G1): o "selecionar todos" do cabeçalho marca todas as linhas do filtro, em
 * todas as páginas, e não só as visíveis. A seleção atravessa páginas e é
 * zerada quando o recorte (`scope`, os filtros sem a página) muda.
 *
 * `loadAll` devolve todas as linhas do filtro: a lista já carregada, quando a
 * tela pagina no navegador, ou a leitura das páginas do servidor. `keyOf`
 * diz a chave de cada linha; sem ele, a própria linha é a chave. Guardar a
 * linha (e não só a chave) serve a quem precisa dela fora da página atual,
 * como o Desbloqueio de CE.
 */
export function useFilteredSelection<K extends RowKey, V = K>({
  scope,
  totalCount,
  loadAll,
  keyOf,
}: {
  scope: unknown
  totalCount: number
  loadAll: () => Promise<V[]> | V[]
  keyOf?: (value: V) => K
}) {
  const [entries, setEntries] = useState<Map<K, V>>(() => new Map())
  const [loadingAll, setLoadingAll] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const previousScope = useRef(scope)
  const request = useRef(0)
  // Sempre a versão mais recente do filtro e da chave, sem refazer os callbacks.
  const keyOfRef = useRef(keyOf)
  const loadAllRef = useRef(loadAll)
  useEffect(() => {
    keyOfRef.current = keyOf
    loadAllRef.current = loadAll
  })

  const key = useCallback((value: V) => (keyOfRef.current ? keyOfRef.current(value) : (value as unknown as K)), [])

  // Recorte novo: a seleção do anterior não vale (a leitura em curso também não).
  const scopeKey = JSON.stringify(scope ?? null)
  useEffect(() => {
    if (previousScope.current !== scopeKey) {
      previousScope.current = scopeKey
      request.current += 1
      setEntries(new Map())
      setLoadingAll(false)
      setLoadError(null)
    }
  }, [scopeKey])

  const selected = useMemo(() => new Set(entries.keys()), [entries])
  const isSelected = useCallback((k: K) => entries.has(k), [entries])

  const toggle = useCallback((value: V) => {
    setEntries((prev) => {
      const next = new Map(prev)
      const k = key(value)
      if (next.has(k)) next.delete(k)
      else next.set(k, value)
      return next
    })
  }, [key])

  // Marca todas as informadas; se todas já estiverem marcadas, desmarca-as.
  const toggleMany = useCallback((values: V[]) => {
    setEntries((prev) => {
      const next = new Map(prev)
      const allMarked = values.length > 0 && values.every((value) => next.has(key(value)))
      for (const value of values) {
        if (allMarked) next.delete(key(value))
        else next.set(key(value), value)
      }
      return next
    })
  }, [key])

  /** Renova a cópia guardada das linhas já selecionadas (ex.: depois de um comando). */
  const refresh = useCallback((values: V[]) => {
    setEntries((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const value of values) {
        const k = key(value)
        if (next.has(k)) {
          next.set(k, value)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [key])

  /** Tira da seleção as chaves já tratadas (ex.: exportadas). */
  const removeMany = useCallback((keys: K[]) => {
    setEntries((prev) => {
      if (!keys.some((k) => prev.has(k))) return prev
      const next = new Map(prev)
      for (const k of keys) next.delete(k)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    request.current += 1
    setEntries(new Map())
    setLoadingAll(false)
  }, [])

  const count = entries.size
  const allSelected = totalCount > 0 && count >= totalCount
  const someSelected = count > 0 && !allSelected

  const toggleAll = useCallback(async () => {
    if (allSelected) {
      clear()
      return
    }
    // O teto vale para toda tela, carregue ela a lista inteira ou página a página.
    if (totalCount > SELECT_ALL_CAP) {
      setLoadError(capMessage(totalCount))
      return
    }
    const current = ++request.current
    setLoadingAll(true)
    setLoadError(null)
    try {
      const values = await loadAllRef.current()
      if (current !== request.current) return
      setEntries(new Map(values.map((value) => [key(value), value])))
    } catch (error) {
      if (current !== request.current) return
      setLoadError(error instanceof Error ? error.message : 'Não foi possível selecionar todo o resultado do filtro.')
    } finally {
      if (current === request.current) setLoadingAll(false)
    }
  }, [allSelected, clear, key, totalCount])

  return useMemo(() => ({
    selected,
    values: [...entries.values()],
    isSelected,
    toggle,
    toggleMany,
    refresh,
    removeMany,
    clear,
    count,
    totalCount,
    allSelected,
    someSelected,
    toggleAll,
    loadingAll,
    loadError,
  }), [selected, entries, isSelected, toggle, toggleMany, refresh, removeMany, clear, count, totalCount, allSelected, someSelected, toggleAll, loadingAll, loadError])
}

export type FilteredSelection<K extends RowKey, V = K> = ReturnType<typeof useFilteredSelection<K, V>>

/**
 * Lê todas as páginas de uma lista paginada no servidor, de `pageSize` em
 * `pageSize`, quatro por vez, até `cap` linhas.
 * ponytail: lê as linhas inteiras para tirar as chaves; o teto evita uma
 * seleção que a ação em massa não aguentaria. Upgrade: RPC que devolva só as
 * chaves do filtro.
 */
export async function loadAllPageKeys<T, K>(
  readPage: (page: number) => Promise<{ rows: T[]; count: number }>,
  keyOf: (row: T) => K,
  { pageSize, firstPage = 1, cap = SELECT_ALL_CAP }: { pageSize: number; firstPage?: 0 | 1; cap?: number },
): Promise<K[]> {
  const first = await readPage(firstPage)
  if (first.count > cap) {
    throw new Error(capMessage(first.count, cap))
  }
  const pages = Math.ceil(first.count / pageSize)
  const keys = new Set(first.rows.map(keyOf))
  for (let offset = 1; offset < pages; offset += 4) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(4, pages - offset) }, (_, index) => readPage(firstPage + offset + index)),
    )
    for (const page of batch) for (const row of page.rows) keys.add(keyOf(row))
  }
  return [...keys]
}

export const SELECT_ALL_CAP = 10_000

/** Aviso do teto, para a tela que seleciona sem este hook (Portal). */
export function capMessage(count: number, cap = SELECT_ALL_CAP) {
  return `O filtro tem ${count.toLocaleString('pt-BR')} linhas; a seleção vai até ${cap.toLocaleString('pt-BR')}. Refine o filtro.`
}
