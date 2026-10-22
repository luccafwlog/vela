// Senha do Portal guardada no GoTrue como HMAC(pepper, senha) (auditoria
// run-2, #7, decisão D1 = a). Quem descobre o e-mail técnico (claim `email`
// do JWT) e chama /auth/v1/token direto precisaria do pepper, que só existe
// nos secrets das Edge Functions; o limite por CNPJ do portal-login deixa de
// ser contornável.
//
// Sem senha pura desde a auditoria run-3 (decisão do dono de 2026-10-22): o
// login e a troca do Email de Recuperação só conferem a senha derivada. Conta
// que ainda tivesse a senha pura no GoTrue redefine a senha pela recuperação
// (o Portal não tinha clientes reais; AGENTS.md, "Data status").
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
