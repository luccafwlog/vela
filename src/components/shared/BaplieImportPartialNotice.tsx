import { useState } from 'react'
import { Button } from '../ui/Button'
import { ImportNotice } from './ImportParts'
import { baplieImportToast, hasBapliePendency, retryBaplieVazios, type BaplieImportDone } from '../../services/baplieImport'

function pendencyTitle(result: BaplieImportDone) {
  if (!hasBapliePendency(result)) return 'Baplie importado, sem pendências'
  if (result.flagsError && result.vaziosError) return 'Baplie importado, com IMO/OOG e vazios pendentes'
  if (result.vaziosError) return 'Baplie importado, mas os vazios de importação não foram recadastrados'
  return 'Baplie importado, mas IMO/OOG não foram aplicados aos B/Ls'
}

/**
 * Cada pendência tem o seu caminho e as duas sobrevivem ao fechar (ADR 0092,
 * item 5): IMO/OOG continuam pendentes em /baplie, que os recalcula e oferece
 * "Aplicar IMO/OOG agora" (importar o mesmo arquivo também refaz); os vazios
 * não voltam ao reimportar, porque sem diferença eles não são tocados — o
 * recadastro é oferecido aqui mesmo e, depois de fechar, em /baplie, que
 * compara os vazios do Baplie com os cadastrados (`hasPendingBaplieVazios`) e
 * oferece "Atualizar vazios do Baplie". Quem abre o modal guarda o resultado:
 * depois do recadastro, `onVaziosRetried` o atualiza para que título, resumo e
 * rodapé deixem de citar os vazios; `onRetryingChange` trava o fechar enquanto
 * o recadastro grava.
 */
export function BaplieImportPartialNotice({
  result,
  voyageId,
  actorId,
  onVaziosRetried,
  onRetryingChange,
}: {
  result: BaplieImportDone
  voyageId: number
  actorId: string
  onVaziosRetried: () => Promise<void>
  onRetryingChange?: (retrying: boolean) => void
}) {
  const [retrying, setRetryingState] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  function setRetrying(next: boolean) {
    setRetryingState(next)
    onRetryingChange?.(next)
  }

  async function handleRetryVazios() {
    setRetrying(true)
    setRetryError(null)
    try {
      await retryBaplieVazios({ voyageId, actorId })
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Falha ao recadastrar os vazios de importação.')
      setRetrying(false)
      return
    }
    try {
      await onVaziosRetried()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <ImportNotice tone={hasBapliePendency(result) ? 'warning' : 'success'} role={hasBapliePendency(result) ? 'alert' : 'status'} title={pendencyTitle(result)}>
      <p>{baplieImportToast(result)}</p>
      {result.flagsError ? (
        <>
          {result.vaziosError ? <p>IMO/OOG não foram aplicados aos B/Ls:</p> : null}
          <p>{result.flagsError}</p>
          <p>A pendência continua em Baplie EDI desta viagem, com "Aplicar IMO/OOG agora", depois de fechar este aviso. Importar o mesmo arquivo de novo também refaz a aplicação.</p>
        </>
      ) : null}
      {result.vaziosError ? (
        <>
          {result.flagsError ? <p>Os vazios de importação não foram recadastrados:</p> : null}
          <p>{retryError ?? result.vaziosError}</p>
          <p>
            Importar o mesmo arquivo não refaz os vazios. Recadastre-os a partir do Baplie já gravado. Se fechar este
            aviso, a pendência continua em Baplie EDI desta viagem, com "Atualizar vazios do Baplie".
          </p>
          <Button variant="secondary" className="app-btn--sm" loading={retrying} loadingLabel="Recadastrando…" onClick={() => void handleRetryVazios()}>
            Recadastrar vazios
          </Button>
        </>
      ) : null}
    </ImportNotice>
  )
}
