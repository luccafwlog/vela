import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { userFacingErrorMessage } from '../../lib/errors'
import { afterBlEstadoAlterado } from '../../services/cacheEffects'
import { isStaleScreenRefusal } from '../../services/manifestosMercanteService'
import { queryKeys } from '../../services/queryKeys'
import {
  CE_MERCANTE_PATTERN,
  correctBlCeMercante,
  normalizeCeMercanteInput,
  removeBlCeMercante,
} from '../../services/blCeMercante'

// CE Mercante fora do Salvar da ficha: corrigir ou remover pede motivo e vai
// pela porta única do banco (migration 177).
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
  const [editing, setEditing] = useState(false)

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
      setEditing(false)
      showToast(success, 'success')
    } catch (error) {
      showToast(userFacingErrorMessage(error, fallback), 'error')
      // O CE mudou depois que a ficha abriu (migration 209): a ficha recarrega
      // e a nova tentativa manda o CE atual.
      if (isStaleScreenRefusal(error)) await refresh()
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
    if (reason === null || !ce) return
    await run(() => correctBlCeMercante({ blId, ce: next, reason, expectedCe: ce }), 'CE Mercante corrigido.', 'Falha ao corrigir o CE Mercante.')
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
    if (!ce) return
    await run(() => removeBlCeMercante({ blId, reason, expectedCe: ce }), 'CE Mercante removido.', 'Falha ao remover o CE Mercante.')
  }

  return (
    <div className="grid content-start gap-2">
      <span className="app-facts__label">CE Mercante</span>
      <p className="app-lead__value app-bl-code">{ce ? <CopyValue value={ce} label="CE Mercante" /> : <NoValue label="Sem CE Mercante" />}</p>
      {/* O primeiro CE entra pela planilha de CE Mercante, que também vincula
          o Manifesto Mercante: a ficha só corrige ou remove (ADR 0078, itens
          1 e 2; `correct_bl_ce_mercante` recusa B/L sem CE). O campo do CE
          novo só abre depois de Corrigir CE (identidade, lote 1). */}
      {disabled || !ce ? null : editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="CE Mercante novo"
            inputMode="numeric"
            placeholder="15 dígitos"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="max-w-[12rem]"
          />
          <Button type="button" variant="secondary" disabled={!canCorrect || busy} onClick={handleCorrect}>
            Corrigir CE
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setDraft('') }}>
            Voltar
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
            Corrigir CE
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={handleRemove}>
            Remover CE
          </Button>
        </div>
      )}
      {ce ? null : <span className="app-field__hint">O CE entra pela importação de CE Mercante, que também vincula o Manifesto.</span>}
    </div>
  )
}
