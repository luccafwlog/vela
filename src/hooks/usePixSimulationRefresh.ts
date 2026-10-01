import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { afterPixSimulationChanged } from '../services/cacheEffects'

type Invoice = {
  pix_integration_state?: string | null
  status?: string | null
  total_brl?: number | null
  current_total_brl?: number | null
  balance_brl?: number | null
}

// Emissão e cancelamento pendentes mudam em segundos; a cobrança ativa de
// Taxas Locais pode durar enquanto a fatura estiver aberta, então só espera o
// pagamento sem martelar o backend.
export function pixSimulationRefetchInterval(state?: string | null) {
  if (state === 'simulation:pending' || state === 'simulation:cancel_pending') return 5000
  return state === 'simulation:active' ? 30000 : false
}

export function usePixSimulationRefresh(invoice?: Invoice | null) {
  const client = useQueryClient()
  const previous = useRef<string | undefined>(undefined)
  const fingerprint = invoice?.pix_integration_state?.startsWith('simulation:')
    ? JSON.stringify([invoice.pix_integration_state, invoice.status, invoice.total_brl, invoice.current_total_brl, invoice.balance_brl])
    : undefined
  useEffect(() => {
    if (previous.current !== undefined && fingerprint !== undefined && previous.current !== fingerprint) {
      void afterPixSimulationChanged(client)
    }
    previous.current = fingerprint
  }, [client, fingerprint])
}
