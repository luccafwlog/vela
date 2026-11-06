// E-mail de teste da Administração › Sistema (migration 605, decisão do dono de
// 2026-11-06): a conta Dev manda um e-mail a si mesma para conferir que o canal
// de envio funciona, sem mandar nada a Cliente. Vai ao e-mail de login de quem
// pediu, de verdade, com a chave de envio ligada ou desligada.

export type AdminTestEmailDecision =
  | { ok: true; to: string }
  | { ok: false; status: 403 | 422; error: string }

/** Quem pode pedir e para onde vai: só a conta Dev, só para o próprio e-mail. */
export function decideAdminTestEmail(input: { isDev: boolean; email: string | null | undefined }): AdminTestEmailDecision {
  if (!input.isDev) return { ok: false, status: 403, error: 'Só a conta Dev envia o e-mail de teste.' }
  const to = input.email?.trim().toLowerCase() ?? ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, status: 422, error: 'A sua conta não tem e-mail para receber o teste.' }
  return { ok: true, to }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)

/** Assunto e corpo do teste, com a hora de Brasília e o estado da chave. */
export function adminTestEmailTemplate(input: { name: string; sentAt: Date; communicationsEnabled: boolean }) {
  const when = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }).format(input.sentAt)
  const channel = input.communicationsEnabled
    ? 'Envio real ligado: os e-mails de Cliente saem para os contatos elegíveis.'
    : 'Envio real desligado: os e-mails de Cliente vão para o suporte.'
  const subject = 'Teste de envio do Vela'
  const text = [`Olá, ${input.name}.`, '', `Este é o e-mail de teste pedido em Administração › Sistema em ${when}.`, channel, '', 'Se ele chegou, o canal de envio do Vela está funcionando.'].join('\n')
  const html = `<p>Olá, ${escapeHtml(input.name)}.</p><p>Este é o e-mail de teste pedido em Administração › Sistema em ${escapeHtml(when)}.</p><p>${escapeHtml(channel)}</p><p>Se ele chegou, o canal de envio do Vela está funcionando.</p>`
  return { subject, text, html }
}
