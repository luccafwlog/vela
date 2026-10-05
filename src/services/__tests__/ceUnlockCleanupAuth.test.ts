import { expect, it } from 'vitest'
import { validCleanupAuthorization } from '../../../supabase/functions/_shared/ceUnlockCleanupAuth'
it('expurgo exige segredo dedicado configurado e correspondência integral', () => {
  expect(validCleanupAuthorization('Bearer undefined', undefined)).toBe(false)
  expect(validCleanupAuthorization('Bearer ', '')).toBe(false)
  expect(validCleanupAuthorization(null, 'dedicated-secret')).toBe(false)
  expect(validCleanupAuthorization('Bearer dedicated-secret-extra', 'dedicated-secret')).toBe(false)
  expect(validCleanupAuthorization('Bearer service-role', 'dedicated-secret')).toBe(false)
  expect(validCleanupAuthorization('Bearer dedicated-secret', 'dedicated-secret')).toBe(true)
})
