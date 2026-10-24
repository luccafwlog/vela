import {
  emailFacts,
  emailFooter,
  emailKit,
  emailLead,
  emailMono,
  emailNote,
  emailParagraph,
  emailStack,
  escapeHtml,
  renderEmailLayout,
  renderEmailText,
} from './emailLayout.ts'
import { portalPageUrl } from '../config/portalUrl.ts'

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
export const CUSTOMER_PORTAL_BILLING_URL = portalPageUrl('billing')

function clean(value: string | null | undefined, fallback = '—'): string {
  const result = value?.trim()
  return result || fallback
}

/**
 * Troca quebras de linha por espaço. Assunto e nome de anexo escritos pela
 * pessoa vão a cabeçalhos do e-mail no provedor; CR/LF ali abriria um cabeçalho
 * novo (auditoria run-3).
 */
export function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ')
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

/**
 * Só a data, no fuso oficial da operação. O NOA promete uma chegada prevista
 * (ETA) e o horário estimado muda até a véspera: o e-mail mostra só o dia,
 * sem "às HH:MM" nem "(horário de Brasília)". NOR e NOB continuam com a hora.
 */
export function formatCommunicationDate(value: string | null | undefined): string {
  if (!value?.trim()) return '—'
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return formatDateOnly(trimmed)

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed

  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: BRASILIA_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(parsed)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.day}/${byType.month}/${byType.year}`
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

/**
 * Endereço do rodapé dos Comunicados (D20): o mesmo do reply-to
 * (`COMMUNICATIONS_REPLY_TO`), para a resposta e a dúvida chegarem à mesma caixa.
 */
export const COMMUNICATIONS_CONTACT_EMAIL = 'importacao@fwlog.com.br'
/**
 * Endereço do rodapé da Cobrança de Demurrage (lote 6b): a equipe de
 * equipamentos. A resposta vai para `DEMURRAGE_REPLY_TO`.
 */
export const DEMURRAGE_CONTACT_EMAIL = 'eqp@fwlog.com.br'

const kit = emailKit('portal')

type RenderedBody = { html: string; text: string[] }

function renderMail(input: {
  title: string
  subtitle?: string | null
  body: RenderedBody
  portalUrl?: string | null
  contactEmail: string
}): { html: string; text: string } {
  const footer = emailFooter(input.contactEmail)
  return {
    html: renderEmailLayout({ siteUrl: input.portalUrl, title: input.title, subtitle: input.subtitle, body: input.body.html, footer: footer.html }),
    text: renderEmailText({ title: input.title, subtitle: input.subtitle, body: input.body.text.join('\n'), footer: footer.text }),
  }
}

function hello(customer: string): RenderedBody {
  return { html: emailParagraph(`Olá, ${escapeHtml(customer)}.`), text: [`Olá, ${customer}.`, ''] }
}

function formatBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

/** Dólar sempre como "US$ 1.840,00" (pt-BR), no HTML e no texto puro. */
export function formatUsdBr(value: number): string {
  return `US$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`
}

/** ROE com quatro casas e vírgula decimal ("5,4600"). */
export function formatRoeBr(value: number): string {
  return value.toFixed(4).replace('.', ',')
}

function assertCustomerFinanceScope(input: CustomerCommunicationTemplateInput): void {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) throw new Error('Cliente inválido para o comunicado.')
  if (!input.customerName.trim()) throw new Error('Nome do cliente ausente.')
  if (!input.vesselName.trim()) throw new Error('Navio ausente.')
  if (!input.voyageNumber.trim()) throw new Error('Viagem ausente.')
}

// O botão das faturas passa sempre pela configuração única (ponto 4 de
// 2026-10-23): um endereço do portal antigo vira o Portal atual.
function customerPortalBillingUrl(input: { portalUrl?: string | null }): string {
  return portalPageUrl('billing', input.portalUrl)
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
  const port = input.port?.trim() ?? ''
  const customer = clean(input.customerName)
  const title = 'CE Mercante e Taxas Locais disponíveis'
  const subject = `${title} — ${vessel} / ${voyage}${port ? ` — Porto de ${port}` : ''}`
  const subtitle = `${vessel} / ${voyage}${port ? ` · Porto de ${port}` : ''}`
  const portalUrl = customerPortalBillingUrl(input)
  const sentence = 'Os CEs Mercantes abaixo já podem ser consultados no sistema Mercante, e as Taxas Locais da viagem podem ser pagas no Portal do Cliente.'
  const greeting = hello(customer)
  const body: RenderedBody = {
    html: greeting.html
      + emailParagraph(escapeHtml(sentence))
      + kit.block('CE Mercante e Taxas Locais', emailStack(rows.map((row) => [
        emailMono(row.ceMercante.trim()),
        `B/L ${escapeHtml(row.blId.trim())}`,
        escapeHtml(formatBrl(row.totalBrl)),
        '',
      ])) + kit.totalRow('Total da viagem', escapeHtml(formatBrl(totalBrl))), { flush: true })
      + kit.button('Ver faturas e formas de pagamento', portalUrl),
    text: [
      ...greeting.text,
      sentence,
      '',
      'CE Mercante e Taxas Locais:',
      ...rows.map((row) => `- CE ${row.ceMercante.trim()} (B/L ${row.blId.trim()}): ${formatBrl(row.totalBrl)}`),
      `Total da viagem: ${formatBrl(totalBrl)}`,
      '',
      `Ver faturas e formas de pagamento: ${portalUrl}`,
    ],
  }
  const mail = renderMail({ title, subtitle, body, portalUrl: input.portalUrl, contactEmail: COMMUNICATIONS_CONTACT_EMAIL })
  return {
    kind: 'ce_mercante_taxas',
    subject,
    ...mail,
    customerId: input.customerId,
    blIds: rows.map((row) => row.blId.trim()),
    terminalId: input.terminalId ?? null,
  }
}

type DemurrageInvoiceView = {
  docNumber: string
  blId: string
  vessel: string
  voyage: string
  usd: string
  brl: string
  roe: string
  date: string
}

/** Cobrança de uma Invoice: dado principal em US$, pares e a nota do recálculo. */
function renderDemurrageSingle(customer: string, line: DemurrageInvoiceView, portalUrlInput?: string | null): { subject: string; html: string; text: string } {
  const portalUrl = customerPortalBillingUrl({ portalUrl: portalUrlInput })
  const subject = `Cobrança de Demurrage — ${line.docNumber} — ${line.vessel} / ${line.voyage}`
  const subtitle = `${line.docNumber} · ${line.vessel} / ${line.voyage}`
  const sentence = 'A cobrança de Demurrage abaixo está disponível no Portal do Cliente.'
  const recalc = 'O valor em reais é recalculado no dia do pagamento.'
  const roe = `${line.roe} em ${line.date}`
  const greeting = hello(customer)
  const body: RenderedBody = {
    html: greeting.html
      + emailParagraph(escapeHtml(sentence))
      + kit.block(`Invoice ${line.docNumber}`, emailLead(escapeHtml(line.usd), 'valor da cobrança') + emailFacts([
        ['B/L', escapeHtml(line.blId)],
        ['Navio / Viagem', escapeHtml(`${line.vessel} / ${line.voyage}`)],
        ['Em reais (informativo)', escapeHtml(line.brl)],
        ['ROE', escapeHtml(roe)],
      ]))
      + emailNote(escapeHtml(recalc))
      + kit.button('Ver a cobrança no Portal', portalUrl),
    text: [
      ...greeting.text,
      sentence,
      '',
      `Invoice ${line.docNumber}: ${line.usd} (valor da cobrança)`,
      `B/L: ${line.blId}`,
      `Navio / Viagem: ${line.vessel} / ${line.voyage}`,
      `Em reais (informativo): ${line.brl}`,
      `ROE: ${roe}`,
      '',
      recalc,
      '',
      `Ver a cobrança no Portal: ${portalUrl}`,
    ],
  }
  return { subject, ...renderMail({ title: 'Cobrança de Demurrage', subtitle, body, portalUrl: portalUrlInput, contactEmail: DEMURRAGE_CONTACT_EMAIL }) }
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
  const mail = renderDemurrageSingle(clean(input.customerName), {
    docNumber: data.docNumber.trim(),
    blId: input.bls[0]?.id.trim() ?? '',
    vessel: clean(input.vesselName),
    voyage: clean(input.voyageNumber),
    usd: formatUsdBr(data.totalUsd),
    brl: formatBrl(data.totalBrl),
    roe: formatRoeBr(data.roe),
    date: formatDateOnly(data.roeReferenceDate.trim()),
  }, input.portalUrl)
  return {
    kind: 'cobranca_demurrage',
    ...mail,
    customerId: input.customerId,
    blIds: input.bls.map((bl) => bl.id.trim()),
    terminalId: input.terminalId ?? null,
  }
}

export type DemurrageGroupLine = {
  docNumber: string
  blId: string
  vesselName: string
  voyageNumber: string
  /** USD líquido do desconto. */
  totalUsd: number
  totalBrl: number
  roe: number
  /** Data da cotação do ROE (AAAA-MM-DD). */
  roeReferenceDate: string
}

export type DemurrageGroupTemplateInput = {
  customerId: number
  customerName: string
  lines: readonly DemurrageGroupLine[]
  portalUrl?: string | null
}

/**
 * O que falta numa linha da cobrança para ela entrar no e-mail, ou null. A
 * Régua confere linha a linha antes de compor (a Invoice incompleta sai do
 * grupo e as demais seguem); o modelo recusa a linha incompleta que chegar.
 */
export function demurrageGroupLineMissing(line: DemurrageGroupLine): string | null {
  const missing: string[] = []
  if (!line.docNumber.trim()) missing.push('número da Invoice')
  if (!line.blId.trim()) missing.push('B/L')
  if (!line.vesselName.trim()) missing.push('navio')
  if (!line.voyageNumber.trim()) missing.push('viagem')
  if (!Number.isFinite(line.totalUsd) || line.totalUsd <= 0) missing.push('valor líquido em USD')
  if (!Number.isFinite(line.totalBrl) || line.totalBrl < 0) missing.push('valor em reais')
  if (!Number.isFinite(line.roe) || line.roe <= 0) missing.push('ROE')
  if (!line.roeReferenceDate.trim()) missing.push('data do ROE')
  return missing.length ? missing.join(', ') : null
}

function joinPt(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

/**
 * Cobrança agrupada da Régua (plano dos e-mails, 4.1; D8): um e-mail por
 * Cliente e etapa, cada Invoice na sua linha da lista (Invoice e B/L à
 * esquerda; US$ e o informativo em reais à direita), sem soma, e a nota do
 * ROE e do recálculo. Navio / Viagem vai na faixa do bloco quando é o mesmo
 * para todas; senão, na linha de cada Invoice. Uma linha só sai como a
 * cobrança de uma Invoice.
 */
export function renderDemurrageGroupTemplate(input: DemurrageGroupTemplateInput): RenderedCustomerCommunication {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) throw new Error('Cliente inválido para o comunicado.')
  if (!input.customerName.trim()) throw new Error('Nome do cliente ausente.')
  if (!input.lines.length) throw new Error('A cobrança de Demurrage precisa de ao menos uma Invoice.')
  for (const line of input.lines) {
    if (demurrageGroupLineMissing(line)) throw new Error('Dados incompletos para a cobrança de Demurrage.')
  }
  const lines: DemurrageInvoiceView[] = input.lines.map((line) => ({
    docNumber: line.docNumber.trim(),
    blId: line.blId.trim(),
    vessel: line.vesselName.trim(),
    voyage: line.voyageNumber.trim(),
    usd: formatUsdBr(line.totalUsd),
    brl: formatBrl(line.totalBrl),
    roe: formatRoeBr(line.roe),
    date: formatDateOnly(line.roeReferenceDate.trim()),
  }))
  const customer = clean(input.customerName)
  const blIds = lines.map((line) => line.blId)
  if (lines.length === 1) {
    return { kind: 'cobranca_demurrage', ...renderDemurrageSingle(customer, lines[0]!, input.portalUrl), customerId: input.customerId, blIds, terminalId: null }
  }

  const count = lines.length
  const portalUrl = customerPortalBillingUrl(input)
  const subject = `Cobrança de Demurrage — ${count} Invoices`
  const subtitle = `${count} Invoices`
  const sentence = `Há ${count} cobranças de Demurrage disponíveis. Os valores são por Invoice, sem soma.`
  const voyageOf = (line: DemurrageInvoiceView) => `${line.vessel} / ${line.voyage}`
  const sameVoyage = new Set(lines.map(voyageOf)).size === 1
  const roes = [...new Set(lines.map((line) => `${line.roe} de ${line.date}`))]
  const roeNote = roes.length === 1
    ? `Em reais pelo ROE ${roes[0]}, só para informação: o valor em reais é recalculado no dia do pagamento.`
    : `Em reais pelos ROEs ${joinPt(roes)}, só para informação: o valor em reais é recalculado no dia do pagamento.`
  const greeting = hello(customer)
  const body: RenderedBody = {
    html: greeting.html
      + emailParagraph(escapeHtml(sentence))
      + kit.block('Invoices', emailStack(lines.map((line) => [
        escapeHtml(line.docNumber),
        escapeHtml(`B/L ${line.blId}${sameVoyage ? '' : ` · ${voyageOf(line)}`}`),
        escapeHtml(line.usd),
        escapeHtml(line.brl),
      ])), { flush: true, aside: sameVoyage ? escapeHtml(voyageOf(lines[0]!)) : undefined })
      + emailNote(escapeHtml(roeNote))
      + kit.button('Ver as cobranças no Portal', portalUrl),
    text: [
      ...greeting.text,
      sentence,
      '',
      `Invoices${sameVoyage ? ` (${voyageOf(lines[0]!)})` : ''}:`,
      ...lines.map((line) => `- ${line.docNumber}, B/L ${line.blId}${sameVoyage ? '' : `, ${voyageOf(line)}`}: ${line.usd} (${line.brl})`),
      '',
      roeNote,
      '',
      `Ver as cobranças no Portal: ${portalUrl}`,
    ],
  }
  return {
    kind: 'cobranca_demurrage',
    subject,
    ...renderMail({ title: 'Cobrança de Demurrage', subtitle, body, portalUrl: input.portalUrl, contactEmail: DEMURRAGE_CONTACT_EMAIL }),
    customerId: input.customerId,
    blIds,
    terminalId: null,
  }
}

/**
 * Data e hora do marco: valor em destaque e "horário de Brasília" embaixo.
 * `dateOnly` (NOA) mostra só a data, sem o detalhe de fuso.
 */
function milestoneParts(value: string, dateOnly = false): { value: string; detail: string } {
  if (dateOnly) return { value: formatCommunicationDate(value), detail: '' }
  const formatted = formatCommunicationDateTime(value)
  const suffix = ' (horário de Brasília)'
  return formatted.endsWith(suffix)
    ? { value: formatted.slice(0, -suffix.length), detail: 'horário de Brasília' }
    : { value: formatted, detail: '' }
}

function renderMilestoneContent(
  input: CustomerCommunicationTemplateInput,
  kind: CustomerCommunicationKind,
  subject: string,
  title: string,
  sentence: string,
  blockTitle: string,
  place: readonly [string, string],
  dateOnly = false,
): RenderedCustomerCommunication {
  const blIds = input.bls.map((bl) => bl.id.trim())
  const customer = clean(input.customerName)
  const vesselVoyage = `${clean(input.vesselName)} / ${clean(input.voyageNumber)}`
  const when = milestoneParts(input.milestoneAt, dateOnly)
  const greeting = hello(customer)
  const body: RenderedBody = {
    html: greeting.html
      + emailParagraph(escapeHtml(sentence))
      + kit.block(blockTitle, emailLead(escapeHtml(when.value), escapeHtml(when.detail)) + emailFacts([
        ['Navio / Viagem', escapeHtml(vesselVoyage)],
        [place[0], escapeHtml(place[1])],
        ['B/Ls', escapeHtml(blIds.join(', '))],
      ])),
    text: [
      ...greeting.text,
      sentence,
      '',
      `${blockTitle}: ${when.value}${when.detail ? ` (${when.detail})` : ''}`,
      `Navio / Viagem: ${vesselVoyage}`,
      `${place[0]}: ${place[1]}`,
      `B/Ls: ${blIds.join(', ')}`,
    ],
  }
  return {
    kind,
    subject,
    ...renderMail({ title, body, portalUrl: input.portalUrl, contactEmail: COMMUNICATIONS_CONTACT_EMAIL }),
    customerId: input.customerId,
    blIds,
    terminalId: input.terminalId ?? null,
  }
}

export function renderNoaTemplate(input: CustomerCommunicationTemplateInput): RenderedCustomerCommunication {
  assertCommunicationScope(input, 'aviso_chegada_noa')
  const port = clean(input.port)
  const title = 'Notice of Arrival / Chegada Próxima'
  const subject = `${title} — ${clean(input.vesselName)} / ${clean(input.voyageNumber)} — Porto de ${port}`
  return renderMilestoneContent(input, 'aviso_chegada_noa', subject, title, 'A chegada do seu navio está prevista conforme abaixo.', 'Chegada prevista', ['Porto', port], true)
}

export function renderNorTemplate(input: CustomerCommunicationTemplateInput): RenderedCustomerCommunication {
  assertCommunicationScope(input, 'aviso_prontidao_nor')
  const port = clean(input.port)
  const title = 'Notice of Readiness / Aviso de Chegada'
  const subject = `${title} — ${clean(input.vesselName)} / ${clean(input.voyageNumber)} — Porto de ${port}`
  return renderMilestoneContent(input, 'aviso_prontidao_nor', subject, title, 'Registramos a chegada do seu navio conforme abaixo.', 'Chegada registrada', ['Porto', port])
}

export function renderNobTemplate(input: CustomerCommunicationTemplateInput): RenderedCustomerCommunication {
  assertCommunicationScope(input, 'aviso_atracacao_nob')
  const port = clean(input.port)
  const terminal = clean(input.terminalName)
  const title = 'Notice of Berthing / Aviso de Atracação'
  const subject = `${title} — ${clean(input.vesselName)} / ${clean(input.voyageNumber)} — Porto de ${port} (${terminal})`
  return renderMilestoneContent(input, 'aviso_atracacao_nob', subject, title, 'O seu navio atracou conforme abaixo.', 'Atracação', ['Terminal', `${terminal}, Porto de ${port}`])
}

function renderCargoBlock(input: CustomerCommunicationTemplateInput): RenderedBody {
  const vesselVoyage = `${clean(input.vesselName)} / ${clean(input.voyageNumber)}`
  const blIds = input.bls.map((bl) => bl.id.trim())
  return {
    html: kit.block('Sua carga', emailFacts([
      ['Navio / Viagem', escapeHtml(vesselVoyage)],
      ['B/Ls', escapeHtml(blIds.join(', '))],
    ])),
    text: ['Sua carga', `Navio / Viagem: ${vesselVoyage}`, `B/Ls: ${blIds.join(', ')}`],
  }
}

export function renderInstitutionalTemplate(input: CustomerCommunicationTemplateInput, kind: 'institucional' | 'livre' = 'institucional'): RenderedCustomerCommunication {
  if (kind === 'livre') assertCommunicationScope(input, kind)
  else {
    if (!Number.isInteger(input.customerId) || input.customerId <= 0) throw new Error('Cliente inválido para o comunicado.')
    if (!input.customerName.trim()) throw new Error('Nome do cliente ausente.')
  }
  if (kind === 'institucional' && input.bls.length) throw new Error('Comunicado institucional não pode conter B/Ls.')
  const subject = clean(singleLine(input.subject ?? ''), 'Comunicado Fwlog')
  const text = clean(input.body, '')
  // D15: o livre leva os dados da carga do Cliente — Navio / Viagem e B/Ls —, que
  // a tela promete ("os dados da carga de cada cliente são acrescentados").
  const cargo = kind === 'livre' ? renderCargoBlock(input) : null
  const greeting = hello(clean(input.customerName))
  const body: RenderedBody = {
    html: greeting.html + emailParagraph(escapeHtml(text).replace(/\n/g, '<br>')) + (cargo?.html ?? ''),
    text: [...greeting.text, text, ...(cargo ? ['', ...cargo.text] : [])],
  }
  return {
    kind,
    subject,
    ...renderMail({ title: subject, body, portalUrl: input.portalUrl, contactEmail: COMMUNICATIONS_CONTACT_EMAIL }),
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
