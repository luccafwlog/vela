import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { userFacingErrorMessage } from '../../lib/errors'
import { afterBlEstadoAlterado } from '../../services/cacheEffects'
import { queryKeys } from '../../services/queryKeys'
import {
  CE_MERCANTE_PATTERN,
  correctBlCeMercante,
  normalizeCeMercanteInput,
  removeBlCeMercante,
} from '../../services/blCeMercante'

// CE Mercante fora do Salvar da ficha: corrigir ou remover pede motivo e vai
// pela porta única do banco (migration 176).
export function BlCeMercanteField({
  blId,
  voyageId,
  ce,
  disabled,
}: {
  blId: string
  voyageId: number | string | null
  ce: string | null
  disabled?: boolean
}) {
  const queryClient = useQueryClient()
  const confirmWithReason = useConfirmWithReason()
  const { showToast } = useToast()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const next = normalizeCeMercanteInput(draft)
  const canCorrect = CE_MERCANTE_PATTERN.test(next) && next !== (ce ?? '')

  async function refresh() {
    await Promise.all([
      afterBlEstadoAlterado(queryClient, { blId, voyageId }),
      queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs.detail('bl', blId) }),
    ])
  }

  async function run(action: () => Promise<void>, success: string, fallback: string) {
    setBusy(true)
    try {
      await action()
      await refresh()
      setDraft('')
      showToast(success, 'success')
    } catch (error) {
      showToast(userFacingErrorMessage(error, fallback), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleCorrect() {
    const reason = await confirmWithReason({
      title: 'Corrigir CE Mercante',
      message: `Trocar o CE do B/L ${blId} de ${ce ?? 'sem CE'} para ${next}?`,
      consequence: 'O CE novo vale para Liberação e faturamento. Se o Comunicado de CE e Taxas já foi enviado, abre a pendência de reenvio.',
      reversibility: 'Corrigir de novo, com motivo.',
      confirmLabel: 'Corrigir CE',
    })
    if (reason === null) return
    await run(() => correctBlCeMercante({ blId, ce: next, reason }), 'CE Mercante corrigido.', 'Falha ao corrigir o CE Mercante.')
  }

  async function handleRemove() {
    const reason = await confirmWithReason({
      title: 'Remover CE Mercante',
      message: `Remover o CE ${ce} do B/L ${blId}?`,
      consequence: 'O B/L volta a aguardar CE. Com fatura viva, a remoção é recusada: o Administrativo cancela a fatura antes.',
      reversibility: 'Importar ou corrigir o CE de novo.',
      confirmLabel: 'Remover CE',
      tone: 'danger',
    })
    if (reason === null) return
    await run(() => removeBlCeMercante({ blId, reason }), 'CE Mercante removido.', 'Falha ao remover o CE Mercante.')
  }

  return (
    <div className="app-field">
      <span className="app-field__label">CE Mercante</span>
      <div className="space-y-2">
        <p className="font-mono text-sm">{ce ?? 'Sem CE'}</p>
        {disabled ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="CE Mercante novo"
              inputMode="numeric"
              placeholder="15 dígitos"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="max-w-[12rem]"
            />
            <Button type="button" variant="secondary" disabled={!canCorrect || busy} onClick={handleCorrect}>
              Corrigir
            </Button>
            {ce ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={handleRemove}>
                Remover
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <span className="app-field__hint">Muda pela importação de CE ou por Corrigir, com motivo.</span>
    </div>
  )
}
