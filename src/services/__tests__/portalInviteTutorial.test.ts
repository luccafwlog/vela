import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PORTAL_INVITE_TUTORIAL_DEFAULT_URL,
  loadPortalInviteTutorial,
  portalInviteTutorialUrl,
} from '../../../supabase/functions/_shared/portalInviteTutorial.ts'
import { inviteTemplate, resendTemplate } from '../../../supabase/functions/_shared/portalEmailTemplates.ts'

// portalEmail.ts importa o cliente Supabase do esm.sh e usa Deno: fica fora do
// typecheck do app e entra por import dinâmico (como em portalEmailSend.test.ts).
type SendPortalEmail = (input: Record<string, unknown>) => Promise<{ ok: boolean; suppressed: boolean }>
const portalEmailPath = '../../../supabase/functions/_shared/portalEmail.ts'
const { sendPortalEmail } = await import(/* @vite-ignore */ portalEmailPath) as { sendPortalEmail: SendPortalEmail }

// Bytes de um PDF maior que o bloco do base64 (32 KiB), para cobrir a junção.
function pdfBytes(size = 100_000): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size)
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'))
  for (let index = 9; index < size; index += 1) bytes[index] = (index * 31) % 256
  return bytes
}

function fakeFetch(response: Response) {
  return vi.fn<typeof fetch>(async () => response)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('tutorial do Portal anexado ao convite', () => {
  it('baixa o PDF e devolve o anexo Tutorial_Portal_Fwlog.pdf com o mesmo conteúdo', async () => {
    const bytes = pdfBytes()
    const fetchImpl = fakeFetch(new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } }))
    const result = await loadPortalInviteTutorial({ fetchImpl })
    expect(fetchImpl.mock.calls[0][0]).toBe(PORTAL_INVITE_TUTORIAL_DEFAULT_URL)
    expect(result.attachment).toMatchObject({ filename: 'Tutorial_Portal_Fwlog.pdf', contentType: 'application/pdf' })
    expect(Uint8Array.from(Buffer.from(result.attachment!.content, 'base64'))).toEqual(bytes)
  })

  it('lê a URL do secret PORTAL_INVITE_TUTORIAL_PDF_URL; sem ele, o PDF do site da Fwlog', () => {
    expect(portalInviteTutorialUrl()).toBe(PORTAL_INVITE_TUTORIAL_DEFAULT_URL)
    vi.stubGlobal('Deno', { env: { get: (name: string) => (name === 'PORTAL_INVITE_TUTORIAL_PDF_URL' ? ' https://cdn.example/t.pdf ' : undefined) } })
    expect(portalInviteTutorialUrl()).toBe('https://cdn.example/t.pdf')
  })

  it('sem PDF válido, não lança: devolve o motivo e o convite segue sem o anexo', async () => {
    const page = await loadPortalInviteTutorial({ fetchImpl: fakeFetch(new Response('<!doctype html><p>Página não encontrada</p>', { status: 200 })) })
    expect(page).toEqual({ attachment: null, reason: 'O arquivo do tutorial não é um PDF' })

    const missing = await loadPortalInviteTutorial({ fetchImpl: fakeFetch(new Response('', { status: 404 })) })
    expect(missing).toEqual({ attachment: null, reason: 'HTTP 404 ao baixar o tutorial' })

    const huge = await loadPortalInviteTutorial({ fetchImpl: fakeFetch(new Response(pdfBytes(16), { status: 200, headers: { 'content-length': String(11 * 1024 * 1024) } })) })
    expect(huge).toEqual({ attachment: null, reason: 'Tutorial acima de 10 MB' })

    const timeout = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })
    const slow = await loadPortalInviteTutorial({ fetchImpl: vi.fn(async () => { throw timeout }) })
    expect(slow).toEqual({ attachment: null, reason: 'Tempo esgotado ao baixar o tutorial' })

    const insecure = vi.fn()
    expect(await loadPortalInviteTutorial({ url: 'http://fwlog.com.br/t.pdf', fetchImpl: insecure })).toEqual({ attachment: null, reason: 'URL do tutorial precisa ser https' })
    expect(insecure).not.toHaveBeenCalled()
  })

  it('convite e reenvio citam o anexo só quando ele foi junto', () => {
    const line = 'Em anexo está o tutorial completo do Portal.'
    const base = { companyName: 'ACME', cnpjMasked: '***', activationUrl: 'https://portalfwlog.com.br/portal/ativar?token=t', portalUrl: 'https://portalfwlog.com.br', supportEmail: 'suporte@portalfwlog.com.br' }
    for (const template of [inviteTemplate, resendTemplate]) {
      const attached = template({ ...base, tutorialAttached: true })
      expect(attached.html).toContain(line)
      expect(attached.text).toContain(line)
      const without = template(base)
      expect(without.html).not.toContain(line)
      expect(without.text).not.toContain(line)
    }
  })

  it('sendPortalEmail leva o anexo até o provedor', async () => {
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
    const attachment = { filename: 'Tutorial_Portal_Fwlog.pdf', content: 'JVBERi0=', contentType: 'application/pdf' }

    const result = await sendPortalEmail({ admin: { from }, kind: 'convite', to: 'cliente@acme.com', subject: 's', html: '<p>h</p>', text: 't', attachments: [attachment], idempotencyKey: 'convite:1' })

    expect(result).toEqual({ ok: true, suppressed: false })
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))
    expect(body.to).toEqual(['cliente@acme.com'])
    expect(body.attachments).toEqual([{ filename: 'Tutorial_Portal_Fwlog.pdf', content: 'JVBERi0=', content_type: 'application/pdf' }])
  })
})
