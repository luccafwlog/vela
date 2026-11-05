// Leitura dos dados de uma rota da Viagem para o EDI Mercante (issue #560).
// Só lê: B/Ls ativos da rota, contêineres, itens de carga solta, veículos, Frete
// & Despesas, terminal da frente de operação no POD, ATD no POL, ETA no POD e
// Vazios de Importação. A montagem do arquivo fica em `mercanteEdi.ts`.

import { supabase } from './supabase'
import { normalizePortCode } from './portCode'
import {
  buildVoyagePodEntityId,
  buildVoyagePolEntityId,
  listVoyagePodSchedules,
  listVoyagePolSchedules,
} from './voyageRouteSchedules'
import { MERCANTE_CARRIER_CODE, MERCANTE_TERMINAL_CODE } from './mercanteEdiTables'
import { blTotalCbm } from '../lib/cargoMode'
import type {
  MercanteEdiBl,
  MercanteEdiBreakbulkItem,
  MercanteEdiContainer,
  MercanteEdiFreightLine,
  MercanteEdiHeader,
  MercanteEdiVazio,
  MercanteEdiVehicle,
} from './mercanteEdi'

const PAGE_SIZE = 1000
const IN_CHUNK = 200

export type MercanteEdiContext = {
  vesselName: string
  voyageNumber: string
  /** A Viagem tem Baplie importado: o IMO dos contêineres foi conferido com ele. */
  hasBaplie: boolean
}

export type MercanteCargoInput = MercanteEdiContext & {
  header: MercanteEdiHeader
  bls: MercanteEdiBl[]
  /** B/Ls da rota que ficam no outro arquivo (no de contêiner: carga solta e misto). */
  skippedBls: Array<{ id: string; reason: string }>
}

export type MercanteVaziosInput = MercanteEdiContext & {
  header: MercanteEdiHeader
  vazios: MercanteEdiVazio[]
}

/**
 * Rota da Viagem compara portos pelo código normalizado (BRVIT = BRVIX), o
 * mesmo de `collectVoyageManifestBatchRows`, que monta as linhas da aba.
 */
const portKey = (value: unknown) => {
  const raw = String(value ?? '').trim().toUpperCase()
  return normalizePortCode(raw) ?? raw
}

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>

/** Lê todas as páginas de uma consulta tipada (o PostgREST devolve até 1.000 linhas). */
async function readAll<T>(fetchPage: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

/**
 * `.in()` em blocos de ids, cada bloco paginado. A ordem da consulta tem de ser
 * única (ex.: `bl_id` + `seq`): com empate, a paginação por OFFSET pode repetir
 * ou pular linhas entre páginas.
 */
async function readByIds<T>(ids: string[], fetchPage: (chunk: string[], from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = []
  for (let index = 0; index < ids.length; index += IN_CHUNK) {
    const chunk = ids.slice(index, index + IN_CHUNK)
    rows.push(...await readAll((from, to) => fetchPage(chunk, from, to)))
  }
  return rows
}

const text = (value: unknown) => (typeof value === 'string' ? value : null)
const num = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value))
const containerKey = (value: unknown) => String(value ?? '').trim().toUpperCase()

/** Código de cada terminal (depots), em maiúsculas, pelo id. */
async function readDepotCodes(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('depots').select('id, code')
  if (error) throw error
  return new Map((data ?? []).map((depot) => [depot.id, (depot.code ?? '').toUpperCase()]))
}

/**
 * Frentes de operação de importação no POD que dão o terminal: carga cheia para
 * o arquivo de contêiner (a mesma que `resolve_bl_terminal_id` usa no B/L sem
 * exceção), carga solta para o parcial e vazio para o de vazios. Há no máximo
 * uma por porto e modalidade (`uq_voyage_escala_operation_front`).
 */
type FrontKind = 'carga_cheia' | 'carga_solta' | 'vazio'

async function readHeader(voyageId: number, pol: string, pod: string, frontKind: FrontKind) {
  const polEntity = buildVoyagePolEntityId(voyageId, pol)
  const podEntity = buildVoyagePodEntityId(voyageId, pod)
  const [voyageResult, polSchedules, podSchedules, frontsResult, baplieResult, depotCodes] = await Promise.all([
    supabase.from('voyages').select('id, voyage_number, vessel:vessels(name, imo, carrier:carriers(scac))').eq('id', voyageId).single(),
    listVoyagePolSchedules([polEntity]),
    listVoyagePodSchedules([podEntity]),
    supabase.from('voyage_escala_operation_fronts').select('port, modalidade, terminal_id').eq('voyage_id', voyageId).eq('sentido', 'importacao'),
    supabase.from('baplie_containers').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId),
    readDepotCodes(),
  ])
  if (voyageResult.error) throw voyageResult.error
  if (frontsResult.error) throw frontsResult.error
  if (baplieResult.error) throw baplieResult.error

  // O embed aninhado (vessel → carrier) não é inferido pelos tipos gerados.
  const voyage = voyageResult.data as unknown as { voyage_number: string | null; vessel: { name: string; imo: string | null; carrier: { scac: string | null } | null } | null }
  // Código do terminal (no Vela) de cada frente de importação do POD, por modalidade.
  const podFronts = new Map<string, string>()
  for (const front of frontsResult.data ?? []) {
    if (portKey(front.port) === portKey(pod) && front.terminal_id) podFronts.set(front.modalidade, depotCodes.get(front.terminal_id) ?? '')
  }
  const scac = (voyage.vessel?.carrier?.scac ?? '').toUpperCase()
  const terminalDepot = podFronts.get(frontKind) ?? ''

  const context: MercanteEdiContext = {
    vesselName: voyage.vessel?.name ?? '',
    voyageNumber: voyage.voyage_number ?? '',
    hasBaplie: (baplieResult.count ?? 0) > 0,
  }
  const header: MercanteEdiHeader = {
    carrierCode: MERCANTE_CARRIER_CODE[scac] ?? null,
    closingDate: polSchedules.get(polEntity)?.atd ?? null,
    operationDate: podSchedules.get(podEntity)?.eta ?? null,
    pol: portKey(pol),
    pod: portKey(pod),
    voyageNumber: voyage.voyage_number ?? '',
    vesselImo: voyage.vessel?.imo ?? null,
    terminalCode: MERCANTE_TERMINAL_CODE[terminalDepot] ?? null,
    terminalDepot: terminalDepot || null,
  }
  return { ...context, header, depotCodes, podFronts }
}

const BL_COLUMNS = 'id, pol, pod, cargo_mode, cancelled_at, consignee, consignee_block, manifest_customer_cnpj_cpf, shipper, shipper_block, notify_party, notify_block, notify_cnpj_cpf, bl_emission_date, cargo_description, total_packages, bb_packages_total, packages_unit, total_cbm, bb_cbm, bb_weight_ton, movement_from, ncm_codes, terminal_id' as const

type BlRow = {
  cargo_description: string | null
  packages_unit: string | null
  shipper: string | null
  bb_weight_ton: number | null
  bb_packages_total: number | null
  bb_cbm: number | null
}

/**
 * Item de carga solta com os totais do B/L, para o B/L sem linhas de item (o
 * Manifesto BB no layout resumido grava só os totais; no misto, os `bb_*` são
 * só a parte de carga solta). Sem total nenhum, não há item: o gerador pede o
 * item em "A completar".
 */
function itemFromBlTotals(bl: BlRow): MercanteEdiBreakbulkItem | null {
  const weightTon = num(bl.bb_weight_ton)
  const grossKg = weightTon === null ? null : weightTon * 1000
  const quantity = num(bl.bb_packages_total)
  const cbm = num(bl.bb_cbm)
  if (grossKg === null && quantity === null && cbm === null) return null
  return {
    description: text(bl.cargo_description),
    quantity,
    unit: text(bl.packages_unit),
    grossKg,
    cbm,
    marks: text(bl.shipper),
    fromTotals: true,
  }
}

/** Números de contêiner do Baplie da Viagem: o IMO só vale com essa confirmação. */
async function readBaplieNumbers(voyageId: number): Promise<Set<string>> {
  const rows = await readAll((from, to) => supabase
    .from('baplie_containers')
    .select('id, container_number')
    .eq('voyage_id', voyageId)
    .order('id')
    .range(from, to))
  return new Set(rows.map((row) => containerKey(row.container_number)))
}

/**
 * Terminal do B/L sem exceção quando ele não é o do cabeçalho: o B/L misto só
 * tem terminal se as frentes de carga cheia e de carga solta forem o mesmo
 * terminal (`resolve_bl_terminal_id`, migration `059`); senão, fica pendente.
 */
function mixedTerminalIssue(cargoMode: string | null, podFronts: Map<string, string>): string | null {
  if (cargoMode !== 'misto') return null
  const cheia = podFronts.get('carga_cheia')
  const solta = podFronts.get('carga_solta')
  if (cheia && solta && cheia === solta) return null
  if (!cheia && !solta) return null // sem frente: o cabeçalho já diz o que falta
  return `B/L misto sem terminal definido: a frente de carga cheia (${cheia || 'sem terminal'}) e a de carga solta (${solta || 'sem terminal'}) não são o mesmo terminal. Defina a exceção de terminal do B/L.`
}

/**
 * B/Ls ativos da rota com `cargo_mode` em `modes`, no formato do gerador. Os
 * contêineres de todos os B/Ls ativos da Viagem são lidos para marcar o
 * contêiner dividido (uso parcial: o número em mais de um B/L ativo).
 * Itens de carga solta e veículos fora de contêiner só no arquivo parcial.
 */
async function readRouteBls(
  voyageId: number,
  pol: string,
  pod: string,
  modes: ReadonlySet<string>,
  context: { depotCodes: Map<string, string>; podFronts: Map<string, string> },
  withBreakbulk: boolean,
) {
  const voyageBls = await readAll((from, to) => supabase
    .from('bls')
    .select(BL_COLUMNS)
    .eq('voyage_id', voyageId)
    .order('id')
    .range(from, to))
  const active = voyageBls.filter((bl) => !bl.cancelled_at)
  const routeBls = active.filter((bl) => portKey(bl.pol) === portKey(pol) && portKey(bl.pod) === portKey(pod))
  const selected = routeBls.filter((bl) => modes.has(String(bl.cargo_mode)))
  const others = routeBls.filter((bl) => !modes.has(String(bl.cargo_mode)))
  const selectedIds = selected.map((bl) => bl.id)

  const [allContainers, baplieNumbers, freightRows, itemRows, vehicleRows] = await Promise.all([
    readByIds(active.map((bl) => bl.id), (chunk, from, to) => supabase
      .from('bl_containers')
      .select('id, bl_id, container_number, type, gross_weight_kg, tare_weight_kg, cbm, seal_number, is_imo, imo_class, un_number, profile_source')
      .in('bl_id', chunk)
      .order('id')
      .range(from, to)),
    readBaplieNumbers(voyageId),
    readByIds(selectedIds, (chunk, from, to) => supabase
      .from('bl_freight_lines')
      .select('bl_id, seq, category, description, currency, amount, payment')
      .in('bl_id', chunk)
      .order('bl_id')
      .order('seq')
      .range(from, to)),
    withBreakbulk
      ? readByIds(selectedIds, (chunk, from, to) => supabase
        .from('bl_breakbulk_items')
        .select('id, bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks')
        .in('bl_id', chunk)
        .order('id')
        .range(from, to))
      : Promise.resolve([]),
    withBreakbulk
      ? readByIds(selectedIds, (chunk, from, to) => supabase
        .from('vehicles')
        .select('id, bl_id, container_id, chassis, weight_kg, brand, model')
        .in('bl_id', chunk)
        .order('id')
        .range(from, to))
      : Promise.resolve([]),
  ])
  const blsPerContainer = new Map<string, Set<string>>()
  for (const container of allContainers) {
    const key = containerKey(container.container_number)
    blsPerContainer.set(key, (blsPerContainer.get(key) ?? new Set()).add(container.bl_id))
  }

  const bls: MercanteEdiBl[] = selected.map((bl) => {
    const id = bl.id
    const warnings: string[] = []
    const containers: MercanteEdiContainer[] = allContainers
      .filter((container) => container.bl_id === id)
      .sort((left, right) => Number(left.id) - Number(right.id))
      .map((container) => {
        const number = containerKey(container.container_number)
        // IMO só confirmado pelo Baplie (o Baplie gravou o perfil, ou o
        // contêiner está no Baplie e ele concordou) ou corrigido à mão. O
        // importador de B/L grava a declaração do B/L em todos os contêineres
        // dele; essa declaração sozinha não vai ao manifesto (decisão do dono).
        const confirmed = container.profile_source === 'baplie' || container.profile_source === 'manual' || baplieNumbers.has(number)
        const isImo = Boolean(container.is_imo) && confirmed
        return {
          number,
          type: text(container.type),
          grossKg: num(container.gross_weight_kg),
          tareKg: num(container.tare_weight_kg),
          cbm: num(container.cbm),
          seal: text(container.seal_number),
          isImo,
          imoClass: isImo ? text(container.imo_class) : null,
          unNumber: isImo ? text(container.un_number) : null,
          shared: (blsPerContainer.get(number)?.size ?? 0) > 1,
          imoUnconfirmed: Boolean(container.is_imo) && !confirmed,
        }
      })
    const freightLines: MercanteEdiFreightLine[] = freightRows
      .filter((line) => line.bl_id === id)
      .map((line) => ({
        category: text(line.category),
        description: text(line.description),
        currency: text(line.currency),
        amount: num(line.amount),
        payment: text(line.payment),
      }))
    const breakbulkItems: MercanteEdiBreakbulkItem[] = itemRows
      .filter((item) => item.bl_id === id)
      .map((item) => ({
        description: text(item.item_description),
        quantity: num(item.package_qty),
        unit: text(item.package_unit),
        grossKg: num(item.gross_weight_kg),
        cbm: num(item.cbm),
        marks: text(item.marks),
      }))
    // Veículo dentro de contêiner já está no I5 do contêiner.
    const vehicles: MercanteEdiVehicle[] = vehicleRows
      .filter((vehicle) => vehicle.bl_id === id && !vehicle.container_id)
      .map((vehicle) => ({
        chassis: text(vehicle.chassis),
        grossKg: num(vehicle.weight_kg),
        brand: text(vehicle.brand),
        model: text(vehicle.model),
      }))
    if (withBreakbulk && !breakbulkItems.length) {
      const fromTotals = itemFromBlTotals(bl)
      // Com veículos fora de contêiner, os totais do B/L provavelmente já os
      // contam: o item dos totais duplicaria o peso.
      if (fromTotals && vehicles.length) {
        warnings.push('Totais de carga solta do B/L não viraram item porque o B/L tem veículos: confira se falta carga solta além dos veículos.')
      } else if (fromTotals) {
        breakbulkItems.push(fromTotals)
      }
    }
    const containerCbm = containers.every((container) => container.cbm === null) ? null : containers.reduce((total, container) => total + (container.cbm ?? 0), 0)
    const totalCbm = bl.total_cbm == null && bl.bb_cbm == null ? containerCbm : blTotalCbm(bl)
    const terminalDepot = bl.terminal_id ? context.depotCodes.get(bl.terminal_id) ?? '' : ''
    return {
      id,
      // Carga solta (Manifesto BB, B/L avulso) só tem o nome curto das partes.
      consigneeBlock: text(bl.consignee_block) || text(bl.consignee),
      consigneeCnpj: text(bl.manifest_customer_cnpj_cpf),
      shipperBlock: text(bl.shipper_block) || text(bl.shipper),
      notifyBlock: text(bl.notify_block) || text(bl.notify_party),
      notifyCnpj: text(bl.notify_cnpj_cpf),
      emissionDate: text(bl.bl_emission_date),
      description: text(bl.cargo_description),
      totalPackages: num(bl.total_packages) ?? num(bl.bb_packages_total),
      packagesUnit: text(bl.packages_unit),
      // Contêiner + carga solta (`blTotalCbm`); sem nenhuma das duas, a soma dos contêineres.
      totalCbm,
      movementFrom: text(bl.movement_from),
      ncmCodes: Array.isArray(bl.ncm_codes) ? bl.ncm_codes : [],
      freightLines,
      terminalCode: terminalDepot ? MERCANTE_TERMINAL_CODE[terminalDepot] ?? null : null,
      terminalDepot: terminalDepot || null,
      terminalIssue: terminalDepot ? null : mixedTerminalIssue(bl.cargo_mode, context.podFronts),
      containers,
      breakbulkItems,
      vehicles,
      warnings,
    }
  })
  return { bls, others }
}

/** Dados de uma rota de carga em contêiner (linha CNTR de Rotas e Manifestos). */
export async function loadMercanteCargoInput(voyageId: number, pol: string, pod: string): Promise<MercanteCargoInput> {
  const { header, depotCodes, podFronts, ...context } = await readHeader(voyageId, pol, pod, 'carga_cheia')
  const { bls, others } = await readRouteBls(voyageId, pol, pod, new Set(['container']), { depotCodes, podFronts }, false)
  const skippedBls = others.map((bl) => ({
    id: bl.id,
    reason: bl.cargo_mode === 'misto' ? 'B/L misto (contêiner e carga solta)' : 'carga solta',
  }))
  return { ...context, header, bls, skippedBls }
}

/**
 * Dados do arquivo parcial de carga solta de uma rota (linha BB): B/Ls
 * de carga solta e mistos. O terminal do manifesto é o da frente de carga solta.
 */
export async function loadMercanteBreakbulkInput(voyageId: number, pol: string, pod: string): Promise<MercanteCargoInput> {
  const { header, depotCodes, podFronts, ...context } = await readHeader(voyageId, pol, pod, 'carga_solta')
  const { bls } = await readRouteBls(voyageId, pol, pod, new Set(['carga_solta', 'misto']), { depotCodes, podFronts }, true)
  return { ...context, header, bls, skippedBls: [] }
}

/** Dados de uma rota de vazios (linha VAZIOS de Rotas e Manifestos). */
export async function loadMercanteVaziosInput(voyageId: number, pol: string, pod: string): Promise<MercanteVaziosInput> {
  const { header, vesselName, voyageNumber, hasBaplie } = await readHeader(voyageId, pol, pod, 'vazio')
  const rows = await readAll((from, to) => supabase
    .from('vazios_importacao_containers')
    .select('id, container_number, container_type, tare_kg, pol, pod, manifest:vazios_importacao_manifests!inner(voyage_id)')
    .eq('manifest.voyage_id', voyageId)
    .order('id')
    .range(from, to))
  // Mesma régua de `useVaziosImportacaoStats`, que monta a linha VAZIOS: POL sem
  // porto reconhecido vira '-' (e a linha fica sem botão).
  const vazios = rows
    .filter((row) => (normalizePortCode(text(row.pol)) ?? '-') === portKey(pol) && normalizePortCode(text(row.pod)) === portKey(pod))
    .map((row) => ({
      number: containerKey(row.container_number),
      type: text(row.container_type),
      tareKg: num(row.tare_kg),
    }))
    .sort((left, right) => left.number.localeCompare(right.number))
  return { vesselName, voyageNumber, hasBaplie, header, vazios }
}
