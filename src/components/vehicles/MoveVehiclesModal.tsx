import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { userFacingErrorMessage } from '../../lib/errors'
import { listBlContainersForMove, moveVehiclesToBl } from '../../services/vehicles'

/**
 * Mover para outro B/L (página Veículos; ADR 0078, item 23): qualquer usuário,
 * com motivo, mesmo com CE; a cobrança segue a ADR 0077 (migration 184).
 */
export function MoveVehiclesModal({ open, vehicleIds, onClose, onMoved }: {
  open: boolean
  vehicleIds: number[]
  onClose: () => void
  onMoved: () => Promise<void> | void
}) {
  const confirmWithReason = useConfirmWithReason()
  const { showToast } = useToast()
  const [blId, setBlId] = useState('')
  const [containerId, setContainerId] = useState('')
  const [saving, setSaving] = useState(false)
  const target = blId.trim().toUpperCase()
  const containers = useQuery({
    queryKey: ['vehicle-move-containers', target],
    queryFn: () => listBlContainersForMove(target),
    enabled: open && target.length >= 4,
  })
  const options = containers.data ?? []
  const chosen = containerId ? Number(containerId) : options.length === 1 ? options[0].id : null

  async function handleMove() {
    const reason = await confirmWithReason({
      title: 'Mover para outro B/L',
      message: `${vehicleIds.length} veículo(s) irão para o B/L ${target}.`,
      consequence: 'As Taxas Locais dos dois B/Ls são recalculadas; fatura emitida segue a correção automática (ADR 0077).',
      reversibility: 'Mover de novo, com motivo.',
      confirmLabel: 'Mover',
    })
    if (reason === null) return
    setSaving(true)
    try {
      const result = await moveVehiclesToBl({ ids: vehicleIds, targetBlId: target, containerId: chosen, reason })
      showToast(`${result.moved} veículo(s) movido(s) para o B/L ${result.target_bl_id}.`, 'success')
      await onMoved()
      setBlId('')
      setContainerId('')
      onClose()
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Não foi possível mover os veículos.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} size="sm" title="Mover para outro B/L" onClose={onClose}>
      <div className="space-y-4">
        <Field label="B/L de destino">
          <Input value={blId} onChange={(event) => { setBlId(event.target.value); setContainerId('') }} />
        </Field>
        {target.length >= 4 && containers.isSuccess ? (
          options.length ? (
            <Field label="Container que recebe os veículos">
              <Select value={containerId || (options.length === 1 ? String(options[0].id) : '')} onChange={(event) => setContainerId(event.target.value)}>
                {options.length > 1 ? <option value="">Escolha o container</option> : null}
                {options.map((option) => <option key={option.id} value={option.id}>{option.container_number}</option>)}
              </Select>
            </Field>
          ) : <p role="status" className="text-sm text-red-400">B/L sem containers ou inexistente.</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Voltar</Button>
          <Button onClick={() => void handleMove()} disabled={!vehicleIds.length || !chosen || saving}>Mover ({vehicleIds.length})</Button>
        </div>
      </div>
    </Modal>
  )
}
