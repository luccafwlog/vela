import { QueryClient } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { invalidateBillingLedgerQueries } from '../../hooks/useBillingLedger'

it('ações financeiras deixam as consultas CE existentes obsoletas para refetch', async () => {
  const client = new QueryClient()
  const queries = [
    ['ce-unlock', 'list', 'internal', {}, 1],
    ['ce-unlock', 'request', 'internal', 'request-id'],
    ['ce-unlock', 'requests', { mode: 'inspect', customerId: 123 }, 1],
  ]
  try {
    for (const key of queries) client.setQueryData(key, { paid: true })
    await invalidateBillingLedgerQueries(client)
    for (const key of queries) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  } finally { client.clear() }
})
