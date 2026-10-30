import { useCallback, useState, type FormEvent } from 'react'
import { Search } from 'lucide-react'
import { PublicEmbedLayout } from '../components/public/PublicEmbedLayout'
import { TurnstileChallenge } from '../components/security/TurnstileChallenge'
import { Block, Fact, FactList, LeadValue } from '../components/ui/Block'
import { Button } from '../components/ui/Button'
import { InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { NoValue } from '../components/ui/NoValue'
import { parsePublicContainerNumber } from '../lib/containerNumber'
import { formatBrasiliaDateTime } from '../lib/dates'
import { PUBLIC_LOOKUP_PORTS } from '../services/publicLookupPorts'
import { formatScheduleDate } from '../services/portalScheduleLanes'
import {
  PublicRequestError,
  lookupPublicContainer,
  publicTurnstileSiteKey,
  type PublicContainerSituation,
  type PublicFailure,
  type PublicLookupResult,
} from '../services/publicFwlog'

const PORTS = PUBLIC_LOOKUP_PORTS.map((port) => port.name).join(', ').replace(/, ([^,]*)$/, ' e $1')

const NUMBER_HINT = '4 letras e 7 algarismos, como está na porta do container (ex.: ABCU1234567).'
const INVALID_NUMBER = 'Confira o número: 4 letras e 7 algarismos, com o último algarismo (dígito verificador) correto.'
const COVERAGE = `Containers de ${PORTS}: descarregados ou previstos nos últimos 90 dias e os que ainda não foram devolvidos.`
const NOT_FOUND = `Não encontramos este container. ${COVERAGE} Confira o número ou fale com a Fwlog.`

const FAILURE_MESSAGE: Record<PublicFailure, string> = {
  challenge: 'A verificação de segurança não foi aceita. Faça a verificação de novo e consulte.',
  limit: 'Muitas consultas seguidas. Aguarde alguns minutos e tente de novo.',
  unavailable: 'Consulta indisponível no momento. Tente mais tarde.',
}

const SITUATION: Record<PublicContainerSituation, { label: string; tone: 'default' | 'warning' | 'danger' | 'muted' }> = {
  aguardando_descarga: { label: 'Aguardando descarga', tone: 'muted' },
  no_prazo: { label: 'Dentro do free time', tone: 'default' },
  prazo_vencido: { label: 'Free time vencido', tone: 'danger' },
  prazo_a_confirmar: { label: 'Free time a confirmar com a Fwlog', tone: 'warning' },
  devolvido: { label: 'Devolvido', tone: 'muted' },
}

function portName(code: string | null) {
  return PUBLIC_LOOKUP_PORTS.find((port) => port.code === code)?.name ?? code
}

function date(value: string | null) {
  return value ? formatScheduleDate(value) : <NoValue label="Sem data" />
}

/**
 * Consulta de container pública, em iframe no fwlog.com.br (ADR 0112), para as
 * transportadoras do Cliente: só o número, uma verificação do Turnstile por
 * consulta e, na resposta, só os campos da lista positiva. "Não encontrado" é
 * uma mensagem só, qualquer que seja o motivo.
 */
export function PublicConsultaContainer() {
  const siteKey = publicTurnstileSiteKey()
  const [number, setNumber] = useState('')
  const [token, setToken] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const [fieldError, setFieldError] = useState('')
  const [challengeError, setChallengeError] = useState('')
  const [failure, setFailure] = useState<PublicFailure | null>(siteKey ? null : 'unavailable')
  const [result, setResult] = useState<PublicLookupResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const handleToken = useCallback((value: string) => setToken(value), [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFieldError('')
    const normalized = parsePublicContainerNumber(number)
    if (!normalized) {
      setFieldError(INVALID_NUMBER)
      return
    }
    if (!siteKey) return
    if (!token) {
      setFieldError(challengeError || 'Faça a verificação de segurança antes de consultar.')
      // Verificação que falhou: pede outra, sem recarregar a página.
      if (challengeError) {
        setChallengeError('')
        setResetKey((current) => current + 1)
      }
      return
    }
    setSubmitting(true)
    setResult(null)
    try {
      setResult(await lookupPublicContainer(normalized, token))
      setFailure(null)
    } catch (error) {
      setFailure(error instanceof PublicRequestError ? error.reason : 'unavailable')
    } finally {
      // O token vale uma consulta.
      setToken('')
      setResetKey((current) => current + 1)
      setSubmitting(false)
    }
  }

  return (
    <PublicEmbedLayout>
      <Block title="Consulta de container">
        <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
          <Field label="Número do container" hint={NUMBER_HINT} error={fieldError || undefined}>
            <Input
              value={number}
              onChange={(event) => setNumber(event.target.value.toUpperCase())}
              maxLength={20}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              placeholder="ABCU1234567"
            />
          </Field>
          {siteKey ? (
            <TurnstileChallenge siteKey={siteKey} action="lookup" resetKey={resetKey} onToken={handleToken} onError={setChallengeError} />
          ) : null}
          <div>
            <Button type="submit" loading={submitting} loadingLabel="Consultando" disabled={!siteKey}>
              <Search size={14} aria-hidden="true" />
              Consultar
            </Button>
          </div>
          <p className="app-schedule-legend">
            {COVERAGE} Para outros portos ou períodos, fale com a Fwlog.
          </p>
        </form>
      </Block>

      {failure ? <InlineError message={FAILURE_MESSAGE[failure]} /> : null}

      <div aria-live="polite">
        {result && !result.found ? (
          <Block title="Resultado">
            <p>{NOT_FOUND}</p>
          </Block>
        ) : null}
        {result?.found ? <ContainerResult result={result} /> : null}
      </div>
    </PublicEmbedLayout>
  )
}

function ContainerResult({ result }: { result: Extract<PublicLookupResult, { found: true }> }) {
  const { container } = result
  const situation = SITUATION[container.situation]
  return (
    <Block title={`Container ${container.number}`} aside={<span>Consultado em {formatBrasiliaDateTime(result.consultedAt)} (horário de Brasília)</span>}>
      <LeadValue tone={situation.tone}>{situation.label}</LeadValue>
      <FactList columns={3}>
        <Fact label="Tipo">{container.type ?? <NoValue label="Sem tipo" />}</Fact>
        <Fact label="Navio">{container.vessel_name ?? <NoValue label="Sem navio" />}</Fact>
        <Fact label="Viagem">{container.voyage ?? <NoValue label="Sem viagem" />}</Fact>
        <Fact label="Porto de descarga">{portName(container.discharge_port) ?? <NoValue label="Sem porto" />}</Fact>
        <Fact label="Descarga">{date(container.discharge_date)}</Fact>
        <Fact label="Free time">{container.free_time_days === null ? <NoValue label="A confirmar" /> : `${container.free_time_days} dias`}</Fact>
        <Fact label="Data limite de devolução">{date(container.free_time_until)}</Fact>
        <Fact label="Devolução">{date(container.return_date)}</Fact>
      </FactList>
    </Block>
  )
}
