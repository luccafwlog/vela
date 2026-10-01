import { supabase } from './supabase'
import type { BaplieContainer } from './baplieParser'
import { getBaplieManifestForVoyage, replaceVaziosFromBaplie } from './vaziosImportacaoImport'

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

type BaplieDiffFields = Pick<BaplieContainer, 'container_number' | 'status' | 'size_type' | 'pol' | 'pod' | 'is_imo' | 'is_oog'>

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
  `${c.status === 'empty' ? 'vazio' : 'cheio'}, ${c.pol ?? '?'} → ${c.pod ?? '?'}${c.size_type ? `, ${c.size_type}` : ''}${c.is_imo ? ', IMO' : ''}${c.is_oog ? ', OOG' : ''}`

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
    .select('container_number, status, size_type, pol, pod, is_imo, is_oog')
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
  | { status: 'imported' | 'unchanged' | 'replaced'; staged: number; vaziosReplaced: boolean }

export function baplieImportToast(result: Exclude<BaplieReimportResult, { status: 'cancelled' }>): string {
  if (result.status === 'unchanged') {
    return `Baplie reimportado sem diferenças (${result.staged} container(s)). Vazios e Nº do manifesto Mercante mantidos.`
  }
  return `Baplie importado: ${result.staged} container(s) em staging.${result.vaziosReplaced ? ' Vazios de importação recadastrados.' : ''}`
}

/**
 * Importa ou reimporta o Baplie da viagem. Com Baplie anterior: sem diferença,
 * aceita sem perguntar e não toca nos vazios; com diferença, pede confirmação
 * e, se os vazios mudaram e já havia manifesto de vazios do Baplie, recadastra-os.
 * O Nº do manifesto Mercante (manifestos_mercante) não é apagado em nenhum caso.
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
    return { status: 'imported', staged, vaziosReplaced: false }
  }
  const diff = diffBaplieStaging(existingRows, containers)
  const plan: BaplieReimportPlan = {
    existing: existingRows.length,
    diff,
    hasVaziosManifest: Boolean(await getBaplieManifestForVoyage(voyageId)),
  }
  if (diff.items.length && !(await confirmReplacement(plan))) return { status: 'cancelled' }

  const { staged } = await importBaplieStaging(voyageId, containers, actorId)
  const vaziosReplaced = plan.hasVaziosManifest && diff.vaziosChanged
  if (vaziosReplaced) {
    try {
      await replaceVaziosFromBaplie({ voyageId, uploadedBy: actorId })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error)
      throw new Error(`Baplie importado, mas os vazios de importação não foram recadastrados: ${reason}`, { cause: error })
    }
  }
  return { status: diff.items.length ? 'replaced' : 'unchanged', staged, vaziosReplaced }
}
