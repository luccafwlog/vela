export const CUSTOMER_COMMUNICATION_KINDS = [
  'aviso_chegada_noa',
  'aviso_prontidao_nor',
  'aviso_atracacao_nob',
  'ce_mercante_taxas',
  'cobranca_demurrage',
  'institucional',
  'livre',
] as const

export type CustomerCommunicationKind = typeof CUSTOMER_COMMUNICATION_KINDS[number]
export type CustomerCommunicationNature = 'avisos_gerais' | 'avisos_operacionais' | 'documentacao' | 'demurrage'

export const CUSTOMER_COMMUNICATION_MILESTONE_KINDS = [
  'aviso_chegada_noa',
  'aviso_prontidao_nor',
  'aviso_atracacao_nob',
] as const

export type CustomerCommunicationBlScope = {
  id: string
  customerId: number
  terminalId?: string | null
  terminalStateId?: string | null
}

export type CustomerCommunicationCeMercanteRow = {
  blId: string
  ceMercante: string
  totalBrl: number
}

export type CustomerCommunicationDemurrageData = {
  docNumber: string
  totalUsd: number
  totalBrl: number
  roe: number
  roeReferenceDate: string
}

export type CustomerCommunicationTemplateInput = {
  customerId: number
  customerName: string
  vesselName: string
  voyageNumber: string
  port: string
  terminalName?: string | null
  terminalId?: string | null
  terminalStateId?: string | null
  milestoneAt: string
  bls: readonly CustomerCommunicationBlScope[]
  subject?: string
  body?: string
  portalUrl?: string | null
  ceMercanteRows?: readonly CustomerCommunicationCeMercanteRow[]
  totalBrl?: number | null
  demurrage?: CustomerCommunicationDemurrageData
  demurrageDocNumber?: string | null
  totalUsd?: number | null
  currentTotalBrl?: number | null
  roe?: number | null
  roeReferenceDate?: string | null
}

export type RenderedCustomerCommunication = {
  kind: CustomerCommunicationKind
  subject: string
  html: string
  text: string
  customerId: number
  blIds: string[]
  terminalId: string | null
}

export type CommunicationAttachment = {
  filename: string
  contentType: string
  size: number
  contentBase64?: string
}

export type AttachmentValidationResult = {
  valid: boolean
  totalBytes: number
  errors: string[]
}

export const COMMUNICATION_ATTACHMENT_MAX_FILES = 3
export const COMMUNICATION_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const COMMUNICATION_ATTACHMENT_ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/plain',
] as const

const COMMUNICATION_ATTACHMENT_ALLOWED_TYPE_SET = new Set<string>(COMMUNICATION_ATTACHMENT_ALLOWED_TYPES)
const FORBIDDEN_ATTACHMENT_KINDS = new Set(['ce_mercante_taxas', 'cobranca_demurrage'])
const BRASILIA_TIME_ZONE = 'America/Sao_Paulo'
export const CUSTOMER_PORTAL_BILLING_URL = 'https://portalfwlog.com.br/portal/billing'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function clean(value: string | null | undefined, fallback = '—'): string {
  const result = value?.trim()
  return result || fallback
}

function formatDateOnly(value: string): string {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value
  return `${match[3]}/${match[2]}/${match[1]}`
}

/** Formata timestamps de comunicados no fuso oficial da operação. */
export function formatCommunicationDateTime(value: string | null | undefined): string {
  if (!value?.trim()) return '—'
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${formatDateOnly(trimmed)} (horário de Brasília)`
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed

  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: BRASILIA_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.day}/${byType.month}/${byType.year} às ${byType.hour}:${byType.minute} (horário de Brasília)`
}

// Alias curto para callers da Edge Function e para manter o nome próximo ao
// helper legado de datas sem importar código específico do navegador.
export const formatDateTimeBRForCommunication = formatCommunicationDateTime

function assertCommunicationScope(input: CustomerCommunicationTemplateInput, kind: CustomerCommunicationKind): void {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) {
    throw new Error('Cliente inválido para o comunicado.')
  }
  if (!input.customerName.trim()) throw new Error('Nome do cliente ausente.')
  if (!input.vesselName.trim()) throw new Error('Navio ausente.')
  if (!input.voyageNumber.trim()) throw new Error('Viagem ausente.')
  if (!input.port.trim()) throw new Error('Porto ausente.')
  if (CUSTOMER_COMMUNICATION_MILESTONE_KINDS.includes(kind as typeof CUSTOMER_COMMUNICATION_MILESTONE_KINDS[number]) && !input.milestoneAt.trim()) {
    throw new Error('Data do marco operacional ausente.')
  }
  if (kind !== 'institucional' && !input.bls.length) throw new Error('O comunicado precisa de ao menos um B/L vinculado.')

  for (const bl of input.bls) {
    if (!bl.id.trim()) throw new Error('B/L inválido no comunicado.')
    if (bl.customerId !== input.customerId) {
      throw new Error('B/L de outro cliente não pode entrar no comunicado.')
    }
    if (kind === 'aviso_atracacao_nob') {
      const expectedTerminalIdentity = input.terminalStateId?.trim() || input.terminalId?.trim()
      const blTerminalIdentity = bl.terminalStateId?.trim() || bl.terminalId?.trim()
      if (blTerminalIdentity !== expectedTerminalIdentity) {
        throw new Error('B/L de outro terminal não pode entrar no NOB.')
      }
    }
  }

  if (kind === 'aviso_atracacao_nob') {
    if (!input.terminalId?.trim()) throw new Error('Identidade do terminal ausente para o NOB.')
    if (!input.terminalName?.trim()) throw new Error('Terminal ausente para o NOB.')
  }
}

const BRAND_NAVY = '#152238'
const BRAND_GOLD = '#d4882e'
const BRAND_INK = '#1f2937'
const BRAND_MUTED = '#6b7280'
const BRAND_BORDER = '#e5e7eb'
const BRAND_CARD_BG = '#ffffff'
const BRAND_PAGE_BG = '#f1f3f6'
const DEFAULT_PORTAL_BASE_URL = 'https://portalfwlog.com.br'

function extractBasePortalUrl(url?: string | null): string {
  const raw = url?.trim() || DEFAULT_PORTAL_BASE_URL
  return raw.replace(/\/+$/, '').replace(/\/billing$/, '')
}

function renderEmailTitleHtml(title: string): string {
  const parts = title.split(/\s*—\s*/)
  if (parts.length > 1) {
    const mainType = parts[0]?.trim() || ''
    const details = parts.slice(1).join(' — ').trim()
    return `<div style="margin:0 0 24px;text-align:center">
      <div style="font-size:20px;line-height:1.35;color:${BRAND_NAVY};font-weight:700;letter-spacing:-0.01em">${escapeHtml(mainType)}</div>
      <div style="margin-top:6px;font-size:14.5px;line-height:1.45;color:${BRAND_MUTED};font-weight:500">${escapeHtml(details)}</div>
    </div>`
  }
  return `<h1 style="margin:0 0 20px;font-size:20px;line-height:1.35;color:${BRAND_NAVY};font-weight:700;text-align:center">${escapeHtml(title)}</h1>`
}

function layout(title: string, bodyHtml: string, portalUrl?: string | null): string {
  const basePortalUrl = extractBasePortalUrl(portalUrl)
  const logoUrl = `${basePortalUrl}/branding/fwlog-logo-white.png`
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND_PAGE_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND_INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_PAGE_BG}">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${BRAND_CARD_BG};border:1px solid ${BRAND_BORDER};border-radius:12px;overflow:hidden">
          <tr>
            <td style="background:${BRAND_NAVY};padding:24px 32px">
              <img src="${logoUrl}" alt="Fwlog" height="28" style="height:28px;width:auto;display:block;border:0" />
            </td>
          </tr>
          <tr><td style="height:3px;line-height:3px;font-size:0;background:${BRAND_GOLD}">&nbsp;</td></tr>
          <tr>
            <td style="padding:32px 32px 16px">
              ${renderEmailTitleHtml(title)}
              <main style="line-height:1.6;color:${BRAND_INK};font-size:15px">
                ${bodyHtml}
              </main>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 24px">
              <table role="presentation" width="100%" style="border-collapse:collapse;border-top:1px solid ${BRAND_BORDER}">
                <tr>
                  <td style="padding-top:16px">
                    <p style="margin:0;font-size:12.5px;line-height:1.6;color:${BRAND_MUTED}">
                      Portal do Cliente — Fwlog. Dúvidas ou não reconhece esta mensagem? Fale com <a href="mailto:suporte@portalfwlog.com.br" style="color:${BRAND_NAVY};text-decoration:underline">suporte@portalfwlog.com.br</a>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function textLayout(title: string, body: string): string {
  return `Portal Fwlog\n${title}\n\n${body}\n\nPortal do Cliente — Fwlog. Dúvidas ou não reconhece esta mensagem? Fale com suporte@portalfwlog.com.br.`
}

function formatBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function assertCustomerFinanceScope(input: CustomerCommunicationTemplateInput): void {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) throw new Error('Cliente inválido para o comunicado.')
  if (!input.customerName.trim()) throw new Error('Nome do cliente ausente.')
  if (!input.vesselName.trim()) throw new Error('Navio ausente.')
  if (!input.voyageNumber.trim()) throw new Error('Viagem ausente.')
}

function customerPortalBillingUrl(input: CustomerCommunicationTemplateInput): string {
  return input.portalUrl?.trim() || CUSTOMER_PORTAL_BILLING_URL
}

export function renderCeMercanteTaxasTemplate(input: CustomerCommunicationTemplateInput): RenderedCustomerCommunication {
  assertCustomerFinanceScope(input)
  const rows = input.ceMercanteRows ?? []
  if (!rows.length) throw new Error('O resumo precisa de ao menos um CE Mercante.')
  if (rows.some((row) => !row.blId.trim() || !row.ceMercante.trim() || !Number.isFinite(row.totalBrl) || row.totalBrl < 0)) {
    throw new Error('B/L, CE Mercante e valor BRL são obrigatórios no resumo.')
  }

  const totalBrl = input.totalBrl ?? rows.reduce((sum, row) => sum + row.totalBrl, 0)
  if (!Number.isFinite(totalBrl) || totalBrl < 0) throw new Error('Total BRL inválido no resumo de taxas.')
  const vessel = clean(input.vesselName)
  const voyage = clean(input.voyageNumber)
  const customer = clean(input.customerName)
  const subject = `CE Mercante Disponível e Resumo de Taxas Locais — ${vessel} / ${voyage}`
  const portalUrl = customerPortalBillingUrl(input)
  const ceList = rows.map((row) => row.ceMercante.trim()).join(', ')
  const bodyText = [
    `Olá, ${customer}.`,
    '',
    `Os CEs Mercantes ${ceList} já estão disponíveis para agilizar o desembaraço e o registro da DI/DUIMP pelo despachante/importador.`,
    '',
    'Resumo da viagem:',
    ...rows.map((row) => `[${row.blId.trim()}] [${row.ceMercante.trim()}] [${formatBrl(row.totalBrl)}]`),
    `Total da viagem: ${formatBrl(totalBrl)}`,
    '',
    `Consulte as faturas e as formas de pagamento no Portal do Cliente: ${portalUrl}`,
  ].join('\n')
  const bodyHtml = [
    `<p style="margin:0 0 14px">Olá, ${escapeHtml(customer)}.</p>`,
    `<p style="margin:0 0 18px;padding:14px 16px;border-left:4px solid #0f766e;background:#ecfdf5;border-radius:4px;color:#134e4a;font-size:14px"><strong>CE Mercante disponível:</strong> ${escapeHtml(ceList)}. Os números estão prontos para agilizar o desembaraço e o registro da DI/DUIMP pelo despachante/importador.</p>`,
    '<p style="margin:0 0 8px;font-weight:600">Resumo da viagem</p>',
    `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;border:1px solid ${BRAND_BORDER};border-radius:6px;overflow:hidden"><thead><tr style="background:#f9fafb"><th style="text-align:left;padding:9px 12px;border-bottom:1px solid ${BRAND_BORDER};font-size:13px;color:${BRAND_MUTED}">B/L</th><th style="text-align:left;padding:9px 12px;border-bottom:1px solid ${BRAND_BORDER};font-size:13px;color:${BRAND_MUTED}">CE Mercante</th><th style="text-align:right;padding:9px 12px;border-bottom:1px solid ${BRAND_BORDER};font-size:13px;color:${BRAND_MUTED}">Valor BRL</th></tr></thead><tbody>`,
    ...rows.map((row) => `<tr><td style="padding:9px 12px;border-bottom:1px solid ${BRAND_BORDER};font-size:14px">${escapeHtml(row.blId.trim())}</td><td style="padding:9px 12px;border-bottom:1px solid ${BRAND_BORDER};font-size:14px"><strong>${escapeHtml(row.ceMercante.trim())}</strong></td><td style="padding:9px 12px;text-align:right;border-bottom:1px solid ${BRAND_BORDER};font-size:14px">${escapeHtml(formatBrl(row.totalBrl))}</td></tr>`),
    `</tbody><tfoot><tr style="background:#f9fafb"><td colspan="2" style="padding:10px 12px;font-weight:700">Total da viagem</td><td style="padding:10px 12px;text-align:right;font-weight:700;color:${BRAND_NAVY}">${escapeHtml(formatBrl(totalBrl))}</td></tr></tfoot></table>`,
    `<table role="presentation" width="100%" style="margin:16px 0 8px"><tr><td align="center"><a href="${escapeHtml(portalUrl)}" style="background:${BRAND_NAVY};color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-size:14px;font-weight:600">Consultar faturas e formas de pagamento no Portal do Cliente</a></td></tr></table>`,
  ].join('')
  const blIds = rows.map((row) => row.blId.trim())
  return {
    kind: 'ce_mercante_taxas',
    subject,
    html: layout(subject, bodyHtml, input.portalUrl),
    text: textLayout(subject, bodyText),
    customerId: input.customerId,
    blIds,
    terminalId: input.terminalId ?? null,
  }
}

export function renderDemurrageTemplate(input: CustomerCommunicationTemplateInput): RenderedCustomerCommunication {
  assertCustomerFinanceScope(input)
  if (!input.bls.length) throw new Error('A cobrança de Demurrage precisa de um B/L vinculado.')
  const data = input.demurrage ?? {
    docNumber: input.demurrageDocNumber ?? '',
    totalUsd: input.totalUsd ?? NaN,
    totalBrl: input.currentTotalBrl ?? NaN,
    roe: input.roe ?? NaN,
    roeReferenceDate: input.roeReferenceDate ?? '',
  }
  if (!data.docNumber.trim() || !Number.isFinite(data.totalUsd) || data.totalUsd <= 0 || !Number.isFinite(data.totalBrl) || data.totalBrl < 0 || !Number.isFinite(data.roe) || data.roe <= 0 || !data.roeReferenceDate.trim()) {
    throw new Error('Dados incompletos para a cobrança de Demurrage.')
  }
  const customer = clean(input.customerName)
  const vessel = clean(input.vesselName)
  const voyage = clean(input.voyageNumber)
  const subject = `Cobrança de Demurrage — ${data.docNumber.trim()} — ${vessel} / ${voyage}`
  const portalUrl = customerPortalBillingUrl(input)
  const referenceDate = formatDateOnly(data.roeReferenceDate.trim())
  const bodyText = [
    `Olá, ${customer}.`,
    '',
    `A cobrança de Demurrage ${data.docNumber.trim()} está disponível para o B/L ${input.bls[0]?.id.trim()}.`,
    `Valor da cobrança: ${formatUsd(data.totalUsd)}.`,
    `Valor informativo em reais: ${formatBrl(data.totalBrl)}, calculado pelo ROE ${data.roe.toFixed(4)} com referência em ${referenceDate}.`,
    'O valor em reais será recalculado no dia do pagamento.',
    '',
    `Consulte os detalhes no Portal do Cliente: ${portalUrl}`,
  ].join('\n')
  const bodyHtml = [
    `<p style="margin:0 0 14px">Olá, ${escapeHtml(customer)}.</p>`,
    `<p style="margin:0 0 16px">A cobrança de Demurrage <strong>${escapeHtml(data.docNumber.trim())}</strong> está disponível para o B/L <strong>${escapeHtml(input.bls[0]?.id.trim() ?? '')}</strong>.</p>`,
    `<table style="width:100%;border-collapse:collapse;margin:16px 0 20px;border:1px solid ${BRAND_BORDER};border-radius:6px;overflow:hidden">`,
    `<tr><td style="padding:10px 14px;border-bottom:1px solid ${BRAND_BORDER};color:${BRAND_MUTED};width:42%;font-size:13.5px">Valor da cobrança</td><td style="padding:10px 14px;border-bottom:1px solid ${BRAND_BORDER};font-weight:700;color:${BRAND_NAVY};font-size:16px">${escapeHtml(formatUsd(data.totalUsd))}</td></tr>`,
    `<tr><td style="padding:10px 14px;border-bottom:1px solid ${BRAND_BORDER};color:${BRAND_MUTED};font-size:13.5px">Valor informativo em reais</td><td style="padding:10px 14px;border-bottom:1px solid ${BRAND_BORDER};font-weight:600;color:${BRAND_GOLD};font-size:15px">${escapeHtml(formatBrl(data.totalBrl))}</td></tr>`,
    `<tr><td style="padding:10px 14px;color:${BRAND_MUTED};font-size:13.5px">Cotação (ROE)</td><td style="padding:10px 14px;color:${BRAND_INK};font-size:14px">ROE ${escapeHtml(data.roe.toFixed(4))}, referência ${escapeHtml(referenceDate)}</td></tr>`,
    '</table>',
    `<p style="margin:0 0 20px;font-size:13px;color:${BRAND_MUTED}"><strong>Observação:</strong> O valor em reais será recalculado no dia do pagamento.</p>`,
    `<table role="presentation" width="100%" style="margin:16px 0 8px"><tr><td align="center"><a href="${escapeHtml(portalUrl)}" style="background:${BRAND_NAVY};color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-size:14px;font-weight:600">Consultar detalhes no Portal do Cliente</a></td></tr></table>`,
  ].join('')
  return {
    kind: 'cobranca_demurrage',
    subject,
    html: layout(subject, bodyHtml, input.portalUrl),
    text: textLayout(subject, bodyText),
    customerId: input.customerId,
    blIds: input.bls.map((bl) => bl.id.trim()),
    terminalId: input.terminalId ?? null,
  }
}

function renderMilestoneContent(
  input: CustomerCommunicationTemplateInput,
  kind: CustomerCommunicationKind,
  title: string,
  sentenceHtml: string,
  sentenceText: string,
): RenderedCustomerCommunication {
  const blIds = input.bls.map((bl) => bl.id.trim())
  const customer = clean(input.customerName)
  const bodyText = `Olá, ${customer}.\n\n${sentenceText}\n\nB/Ls relacionados: ${blIds.join(', ')}.`
  const bodyHtml = `<p style="margin:0 0 14px">Olá, ${escapeHtml(customer)}.</p><p style="margin:0 0 16px">${sentenceHtml}</p><p style="margin:0 0 8px;font-size:13.5px;color:${BRAND_MUTED}"><strong>B/Ls relacionados:</strong> <span style="color:${BRAND_INK}">${blIds.map(escapeHtml).join(', ')}</span></p>`
  return {
    kind,
    subject: title,
    html: layout(title, bodyHtml, input.portalUrl),
    text: textLayout(title, bodyText),
    customerId: input.customerId,
    blIds,
    terminalId: input.terminalId ?? null,
  }
}

export function renderNoaTemplate(input: CustomerCommunicationTemplateInput): RenderedCustomerCommunication {
  assertCommunicationScope(input, 'aviso_chegada_noa')
  const port = clean(input.port)
  const vessel = clean(input.vesselName)
  const voyage = clean(input.voyageNumber)
  const milestone = formatCommunicationDateTime(input.milestoneAt)
  const subject = `Notice of Arrival / Chegada Próxima — ${vessel} / ${voyage} — Porto de ${port}`
  return renderMilestoneContent(
    input,
    'aviso_chegada_noa',
    subject,
    `O navio <strong>${escapeHtml(vessel)}</strong>, viagem <strong>${escapeHtml(voyage)}</strong>, tem chegada prevista para <strong>${escapeHtml(milestone)}</strong> no Porto de ${escapeHtml(port)}.`,
    `O navio ${vessel}, viagem ${voyage}, tem chegada prevista para ${milestone} no Porto de ${port}.`,
  )
}

export function renderNorTemplate(input: CustomerCommunicationTemplateInput): RenderedCustomerCommunication {
  assertCommunicationScope(input, 'aviso_prontidao_nor')
  const port = clean(input.port)
  const vessel = clean(input.vesselName)
  const voyage = clean(input.voyageNumber)
  const milestone = formatCommunicationDateTime(input.milestoneAt)
  const subject = `Notice of Readiness / Aviso de Chegada — ${vessel} / ${voyage} — Porto de ${port}`
  const sentenceHtml = `Registramos a chegada do navio <strong>${escapeHtml(vessel)}</strong>, viagem <strong>${escapeHtml(voyage)}</strong>, em <strong>${escapeHtml(milestone)}</strong> no Porto de ${escapeHtml(port)}.`
  const sentenceText = `Registramos a chegada do navio ${vessel}, viagem ${voyage}, em ${milestone} no Porto de ${port}.`
  return renderMilestoneContent(input, 'aviso_prontidao_nor', subject, sentenceHtml, sentenceText)
}

export function renderNobTemplate(input: CustomerCommunicationTemplateInput): RenderedCustomerCommunication {
  assertCommunicationScope(input, 'aviso_atracacao_nob')
  const port = clean(input.port)
  const vessel = clean(input.vesselName)
  const voyage = clean(input.voyageNumber)
  const terminal = clean(input.terminalName)
  const milestone = formatCommunicationDateTime(input.milestoneAt)
  const subject = `Notice of Berthing / Aviso de Atracação — ${vessel} / ${voyage} — Porto de ${port} (${terminal})`
  const sentenceHtml = `O navio <strong>${escapeHtml(vessel)}</strong>, viagem <strong>${escapeHtml(voyage)}</strong>, atracou em <strong>${escapeHtml(milestone)}</strong> no terminal ${escapeHtml(terminal)}, Porto de ${escapeHtml(port)}.`
  const sentenceText = `O navio ${vessel}, viagem ${voyage}, atracou em ${milestone} no terminal ${terminal}, Porto de ${port}.`
  return renderMilestoneContent(input, 'aviso_atracacao_nob', subject, sentenceHtml, sentenceText)
}

export function renderInstitutionalTemplate(input: CustomerCommunicationTemplateInput, kind: 'institucional' | 'livre' = 'institucional'): RenderedCustomerCommunication {
  if (kind === 'livre') assertCommunicationScope(input, kind)
  else {
    if (!Number.isInteger(input.customerId) || input.customerId <= 0) throw new Error('Cliente inválido para o comunicado.')
    if (!input.customerName.trim()) throw new Error('Nome do cliente ausente.')
  }
  if (kind === 'institucional' && input.bls.length) throw new Error('Comunicado institucional não pode conter B/Ls.')
  const subject = clean(input.subject, 'Comunicado Transhipping Desk')
  const body = clean(input.body, '')
  const safeBodyHtml = escapeHtml(body).replace(/\n/g, '<br>')
  const bodyText = `Olá, ${clean(input.customerName)}.\n\n${body}`
  return {
    kind,
    subject,
    html: layout(subject, `<p style="margin:0 0 14px">Olá, ${escapeHtml(clean(input.customerName))}.</p><p style="margin:0">${safeBodyHtml}</p>`, input.portalUrl),
    text: textLayout(subject, bodyText),
    customerId: input.customerId,
    blIds: input.bls.map((bl) => bl.id.trim()),
    terminalId: input.terminalId ?? null,
  }
}

export function renderCustomerCommunicationTemplate(
  kind: CustomerCommunicationKind,
  input: CustomerCommunicationTemplateInput,
): RenderedCustomerCommunication {
  switch (kind) {
    case 'aviso_chegada_noa': return renderNoaTemplate(input)
    case 'aviso_prontidao_nor': return renderNorTemplate(input)
    case 'aviso_atracacao_nob': return renderNobTemplate(input)
    case 'ce_mercante_taxas': return renderCeMercanteTaxasTemplate(input)
    case 'cobranca_demurrage': return renderDemurrageTemplate(input)
    case 'institucional': return renderInstitutionalTemplate(input, 'institucional')
    case 'livre': return renderInstitutionalTemplate(input, 'livre')
  }
}

export const renderNoa = renderNoaTemplate
export const renderNor = renderNorTemplate
export const renderNob = renderNobTemplate

export function validateCommunicationAttachments(
  kind: string,
  attachments: readonly CommunicationAttachment[] | null | undefined,
): AttachmentValidationResult {
  const files = attachments ?? []
  const errors: string[] = []
  const totalBytes = files.reduce((sum, file) => sum + (Number.isFinite(file.size) ? Math.max(0, file.size) : 0), 0)

  if (FORBIDDEN_ATTACHMENT_KINDS.has(kind) && files.length > 0) {
    errors.push('Anexos não são permitidos para cobrança local ou cobrança de demurrage.')
  }
  if (files.length > COMMUNICATION_ATTACHMENT_MAX_FILES) {
    errors.push(`O limite é de ${COMMUNICATION_ATTACHMENT_MAX_FILES} anexos por comunicado.`)
  }
  if (totalBytes > COMMUNICATION_ATTACHMENT_MAX_BYTES) {
    errors.push('O tamanho total dos anexos não pode ultrapassar 10 MB.')
  }

  files.forEach((file, index) => {
    if (!file.filename.trim()) errors.push(`O anexo ${index + 1} precisa de nome.`)
    if (!COMMUNICATION_ATTACHMENT_ALLOWED_TYPE_SET.has(file.contentType.toLowerCase())) {
      errors.push(`Tipo não permitido no anexo ${index + 1}: ${file.contentType || 'ausente'}.`)
    }
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > COMMUNICATION_ATTACHMENT_MAX_BYTES) {
      errors.push(`Tamanho inválido no anexo ${index + 1}.`)
    }
  })

  return { valid: errors.length === 0, totalBytes, errors }
}

export function assertValidCommunicationAttachments(
  kind: string,
  attachments: readonly CommunicationAttachment[] | null | undefined,
): void {
  const result = validateCommunicationAttachments(kind, attachments)
  if (!result.valid) throw new Error(result.errors.join(' '))
}

export const validateAttachments = validateCommunicationAttachments
