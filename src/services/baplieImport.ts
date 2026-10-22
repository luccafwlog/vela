import { supabase } from './supabase'
import type { BaplieContainer, ParsedBaplie } from './baplieParser'
import type { ImportIssue } from './importValidation'
import { normalizeStoredPortCode } from './portCode'
import { canonicalizeVesselName } from '../lib/vesselAlias'
import { userFacingErrorMessage } from '../lib/errors'
import { getBaplieManifestForVoyage, listVoyageVaziosImportacao, replaceVaziosFromBaplie, vaziosContainerKey, type VoyageVazioImportacao } from './vaziosImportacaoImport'
import { toBaplieFlagsApplyResult, type BaplieFlagsApplyResult } from './baplieReconciliation'

export type BaplieVoyageContext = {
  voyageNumber: string | null
  vesselName: string | null
  /** Portos das escalas ativas da Viagem (`list_voyage_eligible_pods`, migration 190). */
  eligiblePods: string[]
}

export async function fetchBaplieVoyageContext(voyageId: number): Promise<BaplieVoyageContext> {
  // `get_voyage_eligible_pods` não tem GRANT para authenticated: a chamada
  // falhava e as regras da Viagem não rodavam. A versão guardada (usuário
  // interno ativo) devolve o mesmo `TABLE(pod text)`.
  const [voyage, pods] = await Promise.all([
    supabase.from('voyages').select('voyage_number, vessel:vessels(name)').eq('id', voyageId).maybeSingle(),
    supabase.rpc('list_voyage_eligible_pods' as never, { p_voyage_id: voyageId } as never),
  ])
  if (voyage.error) throw voyage.error
  if (pods.error) throw pods.error
  const row = voyage.data as unknown as {
    voyage_number?: string | null
    vessel?: { name?: string | null } | null
  } | null
  const eligible = ((pods.data ?? []) as unknown as Array<{ pod: string }>).map((item) => item.pod).filter(Boolean)
  return { voyageNumber: row?.voyage_number ?? null, vesselName: row?.vessel?.name ?? null, eligiblePods: eligible }
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

/** Container deixado de fora por descarregar fora das escalas da Viagem ou em porto não reconhecido. */
export type BaplieOutsidePod = { container_number: string; pod: string; reason: 'unrecognized' | 'outside_calls' }

/**
 * Regras do Baplie que dependem da Viagem escolhida (ADR 0078, item 21): o
 * TDT de outro navio bloqueia (o número de viagem não é conferido, ADR 0096); container com POD fora das escalas
 * da Viagem é ignorado com aviso. Sem escalas cadastradas, nada é filtrado.
 * O navio só bloqueia quando o nome vem da identificação do transporte (C222);
 * nome deduzido por heurística só avisa. Não há regra de outro armador: todo
 * container do arquivo entra (ADR 0096, decisão 3).
 */
export function applyBaplieVoyageRules(
  parsed: Pick<ParsedBaplie, 'containers' | 'issues' | 'voyage_number' | 'vessel_name' | 'vessel_name_source' | 'operator'> & Partial<Pick<ParsedBaplie, 'ignored_pods'>>,
  context: BaplieVoyageContext | null | undefined,
): { containers: BaplieContainer[]; pods: string[]; issues: ImportIssue[]; podsOutside: BaplieOutsidePod[] } {
  const issues: ImportIssue[] = [...parsed.issues]
  const podsOutside: BaplieOutsidePod[] = (parsed.ignored_pods ?? []).map((item) => ({ ...item, reason: 'unrecognized' }))
  let containers = parsed.containers
  if (context) {
    // O número de viagem do TDT não é conferido: o do armador não é o da
    // Viagem no Vela (ADR 0096, decisão 2; migration 409).
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
      // Régua do servidor (`_baplie_port_key`): BRNVT fora de uma escala BRITJ.
      const eligible = new Set(context.eligiblePods.map((pod) => normalizeStoredPortCode(pod)))
      const outside = containers.filter((c) => c.pod && !eligible.has(normalizeStoredPortCode(c.pod)))
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
    // Migration 410: o servidor confere o operador com os códigos do armador
    // (não grava) e grava o transbordo marcado.
    operator: c.operator ?? null,
    is_transshipment: Boolean(c.transshipment),
    imported_by: actorId ?? null,
  }))
}

/** O que a prévia leu do staging da Viagem; a gravação recusa se mudou (migration 388, F-20). */
export type BaplieStagingVersion = { count: number; max_id: number | null }

export function baplieStagingVersion(rows: Array<{ id: number }>): BaplieStagingVersion {
  return { count: rows.length, max_id: rows.length ? Math.max(...rows.map((row) => Number(row.id))) : null }
}

/**
 * O que a prévia leu e a gravação confere depois da trava da Viagem: a versão
 * do staging (388) e o manifesto de vazios do Baplie que o diálogo usou para
 * avisar da natureza e do Nº do manifesto Mercante (390; id e total, ou nulo).
 */
export type BaplieImportExpected = BaplieStagingVersion & {
  vazios_manifest: { id: string; total: number | null } | null
}

export function baplieImportExpected(
  rows: Array<{ id: number }>,
  vaziosManifest: { id: string; total_containers: number | null } | null | undefined,
): BaplieImportExpected {
  return {
    ...baplieStagingVersion(rows),
    vazios_manifest: vaziosManifest ? { id: vaziosManifest.id, total: vaziosManifest.total_containers ?? null } : null,
  }
}

/** Viagem do arquivo (TDT), só informativa: o servidor não a confere (ADR 0096, decisão 2). */
export type BaplieFileIdentity = {
  voyageNumber: string | null
}

type BaplieFileImportResult = {
  staged: number
  flags: BaplieFlagsApplyResult
  /** Recadastro dos vazios do Baplie na mesma transação; nulo quando os vazios não mudaram ou não havia. */
  vazios: { manifest_id: string | null; total: number } | null
}

/**
 * Grava o Baplie numa transação só (migration 388): confere Viagem, escalas,
 * PODs marcados (cada um com container no arquivo, 390), container repetido e o
 * que a prévia leu (`expected`), substitui só os PODs marcados, aplica as
 * marcas aos B/Ls e recadastra os vazios do Baplie quando mudaram. Qualquer
 * recusa ou falha desfaz tudo.
 */
export async function importBaplieFile(
  voyageId: number,
  containers: BaplieContainer[],
  { pods, expected, file }: { pods: string[]; expected: BaplieImportExpected; file: BaplieFileIdentity },
): Promise<BaplieFileImportResult> {
  const { data, error } = await supabase.rpc('import_baplie_file_atomic' as never, {
    p_voyage_id: voyageId,
    p_rows: toBaplieStagingRows(containers),
    p_pods: pods,
    p_expected: expected,
    p_file: { voyage_number: file.voyageNumber },
  } as never)
  if (error) throw error
  const result = (data ?? {}) as { staged?: number; flags?: unknown; vazios?: BaplieFileImportResult['vazios'] }
  return {
    staged: Number(result.staged ?? containers.length),
    flags: toBaplieFlagsApplyResult(result.flags),
    vazios: result.vazios ?? null,
  }
}

/**
 * Reimportar substitui só os portos de descarga marcados (ADR 0095, decisão
 * 11); os demais portos da Viagem ficam. Como todo Departamento importa
 * (decisão de 2026-09-23), a substituição com diferença pede confirmação; um
 * arquivo sem diferença é aceito direto (decisão de 2026-10-01).
 */
export function baplieReplacementMessage(existing: number, incoming: number, pods: string[] = []): string {
  if (!pods.length) {
    return `Esta viagem já tem um Baplie com ${existing} container(s). O arquivo novo, com ${incoming} container(s), substitui o anterior por inteiro.`
  }
  return `Esta viagem já tem ${existing} container(s) do Baplie em ${pods.join(', ')}. O arquivo novo, com ${incoming} container(s), substitui esses portos; os demais portos da viagem ficam como estão.`
}

/**
 * Linhas do staging que a gravação substitui, com a mesma regra do servidor
 * (`_baplie_row_replaced`, migration 388): POD marcado, container sem POD ou
 * container que o arquivo traz em outro POD. O POD é comparado pela régua do
 * banco (`normalizeStoredPortCode`, cópia de `normalize_port_code`, que é a
 * `_baplie_port_key` do servidor desde a migration 391).
 */
export function baplieRowsReplacedBy<T extends Pick<BaplieContainer, 'container_number' | 'pod'>>(
  existing: T[],
  incoming: Array<Pick<BaplieContainer, 'container_number'>>,
  pods: string[],
): T[] {
  const key = (pod: string) => normalizeStoredPortCode(pod) ?? ''
  const podKeys = new Set(pods.map(key))
  const incomingNumbers = new Set(incoming.map((c) => c.container_number.trim().toUpperCase()))
  return existing.filter((row) => !row.pod?.trim()
    || podKeys.has(key(row.pod))
    || incomingNumbers.has(row.container_number.trim().toUpperCase()))
}

type BaplieDiffFields = Pick<BaplieContainer, 'container_number' | 'status' | 'size_type' | 'pol' | 'pod' | 'is_imo' | 'is_oog' | 'ownership'>
  & { transshipment?: boolean; is_transshipment?: boolean | null }

export type BaplieReplacementDiff = {
  /** Uma linha legível por container incluído, removido ou alterado. */
  items: string[]
  added: number
  removed: number
  changed: number
  /** Os vazios (container + rota) mudaram: o manifesto de vazios do Baplie precisa ser recadastrado. */
  vaziosChanged: boolean
}

/** Transbordo vindo do arquivo (`transshipment`) ou do staging (`is_transshipment`). */
export const isBaplieTransshipment = (c: { transshipment?: boolean; is_transshipment?: boolean | null }) =>
  Boolean(c.transshipment || c.is_transshipment)

const describeContainer = (c: BaplieDiffFields) =>
  `${c.status === 'empty' ? 'vazio' : 'cheio'}, ${c.pol ?? '?'} → ${c.pod ?? '?'}${c.size_type ? `, ${c.size_type}` : ''}${c.is_imo ? ', IMO' : ''}${c.is_oog ? ', OOG' : ''}${c.ownership ? `, ${c.ownership}` : ''}${isBaplieTransshipment(c) ? ', transbordo' : ''}`

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

// Vazio em transbordo não é vazio de importação (decisão 15; migration 403).
function baplieEmptyKeys(list: Iterable<BaplieDiffFields>) {
  return vaziosKeys([...list].filter((c) => c.status === 'empty' && !isBaplieTransshipment(c)))
}

/**
 * Vazios do Baplie pendentes de recadastro (ADR 0092, item 5): o manifesto de
 * vazios vindo do Baplie não tem os mesmos containers e rotas que os vazios do
 * Baplie gravado. É o rastro persistido de um `vaziosError` — a falha em si não
 * fica gravada —, e /baplie oferece "Atualizar vazios do Baplie" com ele.
 *
 * ADR 0095, decisão 21 (migration 398): o container que uma planilha de Vazios
 * de importação trouxe fica com a planilha e não entra no manifesto do Baplie,
 * então sai da comparação (antes a planilha que substituiu uma rota do Baplie
 * aparecia como pendência falsa).
 */
export async function hasPendingBaplieVazios(voyageId: number, manifestId: string): Promise<boolean> {
  const [staging, registered, voyageVazios] = await Promise.all([
    listBaplieStagingForDiff(voyageId),
    listVaziosManifestKeys(manifestId),
    listVoyageVaziosImportacao(voyageId),
  ])
  const planilha = planilhaKeys(voyageVazios)
  return baplieEmptyKeys(staging.filter((c) => !planilha.has(vaziosContainerKey(c.container_number)))) !== vaziosKeys(registered)
}

function planilhaKeys(vazios: ReadonlyArray<VoyageVazioImportacao>) {
  return new Set(vazios.filter((row) => row.source !== 'baplie').map((row) => vaziosContainerKey(row.container_number)))
}

export type BaplieVaziosNaPlanilha = {
  /** Vazios do Baplie que ainda não estão em nenhuma planilha: os que o Baplie cadastra. */
  aCadastrar: number
  /** Vazios do Baplie que uma planilha já trouxe: ficam com a planilha. */
  naPlanilha: number
  /** "CONTAINER: Baplie A → B, planilha C → D", para os da planilha em outra rota. */
  rotaDiferente: string[]
}

/**
 * Diferença entre os vazios do Baplie e os da planilha de Vazios de
 * importação da Viagem (ADR 0095, decisão 21): a planilha vale, e o Baplie só
 * mostra a diferença.
 */
export function baplieVaziosNaPlanilha(
  staging: ReadonlyArray<Pick<BaplieContainer, 'container_number' | 'status' | 'pol' | 'pod'> & { is_transshipment?: boolean | null }>,
  vazios: ReadonlyArray<VoyageVazioImportacao>,
): BaplieVaziosNaPlanilha {
  const planilha = new Map(vazios.filter((row) => row.source !== 'baplie').map((row) => [vaziosContainerKey(row.container_number), row]))
  const route = (pol: string | null | undefined, pod: string | null | undefined) =>
    `${normalizeStoredPortCode(pol) ?? '?'} → ${normalizeStoredPortCode(pod) ?? '?'}`
  const seen = new Set<string>()
  let aCadastrar = 0
  let naPlanilha = 0
  const rotaDiferente: string[] = []
  for (const container of staging) {
    if (container.status !== 'empty' || isBaplieTransshipment(container)) continue
    const key = vaziosContainerKey(container.container_number)
    if (seen.has(key)) continue
    seen.add(key)
    const found = planilha.get(key)
    if (!found) {
      aCadastrar += 1
      continue
    }
    naPlanilha += 1
    if (route(container.pol, container.pod) !== route(found.pol, found.pod)) {
      rotaDiferente.push(`${container.container_number}: Baplie ${route(container.pol, container.pod)}, planilha ${route(found.pol, found.pod)}`)
    }
  }
  return { aCadastrar, naPlanilha, rotaDiferente: rotaDiferente.sort() }
}

export async function loadBaplieVaziosNaPlanilha(voyageId: number): Promise<BaplieVaziosNaPlanilha> {
  const [staging, vazios] = await Promise.all([listBaplieStagingForDiff(voyageId), listVoyageVaziosImportacao(voyageId)])
  return baplieVaziosNaPlanilha(staging, vazios)
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

type BaplieStagedRow = BaplieDiffFields & { id: number }

// Paginado: o PostgREST devolve no máximo 1000 linhas por chamada; um Baplie
// maior escondia containers da diferença. O `id` dá a versão que a gravação
// confere (`baplieStagingVersion`).
export async function listBaplieStagingForDiff(voyageId: number): Promise<BaplieStagedRow[]> {
  const PAGE = 1000
  const rows: BaplieStagedRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('baplie_containers')
      // `is_transshipment` é da migration 403 (tipos gerados protegidos).
      .select('id, container_number, status, size_type, pol, pod, is_imo, is_oog, ownership, is_transshipment' as 'id, container_number, status, size_type, pol, pod, is_imo, is_oog, ownership')
      .eq('voyage_id', voyageId)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as BaplieStagedRow[]))
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

/**
 * O que o arquivo novo faria nas marcas dos B/Ls, sem gravar (migration 182).
 * Com os PODs marcados, parte do staging que a gravação vai deixar (388).
 */
export async function previewBaplieFlags(voyageId: number, containers: BaplieContainer[], pods?: string[]): Promise<BaplieFlagsPreview> {
  const { data, error } = await supabase.rpc('preview_baplie_physical_flags' as never, {
    p_voyage_id: voyageId,
    p_rows: toBaplieStagingRows(containers),
    p_pods: pods ?? null,
  } as never)
  if (error) throw error
  const preview = (data ?? {}) as Partial<BaplieFlagsPreview>
  return { apply: preview.apply ?? [], clear: preview.clear ?? [], divergent_manual: preview.divergent_manual ?? [] }
}

export type BaplieReimportPlan = {
  /** Containers do Baplie gravado que o arquivo substitui (só os dos PODs marcados). */
  existing: number
  /** PODs marcados no modal: só eles são substituídos. */
  pods?: string[]
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
    message: baplieReplacementMessage(plan.existing, incoming, plan.pods),
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
      /**
       * Baplie gravado, mas IMO/OOG não chegaram aos B/Ls. Desde a migration
       * 388 staging e marcas são uma transação e a importação devolve sempre
       * nulo; o campo fica para o aviso de pendência que a tela já tem.
       */
      flagsError: string | null
      /** O que foi aplicado e onde, as marcas que caíram e as faturas reemitidas. */
      flags?: BaplieFlagsSummary | null
      /**
       * Baplie gravado, mas o recadastro dos vazios falhou. Desde a migration
       * 388 o recadastro é da mesma transação e a importação devolve sempre
       * nulo; pendência gravada antes dela é refeita por `retryBaplieVazios`.
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
 * Refaz só o recadastro dos vazios a partir do Baplie já gravado (após
 * `vaziosError`). Devolve quantos vazios ficaram: 0 quer dizer que o Baplie não
 * traz vazios e os do Baplie anterior saíram (migration 336).
 */
export async function retryBaplieVazios({ voyageId, actorId }: { voyageId: number; actorId: string }): Promise<number> {
  const { total } = await replaceVaziosFromBaplie({ voyageId, uploadedBy: actorId })
  return total
}

/**
 * Importa ou reimporta o Baplie da viagem, substituindo só os PODs marcados
 * (`pods`; ADR 0095, decisão 11). Com Baplie anterior nesses portos: sem
 * diferença, aceita sem perguntar; com diferença, pede confirmação. A gravação
 * é uma transação só (migration 388): staging, marcas IMO/OOG e SOC/COC nos
 * B/Ls e, se os vazios mudaram e já havia manifesto de vazios do Baplie, o
 * recadastro deles; o Nº do manifesto Mercante das rotas que continuam com
 * container fica. A versão do staging e o manifesto de vazios lidos aqui vão
 * junto: outra importação ou outro recadastro dos vazios gravado depois desta
 * prévia faz o servidor recusar (F-20; migrations 388 e 390).
 */
export async function reimportBaplie({
  voyageId,
  containers,
  pods,
  file,
  confirmReplacement,
}: {
  voyageId: number
  containers: BaplieContainer[]
  pods: string[]
  file: BaplieFileIdentity
  confirmReplacement: (plan: BaplieReimportPlan) => Promise<boolean>
}): Promise<BaplieReimportResult> {
  // O manifesto de vazios lido aqui é o do diálogo e vai junto: recadastro,
  // criação ou exclusão dele por outra sessão faz o servidor recusar (390).
  const [stagedRows, vaziosManifest] = await Promise.all([listBaplieStagingForDiff(voyageId), getBaplieManifestForVoyage(voyageId)])
  const expected = baplieImportExpected(stagedRows, vaziosManifest)
  const existingRows = baplieRowsReplacedBy(stagedRows, containers, pods)
  const write = async () => {
    const result = await importBaplieFile(voyageId, containers, { pods, expected, file })
    return {
      staged: result.staged,
      flags: summarizeBaplieFlags(result.flags),
      vaziosReplaced: Boolean(result.vazios && result.vazios.total > 0),
      vaziosRemoved: Boolean(result.vazios && result.vazios.total === 0),
      flagsError: null,
      vaziosError: null,
    }
  }
  if (!existingRows.length) return { status: 'imported', ...(await write()) }

  const diff = diffBaplieStaging(existingRows, containers)
  const plan: BaplieReimportPlan = {
    existing: existingRows.length,
    pods,
    diff,
    hasVaziosManifest: Boolean(vaziosManifest),
    vaziosManifestTotal: vaziosManifest?.total_containers ?? 0,
    // Vazios que a Viagem terá: os dos PODs não marcados ficam.
    incomingEmpties: containers.filter((container) => container.status === 'empty' && !isBaplieTransshipment(container)).length
      + stagedRows.filter((row) => row.status === 'empty' && !isBaplieTransshipment(row) && !existingRows.includes(row)).length,
    // Baplie completo nos PODs marcados (ADR 0078, item 21): o que sai apaga
    // as marcas vindas do Baplie anterior, listadas antes de confirmar.
    flags: await previewBaplieFlags(voyageId, containers, pods),
  }
  if ((diff.items.length || plan.flags?.clear.length) && !(await confirmReplacement(plan))) return { status: 'cancelled' }

  return { status: diff.items.length ? 'replaced' : 'unchanged', ...(await write()) }
}
