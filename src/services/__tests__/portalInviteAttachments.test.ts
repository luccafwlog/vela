import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PORTAL_INVITE_ATTACHMENTS } from '../../../supabase/functions/_shared/portalInviteAttachments.ts'
import { inviteTemplate, resendTemplate } from '../../../supabase/functions/_shared/portalEmailTemplates.ts'

// portalEmail.ts importa o cliente Supabase do esm.sh e usa Deno: fica fora do
// typecheck do app e entra por import dinâmico (como em portalEmailSend.test.ts).
type SendPortalEmail = (input: Record<string, unknown>) => Promise<{ ok: boolean; suppressed: boolean }>
const portalEmailPath = '../../../supabase/functions/_shared/portalEmail.ts'
const { sendPortalEmail } = await import(/* @vite-ignore */ portalEmailPath) as { sendPortalEmail: SendPortalEmail }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const artifact = (name: string) => readFileSync(path.join(root, 'artifacts/portal-onboarding-cliente', name))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PDFs anexados ao convite do Portal', () => {
  it('são os PDFs atuais do material do Cliente, com os nomes do anexo', () => {
    const sources: Record<string, string> = {
      'Tutorial_Portal_Fwlog.pdf': 'Tutorial_Portal_Fwlog.pdf',
      'Guia_Rapido_Portal_Fwlog.pdf': 'guia-rapido-portal-fwlog.pdf',
    }
    expect(PORTAL_INVITE_ATTACHMENTS.map((attachment) => attachment.filename)).toEqual(Object.keys(sources))
    let total = 0
    for (const attachment of PORTAL_INVITE_ATTACHMENTS) {
      const bytes = Buffer.from(attachment.content, 'base64')
      total += bytes.length
      expect(attachment.contentType).toBe('application/pdf')
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      // PDF gerado de novo sem rodar o script: o convite levaria a versão antiga.
      expect(
        bytes.equals(artifact(sources[attachment.filename])),
        `${attachment.filename} difere do PDF em artifacts/; rode node scripts/generate-portal-invite-pdfs.mjs`,
      ).toBe(true)
    }
    // O mesmo teto dos anexos de Comunicado (COMMUNICATION_ATTACHMENT_MAX_BYTES).
    expect(total).toBeLessThanOrEqual(10 * 1024 * 1024)
  })

  it('convite e reenvio citam os dois anexos, no HTML e no texto', () => {
    const line = 'Em anexo estão o tutorial completo e o guia rápido do Portal.'
    const input = { companyName: 'ACME', cnpjMasked: '***', activationUrl: 'https://portalfwlog.com.br/portal/ativar?token=t', portalUrl: 'https://portalfwlog.com.br', supportEmail: 'suporte@portalfwlog.com.br' }
    for (const template of [inviteTemplate, resendTemplate]) {
      const email = template(input)
      expect(email.html).toContain(line)
      expect(email.text).toContain(line)
    }
  })

  it('portal-invite-send manda os anexos no convite e no reenvio', () => {
    const source = readFileSync(path.join(root, 'supabase/functions/portal-invite-send/index.ts'), 'utf8')
    const call = source.split('\n').find((line) => line.includes('await sendPortalEmail(')) ?? ''
    expect(call).toContain("kind: resend ? 'reenvio' : 'convite'")
    expect(call).toContain('attachments: PORTAL_INVITE_ATTACHMENTS')
  })

  it('sendPortalEmail leva os anexos até o provedor', async () => {
    const env: Record<string, string> = {
      RESEND_API_KEY: 'ms_test',
      PORTAL_FROM_EMAIL: 'Portal Fwlog <no-reply@portalfwlog.com.br>',
      PORTAL_REPLY_TO: 'suporte@portalfwlog.com.br',
    }
    vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 }))
    const from = vi.fn((table: string) => {
      if (table === 'app_settings') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { communications_enabled: true }, error: null }) }) }) }
      if (table === 'portal_suppressed_emails') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
      return {
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 7 }, error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }
    })

    const result = await sendPortalEmail({ admin: { from }, kind: 'convite', to: 'cliente@acme.com', subject: 's', html: '<p>h</p>', text: 't', attachments: PORTAL_INVITE_ATTACHMENTS, idempotencyKey: 'convite:1' })

    expect(result).toEqual({ ok: true, suppressed: false })
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))
    expect(body.to).toEqual(['cliente@acme.com'])
    expect(body.attachments).toEqual(PORTAL_INVITE_ATTACHMENTS.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      content_type: 'application/pdf',
    })))
  })
})
