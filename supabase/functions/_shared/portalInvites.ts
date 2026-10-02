import type { PortalDb } from './portalDb.ts'

export type ReusableInvite = { id: number; expires_at: string }

// Estados em que o convite não é prova de que um link legível chegou à caixa.
// `falha_transitoria`/`falha_permanente` são desistências do próprio
// `sendPortalEmail`; `bounce` vem depois, do webhook do Resend, e vale para o
// bounce brando também -- caixa cheia devolve a mensagem sem suprimir o
// endereço nem marcar a conta, então nada mais no sistema registra que o email
// não chegou. `complaint` fica de fora de propósito: a mensagem foi entregue e
// o cliente a marcou como spam, então o link existe na caixa dele.
const FALHA_DE_ENVIO = new Set(['falha_transitoria', 'falha_permanente', 'bounce'])

// ponytail: janela em que um convite recém-criado ainda não tem tentativa
// registrada. `sendPortalEmail` roda em `EdgeRuntime.waitUntil` e insere a linha
// de `portal_email_attempts` no seu primeiro passo, então "sem tentativa" tem
// dois significados: o envio está em voo, ou nunca chegou a começar. Distinguir
// pelo relógio é heurística — o teto é que dois pedidos separados por mais de
// dois minutos, com o envio travado nesse intervalo, geram um convite a mais.
// Upgrade: gravar a tentativa junto do convite, na mesma transação.
const ENVIO_EM_VOO_MS = 2 * 60 * 1000

// Convite de recuperação ainda pendente, dentro da validade, endereçado ao
// email de recuperação vigente e cujo envio não falhou.
//
// Cada pedido de recuperação invalidava o convite anterior e criava outro,
// disparando um email. Como o CNPJ é público e a função é necessariamente
// pública (`verify_jwt = false`), um terceiro fazia o sistema enviar até 480
// emails por dia à caixa de recuperação de um cliente real. E o cliente que
// pediu o link, foi lê-lo e clicou podia encontrá-lo cancelado por um pedido
// que não era dele. Havendo link vivo, o pedido novo reusa em vez de reenviar.
//
// O reuso só vale para um link que o cliente possa ler AGORA, e são duas
// condições, não uma:
//
// 1. Endereço. Depois de uma troca de Email de Recuperação, o convite pendente
//    aponta para a caixa anterior. Reusá-lo responderia "enviamos" enquanto
//    nada chega ao endereço vigente — e é justamente o endereço novo que o
//    cliente acabou de pedir para usar.
// 2. Envio. A falha do Resend só vira `console.error` dentro do `waitUntil`, e
//    o convite fica pendente do mesmo jeito. Tratar pendente como enviado
//    transformava uma indisponibilidade passageira do provedor em uma hora sem
//    recuperação de senha, atrás de uma tela dizendo que o email saiu.
export async function findReusableRecoveryInvite(db: PortalDb, accountId: number, recoveryEmail: string, now: number): Promise<ReusableInvite | null> {
  const { data } = await db
    .from('portal_invites')
    .select('id, expires_at, sent_to_email, created_at')
    .eq('account_id', accountId)
    .eq('purpose', 'recuperacao')
    .eq('status', 'pendente')
    .gt('expires_at', new Date(now).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  if (String(data.sent_to_email ?? '').toLowerCase() !== recoveryEmail.toLowerCase()) return null

  const inviteId = Number(data.id)
  const { data: attempt } = await db
    .from('portal_email_attempts')
    .select('status')
    .eq('idempotency_key', `recuperacao:${inviteId}`)
    .maybeSingle()
  if (!attempt) {
    const createdAt = Date.parse(String(data.created_at ?? ''))
    const emVoo = Number.isFinite(createdAt) && now - createdAt < ENVIO_EM_VOO_MS
    return emVoo ? { id: inviteId, expires_at: String(data.expires_at) } : null
  }
  if (FALHA_DE_ENVIO.has(String(attempt.status))) return null
  return { id: inviteId, expires_at: String(data.expires_at) }
}

export type EmailChangeAccount = {
  id: number
  customer_id: number
  auth_user_id: string | null
  pending_recovery_email: string
  provisioning_decision: string | null
  account_situation: string | null
}

export type EmailChangeConfirmation =
  | { outcome: 'link_invalido' }
  | { outcome: 'pedido_ja_resolvido' }
  | { outcome: 'recuperacao_em_andamento' }
  | { outcome: 'aplicar'; inviteId: number; account: EmailChangeAccount }

// O banco confirma o endereço e encerra a autoridade antiga na mesma transação.
export async function resolveEmailChangeConfirmation(db: PortalDb, tokenHash: string): Promise<EmailChangeConfirmation> {
  const { data, error } = await db.rpc('portal_confirm_recovery_email', { p_token_hash: tokenHash })
  if (error) {
    if ((error as { code?: string }).code === '55000') return { outcome: 'recuperacao_em_andamento' }
    throw new Error('Could not confirm recovery email')
  }
  if (!data) throw new Error('Missing recovery email confirmation result')
  return data as EmailChangeConfirmation
}
