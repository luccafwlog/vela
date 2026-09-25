import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Edit3, Plus, Power, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { Field, Input, Select } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useDepots } from '../hooks/useDepots'
import { deleteDepot, deleteDepotService, listBrazilianPorts, listDepotServices, preflightDepotsTerminalPortMapping, upsertDepot, upsertDepotService, type DepotService, type ServiceNature } from '../services/depots'
import { formatBRL } from '../lib/utils'

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

function conditionLabel(condition: string) {
  return condition === 'vazio' ? 'EMPTY' : condition === 'material' ? 'EMPTY W/ MATERIAL' : condition
}

export function DepotCadastro() {
  const { profile, user, isAdmin } = useAuth()
  const canEdit = Boolean(profile || user)
  // Excluir e do Administrativo no banco; os demais editam, mas nao veem Excluir.
  const canDelete = isAdmin
  const confirm = useConfirm()
  const { showToast } = useToast()
  const depots = useDepots()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newDepot, setNewDepot] = useState(false)

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

  const selected = newDepot ? null : depots.data?.find((item) => item.id === selectedId) ?? depots.data?.[0] ?? null
  const [depotForm, setDepotForm] = useState(emptyDepotForm)
  const [serviceForm, setServiceForm] = useState(emptyServiceForm)

  const services = useQuery({
    queryKey: ['depot-services', selected?.id],
    queryFn: () => listDepotServices(selected!.id),
    enabled: Boolean(selected),
  })

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!newDepot && selected) {
      setDepotForm({
        code: selected.code,
        name: selected.name ?? '',
        tipo: selected.tipo as 'depot' | 'terminal_portuario',
        port_id: 'port_id' in selected && typeof selected.port_id === 'number' ? selected.port_id : null,
        free_time_vazio_days: selected.free_time_vazio_days,
        free_time_material_days: selected.free_time_material_days,
        active: selected.active,
      })
      setServiceForm(emptyServiceForm)
    }
  }, [newDepot, selected])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function run(action: () => Promise<void>, success: string) {
    try {
      await action()
      showToast(success, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao salvar.', 'error')
    }
  }

  function startNew() {
    setNewDepot(true)
    setSelectedId(null)
    setDepotForm(emptyDepotForm)
    setServiceForm(emptyServiceForm)
  }

  async function saveDepot() {
    await run(async () => {
      await upsertDepot({ ...depotForm, id: newDepot ? undefined : selected?.id })
      await depots.refetch()
      setNewDepot(false)
    }, 'Local salvo.')
  }

  async function removeDepot() {
    if (!selected || !(await confirm({ message: `Excluir o local ${selected.code}?`, tone: 'danger', confirmLabel: 'Excluir' }))) return
    await run(async () => {
      await deleteDepot(selected.id)
      setSelectedId(null)
      await depots.refetch()
    }, 'Local excluído.')
  }

  async function saveService() {
    if (!selected) return
    await run(async () => {
      await upsertDepotService({
        ...serviceForm,
        depot_id: selected.id,
        container_type: null,
        route_destino_id: serviceForm.natureza === 'transporte' ? serviceForm.route_destino_id || null : null,
        condition: serviceForm.natureza === 'armazenagem' ? serviceForm.condition || null : null,
      })
      setServiceForm(emptyServiceForm)
      await services.refetch()
    }, 'Serviço salvo.')
  }

  async function toggleService(service: DepotService) {
    await run(async () => {
      await upsertDepotService({ ...service, active: !service.active })
      await services.refetch()
    }, service.active ? 'Serviço inativado.' : 'Serviço ativado.')
  }

  async function removeService(service: DepotService) {
    if (!(await confirm({ message: `Excluir o serviço ${service.name}?`, tone: 'danger', confirmLabel: 'Excluir' }))) return
    await run(async () => {
      await deleteDepotService(service.id)
      await services.refetch()
    }, 'Serviço excluído.')
  }

  function editService(service: DepotService) {
    setServiceForm({
      id: service.id,
      name: service.name,
      natureza: service.natureza as ServiceNature,
      container_type: service.container_type ?? '',
      route_destino_id: service.route_destino_id ?? '',
      condition: service.condition ?? '',
      rate_brl: Number(service.rate_brl),
      active: service.active,
    })
  }

  const isDepot = depotForm.tipo === 'depot'
  const canSaveDepot = Boolean(canEdit && depotForm.code.trim() && (isDepot || depotForm.port_id !== null))

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Cadastro de Terminais"
        description="Locais, free times e valores sugeridos para as linhas do Embarque de Vazios."
        action={canEdit ? <Button onClick={startNew}><Plus size={16} /> Novo local</Button> : null}
      />
      {depots.error ? <InlineError message="Erro ao carregar locais." /> : null}
      {legacyMapping.data?.pending_count ? (
        <InlineError
          message={`Há ${legacyMapping.data.pending_count} terminal(is) legado(s) sem porto brasileiro: ${legacyMapping.data.codes.join(', ')}. Mapeie-os antes da validação definitiva do cadastro.`}
        />
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        <Card className="grid content-start gap-2">
          <h2 className="app-panel__title">Locais</h2>
          {(depots.data ?? []).map((depot) => (
            <button
              key={depot.id}
              type="button"
              onClick={() => {
                setNewDepot(false)
                setSelectedId(depot.id)
              }}
              className="rounded-lg border px-3 py-2 text-left text-sm"
            >
              <span className="font-semibold">{depot.code}</span>
              <span className="block text-xs text-[var(--app-muted)]">
                {depot.tipo === 'depot' ? 'Depot' : 'Terminal portuário'} · {depot.name || 'Sem nome'}
              </span>
            </button>
          ))}
        </Card>
        <div className="grid gap-5">
          <Card className="grid gap-3">
            <h2 className="app-panel__title">Identificação</h2>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Código">
                <Input
                  value={depotForm.code}
                  disabled={!canEdit}
                  onChange={(e) => setDepotForm((f) => ({ ...f, code: e.target.value }))}
                />
              </Field>
              <Field label="Nome">
                <Input
                  value={depotForm.name}
                  disabled={!canEdit}
                  onChange={(e) => setDepotForm((f) => ({ ...f, name: e.target.value }))}
                />
              </Field>
              <Field label="Tipo">
                <Select
                  value={depotForm.tipo}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setDepotForm((f) => ({
                      ...f,
                      tipo: e.target.value as 'depot' | 'terminal_portuario',
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
                <Field label="Porto brasileiro">
                  <Select
                    value={depotForm.port_id === null ? '' : String(depotForm.port_id)}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setDepotForm((f) => ({
                        ...f,
                        port_id: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                  >
                    <option value="">Selecione</option>
                    {(ports.data ?? []).map((port) => (
                      <option key={port.id} value={port.id}>
                        {port.locode} · {port.name ?? 'Sem nome'}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {isDepot ? (
                <>
                  <Field label="Free time vazio">
                    <Input
                      type="number"
                      min={0}
                      value={depotForm.free_time_vazio_days}
                      disabled={!canEdit}
                      onChange={(e) => setDepotForm((f) => ({ ...f, free_time_vazio_days: Number(e.target.value) }))}
                    />
                  </Field>
                  <Field label="Free time material">
                    <Input
                      type="number"
                      min={0}
                      value={depotForm.free_time_material_days}
                      disabled={!canEdit}
                      onChange={(e) => setDepotForm((f) => ({ ...f, free_time_material_days: Number(e.target.value) }))}
                    />
                  </Field>
                </>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={depotForm.active}
                disabled={!canEdit}
                onChange={(e) => setDepotForm((f) => ({ ...f, active: e.target.checked }))}
              />{' '}
              Ativo
            </label>
            {canEdit ? (
              <span className="flex gap-2">
                <Button onClick={() => void saveDepot()} disabled={!canSaveDepot}>
                  Salvar local
                </Button>
                {selected && canDelete ? (
                  <Button variant="ghost" onClick={() => void removeDepot()}>
                    <Trash2 size={14} /> Excluir
                  </Button>
                ) : null}
              </span>
            ) : null}
          </Card>
          {selected ? (
            <Card className="grid gap-3">
              <h2 className="app-panel__title">Catálogo sugerido</h2>
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Serviço">
                  <Input
                    value={serviceForm.name}
                    disabled={!canEdit}
                    onChange={(e) => setServiceForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </Field>
                <Field label="Natureza">
                  <Select
                    value={serviceForm.natureza}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setServiceForm((f) => ({
                        ...f,
                        natureza: e.target.value as ServiceNature,
                        container_type: '',
                        route_destino_id: '',
                        condition: '',
                      }))
                    }
                  >
                    <option value="armazenagem">Armazenagem</option>
                    <option value="transporte">Transporte</option>
                    <option value="geral">Geral</option>
                  </Select>
                </Field>
                {serviceForm.natureza === 'armazenagem' ? (
                  <Field label="Condição">
                    <Select
                      value={serviceForm.condition}
                      disabled={!canEdit}
                      onChange={(e) => setServiceForm((f) => ({ ...f, condition: e.target.value }))}
                    >
                      <option value="">Selecione</option>
                      <option value="vazio">EMPTY</option>
                      <option value="material">EMPTY W/ MATERIAL</option>
                    </Select>
                  </Field>
                ) : null}
                {serviceForm.natureza === 'transporte' ? (
                  <Field label="Destino da rota">
                    <Select
                      value={serviceForm.route_destino_id}
                      disabled={!canEdit}
                      onChange={(e) => setServiceForm((f) => ({ ...f, route_destino_id: e.target.value }))}
                    >
                      <option value="">Selecione</option>
                      {(depots.data ?? []).filter((depot) => depot.id !== selected.id).map((depot) => (
                        <option key={depot.id} value={depot.id}>
                          {depot.code} · {depot.name || 'Sem nome'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <Field label="Valor sugerido">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={serviceForm.rate_brl}
                    disabled={!canEdit}
                    onChange={(e) => setServiceForm((f) => ({ ...f, rate_brl: Number(e.target.value) }))}
                  />
                </Field>
              </div>
              {canEdit ? (
                <Button onClick={() => void saveService()} disabled={!serviceForm.name.trim()}>
                  <Plus size={16} /> {serviceForm.id ? 'Salvar serviço' : 'Adicionar serviço'}
                </Button>
              ) : null}
              <ul className="grid gap-2 text-sm">
                {(services.data ?? []).map((service) => (
                  <li key={service.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                    <span className={service.active ? '' : 'opacity-60'}>
                      {service.name} · {service.natureza} · {formatBRL(Number(service.rate_brl))}
                      {service.container_type ? ` · ${service.container_type}` : ''}
                      {service.condition ? ` · ${conditionLabel(service.condition)}` : ''}
                      {service.route_destino_id
                        ? ` · destino: ${(depots.data ?? []).find((depot) => depot.id === service.route_destino_id)?.code ?? service.route_destino_id}`
                        : ''}
                    </span>
                    {canEdit ? (
                      <span className="flex gap-1">
                        <Button variant="ghost" onClick={() => editService(service)}>
                          <Edit3 size={14} /> Editar
                        </Button>
                        <Button variant="ghost" onClick={() => void toggleService(service)}>
                          <Power size={14} /> {service.active ? 'Inativar' : 'Ativar'}</Button>
                        {canDelete ? (
                          <Button variant="ghost" onClick={() => void removeService(service)}>
                            <Trash2 size={14} /> Excluir
                          </Button>
                        ) : null}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-[var(--app-muted)]">Selecione ou crie um local para configurar o catálogo.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
