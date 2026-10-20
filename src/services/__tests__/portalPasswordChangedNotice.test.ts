import { describe, expect, it, vi } from 'vitest'
import { notifyPortalPasswordChanged } from '../../../supabase/functions/_shared/portalPasswordResetFlow'
import { passwordChangedTemplate } from '../../../supabase/functions/_shared/portalEmailTemplates'

describe('aviso de senha alterada do Portal (D12)', () => {
  it('avisa o Email de Recuperação com CNPJ mascarado e uma chave por recuperação', async () => {
    const send = vi.fn(async () => ({ ok: true }))
    const sent = await notifyPortalPasswordChanged(42, {
      loadAccount: async () => ({ recoveryEmail: ' cliente@acme.com ', companyName: 'Acme', cnpj: '12.345.678/0001-90' }),
      send,
    })
    expect(sent).toBe(true)
    expect(send).toHaveBeenCalledWith({ to: 'cliente@acme.com', companyName: 'Acme', cnpjMasked: '12.***.***/0001-90', idempotencyKey: 'senha_alterada:42' })
  })

  it('falha no aviso não derruba a recuperação já concluída', async () => {
    await expect(notifyPortalPasswordChanged(1, {
      loadAccount: async () => ({ recoveryEmail: 'a@b.com', companyName: null, cnpj: null }),
      send: async () => { throw new Error('provedor fora') },
    })).resolves.toBe(false)
    await expect(notifyPortalPasswordChanged(1, {
      loadAccount: async () => { throw new Error('banco fora') },
      send: async () => ({ ok: true }),
    })).resolves.toBe(false)
  })

  it('conta sem Email de Recuperação não tenta enviar', async () => {
    const send = vi.fn(async () => ({ ok: true }))
    expect(await notifyPortalPasswordChanged(1, { loadAccount: async () => ({ recoveryEmail: null, companyName: 'X', cnpj: null }), send })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('o e-mail orienta a falar com o suporte se não foi a pessoa', () => {
    const mail = passwordChangedTemplate({ companyName: 'Acme <b>', cnpjMasked: '12.***.***/0001-90', portalUrl: 'https://portalfwlog.com.br', supportEmail: 'suporte@fwlog.com.br' })
    expect(mail.subject).toBe('Sua senha do Portal do Cliente foi alterada')
    expect(mail.text).toContain('Portal do Cliente · Fwlog. Não foi você? Fale com suporte@fwlog.com.br imediatamente.')
    expect(mail.html).toContain('Não foi você? Fale com <a href="mailto:suporte@fwlog.com.br"')
    expect(mail.text).toContain('Se foi você, não é preciso fazer nada.')
    expect(mail.html).toContain('Acme &lt;b&gt;')
  })
})
