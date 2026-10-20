// Modelos dos e-mails transacionais do Portal do Cliente. O Resumo diário
// interno fica em `dailyDigestEmail.ts`, fora da superfície do Cliente. O layout e as peças vêm da base única `src/services/emailLayout.ts`
// (lote 6b); aqui fica só o conteúdo de cada modelo.
import {
  emailFacts,
  emailFooter,
  emailKit,
  emailLead,
  emailMono,
  emailNote,
  emailOrigin,
  emailParagraph as p,
  emailSecurityFooter,
  escapeHtml,
  renderEmailLayout,
  renderEmailText,
} from '../../../src/services/emailLayout.ts'

export { escapeHtml }

type InviteTemplateInput = { companyName: string; cnpjMasked: string; activationUrl: string; supportEmail: string; portalUrl: string }

const portal = emailKit('portal')

/** Bloco "Acesso para": nome da empresa em destaque e CNPJ mascarado em monoespaçada. */
function accessBlock(companyName: string, cnpjMasked?: string) {
  return {
    html: portal.block('Acesso para', emailLead(escapeHtml(companyName), cnpjMasked ? `CNPJ ${emailMono(cnpjMasked)}` : '')),
    text: `Acesso para: ${companyName}${cnpjMasked ? ` (CNPJ ${cnpjMasked})` : ''}`,
  }
}

function portalMail(input: {
  subject: string
  title: string
  subtitle?: string
  html: string
  text: string[]
  portalUrl: string
  footer: { html: string; text: string }
}) {
  return {
    subject: input.subject,
    text: renderEmailText({ title: input.title, subtitle: input.subtitle, body: input.text.join('\n'), footer: input.footer.text }),
    html: renderEmailLayout({ siteUrl: input.portalUrl, title: input.title, subtitle: input.subtitle, body: input.html, footer: input.footer.html }),
  }
}

export function inviteTemplate(i: InviteTemplateInput) {
  const access = accessBlock(i.companyName, i.cnpjMasked)
  const intro = 'Você foi convidado a acessar o Portal do Cliente da Fwlog, onde acompanha faturas, B/Ls e o andamento das suas operações.'
  const how = 'Crie sua própria senha pelo botão abaixo. O link é de uso único e vale por 48 horas.'
  return portalMail({
    subject: `Ative o acesso da ${i.companyName} ao Portal do Cliente`,
    title: 'Ative seu acesso ao Portal do Cliente',
    html: access.html + p(escapeHtml(intro)) + p(escapeHtml(how)) + portal.button('Ativar acesso', i.activationUrl),
    text: [access.text, '', intro, how, '', `Ativar acesso: ${i.activationUrl}`],
    portalUrl: i.portalUrl,
    footer: emailFooter(i.supportEmail),
  })
}

export function resendTemplate(i: InviteTemplateInput) {
  const access = accessBlock(i.companyName, i.cnpjMasked)
  const intro = 'Enviamos um novo link de ativação. Os links anteriores deixaram de funcionar.'
  const how = 'O novo link é de uso único e vale por 48 horas.'
  return portalMail({
    subject: 'Novo convite para ativar seu acesso ao Portal do Cliente',
    title: 'Novo convite do Portal do Cliente',
    html: access.html + p(escapeHtml(intro)) + p(escapeHtml(how)) + portal.button('Ativar acesso', i.activationUrl),
    text: [access.text, '', intro, how, '', `Ativar acesso: ${i.activationUrl}`],
    portalUrl: i.portalUrl,
    footer: emailFooter(i.supportEmail),
  })
}

export function recoveryTemplate(i: Omit<InviteTemplateInput, 'activationUrl'> & { recoveryUrl: string }) {
  const access = accessBlock(i.companyName, i.cnpjMasked)
  const intro = 'Recebemos um pedido de recuperação de acesso à sua conta do Portal do Cliente.'
  const how = 'O link é de uso único e expira em 1 hora. Ao concluir, todas as sessões anteriores são encerradas.'
  const ignore = 'Se você não fez este pedido, ignore esta mensagem: nada muda na sua conta.'
  return portalMail({
    subject: 'Recuperação de acesso ao Portal do Cliente',
    title: 'Recuperação de acesso ao Portal',
    html: access.html + p(escapeHtml(intro)) + p(escapeHtml(how)) + portal.button('Recuperar acesso', i.recoveryUrl) + emailNote(escapeHtml(ignore)),
    text: [access.text, '', intro, how, '', `Recuperar acesso: ${i.recoveryUrl}`, '', ignore],
    portalUrl: i.portalUrl,
    footer: emailFooter(i.supportEmail),
  })
}

export function emailChangeConfirmTemplate(i: { companyName: string; confirmUrl: string; portalUrl: string; supportEmail: string }) {
  const access = accessBlock(i.companyName)
  const intro = 'Recebemos um pedido para trocar o Email de Recuperação da sua conta no Portal do Cliente.'
  const how = 'Confirme este novo endereço pelo botão abaixo. O link é de uso único e vale por 48 horas. Ao confirmar, o endereço anterior deixa de valer e as sessões abertas em outros dispositivos são encerradas.'
  return portalMail({
    subject: 'Confirme seu novo Email de Recuperação',
    title: 'Confirme seu novo Email de Recuperação',
    html: access.html + p(escapeHtml(intro)) + p(escapeHtml(how)) + portal.button('Confirmar novo e-mail', i.confirmUrl),
    text: [access.text, '', intro, how, '', `Confirmar novo e-mail: ${i.confirmUrl}`],
    portalUrl: i.portalUrl,
    footer: emailSecurityFooter(i.supportEmail),
  })
}

export function emailChangeAlertTemplate(i: { portalUrl: string; supportEmail: string }) {
  const lines = ['Foi pedida a troca do Email de Recuperação da sua conta no Portal do Cliente.', 'Este endereço continua valendo até a troca ser confirmada no novo e-mail.']
  return portalMail({
    subject: 'Pedido de troca do Email de Recuperação',
    title: 'Pedido de troca do Email de Recuperação',
    html: lines.map((line) => p(escapeHtml(line))).join(''),
    text: lines,
    portalUrl: i.portalUrl,
    footer: emailSecurityFooter(i.supportEmail),
  })
}

// Troca assistida: ao contrário do pedido pelo Perfil, já está valendo quando
// este aviso sai, então o texto não promete que o endereço segue válido.
export function emailChangeAssistedAlertTemplate(i: { portalUrl: string; supportEmail: string }) {
  const lines = ['O Email de Recuperação da sua conta no Portal do Cliente foi trocado pela equipe da Fwlog.', 'Este endereço deixou de receber convites e links de recuperação, e as sessões abertas foram encerradas.']
  return portalMail({
    subject: 'Seu Email de Recuperação foi trocado',
    title: 'Seu Email de Recuperação foi trocado',
    html: lines.map((line) => p(escapeHtml(line))).join(''),
    text: lines,
    portalUrl: i.portalUrl,
    footer: emailSecurityFooter(i.supportEmail),
  })
}

// Aviso de segurança (D12): sai ao concluir a recuperação de senha. Suspensão e
// reativação da conta não avisam o Cliente por e-mail.
export function passwordChangedTemplate(i: { companyName: string; cnpjMasked: string; portalUrl: string; supportEmail: string }) {
  const access = accessBlock(i.companyName, i.cnpjMasked)
  const lines = ['A senha de acesso da sua conta no Portal do Cliente foi alterada. As sessões abertas em outros dispositivos foram encerradas.', 'Se foi você, não é preciso fazer nada.']
  return portalMail({
    subject: 'Sua senha do Portal do Cliente foi alterada',
    title: 'Sua senha foi alterada',
    html: access.html + lines.map((line) => p(escapeHtml(line))).join(''),
    text: [access.text, '', ...lines],
    portalUrl: i.portalUrl,
    footer: emailSecurityFooter(i.supportEmail),
  })
}

export function bounceNotificationTemplate(i: {
  bouncedEmailMasked: string
  portalUrl: string
  supportEmail: string
}) {
  const link = `${emailOrigin(i.portalUrl)}/portal/perfil`
  const first = (address: string) => `O endereço ${address} não recebeu um comunicado recente: o servidor de e-mail do destinatário recusou a entrega.`
  const second = 'Confira os contatos que recebem comunicados em Meu perfil, no Portal do Cliente, para não perder os próximos avisos.'
  return portalMail({
    subject: 'Falha de entrega: atualize o cadastro do cliente',
    title: 'Um comunicado não foi entregue',
    html: p(first(emailMono(i.bouncedEmailMasked))) + p(escapeHtml(second)) + portal.button('Abrir Meu perfil', link),
    text: [first(i.bouncedEmailMasked), second, '', `Abrir Meu perfil: ${link}`],
    portalUrl: i.portalUrl,
    footer: emailFooter(i.supportEmail),
  })
}

// Avisos do Desbloqueio de CE ao cliente (recusa de documento; documentação validada).
// Nunca cita ZPT nem desbloqueio confirmado: o cliente confere o resultado no Mercante.
// `request`: protocolo e B/Ls da solicitação; sem B/L, o bloco não aparece.
export function ceUnlockNoticeTemplate(i: {
  title: string
  message: string
  portalUrl: string
  supportEmail: string
  request?: { protocol: string; bls: readonly string[] } | null
}) {
  const link = `${emailOrigin(i.portalUrl)}/portal/desbloqueio-ce`
  const bls = i.request?.bls.map((bl) => bl.trim()).filter(Boolean) ?? []
  const protocol = i.request?.protocol.trim() ?? ''
  const block = bls.length
    ? {
        html: portal.block(`Solicitação ${protocol}`.trim(), emailFacts([['B/Ls', escapeHtml(bls.join(', '))]], 1)),
        text: [`Solicitação ${protocol}`.trim(), `B/Ls: ${bls.join(', ')}`],
      }
    : null
  return portalMail({
    subject: i.title,
    title: i.title,
    html: p(escapeHtml(i.message)) + (block?.html ?? '') + portal.button('Abrir Desbloqueio de CE', link),
    text: [i.message, ...(block ? ['', ...block.text] : []), '', `Abrir Desbloqueio de CE: ${link}`],
    portalUrl: i.portalUrl,
    footer: emailFooter(i.supportEmail),
  })
}
