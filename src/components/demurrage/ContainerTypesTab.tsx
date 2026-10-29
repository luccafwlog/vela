import { useState } from 'react'
import { MoreVertical, Pencil, Plus } from 'lucide-react'
import { ActionMenu } from '../ui/ActionMenu'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Card'
import { Field, Input, Select } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { NoValue } from '../ui/NoValue'
import { RowActionButton } from '../ui/RowActionButton'
import { StatusText } from '../ui/StatusText'
import { useConfirm, useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { QueryStateGate } from '../shared/QueryStateGate'
import { ShowInactiveToggle } from './ShowInactiveToggle'
import { useShowInactive } from '../../hooks/useShowInactive'
import {
  useContainerTypes,
  useDeleteContainerType,
  useSaveContainerType,
  useToggleContainerTypeActive,
} from '../../hooks/useDemurrageRates'
import { normalizeContainerTypeCode, type ContainerType, type DemurrageRateGroup } from '../../services/demurrage/containerTypes'
import { classifyDbError } from '../../lib/errors'

type Draft = { code: string; description: string; rate_group: string }

/**
 * Cadastro Tipos de container (ADR 0112, D29 a D34): o código como vem no B/L e
 * o grupo de tarifa que ele cobra. Qualquer setor inclui e edita; desativar,
 * reativar e excluir são do Administrativo, como nas tarifas.
 */
export function ContainerTypesTab({ groups, canEdit, canManage, initialCode }: {
  groups: DemurrageRateGroup[]
  canEdit: boolean
  canManage: boolean
  /** Código vindo de "Cadastrar tipo" (`?tipo=`): abre o cadastro já preenchido. */
  initialCode?: string | null
}) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  const typesQuery = useContainerTypes()
  const saveMutation = useSaveContainerType()
  const toggleMutation = useToggleContainerTypeActive()
  const deleteMutation = useDeleteContainerType()
  const [showInactive, setShowInactive] = useShowInactive()
  const initial = normalizeContainerTypeCode(initialCode)
  const [editing, setEditing] = useState<{ type: ContainerType | null; draft: Draft } | null>(
    () => (initial && canEdit ? { type: null, draft: { code: initial, description: '', rate_group: '' } } : null),
  )
  const [formError, setFormError] = useState<string | null>(null)

  const allTypes = typesQuery.data
  const inactiveCount = allTypes?.filter((type) => !type.active).length ?? 0
  const types = showInactive ? allTypes : allTypes?.filter((type) => type.active)
  const groupName = (code: string) => groups.find((group) => group.code === code)?.name ?? code

  function open(type: ContainerType | null) {
    setFormError(null)
    setEditing({ type, draft: type ? { code: type.code, description: type.description, rate_group: type.rate_group } : { code: '', description: '', rate_group: '' } })
  }

  function setDraft(patch: Partial<Draft>) {
    setFormError(null)
    setEditing((current) => current && { ...current, draft: { ...current.draft, ...patch } })
  }

  async function submit() {
    if (!editing) return
    const { type, draft } = editing
    const code = normalizeContainerTypeCode(draft.code)
    if (!/^[A-Z0-9]{2,8}$/.test(code)) {
      setFormError('Informe o código do tipo como vem no B/L, só letras e números (por exemplo, 45HC).')
      return
    }
    if (!draft.rate_group) {
      setFormError('Escolha o grupo de tarifa.')
      return
    }
    const changes = type
      ? [
          { field: 'Código', before: type.code, after: code },
          { field: 'Descrição', before: type.description, after: draft.description.trim() },
          { field: 'Grupo de tarifa', before: groupName(type.rate_group), after: groupName(draft.rate_group) },
        ].filter((change) => change.before !== change.after)
      : []
    if (type && changes.length === 0) {
      showToast('Nada mudou no tipo de container.', 'info')
      setEditing(null)
      return
    }
    const confirmed = await confirm({
      title: type ? 'Salvar tipo de container' : 'Cadastrar tipo de container',
      message: type ? `Salvar as alterações do tipo ${type.code}?` : `Cadastrar o tipo ${code}?`,
      confirmLabel: type ? 'Salvar alterações' : 'Cadastrar tipo',
      changes: type ? changes : undefined,
      affected: type ? undefined : { summary: `${code} · ${groupName(draft.rate_group)}` },
      consequence: 'Os containers deste tipo passam a cobrar Demurrage pela tarifa do grupo nos cálculos novos. Invoices já emitidas não mudam.',
      reversibility: 'O tipo pode ser editado no cadastro ou desativado pelo Administrativo.',
    })
    if (!confirmed) return
    saveMutation.mutate({ id: type?.id, code, description: draft.description, rate_group: draft.rate_group }, {
      onSuccess: () => {
        showToast(type ? 'Tipo de container atualizado.' : 'Tipo de container cadastrado.', 'success')
        setEditing(null)
      },
      onError: (error) => {
        const code23505 = (error as { code?: string }).code === '23505'
        setFormError(code23505 ? `O tipo ${code} já está cadastrado.` : classifyDbError(error).message)
      },
    })
  }

  async function toggle(type: ContainerType) {
    const nextActive = !type.active
    const options = {
      title: nextActive ? `Reativar tipo ${type.code}` : `Desativar tipo ${type.code}`,
      message: nextActive ? `Reativar o tipo de container ${type.code}?` : `Desativar o tipo de container ${type.code}?`,
      confirmLabel: nextActive ? 'Reativar' : 'Desativar',
      tone: nextActive ? ('primary' as const) : ('danger' as const),
      changes: [{ field: 'Situação', before: type.active ? 'Ativo' : 'Inativo', after: nextActive ? 'Ativo' : 'Inativo' }],
      consequence: nextActive
        ? 'Os containers deste tipo voltam a achar a tarifa do grupo.'
        : 'Os containers deste tipo ficam sem tarifa de Demurrage e não entram em atraso até o tipo voltar; Invoices já emitidas não mudam.',
      reversibility: nextActive ? 'Desative de novo se precisar.' : 'Reative o tipo quando precisar.',
    }
    const reason = nextActive ? await confirmWithReason(options) : (await confirm(options)) ? '' : null
    if (reason === null) return
    toggleMutation.mutate({ id: type.id, active: nextActive, reason }, {
      onSuccess: () => showToast(nextActive ? 'Tipo reativado.' : 'Tipo desativado.', 'success'),
      onError: (error) => showToast(`Falha ao alterar a situação: ${classifyDbError(error).message}`, 'error'),
    })
  }

  async function remove(type: ContainerType) {
    const reason = await confirmWithReason({
      title: `Excluir tipo ${type.code}`,
      message: `Excluir o tipo de container ${type.code}?`,
      consequence: 'O tipo sai do cadastro. Tipo já usado em B/L não se exclui: desative.',
      reversibility: 'Não é possível desfazer; cadastre de novo se precisar.',
      tone: 'danger',
      confirmLabel: 'Excluir tipo',
    })
    if (reason === null) return
    deleteMutation.mutate({ id: type.id, reason }, {
      onSuccess: () => showToast('Tipo excluído.', 'success'),
      onError: (error) => showToast(`Falha ao excluir o tipo: ${classifyDbError(error).message}`, 'error'),
    })
  }

  return (
    <>
      <div className="app-dem-toolbar mb-3">
        {inactiveCount > 0 ? <ShowInactiveToggle checked={showInactive} onChange={setShowInactive} label="Mostrar inativos" hiddenCount={inactiveCount} /> : null}
        {canEdit ? (
          <Button className="ml-auto" onClick={() => open(null)}>
            <Plus size={16} aria-hidden="true" />
            Novo tipo
          </Button>
        ) : null}
      </div>
      <QueryStateGate
        isLoading={typesQuery.isLoading}
        isError={Boolean(typesQuery.error)}
        hasData={types !== undefined}
        errorMessage="Não foi possível carregar os tipos de container."
        onRetry={() => void typesQuery.refetch()}
        loadingLabel="Carregando tipos…"
      >
        {!types?.length ? (
          <EmptyState title="Nenhum tipo de container" description="Sem o tipo no cadastro, o container do B/L fica sem tarifa de Demurrage." />
        ) : (
          <div className="app-surface app-dem-table-surface">
            <div className="app-table-scroll">
              <table className="app-table app-table--compact app-dem-table">
                <caption className="sr-only">Tipos de container e grupo de tarifa</caption>
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col" className="app-table__text-head">Descrição</th>
                    <th scope="col">Grupo de tarifa</th>
                    <th scope="col">Situação</th>
                    {canEdit ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {types.map((type) => (
                    <tr key={type.id} className={type.active ? undefined : 'app-table__row--muted'}>
                      <td className="app-dem-code app-dem-strong">{type.code}</td>
                      <td className="app-table__text">{type.description || <NoValue label="Sem descrição" />}</td>
                      <td>{groupName(type.rate_group)}</td>
                      <td>{type.active ? 'Ativo' : <StatusText tone="muted">Inativo</StatusText>}</td>
                      {canEdit ? (
                        <td className="app-dem-row-action">
                          <div className="app-dem-row-buttons">
                            <RowActionButton variant="ghost" label={`Editar tipo ${type.code}`} icon={Pencil} onClick={() => open(type)} />
                            {canManage ? (
                              <ActionMenu
                                label={`Mais ações do tipo ${type.code}`}
                                triggerClassName="app-btn app-btn--ghost app-btn--icon"
                                trigger={<MoreVertical size={15} aria-hidden="true" />}
                                items={[
                                  { key: 'toggle', label: type.active ? 'Desativar tipo' : 'Reativar tipo', onSelect: () => void toggle(type) },
                                  { key: 'delete', label: 'Excluir tipo', danger: true, onSelect: () => void remove(type) },
                                ]}
                              />
                            ) : null}
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

      <Modal open={editing != null} onClose={() => { if (!saveMutation.isPending) setEditing(null) }} title={editing?.type ? `Tipo ${editing.type.code}` : 'Novo tipo de container'} size="md">
        {editing ? (
          <form className="app-dem-form" noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
            <div className="app-dem-form__grid">
              <Field label="Código" required hint="Como vem no B/L, por exemplo 45HC.">
                <Input value={editing.draft.code} onChange={(event) => setDraft({ code: event.target.value.toUpperCase() })} className="app-dem-code" />
              </Field>
              <Field label="Grupo de tarifa" required>
                <Select value={editing.draft.rate_group} onChange={(event) => setDraft({ rate_group: event.target.value })}>
                  <option value="">Escolha o grupo</option>
                  {groups.map((group) => <option key={group.code} value={group.code}>{group.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Descrição">
              <Input value={editing.draft.description} onChange={(event) => setDraft({ description: event.target.value })} placeholder="45' high cube" />
            </Field>
            {formError ? <p className="app-dem-form__error" role="alert">{formError} O tipo não foi salvo.</p> : null}
            <div className="app-dem-form__actions">
              <Button type="button" variant="ghost" disabled={saveMutation.isPending} onClick={() => setEditing(null)}>Voltar</Button>
              <Button type="submit" loading={saveMutation.isPending} loadingLabel="Salvando…">{editing.type ? 'Salvar tipo' : 'Cadastrar tipo'}</Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  )
}
