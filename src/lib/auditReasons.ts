// Motivo gravado numa linha de histórico (`audit_logs.justification`), lido
// para a tela. Três casos:
//   - o motivo que a pessoa escreveu: aparece como está;
//   - o rastro de onde a mudança veio (importação, rotina, gatilho): "Origem";
//   - o texto padrão que o sistema grava quando ninguém informou motivo
//     ("Revisao manual", "Atualizacao manual de ETD por POL"): não explica nada
//     e some da tela.
// Os textos de rastro escritos pelo banco sem acento ou com nome interno
// ("Gate canonico…", "(portal_activation)") viram frase em português na leitura;
// a linha gravada não muda. Fonte única para Admin › Histórico de ações e para
// o Histórico do B/L. Diagnóstico: docs/archive/audits/administracao-2026-11-06.md.
//
// ponytail: catálogo por texto exato e por alguns modelos; um texto técnico novo
// que o banco passe a gravar aparece como está até entrar aqui. O caminho é a
// etapa 3 do plano da Administração revisada: gravar a frase em português na
// origem, e este catálogo ficar só para as linhas antigas.

export type RecordedReason = {
  /** Texto para a tela. */
  text: string
  /** `true` quando é rastro do sistema (mostrado como "Origem"), não motivo de alguém. */
  origin: boolean
}

// Rastros antigos da importação de frete escrevem "Importacao de …" sem acento
// (migration arquivada 205): também são origem, não motivo (F-23). O rastro que
// carrega o motivo informado pela pessoa (troca de CE pela planilha, migration
// arquivada 195) continua sendo motivo.
const IMPORT_CONTEXT_PREFIXES = ['Importação de ', 'Importacao de ']
const REASON_MARK = ' · Motivo: '

/** Contexto que a importação grava como justificativa: é origem, não motivo. */
export function isImportContext(justification: string | null | undefined): boolean {
  const text = justification?.trim() ?? ''
  return IMPORT_CONTEXT_PREFIXES.some((prefix) => text.startsWith(prefix)) && !text.includes(REASON_MARK)
}

/**
 * Textos padrão gravados quando a pessoa não escreveu motivo: `save_bl_review`
 * (migration 271) e a tela da Revisão ("Revisão manual", levado a cada campo
 * pela 502), a edição da Viagem (`voyages.ts`) e o lançamento de cobrança manual
 * sem observação (573).
 */
const PLACEHOLDER_REASONS = new Set([
  'Revisao manual',
  'Revisão manual',
  'Atualizacao de dados da viagem',
  'Lancamento manual de other charge',
])

/** Datas e vínculos da escala salvos pela tela sem motivo (`voyageRouteSchedules.ts`). */
const PLACEHOLDER_PATTERN = /^(Atualizacao manual |Reinclusao de POD |Remocao de POD )/

/** Rastros que o banco grava com nome interno ou sem acento → frase da tela. */
const SYSTEM_REASON_TEXT: Readonly<Record<string, string>> = {
  'Gate canonico aplicado apos importacao': 'B/L enviado para a Revisão depois da importação',
  'Gate canonico reaplicado apos e-mail importado': 'B/L de volta à Revisão depois do e-mail importado',
  'Onboarding transacional de cliente pela revisão manual.': 'Cliente cadastrado na Revisão',
  'Marcado como pronto para faturar no modulo de Taxas Locais': 'Marcado como pronto para faturar em Taxas Locais',
  'Marcado como revisado no modulo de Taxas Locais': 'Marcado como revisado em Taxas Locais',
  'Emissao de invoice por B/L': 'Fatura emitida pelo B/L',
  'Emissao de consolidada via portal do cliente': 'Fatura consolidada emitida pelo Cliente no Portal',
  'Emissao de consolidada via ledger': 'Fatura consolidada emitida',
  'Fatura automatica apos vinculacao do CE Mercante.': 'Fatura emitida sozinha depois do vínculo do CE Mercante',
  'Recalculo do valor apos alteracao de desconto.': 'Valor recalculado depois da troca do desconto',
  'Data de descarga sincronizada apos correcao da ATA da viagem.': 'Data de descarga acompanhou a correção da ATA da Viagem',
  // Já em português: entra só para contar como origem, não como motivo de alguém.
  'NCM declarado no documento reimportado': 'NCM declarado no documento reimportado',
  'Baplie: marcas físicas aplicadas a todos os B/Ls ativos do container (conjunto atômico)': 'Baplie: marcas físicas aplicadas a todos os B/Ls ativos do container',
}

/** De onde veio a baixa (`ledger_settlements.source`, migration 573). */
const SETTLEMENT_SOURCE_TEXT: Readonly<Record<string, string>> = {
  manual: 'Baixa manual',
  itau_pix: 'Baixa automática do Pix Itaú',
  pix_extract: 'Baixa pelo extrato Pix',
  backfill: 'Baixa registrada na carga inicial',
}

/** O que soltou as faturas retidas (`_reprocess_customer_held_billing*`, migration 375). */
const HELD_BILLING_CAUSE_TEXT: Readonly<Record<string, string>> = {
  portal_activation: 'o Cliente ativou o Portal',
  portal_billing_release: 'faturamento liberado no Portal',
  recovery_email: 'o Cliente confirmou o e-mail de recuperação',
  assisted_email_change: 'e-mail do Cliente trocado com ajuda da equipe',
  suppressed_email_release: 'e-mail bloqueado do Cliente liberado',
}

const SETTLEMENT_PATTERN = /^Baixa via ledger \(([a-z_]+)\)$/
const HELD_BILLING_PATTERN = /^Reprocesso automático das faturas retidas \(([a-z_]+)\) pela conta de sistema$/
// Rastros com a referência à ADR do código no fim: a referência sai da tela.
const ADR_SUFFIX_TEMPLATES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Saída confirmada em Chegadas e Saídas; a data do B\/L a substitui se for diferente \(ADR [^)]*\)$/, 'Saída confirmada em Chegadas e Saídas; a data do B/L a substitui se for diferente'],
  [/^ATD derivado do menor Laden on Board dos B\/Ls ativos, na importação do B\/L \(ADR [^)]*\)$/, 'ATD tirado do menor Laden on Board dos B/Ls ativos, na importação do B/L'],
]

function systemReasonText(text: string): string | null {
  const known = SYSTEM_REASON_TEXT[text]
  if (known) return known
  const settlement = SETTLEMENT_PATTERN.exec(text)
  if (settlement) return SETTLEMENT_SOURCE_TEXT[settlement[1]] ?? 'Baixa registrada'
  const held = HELD_BILLING_PATTERN.exec(text)
  if (held) {
    const cause = HELD_BILLING_CAUSE_TEXT[held[1]]
    return cause ? `Faturas retidas emitidas: ${cause}` : 'Faturas retidas emitidas'
  }
  for (const [pattern, replacement] of ADR_SUFFIX_TEMPLATES) {
    if (pattern.test(text)) return replacement
  }
  return null
}

/**
 * O motivo gravado como a tela deve mostrar, ou `null` quando não há o que
 * mostrar (vazio ou texto padrão do sistema).
 */
export function readRecordedReason(justification: string | null | undefined): RecordedReason | null {
  const text = justification?.trim() ?? ''
  if (!text || PLACEHOLDER_REASONS.has(text) || PLACEHOLDER_PATTERN.test(text)) return null
  if (isImportContext(text)) return { text, origin: true }
  const system = systemReasonText(text)
  if (system) return { text: system, origin: true }
  return { text, origin: false }
}
