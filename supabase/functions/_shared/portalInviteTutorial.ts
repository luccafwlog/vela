// Tutorial do Portal em PDF, anexado a todo e-mail de convite e de reenvio.
// O arquivo mora no site da Fwlog e é baixado a cada envio: trocar o PDF é
// trocar o arquivo publicado (ou o secret), sem publicar a Edge Function.
// ponytail: baixa a cada convite, sem cache; os convites saem um a um, pelo
// operador. Upgrade, se o volume crescer ou o site ficar instável: cache em
// memória por instância ou o PDF como arquivo estático da própria função.
import type { EmailAttachment } from './email.ts'
import { matchesMagicBytes } from './fileSignature.ts'

export const PORTAL_INVITE_TUTORIAL_DEFAULT_URL = 'https://fwlog.com.br/wp-content/uploads/2026/10/tutorial-portal-fwlog.pdf'
export const PORTAL_INVITE_TUTORIAL_FILENAME = 'Tutorial_Portal_Fwlog.pdf'
// O mesmo teto dos anexos de Comunicado (COMMUNICATION_ATTACHMENT_MAX_BYTES).
const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 10_000

/** Secret `PORTAL_INVITE_TUTORIAL_PDF_URL`; sem valor, o PDF publicado no site da Fwlog. */
export function portalInviteTutorialUrl(): string {
  const configured = (globalThis as { Deno?: { env: { get(name: string): string | undefined } } }).Deno?.env.get('PORTAL_INVITE_TUTORIAL_PDF_URL')?.trim()
  return configured || PORTAL_INVITE_TUTORIAL_DEFAULT_URL
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // Em blocos: espalhar o arquivo inteiro em fromCharCode estoura a pilha.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

export type PortalInviteTutorialResult =
  | { attachment: EmailAttachment; reason?: undefined }
  | { attachment: null; reason: string }

/**
 * Baixa o PDF e devolve o anexo do convite. Qualquer falha (site fora, tempo
 * esgotado, arquivo grande demais ou que não é PDF) devolve `attachment: null`
 * com o motivo, sem lançar: o convite sai sem o anexo em vez de não sair.
 */
export async function loadPortalInviteTutorial(options: {
  url?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
} = {}): Promise<PortalInviteTutorialResult> {
  const url = options.url ?? portalInviteTutorialUrl()
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { attachment: null, reason: 'URL do tutorial inválida' }
  }
  if (parsed.protocol !== 'https:') return { attachment: null, reason: 'URL do tutorial precisa ser https' }

  let bytes: Uint8Array
  try {
    const response = await (options.fetchImpl ?? fetch)(parsed.href, { signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS) })
    if (!response.ok) {
      await response.body?.cancel()
      return { attachment: null, reason: `HTTP ${response.status} ao baixar o tutorial` }
    }
    const declared = Number(response.headers.get('content-length'))
    if (declared > MAX_BYTES) {
      await response.body?.cancel()
      return { attachment: null, reason: 'Tutorial acima de 10 MB' }
    }
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return {
      attachment: null,
      reason: name === 'TimeoutError' || name === 'AbortError' ? 'Tempo esgotado ao baixar o tutorial' : `Falha de rede ao baixar o tutorial${name ? ` (${name})` : ''}`,
    }
  }
  if (bytes.length > MAX_BYTES) return { attachment: null, reason: 'Tutorial acima de 10 MB' }
  if (!matchesMagicBytes(bytes, 'application/pdf')) return { attachment: null, reason: 'O arquivo do tutorial não é um PDF' }
  return {
    attachment: { filename: PORTAL_INVITE_TUTORIAL_FILENAME, content: toBase64(bytes), contentType: 'application/pdf' },
  }
}
