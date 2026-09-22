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
// 2. Envio. A falha do Resend só vira um código de erro sanitizado no log dentro do `waitUntil`, e
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
  | { outcome: 'aplicar'; inviteId: number; account: EmailChangeAccount }

// Ordem do `confirm`: LER a conta antes de queimar o convite.
//
// Antes, a sequência era validar o convite → marcar como consumido → ler a
// conta → devolver 410 se `pending_recovery_email` fosse nulo. O convite era
// destruído no passo 2 para se descobrir no passo 3 que não havia nada a
// aplicar, e a mensagem devolvida ("Link inválido ou expirado") era falsa: o
// link estava válido, quem o destruiu foi a própria chamada. O caminho que
// produzia isso é a troca assistida, que zera `pending_recovery_email` — a
// migration 300 passou a encerrar o convite junto, e esta ordem cobre os links
// que já estavam em trânsito.
//
// Por isso o que decide entre 409 e 410 é a CONTA, não o status do convite: a
// troca assistida encerra o convite no mesmo UPDATE em que zera o pedido, então
// exigir `status = 'pendente'` antes de olhar a conta devolvia 410 "link
// inválido" exatamente no caso que o 409 existe para descrever — o cliente
// clicaria num link que estava válido e ouviria que nunca esteve. Sem pedido
// pendente não há o que aplicar nem o que invalidar: o desfecho é "já foi
// resolvido", tenha o convite sido encerrado pela troca assistida, por uma
// confirmação anterior deste mesmo link, ou nem isso.
//
// A proteção contra confirmação dupla continua vindo do UPDATE condicional
// (`status = 'pendente'`), que é o ponto de serialização real: só um chamador
// vence, e o perdedor não queima nada — e, tendo perdido para quem aplicou a
// troca, o que ele tem a dizer também é "já foi resolvido".
export async function resolveEmailChangeConfirmation(db: PortalDb, tokenHash: string, now: number): Promise<EmailChangeConfirmation> {
  const { data: invite } = await db
    .from('portal_invites')
    .select('id, account_id, expires_at, status')
    .eq('token_hash', tokenHash)
    .eq('purpose', 'confirmacao_email')
    .maybeSingle()
  if (!invite) return { outcome: 'link_invalido' }

  const { data: account } = await db
    .from('customer_portal_accounts')
    .select('id, customer_id, auth_user_id, pending_recovery_email, provisioning_decision, account_situation')
    .eq('id', invite.account_id)
    .maybeSingle()
  if (!account?.pending_recovery_email) return { outcome: 'pedido_ja_resolvido' }

  // Há pedido pendente: o convite precisa estar de pé para aplicá-lo. Encerrado
  // ou vencido com troca pendente é link superado por um pedido mais novo — aí
  // "inválido" é verdade.
  if (invite.status !== 'pendente' || new Date(String(invite.expires_at)).getTime() <= now) return { outcome: 'link_invalido' }

  const { data: consumed } = await db
    .from('portal_invites')
    .update({ status: 'consumido', consumed_at: new Date(now).toISOString() })
    .eq('id', invite.id)
    .eq('status', 'pendente')
    .select('id')
    .maybeSingle()
  if (!consumed) return { outcome: 'pedido_ja_resolvido' }

  return {
    outcome: 'aplicar',
    inviteId: Number(invite.id),
    account: {
      id: Number(account.id),
      customer_id: Number(account.customer_id),
      auth_user_id: account.auth_user_id === null || account.auth_user_id === undefined ? null : String(account.auth_user_id),
      pending_recovery_email: String(account.pending_recovery_email),
      provisioning_decision: account.provisioning_decision === null || account.provisioning_decision === undefined ? null : String(account.provisioning_decision),
      account_situation: account.account_situation === null || account.account_situation === undefined ? null : String(account.account_situation),
    },
  }
}
