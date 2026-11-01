import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { afterViagemAlterada } from '../../services/cacheEffects'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { useConfirm } from '../ui/ConfirmDialog'
import { Modal } from '../ui/Modal'
import { Switch } from '../ui/Switch'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { userFacingErrorMessage } from '../../lib/errors'
import { recordScheduleDates } from '../../services/voyageFromSchedule'
import { VoyagePortsPicker } from './VoyagePortsPicker'
import {
  initialVoyageFormValues,
  normalizeVoyageFormValues,
  validateIndicatedFirstBrazilianPort,
  voyageFormSchema,
  type VoyageFormErrors,
  type VoyageFormValues,
  type VoyagePortStop,
} from '../../services/voyageForm'
import {
  createVoyage,
  duplicateVoyageMessage,
  duplicateVoyageRefusal,
  fetchVoyageShowOnPortal,
  findDuplicateVoyage,
  setVoyageShowOnPortal,
  updateVoyage,
} from '../../services/voyages'

export function VoyageCreateModal({
  open,
  onClose,
  onSaved,
  title = 'Nova Viagem',
  initialValues,
  note,
  voyageId,
}: {
  open: boolean
  onClose: () => void
  onSaved?: (voyageId: number) => void
  title?: string
  initialValues?: Partial<VoyageFormValues>
  note?: string
  voyageId?: number
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { user } = useAuth()
  const confirm = useConfirm()
  const isNew = voyageId == null
  const [form, setForm] = useState<VoyageFormValues>(initialVoyageFormValues)
  const [hasIndicatedFirstPort, setHasIndicatedFirstPort] = useState(false)
  // Portos e datas só no cadastro: na edição, as datas são das escalas da
  // ficha (e de Chegadas e Saídas), que tratam "Não escala" com as âncoras.
  const [lanes, setLanes] = useState<VoyagePortStop[]>([])
  // Porto ou data digitados sem Adicionar: o cadastro recusa em vez de criar a
  // viagem sem eles, e Voltar pede confirmação.
  const [portDrafts, setPortDrafts] = useState<Record<VoyagePortStop['kind'], boolean>>({ pol: false, pod: false })
  const [draftRefused, setDraftRefused] = useState<Record<VoyagePortStop['kind'], boolean>>({ pol: false, pod: false })
  const [carrierOpen, setCarrierOpen] = useState(false)
  const [pristine, setPristine] = useState({
    form: initialVoyageFormValues,
    hasIndicatedFirstPort: false,
    lanes: [] as VoyagePortStop[],
  })
  const [errors, setErrors] = useState<VoyageFormErrors>({})
  const [saving, setSaving] = useState(false)
  // Aparição em Chegadas e Saídas (revisão de 2026-10-22, A2): `null` é "como
  // está"; na Viagem nova, desligada até o operador ligar.
  const [portalChoice, setPortalChoice] = useState<boolean | null>(null)
  const portalQuery = useQuery({
    queryKey: ['voyage-show-on-portal', voyageId ?? null],
    queryFn: () => fetchVoyageShowOnPortal(voyageId as number),
    enabled: open && voyageId != null,
  })
  const currentlyShown = voyageId != null && portalQuery.data === true
  const showOnPortal = portalChoice ?? currentlyShown
  // Desligar tira a viagem da Programação do Vela e do Portal (ADR 0097,
  // que supersede a ADR 0071, item 12); fica no Histórico da viagem.
  const portalLocked = voyageId != null && (portalQuery.isLoading || portalQuery.isError)

  // Re-baseia o formulário quando o modal abre ou os valores iniciais mudam —
  // ajuste durante o render (sem useEffect), mantendo o gatilho original.
  const [prevReset, setPrevReset] = useState<{ open: boolean; initialValues?: Partial<VoyageFormValues> }>({ open })
  if (open !== prevReset.open || initialValues !== prevReset.initialValues) {
    setPrevReset({ open, initialValues })
    if (open) {
      const indicatedPort = initialValues?.indicatedFirstBrazilianPort ?? initialVoyageFormValues.indicatedFirstBrazilianPort
      const indicatedEta = initialValues?.indicatedFirstBrazilianEta ?? initialVoyageFormValues.indicatedFirstBrazilianEta
      const nextForm = {
        ...initialVoyageFormValues,
        ...initialValues,
        indicatedFirstBrazilianPort: indicatedPort,
        indicatedFirstBrazilianEta: indicatedEta,
      }
      const nextHasIndicatedFirstPort = Boolean(indicatedPort || indicatedEta)
      const nextLanes: VoyagePortStop[] = []
      setForm(nextForm)
      setHasIndicatedFirstPort(nextHasIndicatedFirstPort)
      setLanes(nextLanes)
      setPortDrafts({ pol: false, pod: false })
      setDraftRefused({ pol: false, pod: false })
      setCarrierOpen(false)
      setPristine({ form: nextForm, hasIndicatedFirstPort: nextHasIndicatedFirstPort, lanes: nextLanes })
      setPortalChoice(null)
      setErrors({})
    }
  }

  const isDirty =
    JSON.stringify({ form, hasIndicatedFirstPort, lanes }) !== JSON.stringify(pristine)
    || portalChoice !== null
    || portDrafts.pol
    || portDrafts.pod

  async function handleClose() {
    if (!isDirty) {
      onClose()
      return
    }

    const shouldDiscard = await confirm({
      title: 'Descartar alterações?',
      message: 'Há alterações não salvas nesta viagem. Deseja descartá-las?',
      confirmLabel: 'Descartar alterações',
      cancelLabel: 'Continuar editando',
      tone: 'danger',
    })

    if (shouldDiscard) onClose()
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const normalizedForm = normalizeVoyageFormValues(form)
    const result = voyageFormSchema.safeParse(normalizedForm)
    if (!result.success) {
      const fieldErrors: VoyageFormErrors = {}
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof VoyageFormValues
        if (!fieldErrors[field]) fieldErrors[field] = issue.message
      }
      setErrors(fieldErrors)
      return
    }

    if (isNew && (portDrafts.pol || portDrafts.pod)) {
      setDraftRefused({ ...portDrafts })
      return
    }

    const indicatedPortError = await validateIndicatedFirstBrazilianPort(normalizedForm, voyageId)
    if (indicatedPortError) {
      setErrors({ indicatedFirstBrazilianPort: indicatedPortError })
      return
    }

    setErrors({})
    setSaving(true)

    try {
      // Navio e número já cadastrados (revisão de 2026-10-22, A1): a tela
      // avisa antes; o banco recusa de novo na gravação (migration 413).
      const identityChanged = !voyageId
        || normalizedForm.vesselName !== normalizeVoyageFormValues(pristine.form).vesselName
        || normalizedForm.vesselImo !== normalizeVoyageFormValues(pristine.form).vesselImo
        || normalizedForm.voyageNumber !== normalizeVoyageFormValues(pristine.form).voyageNumber
      const duplicate = identityChanged
        ? await findDuplicateVoyage({ ...normalizedForm, excludeVoyageId: voyageId ?? null })
        : null
      if (duplicate) {
        setErrors({ voyageNumber: duplicateVoyageMessage(duplicate) })
        return
      }

      // Portos e datas da Viagem nova: as mesmas escalas (ETA) e ETD do POL
      // que Chegadas e Saídas grava, só dos portos com data.
      // ponytail: duas gravações, não uma transação — se as datas forem
      // recusadas, a Viagem fica cadastrada sem elas e a tela diz isso; o
      // upgrade é uma RPC que cria a Viagem e as datas juntas.
      const scheduleLanes = isNew ? lanes : []
      // Com datas a gravar, publica depois delas: datas recusadas não deixam
      // a Viagem no Portal e no site sem data nenhuma. (Chegadas e Saídas faz
      // o mesmo ao publicar Viagem existente; a nova de lá nasce publicada.)
      // O UPDATE logo depois do cadastro some no "Viagem criada" da linha do
      // tempo (janela de 60 s de voyageSummaries).
      const publishAfterDates = scheduleLanes.length > 0 && showOnPortal
      const saved = voyageId
        ? await updateVoyage(voyageId, normalizedForm, user?.id ?? null)
        : await createVoyage(normalizedForm, user?.id ?? null, { origin: 'viagens', showOnPortal: showOnPortal && !publishAfterDates })
      if (voyageId && showOnPortal !== currentlyShown) await setVoyageShowOnPortal(voyageId, showOnPortal)

      let datesFailure: string | null = null
      if (scheduleLanes.length) {
        try {
          await recordScheduleDates(saved.id, scheduleLanes, user?.id ?? null)
        } catch (error) {
          datesFailure = userFacingErrorMessage(error, 'falha na gravação das datas').replace(/\.$/, '')
        }
      }
      let publishFailure = false
      if (publishAfterDates && !datesFailure) {
        try {
          await setVoyageShowOnPortal(saved.id, true)
        } catch {
          publishFailure = true
        }
      }

      await afterViagemAlterada(queryClient, { voyageId: saved.id })
      void queryClient.invalidateQueries({ queryKey: ['voyage-show-on-portal'] })

      if (datesFailure) {
        showToast(
          `Viagem cadastrada, mas as datas dos portos não foram gravadas (${datesFailure}). Informe-as nas escalas da ficha da viagem${publishAfterDates ? ' e ligue Chegadas e Saídas depois' : ''}.`,
          'error',
        )
      } else if (publishFailure) {
        showToast('Viagem cadastrada com as datas, mas não entrou em Chegadas e Saídas. Ligue a chave na edição da viagem.', 'error')
      } else {
        showToast(voyageId ? 'Viagem atualizada com sucesso.' : 'Viagem cadastrada com sucesso.', 'success')
      }
      onSaved?.(saved.id)
      onClose()
      setForm(initialVoyageFormValues)
      setLanes([])
    } catch (error) {
      const refusal = duplicateVoyageRefusal(error)
      if (refusal) {
        setErrors({ voyageNumber: refusal })
        return
      }
      // Recusa de regra (IMO conflitante, navio ambíguo) mostra o motivo.
      showToast(
        userFacingErrorMessage(
          error,
          voyageId
            ? 'Falha ao atualizar viagem. Revise os dados e tente novamente.'
            : 'Falha ao cadastrar viagem. Revise os dados e tente novamente.',
        ),
        'error',
      )
    } finally {
      setSaving(false)
    }
  }

  const noteText = note ?? (isNew ? null : 'As datas por porto, chegadas e atracações se editam nas escalas da ficha da viagem.')
  const showCarrierFields = carrierOpen || Boolean(errors.carrierName)

  return (
    <Modal open={open} onClose={handleClose} title={title} size="md">
      <form className="grid gap-5" onSubmit={handleSubmit}>
        {noteText ? <p className="app-panel__meta">{noteText}</p> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Navio" error={errors.vesselName}>
            <Input
              value={form.vesselName}
              onChange={(event) => setForm((current) => ({ ...current, vesselName: event.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="IMO" error={errors.vesselImo}>
            <Input
              value={form.vesselImo}
              onChange={(event) => setForm((current) => ({ ...current, vesselImo: event.target.value }))}
            />
          </Field>
          <Field label="Numero da viagem" error={errors.voyageNumber}>
            <Input
              value={form.voyageNumber}
              onChange={(event) => setForm((current) => ({ ...current, voyageNumber: event.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({ ...current, status: event.target.value as VoyageFormValues['status'] }))
              }
            >
              <option value="active">Ativa</option>
              <option value="completed">Concluida</option>
              {form.status === 'cancelled' ? <option value="cancelled" disabled>Cancelada</option> : null}
            </Select>
          </Field>
        </div>

        {isNew ? (
          <section className="grid gap-4" aria-labelledby="nova-viagem-portos">
            <div className="grid gap-1">
              <h3 id="nova-viagem-portos" className="app-panel__title">Portos e datas</h3>
              <p className="app-panel__meta">Opcional. Sem porto, as escalas são planejadas depois na ficha.</p>
            </div>
            {(['pol', 'pod'] as const).map((kind) => (
              <VoyagePortsPicker
                key={kind}
                kind={kind}
                stops={lanes.filter((stop) => stop.kind === kind)}
                takenCodes={lanes.map((stop) => stop.code)}
                onAdd={(stop) => setLanes((current) => [...current, stop])}
                onRemove={(code) => setLanes((current) => current.filter((stop) => stop.code !== code))}
                onDraftChange={(hasDraft) => {
                  setPortDrafts((current) => (current[kind] === hasDraft ? current : { ...current, [kind]: hasDraft }))
                  setDraftRefused((current) => (current[kind] ? { ...current, [kind]: false } : current))
                }}
                draftRefused={draftRefused[kind]}
              />
            ))}
          </section>
        ) : null}

        <div className="grid gap-3 border-t border-[var(--app-border)] pt-4">
          <div className="grid gap-1">
            <Switch
              size="sm"
              checked={showOnPortal}
              disabled={portalLocked}
              onChange={(next) => setPortalChoice(next === currentlyShown ? null : next)}
            >
              Chegadas e Saídas
            </Switch>
            <p className="app-field__hint">
              Ligada, a viagem aparece na programação de Chegadas e Saídas, do Portal e do site fwlog.com.br.
            </p>
          </div>

          {showCarrierFields ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Armador" error={errors.carrierName}>
                <Input
                  value={form.carrierName}
                  onChange={(event) => setForm((current) => ({ ...current, carrierName: event.target.value }))}
                />
              </Field>
              <Field label="SCAC">
                <Input
                  value={form.carrierScac}
                  onChange={(event) => setForm((current) => ({ ...current, carrierScac: event.target.value.toUpperCase() }))}
                />
              </Field>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="app-field__hint">
                Armador: {form.carrierName || 'não informado'}{form.carrierScac ? ` · SCAC ${form.carrierScac}` : ''}
              </p>
              <Button variant="ghost" className="app-btn--sm" type="button" onClick={() => setCarrierOpen(true)}>
                Alterar armador
              </Button>
            </div>
          )}

          {isNew ? null : (
            <div className="grid gap-2">
              <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-[var(--app-text)]">
                <input
                  type="checkbox"
                  checked={hasIndicatedFirstPort}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setHasIndicatedFirstPort(checked)
                    if (!checked) {
                      setForm((current) => ({
                        ...current,
                        indicatedFirstBrazilianPort: null,
                        indicatedFirstBrazilianEta: null,
                      }))
                    }
                  }}
                  className="h-4 w-4 accent-[var(--app-blue-btn)]"
                />
                Indicar outro 1º porto brasileiro (âncora D−7 / D−5)
              </label>

              {hasIndicatedFirstPort ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Porto indicado" error={errors.indicatedFirstBrazilianPort}>
                    <Input
                      value={form.indicatedFirstBrazilianPort ?? ''}
                      placeholder="Ex.: BRSSZ"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          indicatedFirstBrazilianPort: event.target.value.toUpperCase(),
                        }))
                      }
                    />
                  </Field>
                  <Field label="ETA indicado" error={errors.indicatedFirstBrazilianEta}>
                    <Input
                      type="date"
                      value={form.indicatedFirstBrazilianEta ?? ''}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          indicatedFirstBrazilianEta: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="app-modal__actions">
          <Button variant="secondary" type="button" onClick={handleClose}>
            Voltar
          </Button>
          <Button loading={saving} loadingLabel="Salvando…" type="submit">
            {voyageId ? 'Salvar viagem' : 'Cadastrar viagem'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
