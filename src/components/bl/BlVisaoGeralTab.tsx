import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import type { BLDetail } from '../../types/database'
import type { ContainerSummary, BreakbulkSummary } from './BlCargaTab'
import type { useBlCockpit } from '../../hooks/useBlCockpit'
import { BlTransshipmentCard } from './BlTransshipmentCard'
import type { BlDisposition, VoyageOmission } from '../../services/transshipments'
import { BlPortalCard, type BlPortalStatus } from './BlPortalCard'
import { resolveChargeStatusLabel, formatNumber, type CargoMode } from '../../pages/blDetalheHelpers'
import { cargoModeLabel, isBreakbulkCargoMode, isContainerCargoMode } from '../../lib/cargoMode'
import { FINANCIAL_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import { BlTerminalOverrideCard, type BlTerminalOverrideOption } from './BlTerminalOverrideCard'

const dt = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value)) : '—'

export type BaplieStatus = {
  state: 'loading' | 'error' | 'not_imported' | 'reconciled'
  divergenceCount: number
}

function BaplieBadge({ status }: { status: BaplieStatus }) {
  switch (status.state) {
    case 'loading':
      return <Badge tone="slate">Verificando Baplie…</Badge>
    case 'error':
      return <Badge tone="red">Erro ao verificar Baplie</Badge>
    case 'not_imported':
      return <Badge tone="slate">Baplie não importado</Badge>
    case 'reconciled':
      return status.divergenceCount
        ? <Badge tone="yellow">{status.divergenceCount} divergência(s) Baplie</Badge>
        : <Badge tone="green">Baplie sem divergências</Badge>
  }
}

export function BlVisaoGeralTab({ active, bl, cockpit, cargoMode, containerSummary, breakbulkSummary, onCod, onRestore, disposition, omission, savingDisposition, portalStatus, baplieStatus, terminalOptions, canEditTerminal, terminalOverrideSaving, terminalOverrideError, onSaveTerminalOverride }: {
  active: boolean
  bl: BLDetail
  cockpit: ReturnType<typeof useBlCockpit>['data']
  cargoMode: CargoMode
  containerSummary: ContainerSummary
  breakbulkSummary: BreakbulkSummary
  onCod?: (justification: string) => void
  onRestore?: (justification: string) => void
  disposition?: BlDisposition | null
  omission?: VoyageOmission | null
  savingDisposition?: boolean
  portalStatus?: BlPortalStatus
  baplieStatus?: BaplieStatus
  terminalOptions?: BlTerminalOverrideOption[]
  canEditTerminal?: boolean
  terminalOverrideSaving?: boolean
  terminalOverrideError?: string | null
  onSaveTerminalOverride?: (input: { terminalId: string | null; podPortId: number | null; justification: string }) => void
}) {
  if (!active) return null
  const effectiveDisposition: BlDisposition = disposition ?? 'transshipment'
  const showBothLenses = isContainerCargoMode(cargoMode) && isBreakbulkCargoMode(cargoMode)
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {omission ? (
        <BlTransshipmentCard omission={omission} disposition={effectiveDisposition} saving={savingDisposition ?? false} onCod={onCod} onRestore={onRestore} />
      ) : null}
      <Card>
        <h3 className="mb-3 text-sm font-semibold">Viagem &amp; Escala</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Item label="Armador / Navio / Viagem">
            {bl.voyage_id ? (
              <Link className="font-semibold text-[#58a6ff] hover:underline" to={`/viagens/${bl.voyage_id}`}>
                {[bl.voyage?.vessel?.carrier?.name, bl.voyage?.vessel?.name, bl.voyage?.voyage_number].filter(Boolean).join(' / ') || '—'}
              </Link>
            ) : '—'}
          </Item>
          <Item label="Trecho">{`${bl.pol ?? '—'} → ${bl.pod ?? '—'}`}</Item>
          <Item label="Terminal de Descarga">
            {bl.terminal?.name ?? (bl.terminal_id ? `Terminal #${bl.terminal_id}` : 'Padrão da Escala')}
          </Item>
          <Item label="Saída do POL">{cockpit?.polSchedule?.atd ? `ATD ${dt(cockpit.polSchedule.atd)}` : `ETD ${dt(cockpit?.polSchedule?.etd)}`}</Item>
          <Item label="Chegada ao POD">{cockpit?.podSchedule?.ata ? `ATA ${dt(cockpit.podSchedule.ata)}` : `ETA ${dt(cockpit?.podSchedule?.eta)}`}</Item>
        </dl>
      </Card>
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Carga</h3>
        <CargoModeBadge mode={cargoMode} />
      </div>
      {/* As duas seções são governadas pelos predicados compartilhados, e não
          por uma terceira regra local: este card decidia a modalidade por conta
          própria (`cargo_mode === 'misto' || (distinct > 0 && ...)`), diferente
          do trigger do banco e de resolveCargoMode. Um B/L misto satisfaz os
          dois predicados e mostra as duas seções, sem ramo extra. */}
      <div className="space-y-4">
        {isContainerCargoMode(cargoMode) ? (
          <div>
            {showBothLenses ? (
              <div className="mb-1 text-xs font-semibold text-[var(--app-muted)]">Contêineres</div>
            ) : null}
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <Item label="Containers">{String(containerSummary.distinct)}</Item>
              <Item label="IMO">{String(containerSummary.imo)}</Item>
              <Item label="OOG">{String(containerSummary.oog)}</Item>
            </dl>
            {bl.voyage_id && baplieStatus ? (
              <Link to={`/baplie?voyage=${bl.voyage_id}`} className="mt-3 inline-block">
                <BaplieBadge status={baplieStatus} />
              </Link>
            ) : null}
          </div>
        ) : null}
        {isBreakbulkCargoMode(cargoMode) ? (
          <div>
            {showBothLenses ? (
              <div className="mb-1 text-xs font-semibold text-[var(--app-muted)]">Carga Solta</div>
            ) : null}
            <dl className="grid gap-2 text-sm sm:grid-cols-4">
              <Item label="Máquinas">{formatNumber(breakbulkSummary.machines)}</Item>
              <Item label="Packages">{formatNumber(breakbulkSummary.packagesTotal)}</Item>
              <Item label="Peso (t)">{formatNumber(breakbulkSummary.weightTon)}</Item>
              {/* CBM não aparecia em nenhum dos ramos, embora seja um dos cinco
                  números do resumo de carga solta. */}
              <Item label="CBM (m³)">{formatNumber(breakbulkSummary.cbm)}</Item>
            </dl>
          </div>
        ) : null}
      </div>
    </Card>
      <Card>
        <h3 className="mb-3 text-sm font-semibold">Cliente</h3>
        {bl.customer ? (
          <div className="text-sm">
            <div className="font-semibold">{bl.customer.name}</div>
            <div className="text-[var(--app-muted)]">{bl.customer.cnpj_cpf}</div>
          </div>
        ) : <Badge tone="yellow">Sem cliente vinculado</Badge>}
        <Link className="mt-2 inline-block text-sm font-semibold text-[#58a6ff] hover:underline" to={`/bls/${bl.id}?tab=faturamento`}>Abrir Faturamento →</Link>
      </Card>
      {terminalOptions ? (
        <div className="lg:col-span-2">
          <BlTerminalOverrideCard
            key={`${bl.id}:${bl.terminal_id ?? 'inherit'}:${bl.pod_port_id ?? 'none'}`}
            terminalId={bl.terminal_id}
            podPortId={bl.pod_port_id}
            options={terminalOptions}
            canEdit={canEditTerminal ?? false}
            saving={terminalOverrideSaving}
            error={terminalOverrideError}
            onSave={onSaveTerminalOverride}
          />
        </div>
      ) : null}
      <Card>
        <h3 className="mb-3 text-sm font-semibold">Financeiro</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Item label="Taxas">{resolveChargeStatusLabel(bl.charge_status)}</Item>
          <Item label="Status">{statusLabel(FINANCIAL_STATUS_LABELS, bl.financial_status ?? 'pending')}</Item>
        </dl>
      </Card>
      {portalStatus ? <BlPortalCard status={portalStatus} /> : null}
    </div>
  )
}

function CargoModeBadge({ mode }: { mode: CargoMode }) {
  return <Badge tone={mode === 'misto' ? 'yellow' : mode === 'carga_solta' ? 'green' : 'blue'}>{cargoModeLabel(mode)}</Badge>
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs text-[var(--app-muted)]">{label}</dt><dd className="font-medium text-[var(--app-text-strong)]">{children}</dd></div>
}
