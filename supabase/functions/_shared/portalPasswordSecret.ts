// Senha do Portal guardada no GoTrue como HMAC(pepper, senha) (auditoria
// run-2, #7, decisão D1 = a). Quem descobre o e-mail técnico (claim `email`
// do JWT) e chama /auth/v1/token direto precisaria do pepper, que só existe
// nos secrets das Edge Functions; o limite por CNPJ do portal-login deixa de
// ser contornável.
//
// ponytail: contas ainda com a senha pura continuam entrando pelo portal-login
// (fallback legado) e migram nesse login. Até lá o caminho direto no GoTrue
// segue aberto para elas; remover o fallback quando nenhuma conta ativa tiver
// senha legada (o Portal ainda não tem clientes reais).
const PREFIX = 'p1.'

export function portalPasswordPepper(): string {
  const deno = (globalThis as typeof globalThis & {
    Deno?: { env: { get(name: string): string | undefined } }
  }).Deno
  const pepper = deno?.env.get('PORTAL_PASSWORD_PEPPER') ?? ''
  if (pepper.length < 32) throw new Error('PORTAL_PASSWORD_PEPPER ausente ou curto')
  return pepper
}

export async function derivePortalAuthPassword(password: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(password)))
  let binary = ''
  for (const byte of mac) binary += String.fromCharCode(byte)
  // 3 + 43 caracteres: abaixo do limite de 72 bytes do bcrypt do GoTrue.
  return PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
