type InviteTemplateInput = { companyName: string; cnpjMasked: string; activationUrl: string; supportEmail: string; portalUrl: string }

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)

const NAVY = '#152238'
const GOLD = '#d4882e'
const INK = '#1f2937'
const MUTED = '#6b7280'
const BORDER = '#e5e7eb'
const CARD_BG = '#ffffff'
const PAGE_BG = '#f1f3f6'

// Layout base dos emails transacionais do Portal do Cliente: logo real da
// Transhipping, cartão com título, quadro de identificação (empresa/CNPJ) e
// rodapé com contato de suporte — mesma identidade em convite, reenvio,
// recuperação e troca de email (decisão da #370).
function layout(input: {
  title: string
  paragraphs: string[]
  button?: { label: string; url: string }
  identity?: { companyName: string; cnpjMasked: string }
  rows?: { label: string; value: string; emphasize?: boolean }[]
  list?: string[]
  portalUrl: string
  supportEmail: string
}) {
  const origin = input.portalUrl.replace(/\/portal(?:\/.*)?$/, '').replace(/\/+$/, '')
  const logoUrl = `${origin}/branding/fwlog-logo-white.png`
  const body = input.paragraphs.map((paragraph) => `<p style="margin:0 0 16px;line-height:1.6;font-size:15px;color:${INK}">${escapeHtml(paragraph)}</p>`).join('')

  const identityBox = input.identity
    ? `<table role="presentation" width="100%" style="margin:4px 0 24px;border-collapse:collapse">
        <tr>
          <td style="background:#f8f5ef;border:1px solid #ecd9bd;border-left:3px solid ${GOLD};border-radius:6px;padding:16px 18px">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${GOLD}">Empresa</p>
            <p style="margin:0;font-size:15px;font-weight:600;color:${NAVY}">${escapeHtml(input.identity.companyName)}</p>
            <p style="margin:4px 0 0;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${MUTED}">CNPJ ${escapeHtml(input.identity.cnpjMasked)}</p>
          </td>
        </tr>
      </table>`
    : ''

  const rowsBox = input.rows?.length
    ? `<table role="presentation" width="100%" style="margin:4px 0 24px;border-collapse:collapse;border:1px solid ${BORDER};border-radius:6px;overflow:hidden">
        ${input.rows.map((row, index) => `<tr>
          <td style="padding:10px 16px;font-size:13px;color:${MUTED};width:42%;${index > 0 ? `border-top:1px solid ${BORDER}` : ''}">${escapeHtml(row.label)}</td>
          <td style="padding:10px 16px;font-size:${row.emphasize ? '17' : '14'}px;font-weight:${row.emphasize ? '700' : '600'};color:${row.emphasize ? GOLD : NAVY};${index > 0 ? `border-top:1px solid ${BORDER}` : ''}">${escapeHtml(row.value)}</td>
        </tr>`).join('')}
      </table>`
    : ''

  const listBox = input.list?.length
    ? `<ul style="margin:0 0 20px;padding-left:20px;color:${INK};font-size:15px;line-height:1.7">${input.list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : ''

  const cta = input.button
    ? `<table role="presentation" width="100%" style="margin:8px 0 4px"><tr><td align="center">
        <a href="${escapeHtml(input.button.url)}" style="background:${NAVY};color:#ffffff;padding:14px 30px;text-decoration:none;border-radius:6px;display:inline-block;font-size:15px;font-weight:600">${escapeHtml(input.button.label)}</a>
      </td></tr></table>`
    : ''

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG}">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${CARD_BG};border:1px solid ${BORDER};border-radius:12px;overflow:hidden">
          <tr>
            <td style="background:${NAVY};padding:28px 32px 25px">
              <img src="${logoUrl}" alt="Fwlog" height="28" style="height:28px;width:auto;display:block;border:0" />
            </td>
          </tr>
          <tr><td style="height:3px;line-height:3px;font-size:0;background:${GOLD}">&nbsp;</td></tr>
          <tr>
            <td style="padding:32px 32px 8px">
              <h1 style="margin:0 0 20px;font-size:21px;line-height:1.35;color:${NAVY};font-weight:700">${escapeHtml(input.title)}</h1>
              ${identityBox}
              ${body}
              ${rowsBox}
              ${listBox}
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 28px">
              <table role="presentation" width="100%" style="border-collapse:collapse;border-top:1px solid ${BORDER}"><tr><td style="padding-top:20px">
                <p style="margin:0;font-size:12.5px;line-height:1.6;color:${MUTED}">Portal do Cliente — Fwlog. Dúvidas ou não reconhece esta mensagem? Fale com <a href="mailto:${escapeHtml(input.supportEmail)}" style="color:${NAVY};text-decoration:underline">${escapeHtml(input.supportEmail)}</a>.</p>
              </td></tr></table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function inviteTemplate(i: InviteTemplateInput) {
  const text = [`A ${i.companyName} (CNPJ ${i.cnpjMasked}) foi convidada para o Portal do Cliente.`, '', 'Ative o acesso e crie sua própria senha. O link vale por 48 horas:', i.activationUrl, '', `Se você não é a pessoa autorizada, ignore este email e avise a Fwlog em ${i.supportEmail}.`].join('\n')
  return {
    subject: `Ative o acesso da ${i.companyName} ao Portal do Cliente`,
    text,
    html: layout({
      title: 'Ative seu acesso ao Portal do Cliente',
      identity: { companyName: i.companyName, cnpjMasked: i.cnpjMasked },
      paragraphs: ['Você foi convidado a acessar o Portal do Cliente da Fwlog, onde acompanha faturas, B/Ls e o andamento das suas operações.', 'Clique no botão abaixo para criar sua própria senha. O link é de uso único e vale por 48 horas.', `Se você não é a pessoa autorizada a acessar esta conta, ignore este email e avise a Fwlog em ${i.supportEmail}.`],
      button: { label: 'Ativar acesso', url: i.activationUrl },
      portalUrl: i.portalUrl,
      supportEmail: i.supportEmail,
    }),
  }
}

export function resendTemplate(i: InviteTemplateInput) {
  const text = [`Enviamos um novo link de ativação para ${i.companyName} (CNPJ ${i.cnpjMasked}).`, 'Os links anteriores deixaram de funcionar.', '', i.activationUrl, '', `Se você não é a pessoa autorizada, ignore este email e avise a Fwlog em ${i.supportEmail}.`].join('\n')
  return {
    subject: 'Novo convite para ativar seu acesso ao Portal do Cliente',
    text,
    html: layout({
      title: 'Novo convite do Portal do Cliente',
      identity: { companyName: i.companyName, cnpjMasked: i.cnpjMasked },
      paragraphs: ['Enviamos um novo link de ativação. Os links anteriores deixaram de funcionar.', 'O novo link é de uso único e vale por 48 horas.', `Se você não é a pessoa autorizada, ignore este email e avise a Fwlog em ${i.supportEmail}.`],
      button: { label: 'Ativar acesso', url: i.activationUrl },
      portalUrl: i.portalUrl,
      supportEmail: i.supportEmail,
    }),
  }
}

export function recoveryTemplate(i: Omit<InviteTemplateInput, 'activationUrl'> & { recoveryUrl: string }) {
  const text = [`Recebemos um pedido de recuperação de acesso da ${i.companyName} (CNPJ ${i.cnpjMasked}).`, '', 'O link abaixo é de uso único e expira em 1 hora:', i.recoveryUrl, '', 'Se você não fez este pedido, ignore esta mensagem.'].join('\n')
  return {
    subject: 'Recuperação de acesso ao Portal do Cliente',
    text,
    html: layout({
      title: 'Recuperação de acesso ao Portal',
      identity: { companyName: i.companyName, cnpjMasked: i.cnpjMasked },
      paragraphs: ['Recebemos um pedido de recuperação de acesso à sua conta do Portal do Cliente.', 'O link abaixo é de uso único e expira em 1 hora. Ao concluir, todas as sessões anteriores serão encerradas.', 'Se você não fez este pedido, ignore esta mensagem — nenhuma alteração será feita na sua conta.'],
      button: { label: 'Recuperar acesso', url: i.recoveryUrl },
      portalUrl: i.portalUrl,
      supportEmail: i.supportEmail,
    }),
  }
}

export function emailChangeConfirmTemplate(i: { companyName: string; confirmUrl: string; portalUrl: string; supportEmail: string }) {
  const text = [`Confirme o novo Email de Recuperação para ${i.companyName}:`, i.confirmUrl, '', 'O link é de uso único e vale por 48 horas.', 'Se você não solicitou esta troca, ignore esta mensagem e avise o suporte.'].join('\n')
  return {
    subject: 'Confirme seu novo Email de Recuperação',
    text,
    html: layout({
      title: 'Confirme seu novo Email de Recuperação',
      paragraphs: [`Recebemos um pedido para trocar o Email de Recuperação da conta de ${i.companyName} no Portal do Cliente.`, 'Clique no botão abaixo para confirmar este novo endereço. O link é de uso único e vale por 48 horas.', 'Ao confirmar, o endereço anterior deixa de valer e as sessões abertas em outros dispositivos serão encerradas.', 'Se você não solicitou esta troca, ignore esta mensagem e avise o suporte imediatamente.'],
      button: { label: 'Confirmar novo email', url: i.confirmUrl },
      portalUrl: i.portalUrl,
      supportEmail: i.supportEmail,
    }),
  }
}

export function emailChangeAlertTemplate(i: { portalUrl: string; supportEmail: string }) {
  const text = ['Foi solicitada uma troca do Email de Recuperação da sua conta.', 'Se você não reconhece esta ação, contate o suporte imediatamente.'].join('\n')
  return {
    subject: 'Solicitação de troca do Email de Recuperação',
    text,
    html: layout({
      title: 'Solicitação de troca de email',
      paragraphs: ['Foi solicitada uma troca do Email de Recuperação da sua conta no Portal do Cliente.', 'Este endereço continua válido até que a troca seja confirmada no novo email.', 'Se você não reconhece esta ação, contate o suporte imediatamente.'],
      portalUrl: i.portalUrl,
      supportEmail: i.supportEmail,
    }),
  }
}

// Troca assistida: ao contrário do pedido pelo Perfil, já está valendo quando
// este aviso sai, então o texto não promete que o endereço segue válido.
export function emailChangeAssistedAlertTemplate(i: { portalUrl: string; supportEmail: string }) {
  const text = ['O Email de Recuperação da sua conta no Portal do Cliente foi trocado pela equipe da Fwlog.', 'Este endereço deixou de receber convites e links de recuperação, e as sessões abertas foram encerradas.', `Se você não pediu esta troca, fale com ${i.supportEmail} imediatamente.`].join('\n')
  return {
    subject: 'Seu Email de Recuperação foi trocado',
    text,
    html: layout({
      title: 'Email de Recuperação trocado',
      paragraphs: ['O Email de Recuperação da sua conta no Portal do Cliente foi trocado pela equipe da Fwlog.', 'Este endereço deixou de receber convites e links de recuperação, e as sessões abertas foram encerradas.', `Se você não pediu esta troca, fale com ${i.supportEmail} imediatamente.`],
      portalUrl: i.portalUrl,
      supportEmail: i.supportEmail,
    }),
  }
}

export function dailyDigestTemplate(i: { date: string; failures: number; activity: number; pending: number; portalUrl: string; supportEmail: string }) {
  const list = [`Falhas/supressões: ${i.failures}`, `Atividade de provisionamento: ${i.activity}`, `Ativação pendente: ${i.pending}`]
  const text = [`Resumo do Portal — ${i.date}`, '', ...list].join('\n')
  return {
    subject: `Resumo do Portal — ${i.date}`,
    text,
    html: layout({
      title: `Resumo do Portal — ${i.date}`,
      paragraphs: ['Consolidado das últimas 24 horas de provisionamento do Portal do Cliente.'],
      list,
      portalUrl: i.portalUrl,
      supportEmail: i.supportEmail,
    }),
  }
}

export function bounceNotificationTemplate(i: {
  bouncedEmailMasked: string
  portalUrl: string
  supportEmail: string
}) {
  const text = [
    `O endereço ${i.bouncedEmailMasked} não recebeu um comunicado.`,
    '',
    'A entrega falhou permanentemente (bounce). Atualize o cadastro do cliente para evitar novas falhas de entrega.',
    '',
    `Dúvidas ou suporte? Entre em contato com ${i.supportEmail}.`,
  ].join('\n')
  const origin = i.portalUrl.replace(/\/portal(?:\/.*)?$/, '').replace(/\/+$/, '')
  return {
    subject: 'Falha de entrega: atualize o cadastro do cliente',
    text,
    html: layout({
      title: 'Falha de entrega de comunicado',
      paragraphs: [
        `O endereço <strong>${escapeHtml(i.bouncedEmailMasked)}</strong> não recebeu um comunicado recente.`,
        'A entrega falhou permanentemente (bounce). Atualize o cadastro de contatos do cliente no Portal para garantir o recebimento dos próximos comunicados e avisos operacionais.',
      ],
      button: { label: 'Acessar Portal do Cliente', url: `${origin}/portal` },
      portalUrl: origin,
      supportEmail: i.supportEmail,
    }),
  }
}

// Avisos do Desbloqueio de CE ao cliente (recusa de documento; documentação validada).
// Nunca cita ZPT nem desbloqueio confirmado: o cliente confere o resultado no Mercante.
export function ceUnlockNoticeTemplate(i: {
  title: string
  message: string
  portalUrl: string
  supportEmail: string
}) {
  const origin = i.portalUrl.replace(/\/portal(?:\/.*)?$/, '').replace(/\/+$/, '')
  const link = `${origin}/portal/desbloqueio-ce`
  return {
    subject: i.title,
    text: [i.message, '', `Acompanhe no Portal: ${link}`, '', `Dúvidas? Entre em contato com ${i.supportEmail}.`].join('\n'),
    html: layout({
      title: i.title,
      paragraphs: [i.message],
      button: { label: 'Abrir Desbloqueio de CE', url: link },
      portalUrl: origin,
      supportEmail: i.supportEmail,
    }),
  }
}
