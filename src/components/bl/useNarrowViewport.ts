import { useCallback, useSyncExternalStore } from 'react'

/** Ponto de quebra das listas em cartões (contrato visual, etapa 00). */
export const BL_CARD_LIST_QUERY = '(max-width: 639px)'

function hasMatchMedia() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

/**
 * Diz se a lista de B/Ls deve virar cartões. Uma só versão fica no DOM (tabela
 * ou cartões), em vez de duas escondidas por CSS: leitor de tela e busca da
 * página não encontram cada B/L duas vezes. Sem `matchMedia` (testes), tabela.
 */
export function useNarrowViewport(query = BL_CARD_LIST_QUERY) {
  const subscribe = useCallback((onChange: () => void) => {
    if (!hasMatchMedia()) return () => undefined
    const media = window.matchMedia(query)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return useSyncExternalStore(
    subscribe,
    () => hasMatchMedia() && window.matchMedia(query).matches,
    () => false,
  )
}
