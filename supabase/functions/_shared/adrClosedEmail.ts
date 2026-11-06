// E-mail "ADR fechado" (migration 611, ADR 0131 D6): a todos os usuários
// internos ativos, com o resumo do ADR e o link. Enviado pela Edge Function
// `adr-closed-email`. A lógica fica aqui, sem Deno, para o teste do Vitest.
import { emailFacts, emailKit, emailStack, escapeHtml, renderEmailLayout, renderEmailText } from '../../../src/services/emailLayout.ts'

// ponytail: cópia dos rótulos de `src/services/agencyReportLabels.ts`, que tem
// import sem extensão e não passa no `deno check`; `adrClosedEmail.test.ts`
// confere que as duas listas são iguais.
export const ADR_SECTION_LABELS: Record<string, string> = {
  datas: 'Escala',
  carga_descarregada: 'Carga descarregada',
  carga_carregada: 'Carga carregada',
  veiculos: 'Veículos',
  vazios_embarcados: 'Embarque de vazios',
  vazios_descarregados: 'Vazios descarregados',
}
export const ADR_DEPARTMENT_LABELS: Record<string, string> = {
  operacoes: 'Operações',
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
}

export type AdrClosedRow = {
  id: number
  report_id: string
  voyage_id: number
  voyage_label: string | null
  port: string
  terminal_code: string | null
  terminal_name: string | null
  closed_at: string
  closed_by_name: string | null
  schedule: { ata?: string | null; atb?: string | null; atd?: string | null } | null
  signoffs: Array<{ department: string; signed_at: string | null; signed_by_name: string | null }>
  sections: Record<string, string>
}

const SECTION_STATE: Record<string, string> = { confirmed: 'Confirmado', nothing_to_declare: 'Nada a declarar', pending: 'Pendente' }

function brDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

/** Caminho do ADR no Vela, o mesmo dos alertas do ADR. */
export function adrClosedPath(row: Pick<AdrClosedRow, 'voyage_id' | 'port' | 'terminal_code' | 'report_id'>): string {
  const params = new URLSearchParams({ tab: 'adr', escala: row.port })
  if (row.terminal_code) params.set('terminal', row.terminal_code)
  params.set('report', row.report_id)
  return `/viagens/${row.voyage_id}?${params.toString()}`
}

export function adrClosedTemplate(row: AdrClosedRow, appOrigin: string) {
  const vela = emailKit('vela')
  const voyage = row.voyage_label ?? `Viagem ${row.voyage_id}`
  const place = [row.port, row.terminal_name ?? row.terminal_code].filter(Boolean).join(' · ')
  const url = `${appOrigin.replace(/\/+$/, '')}${adrClosedPath(row)}`
  const title = `ADR de Saída fechado: ${voyage}`
  const subtitle = place
  const facts: Array<[string, string]> = [
    ['Porto e terminal', place],
    ['Fechado em', `${brDateTime(row.closed_at)}${row.closed_by_name ? ` por ${row.closed_by_name}` : ''}`],
    ['ATA', brDateTime(row.schedule?.ata)],
    ['ATB', brDateTime(row.schedule?.atb)],
    ['ATD', brDateTime(row.schedule?.atd)],
  ]
  const signoffs = row.signoffs.map((s) => [
    ADR_DEPARTMENT_LABELS[s.department] ?? s.department,
    s.signed_by_name ?? 'Pessoa sem cadastro',
    brDateTime(s.signed_at),
  ] as const)
  const sections = Object.entries(row.sections).map(([section, state]) => [ADR_SECTION_LABELS[section] ?? section, SECTION_STATE[state] ?? state] as const)

  const body = vela.block('Resumo', emailFacts(facts.map(([k, v]) => [escapeHtml(k), escapeHtml(v)] as const)))
    + vela.block('Assinaturas', emailStack(signoffs.map(([dep, who, when]) => [escapeHtml(dep), escapeHtml(who), escapeHtml(when), ''] as const)), { flush: true })
    + (sections.length
      ? vela.block('Seções', vela.table([{ label: 'Seção', left: true }, { label: 'Resolução' }], sections.map(([s, st]) => [escapeHtml(s), escapeHtml(st)])), { flush: true })
      : '')
    + vela.button('Abrir o ADR no Vela', url)
  const text = [
    ...facts.map(([k, v]) => `${k}: ${v}`),
    '',
    'Assinaturas',
    ...signoffs.map(([dep, who, when]) => `${dep}: ${who}, ${when}`),
    ...(sections.length ? ['', 'Seções', ...sections.map(([s, st]) => `${s}: ${st}`)] : []),
    '',
    `Abrir o ADR no Vela: ${url}`,
  ]
  const footer = 'Aviso do Vela a todos os usuários internos ativos: o ADR de Saída foi fechado e o retrato está congelado.'
  return {
    subject: `ADR fechado — ${voyage} · ${place}`,
    text: renderEmailText({ title, subtitle, body: text.join('\n'), footer }),
    html: renderEmailLayout({ brand: 'vela', siteUrl: appOrigin, title, subtitle, body, footer: escapeHtml(footer) }),
  }
}

export type AdrClosedDeps = {
  pending: () => Promise<{ rows: AdrClosedRow[]; recipients: string[] }>
  recipientKey: (email: string) => Promise<string>
  send: (input: { row: AdrClosedRow; to: string; idempotencyKey: string }) => Promise<'sent' | 'suppressed' | 'failed'>
  finish: (id: number, status: 'sent' | 'retry' | 'failed', error?: string | null) => Promise<void>
}

/**
 * Uma rodada: cada fechamento vai a cada destinatário, com chave de
 * idempotência por fechamento e destinatário (o reenvio não duplica). Falha em
 * algum destinatário devolve a linha à fila (até 5 tentativas, no banco).
 */
export async function runAdrClosedEmail(deps: AdrClosedDeps): Promise<{ status: number; body: { rows: number; sent: number; failed: number } }> {
  const { rows, recipients } = await deps.pending()
  let sent = 0
  let failed = 0
  for (const row of rows) {
    let rowFailed = 0
    for (const to of recipients) {
      const idempotencyKey = `adr-fechado:${row.id}:${await deps.recipientKey(to)}`
      try {
        const result = await deps.send({ row, to, idempotencyKey })
        if (result === 'failed') rowFailed += 1
        else sent += 1
      } catch {
        rowFailed += 1
      }
    }
    failed += rowFailed
    await deps.finish(row.id, rowFailed ? 'retry' : 'sent', rowFailed ? `${rowFailed} destinatário(s) com falha` : null)
  }
  return { status: failed ? 500 : 200, body: { rows: rows.length, sent, failed } }
}
