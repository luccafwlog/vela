import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import type { BLDetail } from '../../types/database'
import type { ContainerSummary, BreakbulkSummary } from './BlCargaTab'
import { BlTransshipmentCard } from './BlTransshipmentCard'
import type { BlDisposition, VoyageOmission } from '../../services/transshipments'
import { BlPortalCard, type BlPortalStatus } from './BlPortalCard'
import { BlClienteSection } from './BlClienteSection'
import { formatNumber, type CargoMode } from '../../pages/blDetalheHelpers'
import { isBreakbulkCargoMode, isContainerCargoMode } from '../../lib/cargoMode'
import { BlTerminalOverrideCard, type BlTerminalOverrideOption } from './BlTerminalOverrideCard'

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

// Visão Geral: o que identifica o embarque, quem é o cliente e onde a carga
// descarrega. Datas de POL/POD e situação de taxas/fatura ficam só na linha do
// tempo acima das abas; aqui não se repetem.
export function BlVisaoGeralTab({ active, bl, cargoMode, containerSummary, breakbulkSummary, onCod, onRestore, disposition, omission, savingDisposition, portalStatus, baplieStatus, terminalOptions, canEditTerminal, terminalOverrideSaving, terminalOverrideError, onSaveTerminalOverride }: {
  active: boolean
  bl: BLDetail
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
  const showContainers = isContainerCargoMode(cargoMode)
  const showBreakbulk = isBreakbulkCargoMode(cargoMode)
  const voyageText = [bl.voyage?.vessel?.carrier?.name, bl.voyage?.vessel?.name, bl.voyage?.voyage_number].filter(Boolean).join(' / ') || '—'
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {omission ? (
        <div className="lg:col-span-2">
          <BlTransshipmentCard omission={omission} disposition={effectiveDisposition} saving={savingDisposition ?? false} onCod={onCod} onRestore={onRestore} />
        </div>
      ) : null}

      <Card className="lg:col-span-2">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Embarque</h3>
          {showContainers && bl.voyage_id && baplieStatus ? (
            <Link to={`/baplie?voyage=${bl.voyage_id}`} aria-label="Abrir conciliação do Baplie">
              <BaplieBadge status={baplieStatus} />
            </Link>
          ) : null}
        </div>
        {/* Contêiner e carga solta seguem os predicados compartilhados de
            modalidade: um B/L misto satisfaz os dois e mostra os dois blocos. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4 xl:grid-cols-6">
          <Item label="Armador / Navio / Viagem" className="col-span-2">
            {bl.voyage_id ? (
              <Link className="font-semibold text-[var(--app-link)] hover:underline" to={`/viagens/${bl.voyage_id}`}>{voyageText}</Link>
            ) : '—'}
          </Item>
          <Item label="Trecho" className="col-span-2">{`${bl.pol ?? '—'} → ${bl.pod ?? '—'}`}</Item>
          {showContainers ? (
            <>
              <Item label="Containers">{String(containerSummary.distinct)}</Item>
              <Item label="IMO / OOG">{`${containerSummary.imo} / ${containerSummary.oog}`}</Item>
              <Item label="SOC / COC">{`${containerSummary.soc} / ${containerSummary.coc}`}</Item>
            </>
          ) : null}
          {showBreakbulk ? (
            <>
              <Item label="Máquinas">{formatNumber(breakbulkSummary.machines)}</Item>
              <Item label="Packages">{formatNumber(breakbulkSummary.packagesTotal)}</Item>
              <Item label="Peso (t)">{formatNumber(breakbulkSummary.weightTon)}</Item>
              <Item label="CBM (m³)">{formatNumber(breakbulkSummary.cbm)}</Item>
            </>
          ) : null}
        </dl>
      </Card>

      <BlClienteSection bl={bl} />
      {portalStatus ? <BlPortalCard status={portalStatus} /> : <Card><h3 className="text-sm font-semibold">Portal</h3><p className="mt-2 text-sm text-[var(--app-muted)]">Verificando…</p></Card>}

      {terminalOptions ? (
        <div className="lg:col-span-2">
          <BlTerminalOverrideCard
            key={`${bl.id}:${bl.terminal_id ?? 'inherit'}:${bl.pod_port_id ?? 'none'}`}
            currentLabel={bl.terminal?.name ?? (bl.terminal_id ? `Terminal #${bl.terminal_id}` : 'Padrão da escala')}
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
    </div>
  )
}

function Item({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <dt className="text-xs text-[var(--app-muted)]">{label}</dt>
      <dd className="mt-0.5 font-medium text-[var(--app-text-strong)]">{children}</dd>
    </div>
  )
}
