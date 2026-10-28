import { useCallback, useEffect, useState } from 'react'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { impactNeedingConfirmation } from '../lib/chargeAdjustmentImpact'
import {
  ackBlChargeAdjustmentImpact,
  previewBlChargeAdjustmentImpact,
  type BlChargeImpact,
  type BlChargeImpactChange,
} from '../services/charges/chargeOperationsService'

/**
 * Diálogo **Taxas alteradas à mão serão afetadas** (ADR 0111, D6): antes de
 * gravar uma mudança de base que descarta a alteração à mão ou muda a
 * quantidade de taxa com total alterado, pede o **Gravar mesmo assim** e grava
 * o aceite, para a gravação não abrir o alerta. Sem efeito que peça
 * confirmação, grava direto; prévia que falha não trava a gravação (o alerta
 * cobre).
 */
export function useChargeAdjustmentGuard() {
  const confirm = useConfirm()
  return useCallback(async <T,>(changes: BlChargeImpactChange[] | (() => Promise<BlChargeImpactChange[]>), save: () => Promise<T>, known?: BlChargeImpact[]): Promise<T | undefined> => {
    let impact: BlChargeImpact[] = known ?? []
    if (!known) {
      try {
        impact = await previewBlChargeAdjustmentImpact(typeof changes === 'function' ? await changes() : changes)
      } catch {
        impact = []
      }
    }
    const affected = impactNeedingConfirmation(impact)
    if (affected.length > 0) {
      const confirmed = await confirm({
        title: 'Taxas alteradas à mão serão afetadas',
        message: 'Esta gravação muda taxas alteradas à mão:',
        affected: { summary: `${affected.length === 1 ? '1 taxa afetada' : `${affected.length} taxas afetadas`}`, items: affected.map((line) => line.text) },
        consequence: 'O Histórico das taxas registra a mudança. Confira as taxas do B/L depois de gravar.',
        confirmLabel: 'Gravar mesmo assim',
      })
      if (!confirmed) return undefined
      try {
        await ackBlChargeAdjustmentImpact(Array.from(new Set(affected.map((line) => line.blId))))
      } catch {
        // Sem o aceite, a gravação ainda vale; só abre o alerta.
      }
    }
    return save()
  }, [confirm])
}

/**
 * Prévia **Taxas alteradas à mão** de uma importação (ADR 0111, D6): consulta o
 * efeito das mudanças que a prévia já conhece. Sem mudança, não consulta; falha
 * deixa a seção vazia (o diálogo pergunta de novo ao gravar).
 */
export function useImportChargeImpact(changes: BlChargeImpactChange[] | null) {
  const key = changes && changes.length > 0 ? JSON.stringify(changes) : null
  const [result, setResult] = useState<{ key: string; data: BlChargeImpact[] | undefined } | null>(null)
  useEffect(() => {
    if (key === null) return
    let active = true
    previewBlChargeAdjustmentImpact(JSON.parse(key) as BlChargeImpactChange[])
      .then((data) => { if (active) setResult({ key, data }) })
      .catch(() => { if (active) setResult({ key, data: undefined }) })
    return () => { active = false }
  }, [key])
  return { data: result && result.key === key ? result.data : undefined }
}
