import { supabase } from './supabase'
import type { BaplieContainer, ParsedBaplie } from './baplieParser'
import type { ImportIssue } from './importValidation'
import { normalizePortCode } from './portCode'
import { canonicalizeVesselName } from '../lib/vesselAlias'
import { getBaplieManifestForVoyage, replaceVaziosFromBaplie } from './vaziosImportacaoImport'
import { applyBapliePhysicalFlagsDetailed } from './baplieReconciliation'

export type BaplieVoyageContext = {
  voyageNumber: string | null
  vesselName: string | null
  /** Portos das escalas ativas da Viagem (`get_voyage_eligible_pods`). */
  eligiblePods: string[]
}

export async function fetchBaplieVoyageContext(voyageId: number): Promise<BaplieVoyageContext> {
  const [voyage, pods] = await Promise.all([
    supabase.from('voyages').select('voyage_number, vessel:vessels(name)').eq('id', voyageId).maybeSingle(),
    supabase.rpc('get_voyage_eligible_pods' as never, { p_voyage_id: voyageId } as never),
  ])
  if (voyage.error) throw voyage.error
  if (pods.error) throw pods.error
  const row = voyage.data as unknown as { voyage_number?: string | null; vessel?: { name?: string | null } | null } | null
  const eligible = ((pods.data ?? []) as unknown as Array<{ pod: string }>).map((item) => item.pod).filter(Boolean)
  return { voyageNumber: row?.voyage_number ?? null, vesselName: row?.vessel?.name ?? null, eligiblePods: eligible }
}

const voyageKey = (value: string | null | undefined) => String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()

/**
 * Regras do Baplie que dependem da Viagem escolhida (ADR 0078, item 21): o
 * TDT de outro navio ou viagem bloqueia; container com POD fora das escalas
 * da Viagem é ignorado com aviso. Sem escalas cadastradas, nada é filtrado.
 */
export function applyBaplieVoyageRules(
  parsed: Pick<ParsedBaplie, 'containers' | 'issues' | 'voyage_number' | 'vessel_name'>,
  context: BaplieVoyageContext | null | undefined,
): { containers: BaplieContainer[]; pods: string[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [...parsed.issues]
  let containers = parsed.containers
  if (context) {
    if (parsed.voyage_number && context.voyageNumber && voyageKey(parsed.voyage_number) !== voyageKey(context.voyageNumber)) {
      issues.push({
        row: 0, field: 'voyage', code: 'ambiguous_voyage', severity: 'error',
        message: `O arquivo é da viagem ${parsed.voyage_number}; a viagem escolhida é ${context.voyageNumber}. Escolha a viagem certa ou o arquivo certo.`,
      })
    }
    if (parsed.vessel_name && context.vesselName
        && canonicalizeVesselName(parsed.vessel_name) !== canonicalizeVesselName(context.vesselName)) {
      issues.push({
        row: 0, field: 'vessel', code: 'ambiguous_voyage', severity: 'error',
        message: `O arquivo é do navio ${parsed.vessel_name}; a viagem escolhida é do navio ${context.vesselName}.`,
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
      }
    }
  }
  const pods = Array.from(new Set(containers.map((c) => c.pod).filter((p): p is string => Boolean(p)))).sort()
  return { containers, pods, issues }
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
  const emptyKeys = (list: Iterable<BaplieDiffFields>) =>
    [...list].filter((c) => c.status === 'empty').map((c) => `${c.container_number}|${c.pol}|${c.pod}`).sort().join(',')
  return { items, added, removed, changed, vaziosChanged: emptyKeys(before.values()) !== emptyKeys(after.values()) }
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

/** O que o arquivo novo faria nas marcas dos B/Ls, sem gravar (migration 181). */
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
    consequence: recadastraVazios
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
  reissues: number
}

export function describeBaplieFlags(summary: BaplieFlagsSummary | null | undefined): string {
  if (!summary) return ''
  const parts = [
    summary.appliedContainers ? `marcas aplicadas a ${summary.appliedContainers} container(s) em ${summary.appliedBls} B/L(s)` : '',
    summary.cleared ? `${summary.cleared} marca(s) do Baplie anterior retirada(s)` : '',
    summary.divergentManual ? `${summary.divergentManual} perfil(is) manual(is) mantido(s) como divergência` : '',
    summary.reissues ? `${summary.reissues} fatura(s) reemitida(s) pela mudança de base` : '',
  ].filter(Boolean)
  return parts.length ? ` ${parts.join('; ')}.` : ''
}

export function baplieImportToast(result: BaplieImportDone): string {
  if (result.status === 'unchanged') {
    return `Baplie reimportado sem diferenças (${result.staged} container(s)). Vazios e Nº do manifesto Mercante mantidos.${describeBaplieFlags(result.flags)}`
  }
  return `Baplie importado: ${result.staged} container(s) em staging.${result.vaziosReplaced ? ' Vazios de importação recadastrados.' : ''}${describeBaplieFlags(result.flags)}`
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
    const result = await applyBapliePhysicalFlagsDetailed(voyageId, actorId)
    return {
      flagsError: null,
      flags: {
        appliedContainers: new Set(result.applied_to.map((item) => item.container)).size,
        appliedBls: new Set(result.applied_to.map((item) => item.bl_id)).size,
        cleared: result.cleared.length,
        divergentManual: result.divergent_manual.length,
        reissues: result.invoice_reissues.length,
      },
    }
  } catch (error) {
    return { flagsError: errorText(error, 'Falha ao aplicar IMO/OOG aos B/Ls.'), flags: null }
  }
}

/** Refaz só o recadastro dos vazios a partir do Baplie já gravado (após `vaziosError`). */
export async function retryBaplieVazios({ voyageId, actorId }: { voyageId: number; actorId: string }): Promise<void> {
  await replaceVaziosFromBaplie({ voyageId, uploadedBy: actorId })
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
  const plan: BaplieReimportPlan = {
    existing: existingRows.length,
    diff,
    hasVaziosManifest: Boolean(await getBaplieManifestForVoyage(voyageId)),
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
  let vaziosError: string | null = null
  if (plan.hasVaziosManifest && diff.vaziosChanged) {
    try {
      await replaceVaziosFromBaplie({ voyageId, uploadedBy: actorId })
      vaziosReplaced = true
    } catch (error) {
      vaziosError = errorText(error, 'Falha ao recadastrar os vazios de importação.')
    }
  }
  return { status: diff.items.length ? 'replaced' : 'unchanged', staged, vaziosReplaced, flagsError, flags, vaziosError }
}
