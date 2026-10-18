import { useState, type ReactNode } from 'react'
import { Block } from '../../ui/Block'
import { EmptyState } from '../../ui/Card'
import { Field, Select } from '../../ui/Input'
import { NoValue } from '../../ui/NoValue'
import { isPortalServicePort, normalizeInformationPort } from '../../../services/informationPort'
import { cargoModeLabel } from '../../../lib/cargoMode'
import { applicationBasisLabel } from '../../billing/conferenciaCalculo'
import { formatBRL, formatDate, formatUSD } from '../../../lib/utils'
import type { InformationDemurrageRate, LocalReferenceItem, PortalInformation } from '../../../services/portalInformation'
import { FilterRow } from './FilterRow'

const PROFILE_LABELS: Record<string, string> = { standard: 'Standard', imo: 'IMO', oog: 'OOG' }

// "Não se aplica a SOC" vira parte do perfil ("Todos, exceto SOC"), no lugar
// da linha embaixo do valor (tabela limpa).
function cargoProfileLabel(item: LocalReferenceItem) {
  const profile = ['all', 'any'].includes(item.cargo_profile) ? 'Todos' : PROFILE_LABELS[item.cargo_profile] ?? item.cargo_profile.toUpperCase()
  return item.applies_to_soc ? profile : `${profile}, exceto SOC`
}

function itemValue(item: LocalReferenceItem) {
  if (item.currency === 'BRL') return item.unit_value_brl == null ? 'Sob consulta' : formatBRL(item.unit_value_brl)
  return item.unit_value_usd == null ? 'Sob consulta' : formatUSD(item.unit_value_usd)
}

function validity(from: string, to: string | null) {
  return to ? `vigência ${formatDate(from)} a ${formatDate(to)}` : `vigente desde ${formatDate(from)}`
}

const usdPerDay = (value: number | null) => value == null ? <NoValue label="Sem valor" /> : value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function LocalFeesSection({ information, pod, filters }: { information: PortalInformation; pod: string; filters?: ReactNode }) {
  const [cargoMode, setCargoMode] = useState('')
  const supportedTables = information.local_tables.filter(table => isPortalServicePort(table.pod))
  const modes = [...new Set(supportedTables.map((table) => table.cargo_mode))]
  const tables = supportedTables.filter((table) => (!pod || normalizeInformationPort(table.pod) === normalizeInformationPort(pod)) && (!cargoMode || table.cargo_mode === cargoMode))
  return <div className="grid gap-4">
    <FilterRow note="Valores oficiais das tabelas. O que foi cobrado do seu B/L está na fatura.">
      {filters}
      <div className="w-full sm:w-56">
        <Field label="Modalidade da carga"><Select value={cargoMode} onChange={(event) => setCargoMode(event.target.value)}><option value="">Todas</option>{modes.map((mode) => <option key={mode} value={mode}>{cargoModeLabel(mode)}</option>)}</Select></Field>
      </div>
    </FilterRow>
    {!tables.length && <EmptyState title="Sem tabela de Taxas Locais" description="Não há tabela oficial disponível para os filtros atuais. Consulte o atendimento." />}
    {tables.map((table) => <Block key={table.id} title={table.name} aside={`${table.pod} · ${cargoModeLabel(table.cargo_mode)} · ${validity(table.valid_from, table.valid_to)}`} flush>
      {!table.items.length ? <div className="app-block__body"><p className="m-0 text-sm text-[var(--app-muted)]">Tabela sem itens cadastrados.</p></div> : <div className="app-table-scroll"><table className="app-table app-table--compact text-sm"><caption className="sr-only">Itens de {table.name}</caption><thead><tr><th className="app-table__text-head" scope="col">Taxa</th><th scope="col">Incide</th><th scope="col">Perfil da carga</th><th scope="col">Valor</th></tr></thead><tbody>{table.items.map((item) => <tr key={item.id}><td className="app-table__text app-table__text--wrap">{item.name}</td><td className="whitespace-nowrap">{applicationBasisLabel(item.application_basis)}</td><td className="whitespace-nowrap">{cargoProfileLabel(item)}</td><td className="whitespace-nowrap tabular-nums">{itemValue(item)}</td></tr>)}</tbody></table></div>}
    </Block>)}
  </div>
}

// Vigência da tarifa: na faixa do bloco quando é uma só; numa coluna quando
// as linhas têm vigências diferentes.
function rateValidity(rate: InformationDemurrageRate) {
  return validity(rate.valid_from, rate.valid_to)
}

export function DemurrageSection({ information, showNotes = true }: { information: PortalInformation; showNotes?: boolean }) {
  const rates = information.demurrage_rates
  const validities = [...new Set(rates.map(rateValidity))]
  const sharedValidity = validities.length === 1 ? validities[0] : null
  return <div className="grid gap-4">
    {!rates.length ? <EmptyState title="Sem tarifa de Demurrage" description="Tarifa geral indisponível. Consulte o atendimento; nenhum free time é presumido." /> : <Block title="Tarifa geral de Demurrage" aside={['em US$ por dia', sharedValidity].filter(Boolean).join(' · ')} flush>
      <div className="app-table-scroll"><table className="app-table app-table--compact text-sm"><caption className="sr-only">Tarifas gerais de demurrage</caption><thead><tr>
        <th scope="col">Equipamento</th>
        <th scope="col">Free time</th>
        <th scope="col">1º período</th>
        <th scope="col">US$ por dia<span className="sr-only"> no 1º período</span></th>
        <th scope="col">2º período</th>
        <th scope="col">US$ por dia<span className="sr-only"> no 2º período</span></th>
        {sharedValidity ? null : <th scope="col">Vigência</th>}
      </tr></thead><tbody>{rates.map((rate) => <tr key={rate.id}>
        <td>{rate.container_type}</td>
        <td className="whitespace-nowrap">{rate.free_days} dias</td>
        <td className="whitespace-nowrap">dias {rate.p1_day_from} a {rate.p1_day_to}</td>
        <td className="tabular-nums">{usdPerDay(rate.p1_usd)}</td>
        <td className="whitespace-nowrap">a partir do dia {rate.p2_day_from}</td>
        <td className="tabular-nums">{usdPerDay(rate.p2_usd)}</td>
        {sharedValidity ? null : <td className="whitespace-nowrap">{rateValidity(rate)}</td>}
      </tr>)}</tbody></table></div>
    </Block>}
    {showNotes && information.demurrage_notes ? <Block title="Como a contagem funciona"><p className="m-0 whitespace-pre-line text-sm">{information.demurrage_notes}</p></Block> : null}
  </div>
}
