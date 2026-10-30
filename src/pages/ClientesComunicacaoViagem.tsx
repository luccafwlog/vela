import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink, Link2, Send, Ship } from 'lucide-react'
import { Block, Fact, FactList, LeadValue } from '../components/ui/Block'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { Button } from '../components/ui/Button'
import { InlineError } from '../components/ui/Card'
import { IdentityBand } from '../components/ui/IdentityBand'
import { NoValue } from '../components/ui/NoValue'
import { RowActionLink } from '../components/ui/RowActionLink'
import { SkeletonCard } from '../components/ui/Skeleton'
import { StatusText } from '../components/ui/StatusText'
import { CoverageCount, FinanceCoverageCount } from '../components/customers/CoverageCounts'
import { CoverageCustomerTable } from '../components/customers/CoverageDrilldown'
import { useAuth } from '../hooks/useAuth'
import { useCustomerCommunicationHistory, useVoyageCommunicationDetail } from '../hooks/useCustomerCommunications'
import { formatCnpjCpf, formatDate, formatDateTime } from '../lib/utils'
import {
  communicationPortCode,
  customerCommunicationKindLabel,
  customerCommunicationStatusLabel,
  type CoverageEscalaRow,
  type CoverageUnlinkedConsignee,
  type VoyageCommunicationCoverageSummary,
} from '../services/customerCommunications'

const COBERTURA_HREF = '/clientes/comunicacao?tab=cobertura'

function plural(count: number, singular: string, pluralWord: string) {
  return `${count} ${count === 1 ? singular : pluralWord}`
}

/** "ETA 24/10/2026 · ATA 29/10/2026 · ATB 29/10/2026", só com os marcos que existem. */
function escalaMilestones(escala: CoverageEscalaRow | undefined): string | null {
  if (!escala) return null
  const parts = [
    escala.eta ? `ETA ${formatDate(escala.eta)}` : null,
    escala.ata ? `ATA ${formatDate(escala.ata)}` : null,
    escala.atb ? `ATB ${formatDate(escala.atb)}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function escalaForPort(escalas: readonly CoverageEscalaRow[], port: string | null): CoverageEscalaRow | undefined {
  const code = communicationPortCode(port)
  return escalas.find((escala) => !escala.omitted && communicationPortCode(escala.pod) === code)
}

/** Situação do Comunicado em texto: falha em vermelho, parcial e em envio em âmbar. */
function historyStatusTone(status: string) {
  if (status === 'falha') return 'danger' as const
  if (status === 'parcial' || status === 'pendente') return 'warning' as const
  return 'default' as const
}

/**
 * Página dos Comunicados de uma viagem (pedido do dono de 2026-10-30): a
 * Cobertura de viagens mostra só o resumo, e o navio/viagem abre esta página,
 * com os B/Ls sem Cliente, cada porto com os Clientes e a situação de cada
 * modelo, e o histórico da viagem. Disparar leva à aba Disparo já filtrada.
 */
export function ClientesComunicacaoViagem() {
  const { voyageId: voyageParam } = useParams()
  const voyageId = Number(voyageParam)
  const validId = Number.isInteger(voyageId) && voyageId > 0
  const { can } = useAuth()
  const canSend = can('customer_communications')
  const detailQuery = useVoyageCommunicationDetail(validId ? voyageId : null)
  const historyQuery = useCustomerCommunicationHistory({ voyageId }, { enabled: validId })
  // "Na fila · HH:MM" conta da hora da leitura; a releitura depois da rodada atualiza os dois.
  const now = useMemo(() => new Date(detailQuery.dataUpdatedAt), [detailQuery.dataUpdatedAt])
  const detail = detailQuery.data

  if (!validId || detail === null) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Comunicação', to: COBERTURA_HREF }, { label: 'Viagem não encontrada' }]} />
        <Block title="Viagem não encontrada">
          <p className="text-[var(--app-muted)]">Esta viagem não existe ou foi excluída.</p>
          <Link className="app-btn app-btn--secondary mt-3" to={COBERTURA_HREF}>Voltar para a Cobertura de viagens</Link>
        </Block>
      </>
    )
  }

  if (detailQuery.isError) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Comunicação', to: COBERTURA_HREF }, { label: 'Viagem' }]} />
        <div className="flex flex-wrap items-center gap-3">
          <InlineError message="Não foi possível carregar os Comunicados desta viagem." />
          <Button type="button" variant="secondary" onClick={() => void detailQuery.refetch()}>Tentar novamente</Button>
        </div>
      </>
    )
  }

  if (!detail) {
    return (
      <>
        <Breadcrumb items={[{ label: 'Comunicação', to: COBERTURA_HREF }, { label: 'Carregando…' }]} />
        <div className="grid gap-4" role="status" aria-label="Carregando os Comunicados da viagem">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={5} />
        </div>
      </>
    )
  }

  const label = `${detail.voyage.vessel?.name ?? '—'} / ${detail.voyage.voyage_number}`
  const portRows = detail.rows.filter((row) => row.port)
  const customers = new Set(detail.rows.flatMap((row) => row.details.map((item) => item.customerId))).size
  const unlinked = detail.rows.flatMap((row) => row.unlinked.consignees.map((consignee) => ({ ...consignee, port: row.port })))
  const unlinkedBls = detail.rows.reduce((total, row) => total + row.unlinked.bls, 0)
  const unlinkedConsignees = new Set(unlinked.map((item) => item.key)).size
  const disparoHref = (port?: string | null) => `/clientes/comunicacao?tab=disparo&voyage=${voyageId}${port ? `&pod=${encodeURIComponent(port)}` : ''}`

  return (
    <>
      <Breadcrumb items={[{ label: 'Comunicação', to: COBERTURA_HREF }, { label }]} />
      <div className="mb-4">
        <IdentityBand
          kind="Comunicados da viagem"
          title={label}
          facts={[
            {
              label: 'Portos de descarga',
              value: portRows.length ? (
                <span className="inline-flex flex-col">
                  {portRows.map((row) => {
                    const milestones = escalaMilestones(escalaForPort(detail.escalas, row.port))
                    return <span key={row.port}>{row.port}{milestones ? ` — ${milestones}` : ''}</span>
                  })}
                </span>
              ) : <NoValue label="Sem B/L ativo" />,
            },
            { label: 'Clientes', value: customers ? customers : 'Nenhum' },
            {
              label: 'B/Ls sem Cliente',
              // Na faixa, só o número: a pendência fica em destaque no bloco logo abaixo.
              value: unlinkedBls ? plural(unlinkedBls, 'B/L', 'B/Ls') : 'Nenhum',
            },
          ]}
          actions={(
            <>
              {canSend ? (
                <Link className="app-btn app-btn--primary" to={disparoHref()}>
                  <Send size={16} aria-hidden="true" /> Disparar Comunicado
                </Link>
              ) : null}
              <Link className="app-btn app-btn--ghost" to={`/viagens/${voyageId}`}>
                <Ship size={16} aria-hidden="true" /> Abrir a Viagem
              </Link>
            </>
          )}
        />
      </div>

      {unlinkedBls ? <UnlinkedBlock voyageId={voyageId} bls={unlinkedBls} consigneesCount={unlinkedConsignees} consignees={unlinked} /> : null}

      {portRows.map((row) => (
        <PortBlock
          key={row.port}
          row={row}
          escala={escalaForPort(detail.escalas, row.port)}
          now={now}
          disparoHref={canSend ? disparoHref(row.port) : null}
        />
      ))}

      <Block
        title="Histórico da viagem"
        aside={historyQuery.data ? plural(historyQuery.data.length, 'Comunicado', 'Comunicados') : null}
        flush
      >
        {historyQuery.isError ? <div className="p-4"><InlineError message="Não foi possível carregar o histórico da viagem." /></div> : null}
        {historyQuery.isLoading ? <p className="px-4 py-6 text-[var(--app-muted)]">Carregando histórico...</p> : historyQuery.data?.length ? (
          <div className="app-table-scroll">
            <table className="app-table">
              <caption className="sr-only">{`Comunicados da viagem ${label}`}</caption>
              <thead>
                <tr>
                  <th scope="col">Registrado em</th>
                  <th scope="col" className="app-table__text-head">Cliente</th>
                  <th scope="col" className="app-table__text-head">Modelo</th>
                  <th scope="col">Porto</th>
                  <th scope="col">Origem</th>
                  <th scope="col">Destinatários</th>
                  <th scope="col">Situação</th>
                  <th scope="col"><span className="sr-only">Abrir no Histórico</span></th>
                </tr>
              </thead>
              <tbody>
                {historyQuery.data.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap">{formatDateTime(item.created_at)}</td>
                    <td className="app-table__text">
                      {item.customer?.cnpj_cpf ? (
                        <Link className="app-link" to={`/clientes/${encodeURIComponent(item.customer.cnpj_cpf)}`}>{item.customer.name}</Link>
                      ) : item.customer?.name ?? `Cliente ${item.customer_id}`}
                    </td>
                    <td className="app-table__text">{customerCommunicationKindLabel(item.kind)}</td>
                    <td>{item.anchor_port ?? <NoValue label="Sem porto" />}</td>
                    <td>{item.origin === 'automatico' ? 'Automático' : 'Operador'}</td>
                    <td>{item.attempts.length}</td>
                    <td><StatusText tone={historyStatusTone(item.status)}>{customerCommunicationStatusLabel(item.status)}</StatusText></td>
                    <td>
                      <RowActionLink
                        label={`Abrir no Histórico o Comunicado de ${item.customer?.name ?? 'Cliente'}`}
                        title="Abrir no Histórico, com os destinatários"
                        icon={ExternalLink}
                        to={`/clientes/comunicacao?tab=historico&communication=${item.id}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : historyQuery.data ? (
          <p className="px-4 py-6 text-[var(--app-muted)]">Nenhum Comunicado desta viagem ainda.</p>
        ) : null}
      </Block>
    </>
  )
}

/**
 * B/Ls da viagem sem Cliente, por consignatário do manifesto e porto: nenhum
 * Comunicado sai para eles, e "Vincular na Revisão" leva aonde o vínculo se resolve.
 */
function UnlinkedBlock({ voyageId, bls, consigneesCount, consignees }: {
  voyageId: number
  bls: number
  consigneesCount: number
  consignees: Array<CoverageUnlinkedConsignee & { port: string | null }>
}) {
  return (
    <Block title="B/Ls sem Cliente" aside={plural(consigneesCount, 'consignatário', 'consignatários')} flush>
      <div className="p-4">
        <LeadValue tone="warning" detail="Nenhum Comunicado (CE e Taxas, NOA, NOR, NOB) sai para eles até o Cliente ser vinculado. Importe a Base de Clientes ou vincule na Revisão.">
          {plural(bls, 'B/L sem Cliente', 'B/Ls sem Cliente')}
        </LeadValue>
      </div>
      <div className="app-table-scroll">
        <table className="app-table">
          <caption className="sr-only">B/Ls sem Cliente, por consignatário do manifesto</caption>
          <thead>
            <tr>
              <th scope="col" className="app-table__text-head">Consignatário no manifesto</th>
              <th scope="col">CNPJ/CPF</th>
              <th scope="col">Porto</th>
              <th scope="col" className="app-table__text-head">B/Ls</th>
              <th scope="col"><span className="sr-only">Vincular</span></th>
            </tr>
          </thead>
          <tbody>
            {consignees.map((consignee) => (
              <tr key={`${consignee.port ?? ''}:${consignee.key}`}>
                <th scope="row" className="app-table__text">{consignee.name ?? <NoValue label="Sem nome no manifesto" />}</th>
                <td className="font-mono">{consignee.document ? formatCnpjCpf(consignee.document) : <NoValue label="Sem CNPJ no manifesto" />}</td>
                <td>{consignee.port ?? <NoValue label="Sem porto" />}</td>
                <td className="app-table__text app-table__text--wrap font-mono text-xs">{consignee.blIds.join(', ')}</td>
                <td>
                  <RowActionLink
                    label={`Vincular na Revisão: ${consignee.name ?? consignee.blIds[0] ?? 'consignatário'}`}
                    title="Vincular na Revisão"
                    icon={Link2}
                    to={`/revisao?voyage=${voyageId}&busca=${encodeURIComponent(consignee.document ?? consignee.blIds[0] ?? '')}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  )
}

/** Um porto de descarga: os totais da Cobertura e cada Cliente com a situação de cada modelo. */
function PortBlock({ row, escala, now, disparoHref }: {
  row: VoyageCommunicationCoverageSummary
  escala: CoverageEscalaRow | undefined
  now: Date
  disparoHref: string | null
}) {
  const milestones = escalaMilestones(escala)
  return (
    <Block
      title={`Porto ${row.port}`}
      aside={disparoHref ? (
        <Link className="app-btn app-btn--secondary app-btn--sm" to={disparoHref}>
          <Send size={14} aria-hidden="true" /> Disparar para {row.port}
        </Link>
      ) : undefined}
      flush
    >
      <div className="grid gap-4 p-4">
        <LeadValue detail={[milestones, row.unlinked.bls ? `${plural(row.unlinked.bls, 'B/L', 'B/Ls')} sem Cliente neste porto` : null].filter(Boolean).join(' · ') || undefined}>
          {row.customers ? plural(row.customers, 'Cliente', 'Clientes') : 'Nenhum Cliente vinculado'}
        </LeadValue>
        <FactList columns={4}>
          <Fact label="CE e Taxas enviados"><FinanceCoverageCount sent={row.finance.sent} due={row.finance.due} resend={row.finance.resend} queued={row.queued.ce_mercante_taxas} now={now} /></Fact>
          <Fact label="NOA"><CoverageCount sent={row.noa.sent} total={row.noa.total} queued={row.queued.aviso_chegada_noa} now={now} /></Fact>
          <Fact label="NOR"><CoverageCount sent={row.nor.sent} total={row.nor.total} queued={row.queued.aviso_prontidao_nor} now={now} /></Fact>
          <Fact label="NOB"><CoverageCount sent={row.nob.sent} total={row.nob.total} queued={row.queued.aviso_atracacao_nob} now={now} /></Fact>
        </FactList>
      </div>
      <CoverageCustomerTable row={row} now={now} />
    </Block>
  )
}
