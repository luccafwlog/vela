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

export function pixSimulationRefetchInterval(state?: string | null) {
  return state && ['simulation:pending','simulation:active','simulation:cancel_pending'].includes(state) ? 5000 : false
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
