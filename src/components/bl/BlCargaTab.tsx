import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Block, Fact, FactList } from '../ui/Block'
import { Button } from '../ui/Button'
import { CopyValue } from '../ui/CopyValue'
import { Field, Input } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { formatDate, normalizeText } from '../../lib/utils'
import { formatNumber } from '../../pages/blDetalheHelpers'
import { DemurrageCell, ProfileCell } from './BlCargoCells'
import { containerSummary, formatOptionalNumber, formatOptionalText, hasBreakbulkData } from './blCargoFormat'
import { BlContainerCorrectModal } from './BlContainerCorrectModal'
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

type Container = NonNullable<BLDetail['bl_containers']>[number] & { demurrage_status?: string | null }

/**
 * Aba Carga (identidade, lote 1): Contêineres, Carga solta e Veículos em
 * blocos, cada um só quando o B/L tem aquele tipo de carga. A tabela de
 * contêineres tem as colunas da carga aberta na lista de BLs; Corrigir abre a
 * janela com os dados corrigíveis do container.
 */
export function BlCargaTab({
  active,
  bl,
  cargoMode = 'container',
  canCorrect,
  chargesLocked,
  ownershipDivergences,
}: {
  active: boolean
  bl: BLDetail
  blId?: string
  cargoMode?: CargoMode
  /** B/L não cancelado: oferece Corrigir. */
  canCorrect: boolean
  /** B/L faturado: Perfil e COC/SOC travam na janela Corrigir. */
  chargesLocked: boolean
  /** container_number → SOC/COC que o Baplie declara, quando discorda do B/L */
  ownershipDivergences?: ReadonlyMap<string, string>
}) {
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [correcting, setCorrecting] = useState<Container | null>(null)

  const containers = (bl.bl_containers ?? []) as Container[]
  const vehicles = useMemo(() => bl.vehicles ?? [], [bl.vehicles])
  const items = bl.bl_breakbulk_items ?? []
  const showBreakbulk = cargoMode === 'carga_solta' || cargoMode === 'misto'

  const filteredVehicles = useMemo(() => {
    const term = normalizeText(vehicleSearch)
    if (!term) return vehicles
    return vehicles.filter((vehicle) => normalizeText(vehicle.chassis).includes(term))
  }, [vehicles, vehicleSearch])

  if (!active) return null

  const divergent = containers.filter((container) => ownershipDivergences?.has(container.container_number))
  const brands = Object.entries(vehicles.reduce<Record<string, number>>((acc, vehicle) => {
    const brand = vehicle.brand || 'Sem marca'
    acc[brand] = (acc[brand] ?? 0) + 1
    return acc
  }, {})).map(([brand, count]) => `${brand} ${count}`).join(' · ')

  if (!containers.length && !vehicles.length && !showBreakbulk) {
    return (
      <Block title="Carga">
        <p className="app-facts__detail">Nenhuma carga vinculada a este B/L.</p>
      </Block>
    )
  }

  return (
    <div className="grid gap-5">
      {containers.length ? (
        <Block title="Contêineres" flush aside={containerSummary(containers)}>
          {divergent.length ? (
            <div className="app-block__body flex flex-wrap items-center gap-3" role="status">
              <StatusText tone="warning">
                Baplie diverge do B/L em {divergent.map((container) => `${container.container_number} (Baplie diz ${ownershipDivergences?.get(container.container_number)})`).join(', ')}. Vale o B/L.
              </StatusText>
              {bl.voyage_id ? <Link className="app-btn app-btn--secondary app-btn--sm" to={`/baplie?voyage=${bl.voyage_id}`}>Abrir conciliação</Link> : null}
            </div>
          ) : null}
          <div className="app-table-scroll">
            <table className="app-table app-table--compact">
              <caption className="sr-only">Contêineres do B/L</caption>
              <thead>
                <tr>
                  <th scope="col">Contêiner</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">COC/SOC</th>
                  <th scope="col">Perfil</th>
                  <th scope="col">Lacre</th>
                  <th scope="col">Tara (kg)</th>
                  <th scope="col">Peso bruto (kg)</th>
                  <th scope="col">CBM (m³)</th>
                  <th scope="col">Descarga</th>
                  <th scope="col">Devolução</th>
                  <th scope="col">Demurrage</th>
                  {canCorrect ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {containers.map((container) => (
                  <tr key={container.id}>
                    <td className="app-bl-code whitespace-nowrap"><CopyValue value={container.container_number} label="número do contêiner" /></td>
                    <td className="whitespace-nowrap">{container.type ?? <NoValue label="Sem tipo" />}</td>
                    <td className="whitespace-nowrap">{container.ownership === 'SOC' || container.ownership === 'COC' ? container.ownership : <NoValue label="Sem COC/SOC informado" />}</td>
                    <td className="whitespace-nowrap"><ProfileCell isImo={Boolean(container.is_imo)} isOog={Boolean(container.is_oog)} imoClass={container.imo_class} unNumber={container.un_number} /></td>
                    <td className="app-bl-code whitespace-nowrap">{container.seal_number ?? <NoValue label="Sem lacre" />}</td>
                    <td className="whitespace-nowrap tabular-nums">{formatOptionalNumber(container.tare_weight_kg, 'Sem tara')}</td>
                    <td className="whitespace-nowrap tabular-nums">{formatOptionalNumber(container.gross_weight_kg, 'Sem peso bruto')}</td>
                    <td className="whitespace-nowrap tabular-nums">{formatOptionalNumber(container.cbm, 'Sem CBM')}</td>
                    <td className="whitespace-nowrap tabular-nums">{container.discharge_date ? formatDate(container.discharge_date) : <NoValue label="Sem data de descarga" />}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {container.return_date ? formatDate(container.return_date) : container.ownership === 'SOC' ? <StatusText tone="muted">Não se aplica</StatusText> : <NoValue label="Sem devolução" />}
                    </td>
                    <td className="whitespace-nowrap"><DemurrageCell container={container} /></td>
                    {canCorrect ? (
                      <td>
                        <Button variant="secondary" className="app-btn--sm" onClick={() => setCorrecting(container)} aria-label={`Corrigir container ${container.container_number}`}>
                          Corrigir
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      ) : null}

      {showBreakbulk ? (
        <Block title="Carga solta" flush={items.length > 0}>
          {hasBreakbulkData(bl) ? (
            <div className={items.length ? 'app-block__body' : undefined}>
              <FactList columns={4}>
                <Fact label="Máquinas">{formatOptionalNumber(bl.bb_machine_qty, 'Sem quantidade de máquinas')}</Fact>
                <Fact label="Packages" detail={bl.bb_packages_total != null && Number(bl.bb_packages_total) !== Number(bl.bb_packages_qty) ? `${formatOptionalText(bl.bb_packages_total)} no total` : null}>
                  {formatOptionalNumber(bl.bb_packages_qty, 'Sem packages')}
                </Fact>
                <Fact label="Peso">{bl.bb_weight_ton == null ? <NoValue label="Sem peso" /> : `${formatOptionalText(bl.bb_weight_ton)} t`}</Fact>
                <Fact label="CBM">{bl.bb_cbm == null ? <NoValue label="Sem CBM" /> : `${formatOptionalText(bl.bb_cbm)} m³`}</Fact>
              </FactList>
            </div>
          ) : null}
          {items.length ? (
            <div className="app-table-scroll">
              <table className="app-table app-table--compact">
                <caption className="sr-only">Itens da carga solta</caption>
                <thead>
                  <tr>
                    <th scope="col" className="app-table__text-head">Descrição</th>
                    <th scope="col">Packages</th>
                    <th scope="col">Unidade</th>
                    <th scope="col">Peso bruto (kg)</th>
                    <th scope="col">CBM (m³)</th>
                    <th scope="col" className="app-table__text-head">Marcas</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="app-table__text" title={item.item_description ?? undefined}>{item.item_description || <NoValue label="Sem descrição" />}</td>
                      <td className="tabular-nums">{formatNumber(item.package_qty)}</td>
                      <td>{item.package_unit ?? <NoValue label="Sem unidade" />}</td>
                      <td className="tabular-nums">{formatNumber(item.gross_weight_kg)}</td>
                      <td className="tabular-nums">{formatNumber(item.cbm)}</td>
                      <td className="app-table__text" title={item.marks ?? undefined}>{item.marks ?? <NoValue label="Sem marcas" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {!hasBreakbulkData(bl) && !items.length ? (
            <p className="app-facts__detail">Nenhum dado de carga solta informado no B/L: sem máquinas, packages, peso ou CBM, e sem itens.</p>
          ) : null}
        </Block>
      ) : null}

      {vehicles.length ? (
        <Block title="Veículos" flush aside={`${vehicles.length} ${vehicles.length === 1 ? 'veículo' : 'veículos'} · ${brands}`}>
          {vehicles.length > 8 ? (
            <div className="app-block__body">
              <div className="w-full max-w-xs">
                <Field label="Buscar por chassi">
                  <Input value={vehicleSearch} onChange={(event) => setVehicleSearch(event.target.value)} />
                </Field>
              </div>
            </div>
          ) : null}
          <div className="app-table-scroll">
            <table className="app-table app-table--compact">
              <caption className="sr-only">Veículos do B/L</caption>
              <thead>
                <tr>
                  <th scope="col">Chassi</th>
                  <th scope="col">Marca</th>
                  <th scope="col">Contêiner</th>
                  <th scope="col">Peso (kg)</th>
                  <th scope="col">Cubagem (m³)</th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.length ? (
                  filteredVehicles.map((vehicle) => (
                    <tr key={vehicle.id}>
                      <td className="app-bl-code whitespace-nowrap">{vehicle.chassis}</td>
                      <td>{vehicle.brand ?? <NoValue label="Sem marca" />}</td>
                      <td className="app-bl-code whitespace-nowrap">{vehicle.container?.container_number ? <CopyValue value={vehicle.container.container_number} label="número do contêiner" /> : <NoValue label="Sem contêiner" />}</td>
                      <td className="tabular-nums">{formatNumber(vehicle.weight_kg)}</td>
                      <td className="tabular-nums">{formatNumber(vehicle.cbm)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="text-[var(--app-muted)]" colSpan={5}>Nenhum chassi com esse trecho.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Block>
      ) : null}

      {correcting ? (
        <BlContainerCorrectModal bl={bl} container={correcting} chargesLocked={chargesLocked} onClose={() => setCorrecting(null)} />
      ) : null}
    </div>
  )
}
