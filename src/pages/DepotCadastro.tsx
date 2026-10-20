import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreVertical, Pencil, Plus } from 'lucide-react'
import { ActionMenu, type ActionMenuItem } from '../components/ui/ActionMenu'
import { Block, Fact, FactList, LeadValue } from '../components/ui/Block'
import { Button } from '../components/ui/Button'
import { EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { useConfirm, useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { NoValue } from '../components/ui/NoValue'
import { RowActionButton } from '../components/ui/RowActionButton'
import { SkeletonTable } from '../components/ui/Skeleton'
import { StatusText } from '../components/ui/StatusText'
import { Switch } from '../components/ui/Switch'
import { useToast } from '../components/ui/Toast'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { reactivateCatalogRow } from '../services/deleteRecords'
import { afterDepotAlterado } from '../services/cacheEffects'
import { useAuth } from '../hooks/useAuth'
import { useDepots } from '../hooks/useDepots'
import { deleteDepot, deleteDepotService, listBrazilianPorts, listDepotServices, preflightDepotsTerminalPortMapping, upsertDepot, upsertDepotService, type DepotService, type DepotWithPort, type ServiceNature } from '../services/depots'
import { classifyDbError } from '../lib/errors'
import { formatBRL } from '../lib/utils'
import { condicaoLabel, diasLabel, naturezaServicoLabel, tipoLocalLabel } from '../lib/vaziosLabels'

type DepotForm = {
  code: string
  name: string
  tipo: 'depot' | 'terminal_portuario'
  port_id: number | null
  free_time_vazio_days: number
  free_time_material_days: number
  active: boolean
}

const emptyDepotForm: DepotForm = {
  code: '',
  name: '',
  tipo: 'depot',
  port_id: null,
  free_time_vazio_days: 0,
  free_time_material_days: 0,
  active: true,
}

const emptyServiceForm = {
  id: undefined as string | undefined,
  name: '',
  natureza: 'geral' as ServiceNature,
  container_type: '',
  route_destino_id: '',
  condition: '',
  rate_brl: 0,
  active: true,
}

const portIdOf = (depot: DepotWithPort) => (typeof depot.port_id === 'number' ? depot.port_id : null)

function depotFormOf(depot: DepotWithPort): DepotForm {
  return {
    code: depot.code,
    name: depot.name ?? '',
    tipo: depot.tipo as DepotForm['tipo'],
    port_id: portIdOf(depot),
    free_time_vazio_days: depot.free_time_vazio_days,
    free_time_material_days: depot.free_time_material_days,
    active: depot.active,
  }
}

export function DepotCadastro() {
  const { profile, user, isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const canEdit = Boolean(profile || user)
  // Excluir, desativar e reativar são do Administrativo no banco (ADR 0073,
  // item 8; migration 263); os demais editam, mas não veem essas ações.
  const canManage = isAdmin
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const depots = useDepots()
  // O Embarque de vazios abre a tela já no local da armazenagem a lançar.
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('local'))
  const [showInactive, setShowInactive] = useState(false)
  const [depotModal, setDepotModal] = useState<'new' | 'edit' | null>(null)
  const [depotForm, setDepotForm] = useState(emptyDepotForm)
  const [serviceModalOpen, setServiceModalOpen] = useState(false)
  const [serviceForm, setServiceForm] = useState(emptyServiceForm)
  const [saving, setSaving] = useState(false)

  const ports = useQuery({
    queryKey: ['ports', 'brazilian'],
    queryFn: listBrazilianPorts,
    staleTime: 300_000,
  })

  const legacyMapping = useQuery({
    queryKey: ['depots', 'terminal-port-preflight'],
    queryFn: preflightDepotsTerminalPortMapping,
    staleTime: 300_000,
  })

  const allDepots = depots.data ?? []
  const inactiveDepotCount = allDepots.filter((depot) => !depot.active).length
  const listedDepots = allDepots.filter((depot) => showInactive || depot.active || depot.id === selectedId)
  const selected = allDepots.find((item) => item.id === selectedId) ?? listedDepots[0] ?? null
  // Endereço com local que não existe (excluído ou link antigo): avisa em vez
  // de abrir outro local como se fosse o pedido.
  const missingLocal = Boolean(selectedId) && depots.data !== undefined && !allDepots.some((item) => item.id === selectedId)

  /** Escolhe o local e mantém `?local=` no endereço (sem nova entrada no histórico). */
  function selectDepot(id: string | null) {
    setSelectedId(id)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (id) next.set('local', id)
      else next.delete('local')
      return next
    }, { replace: true })
  }

  const services = useQuery({
    queryKey: ['depot-services', selected?.id],
    queryFn: () => listDepotServices(selected!.id),
    enabled: Boolean(selected),
  })
  const allServices = services.data ?? []
  const activeServiceCount = allServices.filter((service) => service.active).length
  const listedServices = allServices.filter((service) => showInactive || service.active)

  async function run(action: () => Promise<void>, success: string) {
    setSaving(true)
    try {
      await action()
      showToast(success, 'success')
      return true
    } catch (error) {
      showToast(classifyDbError(error).message, 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function refresh() {
    // L7: o cadastro muda o Portal, os serviços oferecidos e a armazenagem do Embarque.
    await afterDepotAlterado(queryClient)
  }

  const portLabel = (portId: number | null | undefined) => {
    const port = (ports.data ?? []).find((item) => item.id === portId)
    return port ? `${port.locode}${port.name ? ` · ${port.name}` : ''}` : portId ? String(portId) : ''
  }
  const depotName = (id: string | null | undefined) => {
    const depot = allDepots.find((item) => item.id === id)
    return depot ? depot.name || depot.code : ''
  }

  function startNew() {
    setDepotForm(emptyDepotForm)
    setDepotModal('new')
  }

  function startEdit() {
    if (!selected) return
    setDepotForm(depotFormOf(selected))
    setDepotModal('edit')
  }

  async function confirmSave(kind: 'local' | 'serviço', name: string, changes: Array<{ field: string; before: string; after: string }> | null) {
    if (changes && changes.length === 0) {
      showToast('Nenhuma alteração para salvar.', 'info')
      return false
    }
    // B31 (ADR 0072): Salvar mostra cada campo com o valor anterior e o novo; cadastrar mostra o resumo.
    return confirm({
      title: changes ? `Salvar ${kind}` : `Cadastrar ${kind}`,
      message: changes ? `Salvar as alterações ${kind === 'local' ? 'do local' : 'do serviço'} ${name}?` : `Cadastrar ${kind === 'local' ? 'o local' : 'o serviço'} ${name}?`,
      confirmLabel: changes ? 'Salvar alterações' : 'Cadastrar',
      changes: changes ?? undefined,
      consequence: kind === 'local'
        ? 'Vale para os próximos lançamentos de vazios; free time e tipo mudam a armazenagem calculada de agora em diante.'
        : 'O valor sugerido vale para as próximas linhas de serviço; linhas já lançadas não mudam.',
      reversibility: 'Pode ser editado de novo no cadastro.',
    })
  }

  async function saveDepot() {
    const original = depotModal === 'edit' ? selected : null
    const changes = original ? [
      { field: 'Código', before: original.code, after: depotForm.code },
      { field: 'Nome', before: original.name ?? '', after: depotForm.name },
      { field: 'Tipo', before: tipoLocalLabel(original.tipo), after: tipoLocalLabel(depotForm.tipo) },
      { field: 'Porto', before: portLabel(portIdOf(original)), after: portLabel(depotForm.port_id) },
      { field: 'Free time vazio (dias)', before: String(original.free_time_vazio_days), after: String(depotForm.free_time_vazio_days) },
      { field: 'Free time com material (dias)', before: String(original.free_time_material_days), after: String(depotForm.free_time_material_days) },
    ].filter((change) => change.before !== change.after) : null
    if (!(await confirmSave('local', depotForm.code, changes))) return
    await run(async () => {
      // B15: `active` vem do registro salvo, não do formulário.
      const saved = await upsertDepot({ ...depotForm, active: original?.active ?? true, id: original?.id })
      await refresh()
      setDepotModal(null)
      // L7: depois de cadastrar, a tela abre o local criado.
      selectDepot(saved.id)
    }, original ? 'Local salvo.' : 'Local cadastrado.')
  }

  async function removeDepot() {
    if (!selected) return
    const reason = await confirmWithReason({ title: 'Excluir local', message: `Excluir o local ${selected.code}?`, consequence: 'O local e os serviços dele saem do cadastro. O banco recusa se o local estiver em uso por B/L, escala, ADR ou vazios.', reversibility: 'Não é possível desfazer; cadastre de novo se precisar.', tone: 'danger', confirmLabel: 'Excluir' })
    if (reason === null) return
    await run(async () => {
      await deleteDepot(selected.id, reason)
      selectDepot(null)
      await refresh()
    }, 'Local excluído.')
  }

  function startService(service?: DepotService) {
    setServiceForm(service
      ? {
          id: service.id,
          name: service.name,
          natureza: service.natureza as ServiceNature,
          container_type: service.container_type ?? '',
          route_destino_id: service.route_destino_id ?? '',
          condition: service.condition ?? '',
          rate_brl: Number(service.rate_brl),
          active: service.active,
        }
      : emptyServiceForm)
    setServiceModalOpen(true)
  }

  async function saveService() {
    if (!selected) return
    const original = serviceForm.id ? allServices.find((item) => item.id === serviceForm.id) ?? null : null
    const changes = original ? [
      { field: 'Serviço', before: original.name, after: serviceForm.name },
      { field: 'Natureza', before: naturezaServicoLabel(original.natureza), after: naturezaServicoLabel(serviceForm.natureza) },
      { field: 'Condição', before: condicaoLabel(original.condition), after: serviceForm.natureza === 'armazenagem' ? condicaoLabel(serviceForm.condition || null) : '' },
      { field: 'Destino da rota', before: depotName(original.route_destino_id), after: serviceForm.natureza === 'transporte' ? depotName(serviceForm.route_destino_id || null) : '' },
      { field: 'Valor sugerido (R$)', before: String(Number(original.rate_brl)), after: String(Number(serviceForm.rate_brl)) },
    ].filter((change) => change.before !== change.after) : null
    if (!(await confirmSave('serviço', serviceForm.name, changes))) return
    await run(async () => {
      await upsertDepotService({
        ...serviceForm,
        // B31: `active` vem do registro atual, não do momento em que se clicou Editar.
        active: original?.active ?? serviceForm.active,
        depot_id: selected.id,
        container_type: null,
        route_destino_id: serviceForm.natureza === 'transporte' ? serviceForm.route_destino_id || null : null,
        condition: serviceForm.natureza === 'armazenagem' ? serviceForm.condition || null : null,
      })
      setServiceModalOpen(false)
      setServiceForm(emptyServiceForm)
      await refresh()
    }, 'Serviço salvo.')
  }

  // B15 (ADR 0073, item 8): desativar com diálogo; reativar com motivo, pela
  // RPC reactivate_catalog_row (migrations 261 e 263). Só o Administrativo.
  async function askToggle(kind: 'local' | 'serviço', name: string, active: boolean): Promise<string | null> {
    const options = {
      title: `${active ? 'Desativar' : 'Reativar'} ${kind}`,
      message: `${active ? 'Desativar' : 'Reativar'} ${kind === 'local' ? 'o local' : 'o serviço'} ${name}?`,
      confirmLabel: active ? 'Desativar' : 'Reativar',
      tone: active ? ('danger' as const) : ('primary' as const),
      consequence: active
        ? 'Deixa de aparecer para novos lançamentos de vazios, e o banco recusa lançamento novo com ele; o que já foi lançado não muda.'
        : 'Volta a aparecer para novos lançamentos de vazios.',
      reversibility: active ? 'O Administrativo pode reativar, com motivo.' : 'O Administrativo pode desativar de novo.',
    }
    if (!active) return confirmWithReason(options)
    return (await confirm(options)) ? '' : null
  }

  async function toggleDepot() {
    if (!selected) return
    const reason = await askToggle('local', selected.code, selected.active)
    if (reason === null) return
    await run(async () => {
      // B15: desativa a partir do registro salvo.
      if (selected.active) await upsertDepot({ ...depotFormOf(selected), active: false, id: selected.id })
      else await reactivateCatalogRow('depots', selected.id, reason)
      await refresh()
    }, selected.active ? 'Local desativado.' : 'Local reativado.')
  }

  async function toggleService(service: DepotService) {
    const reason = await askToggle('serviço', service.name, service.active)
    if (reason === null) return
    await run(async () => {
      if (service.active) await upsertDepotService({ ...service, active: false })
      else await reactivateCatalogRow('depot_services', service.id, reason)
      await refresh()
    }, service.active ? 'Serviço desativado.' : 'Serviço reativado.')
  }

  async function removeService(service: DepotService) {
    const reason = await confirmWithReason({ title: 'Excluir serviço', message: `Excluir o serviço ${service.name}?`, consequence: 'O serviço sai do catálogo do local. O banco recusa se ele já foi lançado em Embarque de vazios.', reversibility: 'Não é possível desfazer; cadastre de novo se precisar.', tone: 'danger', confirmLabel: 'Excluir' })
    if (reason === null) return
    await run(async () => {
      await deleteDepotService(service.id, reason)
      await refresh()
    }, 'Serviço excluído.')
  }

  const isDepot = depotForm.tipo === 'depot'
  const canSaveDepot = Boolean(canEdit && depotForm.code.trim() && (isDepot || depotForm.port_id !== null))
  const depotMenu: ActionMenuItem[] = selected && canManage
    ? [
        { key: 'toggle', label: selected.active ? 'Desativar local' : 'Reativar local', onSelect: () => void toggleDepot() },
        { key: 'delete', label: 'Excluir local', danger: true, onSelect: () => void removeDepot() },
      ]
    : []

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Locais (depots e terminais)"
        description="Locais, free times e valores sugeridos para as linhas do Embarque de vazios."
        action={
          <div className="flex flex-wrap gap-2">
            <Link className="app-btn app-btn--secondary" to="/embarquevazios">Voltar ao Embarque</Link>
            {canEdit ? <Button onClick={startNew}><Plus size={16} aria-hidden="true" /> Novo local</Button> : null}
          </div>
        }
      />
      {missingLocal ? (
        <InlineError message={`O local deste endereço não existe mais (excluído ou link antigo). ${selected ? `Mostrando ${selected.code}; escolha` : 'Escolha'} o local na lista.`} />
      ) : null}
      {legacyMapping.data?.pending_count ? (
        <InlineError
          message={`Há ${legacyMapping.data.pending_count === 1 ? '1 terminal antigo' : `${legacyMapping.data.pending_count} terminais antigos`} sem porto brasileiro: ${legacyMapping.data.codes.join(', ')}. Escolha o porto de cada um em Editar.`}
        />
      ) : null}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Block
          title="Locais"
          aside={depots.data ? `${allDepots.length - inactiveDepotCount} ${allDepots.length - inactiveDepotCount === 1 ? 'ativo' : 'ativos'}` : null}
          className="self-start"
        >
          <QueryStateGate
            isLoading={depots.isLoading}
            isError={Boolean(depots.error)}
            hasData={depots.data !== undefined}
            errorMessage="Não foi possível carregar os locais."
            onRetry={() => void depots.refetch()}
          >
            {allDepots.length === 0 ? (
              <p className="text-sm text-[var(--app-muted)]">Nenhum local cadastrado. Cadastre o primeiro em Novo local.</p>
            ) : (
              <div className="grid gap-3">
                <ul className="grid gap-1" aria-label="Locais cadastrados">
                  {listedDepots.map((depot) => {
                    const current = depot.id === selected?.id
                    return (
                      <li key={depot.id}>
                        <button
                          type="button"
                          aria-current={current ? 'true' : undefined}
                          onClick={() => selectDepot(depot.id)}
                          className={`grid w-full gap-0.5 rounded-md border px-3 py-2 text-left text-sm ${current ? 'border-[var(--app-navy)] bg-[var(--app-strip)]' : 'border-transparent'} ${depot.active ? '' : 'text-[var(--app-muted)]'}`}
                        >
                          <span className="font-semibold">{depot.code}</span>
                          <span className="text-xs text-[var(--app-muted)]">
                            {tipoLocalLabel(depot.tipo)}{depot.name && depot.name !== depot.code ? ` · ${depot.name}` : ''}{depot.active ? '' : ' · inativo'}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {inactiveDepotCount > 0 ? (
                  <Switch checked={showInactive} onChange={setShowInactive}>
                    {`Mostrar os inativos (${inactiveDepotCount})`}
                  </Switch>
                ) : null}
              </div>
            )}
          </QueryStateGate>
        </Block>

        <div className="grid min-w-0 content-start gap-5">
          {selected ? (
            <>
              <Block
                title="Cadastro"
                aside={canEdit ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" onClick={startEdit}><Pencil size={16} aria-hidden="true" /> Editar</Button>
                    {depotMenu.length ? (
                      <ActionMenu
                        label={`Mais ações do local ${selected.code}`}
                        triggerClassName="app-btn app-btn--ghost app-btn--icon"
                        trigger={<MoreVertical size={16} aria-hidden="true" />}
                        items={depotMenu}
                      />
                    ) : null}
                  </div>
                ) : null}
              >
                <div className="grid gap-4">
                  <LeadValue
                    tone={selected.active ? 'default' : 'muted'}
                    detail={`${tipoLocalLabel(selected.tipo)} · ${selected.active ? 'ativo' : 'inativo: não aparece em lançamento novo'}`}
                  >
                    {selected.name || selected.code}
                  </LeadValue>
                  <FactList columns={4}>
                    <Fact label="Código">{selected.code}</Fact>
                    {selected.tipo === 'terminal_portuario' ? (
                      <Fact label="Porto">{portIdOf(selected) ? portLabel(portIdOf(selected)) : <StatusText tone="warning">Sem porto</StatusText>}</Fact>
                    ) : (
                      <>
                        <Fact label="Free time vazio">{diasLabel(selected.free_time_vazio_days)}</Fact>
                        <Fact label="Free time com material">{diasLabel(selected.free_time_material_days)}</Fact>
                      </>
                    )}
                    <Fact label="Serviços ativos">{services.data ? activeServiceCount.toLocaleString('pt-BR') : <NoValue label="Carregando" />}</Fact>
                  </FactList>
                </div>
              </Block>

              <Block
                title="Serviços do catálogo"
                flush
                aside={
                  <div className="flex flex-wrap items-center gap-2">
                    <span>valores sugeridos nas linhas do Embarque</span>
                    {canEdit ? <Button onClick={() => startService()}><Plus size={16} aria-hidden="true" /> Adicionar serviço</Button> : null}
                  </div>
                }
              >
                <QueryStateGate
                  isLoading={services.isLoading}
                  isError={Boolean(services.error)}
                  hasData={services.data !== undefined}
                  errorMessage="Não foi possível carregar os serviços do local."
                  onRetry={() => void services.refetch()}
                  loadingFallback={<SkeletonTable rows={4} cols={6} label="Carregando serviços" />}
                >
                  {listedServices.length === 0 ? (
                    <EmptyState
                      title={allServices.length ? 'Nenhum serviço ativo' : 'Nenhum serviço cadastrado'}
                      description={allServices.length ? 'Os serviços deste local estão inativos. Ligue Mostrar os inativos para vê-los.' : 'Cadastre os serviços do local em Adicionar serviço; o valor é sugerido nas linhas do Embarque.'}
                    />
                  ) : (
                    <div className="app-table-scroll">
                      <table className="app-table app-table--compact">
                        <caption className="sr-only">{`Serviços do catálogo de ${selected.code}`}</caption>
                        <thead>
                          <tr>
                            <th scope="col" className="app-table__text-head">Serviço</th>
                            <th scope="col">Natureza</th>
                            <th scope="col">Condição</th>
                            <th scope="col" className="app-table__text-head">Destino</th>
                            <th scope="col">Valor</th>
                            {canEdit ? <th scope="col">Ações</th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {listedServices.map((service) => (
                            <tr key={service.id} className={service.active ? undefined : 'app-table__row--muted'}>
                              <td className="app-table__text" title={service.name}>{service.name}{service.active ? '' : ' (inativo)'}</td>
                              <td>{naturezaServicoLabel(service.natureza)}</td>
                              <td>{service.condition ? condicaoLabel(service.condition) : <NoValue label="Sem condição" />}</td>
                              <td className="app-table__text">{service.route_destino_id ? depotName(service.route_destino_id) || <NoValue label="Destino removido" /> : <NoValue label="Sem destino" />}</td>
                              <td className="tabular-nums">{formatBRL(Number(service.rate_brl))}</td>
                              {canEdit ? (
                                <td>
                                  <div className="flex justify-center gap-1">
                                    <RowActionButton icon={Pencil} label={`Editar serviço ${service.name}`} onClick={() => startService(service)} />
                                    {canManage ? (
                                      <ActionMenu
                                        label={`Mais ações do serviço ${service.name}`}
                                        triggerClassName="app-btn app-btn--ghost app-btn--icon"
                                        trigger={<MoreVertical size={15} aria-hidden="true" />}
                                        items={[
                                          { key: 'toggle', label: service.active ? 'Desativar serviço' : 'Reativar serviço', onSelect: () => void toggleService(service) },
                                          { key: 'delete', label: 'Excluir serviço', danger: true, onSelect: () => void removeService(service) },
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
                  )}
                </QueryStateGate>
              </Block>
            </>
          ) : depots.data ? (
            <Block title="Cadastro">
              <p className="text-sm text-[var(--app-muted)]">Escolha um local na lista ou cadastre um em Novo local.</p>
            </Block>
          ) : null}
        </div>
      </div>

      <Modal open={depotModal !== null} onClose={() => setDepotModal(null)} title={depotModal === 'new' ? 'Novo local' : 'Editar local'} size="md">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Código" required>
              <Input value={depotForm.code} onChange={(e) => setDepotForm((f) => ({ ...f, code: e.target.value }))} />
            </Field>
            <Field label="Nome">
              <Input value={depotForm.name} onChange={(e) => setDepotForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Tipo" required>
              <Select
                value={depotForm.tipo}
                onChange={(e) =>
                  setDepotForm((f) => ({
                    ...f,
                    tipo: e.target.value as DepotForm['tipo'],
                    port_id: e.target.value === 'depot' ? null : f.port_id,
                    free_time_vazio_days: e.target.value === 'depot' ? f.free_time_vazio_days : 0,
                    free_time_material_days: e.target.value === 'depot' ? f.free_time_material_days : 0,
                  }))
                }
              >
                <option value="depot">Depot</option>
                <option value="terminal_portuario">Terminal portuário</option>
              </Select>
            </Field>
            {!isDepot ? (
              <Field label="Porto brasileiro" required hint="Terminal portuário não tem free time nem armazenagem.">
                <Select
                  value={depotForm.port_id === null ? '' : String(depotForm.port_id)}
                  onChange={(e) => setDepotForm((f) => ({ ...f, port_id: e.target.value ? Number(e.target.value) : null }))}
                >
                  <option value="">Selecione</option>
                  {(ports.data ?? []).map((port) => (
                    <option key={port.id} value={port.id}>
                      {port.locode} · {port.name ?? 'Sem nome'}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <>
                <Field label="Free time vazio (dias)">
                  <Input type="number" min={0} value={depotForm.free_time_vazio_days} onChange={(e) => setDepotForm((f) => ({ ...f, free_time_vazio_days: Number(e.target.value) }))} />
                </Field>
                <Field label="Free time com material (dias)">
                  <Input type="number" min={0} value={depotForm.free_time_material_days} onChange={(e) => setDepotForm((f) => ({ ...f, free_time_material_days: Number(e.target.value) }))} />
                </Field>
              </>
            )}
          </div>
          <div className="app-modal__actions">
            <Button variant="secondary" onClick={() => setDepotModal(null)}>Voltar</Button>
            <Button loading={saving} onClick={() => void saveDepot()} disabled={!canSaveDepot}>
              {depotModal === 'new' ? 'Cadastrar local' : 'Salvar local'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={serviceModalOpen} onClose={() => setServiceModalOpen(false)} title={serviceForm.id ? 'Editar serviço' : 'Adicionar serviço'} size="md">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Serviço" required>
              <Input value={serviceForm.name} onChange={(e) => setServiceForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Natureza" required>
              <Select
                value={serviceForm.natureza}
                onChange={(e) =>
                  setServiceForm((f) => ({ ...f, natureza: e.target.value as ServiceNature, container_type: '', route_destino_id: '', condition: '' }))
                }
              >
                <option value="armazenagem">Armazenagem</option>
                <option value="transporte">Transporte</option>
                <option value="geral">Geral</option>
              </Select>
            </Field>
            {serviceForm.natureza === 'armazenagem' ? (
              <Field label="Condição" hint="Sem condição, o serviço vale para Vazio e Com material.">
                <Select value={serviceForm.condition} onChange={(e) => setServiceForm((f) => ({ ...f, condition: e.target.value }))}>
                  <option value="">As duas</option>
                  <option value="vazio">Vazio</option>
                  <option value="material">Com material</option>
                </Select>
              </Field>
            ) : null}
            {serviceForm.natureza === 'transporte' && selected ? (
              <Field label="Destino da rota" required>
                <Select value={serviceForm.route_destino_id} onChange={(e) => setServiceForm((f) => ({ ...f, route_destino_id: e.target.value }))}>
                  <option value="">Selecione</option>
                  {allDepots.filter((depot) => depot.id !== selected.id && (depot.active || depot.id === serviceForm.route_destino_id)).map((depot) => (
                    <option key={depot.id} value={depot.id}>
                      {depot.code} · {depot.name || tipoLocalLabel(depot.tipo)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Valor sugerido (R$)">
              <Input type="number" min={0} step="0.01" value={serviceForm.rate_brl} onChange={(e) => setServiceForm((f) => ({ ...f, rate_brl: Number(e.target.value) }))} />
            </Field>
          </div>
          <div className="app-modal__actions">
            <Button variant="secondary" onClick={() => setServiceModalOpen(false)}>Voltar</Button>
            <Button loading={saving} onClick={() => void saveService()} disabled={!canEdit || !serviceForm.name.trim()}>
              {serviceForm.id ? 'Salvar serviço' : 'Adicionar serviço'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
