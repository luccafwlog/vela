import { useQuery } from '@tanstack/react-query'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { formatBrasiliaDateTime } from './auditLogPresentation'
import { appEnvironmentLabel, formatAppVersion } from '../../lib/appVersion'
import { fetchSystemMetrics } from '../../services/adminObservability'
import { queryKeys } from '../../services/queryKeys'

/**
 * Sistema (lote 5b, achados A2 a A4): versão, ambiente da configuração da
 * build e as datas da última viagem criada e da última fatura emitida.
 */
export function AdminSystemTab() {
  const metrics = useQuery({ queryKey: queryKeys.admin.metrics(), queryFn: fetchSystemMetrics, staleTime: 60_000 })

  const dateFact = (value: string | null | undefined, missing: string) => {
    if (metrics.isLoading) return <NoValue label="Carregando" />
    return value ? formatBrasiliaDateTime(value) : <NoValue label={missing} />
  }

  return (
    <Block title="Sistema">
      <LeadValue detail="Versão">{formatAppVersion()}</LeadValue>
      {metrics.error ? (
        <div role="alert" className="mt-4">
          <p className="text-sm font-semibold text-[var(--app-text-strong)]">Não foi possível carregar as datas do sistema.</p>
          <Button variant="secondary" className="app-btn--sm mt-2" onClick={() => void metrics.refetch?.()}>Tentar novamente</Button>
        </div>
      ) : null}
      <FactList columns={3} className="mt-4">
        <Fact label="Ambiente">{appEnvironmentLabel()}</Fact>
        {metrics.error ? null : (
          <>
            <Fact label="Última viagem criada">{dateFact(metrics.data?.lastVoyageCreatedAt, 'Nenhuma viagem criada')}</Fact>
            <Fact label="Última fatura emitida">{dateFact(metrics.data?.lastInvoiceIssuedAt, 'Nenhuma fatura emitida')}</Fact>
          </>
        )}
      </FactList>
    </Block>
  )
}
