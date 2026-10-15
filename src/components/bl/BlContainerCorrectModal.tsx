import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { afterBlEstadoAlterado, afterDatasContainerAlteradas } from '../../services/cacheEffects'
import { queryKeys } from '../../services/queryKeys'
import { containerCorrectionValues, correctContainerData, planContainerCorrection, type ContainerCorrectionValues } from '../../services/containerCorrection'
import { CONTAINER_PROFILE_LABELS, partLotInvoicedNotice, setContainerOwnership, setContainerProfile, type ContainerProfile } from '../../services/vaziosNatureza'
import { updateContainerDates } from '../../services/demurrage/demurrageContainers'
import { userFacingErrorMessage } from '../../lib/errors'
import type { ContainerOwnership } from '../../lib/containerOwnership'
import type { BLDetail } from '../../types/database'

type Container = NonNullable<BLDetail['bl_containers']>[number]

/**
 * Janela Corrigir da aba Carga (identidade, lote 1): os dados corrigíveis do
 * container numa justificativa só. Perfil e COC/SOC recalculam as Taxas
 * Locais e ficam travados com o B/L faturado (a correção sai pela
 * reimportação ou pelo Baplie, ADR 0077); lacre, peso bruto, CBM e datas
 * corrigem sempre (decisão de 2026-10-15; migration 283).
 */
export function BlContainerCorrectModal({
  bl,
  container,
  chargesLocked,
  onClose,
}: {
  bl: Pick<BLDetail, 'id' | 'voyage_id'>
  container: Container
  /** B/L faturado: Perfil e COC/SOC não mudam por aqui. */
  chargesLocked: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { showToast } = useToast()
  const [initial] = useState(() => containerCorrectionValues(container))
  const [values, setValues] = useState<ContainerCorrectionValues>(initial)
  const [justification, setJustification] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof ContainerCorrectionValues>(key: K, value: ContainerCorrectionValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setError(null)
  }

  async function handleSave() {
    const plan = planContainerCorrection(initial, values)
    if (plan.error) return setError(plan.error)
    if (!plan.changes.length) return setError('Nenhum dado do container mudou.')
    const reason = justification.trim()
    if (!reason) return setError('Informe a justificativa da correção.')

    const recalculates = Boolean(plan.profile || plan.ownership)
    const confirmed = await confirm({
      title: `Corrigir container ${container.container_number}`,
      message: `Salvar a correção do container ${container.container_number} no B/L ${bl.id}?`,
      confirmLabel: 'Salvar correção',
      changes: plan.changes,
      consequence: [
        'Vale também para os outros B/Ls ativos desta Viagem que dividem o container (Part Lot).',
        recalculates ? 'Perfil e COC/SOC recalculam as Taxas Locais.' : null,
        plan.dates ? 'As datas recalculam a Demurrage.' : null,
        'Cada campo fica no histórico com autor e justificativa.',
      ].filter(Boolean).join(' '),
      reversibility: 'Corrija de novo, com nova justificativa. Reimportar o B/L volta lacre, peso e CBM ao que o arquivo traz.',
    })
    if (!confirmed) return

    // ponytail: cada correção é uma transação própria no banco (perfil,
    // COC/SOC, dados físicos e datas têm RPCs separadas); se uma falha no
    // meio, as anteriores ficam gravadas e o aviso diz o que faltou. Uma RPC
    // única resolveria, mas reescreveria as três que já existem.
    setSaving(true)
    const saved: string[] = []
    const invoicedBls = new Set<string>()
    try {
      if (plan.profile) {
        const result = await setContainerProfile({ containerId: container.id, profile: plan.profile, justification: reason })
        result.invoicedBls.forEach((id) => invoicedBls.add(id))
        saved.push('perfil')
      }
      if (plan.ownership) {
        const result = await setContainerOwnership({ containerId: container.id, ownership: plan.ownership, justification: reason })
        result.invoicedBls.forEach((id) => invoicedBls.add(id))
        saved.push('COC/SOC')
      }
      if (plan.data) {
        await correctContainerData({ containerId: container.id, ...plan.data, justification: reason })
        saved.push('lacre, peso e CBM')
      }
      if (plan.dates) {
        await updateContainerDates(container.id, plan.dates.discharge, plan.dates.returnDate, reason)
        saved.push('datas')
      }
      showToast(`Container ${container.container_number} corrigido.${partLotInvoicedNotice([...invoicedBls])}`, 'success')
      onClose()
    } catch (err) {
      const message = userFacingErrorMessage(err, 'Falha ao corrigir o container.')
      setError(saved.length ? `${message} Já foram gravados: ${saved.join(', ')}.` : message)
    } finally {
      setSaving(false)
      await Promise.all([
        afterBlEstadoAlterado(queryClient, { blId: bl.id, voyageId: bl.voyage_id }),
        afterDatasContainerAlteradas(queryClient),
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.timeline(bl.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs.detail('bl', bl.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines(bl.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.pendencies() }),
      ])
    }
  }

  const lockedHint = chargesLocked ? 'B/L faturado: reimporte o B/L ou aplique o Baplie; a fatura é tratada sozinha.' : undefined

  return (
    <Modal open size="md" title={`Corrigir container ${container.container_number}`} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Perfil" hint={lockedHint}>
            <Select value={values.profile} disabled={chargesLocked} onChange={(event) => set('profile', event.target.value as ContainerProfile)}>
              {Object.entries(CONTAINER_PROFILE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="COC/SOC" hint={lockedHint}>
            <Select value={values.ownership} disabled={chargesLocked} onChange={(event) => set('ownership', event.target.value as ContainerOwnership)}>
              {values.ownership ? null : <option value="" disabled>Não informado</option>}
              <option value="COC">COC</option>
              <option value="SOC">SOC</option>
            </Select>
          </Field>
          <Field label="Lacre">
            <Input value={values.seal} onChange={(event) => set('seal', event.target.value)} />
          </Field>
          <Field label="Peso bruto (kg)">
            <Input type="number" min={0} step="any" value={values.grossWeightKg} onChange={(event) => set('grossWeightKg', event.target.value)} />
          </Field>
          <Field label="CBM (m³)">
            <Input type="number" min={0} step="any" value={values.cbm} onChange={(event) => set('cbm', event.target.value)} />
          </Field>
          <span aria-hidden="true" />
          <Field label="Descarga">
            <Input type="date" value={values.discharge} onChange={(event) => set('discharge', event.target.value)} />
          </Field>
          <Field label="Devolução" hint={values.ownership === 'SOC' ? 'SOC não espera devolução.' : undefined}>
            <Input type="date" min={values.discharge || undefined} value={values.returnDate} onChange={(event) => set('returnDate', event.target.value)} />
          </Field>
        </div>
        <Field label="Justificativa" required hint="Fica no histórico do B/L com o autor. Mostra o antes e depois de cada campo para confirmar.">
          <Input value={justification} onChange={(event) => { setJustification(event.target.value); setError(null) }} />
        </Field>
        {error ? <p className="text-sm text-[var(--app-danger-fg)]" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Voltar</Button>
          <Button type="button" onClick={() => void handleSave()} loading={saving} loadingLabel="Salvando…">Salvar correção</Button>
        </div>
      </div>
    </Modal>
  )
}
