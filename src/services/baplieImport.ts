import { supabase } from './supabase'
import type { BaplieContainer } from './baplieParser'
import { getBaplieManifestForVoyage, replaceVaziosFromBaplie } from './vaziosImportacaoImport'
import { applyBapliePhysicalFlags } from './baplieReconciliation'

/** Persiste containers do Baplie no staging. Substitui staging anterior da mesma viagem. */
export async function importBaplieStaging(
  voyageId: number,
  containers: BaplieContainer[],
  actorId?: string | null,
): Promise<{ staged: number }> {
  const rows = containers.map((c) => ({
    voyage_id: voyageId,
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

export async function listBaplieStagingForDiff(voyageId: number): Promise<BaplieDiffFields[]> {
  const { data, error } = await supabase
    .from('baplie_containers')
    .select('container_number, status, size_type, pol, pod, is_imo, is_oog, ownership')
    .eq('voyage_id', voyageId)
  if (error) throw error
  return (data ?? []) as BaplieDiffFields[]
}

export type BaplieReimportPlan = {
  existing: number
  diff: BaplieReplacementDiff
  hasVaziosManifest: boolean
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
      summary: `${diff.added} incluído(s), ${diff.removed} removido(s), ${diff.changed} alterado(s)`,
      items: diff.items,
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
    }

export function baplieImportToast(result: Exclude<BaplieReimportResult, { status: 'cancelled' }>): string {
  if (result.status === 'unchanged') {
    return `Baplie reimportado sem diferenças (${result.staged} container(s)). Vazios e Nº do manifesto Mercante mantidos.`
  }
  return `Baplie importado: ${result.staged} container(s) em staging.${result.vaziosReplaced ? ' Vazios de importação recadastrados.' : ''}`
}

/**
 * O Baplie é soberano sobre IMO/OOG: toda importação gravada aplica as flags
 * físicas aos bl_containers da viagem. A falha não desfaz o staging já gravado;
 * volta como texto para a tela avisar. Reimportar o mesmo arquivo refaz a aplicação.
 */
async function applyFlagsAfterStaging(voyageId: number, actorId: string): Promise<string | null> {
  try {
    await applyBapliePhysicalFlags(voyageId, actorId)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? 'Falha ao aplicar IMO/OOG aos B/Ls.')
  }
}

/**
 * Importa ou reimporta o Baplie da viagem. Com Baplie anterior: sem diferença,
 * aceita sem perguntar e não toca nos vazios; com diferença, pede confirmação
 * e, se os vazios mudaram e já havia manifesto de vazios do Baplie, recadastra-os.
 * O Nº do manifesto Mercante (manifestos_mercante) não é apagado em nenhum caso.
 * Depois de gravar, aplica IMO/OOG aos B/Ls (`flagsError` diz se falhou), para
 * que a página /baplie e a ação rápida da Viagem tenham o mesmo efeito.
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
    const flagsError = await applyFlagsAfterStaging(voyageId, actorId)
    return { status: 'imported', staged, vaziosReplaced: false, flagsError }
  }
  const diff = diffBaplieStaging(existingRows, containers)
  const plan: BaplieReimportPlan = {
    existing: existingRows.length,
    diff,
    hasVaziosManifest: Boolean(await getBaplieManifestForVoyage(voyageId)),
  }
  if (diff.items.length && !(await confirmReplacement(plan))) return { status: 'cancelled' }

  const { staged } = await importBaplieStaging(voyageId, containers, actorId)
  // As flags dependem só dos cheios do staging: aplicadas antes dos vazios, não
  // ficam para trás se o recadastro dos vazios falhar.
  const flagsError = await applyFlagsAfterStaging(voyageId, actorId)
  const vaziosReplaced = plan.hasVaziosManifest && diff.vaziosChanged
  if (vaziosReplaced) {
    try {
      await replaceVaziosFromBaplie({ voyageId, uploadedBy: actorId })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error)
      const flags = flagsError ? ` IMO/OOG também não foram aplicados aos B/Ls: ${flagsError}` : ''
      throw new Error(`Baplie importado, mas os vazios de importação não foram recadastrados: ${reason}${flags}`, { cause: error })
    }
  }
  return { status: diff.items.length ? 'replaced' : 'unchanged', staged, vaziosReplaced, flagsError }
}
