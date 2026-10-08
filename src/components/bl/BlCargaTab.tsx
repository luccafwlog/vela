import { useMemo, useState } from 'react'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { Field, Input, Select } from '../ui/Input'
import { SummaryStrip } from '../ui/SummaryStrip'
import { formatDate, normalizeText } from '../../lib/utils'
import { CONTAINER_PROFILE_LABELS, containerProfileOf, type ContainerProfile } from '../../services/vaziosNatureza'
import { formatNumber } from '../../pages/blDetalheHelpers'
import { ContainerOwnershipBadge } from '../shared/OperationalBadges'
import { CONTAINER_OWNERSHIP_SOURCE_LABELS, type ContainerOwnership } from '../../lib/containerOwnership'
import type { BLDetail } from '../../types/database'

import type { CargoMode } from '../../pages/blDetalheHelpers'

export type ContainerSummary = {
  distinct: number
  imo: number
  oog: number
  soc: number
  coc: number
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
  onChangeProfile,
  onChangeOwnership,
  ownershipDivergences,
}: {
  onChangeProfile?: (containerId: number, profile: ContainerProfile) => void
  onChangeOwnership?: (containerId: number, ownership: ContainerOwnership) => void
  /** container_number → SOC/COC que o Baplie declara, quando discorda do B/L */
  ownershipDivergences?: ReadonlyMap<string, string>
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

  const vehicles = bl.vehicles ?? []

  return (
    <Card className="app-bl-sheet">
      {showContainers ? (
        <section className="app-bl-sheet__section" aria-labelledby="bl-containers">
          <div className="app-bl-section-head">
            <h2 id="bl-containers" className="app-bl-section-title">Containers vinculados</h2>
            <SummaryStrip
              label="Resumo dos containers"
              items={[
                { label: containerSummary.distinct === 1 ? 'CNTR' : 'CNTRs', value: containerSummary.distinct },
                { label: 'IMO', value: containerSummary.imo, tone: containerSummary.imo ? 'warning' : 'default' },
                { label: 'OOG', value: containerSummary.oog, tone: containerSummary.oog ? 'warning' : 'default' },
                { label: 'SOC', value: containerSummary.soc },
                { label: 'COC', value: containerSummary.coc },
              ]}
            />
          </div>
          {onChangeProfile || onChangeOwnership ? (
            <p className="app-bl-facts__sub">Perfil e SOC/COC podem ser corrigidos na linha; cada troca pede justificativa e recalcula as taxas locais.</p>
          ) : null}

          <div className="app-table-scroll">
            <table className="app-table app-table--compact app-bl-subtable min-w-[880px]">
              <thead>
                <tr>
                  <th scope="col">Container</th>
                  <th scope="col">Lacre</th>
                  <th scope="col">Tipo</th>
                  <th scope="col" className="text-right">Tara (kg)</th>
                  <th scope="col" className="text-right">Peso bruto (kg)</th>
                  <th scope="col" className="text-right">CBM (m³)</th>
                  <th scope="col">Perfil</th>
                  <th scope="col">SOC/COC</th>
                  <th scope="col">Descarga</th>
                </tr>
              </thead>
              <tbody>
                {bl.bl_containers?.length ? (
                  bl.bl_containers.map((container) => (
                    <tr key={container.id}>
                      <td className="app-bl-code text-[var(--app-text-strong)]">{container.container_number}</td>
                      <td className="app-bl-code">{container.seal_number ?? '—'}</td>
                      <td>{container.type ?? '—'}</td>
                      <td className="text-right tabular-nums">{container.tare_weight_kg == null ? '—' : formatNumber(container.tare_weight_kg)}</td>
                      <td className="text-right tabular-nums">{container.gross_weight_kg == null ? '—' : formatNumber(container.gross_weight_kg)}</td>
                      <td className="text-right tabular-nums">{container.cbm == null ? '—' : formatNumber(container.cbm)}</td>
                      <td>
                        {onChangeProfile ? (
                          <Select
                            aria-label={`Perfil do container ${container.container_number}`}
                            value={containerProfileOf(container)}
                            onChange={(event) => onChangeProfile(container.id, event.target.value as ContainerProfile)}
                          >
                            {Object.entries(CONTAINER_PROFILE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </Select>
                        ) : container.is_imo || container.is_oog ? (
                          <span className="flex gap-1">
                            {container.is_imo ? <Badge tone="danger">IMO</Badge> : null}
                            {container.is_oog ? <Badge tone="warning">OOG</Badge> : null}
                          </span>
                        ) : (
                          'Padrão'
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1">
                          {onChangeOwnership ? (
                            <Select
                              aria-label={`SOC/COC do container ${container.container_number}`}
                              value={container.ownership ?? ''}
                              onChange={(event) => onChangeOwnership(container.id, event.target.value as ContainerOwnership)}
                            >
                              {container.ownership ? null : <option value="" disabled>Não informado</option>}
                              <option value="COC">COC</option>
                              <option value="SOC">SOC</option>
                            </Select>
                          ) : (
                            <ContainerOwnershipBadge
                              ownership={container.ownership}
                              title={container.ownership_source ? `Origem: ${CONTAINER_OWNERSHIP_SOURCE_LABELS[container.ownership_source] ?? container.ownership_source}` : undefined}
                            />
                          )}
                          {ownershipDivergences?.has(container.container_number) ? (
                            <span className="app-bl-facts__sub app-bl-tone--warning">
                              Baplie diz {ownershipDivergences.get(container.container_number)}; vale o B/L
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="tabular-nums">{container.discharge_date ? formatDate(container.discharge_date) : <span className="app-bl-facts__missing">—</span>}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="app-bl-facts__missing" colSpan={9}>Nenhum container vinculado a este B/L.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {showBreakbulk ? (
        <section className={`app-bl-sheet__section${showContainers ? ' app-bl-sheet__section--ruled' : ''}`} aria-labelledby="bl-breakbulk">
          <div className="app-bl-section-head">
            <h2 id="bl-breakbulk" className="app-bl-section-title">Resumo da carga solta</h2>
            <SummaryStrip
              label="Resumo da carga solta"
              items={[
                { label: breakbulkSummary.machines === 1 ? 'máquina' : 'máquinas', value: formatNumber(breakbulkSummary.machines) },
                { label: 'packages', value: formatNumber(breakbulkSummary.packagesTotal) },
                { label: 't', value: formatNumber(breakbulkSummary.weightTon) },
                { label: 'm³', value: formatNumber(breakbulkSummary.cbm) },
              ]}
            />
          </div>
          {bl.bl_breakbulk_items?.length ? (
            <div className="app-table-scroll">
              <table className="app-table app-table--compact app-bl-subtable min-w-[640px]">
                <thead>
                  <tr>
                    <th scope="col">Descrição</th>
                    <th scope="col" className="text-right">Packages</th>
                    <th scope="col">Unidade</th>
                    <th scope="col" className="text-right">Peso bruto (kg)</th>
                    <th scope="col" className="text-right">CBM (m³)</th>
                    <th scope="col">Marcas</th>
                  </tr>
                </thead>
                <tbody>
                  {bl.bl_breakbulk_items.map((item) => (
                    <tr key={item.id}>
                      <td className="font-medium text-[var(--app-text-strong)]">{item.item_description}</td>
                      <td className="text-right tabular-nums">{formatNumber(item.package_qty)}</td>
                      <td>{item.package_unit ?? '—'}</td>
                      <td className="text-right tabular-nums">{formatNumber(item.gross_weight_kg)}</td>
                      <td className="text-right tabular-nums">{formatNumber(item.cbm)}</td>
                      <td>{item.marks ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="app-bl-facts__missing">Nenhum item individual vinculado a este B/L; vale o resumo acima.</p>
          )}
        </section>
      ) : null}

      {showContainers ? (
        <section className="app-bl-sheet__section app-bl-sheet__section--ruled" aria-labelledby="bl-vehicles">
          <div className="app-bl-section-head">
            <h2 id="bl-vehicles" className="app-bl-section-title">Veículos vinculados</h2>
            {vehicles.length > 8 ? (
              <div className="w-full max-w-xs">
                <Field label="Buscar por chassi">
                  <Input value={vehicleSearch} onChange={(event) => setVehicleSearch(event.target.value)} />
                </Field>
              </div>
            ) : null}
          </div>
          {vehicles.length === 0 ? (
            <p className="app-bl-facts__missing">Nenhum veículo vinculado a este B/L.</p>
          ) : (
            <div className="app-table-scroll">
              <table className="app-table app-table--compact app-bl-subtable min-w-[640px] whitespace-nowrap">
                <thead>
                  <tr>
                    <th scope="col">Chassi</th>
                    <th scope="col">Marca</th>
                    <th scope="col">Container</th>
                    <th scope="col" className="text-right">Peso (kg)</th>
                    <th scope="col" className="text-right">Cubagem (m³)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVehicles.length ? (
                    filteredVehicles.map((vehicle) => (
                      <tr key={vehicle.id}>
                        <td className="app-bl-code text-[var(--app-text-strong)]">{vehicle.chassis}</td>
                        <td>{vehicle.brand}</td>
                        <td className="app-bl-code">{vehicle.container?.container_number ?? '—'}</td>
                        <td className="text-right tabular-nums">{formatNumber(vehicle.weight_kg)}</td>
                        <td className="text-right tabular-nums">{formatNumber(vehicle.cbm)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="app-bl-facts__missing" colSpan={5}>Nenhum chassi com esse trecho.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </Card>
  )
}
