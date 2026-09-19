import { useMemo, useState } from 'react'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { formatDate, normalizeText } from '../../lib/utils'
import { formatNumber } from '../../pages/blDetalheHelpers'
import type { BLDetail } from '../../types/database'

import type { CargoMode } from '../../pages/blDetalheHelpers'

export type ContainerSummary = {
  distinct: number
  imo: number
  oog: number
}

export type BreakbulkSummary = {
  machines: number
  packages: number
  packagesTotal: number
  weightTon: number
  cbm: number
}

// Aba Carga: containers (com data de devolução/demurrage), resumo BB e veículos vinculados.
export function BlCargaTab({
  active,
  bl,
  cargoMode = 'container',
  isContainerMode,
  containerSummary,
  breakbulkSummary,
}: {
  active: boolean
  bl: BLDetail
  blId?: string
  cargoMode?: CargoMode
  isContainerMode: boolean
  containerSummary: ContainerSummary
  breakbulkSummary: BreakbulkSummary
}) {
  const [vehicleSearch, setVehicleSearch] = useState('')

  const showContainers = cargoMode === 'container' || cargoMode === 'misto' || isContainerMode
  const showBreakbulk = cargoMode === 'carga_solta' || cargoMode === 'misto' || !isContainerMode

  const filteredVehicles = useMemo(() => {
    if (!showContainers) return []

    const term = normalizeText(vehicleSearch)
    if (!term) return bl.vehicles ?? []
    return (bl.vehicles ?? []).filter((vehicle) => normalizeText(vehicle.chassis).includes(term))
  }, [bl.vehicles, showContainers, vehicleSearch])

  if (!active) return null

  return (
    <div className="grid gap-5">
      {showContainers ? (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Containers vinculados</h2>
            <div className="flex flex-wrap gap-2">
              <Badge tone="blue">{containerSummary.distinct} CNTRS</Badge>
              <Badge tone="red">{containerSummary.imo} IMO</Badge>
              <Badge tone="yellow">{containerSummary.oog} OOG</Badge>
            </div>
          </div>

          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[800px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="py-2">No. Container</th>
                  <th scope="col" className="py-2">Seal</th>
                  <th scope="col" className="py-2">Tipo</th>
                  <th scope="col" className="py-2">Tara</th>
                  <th scope="col" className="py-2">Peso bruto</th>
                  <th scope="col" className="py-2">CBM</th>
                  <th scope="col" className="py-2">OOG</th>
                  <th scope="col" className="py-2">IMO</th>
                  <th scope="col" className="py-2">Descarga</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {bl.bl_containers?.length ? (
                  bl.bl_containers.map((container) => (
                    <tr key={container.id}>
                      <td className="py-2 font-semibold text-white">{container.container_number}</td>
                      <td className="py-2">{container.seal_number ?? '-'}</td>
                      <td className="py-2">{container.type ?? '-'}</td>
                      <td className="py-2">{container.tare_weight_kg == null ? '-' : `${formatNumber(container.tare_weight_kg)} kg`}</td>
                      <td className="py-2">{formatNumber(container.gross_weight_kg)} kg</td>
                      <td className="py-2">{formatNumber(container.cbm)}</td>
                      <td className="py-2">{container.is_oog ? <Badge tone="yellow">OOG</Badge> : '-'}</td>
                      <td className="py-2">{container.is_imo ? <Badge tone="red">IMO</Badge> : '-'}</td>
                      <td className="py-2 text-slate-300">{container.discharge_date ? formatDate(container.discharge_date) : <span className="text-slate-500">—</span>}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-3 text-slate-400" colSpan={9}>
                      Nenhum container vinculado a este B/L.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {showBreakbulk ? (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Resumo da carga solta</h2>
            <div className="flex flex-wrap gap-2">
              <Badge tone="green">{formatNumber(breakbulkSummary.machines)} maquinas</Badge>
              <Badge tone="blue">{formatNumber(breakbulkSummary.packagesTotal)} volumes</Badge>
              <Badge tone="yellow">{formatNumber(breakbulkSummary.weightTon)} ton</Badge>
              <Badge tone="slate">{formatNumber(breakbulkSummary.cbm)} CBM</Badge>
            </div>
          </div>

          <div className="app-table-scroll">
            <div className="grid gap-4">
              <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
                <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="py-2">CE</th>
                    <th scope="col" className="py-2">Máquinas</th>
                    <th scope="col" className="py-2">Volumes</th>
                    <th scope="col" className="py-2">Total de volumes</th>
                    <th scope="col" className="py-2">Peso (ton)</th>
                    <th scope="col" className="py-2">CBM (M3)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  <tr>
                    <td className="py-2">{bl.ce_mercante ?? '-'}</td>
                    <td className="py-2">{formatNumber(bl.bb_machine_qty)}</td>
                    <td className="py-2">{formatNumber(bl.bb_packages_qty)}</td>
                    <td className="py-2">{formatNumber(bl.bb_packages_total ?? bl.bb_packages_qty)}</td>
                    <td className="py-2">{formatNumber(bl.bb_weight_ton)}</td>
                    <td className="py-2">{formatNumber(bl.bb_cbm)}</td>
                  </tr>
                </tbody>
              </table>

              {bl.bl_breakbulk_items?.length ? (
                <div>
                  <div className="mb-2 text-sm font-semibold text-slate-300">Itens da carga solta</div>
                  <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
                    <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                      <tr>
                        <th scope="col" className="py-2">Descrição</th>
                        <th scope="col" className="py-2">Volumes</th>
                        <th scope="col" className="py-2">Unidade</th>
                        <th scope="col" className="py-2">Peso bruto</th>
                        <th scope="col" className="py-2">CBM</th>
                        <th scope="col" className="py-2">Marcas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      {bl.bl_breakbulk_items.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2 font-semibold text-white">{item.item_description}</td>
                          <td className="py-2">{formatNumber(item.package_qty)}</td>
                          <td className="py-2">{item.package_unit ?? '-'}</td>
                          <td className="py-2">{formatNumber(item.gross_weight_kg)} kg</td>
                          <td className="py-2">{formatNumber(item.cbm)}</td>
                          <td className="py-2">{item.marks ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-slate-400">
                  Nenhum item individual vinculado a este B/L.
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {showContainers ? (
        <Card>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Veículos vinculados</h2>
            <div className="w-full max-w-xs">
              <Field label="Buscar por chassi">
                <Input value={vehicleSearch} onChange={(event) => setVehicleSearch(event.target.value)} />
              </Field>
            </div>
          </div>

          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[760px] text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="py-2">Chassi</th>
                  <th scope="col" className="py-2">Marca</th>
                  <th scope="col" className="py-2">Container</th>
                  <th scope="col" className="py-2">Peso</th>
                  <th scope="col" className="py-2">Cubagem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {filteredVehicles.length ? (
                  filteredVehicles.map((vehicle) => (
                    <tr key={vehicle.id}>
                      <td className="py-2 font-semibold text-white">{vehicle.chassis}</td>
                      <td className="py-2">{vehicle.brand}</td>
                      <td className="py-2">{vehicle.container?.container_number ?? '-'}</td>
                      <td className="py-2">{formatNumber(vehicle.weight_kg)} kg</td>
                      <td className="py-2">{formatNumber(vehicle.cbm)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-3 text-slate-400" colSpan={5}>
                      Nenhum veículo vinculado para este B/L.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  )
}
