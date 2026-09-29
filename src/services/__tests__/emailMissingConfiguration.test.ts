import { describe, expect, it, vi } from 'vitest'
import { sendEmail } from '../../../supabase/functions/_shared/email'

describe('sendEmail without provider configuration', () => {
  it('records failure and never reports a dry-run as a successful send', async () => {
    const updateAttempt = vi.fn()
    const result = await sendEmail({
      kind: 'convite',
      to: 'cliente@example.com',
      subject: 'Convite',
      html: '<p>Convite</p>',
      text: 'Convite',
      idempotencyKey: 'convite:1',
      resendApiKey: null,
      checkSuppression: async () => ({ suppressed: false }),
      recordAttempt: async () => ({ id: 42, status: 'aceito' }),
      updateAttempt,
    })

    expect(result).toEqual({ ok: false })
    expect(updateAttempt).toHaveBeenCalledWith(42, {
      retryCount: 0,
      status: 'falha_permanente',
      lastError: 'RESEND_API_KEY não está configurada; email não enviado.',
    })
  })
})
