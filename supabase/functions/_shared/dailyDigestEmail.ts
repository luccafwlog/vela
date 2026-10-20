// Resumo diário do provisionamento do Portal (e-mail interno, marca Vela),
// enviado pela Edge Function `portal-daily-digest`. Base única em
// `src/services/emailLayout.ts` (lote 6b).
import { emailKit, emailWarnNumber, escapeHtml, renderEmailLayout, renderEmailText } from '../../../src/services/emailLayout.ts'

function brDate(isoDate: string): string {
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate
}

export function dailyDigestTemplate(i: {
  /** Data do resumo em ISO (AAAA-MM-DD), no fuso de Brasília. */
  date: string
  failures: number
  activity: number
  pending: number
  /** Exceção crítica de fatura aberta e fechada nas últimas 24 horas (ADR 0083, item 19). */
  criticalOpened: number
  criticalClosed: number
  portalUrl: string
  supportEmail: string
}) {
  const vela = emailKit('vela')
  const date = brDate(i.date)
  const action: Array<[string, number]> = [
    ['Falhas de entrega e supressões', i.failures],
    ['Exceções críticas de fatura abertas', i.criticalOpened],
    ['Convites aguardando ativação', i.pending],
  ]
  const follow: Array<[string, number]> = [
    ['Exceções críticas de fatura fechadas', i.criticalClosed],
    ['Atividade de provisionamento', i.activity],
  ]
  const columns = [{ label: 'Item', left: true }, { label: 'Quantidade' }]
  const footer = 'Resumo diário do Vela, enviado a quem é do Administrativo ou da Documentação.'
  const title = `Resumo do Portal de ${date}`
  const subtitle = 'Últimas 24 horas do provisionamento do Portal do Cliente'
  const body = vela.block('Pede ação', vela.table(columns, action.map(([label, n]) => [escapeHtml(label), emailWarnNumber(n)])), { flush: true })
    + vela.block('Para acompanhar', vela.table(columns, follow.map(([label, n]) => [escapeHtml(label), String(n)])), { flush: true })
  const text = [
    'Pede ação',
    ...action.map(([label, n]) => `${label}: ${n}`),
    '',
    'Para acompanhar',
    ...follow.map(([label, n]) => `${label}: ${n}`),
  ]
  return {
    subject: `Resumo do Portal — ${date}`,
    text: renderEmailText({ title, subtitle, body: text.join('\n'), footer }),
    html: renderEmailLayout({ brand: 'vela', siteUrl: i.portalUrl, title, subtitle, body, footer: escapeHtml(footer) }),
  }
}

