import { useMemo } from 'react'
import { Package } from 'lucide-react'
import { Link } from 'react-router-dom'
import { blsOfVoyagePath, voyageIdsWithCargo } from '../../lib/portalOperationViews'
import { usePortalOperationBls } from '../../hooks/usePortalOperation'
import { usePortalScheduleVoyages } from '../../hooks/usePortalScheduleVoyages'
import { usePortalScope } from '../../hooks/usePortalScope'
import { portalPath } from '../../services/portalScope'
import type { PortalScheduleVoyage } from '../../services/portalScheduleVoyages'
import { RowActionLink } from '../ui/RowActionLink'
import { useScheduleRefresh } from '../../hooks/useScheduleRefresh'
import { ShipScheduleBlock } from './ShipScheduleView'

/**
 * Atalho para os B/Ls do Cliente nesta viagem (ponto 2 de 2026-10-23): só na
 * viagem em que ele tem carga, ao lado do mapa. Leva à aba BLs filtrada pelo
 * navio e pela viagem, com o filtro na URL. Só no Portal logado: o quadro
 * público do fwlog.com.br não tem este atalho (ADR 0114).
 */
function CustomerCargoLink({ voyage, to, withText = false }: { voyage: PortalScheduleVoyage; to: string; withText?: boolean }) {
  const label = `Ver meus B/Ls no ${voyage.vesselName}, viagem ${voyage.voyage}`
  if (!withText) return <RowActionLink to={to} label={label} title="Ver meus B/Ls nesta viagem" icon={Package} variant="ghost" />
  return (
    <Link to={to} className="app-btn app-btn--ghost app-btn--sm" aria-label={label} title="Ver meus B/Ls nesta viagem">
      <Package size={14} aria-hidden="true" />
      {' Meus B/Ls'}
    </Link>
  )
}

/**
 * Chegadas e saídas no Portal (dono: etapa 03; composto no Painel do Portal
 * pela etapa 19; até 2026-10-23 "Programação de navios"). Mesma projeção e
 * mesmas regras de célula de Chegadas e Saídas do Vela, que publica estas
 * datas. Um bloco só (lote 4): o nome do serviço na faixa do título e a
 * legenda no pé. A parte visual mora em `ShipScheduleView`, que o quadro
 * público também usa.
 */
export function ShipScheduleWidget({ className }: { className?: string }) {
  const { data: vessels, isLoading, isError, refetch, isFetching, dataUpdatedAt } = usePortalScheduleVoyages()
  const scope = usePortalScope()
  // Mesma consulta da tela BLs e Containers e dos cartões do Painel: só os
  // B/Ls do próprio Cliente, liberados no Portal (escopo do banco).
  const { data: customerBls, refetch: refetchCustomerBls } = usePortalOperationBls()
  // Relê as datas e o recorte de carga.
  const { refreshing, refresh } = useScheduleRefresh(() => Promise.all([refetch(), refetchCustomerBls()]))
  const withCargo = useMemo(() => voyageIdsWithCargo(customerBls ?? []), [customerBls])
  const cargoAction = (vessel: PortalScheduleVoyage, withText: boolean) => {
    if (!withCargo.has(vessel.voyageId)) return null
    return <CustomerCargoLink voyage={vessel} to={portalPath(scope, blsOfVoyagePath(vessel.vesselName, vessel.voyage))} withText={withText} />
  }

  return (
    <ShipScheduleBlock
      vessels={vessels}
      isLoading={isLoading}
      isError={isError}
      isFetching={isFetching}
      dataUpdatedAt={dataUpdatedAt}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      onRetry={() => void refetch()}
      actions={cargoAction}
      className={className}
    />
  )
}
