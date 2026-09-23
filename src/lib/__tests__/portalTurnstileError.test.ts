import { expect, it } from 'vitest'
import { isPortalTurnstileRejection } from '../portalTurnstileError'

it('identifica somente a recusa 403 da Edge Function de verificação', () => {
  expect(isPortalTurnstileRejection({ context: new Response(null, { status: 403 }) })).toBe(true)
  expect(isPortalTurnstileRejection({ context: new Response(null, { status: 401 }) })).toBe(false)
  expect(isPortalTurnstileRejection(new Error('network error'))).toBe(false)
  expect(isPortalTurnstileRejection(null)).toBe(false)
})
