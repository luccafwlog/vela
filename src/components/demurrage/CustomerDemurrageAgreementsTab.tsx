import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MoreVertical, Pencil, Plus, Users } from 'lucide-react'
import { ActionMenu } from '../ui/ActionMenu'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { RowActionButton } from '../ui/RowActionButton'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { EmptyState } from '../ui/Card'
import { Input } from '../ui/Input'
import { SummaryStrip } from '../ui/SummaryStrip'
import { QueryStateGate } from '../shared/QueryStateGate'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import { useConfirm, useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import {
  useCustomerDemurrageAgreements,
  useDeleteCustomerDemurrageAgreement,
  useToggleCustomerDemurrageAgreementActive,
} from '../../hooks/useCustomerDemurrageAgreements'
import { AGREEMENT_SITUATION_LABELS, agreementSituation, type AgreementSituation } from '../../services/demurrage/demurragePresentation'
import { classifyDbError } from '../../lib/errors'
import { saoPauloTodayIso } from '../../lib/dates'
import { formatCnpjCpf, formatDate, formatUSD } from '../../lib/utils'
import { CustomerDemurrageAgreementModal } from './CustomerDemurrageAgreementModal'
import { ShowInactiveToggle } from './ShowInactiveToggle'
import { useShowInactive } from '../../hooks/useShowInactive'
import { agreementPeriodText, agreementRatesText } from './demurrageFormRules'
import type { CustomerDemurrageAgreementListItem } from '../../types/customerDemurrageAgreements'

const SITUATION_TONES: Record<AgreementSituation, 'success' | 'info' | 'neutral'> = {
  vigente: 'success',
  futuro: 'info',
  encerrado: 'neutral',
  inativo: 'neutral',
}

const todayIso = () => saoPauloTodayIso()

/** Situação do acordo hoje; a escolha no cálculo é pela data de descarga. */
export function AgreementSituationBadge({ agreement }: { agreement: Pick<CustomerDemurrageAgreementListItem, 'active' | 'valid_from' | 'valid_to'> }) {
  const situation = agreementSituation(agreement, todayIso())
  return <Badge tone={SITUATION_TONES[situation]}>{AGREEMENT_SITUATION_LABELS[situation]}</Badge>
}

/** Situação em texto na tabela (regra 5): o que encerrou fica em cinza, e o acordo futuro diz quando começa. */
function AgreementSituationText({ agreement }: { agreement: CustomerDemurrageAgreementListItem }) {
  const situation = agreementSituation(agreement, todayIso())
  if (situation === 'futuro') return <>Começa em {formatDate(agreement.valid_from)}</>
  if (situation === 'vigente') return <>{AGREEMENT_SITUATION_LABELS.vigente}</>
  return <StatusText tone="muted">{AGREEMENT_SITUATION_LABELS[situation]}</StatusText>
}

/** Acordo que não vale mais (encerrado ou inativo): só aparece com "Mostrar inativos". */
function isClosedAgreement(agreement: CustomerDemurrageAgreementListItem, today: string) {
  const situation = agreementSituation(agreement, today)
  return situation === 'encerrado' || situation === 'inativo'
}

function rateText(value: number | null | undefined) {
  return value != null ? formatUSD(value) : 'tabela padrão'
}

function vigencia(agreement: CustomerDemurrageAgreementListItem) {
  return agreementPeriodText(agreement)
}

export function CustomerDemurrageAgreementsTab({ canEdit, canManage }: { canEdit: boolean; canManage: boolean }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  const narrow = useNarrowViewport()
  const [searchParams, setSearchParams] = useSearchParams()
  // `?cliente=` vem do "Ver em Tarifas" da ficha do Cliente.
  const search = searchParams.get('cliente') ?? ''
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedAgreement, setSelectedAgreement] = useState<CustomerDemurrageAgreementListItem | null>(null)

  const agreementsQuery = useCustomerDemurrageAgreements()
  const agreements = agreementsQuery.data
  const deleteMutation = useDeleteCustomerDemurrageAgreement()
  const toggleMutation = useToggleCustomerDemurrageAgreementActive()

  function setSearch(value: string) {
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      if (value.trim()) next.set('cliente', value)
      else next.delete('cliente')
      return next
    }, { replace: true })
  }

  const [showInactive, setShowInactive] = useShowInactive()
  const term = search.trim().toLowerCase()
  const digits = term.replace(/\D/g, '')
  const today = todayIso()
  const closedCount = (agreements ?? []).filter((agreement) => isClosedAgreement(agreement, today)).length
  const filtered = (agreements ?? []).filter((agreement) => {
    if (!showInactive && isClosedAgreement(agreement, today)) return false
    if (!term) return true
    const name = agreement.customer?.name?.toLowerCase() ?? ''
    const cnpj = (agreement.customer?.cnpj_cpf ?? '').replace(/\D/g, '')
    return name.includes(term) || (digits.length >= 3 && cnpj.includes(digits))
  })
  const vigentes = filtered.filter((agreement) => agreementSituation(agreement, today) === 'vigente').length

  function handleOpenNew() {
    setSelectedAgreement(null)
    setModalOpen(true)
  }

  function handleOpenEdit(agreement: CustomerDemurrageAgreementListItem) {
    setSelectedAgreement(agreement)
    setModalOpen(true)
  }

  async function handleDelete(agreement: CustomerDemurrageAgreementListItem) {
    const customerName = agreement.customer?.name ?? `Cliente #${agreement.customer_id}`
    const reason = await confirmWithReason({
      title: 'Excluir Acordo de Demurrage',
      message: `Excluir o acordo de Demurrage de ${customerName} (${vigencia(agreement)})?`,
      consequence: 'O acordo ainda não entrou em vigor: sai do cadastro antes de valer para qualquer descarga. Na vigência dele, valem a condição do B/L e, sem ela, a tabela padrão.',
      reversibility: 'Não é possível desfazer; cadastre o acordo de novo se precisar. Para parar de usar sem apagar, desative.',
      tone: 'danger',
      confirmLabel: 'Excluir',
    })
    if (reason === null) return

    deleteMutation.mutate(
      { id: agreement.id, reason, customerId: agreement.customer_id },
      {
        onSuccess: () => showToast('Acordo excluído.', 'success'),
        onError: (err) => showToast(`Falha ao excluir o acordo: ${classifyDbError(err).message}`, 'error'),
      },
    )
  }

  async function handleToggleActive(agreement: CustomerDemurrageAgreementListItem) {
    const nextActive = !agreement.active
    const customerName = agreement.customer?.name ?? `Cliente #${agreement.customer_id}`
    // B13: reativar pede motivo (ADR 0072), gravado pela RPC reactivate_catalog_row (migration 261).
    const confirmOptions = {
      title: `${nextActive ? 'Reativar' : 'Desativar'} acordo de Demurrage`,
      message: `${nextActive ? 'Reativar' : 'Desativar'} o acordo de Demurrage de ${customerName}?`,
      confirmLabel: nextActive ? 'Reativar acordo' : 'Desativar acordo',
      affected: {
        summary: `${customerName} · ${agreement.free_days} dias de Free Time · ${vigencia(agreement)}`,
      },
      changes: [{ field: 'Status', before: agreement.active ? 'Ativo' : 'Inativo', after: nextActive ? 'Ativo' : 'Inativo' }],
      consequence: nextActive
        ? 'Os cálculos passam a considerar este acordo quando a data de descarga estiver dentro da vigência.'
        : 'Os cálculos deixam de considerar este acordo e usam as regras padrão aplicáveis ao cliente.',
      reversibility: 'O status pode ser alternado novamente; invoices já emitidas mantêm seu ciclo financeiro e histórico.',
    }
    const reason = nextActive ? await confirmWithReason(confirmOptions) : (await confirm(confirmOptions)) ? '' : null
    if (reason === null) return
    toggleMutation.mutate(
      { id: agreement.id, active: nextActive, reason, customerId: agreement.customer_id },
      {
        onSuccess: () => showToast(nextActive ? 'Acordo reativado.' : 'Acordo desativado.', 'success'),
        onError: (err) => showToast(`Falha ao alterar o status: ${classifyDbError(err).message}`, 'error'),
      },
    )
  }

  function rowActions(item: CustomerDemurrageAgreementListItem) {
    if (!canEdit) return null
    return (
      <div className="app-dem-row-buttons">
        <RowActionButton variant="ghost" label={`Editar acordo de ${item.customer?.name ?? `Cliente #${item.customer_id}`}`} icon={Pencil} onClick={() => handleOpenEdit(item)} />
        {canManage ? <ActionMenu
          label={`Mais ações do acordo de ${item.customer?.name ?? `Cliente #${item.customer_id}`}`}
          triggerClassName="app-btn app-btn--ghost app-btn--icon"
          trigger={<MoreVertical size={15} aria-hidden="true" />}
          items={[
            { key: 'toggle', label: item.active ? 'Desativar acordo' : 'Reativar acordo', onSelect: () => void handleToggleActive(item) },
            // O banco só apaga acordo que ainda não entrou em vigor (guard_used_tariff_delete, migration 091).
            !item.valid_from || item.valid_from.slice(0, 10) <= todayIso()
              ? { key: 'delete', label: 'Excluir acordo (já em vigor: desative)', disabled: true }
              : { key: 'delete', label: 'Excluir acordo', danger: true, onSelect: () => void handleDelete(item) },
          ]}
        /> : null}
      </div>
    )
  }

  /** Na tabela, só o nome (o CNPJ fica na busca e no cartão do celular). */
  function customerLink(item: CustomerDemurrageAgreementListItem) {
    const name = item.customer?.name ?? `Cliente #${item.customer_id}`
    return item.customer?.cnpj_cpf
      ? <Link className="app-dem-link app-dem-strong" to={`/clientes/${encodeURIComponent(item.customer.cnpj_cpf)}?tab=financeiro`} title={name}>{name}</Link>
      : <span className="app-dem-strong" title={name}>{name}</span>
  }

  function customerCell(item: CustomerDemurrageAgreementListItem) {
    const name = item.customer?.name ?? `Cliente #${item.customer_id}`
    return (
      <div className="app-table__cell-stack">
        {item.customer?.cnpj_cpf ? (
          <Link className="app-dem-link app-dem-strong" to={`/clientes/${encodeURIComponent(item.customer.cnpj_cpf)}?tab=financeiro`}>{name}</Link>
        ) : <span className="app-dem-strong">{name}</span>}
        <span className="app-dem-meta tabular-nums">{item.customer?.cnpj_cpf ? <CopyValue value={formatCnpjCpf(item.customer.cnpj_cpf)} label="CNPJ/CPF" /> : <NoValue label="Sem CNPJ/CPF" />}</span>
      </div>
    )
  }

  return (
    <div className="app-dem-tab">
      <div className="app-dem-toolbar">
        <div className="app-dem-toolbar__search">
          <label className="sr-only" htmlFor="demurrage-agreement-search">Buscar acordo por Cliente ou CNPJ</label>
          <Input id="demurrage-agreement-search" type="search" placeholder="Cliente ou CNPJ" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {closedCount > 0 ? <ShowInactiveToggle checked={showInactive} onChange={setShowInactive} label="Mostrar encerrados e inativos" hiddenCount={closedCount} /> : null}
        {canEdit ? (
          <Button onClick={handleOpenNew}>
            <Plus size={16} aria-hidden="true" />
            Novo acordo
          </Button>
        ) : null}
      </div>

      <QueryStateGate
        isLoading={agreementsQuery.isLoading}
        isError={Boolean(agreementsQuery.error)}
        hasData={agreements !== undefined}
        errorMessage="Falha ao carregar os acordos de Demurrage."
        onRetry={() => void agreementsQuery.refetch?.()}
        loadingLabel="Carregando acordos…"
      >
        {filtered.length ? (
          <SummaryStrip
            label="Resumo dos acordos"
            items={[
              { label: filtered.length === 1 ? 'acordo' : 'acordos', value: String(filtered.length) },
              { label: vigentes === 1 ? 'vigente hoje' : 'vigentes hoje', value: String(vigentes) },
            ]}
          />
        ) : null}
        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
 title={term ? 'Nenhum acordo nesta busca' : closedCount > 0 && !showInactive ? 'Nenhum acordo vigente' : 'Nenhum acordo de Demurrage'}
            description={term ? `Nada encontrado para "${search.trim()}".` : closedCount > 0 && !showInactive ? 'Os acordos cadastrados estão encerrados ou inativos. Marque Mostrar encerrados e inativos para vê-los.' : 'Cadastre free time e diárias negociados por Cliente; sem acordo, vale a tabela padrão.'}
            action={term ? <Button variant="secondary" onClick={() => setSearch('')}>Limpar busca</Button> : canEdit ? <Button variant="secondary" onClick={handleOpenNew}><Plus size={16} aria-hidden="true" />Cadastrar primeiro acordo</Button> : undefined}
          />
        ) : narrow ? (
          <div className="app-dem-cards">
            {filtered.map((item) => (
              <article key={item.id} className="app-dem-card" aria-label={`Acordo de ${item.customer?.name ?? `Cliente #${item.customer_id}`}`}>
                <div className="app-dem-card__head">{customerCell(item)}<AgreementSituationBadge agreement={item} /></div>
                <p><span className="app-dem-strong">{item.free_days} dias</span> de free time · {agreementRatesText(item)}</p>
                <p className="app-dem-meta">Vigência {vigencia(item)}{item.notes ? ` · ${item.notes}` : ''}</p>
                {rowActions(item)}
              </article>
            ))}
          </div>
        ) : (
          <div className="app-surface app-dem-table-surface">
            <div className="app-table-scroll">
              <table className="app-table app-table--compact app-dem-table">
                <caption className="sr-only">Acordos de Demurrage por Cliente</caption>
                <thead>
                  <tr>
                    <th scope="col" className="app-table__text-head">Cliente</th>
                    <th scope="col">Free time</th>
                    <th scope="col">Diária 1º</th>
                    <th scope="col">Diária 2º</th>
                    <th scope="col">Vigência</th>
                    <th scope="col">Situação</th>
                    <th scope="col" className="app-table__text-head">Observações</th>
                    {canEdit ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id} className={isClosedAgreement(item, today) ? 'app-table__row--muted' : undefined}>
                      <td className="app-table__text">{customerLink(item)}</td>
                      <td className="tabular-nums">{item.free_days} dias</td>
                      <td className="tabular-nums">{rateText(item.p1_usd)}</td>
                      <td className="tabular-nums">{rateText(item.p2_usd)}</td>
                      <td className="tabular-nums">{vigencia(item)}</td>
                      <td><AgreementSituationText agreement={item} /></td>
                      <td className="app-dem-notes app-table__text app-table__text--wrap">{item.notes ?? <NoValue label="Sem observações" />}</td>
                      {canEdit ? <td className="app-dem-row-action">{rowActions(item)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </QueryStateGate>

      {modalOpen ? (
        <CustomerDemurrageAgreementModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          initialAgreement={selectedAgreement}
        />
      ) : null}
    </div>
  )
}
