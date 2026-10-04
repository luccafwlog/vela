import { useState } from 'react'
import { Card, EmptyState } from '../../ui/Card'
import { Field, Select } from '../../ui/Input'
import { Badge } from '../../ui/Badge'
import { cargoModeLabel } from '../../../lib/cargoMode'
import { applicationBasisLabel } from '../../billing/conferenciaCalculo'
import { formatBRL, formatDate } from '../../../lib/utils'
import type { PortalInformation } from '../../../services/portalInformation'

const usd = (value: number | null) => value == null ? '—' : `USD ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function LocalFeesSection({ information, pod }: { information: PortalInformation; pod: string }) {
  const [cargoMode, setCargoMode] = useState('')
  const modes = [...new Set(information.local_tables.map((table) => table.cargo_mode))]
  const tables = information.local_tables.filter((table) => (!pod || table.pod === pod) && (!cargoMode || table.cargo_mode === cargoMode))
  return <div className="grid gap-4">
    <Card><h2 className="text-base font-semibold">Taxas Locais</h2><p className="my-3 text-sm text-[var(--app-muted)]">Valores das tabelas oficiais de importação. A vigência é informativa. A aplicação depende das características da carga; consulte sua fatura para os valores cobrados.</p><Field label="Modalidade da carga"><Select value={cargoMode} onChange={(event) => setCargoMode(event.target.value)}><option value="">Todas</option>{modes.map((mode) => <option key={mode} value={mode}>{cargoModeLabel(mode)}</option>)}</Select></Field></Card>
    {!tables.length && <EmptyState title="Sem tabela de Taxas Locais" description="Não há tabela oficial disponível para os filtros atuais. Consulte o atendimento." />}
    {tables.map((table) => <Card key={table.id} className="overflow-hidden p-0">
      <div className="px-5 py-4"><h3 className="font-semibold">{table.name}</h3><p className="mt-1 text-sm text-[var(--app-muted)]">{table.pod} · {cargoModeLabel(table.cargo_mode)} · Vigência: {formatDate(table.valid_from)}{table.valid_to ? ` a ${formatDate(table.valid_to)}` : ' · sem término cadastrado'}</p></div>
      {!table.items.length ? <EmptyState title="Tabela sem itens cadastrados" /> : <div className="app-table-scroll"><table className="app-table app-table--compact min-w-[640px] text-left text-sm"><caption className="sr-only">Itens de {table.name}</caption><thead><tr><th className="px-4 py-3" scope="col">Taxa</th><th className="px-4 py-3" scope="col">Aplicação</th><th className="px-4 py-3" scope="col">Perfil da carga</th><th className="px-4 py-3" scope="col">Valor unitário oficial</th></tr></thead><tbody>{table.items.map((item) => <tr key={item.id}><td className="px-4 py-3">{item.name}{item.manual_only && <div><Badge>Aplicação manual</Badge></div>}</td><td className="px-4 py-3">{applicationBasisLabel(item.application_basis)}</td><td className="px-4 py-3">{['all', 'any'].includes(item.cargo_profile) ? 'Todos' : item.cargo_profile.toUpperCase()}<div className="text-xs text-[var(--app-muted)]">{item.applies_to_soc ? 'Inclui SOC' : 'Não se aplica a SOC'}</div></td><td className="px-4 py-3">{item.currency === 'BRL' ? item.unit_value_brl == null ? 'Sob consulta' : formatBRL(item.unit_value_brl) : item.unit_value_usd == null ? 'Sob consulta' : usd(item.unit_value_usd)}</td></tr>)}</tbody></table></div>}
    </Card>)}
  </div>
}

export function DemurrageSection({ information }: { information: PortalInformation }) {
  return <div className="grid gap-4">
    <Card><h2 className="text-base font-semibold">Demurrage</h2><p className="mt-3 text-sm text-[var(--app-muted)]">Tarifa geral de referência em USD por dia. O free time da sua operação pode refletir um acordo específico; confira o valor em BLs e Containers.</p>{information.demurrage_notes && <p className="mt-3 whitespace-pre-line text-sm">{information.demurrage_notes}</p>}</Card>
    {!information.demurrage_rates.length ? <EmptyState title="Sem tarifa de Demurrage" description="Tarifa geral indisponível. Consulte o atendimento; nenhum free time é presumido." /> : <Card className="overflow-hidden p-0"><div className="app-table-scroll"><table className="app-table min-w-[600px] text-left text-sm"><caption className="sr-only">Tarifas gerais de demurrage</caption><thead><tr><th className="px-4 py-3" scope="col">Equipamento</th><th className="px-4 py-3" scope="col">Free time geral</th><th className="px-4 py-3" scope="col">Primeiro período</th><th className="px-4 py-3" scope="col">Segundo período</th><th className="px-4 py-3" scope="col">Vigência</th></tr></thead><tbody>{information.demurrage_rates.map((rate) => <tr key={rate.id}><td className="px-4 py-3">{rate.container_type}</td><td className="px-4 py-3">{rate.free_days} dias</td><td className="px-4 py-3">Dias {rate.p1_day_from} a {rate.p1_day_to}<div>{usd(rate.p1_usd)} / dia</div></td><td className="px-4 py-3">A partir do dia {rate.p2_day_from}<div>{usd(rate.p2_usd)} / dia</div></td><td className="px-4 py-3">{formatDate(rate.valid_from)}{rate.valid_to && ` a ${formatDate(rate.valid_to)}`}</td></tr>)}</tbody></table></div></Card>}
  </div>
}
