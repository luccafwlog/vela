import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { Switch } from '../ui/Switch'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { QueryStateGate } from '../shared/QueryStateGate'
import { AdminAlertFailuresTab } from './AdminAlertFailuresTab'
import { formatBrasiliaDateTime } from './auditLogPresentation'
import { appEnvironmentLabel, formatAppVersion } from '../../lib/appVersion'
import { userFacingErrorMessage } from '../../lib/errors'
import { describeCronSchedule, routineLabel } from '../../lib/systemRoutines'
import { formatDate } from '../../lib/utils'
import { useSetCommunicationsEnabled } from '../../hooks/useAppSettings'
import { fetchSystemHealth, fetchSystemRoutines, sendAdminTestEmail, type SystemHealth } from '../../services/adminObservability'
import { systemAttentionItems } from './systemAttention'
import { SUPPORT_REDIRECT_ADDRESS } from '../../services/customerCommunications'
import { queryKeys } from '../../services/queryKeys'

const CHECKED = [
  'Equipes com pessoa ativa',
  'Alertas com destinatário (30 dias)',
  'Rotinas sem falha na última execução',
  'Leitura do Pix Itaú em dia',
  'E-mails sem bloqueio',
  'Feriados do ano seguinte',
]

/**
 * Sistema (Administração; só a conta Dev, decisão do dono de 2026-11-06): os
 * Pontos de atenção, as rotinas automáticas, as configurações (com o Envio
 * real, que saiu de Clientes › Comunicação) e as falhas de entrega de alertas.
 * As leituras são recusadas no banco a quem não é a conta Dev (migration 605).
 */
export function AdminSystemTab() {
  const health = useQuery({ queryKey: queryKeys.admin.systemHealth(), queryFn: fetchSystemHealth, staleTime: 60_000 })
  const routines = useQuery({ queryKey: queryKeys.admin.systemRoutines(), queryFn: fetchSystemRoutines, staleTime: 60_000 })

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <Block title="Pontos de atenção">
            <QueryStateGate
              isLoading={health.isLoading}
              isError={Boolean(health.error)}
              hasData={health.data !== undefined}
              errorMessage="Não foi possível conferir o sistema."
              onRetry={() => void health.refetch?.()}
              loadingLabel="Conferindo o sistema…"
            >
              {health.data ? <AttentionList health={health.data} /> : null}
            </QueryStateGate>
          </Block>
          <Block title="Configurações" aside="Cada troca fica no Histórico de ações">
            <QueryStateGate
              isLoading={health.isLoading}
              isError={Boolean(health.error)}
              hasData={health.data !== undefined}
              errorMessage="Não foi possível carregar as configurações."
              onRetry={() => void health.refetch?.()}
              loadingLabel="Carregando as configurações…"
            >
              {health.data ? <Settings health={health.data} /> : null}
            </QueryStateGate>
          </Block>
        </div>
        <Block
          title="Rotinas automáticas"
          aside={routines.data ? `${routines.data.length} ${routines.data.length === 1 ? 'rotina' : 'rotinas'} · ${routines.data.reduce((sum, row) => sum + row.failures_7d, 0)} falhas em 7 dias` : null}
          flush
        >
          <QueryStateGate
            isLoading={routines.isLoading}
            isError={Boolean(routines.error)}
            hasData={routines.data !== undefined}
            errorMessage="Não foi possível carregar as rotinas."
            onRetry={() => void routines.refetch?.()}
            loadingLabel="Carregando as rotinas…"
          >
            {routines.data && routines.data.length ? (
              <div className="app-table-scroll">
                <table className="app-table">
                  <caption className="sr-only">Rotinas automáticas do Vela</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="app-table__text-head">Rotina</th>
                      <th scope="col">Roda</th>
                      <th scope="col">Última vez</th>
                      <th scope="col">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routines.data.map((routine) => (
                      <tr key={routine.jobname}>
                        <td className="app-table__text" title={routine.jobname}>{routineLabel(routine.jobname)}</td>
                        <td className="whitespace-nowrap">{describeCronSchedule(routine.schedule)}</td>
                        <td className="tabular-nums whitespace-nowrap">{routine.last_run_at ? formatBrasiliaDateTime(routine.last_run_at) : <NoValue label="Ainda não rodou" />}</td>
                        <td className="whitespace-nowrap"><RoutineStatus active={routine.active} status={routine.last_status} failures={routine.failures_7d} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-[var(--app-muted)]">Nenhuma rotina cadastrada.</p>
            )}
          </QueryStateGate>
        </Block>
      </div>

      <AdminAlertFailuresTab />

      <FactList columns={2}>
        <Fact label="Versão">{formatAppVersion()}</Fact>
        <Fact label="Ambiente">{appEnvironmentLabel()}</Fact>
      </FactList>
    </div>
  )
}

function RoutineStatus({ active, status, failures }: { active: boolean; status: string | null; failures: number }) {
  if (!active) return <StatusText tone="muted">Desligada</StatusText>
  if (status === 'failed') return <StatusText tone="warning">Falhou</StatusText>
  if (status === 'running' || status === 'starting') return <>Rodando</>
  if (!status) return <NoValue label="Sem execução registrada" />
  return failures > 0 ? <span title={`${failures} falhas em 7 dias`}>Em dia</span> : <>Em dia</>
}

function AttentionList({ health }: { health: SystemHealth }) {
  const items = systemAttentionItems(health)
  if (!items.length) {
    return (
      <div className="grid gap-3">
        <LeadValue detail="Quando algo acontecer, aparece aqui com o que fazer.">Nada pede atenção</LeadValue>
        <p className="text-sm text-[var(--app-muted)]">Conferido: {CHECKED.join(' · ')}.</p>
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      <LeadValue tone="warning" detail="Cada item some sozinho quando a causa é resolvida.">
        {items.length} {items.length === 1 ? 'ponto pede atenção' : 'pontos pedem atenção'}
      </LeadValue>
      <ul className="grid gap-2">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center justify-between gap-2">
            <span>{item.text}</span>
            {item.action ? <Link to={item.action.to} className="app-btn app-btn--secondary app-btn--sm">{item.action.label}</Link> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Settings({ health }: { health: SystemHealth }) {
  const confirm = useConfirm()
  const { showToast } = useToast()
  const setCommunications = useSetCommunicationsEnabled()
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const enabled = health.communications_enabled

  async function toggle(next: boolean) {
    // A confirmação continua nos dois sentidos (ADR 0104), como em Comunicação antes.
    const confirmed = await confirm(next
      ? {
        title: 'Ativar envio real',
        message: 'Confirma a ativação da chave global de envio? Os próximos e-mails de Comunicados, cobranças, Desbloqueio de CE e Portal sairão para os Clientes.',
        confirmLabel: 'Ativar envio real',
        tone: 'danger',
      }
      : {
        title: 'Desativar envio real',
        message: `Deseja desativar a chave global de envio? Todo e-mail de Cliente passará a ir para ${SUPPORT_REDIRECT_ADDRESS}.`,
        confirmLabel: 'Desativar envio real',
        tone: 'danger',
      })
    if (!confirmed) return
    setToggleError(null)
    try {
      await setCommunications.mutateAsync(next)
    } catch (error) {
      setToggleError(userFacingErrorMessage(error, 'Não foi possível trocar a chave de envio. Tente novamente.'))
    }
  }

  async function sendTest() {
    setTesting(true)
    setTestError(null)
    try {
      const to = await sendAdminTestEmail()
      showToast(to ? `E-mail de teste enviado para ${to}.` : 'E-mail de teste enviado.', 'success')
    } catch (error) {
      // `sendAdminTestEmail` já devolve o texto da Edge Function (e-mail bloqueado,
      // conta sem e-mail, só a conta Dev) ou o texto padrão: mostrar como veio.
      setTestError(error instanceof Error && error.message ? error.message : 'Não foi possível enviar o e-mail de teste. Tente novamente.')
    } finally {
      setTesting(false)
    }
  }

  const pixDays = health.pix_expiration_seconds ? Math.round(health.pix_expiration_seconds / 86_400) : null
  return (
    <div className="grid gap-4">
      <section aria-labelledby="sistema-envio-real" className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="sistema-envio-real" className="text-sm font-semibold text-[var(--app-text-strong)]">Envio real dos e-mails ao Cliente</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" className="app-btn--sm" disabled={testing} onClick={() => void sendTest()}>
              {testing ? 'Enviando…' : 'Enviar teste para mim'}
            </Button>
            <Switch checked={enabled} disabled={setCommunications.isPending} onChange={(next) => void toggle(next)}>
              {enabled ? 'Envio real ligado' : 'Envio real desligado'}
            </Switch>
          </div>
        </div>
        {enabled
          ? <LeadValue detail="Os e-mails de Comunicados, cobranças, Desbloqueio de CE e Portal saem para os contatos elegíveis.">Envio real</LeadValue>
          : <LeadValue tone="warning" detail={`Todo e-mail de Cliente vai para ${SUPPORT_REDIRECT_ADDRESS}, com o e-mail do Cliente no assunto.`}>Redirecionado ao suporte</LeadValue>}
        {toggleError ? <InlineError message={toggleError} /> : null}
        {testError ? <InlineError message={testError} /> : null}
      </section>
      <FactList columns={2}>
        <Fact label="Régua de cobrança da Demurrage">
          {health.dunning_interval_days ? `A cada ${health.dunning_interval_days} ${health.dunning_interval_days === 1 ? 'dia' : 'dias'}` : <NoValue label="Sem intervalo" />}
          {' · '}<Link className="app-link" to="/demurrage">Muda em Demurrage</Link>
        </Fact>
        <Fact label="Conta das rotinas">
          {health.routine_actor_name
            ?? (health.routine_actor_effective_name ? `Não escolhida: usa ${health.routine_actor_effective_name}, a conta ativa mais antiga do Administrativo` : <NoValue label="Nenhuma conta ativa do Administrativo" />)}
        </Fact>
        <Fact label="Pix">
          {health.pix_provider === 'itau'
            ? `Itaú${pixDays ? `, vence em ${pixDays} dias` : ''}${health.pix_settlement_actor_name ? `; baixa automática por ${health.pix_settlement_actor_name}` : ''}`
            : 'QR Code estático'}
        </Fact>
        <Fact label="Feriados de Vitória/ES">
          {health.holidays_last_day ? `Cadastrados até ${formatDate(health.holidays_last_day)}` : <NoValue label="Nenhum feriado cadastrado" />}
        </Fact>
      </FactList>
      <p className="text-sm text-[var(--app-muted)]">Conta das rotinas, Pix e feriados são mudados pelo suporte técnico.</p>
    </div>
  )
}
