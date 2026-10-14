import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, MoreVertical, Pencil, Plus } from 'lucide-react'
import { ActionMenu } from '../components/ui/ActionMenu'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState, PageHeader } from '../components/ui/Card'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { useConfirm, useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { CustomerDemurrageAgreementsTab } from '../components/demurrage/CustomerDemurrageAgreementsTab'
import { DemurrageRateModal } from '../components/demurrage/DemurrageRateModal'
import { useAuth } from '../hooks/useAuth'
import {
  useDeleteDemurrageRate,
  useDemurrageRates,
  useSaveDemurrageRate,
  useToggleDemurrageRateActive,
} from '../hooks/useDemurrageRates'
import type { DemurrageRateUpsertInput } from '../services/demurrage/demurrageRateUpsertPayload'
import type { DemurrageRate } from '../types/database'
import { classifyDbError } from '../lib/errors'
import { saoPauloTodayIso } from '../lib/dates'
import { formatDate, formatUSD } from '../lib/utils'

type RatesTab = 'padrao' | 'acordos'

function rateVigencia(rate: DemurrageRate) {
  const from = rate.valid_from ? formatDate(rate.valid_from) : 'sem início'
  return rate.valid_to ? `${from} até ${formatDate(rate.valid_to)}` : `desde ${from}`
}

/** Tarifa ou acordo com vigência já iniciada (sem data conta como em vigor). */
function inForce(validFrom: string | null | undefined) {
  return !validFrom || validFrom.slice(0, 10) <= saoPauloTodayIso()
}

export function DemurrageRates() {
  // Criar e editar é de qualquer Departamento; ativar, desativar e excluir, do Administrativo (ADR 0085, D6; ADR 0073, item 4).
  const { isAdmin, effectiveRole } = useAuth()
  const canEdit = effectiveRole != null
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: RatesTab = searchParams.get('tab') === 'acordos' ? 'acordos' : 'padrao'
  const [editing, setEditing] = useState<{ rate: DemurrageRate | null } | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const ratesQuery = useDemurrageRates()
  const rates = ratesQuery.data
  const saveMutation = useSaveDemurrageRate()
  const deleteMutation = useDeleteDemurrageRate()
  const toggleMutation = useToggleDemurrageRateActive()

  function selectTab(next: RatesTab) {
    setSearchParams((params) => {
      const updated = new URLSearchParams(params)
      if (next === 'acordos') updated.set('tab', 'acordos')
      else {
        updated.delete('tab')
        updated.delete('cliente')
      }
      return updated
    }, { replace: true })
  }

  function openRate(rate: DemurrageRate | null) {
    setSaveError(null)
    setEditing({ rate })
  }

  async function handleSave(input: Omit<DemurrageRateUpsertInput, 'id' | 'active'>) {
    const original = editing?.rate ?? null
    const changes = original
      ? [
          { field: 'Tipo de container', before: original.container_type, after: input.container_type },
          { field: 'Free time', before: `${original.free_days} dias`, after: `${input.free_days} dias` },
          { field: 'Faixa P1 (dias)', before: `${original.p1_day_from} a ${original.p1_day_to}`, after: `${input.p1_day_from} a ${input.p1_day_to}` },
          { field: 'Diária P1', before: formatUSD(original.p1_usd), after: formatUSD(input.p1_usd) },
          { field: 'P2 a partir do dia', before: String(original.p2_day_from), after: String(input.p2_day_from) },
          { field: 'Diária P2', before: formatUSD(original.p2_usd), after: formatUSD(input.p2_usd) },
          { field: 'Vigência de', before: original.valid_from ? formatDate(original.valid_from) : '', after: input.valid_from ? formatDate(input.valid_from) : '' },
          { field: 'Vigência até', before: original.valid_to ? formatDate(original.valid_to) : '', after: input.valid_to ? formatDate(input.valid_to) : '' },
          { field: 'Observações', before: original.notes ?? '', after: input.notes ?? '' },
        ].filter((change) => change.before !== change.after)
      : []
    if (original && changes.length === 0) {
      // Nada a gravar não é falha: fecha e avisa.
      showToast('Nada mudou na tarifa.', 'info')
      setEditing(null)
      return
    }
    const confirmed = await confirm({
      title: original ? 'Salvar tarifa de Demurrage' : 'Cadastrar tarifa de Demurrage',
      message: original
        ? `Salvar as alterações da tarifa padrão do container ${input.container_type}?`
        : `Cadastrar a tarifa padrão do container ${input.container_type}?`,
      confirmLabel: original ? 'Salvar alterações' : 'Cadastrar tarifa',
      changes: original ? changes : undefined,
      affected: !original
        ? { summary: `${input.container_type} · Free time ${input.free_days} dias · P1 ${formatUSD(input.p1_usd)}/dia · P2 ${formatUSD(input.p2_usd)}/dia` }
        : undefined,
      consequence: 'Vale para os cálculos novos deste tipo de container quando o B/L não tem condição própria e o Cliente não tem acordo vigente na descarga. Invoices já emitidas não mudam.',
      reversibility: 'A tarifa pode ser editada ou desativada no cadastro.',
    })
    if (!confirmed) return
    saveMutation.mutate({ ...input, ...(original ? { id: original.id, active: original.active } : { active: true }) }, {
      onSuccess: () => {
        showToast(original ? 'Tarifa atualizada.' : 'Tarifa cadastrada.', 'success')
        setEditing(null)
      },
      // classifyDbError guarda a orientação de negócio do banco e troca o texto
      // cru de constraint ("violates check constraint …") por uma frase legível.
      onError: (error) => setSaveError(classifyDbError(error).message),
    })
  }

  async function handleDelete(rate: DemurrageRate) {
    const reason = await confirmWithReason({
      title: `Excluir tarifa ${rate.container_type}`,
      message: `Excluir a tarifa padrão de Demurrage do container ${rate.container_type}?`,
      consequence: 'A tarifa ainda não entrou em vigor: sai do cadastro antes de valer para qualquer cálculo.',
      reversibility: 'Não é possível desfazer; cadastre de novo se precisar. Para parar de usar sem apagar, desative.',
      tone: 'danger',
      confirmLabel: 'Excluir tarifa',
    })
    if (reason === null) return
    deleteMutation.mutate({ id: rate.id, reason }, {
      onSuccess: () => showToast('Tarifa excluída.', 'success'),
      onError: (error) => showToast(`Falha ao excluir a tarifa: ${classifyDbError(error).message}`, 'error'),
    })
  }

  async function handleToggleActive(rate: DemurrageRate) {
    const nextActive = !rate.active
    // B13: reativar pede motivo (ADR 0072), gravado pela RPC reactivate_catalog_row (migration 261).
    const confirmOptions = {
      title: nextActive ? `Reativar tarifa ${rate.container_type}` : `Desativar tarifa ${rate.container_type}`,
      message: nextActive
        ? `Reativar a tarifa padrão do container ${rate.container_type}?`
        : `Desativar a tarifa padrão do container ${rate.container_type}?`,
      confirmLabel: nextActive ? 'Reativar' : 'Desativar',
      tone: nextActive ? ('primary' as const) : ('danger' as const),
      changes: [{ field: 'Situação', before: rate.active ? 'Ativa' : 'Inativa', after: nextActive ? 'Ativa' : 'Inativa' }],
      consequence: nextActive
        ? 'A tarifa volta a ser considerada nos cálculos de Demurrage.'
        : 'A tarifa deixa de ser usada em cálculos novos; Invoices já emitidas não mudam.',
      reversibility: nextActive ? 'Desative de novo se precisar.' : 'Reative a tarifa quando precisar.',
    }
    const reason = nextActive ? await confirmWithReason(confirmOptions) : (await confirm(confirmOptions)) ? '' : null
    if (reason === null) return
    toggleMutation.mutate(
      { id: rate.id, active: nextActive, reason },
      {
        onSuccess: () => showToast(nextActive ? 'Tarifa reativada.' : 'Tarifa desativada.', 'success'),
        onError: (error) => showToast(`Falha ao alterar a situação: ${classifyDbError(error).message}`, 'error'),
      },
    )
  }

  return (
    <div className="app-dem-page">
      <Link className="app-fin-link app-dem-back" to="/demurrage"><ArrowLeft size={14} aria-hidden="true" />Demurrage</Link>
      <PageHeader
        title="Tarifas de Demurrage"
        description={`Ordem de aplicação em cada container: condição do B/L, depois o acordo do Cliente vigente na data de descarga, depois a tabela padrão.${isAdmin ? '' : ' Ativar, desativar e excluir tarifas e acordos é do Administrativo.'}`}
        action={canEdit && tab === 'padrao' ? (
          <Button onClick={() => openRate(null)}>
            <Plus size={16} aria-hidden="true" />
            Nova tarifa
          </Button>
        ) : undefined}
      />
      <TabList label="Tarifas de Demurrage" className="app-dem-tabs">
        <TabButton id="dem-rates-tab-padrao" controls="dem-rates-panel" active={tab === 'padrao'} label="Tabela padrão" onClick={() => selectTab('padrao')} />
        <TabButton id="dem-rates-tab-acordos" controls="dem-rates-panel" active={tab === 'acordos'} label="Acordos de Clientes" onClick={() => selectTab('acordos')} />
      </TabList>

      <div id="dem-rates-panel" role="tabpanel" aria-labelledby={`dem-rates-tab-${tab}`}>
        {tab === 'acordos' ? (
          <CustomerDemurrageAgreementsTab canEdit={canEdit} canManage={isAdmin} />
        ) : (
          <QueryStateGate
            isLoading={ratesQuery.isLoading}
            isError={Boolean(ratesQuery.error)}
            hasData={rates !== undefined}
            errorMessage="Não foi possível carregar as tarifas de Demurrage."
            onRetry={() => void ratesQuery.refetch()}
            loadingLabel="Carregando tarifas…"
          >
            {!rates?.length ? (
              <EmptyState title="Nenhuma tarifa cadastrada" description="Sem tarifa vigente para o tipo de container, o cálculo de Demurrage falha com aviso ao operador." />
            ) : (
              <div className="app-surface app-dem-table-surface">
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact app-dem-table app-dem-table--rates">
                    <caption className="sr-only">Tabela padrão de tarifas de Demurrage</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="app-table__text-head">Tipo de container</th>
                        <th scope="col" className="app-dem-num">Free time</th>
                        <th scope="col">P1</th>
                        <th scope="col">P2</th>
                        <th scope="col">Vigência</th>
                        <th scope="col">Situação</th>
                        {canEdit ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {rates.map((rate) => (
                        <tr key={rate.id}>
                          <td>
                            <div className="app-table__cell-stack">
                              <span className="app-dem-code app-dem-strong">{rate.container_type}</span>
                              {rate.notes ? <span className="app-dem-meta">{rate.notes}</span> : null}
                            </div>
                          </td>
                          <td className="app-dem-num">{rate.free_days} dias</td>
                          <td>
                            <div className="app-table__cell-stack app-table__cell-stack--center">
                              <span className="tabular-nums">{formatUSD(rate.p1_usd ?? 0)}/dia</span>
                              <span className="app-dem-meta">dias {rate.p1_day_from} a {rate.p1_day_to}</span>
                            </div>
                          </td>
                          <td>
                            <div className="app-table__cell-stack app-table__cell-stack--center">
                              <span className="tabular-nums">{formatUSD(rate.p2_usd ?? 0)}/dia</span>
                              <span className="app-dem-meta">a partir do dia {rate.p2_day_from}</span>
                            </div>
                          </td>
                          <td className="tabular-nums">{rateVigencia(rate)}</td>
                          <td><Badge tone={rate.active ? 'success' : 'neutral'}>{rate.active ? 'Ativa' : 'Inativa'}</Badge></td>
                          {canEdit ? (
                            <td className="app-dem-row-action">
                              <div className="app-dem-row-buttons">
                                <Button variant="ghost" className="app-btn--sm" onClick={() => openRate(rate)} aria-label={`Editar tarifa ${rate.container_type}`}>
                                  <Pencil size={14} aria-hidden="true" />
                                  Editar
                                </Button>
                                {isAdmin ? <ActionMenu
                                  label={`Mais ações da tarifa ${rate.container_type}`}
                                  triggerClassName="app-table__icon-button app-table__icon-button--sm"
                                  trigger={<MoreVertical size={16} aria-hidden="true" />}
                                  items={[
                                    { key: 'toggle', label: rate.active ? 'Desativar tarifa' : 'Reativar tarifa', onSelect: () => void handleToggleActive(rate) },
                                    // O banco só apaga tarifa que ainda não entrou em vigor (guard_used_tariff_delete, migration 091).
                                    inForce(rate.valid_from)
                                      ? { key: 'delete', label: 'Excluir tarifa (já em vigor: desative)', disabled: true }
                                      : { key: 'delete', label: 'Excluir tarifa', danger: true, disabled: deleteMutation.isPending && deleteMutation.variables?.id === rate.id, onSelect: () => void handleDelete(rate) },
                                  ]}
                                /> : null}
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </QueryStateGate>
        )}
      </div>

      <DemurrageRateModal
        open={editing != null}
        rate={editing?.rate ?? null}
        saving={saveMutation.isPending}
        error={saveError}
        onClose={() => setEditing(null)}
        onDraftChange={() => setSaveError(null)}
        onSubmit={(input) => void handleSave(input)}
      />
    </div>
  )
}
