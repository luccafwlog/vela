// Leitura dos dados de uma rota da Viagem para o EDI Mercante (issue #560).
// Só lê: B/Ls ativos da rota, contêineres, itens de carga solta, veículos, Frete
// & Despesas, terminal da frente de operação no POD, ATD no POL, ETA no POD e
// Vazios de Importação. A montagem
// do arquivo fica em `mercanteEdi.ts`.

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

type Row = Record<string, unknown>

/**
 * Rota da Viagem compara portos pelo código normalizado (BRVIT = BRVIX), o
 * mesmo de `collectVoyageManifestBatchRows`, que monta as linhas da aba.
 */
const portKey = (value: unknown) => {
  const raw = String(value ?? '').trim().toUpperCase()
  return normalizePortCode(raw) ?? raw
}

async function readAll(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as Row[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

async function readByIds(table: string, columns: string, column: string, ids: string[], order: string): Promise<Row[]> {
  const rows: Row[] = []
  for (let index = 0; index < ids.length; index += IN_CHUNK) {
    const chunk = ids.slice(index, index + IN_CHUNK)
    rows.push(...await readAll((from, to) => (supabase.from as unknown as (name: string) => ReturnType<typeof supabase.from>)(table)
      .select(columns)
      .in(column, chunk)
      .order(order)
      .range(from, to) as unknown as PromiseLike<{ data: unknown; error: unknown }>))
  }
  return rows
}

const text = (value: unknown) => (typeof value === 'string' ? value : null)
const num = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value))

/** Código de cada terminal (depots), em maiúsculas, pelo id. */
async function readDepotCodes(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('depots').select('id, code')
  if (error) throw error
  return new Map(((data ?? []) as Array<{ id: string; code: string | null }>).map((depot) => [depot.id, (depot.code ?? '').toUpperCase()]))
}

/**
 * Frente de operação de importação no POD que dá o terminal do manifesto: a de
 * carga cheia para o arquivo de contêiner (a mesma que `resolve_bl_terminal_id`
 * usa para o B/L sem exceção) e a de vazios para o de vazios. Há no máximo uma
 * por porto e modalidade (`uq_voyage_escala_operation_front`).
 */
type FrontKind = 'carga_cheia' | 'carga_solta' | 'vazio'

async function readHeader(voyageId: number, pol: string, pod: string, frontKind: FrontKind): Promise<{ header: MercanteEdiHeader; depotCodes: Map<string, string> } & MercanteEdiContext> {
  const polEntity = buildVoyagePolEntityId(voyageId, pol)
  const podEntity = buildVoyagePodEntityId(voyageId, pod)
  const [voyageResult, polSchedules, podSchedules, frontsResult, baplieResult, depotCodes] = await Promise.all([
    supabase.from('voyages').select('id, voyage_number, vessel:vessels(name, imo, carrier:carriers(scac))').eq('id', voyageId).single(),
    listVoyagePolSchedules([polEntity]),
    listVoyagePodSchedules([podEntity]),
    supabase.from('voyage_escala_operation_fronts').select('port, terminal_id').eq('voyage_id', voyageId).eq('sentido', 'importacao').eq('modalidade', frontKind),
    supabase.from('baplie_containers').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId),
    readDepotCodes(),
  ])
  if (voyageResult.error) throw voyageResult.error
  if (frontsResult.error) throw frontsResult.error
  if (baplieResult.error) throw baplieResult.error

  const voyage = voyageResult.data as unknown as { voyage_number: string; vessel: { name: string; imo: string | null; carrier: { scac: string | null } | null } | null }
  const fronts = (frontsResult.data ?? []) as unknown as Array<{ port: string; terminal_id: string | null }>
  const podFront = fronts.find((front) => portKey(front.port) === portKey(pod) && front.terminal_id)
  const scac = (voyage.vessel?.carrier?.scac ?? '').toUpperCase()
  const terminalDepot = podFront?.terminal_id ? depotCodes.get(podFront.terminal_id) ?? '' : ''

  return {
    vesselName: voyage.vessel?.name ?? '',
    voyageNumber: voyage.voyage_number ?? '',
    hasBaplie: (baplieResult.count ?? 0) > 0,
    depotCodes,
    header: {
      carrierCode: MERCANTE_CARRIER_CODE[scac] ?? null,
      closingDate: polSchedules.get(polEntity)?.atd ?? null,
      operationDate: podSchedules.get(podEntity)?.eta ?? null,
      pol: portKey(pol),
      pod: portKey(pod),
      voyageNumber: voyage.voyage_number ?? '',
      vesselImo: voyage.vessel?.imo ?? null,
      terminalCode: MERCANTE_TERMINAL_CODE[terminalDepot] ?? null,
      terminalDepot: terminalDepot || null,
    },
  }
}

const BL_COLUMNS = 'id, pol, pod, cargo_mode, cancelled_at, consignee, consignee_block, manifest_customer_cnpj_cpf, shipper, shipper_block, notify_party, notify_block, notify_cnpj_cpf, bl_emission_date, cargo_description, total_packages, bb_packages_total, packages_unit, total_cbm, bb_cbm, bb_weight_ton, movement_from, ncm_codes, terminal_id'

/**
 * Item de carga solta com os totais do B/L, para o B/L sem linhas de item (o
 * Manifesto BB no layout resumido grava só os totais). Sem total nenhum, não
 * há item: o gerador pede o item em "A completar".
 */
function itemFromBlTotals(bl: Row): MercanteEdiBreakbulkItem | null {
  const grossKg = num(bl.bb_weight_ton) === null ? null : Number(bl.bb_weight_ton) * 1000
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

/**
 * B/Ls ativos da rota com `cargo_mode` em `modes`, no formato do gerador. Os
 * contêineres de todos os B/Ls ativos da Viagem são lidos para marcar o
 * contêiner dividido (uso parcial: o número em mais de um B/L ativo).
 * Itens de carga solta e veículos fora de contêiner só no arquivo parcial.
 */
async function readRouteBls(voyageId: number, pol: string, pod: string, modes: ReadonlySet<string>, depotCodes: Map<string, string>, withBreakbulk: boolean) {
  const voyageBls = await readAll((from, to) => supabase
    .from('bls')
    .select(BL_COLUMNS)
    .eq('voyage_id', voyageId)
    .order('id')
    .range(from, to) as unknown as PromiseLike<{ data: unknown; error: unknown }>)
  const active = voyageBls.filter((bl) => !bl.cancelled_at)
  const routeBls = active.filter((bl) => portKey(bl.pol) === portKey(pol) && portKey(bl.pod) === portKey(pod))
  const selected = routeBls.filter((bl) => modes.has(String(bl.cargo_mode)))
  const others = routeBls.filter((bl) => !modes.has(String(bl.cargo_mode)))
  const selectedIds = selected.map((bl) => String(bl.id))

  const allContainers = await readByIds('bl_containers', 'id, bl_id, container_number, type, gross_weight_kg, tare_weight_kg, cbm, seal_number, is_imo, imo_class, un_number', 'bl_id', active.map((bl) => String(bl.id)), 'id')
  const blsPerContainer = new Map<string, Set<string>>()
  for (const container of allContainers) {
    const key = String(container.container_number ?? '').trim().toUpperCase()
    blsPerContainer.set(key, (blsPerContainer.get(key) ?? new Set()).add(String(container.bl_id)))
  }
  const [freightRows, itemRows, vehicleRows] = await Promise.all([
    readByIds('bl_freight_lines', 'bl_id, seq, category, description, currency, amount, payment', 'bl_id', selectedIds, 'seq'),
    withBreakbulk ? readByIds('bl_breakbulk_items', 'id, bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks', 'bl_id', selectedIds, 'id') : Promise.resolve([]),
    withBreakbulk ? readByIds('vehicles', 'id, bl_id, container_id, chassis, weight_kg, brand, model', 'bl_id', selectedIds, 'id') : Promise.resolve([]),
  ])

  const bls: MercanteEdiBl[] = selected.map((bl) => {
    const id = String(bl.id)
    const containers: MercanteEdiContainer[] = allContainers
      .filter((container) => container.bl_id === id)
      .sort((left, right) => Number(left.id) - Number(right.id))
      .map((container) => ({
        number: String(container.container_number ?? '').trim().toUpperCase(),
        type: text(container.type),
        grossKg: num(container.gross_weight_kg),
        tareKg: num(container.tare_weight_kg),
        cbm: num(container.cbm),
        seal: text(container.seal_number),
        isImo: Boolean(container.is_imo),
        imoClass: text(container.imo_class),
        unNumber: text(container.un_number),
        shared: (blsPerContainer.get(String(container.container_number ?? '').trim().toUpperCase())?.size ?? 0) > 1,
      }))
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
    if (withBreakbulk && !breakbulkItems.length && bl.cargo_mode === 'carga_solta') {
      const fromTotals = itemFromBlTotals(bl)
      if (fromTotals) breakbulkItems.push(fromTotals)
    }
    // Veículo dentro de contêiner já está no I5 do contêiner.
    const vehicles: MercanteEdiVehicle[] = vehicleRows
      .filter((vehicle) => vehicle.bl_id === id && !vehicle.container_id)
      .map((vehicle) => ({
        chassis: text(vehicle.chassis),
        grossKg: num(vehicle.weight_kg),
        brand: text(vehicle.brand),
        model: text(vehicle.model),
      }))
    const terminalDepot = typeof bl.terminal_id === 'string' ? depotCodes.get(bl.terminal_id) ?? '' : ''
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
      // Contêiner + carga solta (`blTotalCbm`); nulo só quando o B/L não tem nenhuma.
      totalCbm: bl.total_cbm == null && bl.bb_cbm == null ? null : blTotalCbm(bl as { total_cbm: number | null; bb_cbm: number | null }),
      movementFrom: text(bl.movement_from),
      ncmCodes: Array.isArray(bl.ncm_codes) ? (bl.ncm_codes as string[]) : [],
      freightLines,
      terminalCode: terminalDepot ? MERCANTE_TERMINAL_CODE[terminalDepot] ?? null : null,
      terminalDepot: terminalDepot || null,
      containers,
      breakbulkItems,
      vehicles,
    }
  })
  return { bls, others }
}

/** Dados de uma rota de carga em contêiner (linha CNTR ou CNTR/BB de Rotas e Manifestos). */
export async function loadMercanteCargoInput(voyageId: number, pol: string, pod: string): Promise<MercanteCargoInput> {
  const { depotCodes, ...head } = await readHeader(voyageId, pol, pod, 'carga_cheia')
  const { bls, others } = await readRouteBls(voyageId, pol, pod, new Set(['container']), depotCodes, false)
  const skippedBls = others.map((bl) => ({
    id: String(bl.id),
    reason: bl.cargo_mode === 'misto' ? 'B/L misto (contêiner e carga solta)' : 'carga solta',
  }))
  return { ...head, bls, skippedBls }
}

/**
 * Dados do arquivo parcial de carga solta de uma rota (linha BB ou CNTR/BB): B/Ls
 * de carga solta e mistos. O terminal do manifesto é o da frente de carga solta.
 */
export async function loadMercanteBreakbulkInput(voyageId: number, pol: string, pod: string): Promise<MercanteCargoInput> {
  const { depotCodes, ...head } = await readHeader(voyageId, pol, pod, 'carga_solta')
  const { bls } = await readRouteBls(voyageId, pol, pod, new Set(['carga_solta', 'misto']), depotCodes, true)
  return { ...head, bls, skippedBls: [] }
}

/** Dados de uma rota de vazios (linha VAZIOS de Rotas e Manifestos). */
export async function loadMercanteVaziosInput(voyageId: number, pol: string, pod: string): Promise<MercanteVaziosInput> {
  const head = await readHeader(voyageId, pol, pod, 'vazio')
  const rows = await readAll((from, to) => supabase
    .from('vazios_importacao_containers')
    .select('id, container_number, container_type, tare_kg, pol, pod, manifest:vazios_importacao_manifests!inner(voyage_id)')
    .eq('manifest.voyage_id', voyageId)
    .order('container_number')
    .range(from, to) as unknown as PromiseLike<{ data: unknown; error: unknown }>)
  // Mesma régua de `useVaziosImportacaoStats`, que monta a linha VAZIOS: POL sem
  // porto reconhecido vira '-' (e a linha fica sem botão).
  const vazios = rows
    .filter((row) => (normalizePortCode(text(row.pol)) ?? '-') === portKey(pol) && normalizePortCode(text(row.pod)) === portKey(pod))
    .map((row) => ({
      number: String(row.container_number ?? '').trim().toUpperCase(),
      type: text(row.container_type),
      tareKg: num(row.tare_kg),
    }))
  return { vesselName: head.vesselName, voyageNumber: head.voyageNumber, hasBaplie: head.hasBaplie, header: head.header, vazios }
}
