import { supabase } from './supabase'
import type { BaplieContainer, ParsedBaplie } from './baplieParser'
import type { ImportIssue } from './importValidation'
import { normalizePortCode } from './portCode'
import { canonicalizeVesselName } from '../lib/vesselAlias'
import { normalizeIsoContainerNumber } from '../lib/containerNumber'
import { userFacingErrorMessage } from '../lib/errors'
import { getBaplieManifestForVoyage, replaceVaziosFromBaplie } from './vaziosImportacaoImport'
import { applyBapliePhysicalFlagsDetailed, type BaplieFlagsApplyResult } from './baplieReconciliation'

export type BaplieVoyageContext = {
  voyageNumber: string | null
  vesselName: string | null
  /** Portos das escalas ativas da Viagem (`list_voyage_eligible_pods`, migration 190). */
  eligiblePods: string[]
  /**
   * Containers dos B/Ls ativos da Viagem: o operador deles é a referência de
   * "outro operador" (ADR 0079, decisão 6). Ausente = não conferido.
   */
  blContainerNumbers?: string[]
}

// Paginado como `listBaplieStagingForDiff`: uma Viagem pode passar de 1000 containers.
async function listVoyageBlContainerNumbers(voyageId: number): Promise<string[]> {
  const PAGE = 1000
  const numbers = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bl_containers')
      .select('container_number, bl:bls!inner(voyage_id, cancelled_at)')
      .eq('bl.voyage_id', voyageId)
      .is('bl.cancelled_at', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ container_number: string | null }>) {
      const number = normalizeIsoContainerNumber(row.container_number)
      if (number) numbers.add(number)
    }
    if (!data || data.length < PAGE) break
  }
  return [...numbers]
}

export async function fetchBaplieVoyageContext(voyageId: number): Promise<BaplieVoyageContext> {
  // `get_voyage_eligible_pods` não tem GRANT para authenticated: a chamada
  // falhava e as regras da Viagem não rodavam. A versão guardada (usuário
  // interno ativo) devolve o mesmo `TABLE(pod text)`. O cast fica até a
  // regeneração dos tipos (database.ts protegido).
  const [voyage, pods, blContainerNumbers] = await Promise.all([
    supabase.from('voyages').select('voyage_number, vessel:vessels(name)').eq('id', voyageId).maybeSingle(),
    supabase.rpc('list_voyage_eligible_pods' as never, { p_voyage_id: voyageId } as never),
    listVoyageBlContainerNumbers(voyageId),
  ])
  if (voyage.error) throw voyage.error
  if (pods.error) throw pods.error
  const row = voyage.data as unknown as { voyage_number?: string | null; vessel?: { name?: string | null } | null } | null
  const eligible = ((pods.data ?? []) as unknown as Array<{ pod: string }>).map((item) => item.pod).filter(Boolean)
  return { voyageNumber: row?.voyage_number ?? null, vesselName: row?.vessel?.name ?? null, eligiblePods: eligible, blContainerNumbers }
}

/**
 * Sem o contexto da Viagem, as regras de navio/viagem e de escalas não rodam
 * e o arquivo passaria sem conferência: a importação espera a leitura e, se
 * ela falhar, fica bloqueada com o motivo. `null` libera.
 */
export function baplieVoyageContextBlock(context: {
  data?: BaplieVoyageContext | null
  isError?: boolean
  error?: unknown
}): { state: 'loading' | 'error'; message: string } | null {
  if (context.isError) {
    return {
      state: 'error',
      message: `Não foi possível conferir a Viagem: ${userFacingErrorMessage(context.error, 'a leitura do navio, da viagem e das escalas falhou. Tente novamente.')}`,
    }
  }
  if (!context.data) return { state: 'loading', message: 'Conferindo navio, viagem e escalas da Viagem…' }
  return null
}

// Mesma regra da importação documental de B/L (`normalizeVoyageNumber` em
// blDocumentImport.ts): pontuação e zeros à esquerda não mudam a viagem
// ("0012N" = "12N", "033" = "33"). ponytail: cópia de uma linha porque o
// helper de lá não é exportado; se a regra mudar, mude nos dois.
const voyageKey = (value: string | null | undefined) =>
  String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '')

const OPERATOR_SAMPLE = 10

/**
 * Container de outro operador (NAD+CA) é ignorado com aviso (ADR 0079,
 * decisão 6). A referência são os operadores dos containers do arquivo que
 * estão nos B/Ls da Viagem, e esses containers nunca são ignorados por
 * operador: o TDT de um navio compartilhado pode trazer o parceiro de slot.
 * Sem nenhum deles no arquivo (ou sem a lista da Viagem), vale o operador do
 * cabeçalho (TDT ou o NAD+CA mais frequente), com aviso para conferir.
 */
function applyOperatorRule(
  containers: BaplieContainer[],
  headerOperator: string | null | undefined,
  context: BaplieVoyageContext | null | undefined,
  issues: ImportIssue[],
): BaplieContainer[] {
  const voyageNumbers = context?.blContainerNumbers ? new Set(context.blContainerNumbers) : null
  const inVoyage = (c: BaplieContainer) => Boolean(voyageNumbers?.has(c.container_number))
  const ours = new Set(containers.filter((c) => c.operator && inVoyage(c)).map((c) => c.operator as string))
  const fallback = ours.size === 0
  const reference = fallback ? new Set(headerOperator ? [headerOperator] : []) : ours
  if (!reference.size) return containers

  const ignored = containers.filter((c) => c.operator && !reference.has(c.operator) && !inVoyage(c))
  if (!ignored.length) return containers
  const byOperator = new Map<string, string[]>()
  for (const c of ignored) byOperator.set(c.operator as string, [...(byOperator.get(c.operator as string) ?? []), c.container_number])
  const referenceLabel = [...reference].sort().join(', ')
  if (fallback && context) {
    issues.push({
      row: 0, field: 'container_number', code: 'invalid_group', severity: 'warning',
      message: `Nenhum container do arquivo está nos B/Ls da Viagem: o operador de referência é o do cabeçalho do arquivo (${referenceLabel}). Confira a Viagem e o arquivo antes de importar.`,
    })
  }
  for (const [operator, numbers] of [...byOperator.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sample = numbers.slice(0, OPERATOR_SAMPLE).join(', ')
    const more = numbers.length > OPERATOR_SAMPLE ? ` e mais ${numbers.length - OPERATOR_SAMPLE}` : ''
    issues.push({
      row: 0, field: 'container_number', code: 'invalid_group', severity: 'warning',
      message: `${numbers.length} container(s) de outro operador (${operator}; referência ${referenceLabel}) ignorado(s): ${sample}${more}.`,
    })
  }
  const kept = containers.filter((c) => !ignored.includes(c))
  if (!kept.length) {
    issues.push({
      row: 0, field: 'container_number', code: 'invalid_group', severity: 'error',
      message: 'Nenhum container a importar: todos são de outro operador (avisos acima).',
    })
  }
  return kept
}

/** Container deixado de fora por descarregar fora das escalas da Viagem ou em porto não reconhecido. */
export type BaplieOutsidePod = { container_number: string; pod: string; reason: 'unrecognized' | 'outside_calls' }

/**
 * Regras do Baplie que dependem da Viagem escolhida (ADR 0078, item 21): o
 * TDT de outro navio ou viagem bloqueia; container com POD fora das escalas
 * da Viagem é ignorado com aviso. Sem escalas cadastradas, nada é filtrado.
 * O navio só bloqueia quando o nome vem da identificação do transporte (C222);
 * nome deduzido por heurística só avisa. Container de outro operador é
 * ignorado pela referência dos B/Ls da Viagem (`applyOperatorRule`).
 */
export function applyBaplieVoyageRules(
  parsed: Pick<ParsedBaplie, 'containers' | 'issues' | 'voyage_number' | 'vessel_name' | 'vessel_name_source' | 'operator'> & Partial<Pick<ParsedBaplie, 'ignored_pods'>>,
  context: BaplieVoyageContext | null | undefined,
): { containers: BaplieContainer[]; pods: string[]; issues: ImportIssue[]; podsOutside: BaplieOutsidePod[] } {
  const issues: ImportIssue[] = [...parsed.issues]
  const podsOutside: BaplieOutsidePod[] = (parsed.ignored_pods ?? []).map((item) => ({ ...item, reason: 'unrecognized' }))
  let containers = applyOperatorRule(parsed.containers, parsed.operator, context, issues)
  if (context) {
    if (parsed.voyage_number && context.voyageNumber && voyageKey(parsed.voyage_number) !== voyageKey(context.voyageNumber)) {
      issues.push({
        row: 0, field: 'voyage', code: 'ambiguous_voyage', severity: 'error',
        message: `O arquivo é da viagem ${parsed.voyage_number}; a viagem escolhida é ${context.voyageNumber}. Escolha a viagem certa ou o arquivo certo.`,
      })
    }
    if (parsed.vessel_name && context.vesselName
        && canonicalizeVesselName(parsed.vessel_name) !== canonicalizeVesselName(context.vesselName)) {
      const identified = parsed.vessel_name_source === 'identification'
      issues.push({
        row: 0, field: 'vessel', code: 'ambiguous_voyage', severity: identified ? 'error' : 'warning',
        message: identified
          ? `O arquivo é do navio ${parsed.vessel_name}; a viagem escolhida é do navio ${context.vesselName}.`
          : `O TDT do arquivo não traz o nome do navio na identificação do transporte; o nome lido (${parsed.vessel_name}) difere do navio da viagem escolhida (${context.vesselName}). Confira antes de importar.`,
      })
    }
    if (context.eligiblePods.length) {
      const eligible = new Set(context.eligiblePods.map((pod) => normalizePortCode(pod) ?? pod.toUpperCase()))
      const outside = containers.filter((c) => c.pod && !eligible.has(normalizePortCode(c.pod) ?? c.pod.toUpperCase()))
      if (outside.length) {
        const ports = Array.from(new Set(outside.map((c) => c.pod))).join(', ')
        issues.push({
          row: 0, field: 'pod', code: 'unknown_port', severity: 'warning',
          message: `${outside.length} container(s) com descarga fora das escalas da Viagem (${ports}) ignorado(s).`,
        })
        containers = containers.filter((c) => !outside.includes(c))
        podsOutside.push(...outside.map((c) => ({ container_number: c.container_number, pod: c.pod as string, reason: 'outside_calls' as const })))
      }
    }
  }
  const pods = Array.from(new Set(containers.map((c) => c.pod).filter((p): p is string => Boolean(p)))).sort()
  return { containers, pods, issues, podsOutside }
}

/** Linhas do staging do Baplie (a Viagem vai à parte, em `p_voyage_id`). */
export function toBaplieStagingRows(containers: BaplieContainer[], actorId?: string | null) {
  return containers.map((c) => ({
    container_number: c.container_number,
    size_type: c.size_type,
    status: c.status,
    weight_kg: c.weight_kg,
    pol: c.pol,
    pod: c.pod,
    final_dest: c.final_dest,
    bl_ref: c.bl_ref,
    slot: c.slot,
    is_imo: c.is_imo,
    imo_class: c.imo_class,
    un_number: c.un_number,
    is_oog: c.is_oog,
    ownership: c.ownership ?? null,
    imported_by: actorId ?? null,
  }))
}

/** Persiste containers do Baplie no staging. Substitui staging anterior da mesma viagem. */
export async function importBaplieStaging(
  voyageId: number,
  containers: BaplieContainer[],
  actorId?: string | null,
): Promise<{ staged: number }> {
  const rows = toBaplieStagingRows(containers, actorId)

  const { error } = await supabase.rpc('import_baplie_staging_transactional', {
    p_voyage_id: voyageId,
    p_rows: rows,
  })
  if (error) throw error

  return { staged: rows.length }
}

/**
 * Reimportar apaga o Baplie anterior da viagem inteiro. Como todo Departamento
 * importa (decisão de 2026-09-23), a substituição com diferença pede confirmação;
 * um arquivo sem diferença é aceito direto (decisão de 2026-10-01).
 */
export function baplieReplacementMessage(existing: number, incoming: number): string {
  return `Esta viagem já tem um Baplie com ${existing} container(s). O arquivo novo, com ${incoming} container(s), substitui o anterior por inteiro.`
}

type BaplieDiffFields = Pick<BaplieContainer, 'container_number' | 'status' | 'size_type' | 'pol' | 'pod' | 'is_imo' | 'is_oog' | 'ownership'>

export type BaplieReplacementDiff = {
  /** Uma linha legível por container incluído, removido ou alterado. */
  items: string[]
  added: number
  removed: number
  changed: number
  /** Os vazios (container + rota) mudaram: o manifesto de vazios do Baplie precisa ser recadastrado. */
  vaziosChanged: boolean
}

const describeContainer = (c: BaplieDiffFields) =>
  `${c.status === 'empty' ? 'vazio' : 'cheio'}, ${c.pol ?? '?'} → ${c.pod ?? '?'}${c.size_type ? `, ${c.size_type}` : ''}${c.is_imo ? ', IMO' : ''}${c.is_oog ? ', OOG' : ''}${c.ownership ? `, ${c.ownership}` : ''}`

/** Compara o Baplie atual da viagem com o arquivo novo. Slot, peso e B/L ref. não contam como diferença. */
export function diffBaplieStaging(existing: BaplieDiffFields[], incoming: BaplieDiffFields[]): BaplieReplacementDiff {
  const before = new Map(existing.map((c) => [c.container_number, c]))
  const after = new Map(incoming.map((c) => [c.container_number, c]))
  const items: string[] = []
  let added = 0
  let removed = 0
  let changed = 0
  for (const [number, next] of after) {
    const previous = before.get(number)
    if (!previous) {
      added += 1
      items.push(`Incluído: ${number} (${describeContainer(next)})`)
    } else if (describeContainer(previous) !== describeContainer(next)) {
      changed += 1
      items.push(`Alterado: ${number} (${describeContainer(previous)} ⇒ ${describeContainer(next)})`)
    }
  }
  for (const [number, previous] of before) {
    if (!after.has(number)) {
      removed += 1
      items.push(`Removido: ${number} (${describeContainer(previous)})`)
    }
  }
  return { items, added, removed, changed, vaziosChanged: baplieEmptyKeys(before.values()) !== baplieEmptyKeys(after.values()) }
}

type VaziosKeyFields = Pick<BaplieContainer, 'container_number' | 'pol' | 'pod'>

/** Container + rota de cada vazio, na ordem: o que o recadastro dos vazios copia do Baplie. */
function vaziosKeys(list: Iterable<VaziosKeyFields>) {
  return [...list].map((c) => `${c.container_number}|${c.pol}|${c.pod}`).sort().join(',')
}

function baplieEmptyKeys(list: Iterable<BaplieDiffFields>) {
  return vaziosKeys([...list].filter((c) => c.status === 'empty'))
}

/**
 * Vazios do Baplie pendentes de recadastro (ADR 0092, item 5): o manifesto de
 * vazios vindo do Baplie não tem os mesmos containers e rotas que os vazios do
 * Baplie gravado. É o rastro persistido de um `vaziosError` — a falha em si não
 * fica gravada —, e /baplie oferece "Atualizar vazios do Baplie" com ele.
 *
 * ponytail: a comparação também acusa a diferença quando uma planilha de Vazios
 * de importação substituiu, de propósito, uma rota do manifesto do Baplie (a
 * migration 187 apaga as linhas da rota em todos os manifestos da Viagem). É o
 * mesmo limite da comparação por quantidade que a tela já fazia; separar os
 * dois casos pede gravar a falha do recadastro (uma coluna de pendência).
 */
export async function hasPendingBaplieVazios(voyageId: number, manifestId: string): Promise<boolean> {
  const [staging, registered] = await Promise.all([
    listBaplieStagingForDiff(voyageId),
    listVaziosManifestKeys(manifestId),
  ])
  return baplieEmptyKeys(staging) !== vaziosKeys(registered)
}

// Paginado como `listBaplieStagingForDiff`.
async function listVaziosManifestKeys(manifestId: string): Promise<VaziosKeyFields[]> {
  const PAGE = 1000
  const rows: VaziosKeyFields[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('vazios_importacao_containers')
      .select('container_number, pol, pod')
      .eq('manifest_id', manifestId)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as VaziosKeyFields[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

// Paginado: o PostgREST devolve no máximo 1000 linhas por chamada; um Baplie
// maior escondia containers da diferença.
export async function listBaplieStagingForDiff(voyageId: number): Promise<BaplieDiffFields[]> {
  const PAGE = 1000
  const rows: BaplieDiffFields[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('baplie_containers')
      .select('container_number, status, size_type, pol, pod, is_imo, is_oog, ownership')
      .eq('voyage_id', voyageId)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as BaplieDiffFields[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

export type BapliePreviewFlag = { container: string; bl_id: string; before?: string; after?: string }

export type BaplieFlagsPreview = {
  apply: BapliePreviewFlag[]
  /** Marcas que vieram do Baplie anterior e caem com o arquivo novo. */
  clear: BapliePreviewFlag[]
  /** Perfil IMO/OOG corrigido à mão que o Baplie novo contradiz (não é trocado). */
  divergent_manual: BapliePreviewFlag[]
}

/** O que o arquivo novo faria nas marcas dos B/Ls, sem gravar (migration 182). */
export async function previewBaplieFlags(voyageId: number, containers: BaplieContainer[]): Promise<BaplieFlagsPreview> {
  const { data, error } = await supabase.rpc('preview_baplie_physical_flags' as never, {
    p_voyage_id: voyageId,
    p_rows: toBaplieStagingRows(containers),
  } as never)
  if (error) throw error
  const preview = (data ?? {}) as Partial<BaplieFlagsPreview>
  return { apply: preview.apply ?? [], clear: preview.clear ?? [], divergent_manual: preview.divergent_manual ?? [] }
}

export type BaplieReimportPlan = {
  existing: number
  diff: BaplieReplacementDiff
  hasVaziosManifest: boolean
  /** Vazios do manifesto vindo do Baplie anterior (0 sem manifesto). */
  vaziosManifestTotal?: number
  /** Vazios do Baplie novo. */
  incomingEmpties?: number
  flags?: BaplieFlagsPreview
}

/** Opções do diálogo "Substituir o Baplie da viagem", com a diferença listada. */
export function baplieReplacementConfirmOptions(plan: BaplieReimportPlan, incoming: number) {
  const { diff } = plan
  const recadastraVazios = plan.hasVaziosManifest && diff.vaziosChanged
  return {
    title: 'Substituir o Baplie da viagem',
    message: baplieReplacementMessage(plan.existing, incoming),
    confirmLabel: 'Substituir',
    tone: 'danger' as const,
    affected: {
      summary: `${diff.added} incluído(s), ${diff.removed} removido(s), ${diff.changed} alterado(s)${plan.flags?.clear.length ? `; ${plan.flags.clear.length} marca(s) do Baplie anterior caem` : ''}`,
      items: [
        ...diff.items,
        ...(plan.flags?.clear ?? []).map((item) => `Marca que cai: ${item.container} no B/L ${item.bl_id} (${item.before} ⇒ ${item.after})`),
        ...(plan.flags?.divergent_manual ?? []).map((item) => `Perfil manual mantido: ${item.container} no B/L ${item.bl_id} (o Baplie diz outra coisa; vira divergência)`),
      ],
    },
    consequence: recadastraVazios && plan.incomingEmpties === 0
      // Decisão de 2026-10-20 (migration 336): um Baplie sempre traz os
      // vazios; sem nenhum, os do Baplie anterior saem da Viagem.
      ? `Este Baplie não traz vazios: ${(plan.vaziosManifestTotal ?? 0) === 1 ? 'o vazio de importação vindo do Baplie anterior sai' : `os ${plan.vaziosManifestTotal ?? 0} vazios de importação vindos do Baplie anterior saem`} da Viagem, com a natureza (cama/cover plate) digitada e o Nº do manifesto Mercante de vazios das rotas que ficarem sem container.`
      : recadastraVazios
      ? 'Os vazios de importação vindos do Baplie são recadastrados com o arquivo novo. O Nº do manifesto Mercante de vazios já informado é mantido.'
      : plan.hasVaziosManifest
        ? 'Os vazios não mudaram: o manifesto de vazios e o Nº do manifesto Mercante são mantidos.'
        : undefined,
  }
}

export type BaplieReimportResult =
  | { status: 'cancelled' }
  | {
      status: 'imported' | 'unchanged' | 'replaced'
      staged: number
      vaziosReplaced: boolean
      /** Baplie novo sem vazios: os vazios do Baplie anterior saíram (migration 336). */
      vaziosRemoved?: boolean
      /** Baplie gravado, mas IMO/OOG não chegaram aos B/Ls: falha parcial que a tela mostra. */
      flagsError: string | null
      /** O que foi aplicado e onde, as marcas que caíram e as faturas reemitidas. */
      flags?: BaplieFlagsSummary | null
      /**
       * Baplie gravado, mas o recadastro dos vazios falhou. Reimportar o mesmo
       * arquivo não refaz os vazios (sem diferença, eles não são tocados): a tela
       * oferece `retryBaplieVazios`.
       */
      vaziosError: string | null
    }

export type BaplieImportDone = Exclude<BaplieReimportResult, { status: 'cancelled' }>

export type BaplieFlagsSummary = {
  appliedContainers: number
  appliedBls: number
  cleared: number
  divergentManual: number
  /** B/Ls com fatura de fato reemitida (`reissued`). */
  reissues: number
  /** B/Ls com fatura paga corrigida por abatimento ou restituição (`corrected`). */
  corrected?: number
  /** B/Ls cuja fatura não foi reemitida (`pending`, `has_payment`): ficam em Alertas. */
  reissuesPending?: number
  /** B/Ls em que o reprocessamento da base falhou (`error`): ficam em Alertas. */
  reissueErrors?: number
}

/**
 * Resumo do retorno de `apply_baplie_physical_flags_atomic`. Cada item de
 * `invoice_reissues` é um B/L com o status de `apply_invoice_basis_changes`
 * (migration 128): só `reissued` é reemissão; `error` traz `bl_ids`.
 */
export function summarizeBaplieFlags(result: BaplieFlagsApplyResult): BaplieFlagsSummary {
  const byStatus = (statuses: string[]) => result.invoice_reissues.filter((item) => statuses.includes(String(item.status ?? '')))
  return {
    appliedContainers: new Set(result.applied_to.map((item) => item.container)).size,
    appliedBls: new Set(result.applied_to.map((item) => item.bl_id)).size,
    cleared: result.cleared.length,
    divergentManual: result.divergent_manual.length,
    reissues: byStatus(['reissued']).length,
    corrected: byStatus(['corrected']).length,
    reissuesPending: byStatus(['pending', 'has_payment']).length,
    reissueErrors: byStatus(['error']).reduce((total, item) => total + (Array.isArray(item.bl_ids) && item.bl_ids.length ? item.bl_ids.length : 1), 0),
  }
}

export function describeBaplieFlags(summary: BaplieFlagsSummary | null | undefined): string {
  if (!summary) return ''
  const parts = [
    summary.appliedContainers ? `marcas aplicadas a ${summary.appliedContainers} container(s) em ${summary.appliedBls} B/L(s)` : '',
    summary.cleared ? `${summary.cleared} marca(s) do Baplie anterior retirada(s)` : '',
    summary.divergentManual ? `${summary.divergentManual} perfil(is) manual(is) mantido(s) como divergência` : '',
    summary.reissues ? `fatura reemitida pela mudança de base em ${summary.reissues} B/L(s)` : '',
    summary.corrected ? `fatura paga corrigida pela mudança de base em ${summary.corrected} B/L(s)` : '',
    summary.reissuesPending ? `fatura não reemitida em ${summary.reissuesPending} B/L(s) (pendente em Alertas)` : '',
    summary.reissueErrors ? `falha ao refazer a fatura em ${summary.reissueErrors} B/L(s) (pendente em Alertas)` : '',
  ].filter(Boolean)
  return parts.length ? ` ${parts.join('; ')}.` : ''
}

export function baplieImportToast(result: BaplieImportDone): string {
  if (result.status === 'unchanged') {
    return `Baplie reimportado sem diferenças (${result.staged} container(s)). Vazios e Nº do manifesto Mercante mantidos.${describeBaplieFlags(result.flags)}`
  }
  const vazios = result.vaziosRemoved
    ? ' Vazios de importação do Baplie anterior removidos (este Baplie não traz vazios).'
    : result.vaziosReplaced ? ' Vazios de importação recadastrados.' : ''
  return `Baplie importado: ${result.staged} container(s) em staging.${vazios}${describeBaplieFlags(result.flags)}`
}

/** Baplie gravado com pendência (IMO/OOG ou vazios): o modal fica aberto com este aviso. */
export function hasBapliePendency(result: BaplieImportDone) {
  return Boolean(result.flagsError || result.vaziosError)
}

export function baplieFootnoteForPendency(result: BaplieImportDone) {
  if (!hasBapliePendency(result)) return 'Baplie gravado, sem pendências.'
  if (result.flagsError && result.vaziosError) return 'Baplie gravado; faltam IMO/OOG nos B/Ls e os vazios.'
  if (result.vaziosError) return 'Baplie gravado; faltam os vazios de importação.'
  return 'Baplie gravado; falta aplicar IMO/OOG aos B/Ls.'
}

/**
 * O Baplie é soberano sobre IMO/OOG: toda importação gravada aplica as flags
 * físicas aos bl_containers da viagem. A falha não desfaz o staging já gravado;
 * volta como texto para a tela avisar. Reimportar o mesmo arquivo refaz a aplicação.
 */
function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? fallback)
}

async function applyFlagsAfterStaging(voyageId: number, actorId: string): Promise<{ flagsError: string | null; flags: BaplieFlagsSummary | null }> {
  try {
    return { flagsError: null, flags: summarizeBaplieFlags(await applyBapliePhysicalFlagsDetailed(voyageId, actorId)) }
  } catch (error) {
    return { flagsError: errorText(error, 'Falha ao aplicar IMO/OOG aos B/Ls.'), flags: null }
  }
}

/**
 * Refaz só o recadastro dos vazios a partir do Baplie já gravado (após
 * `vaziosError`). Devolve quantos vazios ficaram: 0 quer dizer que o Baplie não
 * traz vazios e os do Baplie anterior saíram (migration 336).
 */
export async function retryBaplieVazios({ voyageId, actorId }: { voyageId: number; actorId: string }): Promise<number> {
  const { total } = await replaceVaziosFromBaplie({ voyageId, uploadedBy: actorId })
  return total
}

/**
 * Importa ou reimporta o Baplie da viagem. Com Baplie anterior: sem diferença,
 * aceita sem perguntar e não toca nos vazios; com diferença, pede confirmação
 * e, se os vazios mudaram e já havia manifesto de vazios do Baplie, recadastra-os.
 * O Nº do manifesto Mercante (manifestos_mercante) não é apagado em nenhum caso.
 * Depois de gravar, aplica IMO/OOG aos B/Ls (`flagsError` diz se falhou), para
 * que a página /baplie e a ação rápida da Viagem tenham o mesmo efeito. Falha
 * no recadastro dos vazios também não desfaz o Baplie: volta em `vaziosError`.
 */
export async function reimportBaplie({
  voyageId,
  containers,
  actorId,
  confirmReplacement,
}: {
  voyageId: number
  containers: BaplieContainer[]
  actorId: string
  confirmReplacement: (plan: BaplieReimportPlan) => Promise<boolean>
}): Promise<BaplieReimportResult> {
  const existingRows = await listBaplieStagingForDiff(voyageId)
  if (!existingRows.length) {
    const { staged } = await importBaplieStaging(voyageId, containers, actorId)
    const { flagsError, flags } = await applyFlagsAfterStaging(voyageId, actorId)
    return { status: 'imported', staged, vaziosReplaced: false, flagsError, flags, vaziosError: null }
  }
  const diff = diffBaplieStaging(existingRows, containers)
  const vaziosManifest = await getBaplieManifestForVoyage(voyageId)
  const plan: BaplieReimportPlan = {
    existing: existingRows.length,
    diff,
    hasVaziosManifest: Boolean(vaziosManifest),
    vaziosManifestTotal: vaziosManifest?.total_containers ?? 0,
    incomingEmpties: containers.filter((container) => container.status === 'empty').length,
    // Baplie completo (ADR 0078, item 21): o que sai apaga as marcas vindas
    // do Baplie anterior, listadas antes de confirmar.
    flags: await previewBaplieFlags(voyageId, containers),
  }
  if ((diff.items.length || plan.flags?.clear.length) && !(await confirmReplacement(plan))) return { status: 'cancelled' }

  const { staged } = await importBaplieStaging(voyageId, containers, actorId)
  // As flags dependem só dos cheios do staging: aplicadas antes dos vazios, não
  // ficam para trás se o recadastro dos vazios falhar.
  const { flagsError, flags } = await applyFlagsAfterStaging(voyageId, actorId)
  let vaziosReplaced = false
  let vaziosRemoved = false
  let vaziosError: string | null = null
  if (plan.hasVaziosManifest && diff.vaziosChanged) {
    try {
      const { total } = await replaceVaziosFromBaplie({ voyageId, uploadedBy: actorId })
      vaziosReplaced = total > 0
      vaziosRemoved = total === 0
    } catch (error) {
      vaziosError = errorText(error, 'Falha ao recadastrar os vazios de importação.')
    }
  }
  return { status: diff.items.length ? 'replaced' : 'unchanged', staged, vaziosReplaced, vaziosRemoved, flagsError, flags, vaziosError }
}
