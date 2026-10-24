import { PORTAL_ORIGIN, portalContactEmail, portalOrigin } from '../config/portalUrl.ts'
// Base única dos e-mails (lote 6b): o layout e as peças que todos os modelos
// usam, do Portal do Cliente (convite, recuperação, avisos, Comunicados) ao
// Resumo diário do Vela. Módulo puro, sem React nem Supabase: as Edge Functions
// importam este arquivo pelo caminho relativo, como fazem com
// `customerCommunicationTemplates.ts`.
//
// HTML de e-mail: tabelas, estilo escrito no elemento e fonte do sistema.
// Nada abaixo de 12px, sem caixa alta em rótulo, códigos em monoespaçada,
// largura 600 fluida, título e botão centralizados.

export type EmailBrand = 'portal' | 'vela'

type BrandColors = { navy: string; strip: string; button: string; link: string }

export const EMAIL_BRANDS: Record<EmailBrand, BrandColors> = {
  portal: { navy: '#0d2b5e', strip: '#edf3fa', button: '#1d67b3', link: '#1a5aa0' },
  vela: { navy: '#152238', strip: '#eef2f7', button: '#1d4d88', link: '#1d4d88' },
}

export const EMAIL_COLORS = {
  text: '#121822',
  muted: '#4f5868',
  border: '#c3cad5',
  soft: '#e2e6ec',
  page: '#f6f7f9',
  warn: '#8f4d08',
} as const

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
const { text: TEXT, muted: MUTED, border: BORDER, soft: SOFT, page: PAGE, warn: WARN } = EMAIL_COLORS

export const DEFAULT_EMAIL_ORIGIN = PORTAL_ORIGIN

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

/**
 * Origem do site, onde fica `/branding`. Os envios passam endereços do Portal
 * (`…/portal/billing`); `/portal/branding/…` cai na página do Portal e a logo
 * chegava quebrada no e-mail.
 */
export function emailOrigin(url?: string | null): string {
  // Configuração única (ponto 4 de 2026-10-23): o domínio do portal antigo vira o atual.
  return portalOrigin(url)
}

/** Parágrafo do corpo. Recebe HTML já escapado. */
export const emailParagraph = (html: string): string =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${TEXT}">${html}</p>`

/** Nota de apoio (13px, cinza). Recebe HTML já escapado. */
export const emailNote = (html: string): string =>
  `<p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:${MUTED}">${html}</p>`

/** Código (CE, CNPJ, e-mail mascarado) em monoespaçada. Escapa o valor. */
export const emailMono = (value: string): string =>
  `<span style="font-family:${MONO};font-size:0.95em">${escapeHtml(value)}</span>`

/** Número em âmbar e negrito quando pede ação (> 0). */
export const emailWarnNumber = (value: number): string =>
  (value > 0 ? `<span style="color:${WARN};font-weight:700">${value}</span>` : String(value))

/** Dado principal do bloco: valor em destaque e detalhe cinza embaixo. HTML já escapado. */
export const emailLead = (valueHtml: string, detailHtml = ''): string =>
  `<div style="font-size:18px;line-height:24px;font-weight:700;color:${TEXT}">${valueHtml}</div>${detailHtml ? `<div style="margin-top:2px;font-size:13px;line-height:18px;color:${MUTED}">${detailHtml}</div>` : ''}`

/** Pares rótulo/valor em colunas. Rótulo é texto; valor é HTML já escapado. */
export function emailFacts(pairs: ReadonlyArray<readonly [string, string]>, cols = 2): string {
  const rows: Array<ReadonlyArray<readonly [string, string]>> = []
  for (let index = 0; index < pairs.length; index += cols) rows.push(pairs.slice(index, index + cols))
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${rows.map((row) => `<tr>${row.map(([label, value]) => `<td valign="top" width="${Math.floor(100 / cols)}%" style="padding:0 12px 10px 0"><div style="font-size:12px;line-height:16px;color:${MUTED}">${escapeHtml(label)}</div><div style="font-size:14px;line-height:20px;color:${TEXT};font-weight:500">${value}</div></td>`).join('')}</tr>`).join('')}</table>`
}

/** Linha da lista empilhada: esquerda (valor + linha cinza) e direita (valor + linha cinza). HTML já escapado. */
export type EmailStackRow = readonly [left: string, leftSub: string, right: string, rightSub: string]

export function emailStack(rows: readonly EmailStackRow[]): string {
  return rows.map(([left, leftSub, right, rightSub], index) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${index ? `border-top:1px solid ${SOFT};` : ''}"><tr>
    <td valign="top" style="padding:10px 16px"><div style="font-size:14px;font-weight:700;color:${TEXT}">${left}</div>${leftSub ? `<div style="font-size:13px;color:${MUTED}">${leftSub}</div>` : ''}</td>
    <td valign="top" align="right" style="padding:10px 16px;white-space:nowrap"><div style="font-size:14px;font-weight:700;color:${TEXT}">${right}</div>${rightSub ? `<div style="font-size:13px;color:${MUTED}">${rightSub}</div>` : ''}</td>
  </tr></table>`).join('')
}

/** Peças que dependem da marca (faixa do bloco, cabeçalho de tabela, botão). */
export function emailKit(brand: EmailBrand) {
  const colors = EMAIL_BRANDS[brand]
  return {
    colors,
    /** Bloco com título em faixa. `flush`: sem padding (lista empilhada ou tabela). `aside` é HTML já escapado. */
    block(title: string, body: string, options: { aside?: string; flush?: boolean } = {}): string {
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-collapse:separate;border:1px solid ${BORDER};border-radius:8px;background:#ffffff">
  <tr><td style="background:${colors.strip};border-bottom:1px solid ${SOFT};border-radius:8px 8px 0 0;padding:9px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:14px;font-weight:700;color:${colors.navy}">${escapeHtml(title)}</td>
      ${options.aside ? `<td align="right" style="font-size:13px;color:${MUTED}">${options.aside}</td>` : ''}
    </tr></table>
  </td></tr>
  <tr><td style="padding:${options.flush ? '0' : '14px 16px 16px'}">${body}</td></tr>
</table>`
    },
    /** Tabela simples (cabeçalho na cor da marca). Células são HTML já escapado. */
    table(columns: ReadonlyArray<{ label: string; left?: boolean }>, rows: ReadonlyArray<readonly string[]>): string {
      const th = (column: { label: string; left?: boolean }) => `<th style="border:0;background:${colors.navy};color:#ffffff;font-size:12px;font-weight:600;padding:8px 8px;text-align:${column.left ? 'left' : 'center'}">${escapeHtml(column.label)}</th>`
      const td = (column: { left?: boolean }, value: string, last: boolean) => `<td style="padding:9px 8px;font-size:14px;color:${TEXT};text-align:${column.left ? 'left' : 'center'};${last ? '' : `border-bottom:1px solid ${SOFT};`}white-space:${column.left ? 'normal' : 'nowrap'}">${value}</td>`
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
  <tr>${columns.map(th).join('')}</tr>
  ${rows.map((row, index) => `<tr>${row.map((value, column) => td(columns[column] ?? {}, value, index === rows.length - 1)).join('')}</tr>`).join('')}
</table>`
    },
    /** Linha de total no pé de um bloco `flush`. HTML já escapado. */
    totalRow(labelHtml: string, valueHtml: string): string {
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BORDER};background:${colors.strip}"><tr><td style="padding:10px 16px;font-size:14px;font-weight:700;color:${TEXT}">${labelHtml}</td><td align="right" style="padding:10px 16px;font-size:16px;font-weight:700;color:${TEXT};white-space:nowrap">${valueHtml}</td></tr></table>`
    },
    /** Botão centralizado. */
    button(label: string, url: string): string {
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px"><tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:${colors.button}"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(label)}</a></td></tr></table></td></tr></table>`
    },
    /** Link de e-mail na cor da marca. */
    mailto(email: string): string {
      const safe = escapeHtml(email)
      return `<a href="mailto:${safe}" style="color:${colors.link};text-decoration:underline">${safe}</a>`
    },
  }
}

/** Rodapé padrão dos e-mails ao Cliente. */
export function emailFooter(rawContactEmail: string): { html: string; text: string } {
  // Endereço do domínio antigo não chega ao cliente (ponto 4 de 2026-10-23).
  const contactEmail = portalContactEmail(rawContactEmail)
  return {
    html: `Portal do Cliente · Fwlog. Dúvidas ou não reconhece esta mensagem? Fale com ${emailKit('portal').mailto(contactEmail)}.`,
    text: `Portal do Cliente · Fwlog. Dúvidas ou não reconhece esta mensagem? Fale com ${contactEmail}.`,
  }
}

/** Rodapé de segurança (troca do Email de Recuperação e senha alterada). */
export function emailSecurityFooter(rawContactEmail: string): { html: string; text: string } {
  const contactEmail = portalContactEmail(rawContactEmail)
  return {
    html: `Portal do Cliente · Fwlog. Não foi você? Fale com ${emailKit('portal').mailto(contactEmail)} imediatamente.`,
    text: `Portal do Cliente · Fwlog. Não foi você? Fale com ${contactEmail} imediatamente.`,
  }
}

export type EmailLayoutInput = {
  brand?: EmailBrand
  /** Qualquer endereço do site; a logo sai da origem (`/branding/…`). */
  siteUrl?: string | null
  title: string
  subtitle?: string | null
  /** HTML do corpo, montado com as peças deste módulo. */
  body: string
  /** HTML do rodapé (já escapado). */
  footer: string
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const brand = input.brand ?? 'portal'
  const colors = EMAIL_BRANDS[brand]
  const origin = escapeHtml(emailOrigin(input.siteUrl))
  const mark = brand === 'vela'
    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td><img src="${origin}/branding/vela-icon-192.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:6px"></td><td style="padding-left:10px;font-family:Syne,${FONT};font-size:22px;font-weight:700;color:#ffffff;letter-spacing:.01em">Vela</td></tr></table>`
    : `<img src="${origin}/branding/fwlog-logo-white.png" alt="Fwlog" height="28" style="height:28px;width:auto;display:block;border:0">`
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background:${PAGE};font-family:${FONT};color:${TEXT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE}"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:10px">
    <tr><td style="background:${colors.navy};padding:22px 28px;border-radius:10px 10px 0 0">${mark}</td></tr>
    <tr><td style="padding:28px 28px 6px">
      <h1 style="margin:0;text-align:center;font-size:22px;line-height:28px;font-weight:700;color:${TEXT}">${escapeHtml(input.title)}</h1>
      ${input.subtitle ? `<div style="margin-top:4px;text-align:center;font-size:15px;line-height:20px;color:${MUTED}">${escapeHtml(input.subtitle)}</div>` : ''}
      <div style="height:20px;line-height:20px;font-size:0">&nbsp;</div>
      ${input.body}
    </td></tr>
    <tr><td style="padding:0 28px 24px"><div style="border-top:1px solid ${SOFT};padding-top:16px;font-size:13px;line-height:1.55;color:${MUTED}">${input.footer}</div></td></tr>
  </table>
</td></tr></table>
</body></html>`
}

/** Versão em texto puro: título, linha de apoio, corpo e rodapé. */
export function renderEmailText(input: { title: string; subtitle?: string | null; body: string; footer: string }): string {
  return [input.title, ...(input.subtitle ? [input.subtitle] : []), '', input.body, '', '--', input.footer].join('\n')
}
