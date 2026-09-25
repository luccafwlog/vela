import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { useConfirm } from '../ui/ConfirmDialog'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import {
  initialVoyageFormValues,
  normalizeVoyageFormValues,
  validateIndicatedFirstBrazilianPort,
  voyageFormSchema,
  type VoyageFormErrors,
  type VoyageFormValues,
} from '../../services/voyageForm'
import { createVoyage, updateVoyage } from '../../services/voyages'

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
  const [form, setForm] = useState<VoyageFormValues>(initialVoyageFormValues)
  const [hasIndicatedFirstPort, setHasIndicatedFirstPort] = useState(false)
  const [pristine, setPristine] = useState({
    form: initialVoyageFormValues,
    hasIndicatedFirstPort: false,
  })
  const [errors, setErrors] = useState<VoyageFormErrors>({})
  const [saving, setSaving] = useState(false)

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
      setForm(nextForm)
      setHasIndicatedFirstPort(nextHasIndicatedFirstPort)
      setPristine({ form: nextForm, hasIndicatedFirstPort: nextHasIndicatedFirstPort })
      setErrors({})
    }
  }

  const isDirty =
    JSON.stringify({ form, hasIndicatedFirstPort }) !== JSON.stringify(pristine)

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

    const indicatedPortError = await validateIndicatedFirstBrazilianPort(normalizedForm, voyageId)
    if (indicatedPortError) {
      setErrors({ indicatedFirstBrazilianPort: indicatedPortError })
      return
    }

    setErrors({})
    setSaving(true)

    try {
      const saved = voyageId
        ? await updateVoyage(voyageId, normalizedForm, user?.id ?? null)
        : await createVoyage(normalizedForm, user?.id ?? null)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-options'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-escala-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])

      showToast(voyageId ? 'Viagem atualizada com sucesso.' : 'Viagem cadastrada com sucesso.', 'success')
      onSaved?.(saved.id)
      onClose()
      setForm(initialVoyageFormValues)
    } catch {
      showToast(
        voyageId
          ? 'Falha ao atualizar viagem. Revise os dados e tente novamente.'
          : 'Falha ao cadastrar viagem. Revise os dados e tente novamente.',
        'error',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="app-panel app-panel--padded text-sm">
          {note ??
            'Cadastre a viagem. As escalas, chegadas e atracações são planejadas no modal da própria viagem.'}
        </div>

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
          <Field label="Navio" error={errors.vesselName}>
            <Input
              value={form.vesselName}
              onChange={(event) => setForm((current) => ({ ...current, vesselName: event.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="IMO">
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

        <div className="app-panel app-panel--padded grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="app-panel__title">1º Porto Brasileiro (Âncora D−7 / D−5)</div>
              <div className="app-panel__meta">
                Por padrão, a âncora de prazos é o menor ETA das escalas próprias. Ative para indicar outro 1º porto brasileiro com ETA anterior.
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--app-text)] font-medium">
              <input
                type="checkbox"
                checked={hasIndicatedFirstPort}
                disabled={!voyageId}
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
                className="h-4 w-4 rounded border-slate-500 accent-amber-500"
              />
              Indicar outro 1º porto brasileiro
            </label>
            {!voyageId ? <div className="text-xs text-[var(--app-muted)]">Disponível depois que a viagem tiver ao menos uma escala.</div> : null}
          </div>

          {hasIndicatedFirstPort ? (
            <div className="grid gap-3 md:grid-cols-2 pt-2 border-t border-[var(--app-border)]">
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

        <div className="app-modal__actions">
          <Button variant="secondary" type="button" onClick={handleClose}>
            Voltar
          </Button>
          <Button loading={saving} type="submit">
            {voyageId ? 'Salvar viagem' : 'Cadastrar viagem'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
