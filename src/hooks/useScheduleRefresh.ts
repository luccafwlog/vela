import { useState } from 'react'

/**
 * Atualizar quando quiser (ponto 3 de 2026-10-23). O estado fica com quem
 * compõe o bloco, para a tela que lê os dados redesenhar ao fim da releitura.
 */
export function useScheduleRefresh(reload: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false)
  async function refresh() {
    setRefreshing(true)
    try {
      await reload()
    } finally {
      setRefreshing(false)
    }
  }
  return { refreshing, refresh }
}
