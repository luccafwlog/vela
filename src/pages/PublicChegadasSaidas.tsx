import { useCallback, useState } from 'react'
import { PublicEmbedLayout } from '../components/public/PublicEmbedLayout'
import { ScheduleWidthPage, ShipScheduleBlock } from '../components/portal/ShipScheduleView'
import { TurnstileChallenge } from '../components/security/TurnstileChallenge'
import { InlineError } from '../components/ui/Card'
import { PublicRequestError, fetchPublicSchedule, publicTurnstileSiteKey, type PublicFailure, type PublicSchedule } from '../services/publicFwlog'

const FAILURE_MESSAGE: Record<PublicFailure, string> = {
  challenge: 'A verificação de segurança não foi aceita. Tente atualizar de novo.',
  limit: 'Muitas atualizações seguidas. Aguarde alguns minutos e tente de novo.',
  unavailable: 'Chegadas e saídas indisponível no momento. Tente mais tarde.',
}

/**
 * Quadro "Chegadas e saídas" público, em iframe no fwlog.com.br (ADR 0112):
 * o mesmo bloco do Painel do Portal, sem "Meus B/Ls" e sem sessão. Cada
 * leitura (abrir e Atualizar) passa por uma verificação do Turnstile; a Edge
 * devolve a mesma resposta em cache para todos.
 */
export function PublicChegadasSaidas() {
  const siteKey = publicTurnstileSiteKey()
  // Cada rodada é um desafio novo; o token vale uma leitura.
  const [round, setRound] = useState(0)
  const [schedule, setSchedule] = useState<PublicSchedule | null>(null)
  const [failure, setFailure] = useState<PublicFailure | null>(siteKey ? null : 'unavailable')
  const [loading, setLoading] = useState(Boolean(siteKey))
  const [refreshing, setRefreshing] = useState(false)
  const [challengeError, setChallengeError] = useState('')

  const handleToken = useCallback((token: string) => {
    if (!token) return
    void fetchPublicSchedule(token)
      .then((result) => {
        setSchedule(result)
        setFailure(null)
      })
      .catch((error: unknown) => setFailure(error instanceof PublicRequestError ? error.reason : 'unavailable'))
      .finally(() => {
        setLoading(false)
        setRefreshing(false)
      })
  }, [])

  function reload() {
    setRefreshing(true)
    setChallengeError('')
    setRound((current) => current + 1)
  }

  return (
    <PublicEmbedLayout>
      <ScheduleWidthPage>
        <ShipScheduleBlock
          vessels={schedule?.vessels}
          isLoading={loading}
          isError={failure !== null}
          isFetching={refreshing}
          dataUpdatedAt={schedule?.updatedAt ?? 0}
          refreshing={refreshing}
          onRefresh={reload}
          onRetry={reload}
          refreshBlockedLabel={siteKey ? undefined : FAILURE_MESSAGE.unavailable}
        />
        {failure ? <InlineError message={FAILURE_MESSAGE[failure]} /> : null}
        {challengeError ? <InlineError message={challengeError} /> : null}
        {siteKey ? (
          <TurnstileChallenge siteKey={siteKey} action="schedule" resetKey={round} onToken={handleToken} onError={setChallengeError} />
        ) : null}
      </ScheduleWidthPage>
    </PublicEmbedLayout>
  )
}
