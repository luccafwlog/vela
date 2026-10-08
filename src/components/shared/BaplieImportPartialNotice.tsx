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
 * Cada pendência tem o seu caminho: IMO/OOG voltam ao importar o mesmo arquivo
 * (aceito direto, sem diferença); os vazios não, porque sem diferença eles não
 * são tocados — por isso o recadastro é refeito aqui mesmo. Quem abre o modal
 * guarda o resultado: depois do recadastro, `onVaziosRetried` o atualiza para que
 * título, resumo e rodapé deixem de citar os vazios.
 */
export function BaplieImportPartialNotice({
  result,
  voyageId,
  actorId,
  onVaziosRetried,
}: {
  result: BaplieImportDone
  voyageId: number
  actorId: string
  onVaziosRetried: () => Promise<void>
}) {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

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
    setRetrying(false)
    await onVaziosRetried()
  }

  return (
    <ImportNotice tone={hasBapliePendency(result) ? 'warning' : 'success'} role={hasBapliePendency(result) ? 'alert' : 'status'} title={pendencyTitle(result)}>
      <p>{baplieImportToast(result)}</p>
      {result.flagsError ? (
        <>
          {result.vaziosError ? <p>IMO/OOG não foram aplicados aos B/Ls:</p> : null}
          <p>{result.flagsError}</p>
          <p>Para tentar de novo, importe o mesmo arquivo: sem diferença, ele é aceito direto e a aplicação é refeita.</p>
        </>
      ) : null}
      {result.vaziosError ? (
        <>
          {result.flagsError ? <p>Os vazios de importação não foram recadastrados:</p> : null}
          <p>{retryError ?? result.vaziosError}</p>
          <p>Importar o mesmo arquivo não refaz os vazios. Recadastre-os a partir do Baplie já gravado:</p>
          <Button variant="secondary" className="app-btn--sm" loading={retrying} loadingLabel="Recadastrando…" onClick={() => void handleRetryVazios()}>
            Recadastrar vazios
          </Button>
        </>
      ) : null}
    </ImportNotice>
  )
}
