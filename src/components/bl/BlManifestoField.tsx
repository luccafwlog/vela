import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { userFacingErrorMessage } from '../../lib/errors'
import { useMoveBlsToManifestoMercante, useUnlinkBlsFromManifestoMercante } from '../../hooks/useManifestosMercante'
import { canonicalManifestoNumero, MANIFESTO_NUMERO_PATTERN } from '../../services/manifestosMercanteService'
import { queryKeys } from '../../services/queryKeys'

// Manifesto Mercante do B/L na ficha: Mover ou Desvincular, com motivo
// (ADR 0078, item 7; migration 180). O lote fica em Viagem → Rotas e Manifestos.
export function BlManifestoField({
  blId,
  voyageId,
  numero,
  disabled,
}: {
  blId: string
  voyageId: number | null
  numero: string | null
  disabled?: boolean
}) {
  const queryClient = useQueryClient()
  const confirmWithReason = useConfirmWithReason()
  const { showToast } = useToast()
  const move = useMoveBlsToManifestoMercante(voyageId)
  const unlink = useUnlinkBlsFromManifestoMercante(voyageId)
  const [draft, setDraft] = useState('')
  const target = canonicalManifestoNumero(draft)
  const valid = MANIFESTO_NUMERO_PATTERN.test(target) && target !== numero
  const busy = move.isPending || unlink.isPending

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(blId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs.detail('bl', blId) }),
    ])
  }

  async function handleMove() {
    const reason = await confirmWithReason({
      title: 'Mover para outro Manifesto Mercante',
      message: `O B/L ${blId} sairá de ${numero ?? 'sem Manifesto'} e irá para ${target}.`,
      consequence: 'O número novo é cadastrado na rota do B/L se ainda não existir. O CE Mercante não muda.',
      reversibility: 'Mover de novo, com motivo.',
      confirmLabel: 'Mover',
    })
    if (reason === null) return
    try {
      await move.mutateAsync({ blIds: [blId], numero: target, reason })
      await refresh()
      setDraft('')
      showToast(`B/L movido para o Manifesto ${target}.`, 'success')
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Não foi possível mover o B/L.'), 'error')
    }
  }

  async function handleUnlink() {
    const reason = await confirmWithReason({
      title: 'Desvincular do Manifesto Mercante',
      message: `O B/L ${blId} sairá do Manifesto ${numero} e ficará sem Manifesto.`,
      consequence: 'O CE Mercante não muda.',
      reversibility: 'Mover para um Manifesto, com motivo.',
      confirmLabel: 'Desvincular',
      tone: 'danger',
    })
    if (reason === null) return
    try {
      await unlink.mutateAsync({ blIds: [blId], reason })
      await refresh()
      showToast('B/L desvinculado do Manifesto Mercante.', 'success')
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Não foi possível desvincular o B/L.'), 'error')
    }
  }

  return (
    <div className="app-field">
      <span className="app-field__label">Manifesto Mercante</span>
      <div className="space-y-2">
        <p className="font-mono text-sm">{numero ?? 'Sem Manifesto'}</p>
        {disabled ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Mover para o Nº de Manifesto Mercante"
              placeholder="13 caracteres"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="max-w-[12rem]"
            />
            <Button type="button" variant="secondary" disabled={!valid || busy} onClick={() => void handleMove()}>Mover</Button>
            {numero ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void handleUnlink()}>Desvincular</Button>
            ) : null}
          </div>
        )}
      </div>
      <span className="app-field__hint">Mudar o POD ou a Viagem do B/L desvincula o Manifesto.</span>
    </div>
  )
}
