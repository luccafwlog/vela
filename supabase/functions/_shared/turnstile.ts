const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const MAX_TOKEN_LENGTH = 2048
const VERIFY_TIMEOUT_MS = 5000

type TurnstileResponse = {
  success?: unknown
  action?: unknown
  hostname?: unknown
}

type VerifyTurnstileInput = {
  token: unknown
  expectedAction: string
  expectedHostname: string | null
  secret: string
  allowedHostnames: readonly string[]
  fetcher?: typeof fetch
}

function normalizedHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

export async function verifyTurnstileToken({
  token,
  expectedAction,
  expectedHostname,
  secret,
  allowedHostnames,
  fetcher = fetch,
}: VerifyTurnstileInput): Promise<boolean> {
  if (
    typeof token !== 'string'
    || token.length === 0
    || token.length > MAX_TOKEN_LENGTH
    || !secret.trim()
    || !expectedAction.trim()
    || !expectedHostname
  ) return false

  const expectedHost = normalizedHostname(expectedHostname)
  const allowed = new Set(allowedHostnames.map(normalizedHostname).filter(Boolean))
  if (!expectedHost || !allowed.has(expectedHost)) return false

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
  try {
    const response = await fetcher(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
      signal: controller.signal,
    })
    if (!response.ok) return false

    const result = await response.json() as TurnstileResponse
    return result.success === true
      && result.action === expectedAction
      && typeof result.hostname === 'string'
      && normalizedHostname(result.hostname) === expectedHost
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function requestHostname(request: Request): string | null {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  try {
    const url = new URL(origin)
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    if ((!localHttp && url.protocol !== 'https:') || url.origin !== origin) return null
    return url.hostname
  } catch {
    return null
  }
}

function configuredHostnames(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((hostname) => hostname.trim()).filter(Boolean)
}

export async function verifyTurnstileRequest(
  request: Request,
  token: unknown,
  expectedAction: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const deno = (globalThis as typeof globalThis & {
    Deno?: { env: { get(name: string): string | undefined } }
  }).Deno

  return verifyTurnstileToken({
    token,
    expectedAction,
    expectedHostname: requestHostname(request),
    secret: deno?.env.get('TURNSTILE_SECRET_KEY') ?? '',
    allowedHostnames: configuredHostnames(deno?.env.get('TURNSTILE_ALLOWED_HOSTNAMES')),
    fetcher,
  })
}
