import { formatCnpjCpf, formatDateTime } from '../lib/utils'
import { Fragment, useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CoverageDrilldown } from '../components/customers/CoverageDrilldown'
import { formatBrasiliaTime, nextAutoRunnerRun, queuedLabel } from '../lib/communicationAutoRunner'
import { AlertTriangle, Building2, CheckCircle2, ChevronDown, ChevronRight, Eye, History, Info, Paperclip, Pencil, RotateCcw, Send, Ship, Users } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { RowActionButton } from '../components/ui/RowActionButton'
import { InlineError, PageHeader } from '../components/ui/Card'
import { Block, Fact, FactList, LeadValue } from '../components/ui/Block'
import { Switch } from '../components/ui/Switch'
import { ClientesTabs } from '../components/customers/ClientesTabs'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { CopyValue } from '../components/ui/CopyValue'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { NoValue } from '../components/ui/NoValue'
import { StatusText } from '../components/ui/StatusText'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useAppSettings, useSetCommunicationsEnabled } from '../hooks/useAppSettings'
import { useAuth } from '../hooks/useAuth'
import { useVoyageOptions } from '../hooks/useBls'
import { useCustomerCommunicationConference, useCustomerCommunicationHistory, useCustomerCommunicationSavedTemplates, useDispatchCustomerCommunicationBatch, useResendCeMercanteTaxasCommunication, useSaveCustomerCommunicationSavedTemplate, useVoyageCommunicationCoverage } from '../hooks/useCustomerCommunications'
import {
  DEFAULT_CUSTOMER_COMMUNICATION_FILTERS,
  communicationPortCode,
  MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE,
  getCustomerCommunicationAudienceRule,
  getCustomerCommunicationDispatchMode,
  getCustomerCommunicationNature,
  getDefaultCustomerCommunicationKind,
  isUserWrittenCustomerCommunicationKind,
  makeCustomerCommunicationRenderInput,
  requiresResendConfirmation,
  validateCustomerCommunicationFilters,
  fetchCustomerCommunicationConference,
  fetchCustomerCommunicationHistory,
  type CustomerCommunicationConferenceRow,
  type CustomerCommunicationConference,
  type CustomerCommunicationBlCandidate,
  type CustomerCommunicationDispatchMode,
  type CustomerCommunicationFilters,
  type CustomerCommunicationHistoryItem,
} from '../services/customerCommunications'
import {
  mergeCustomerCommunicationBatchRetry,
  summarizeCustomerCommunicationBatch,
  type CustomerCommunicationBatchItem,
  type CustomerCommunicationBatchOutcome,
} from '../services/customerCommunicationDispatches'
import type { CeMercanteCommunicationDispatchSummary } from '../services/customerFinanceCommunications'
import {
  CUSTOMER_COMMUNICATION_BOXES,
  type CommunicationBoxCode,
  type CustomerCommunicationAudience,
} from '../services/customerCommunicationBoxes'
import {
  CUSTOMER_COMMUNICATION_KINDS,
  assertValidCommunicationAttachments,
  renderCustomerCommunicationTemplate,
  type CommunicationAttachment,
  type CustomerCommunicationKind,
  type CustomerCommunicationTemplateInput,
} from '../services/customerCommunicationTemplates'
import {
  customerCommunicationAttemptReason,
  customerCommunicationAttemptStatusLabel,
  customerCommunicationKindLabel,
  customerCommunicationStatusLabel,
  isFailedCustomerCommunicationAttempt,
} from '../services/customerCommunications'

type CommunicationTab = 'cobertura' | 'disparo' | 'historico'

/**
 * O título de cada modelo vem de `customerCommunicationKindLabel`, e não de uma
 * cópia local: o histórico, a faixa-resumo e esta lista precisam dizer o mesmo
 * nome do Comunicado. A dica é o que só a tela de composição explica — quando o
 * texto sai sozinho, ou quem escreve o texto.
 */
const KIND_OPTIONS: Array<{ value: CustomerCommunicationKind; title: string; hint: string }> = [
  { value: 'aviso_chegada_noa', title: customerCommunicationKindLabel('aviso_chegada_noa'), hint: 'Texto fixo, enviado 5 dias antes do ETA da escala.' },
  { value: 'aviso_prontidao_nor', title: customerCommunicationKindLabel('aviso_prontidao_nor'), hint: 'Texto fixo, enviado quando o ATA da escala é registrado.' },
  { value: 'aviso_atracacao_nob', title: customerCommunicationKindLabel('aviso_atracacao_nob'), hint: 'Texto fixo, enviado quando o ATB da atracação é registrado.' },
  { value: 'livre', title: customerCommunicationKindLabel('livre'), hint: 'Você escreve assunto e mensagem, para os clientes da viagem.' },
  { value: 'institucional', title: customerCommunicationKindLabel('institucional'), hint: 'Você escreve assunto e mensagem, sem vínculo com carga.' },
]

const MODE_OPTIONS: Array<{ value: CustomerCommunicationDispatchMode; title: string; hint: string }> = [
  { value: 'carga', title: 'Carga', hint: 'Clientes dos B/Ls de uma viagem' },
  { value: 'institucional', title: 'Institucional', hint: 'Cliente com contato e B/L com ETA nos últimos 12 meses' },
]

function kindOptionsForMode(mode: CustomerCommunicationDispatchMode) {
  const allowed = MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE[mode]
  return KIND_OPTIONS.filter((option) => allowed.includes(option.value))
}

function audienceLabel(audience: CustomerCommunicationAudience): string {
  if (audience.mode === 'todos') return 'Todos os contatos'
  return CUSTOMER_COMMUNICATION_BOXES.find((box) => box.code === audience.boxCode)?.label ?? audience.boxCode
}

/**
 * Descreve o recorte da carga em português, listando só os filtros informados.
 * Sem recorte operacional a frase diz o que falta em vez de mentir um alcance: no
 * modo carga, filtro vazio nunca significa todos os clientes.
 *
 * O CNPJ não conta como recorte completo porque
 * `validateCustomerCommunicationFilters` não o aceita sozinho — ele restringe um
 * universo, não o define. Uma frase que se declarasse pronta só com o CNPJ
 * contradiria o botão "Conferir destinatários", que continuaria desabilitado.
 */
function describeCargoScope(filters: CustomerCommunicationFilters): React.ReactNode {
  const partes: React.ReactNode[] = []
  if (filters.vesselVoyage.trim()) partes.push(<>com carga em <strong key="nv" className="font-bold">{filters.vesselVoyage.trim()}</strong></>)
  if (filters.pol.trim()) partes.push(<>embarcada em <strong key="pol" className="font-bold">{filters.pol.trim()}</strong></>)
  if (filters.pod.trim()) partes.push(<>destinada a <strong key="pod" className="font-bold">{filters.pod.trim()}</strong></>)
  if (!partes.length) {
    const cnpj = filters.cnpj.trim()
    return (
      <span className="text-[var(--app-gold-strong)]">
        {cnpj ? <>do CNPJ <strong className="font-bold">{cnpj}</strong> — </> : '— '}
        informe navio/viagem, POL ou POD
      </span>
    )
  }
  if (filters.cnpj.trim()) partes.push(<>do CNPJ <strong key="cnpj" className="font-bold">{filters.cnpj.trim()}</strong></>)
  return partes.map((parte, index) => <span key={index}>{index ? ', ' : ''}{parte}</span>)
}

/** Status do Histórico, na ordem do filtro; "Em envio" é o `pendente` da migration 302. */
const HISTORY_STATUS_OPTIONS = ['pendente', 'enviado', 'simulado', 'parcial', 'falha'] as const

/**
 * Identidade da conferência na tela: Clientes, destinatários, B/Ls e discriminadores.
 * Enquanto ela não muda, a seleção, o `dispatchId` e o resultado do lote valem —
 * mesmo que a consulta devolva outro objeto (plano dos e-mails, 3.2).
 */
function conferenceSignature(conference: CustomerCommunicationConference | undefined): string | undefined {
  if (!conference) return undefined
  return JSON.stringify([
    conference.kind,
    conference.mode,
    // B/L cancelado ou novo depois de conferir muda o que o e-mail leva.
    conference.rows.map((row) => [row.key, row.recipientSnapshot ?? '', row.nextAttemptDiscriminator, row.blocked, row.bls.map((bl) => bl.id)]),
  ])
}

/** Situação do Comunicado em texto (regra 5): falha em vermelho, parcial e pendente em âmbar. */
function historyStatusTone(status: string) {
  if (status === 'falha') return 'danger' as const
  if (status === 'parcial' || status === 'pendente') return 'warning' as const
  return 'default' as const
}

/**
 * Aviso do Histórico aberto pelo link de um Comunicado, montado pelo próprio
 * Comunicado do link: sem viagem (institucional, Cobrança de Demurrage agrupada)
 * a lista traz todos os Comunicados do Cliente, e com outro filtro da tela ele
 * pode nem estar na lista.
 */
function linkedCommunicationNotice(items: CustomerCommunicationHistoryItem[] | undefined, linkedId: number, filtered: boolean): string {
  if (!items) return 'Comunicado do link.'
  const linked = items.find((item) => item.id === linkedId)
  // Lista vazia com filtro da tela: o filtro esconde o Comunicado, que existe.
  if (!linked) return filtered || items.length ? 'O Comunicado do link não aparece na lista com os filtros atuais.' : 'Comunicado não encontrado.'
  const customer = linked.customer?.name ?? 'Cliente'
  if (linked.anchor_voyage_id == null) return `O Comunicado do link não tem viagem: a lista mostra todos os Comunicados de ${customer}; o do link está aberto.`
  const voyage = [linked.vessel_name, linked.voyage_number].filter(Boolean).join(' / ')
  return `Todos os Comunicados de ${customer} ${voyage ? `na viagem ${voyage}` : 'na mesma viagem'}; o do link está aberto.`
}

/** "0 de 3", âmbar enquanto falta enviar; "—" quando nada é devido (lote 5a). */
function CoverageCount({ sent, total, queued = 0, now }: { sent: number; total: number; queued?: number; now: Date }) {
  if (total === 0) return <NoValue label="Nada devido" />
  return (
    <span className="inline-flex flex-col">
      <StatusText tone={sent < total ? 'warning' : 'default'}>{sent} de {total}</StatusText>
      <QueuedNote queued={queued} now={now} />
    </span>
  )
}

/** "1 na fila · 16:07": a próxima rodada automática envia (migration 345). */
function QueuedNote({ queued, now }: { queued: number; now: Date }) {
  if (queued <= 0) return null
  return <span className="text-xs text-[var(--app-muted)]" title={queuedLabel(now)}>{queued} na fila · {formatBrasiliaTime(nextAutoRunnerRun(now))}</span>
}

/** CE e Taxas: enviados em dia de devidos, e quem precisa de reenvio. */
function FinanceCoverageCount({ sent, due, resend, queued, now }: { sent: number; due: number; resend: number; queued: number; now: Date }) {
  if (due === 0) return <NoValue label="Nada devido" />
  return (
    <span className="inline-flex flex-col">
      <StatusText tone={sent < due ? 'warning' : 'default'}>{sent} de {due}</StatusText>
      {resend > 0 ? <span className="text-xs text-[var(--app-muted)]">{resend === 1 ? '1 reenvio pendente' : `${resend} reenvios pendentes`}</span> : null}
      <QueuedNote queued={queued} now={now} />
    </span>
  )
}

function plural(count: number, singular: string, pluralWord: string) {
  return `${count} ${count === 1 ? singular : pluralWord}`
}

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    }
    return btoa(binary)
  })
}

const SAMPLE_COMMUNICATION_CANDIDATES: CustomerCommunicationBlCandidate[] = [
  {
    id: 'CSC45360805C00',
    customerId: 1,
    customerName: 'ACME LOGÍSTICA & IMPORTAÇÃO LTDA',
    customerCnpj: '99.999.999/0001-99',
    voyageId: 1,
    vesselName: 'COSCO SHIPPING XING WANG',
    voyageNumber: '2401E',
    pod: 'Santos (BRSSZ)',
    pol: 'Shanghai (CNSHA)',
    cargoMode: 'container',
    eta: new Date().toISOString(),
    ata: null,
    terminalId: null,
    terminalName: 'BTP Santos',
    terminalStateId: null,
    milestoneAt: new Date().toISOString(),
  },
  {
    id: 'CSC45360805D00',
    customerId: 1,
    customerName: 'ACME LOGÍSTICA & IMPORTAÇÃO LTDA',
    customerCnpj: '99.999.999/0001-99',
    voyageId: 1,
    vesselName: 'COSCO SHIPPING XING WANG',
    voyageNumber: '2401E',
    pod: 'Santos (BRSSZ)',
    pol: 'Shanghai (CNSHA)',
    cargoMode: 'container',
    eta: new Date().toISOString(),
    ata: null,
    terminalId: null,
    terminalName: 'BTP Santos',
    terminalStateId: null,
    milestoneAt: new Date().toISOString(),
  },
]

function getSamplePreviewInput(subject: string, body: string, kind: CustomerCommunicationKind): CustomerCommunicationTemplateInput {
  return {
    ...makeCustomerCommunicationRenderInput(
      SAMPLE_COMMUNICATION_CANDIDATES[0],
      SAMPLE_COMMUNICATION_CANDIDATES,
      kind === 'institucional',
    ),
    subject: subject.trim() || undefined,
    body: body.trim() || undefined,
  }
}

export function ClientesComunicacao() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [kind, setKind] = useState<CustomerCommunicationKind>('aviso_chegada_noa')
  // `filters.mode` nunca é lido: o modo do disparo é sempre derivado do modelo em
  // `dispatchFilters`, para Modo e Modelo não poderem apontar para universos diferentes.
  const [filters, setFilters] = useState<CustomerCommunicationFilters>(DEFAULT_CUSTOMER_COMMUNICATION_FILTERS)
  const [conferenceRequested, setConferenceRequested] = useState(false)
  const [selectionState, setSelectionState] = useState<{ scope: string | undefined; keys: Set<string> }>({ scope: undefined, keys: new Set() })
  const [institutionalSubject, setInstitutionalSubject] = useState('')
  const [institutionalBody, setInstitutionalBody] = useState('')
  const [resendConfirmationScope, setResendConfirmationScope] = useState<string | undefined>(undefined)
  // Um `dispatchId` por conferência e texto: repetir o disparo cai no mesmo
  // Comunicado em vez de criar outro (plano dos e-mails, 3.2).
  const [dispatchIdState, setDispatchIdState] = useState<{ scope: string; id: string } | null>(null)
  const [batchState, setBatchState] = useState<{ scope: string; outcomes: CustomerCommunicationBatchOutcome[]; attachmentCustomers: number } | null>(null)
  const [ceResendResults, setCeResendResults] = useState<Record<string, { summary?: CeMercanteCommunicationDispatchSummary; error?: string }>>({})
  const [attachments, setAttachments] = useState<Array<CommunicationAttachment & { contentBase64: string }>>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null)
  const [dispatchError, setDispatchError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [customPreviewRow, setCustomPreviewRow] = useState<CustomerCommunicationConferenceRow | null>(null)
  const { data: voyageOptions } = useVoyageOptions()
  const vesselVoyageSuggestions = useMemo(
    () => [...new Set((voyageOptions ?? []).map((voyage) => [voyage.vessel?.name, voyage.voyage_number].filter(Boolean).join(' / ')).filter(Boolean))],
    [voyageOptions],
  )
  const [coverageFilters, setCoverageFilters] = useState({ vessel: '', voyage: '', month: '' })
  // `?kind=` vem do link do alerta de reenvio do CE; só um modelo conhecido vira filtro.
  const [historyFilters, setHistoryFilters] = useState(() => {
    const kindParam = searchParams.get('kind') ?? ''
    return { vessel: '', month: '', kind: (CUSTOMER_COMMUNICATION_KINDS as readonly string[]).includes(kindParam) ? kindParam : '', status: '', origin: '' }
  })
  // Só o Comunicado livre deixa o operador escolher o público; os demais modelos
  // recebem o público imposto por `getCustomerCommunicationAudienceRule`.
  const historyFiltered = Object.values(historyFilters).some(Boolean)
  const [freeAudience, setFreeAudience] = useState<CustomerCommunicationAudience>({ mode: 'todos' })
  const { data: settings, isLoading: settingsLoading, error: settingsError, refetch: refetchSettings } = useAppSettings()
  const { effectiveRole, isAdmin, can } = useAuth()
  // Consultar cobertura e histórico é de todos; enviar é de Administrativo,
  // Documentação e Equipamentos (ADR 0085, D19).
  const canSend = can('customer_communications')
  const confirm = useConfirm()
  const canToggleCommunications = effectiveRole === 'administrativo' || isAdmin
  const setCommunicationsMutation = useSetCommunicationsEnabled()

  const dispatchMode = getCustomerCommunicationDispatchMode(kind)
  const nature = getCustomerCommunicationNature(kind)
  const audienceRule = getCustomerCommunicationAudienceRule(kind)
  const audience = audienceRule.editable ? freeAudience : audienceRule.audience
  const userWritten = isUserWrittenCustomerCommunicationKind(kind)
  const availableKindOptions = kindOptionsForMode(dispatchMode)
  const activeModeOption = MODE_OPTIONS.find((option) => option.value === dispatchMode)
  const singleKindMode = availableKindOptions.length === 1
  const dispatchFilters: CustomerCommunicationFilters = { ...filters, mode: dispatchMode }
  const filterValidation = validateCustomerCommunicationFilters(dispatchFilters)
  const messageMissing = userWritten && (!institutionalSubject.trim() || !institutionalBody.trim())

  const conferenceQuery = useCustomerCommunicationConference({ filters: dispatchFilters, kind, nature, audience, enabled: conferenceRequested })
  const customerHistoryId = Number(searchParams.get('customer'))
  const historyCustomerId = Number.isInteger(customerHistoryId) && customerHistoryId > 0 ? customerHistoryId : undefined
  const historyCommunicationId = Number(searchParams.get('communication'))
  // Linhas abertas do Histórico; o Comunicado pedido pelo endereço já abre aberto.
  const [openHistory, setOpenHistory] = useState<ReadonlySet<number>>(() => new Set(historyCommunicationId > 0 ? [historyCommunicationId] : []))
  // O link "Enviado em" da Cobertura troca o endereço sem remontar a tela: o
  // Comunicado novo do link também abre. Compara o texto do parâmetro (o número
  // de um parâmetro inválido é NaN, sempre diferente de si).
  const communicationParam = searchParams.get('communication')
  const [seenCommunicationParam, setSeenCommunicationParam] = useState(communicationParam)
  if (seenCommunicationParam !== communicationParam) {
    setSeenCommunicationParam(communicationParam)
    if (historyCommunicationId > 0) setOpenHistory((current) => new Set(current).add(historyCommunicationId))
  }
  function toggleHistory(id: number) {
    setOpenHistory((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const historyBlId = searchParams.get('bl')?.trim() || undefined
  const tab: CommunicationTab = searchParams.get('tab') === 'historico' ? 'historico' : searchParams.get('tab') === 'disparo' && canSend ? 'disparo' : 'cobertura'
  const historyQuery = useCustomerCommunicationHistory(
    { id: Number.isInteger(historyCommunicationId) && historyCommunicationId > 0 ? historyCommunicationId : undefined, customerId: historyCustomerId, blId: historyBlId, ...historyFilters },
    { enabled: tab === 'historico' },
  )
  // A Cobertura consulta a prontidão de cada Cliente × Viagem: só na aba dela (3.7).
  const coverageQuery = useVoyageCommunicationCoverage(coverageFilters, { enabled: tab === 'cobertura' })
  const [expandedCoverageRow, setExpandedCoverageRow] = useState<string | null>(null)
  // A próxima rodada é calculada no momento da leitura; a releitura depois da
  // rodada (useVoyageCommunicationCoverage) atualiza os dois juntos.
  const coverageNow = useMemo(() => new Date(coverageQuery.dataUpdatedAt || Date.now()), [coverageQuery.dataUpdatedAt])
  const savedTemplatesQuery = useCustomerCommunicationSavedTemplates()
  const saveTemplateMutation = useSaveCustomerCommunicationSavedTemplate()
  const batchMutation = useDispatchCustomerCommunicationBatch()
  const ceResendMutation = useResendCeMercanteTaxasCommunication()
  const conference = conferenceQuery.data
  const signature = useMemo(() => conferenceSignature(conference), [conference])
  const historyFailures = (historyQuery.data ?? []).filter((item) => item.status === 'falha').length

  const defaultSelectedKeys = useMemo(
    () => new Set((conference?.rows ?? []).filter((row) => row.selected).map((row) => row.key)),
    [conference],
  )
  const selectedKeys = selectionState.scope !== undefined && selectionState.scope === signature ? selectionState.keys : defaultSelectedKeys
  const resendConfirmed = resendConfirmationScope !== undefined && resendConfirmationScope === signature
  const batch = batchState && batchState.scope === signature ? batchState : null
  const batchSummary = batch ? summarizeCustomerCommunicationBatch(batch.outcomes) : null

  const selectedRows = useMemo(
    () => (conference?.rows ?? []).filter((row) => selectedKeys.has(row.key) && !row.blocked),
    [conference?.rows, selectedKeys],
  )
  // Institucional e livre ganham `dispatch_id` novo a cada conferência e texto: um
  // envio anterior não é reenvio do mesmo Comunicado, então vira informação e não
  // trava. O livre conta só os envios da mesma Viagem (`previousDispatchCount`).
  const resendGateApplies = requiresResendConfirmation(kind)
  const previousDispatches = (row: CustomerCommunicationConferenceRow) => (
    resendGateApplies ? row.nextAttemptDiscriminator : row.previousDispatchCount ?? 0
  )
  const previouslyContacted = selectedRows.filter((row) => previousDispatches(row) > 0).length
  const hasResend = resendGateApplies && previouslyContacted > 0
  const activePreviewRow = customPreviewRow ?? selectedRows[0] ?? conference?.rows.find((row) => !row.blocked) ?? conference?.rows[0] ?? null

  const activePreview = useMemo(() => {
    try {
      if (activePreviewRow) {
        const input = isUserWrittenCustomerCommunicationKind(kind)
          ? { ...activePreviewRow.renderInput, subject: institutionalSubject, body: institutionalBody }
          : activePreviewRow.renderInput
        return renderCustomerCommunicationTemplate(kind, input)
      }
      const sampleInput = getSamplePreviewInput(institutionalSubject, institutionalBody, kind)
      return renderCustomerCommunicationTemplate(kind, sampleInput)
    } catch {
      return null
    }
  }, [activePreviewRow, institutionalBody, institutionalSubject, kind])


  /**
   * A conferência é um estado de tela, não um efeito colateral do cache: sair dela
   * pelo "Editar composição" não muda a chave da query, então derivar a vista de
   * `conferenceQuery.data` deixaria a lista na tela depois de pedir para voltar.
   */
  const showConference = conferenceRequested && conference !== undefined
  const selectableKeys = useMemo(() => (conference?.rows ?? []).filter((row) => !row.blocked).map((row) => row.key), [conference])
  const blockedRows = useMemo(() => (conference?.rows ?? []).filter((row) => row.blocked), [conference])
  const selectedEmailCount = selectedRows.reduce((total, row) => total + row.eligibleRecipients.length, 0)
  const attachmentsSize = attachments.reduce((total, item) => total + item.size, 0)
  const dispatchBlockReason = !selectedRows.length
    ? 'Selecione ao menos um cliente elegível para liberar o disparo.'
    : messageMissing
      ? 'Escreva o assunto e a mensagem para liberar o disparo.'
      : hasResend && !resendConfirmed
        ? 'Marque a confirmação de reenvio para liberar o disparo.'
        : null

  /**
   * A frase que a coluna da direita mantém antes e depois de conferir. Ela existe
   * para responder "quem vai receber isto?" sem reler o formulário — por isso
   * nomeia o modelo, o público e o recorte, nessa ordem.
   */
  const dispatchSentence = ((): React.ReactNode => {
    const publico = <strong className="font-bold">{audienceLabel(audience)}</strong>
    if (dispatchMode === 'institucional') {
      return (
        <>
          Um <strong className="font-bold">comunicado institucional</strong> para {publico} de{' '}
          {filters.cnpj.trim()
            ? <>um único Cliente Comunicável, CNPJ <strong className="font-bold">{filters.cnpj.trim()}</strong></>
            : <strong className="font-bold">todos os Clientes Comunicáveis</strong>}.
        </>
      )
    }
    const modelo = userWritten
      ? <strong className="font-bold">Uma mensagem escrita por você</strong>
      : <strong className="font-bold">{customerCommunicationKindLabel(kind)}</strong>
    return (
      <>
        {modelo} para {audience.mode === 'caixa' ? <>a caixa {publico}</> : publico} dos clientes {describeCargoScope(filters)}.
      </>
    )
  })()

  function updateFilter<K extends keyof CustomerCommunicationFilters>(field: K, value: CustomerCommunicationFilters[K]) {
    setFilters((current) => ({ ...current, [field]: value }))
    setConferenceRequested(false)
    setDispatchMessage(null)
  }

  /**
   * Trocar o modelo nunca troca o modo escolhido pelo operador: o modo é derivado
   * do próprio modelo, e a lista de modelos já vem filtrada pelo modo corrente.
   */
  function handleKindChange(nextKind: CustomerCommunicationKind) {
    setKind(nextKind)
    setFreeAudience(getCustomerCommunicationAudienceRule(nextKind).audience)
    setConferenceRequested(false)
    setDispatchMessage(null)
    setDispatchError(null)
  }

  /** Trocar o modo escolhe o primeiro modelo válido do novo modo. */
  function handleModeChange(mode: CustomerCommunicationDispatchMode) {
    if (mode === dispatchMode) return
    handleKindChange(getDefaultCustomerCommunicationKind(mode))
  }

  function selectTab(nextTab: CommunicationTab) {
    const next = new URLSearchParams(searchParams)
    next.set('tab', nextTab)
    setSearchParams(next, { replace: true })
  }

  function applySavedTemplate(templateId: string) {
    const template = savedTemplatesQuery.data?.find((item) => String(item.id) === templateId)
    if (!template) return
    setInstitutionalSubject(template.subject)
    setInstitutionalBody(template.body)
    setDispatchMessage(null)
  }

  async function saveCurrentTemplate() {
    if (!templateName.trim() || !institutionalSubject.trim() || !institutionalBody.trim()) {
      setDispatchError('Informe nome, assunto e mensagem para salvar o modelo.')
      return
    }
    setDispatchError(null)
    try {
      await saveTemplateMutation.mutateAsync({ name: templateName, subject: institutionalSubject, body: institutionalBody })
      setTemplateName('')
      setDispatchMessage('Modelo institucional salvo com sucesso.')
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : 'Falha ao salvar o modelo.')
    }
  }

  /** Marcar todos / Desmarcar: a seleção em massa nunca alcança linha bloqueada. */
  function setSelection(keys: readonly string[]) {
    if (!conference) return
    setSelectionState({ scope: signature, keys: new Set(keys) })
    setDispatchMessage(null)
  }

  function toggleRow(key: string) {
    if (!conference) return
    setSelectionState((current) => {
      const next = current.scope !== undefined && current.scope === signature ? new Set(current.keys) : new Set(defaultSelectedKeys)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return { scope: signature, keys: next }
    })
    setDispatchMessage(null)
  }

  async function handleAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    setAttachmentError(null)
    if (!files.length) {
      setAttachments([])
      return
    }
    try {
      const encoded = await Promise.all(files.map(async (file) => ({
        filename: file.name,
        contentType: file.type,
        size: file.size,
        contentBase64: await fileToBase64(file),
      })))
      assertValidCommunicationAttachments(kind, encoded)
      setAttachments(encoded)
    } catch (error) {
      setAttachments([])
      setAttachmentError(error instanceof Error ? error.message : 'Anexos inválidos.')
    }
  }

  /**
   * Itens do lote: um por Cliente e destinatário, com o mesmo `dispatchId`
   * enquanto a conferência e o texto não mudam.
   */
  function buildBatchItems(dispatchId: string | null): CustomerCommunicationBatchItem[] {
    const items: CustomerCommunicationBatchItem[] = []
    for (const row of selectedRows) {
      const input = userWritten
        ? { ...row.renderInput, subject: institutionalSubject, body: institutionalBody }
        : row.renderInput
      const rendered = renderCustomerCommunicationTemplate(kind, input)
      for (const contact of row.eligibleRecipients) {
        const recipient = contact.email!.trim()
        items.push({
          key: `${row.key}::${recipient.toLowerCase()}`,
          customerName: row.customerName,
          input: {
            customerId: row.customerId,
            kind,
            nature,
            audience,
            recipient,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            messageBody: userWritten ? institutionalBody : undefined,
            blIds: row.bls.map((bl) => bl.id),
            // O livre é um por Cliente e Viagem (D15): a Viagem entra na
            // identidade, senão as duas viagens do Cliente cairiam no mesmo
            // Comunicado. O institucional não tem âncora.
            anchorVoyageId: kind === 'institucional' ? null : row.sourceBls[0]?.voyageId ?? null,
            // Porto normalizado, como a régua grava (BRVIT → BRVIX): uma
            // identidade só para o mesmo Comunicado.
            anchorPort: userWritten ? null : communicationPortCode(row.sourceBls[0]?.pod),
            anchorAtracacaoId: kind === 'aviso_atracacao_nob' ? row.sourceBls[0]?.terminalStateId ?? null : null,
            attemptDiscriminator: row.nextAttemptDiscriminator,
            dispatchId,
            vesselName: input.vesselName,
            voyageNumber: input.voyageNumber,
            terminalName: input.terminalName,
            attachments,
          },
        })
      }
    }
    return items
  }

  async function handleDispatch() {
    setDispatchError(null)
    setDispatchMessage(null)
    if (messageMissing) {
      setDispatchError('Informe o assunto e a mensagem antes de disparar.')
      return
    }
    if (!selectedRows.length) {
      setDispatchError('Selecione ao menos um cliente elegível.')
      return
    }
    if (hasResend && !resendConfirmed) {
      setDispatchError('Confirme o reenvio para clientes que já receberam este comunicado.')
      return
    }
    if (!activePreview || !signature) {
      setDispatchError('Não foi possível renderizar o comunicado selecionado.')
      return
    }
    if (typeof settings?.communications_enabled !== 'boolean') {
      setDispatchError('Não foi possível conferir a chave de envio. Tente novamente antes de disparar.')
      return
    }
    // D16 (ADR 0072): antes de sair, a confirmação diz se é envio real ou
    // simulação e quantos e-mails, para quantos Clientes.
    const real = settings.communications_enabled
    const customersCount = new Set(selectedRows.map((row) => row.customerId)).size
    const confirmed = await confirm({
      title: real ? 'Enviar de verdade' : 'Registrar em simulação',
      message: `${selectedEmailCount} destinatário(s) de ${customersCount} Cliente(s) recebem ${customerCommunicationKindLabel(kind)}.`,
      consequence: real
        ? 'A chave de envio está ligada: os e-mails saem agora aos Clientes, e cada envio fica no Histórico.'
        : 'A chave de envio está desligada: nenhum e-mail sai; cada destinatário fica registrado como simulado no Histórico.',
      reversibility: real ? 'E-mail enviado não pode ser desfeito.' : 'Nada chega ao Cliente.',
      confirmLabel: 'Confirmar',
      cancelLabel: 'Cancelar',
      tone: real ? 'danger' : 'primary',
    })
    if (!confirmed) return

    setSending(true)
    try {
      // Revalidar a lista de destinatários antes de disparar
      try {
        const freshConference = await fetchCustomerCommunicationConference({
          filters: dispatchFilters,
          kind,
          nature,
          audience,
        })
        const freshMap = new Map(freshConference.rows.map((r) => [r.key, r]))
        const snapshotMismatch = selectedRows.some((row) => {
          const freshRow = freshMap.get(row.key)
          return !freshRow || freshRow.recipientSnapshot !== row.recipientSnapshot
        })
        if (snapshotMismatch) {
          setResendConfirmationScope(undefined)
          setDispatchError('A lista de destinatários mudou. Confira novamente antes de enviar.')
          return
        }
        // Depois de um lote, a conferência na tela fica velha (o cache não a
        // relê): os discriminadores dela já foram usados. Disparar com eles
        // cairia nas mesmas tentativas e o resumo contaria "enviado" sem sair
        // e-mail. Qualquer diferença na conferência inteira recusa o disparo.
        if (conferenceSignature(freshConference) !== signature) {
          setResendConfirmationScope(undefined)
          setDispatchError('Há Comunicados novos desde a conferência. Confira de novo.')
          return
        }
      } catch {
        setDispatchError('Não foi possível atualizar a conferência. Tente novamente antes de disparar.')
        return
      }

      const dispatchScope = `${signature}::${institutionalSubject}::${institutionalBody}`
      let dispatchId: string | null = null
      if (userWritten) {
        dispatchId = dispatchIdState?.scope === dispatchScope ? dispatchIdState.id : crypto.randomUUID()
        setDispatchIdState({ scope: dispatchScope, id: dispatchId })
      }
      const items = buildBatchItems(dispatchId)
      const outcomes = await batchMutation.mutateAsync(items)
      const delivered = new Set(outcomes.filter((outcome) => outcome.result !== 'falha').map((outcome) => outcome.input.customerId))
      setBatchState({ scope: signature, outcomes, attachmentCustomers: attachments.length ? delivered.size : 0 })
      // 3.6: o anexo vale para este disparo; o próximo começa sem nenhum.
      if (attachments.length) setAttachments([])
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : 'Falha ao disparar os comunicados.')
    } finally {
      setSending(false)
    }
  }

  /** Lê a chave de envio no banco agora; null quando não dá para saber. */
  async function readCommunicationsEnabled(): Promise<boolean | null> {
    try {
      const { data } = await refetchSettings()
      return typeof data?.communications_enabled === 'boolean' ? data.communications_enabled : null
    } catch {
      return null
    }
  }

  /**
   * Repete só os destinatários que falharam, com os mesmos itens (mesmo
   * Comunicado). Recusa definitiva (contato inválido, endereço suprimido) fica
   * de fora: outra tentativa daria o mesmo resultado.
   */
  async function retryFailures() {
    if (!batch || !signature) return
    const failed = summarizeCustomerCommunicationBatch(batch.outcomes).retryable
    if (!failed.length) return
    // A chave pode ter mudado desde o lote: a Edge lê a atual, então a
    // repetição relê o modo e confirma de novo (D16).
    const real = await readCommunicationsEnabled()
    if (real === null) {
      setDispatchError('Não foi possível conferir a chave de envio. Tente novamente antes de repetir.')
      return
    }
    const confirmed = await confirm({
      title: real ? 'Repetir de verdade' : 'Repetir em simulação',
      message: `${failed.length} destinatário(s) de ${new Set(failed.map(({ input }) => input.customerId)).size} Cliente(s) recebem ${customerCommunicationKindLabel(kind)} de novo.`,
      consequence: real
        ? 'A chave de envio está ligada: os e-mails que falharam saem agora aos Clientes.'
        : 'A chave de envio está desligada: nenhum e-mail sai; cada destinatário fica registrado como simulado no Histórico.',
      reversibility: real ? 'E-mail enviado não pode ser desfeito.' : 'Nada chega ao Cliente.',
      confirmLabel: 'Confirmar',
      cancelLabel: 'Cancelar',
      tone: real ? 'danger' : 'primary',
    })
    if (!confirmed) return
    setDispatchError(null)
    setSending(true)
    try {
      const retried = await batchMutation.mutateAsync(failed.map(({ key, customerName, input }) => ({ key, customerName, input })))
      setBatchState({ ...batch, outcomes: mergeCustomerCommunicationBatchRetry(batch.outcomes, retried) })
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : 'Falha ao repetir os envios.')
    } finally {
      setSending(false)
    }
  }

  /** D5: o último CE e Taxas de cada Cliente × Viagem no Histórico pode ser reenviado. */
  async function resendCeMercante(item: CustomerCommunicationHistoryItem) {
    if (item.anchor_voyage_id == null) return
    const key = `${item.customer_id}:${item.anchor_voyage_id}`
    // Sem saber se a chave está ligada, a confirmação poderia prometer
    // simulação e a Edge mandar o e-mail de verdade: relê antes de confirmar.
    const real = await readCommunicationsEnabled()
    if (real === null) {
      setCeResendResults((current) => ({ ...current, [key]: { error: 'Não foi possível confirmar se o envio real está ligado. Recarregue a tela e tente de novo.' } }))
      return
    }
    // Com filtro de status, mês ou navio, o item da lista pode não ser o último
    // da trilha: o diálogo diz qual foi o último envio de fato.
    let latestNote = ''
    try {
      const [latest] = await fetchCustomerCommunicationHistory({ customerId: item.customer_id, voyageId: item.anchor_voyage_id, kind: 'ce_mercante_taxas' })
      if (latest && latest.id !== item.id) {
        latestNote = ` Há um envio mais recente desta viagem: ${customerCommunicationStatusLabel(latest.status)} em ${new Date(latest.created_at).toLocaleString('pt-BR')}.`
      }
    } catch {
      latestNote = ' Não foi possível conferir o último envio desta viagem.'
    }
    const confirmed = await confirm({
      title: 'Reenviar CE e Taxas',
      message: `Reenviar o Comunicado de CE e Taxas de ${item.customer?.name ?? `Cliente ${item.customer_id}`} na viagem ${[item.vessel_name, item.voyage_number].filter(Boolean).join(' / ') || item.anchor_voyage_id}, com o CE e os valores atuais?${latestNote}`,
      consequence: real
        ? 'A chave de envio está ligada: o e-mail sai agora para as caixas Documentação e Operação e Financeiro do Cliente. O envio fecha o alerta "Reenviar Comunicado de CE e Taxas" dos B/Ls.'
        : 'A chave de envio está desligada: o reenvio fica registrado como simulado e nenhum e-mail sai; o alerta "Reenviar Comunicado de CE e Taxas" só fecha com um envio real.',
      reversibility: real ? 'E-mail enviado não pode ser desfeito.' : 'Nada chega ao Cliente.',
      confirmLabel: 'Reenviar CE e Taxas',
      cancelLabel: 'Cancelar',
      tone: 'primary',
    })
    if (!confirmed) return
    try {
      const summary = await ceResendMutation.mutateAsync({ voyageId: item.anchor_voyage_id, customerId: item.customer_id })
      setCeResendResults((current) => ({ ...current, [key]: { summary } }))
    } catch (error) {
      setCeResendResults((current) => ({ ...current, [key]: { error: error instanceof Error ? error.message : 'Falha ao reenviar o CE e Taxas.' } }))
    }
  }

  // Só o Comunicado mais recente de cada Cliente × Viagem oferece o reenvio.
  const latestCeKeys = new Set<number>()
  {
    const seen = new Set<string>()
    for (const item of historyQuery.data ?? []) {
      if (item.kind !== 'ce_mercante_taxas' || item.anchor_voyage_id == null) continue
      const key = `${item.customer_id}:${item.anchor_voyage_id}`
      if (seen.has(key)) continue
      seen.add(key)
      latestCeKeys.add(item.id)
    }
  }

  return (
    <>
      <PageHeader
        title="Comunicação com Clientes"
      />
      <ClientesTabs active="comunicacao" />

      {/* Canal de envio (lote 5a): o estado como dado principal e a chave de
          ligar e desligar na faixa, só para quem pode trocar. A confirmação de
          hoje continua nos dois sentidos. */}
      <Block
        title="Canal de envio"
        className="mb-4"
        aside={canToggleCommunications && !settingsLoading && !settingsError ? (
          <Switch
            checked={settings?.communications_enabled === true}
            disabled={setCommunicationsMutation.isPending}
            onChange={(next) => {
              void (async () => {
                const confirmed = await confirm(next
                  ? {
                    title: 'Ativar envio real',
                    message: 'Confirma a ativação da chave global de envio? Os próximos disparos de comunicados e cobranças enviarão e-mails reais aos clientes.',
                    confirmLabel: 'Ativar envio real',
                    tone: 'danger',
                  }
                  : {
                    title: 'Desativar envio real',
                    message: 'Deseja desativar a chave global de envio e retornar ao modo de simulação?',
                    confirmLabel: 'Desativar envio real',
                    tone: 'danger',
                  })
                if (confirmed) await setCommunicationsMutation.mutateAsync(next)
              })()
            }}
          >
            {settings?.communications_enabled === true ? 'Envio real ligado' : 'Envio real desligado'}
          </Switch>
        ) : null}
      >
        {settingsLoading ? (
          <p role="status" className="text-[var(--app-muted)]">Carregando a chave de envio...</p>
        ) : settingsError ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <InlineError message="Não foi possível carregar a chave de envio." />
            <Button type="button" variant="secondary" onClick={() => void refetchSettings()}>Tentar novamente</Button>
          </div>
        ) : settings?.communications_enabled === true ? (
          <LeadValue detail="Os e-mails saem para os contatos elegíveis.">Envio real</LeadValue>
        ) : (
          <LeadValue tone="warning" detail="Nenhum e-mail sai; os Comunicados ficam registrados como simulados.">Em simulação</LeadValue>
        )}
      </Block>

      {/* Segundo nível: as abas da página são as de Clientes (ClientesTabs); aqui a vista. */}
      <SegmentedControl<CommunicationTab>
        className="mb-4"
        variant="bar"
        label="Vista da Comunicação"
        value={tab}
        onChange={selectTab}
        options={[
          { value: 'cobertura', label: 'Cobertura de viagens', icon: <Ship size={17} /> },
          ...(canSend ? [{ value: 'disparo' as const, label: 'Disparo', icon: <Send size={17} /> }] : []),
          { value: 'historico', label: 'Histórico', icon: <History size={17} /> },
        ]}
      />

      {tab === 'cobertura' ? (
        <>
          <div className="app-filter-grid mb-4">
            <Field label="Navio"><Input value={coverageFilters.vessel} onChange={(e) => setCoverageFilters({ ...coverageFilters, vessel: e.target.value })} placeholder="Navio" /></Field>
            <Field label="Viagem"><Input value={coverageFilters.voyage} onChange={(e) => setCoverageFilters({ ...coverageFilters, voyage: e.target.value })} placeholder="Viagem" /></Field>
            <Field label="Mês"><Input type="month" value={coverageFilters.month} onChange={(e) => setCoverageFilters({ ...coverageFilters, month: e.target.value })} /></Field>
          </div>
          {coverageQuery.isError ? <InlineError message="Não foi possível carregar a cobertura." /> : null}
          <Block
            title="Cobertura por viagem e porto"
            aside={coverageQuery.data ? plural(coverageQuery.data.length, 'linha', 'linhas') : null}
            flush
          >
            {coverageQuery.isLoading ? <p className="px-4 py-6 text-[var(--app-muted)]">Carregando cobertura...</p> : (
              <div className="app-table-scroll">
                <table className="app-table">
                  <caption className="sr-only">Cobertura de comunicados por viagem e porto</caption>
                  <thead>
                    <tr>
                      <th scope="col"><span className="sr-only">Abrir</span></th>
                      <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                      <th scope="col" className="app-table__text-head">Porto</th>
                      <th scope="col">Clientes</th>
                      <th scope="col">CE e Taxas enviados</th>
                      <th scope="col">Sem CE ou fatura</th>
                      <th scope="col">NOA</th>
                      <th scope="col">NOR</th>
                      <th scope="col">NOB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(coverageQuery.data ?? []).map((row) => {
                      const rowKey = `${row.voyageId}:${row.port ?? ''}`
                      const expanded = expandedCoverageRow === rowKey
                      const detailId = `cobertura-${row.voyageId}-${row.port ?? 'sem-porto'}`
                      const label = `${row.vesselName} / ${row.voyageNumber}${row.port ? `, ${row.port}` : ''}`
                      return (
                        <Fragment key={rowKey}>
                          <tr>
                            <td>
                              {row.details.length ? (
                                <button
                                  type="button"
                                  className="app-table__icon-button"
                                  aria-expanded={expanded}
                                  aria-controls={expanded ? detailId : undefined}
                                  aria-label={`${expanded ? 'Recolher' : 'Abrir'} os Clientes de ${label}`}
                                  onClick={() => setExpandedCoverageRow(expanded ? null : rowKey)}
                                >
                                  {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                                </button>
                              ) : null}
                            </td>
                            <td className="app-table__text"><Link className="app-link" to={`/viagens/${row.voyageId}`}>{row.vesselName} / {row.voyageNumber}</Link></td>
                            <td className="app-table__text">{row.port ?? <NoValue label="Sem porto" />}</td>
                            <td>{row.customers === 0 ? 'Nenhum' : row.customers}</td>
                            <td><FinanceCoverageCount sent={row.finance.sent} due={row.finance.due} resend={row.finance.resend} queued={row.queued.ce_mercante_taxas} now={coverageNow} /></td>
                            <td>{row.customers === 0 ? <NoValue label="Nada devido" /> : row.finance.pending}</td>
                            <td><CoverageCount sent={row.noa.sent} total={row.noa.total} queued={row.queued.aviso_chegada_noa} now={coverageNow} /></td>
                            <td><CoverageCount sent={row.nor.sent} total={row.nor.total} queued={row.queued.aviso_prontidao_nor} now={coverageNow} /></td>
                            <td><CoverageCount sent={row.nob.sent} total={row.nob.total} queued={row.queued.aviso_atracacao_nob} now={coverageNow} /></td>
                          </tr>
                          {expanded ? (
                            <tr data-row-detail>
                              <td colSpan={9} className="p-0">
                                <CoverageDrilldown row={row} now={coverageNow} id={detailId} />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })}
                    {!coverageQuery.data?.length ? <tr><td colSpan={9} className="p-8 text-[var(--app-muted)]">Nenhuma viagem encontrada.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-[var(--app-border-soft)] px-4 py-2 text-xs text-[var(--app-muted)]">
              Uma linha por navio/viagem e porto de descarga; a seta abre os Clientes da linha e a situação de cada Comunicado. "0 de 2": enviados de devidos. "N na fila · HH:MM": a próxima rodada automática (a cada 15 minutos, horário de Brasília) envia. Âmbar enquanto falta enviar. "Reenvio pendente": Cliente que já recebeu o CE e Taxas e ganhou B/L novo ainda não pronto; conta como devido, não como enviado. "Sem CE ou fatura": Clientes do porto que ainda não podem receber o CE e Taxas. "—": nada devido (sem Cliente, ou o marco da escala ainda não chegou).
            </p>
          </Block>
        </>
      ) : tab === 'disparo' ? (
        <div className="space-y-5">
          {showConference ? (
            /* Depois de conferir, a composição vira uma faixa de uma linha. O que
               merece a tela inteira daqui em diante é a lista de quem recebe. */
            <Block
              title="Composição"
              aside={(
                <Button type="button" variant="secondary" className="app-btn--sm" onClick={() => setConferenceRequested(false)}>
                  <Pencil size={15} /> Editar composição
                </Button>
              )}
            >
              <p>{dispatchSentence}</p>
              <p className="mt-1 text-[var(--app-muted)]">Modo {activeModeOption?.title} · {attachments.length ? plural(attachments.length, 'anexo', 'anexos') : 'sem anexos'}</p>
            </Block>
          ) : null}

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            {showConference ? (
              <Block
                title="Destinatários conferidos"
                flush
                aside={(
                  <span className="flex flex-wrap items-center gap-2">
                    {conference?.rows.length ? <span>{plural(conference.rows.length, 'Cliente', 'Clientes')}{blockedRows.length ? ` · ${plural(blockedRows.length, 'sem envio', 'sem envio')}` : ''}</span> : null}
                    {selectableKeys.length ? (
                      <>
                        <Button type="button" variant="secondary" className="app-btn--sm" onClick={() => setSelection(selectableKeys)}>Marcar todos</Button>
                        <Button type="button" variant="secondary" className="app-btn--sm" onClick={() => setSelection([])}>Desmarcar</Button>
                      </>
                    ) : null}
                  </span>
                )}
              >
                <p className="px-4 pt-3 text-[var(--app-muted)]">Desmarque quem não deve receber. A seleção vale só para esta conferência.</p>

                {conference?.rows.length ? (
                  <>
                    <div className="app-table-scroll">
                      <table className="app-table"><caption className="sr-only">Invoices na conferência de comunicação</caption>
                        <thead>
                          <tr>
                            <th scope="col" className="w-12"><span className="sr-only">Selecionar</span></th>
                            <th scope="col" className="app-table__text-head">Cliente</th>
                            <th scope="col">CNPJ</th>
                            <th scope="col">B/Ls</th>
                            <th scope="col" className="app-table__text-head">Destinatários</th>
                            <th scope="col">Situação</th>
                            <th scope="col"><span className="sr-only">Prévia</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {conference.rows.map((row) => (
                            <ConferenceRow
                              key={row.key}
                              row={row}
                              selected={selectedKeys.has(row.key)}
                              resendLabel={previousDispatches(row) > 0 ? (resendGateApplies ? `Reenvio ${row.nextAttemptDiscriminator}` : `${previousDispatches(row)} envio(s) anterior(es)`) : null}
                              onToggle={() => toggleRow(row.key)}
                              onPreview={() => {
                                setCustomPreviewRow(row)
                                setPreviewModalOpen(true)
                              }}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : conference?.unassignedOperationFronts ? (
                  <div className="m-5 rounded-lg border border-[var(--app-gold)]/30 bg-[var(--app-gold-soft)] p-4 text-sm text-[var(--app-gold-strong)]">
                    <p className="font-medium">Nenhuma carga disponível para envio de NOB</p>
                    <p className="mt-1 text-xs opacity-90">
                      A escala informada possui atracação com ATB registrado, mas não possui Frente de Operação atribuída ao terminal (Atracação TBC). Atribua a frente de operação na escala para habilitar o envio do NOB.
                    </p>
                  </div>
                ) : (
                  <div className="px-5 pb-8 text-center text-sm text-[var(--app-muted)]">
                    {dispatchMode === 'institucional'
                      ? 'Nenhum Cliente Comunicável: é preciso ter contato com e-mail e ao menos um B/L com ETA nos últimos 12 meses (ou em viagem futura).'
                      : 'Nenhuma carga atende aos critérios informados.'}
                  </div>
                )}
              </Block>
            ) : (
              <div className="grid gap-4">
                <Block title="Modo" headingLevel={2}>
                {/* `name` agrupa os rádios para o teclado, mas não dá nome ao grupo:
                    sem isto o leitor de tela anuncia a opção sem dizer de que
                    pergunta ela é resposta. O rótulo visível fica fora do grupo. */}
                <div role="radiogroup" aria-label="Modo" className="grid gap-2 sm:grid-cols-2">
                  {MODE_OPTIONS.map((option) => (
                    <ChoiceOption
                      key={option.value}
                      name="comunicacao-modo"
                      title={option.title}
                      hint={option.hint}
                      checked={dispatchMode === option.value}
                      onSelect={() => handleModeChange(option.value)}
                      layout="segment"
                    />
                  ))}
                </div>

                </Block>

                <Block title={singleKindMode ? 'Modelo e público' : 'Modelo'} headingLevel={2}>
                {/* Um select de uma opção só não é escolha: é um rótulo disfarçado de
                    controle, e obriga a repetir num hint o que o Modo já disse. Quando
                    o modo resolve modelo e público, uma frase os resume. */}
                {singleKindMode ? (
                  <div className="flex items-center gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-4 py-3">
                    <Users size={16} className="shrink-0 text-[var(--app-muted)]" aria-hidden="true" />
                    <p className="text-sm leading-relaxed text-[var(--app-muted)]">
                      Modelo único neste modo: você escreve o assunto e a mensagem, e ela vai para{' '}
                      <strong className="font-semibold text-[var(--app-text-strong)]">todos os contatos</strong> de cada cliente.
                    </p>
                  </div>
                ) : (
                  <>
                    <div role="radiogroup" aria-label="Modelo" className="grid gap-2">
                      {availableKindOptions.map((option) => (
                        <ChoiceOption
                          key={option.value}
                          name="comunicacao-modelo"
                          title={option.title}
                          hint={option.hint}
                          checked={kind === option.value}
                          onSelect={() => handleKindChange(option.value)}
                          layout="row"
                        />
                      ))}
                    </div>

                    {/* O público ocupa sempre a mesma faixa, na mesma altura, seja ele
                        imposto pelo modelo ou escolhido pelo operador. */}
                    <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3.5 py-2.5">
                      <Users size={16} className="shrink-0 text-[var(--app-muted)]" aria-hidden="true" />
                      <span className="text-sm text-[var(--app-text)]">Público</span>
                      {audienceRule.editable ? (
                        <>
                          <Select
                            aria-label="Público"
                            className="ml-auto w-full max-w-[240px] min-h-9 py-1.5 text-[13px]"
                            value={audience.mode === 'caixa' ? audience.boxCode : 'todos'}
                            onChange={(event) => {
                              const value = event.target.value
                              setFreeAudience(value === 'todos' ? { mode: 'todos' } : { mode: 'caixa', boxCode: value as CommunicationBoxCode })
                              setConferenceRequested(false)
                              setDispatchMessage(null)
                            }}
                          >
                            <option value="todos">Todos os contatos</option>
                            {CUSTOMER_COMMUNICATION_BOXES.map((box) => (
                              <option key={box.code} value={box.code}>
                                {box.label}
                              </option>
                            ))}
                          </Select>
                          <Badge tone="blue">Você escolhe</Badge>
                        </>
                      ) : (
                        <>
                          <strong className="text-sm font-semibold text-[var(--app-text-strong)]">{audienceLabel(audience)}</strong>
                          <span className="text-xs text-[var(--app-muted)]">— definido pelo modelo</span>
                          <Badge tone="slate" className="ml-auto">Fixo</Badge>
                        </>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--app-muted)]">{audienceRule.reason}</p>
                  </>
                )}

                </Block>

                <Block
                  title={dispatchMode === 'carga' ? 'Recorte da carga' : 'Recorte dos clientes'}
                  headingLevel={2}
                  aside={dispatchMode === 'carga' ? 'Navio / Viagem, POL ou POD: ao menos um' : undefined}
                >
                {dispatchMode === 'carga' ? (
                  <>
                    {/* Quatro filtros numa linha só. As trilhas não são iguais de
                        propósito: navio/viagem e CNPJ recebem texto longo, POL e POD
                        recebem uma sigla de cinco letras. */}
                    <div className="comunicacao-filtros grid gap-3 sm:grid-cols-12">
                      <div className="sm:col-span-4">
                        <Field label="Navio / Viagem">
                          <Input
                            value={filters.vesselVoyage}
                            onChange={(event) => updateFilter('vesselVoyage', event.target.value)}
                            placeholder="Busque por navio ou viagem"
                            list="comunicacao-navios-viagens"
                          />
                          <datalist id="comunicacao-navios-viagens">
                            {vesselVoyageSuggestions.map((label) => <option key={label} value={label} />)}
                          </datalist>
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label="POL">
                          <Input value={filters.pol} onChange={(event) => updateFilter('pol', event.target.value)} placeholder="CNSHA" />
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label="POD">
                          <Input value={filters.pod} onChange={(event) => updateFilter('pod', event.target.value)} placeholder="BRSSZ" />
                        </Field>
                      </div>
                      <div className="sm:col-span-4">
                        <Field label="CNPJ do Cliente (opcional)" hint="Restringe o recorte; não substitui os três campos acima.">
                          <Input value={filters.cnpj} onChange={(event) => updateFilter('cnpj', event.target.value)} placeholder="Filtrar por CNPJ específico" />
                        </Field>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Nada de grid com um campo só dentro: o CNPJ ganha um par que
                        explica qual é o universo que ele restringe. */}
                    <div className="comunicacao-filtros grid gap-3 sm:grid-cols-[minmax(0,1fr)_280px]">
                      <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3.5">
                        <div className="flex items-center gap-2">
                          <Building2 size={15} className="shrink-0 text-[var(--app-muted)]" aria-hidden="true" />
                          <span className="text-xs font-bold text-[var(--app-text-strong)]">Universo: Cliente Comunicável</span>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-[var(--app-muted)]">
                          Cliente com ao menos um contato com e-mail e ao menos um B/L cuja escala tenha ETA a partir de doze meses atrás. Carga de viagem futura também conta.
                        </p>
                      </div>
                      <Field label="CNPJ do Cliente (opcional)" hint="Em branco, alcança todos os comunicáveis.">
                        <Input value={filters.cnpj} onChange={(event) => updateFilter('cnpj', event.target.value)} placeholder="Filtrar por CNPJ específico" />
                      </Field>
                    </div>
                  </>
                )}
                {filterValidation.message ? (
                  <p className="mt-3 text-xs text-[var(--app-gold-strong)]">{filterValidation.message}</p>
                ) : null}

                </Block>

                {userWritten ? (
                  <Block title="Mensagem" headingLevel={2}>
                    <div className="mb-2.5 flex flex-wrap items-center justify-end gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          aria-label="Reaproveitar modelo salvo"
                          className="min-h-9 w-[230px] py-1.5 text-xs"
                          value=""
                          onChange={(event) => applySavedTemplate(event.target.value)}
                        >
                          <option value="">Reaproveitar modelo salvo...</option>
                          {(savedTemplatesQuery.data ?? []).map((template) => (
                            <option key={template.id} value={String(template.id)}>
                              {template.name}
                            </option>
                          ))}
                        </Select>
                        <Input
                          aria-label="Nome do modelo"
                          className="min-h-9 w-[170px] py-1.5 text-xs"
                          value={templateName}
                          onChange={(event) => setTemplateName(event.target.value)}
                          placeholder="Ex.: Aviso de recesso"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-9 px-3 py-1.5 text-xs"
                          loading={saveTemplateMutation.isPending}
                          onClick={() => void saveCurrentTemplate()}
                        >
                          Salvar este texto
                        </Button>
                      </div>
                    </div>

                    {/* O assunto e o corpo moram dentro de uma moldura só, com a
                        aparência do e-mail. Por isso não usam `Input`/`Textarea`:
                        as bordas individuais quebrariam a ilusão da mensagem. */}
                    <div className="overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)]">
                      <div className="flex items-center gap-3 border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3.5 py-2">
                        <label htmlFor="comunicado-assunto" className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">
                          Assunto
                        </label>
                        <input
                          id="comunicado-assunto"
                          className="w-full bg-transparent text-sm font-semibold text-[var(--app-text-strong)] outline-none placeholder:font-normal placeholder:text-[var(--app-muted-soft)]"
                          value={institutionalSubject}
                          onChange={(event) => {
                            setInstitutionalSubject(event.target.value)
                            setDispatchMessage(null)
                          }}
                          placeholder="Assunto do comunicado"
                        />
                      </div>
                      <textarea
                        aria-label="Mensagem"
                        rows={6}
                        className="block w-full resize-y bg-transparent px-4 py-3.5 text-sm leading-relaxed text-[var(--app-text)] outline-none placeholder:text-[var(--app-muted-soft)]"
                        value={institutionalBody}
                        onChange={(event) => {
                          setInstitutionalBody(event.target.value)
                          setDispatchMessage(null)
                        }}
                        placeholder="Escreva a mensagem para os clientes selecionados..."
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3.5 py-2">
                        <span className="text-[11px] text-[var(--app-muted)]">
                          {dispatchMode === 'carga'
                            ? 'O cabeçalho, a assinatura e os dados da carga de cada cliente são acrescentados no envio.'
                            : 'O cabeçalho e a assinatura são acrescentados no envio.'}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--app-muted)]">{institutionalBody.length} caracteres</span>
                      </div>
                    </div>
                  </Block>
                ) : null}
              </div>
            )}

            <Block title={showConference ? 'Pronto para disparar' : 'O que será enviado'} headingLevel={2} flush>
              <div className="p-5">
                {showConference ? (
                  <>
                    <LeadValue>{plural(selectedEmailCount, 'e-mail', 'e-mails')} para {plural(selectedRows.length, 'Cliente', 'Clientes')}</LeadValue>
                    <p className="mt-2 text-[var(--app-muted)]">Um e-mail por Cliente, nunca vários Clientes no mesmo envio.</p>
                  </>
                ) : (
                  <p className="text-sm leading-relaxed text-[var(--app-text)]">{dispatchSentence}</p>
                )}
                {!showConference && kind === 'livre' ? (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-[var(--app-blue-soft)] px-3 py-2.5 text-xs leading-relaxed text-[var(--app-blue)]">
                    <Info size={15} className="mt-px shrink-0" aria-hidden="true" />
                    O comunicado livre fica vinculado aos B/Ls da viagem e aparece no histórico de cada um.
                  </p>
                ) : null}
{/* O alerta some quando o CNPJ restringe o disparo a um cliente: repetido ali,
    contradiria a frase logo acima, que já diz o alcance real. */}
                {!showConference && dispatchMode === 'institucional' && !filters.cnpj.trim() ? (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-[var(--app-gold-soft)] px-3 py-2.5 text-xs leading-relaxed text-[var(--app-gold-strong)]">
                    <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden="true" />
                    É o disparo de maior alcance da tela: sem filtro de viagem nem CNPJ, atinge a base inteira.
                  </p>
                ) : null}
              </div>

              <PanelRule />

              <div className="p-5">
                <FactList columns={2}>
                  <Fact label="Clientes">{showConference ? conference.totalCustomers : <NoValue label="Sem conferência" />}</Fact>
                  <Fact label="E-mails elegíveis">{showConference ? conference.totalEligibleEmails : <NoValue label="Sem conferência" />}</Fact>
                  <Fact label="Excluídos">{showConference ? conference.totalExcludedEmails : <NoValue label="Sem conferência" />}</Fact>
                  <Fact label="Selecionados">{showConference ? selectedRows.length : <NoValue label="Sem conferência" />}</Fact>
                </FactList>
                {!showConference ? (
                  <p className="mt-3 text-xs leading-relaxed text-[var(--app-muted)]">
                    Confira os destinatários para preencher estes números. Nenhum e-mail sai antes disso.
                  </p>
                ) : null}
              </div>

              <PanelRule />

              <div className="flex flex-wrap items-center justify-between gap-3 p-5 py-4">
                <span className="flex items-center gap-2 text-sm text-[var(--app-text)]">
                  <Paperclip size={16} className="text-[var(--app-muted)]" aria-hidden="true" />
                  Anexos
                  <span className="text-xs text-[var(--app-muted)]">
                    {attachments.length ? `${attachments.length} arquivo(s) · ${formatAttachmentSize(attachmentsSize)}` : 'nenhum'}
                  </span>
                </span>
                <label className="app-btn app-btn--secondary min-h-9 cursor-pointer px-3 py-1.5 text-xs">
                  {attachments.length ? 'Trocar' : 'Adicionar'}
                  <input
                    type="file"
                    multiple
                    accept="application/pdf,image/jpeg,image/png,text/plain"
                    className="sr-only"
                    aria-label="Anexos (opcional)"
                    onChange={(event) => void handleAttachments(event)}
                  />
                </label>
              </div>

              {showConference && hasResend ? (
                <>
                  <PanelRule />
                  <label className="m-5 flex items-start gap-2.5 rounded-lg border border-[var(--app-gold)]/40 bg-[var(--app-gold-soft)] p-3 text-xs leading-relaxed text-[var(--app-gold-strong)]">
                    <input
                      type="checkbox"
                      checked={resendConfirmed}
                      onChange={(event) => setResendConfirmationScope(event.target.checked ? signature : undefined)}
                      className="mt-0.5"
                    />
                    <span>
                      <strong className="font-bold">Confirmo o reenvio.</strong> {previouslyContacted} cliente(s) selecionado(s) já
                      possuem um disparo deste comunicado. A nova tentativa usará outro discriminador de idempotência.
                    </span>
                  </label>
                </>
              ) : showConference && previouslyContacted ? (
                <>
                  <PanelRule />
                  <p className="m-5 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3 text-xs leading-relaxed text-[var(--app-muted)]">
                    {previouslyContacted} cliente(s) selecionado(s) já receberam outro comunicado {kind === 'livre' ? 'livre nesta viagem' : 'deste modelo'}. Como o texto é escrito
                    a cada disparo, este envio é uma mensagem nova e não um reenvio.
                  </p>
                </>
              ) : null}

              <PanelRule />

              <div className="flex flex-col gap-2.5 p-5">
                {showConference ? (
                  <>
                    <Button
                      type="button"
                      className="w-full justify-center"
                      onClick={() => void handleDispatch()}
                      loading={sending}
                      disabled={sending || !selectedRows.length || messageMissing || (hasResend && !resendConfirmed)}
                    >
                      <Send size={16} /> Disparar para {selectedRows.length} cliente(s)
                    </Button>
                    {dispatchBlockReason ? (
                      <p className="-mt-1 text-center text-xs text-[var(--app-gold-strong)]">{dispatchBlockReason}</p>
                    ) : null}
                  </>
                ) : (
                  <Button
                    type="button"
                    className="w-full justify-center"
                    onClick={() => {
                      setConferenceRequested(true)
                      setDispatchError(null)
                      setDispatchMessage(null)
                    }}
                    loading={conferenceQuery.isFetching}
                    disabled={!filterValidation.valid || messageMissing}
                  >
                    <CheckCircle2 size={16} /> Conferir destinatários
                  </Button>
                )}
                {/* A conferência troca a composição pela lista de destinatários, e o
                    editor de assunto e mensagem sai da tela junto. Se o disparo pede
                    mensagem, ela tem que existir antes de conferir — senão o operador
                    chega numa tela que exige um campo que ela mesma desmontou. */}
                {!showConference && messageMissing ? (
                  <p className="-mt-1 text-center text-xs text-[var(--app-gold-strong)]">
                    Escreva o assunto e a mensagem para conferir os destinatários.
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-center"
                  onClick={() => {
                    setCustomPreviewRow(null)
                    setPreviewModalOpen(true)
                  }}
                >
                  <Eye size={16} /> Ver prévia do e-mail
                </Button>

                {attachmentError ? <InlineError message={attachmentError} /> : null}
                {conferenceQuery.isError ? (
                  <InlineError message={conferenceQuery.error instanceof Error ? conferenceQuery.error.message : 'Falha ao conferir destinatários.'} />
                ) : null}
                {dispatchError ? <InlineError message={dispatchError} /> : null}
                {dispatchMessage ? (
                  <p className="rounded-lg border border-[var(--app-green)]/30 bg-[var(--app-green-soft)] p-3 text-xs text-[var(--app-green)]">
                    {dispatchMessage}
                  </p>
                ) : null}
                {batchSummary ? (
                  <BatchResult
                    summary={batchSummary}
                    attachmentCustomers={batch?.attachmentCustomers ?? 0}
                    retrying={sending}
                    onRetry={() => void retryFailures()}
                  />
                ) : null}
              </div>
            </Block>
          </div>
        </div>
      ) : (
        <>
          {historyCommunicationId > 0 ? (
            // Ponto 8 de 2026-10-23: o link de um Comunicado abre todos os envios do Cliente na viagem.
            <div className="mb-3 flex flex-wrap items-center gap-3" role="status">
              <span>{linkedCommunicationNotice(historyQuery.data, historyCommunicationId, historyFiltered)}</span>
              <Button
                type="button"
                variant="secondary"
                className="app-btn--sm"
                onClick={() => {
                  const next = new URLSearchParams(searchParams)
                  next.delete('communication')
                  setSearchParams(next, { replace: true })
                }}
              >
                Ver todos
              </Button>
            </div>
          ) : null}
          {historyBlId ? (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span>Comunicados do B/L <strong className="font-mono">{historyBlId}</strong></span>
              <Button
                type="button"
                variant="secondary"
                className="app-btn--sm"
                onClick={() => {
                  const next = new URLSearchParams(searchParams)
                  next.delete('bl')
                  setSearchParams(next, { replace: true })
                }}
              >
                Ver todos
              </Button>
            </div>
          ) : null}
          <div className="app-filter-grid mb-4">
            <Field label="Navio"><Input placeholder="Navio" value={historyFilters.vessel} onChange={(e) => setHistoryFilters({ ...historyFilters, vessel: e.target.value })} /></Field>
            <Field label="Mês"><Input type="month" value={historyFilters.month} onChange={(e) => setHistoryFilters({ ...historyFilters, month: e.target.value })} /></Field>
            <Field label="Modelo"><Select value={historyFilters.kind} onChange={(e) => setHistoryFilters({ ...historyFilters, kind: e.target.value })}><option value="">Todos</option>{CUSTOMER_COMMUNICATION_KINDS.map((value) => <option key={value} value={value}>{customerCommunicationKindLabel(value)}</option>)}</Select></Field>
            <Field label="Situação"><Select value={historyFilters.status} onChange={(e) => setHistoryFilters({ ...historyFilters, status: e.target.value })}><option value="">Todas</option>{HISTORY_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{customerCommunicationStatusLabel(value)}</option>)}</Select></Field>
            <Field label="Origem"><Select value={historyFilters.origin} onChange={(e) => setHistoryFilters({ ...historyFilters, origin: e.target.value as '' | 'manual' | 'automatico' })}><option value="">Todas</option><option value="automatico">Automático</option><option value="manual">Operador</option></Select></Field>
          </div>
          {historyQuery.isError ? <InlineError message="Não foi possível carregar o histórico." /> : null}
          <Block
            title="Histórico de Comunicados"
            aside={historyQuery.data ? `${plural(historyQuery.data.length, 'Comunicado', 'Comunicados')}${historyFailures ? ` · ${historyFailures} com falha` : ''}` : null}
            flush
          >
            {historyQuery.isLoading ? <p className="px-4 py-6 text-[var(--app-muted)]">Carregando histórico...</p> : historyQuery.data?.length ? (
              <div className="app-table-scroll">
                <table className="app-table">
                  <caption className="sr-only">Histórico de Comunicados</caption>
                  <thead>
                    <tr>
                      <th scope="col"><span className="sr-only">Abrir</span></th>
                      <th scope="col">Registrado em</th>
                      <th scope="col" className="app-table__text-head">Cliente</th>
                      <th scope="col" className="app-table__text-head">Modelo</th>
                      <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                      <th scope="col">Origem</th>
                      <th scope="col">Destinatários</th>
                      <th scope="col">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyQuery.data.map((item) => {
                      const ceKey = `${item.customer_id}:${item.anchor_voyage_id}`
                      const ceResend = ceResendResults[ceKey]
                      const canResendCe = canSend && latestCeKeys.has(item.id)
                      const expanded = openHistory.has(item.id)
                      const voyage = [item.vessel_name && item.voyage_number ? `${item.vessel_name} / ${item.voyage_number}` : item.vessel_name ?? item.voyage_number, item.anchor_port, item.terminal_name].filter(Boolean).join(' · ')
                      return (
                        <Fragment key={item.id}>
                          <tr>
                            <td>
                              <button
                                type="button"
                                className="app-table__icon-button"
                                aria-expanded={expanded}
                                aria-label={`${expanded ? 'Recolher' : 'Abrir'} os destinatários do Comunicado de ${item.customer?.name ?? 'Cliente'}`}
                                onClick={() => toggleHistory(item.id)}
                              >
                                {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                              </button>
                            </td>
                            <td className="whitespace-nowrap">{formatDateTime(item.created_at)}</td>
                            <td className="app-table__text">
                              {item.customer?.cnpj_cpf ? (
                                <Link to={`/clientes/${encodeURIComponent(item.customer.cnpj_cpf)}`} className="app-link">{item.customer.name}</Link>
                              ) : (
                                item.customer?.name ?? `Cliente ${item.customer_id}`
                              )}
                            </td>
                            <td className="app-table__text">{customerCommunicationKindLabel(item.kind)}</td>
                            <td className="app-table__text">{voyage || <NoValue label="Sem viagem" />}</td>
                            <td>{item.origin === 'automatico' ? 'Automático' : 'Operador'}</td>
                            <td>{item.attempts.length}</td>
                            <td><StatusText tone={historyStatusTone(item.status)}>{customerCommunicationStatusLabel(item.status)}</StatusText></td>
                          </tr>
                          {expanded ? (
                            <tr data-row-detail>
                              <td colSpan={8} className="p-4">
                                <div className="grid gap-3">
                                  <p className="text-[var(--app-muted)]">
                                    {item.bl_links.length ? `B/Ls: ${item.bl_links.map((link) => link.bl_id).join(', ')}` : 'Sem B/L vinculado'}
                                    {item.attachments.length ? ` · Anexos: ${item.attachments.map((attachment) => `${attachment.file_name} (${formatAttachmentSize(attachment.size_bytes)})`).join(', ')}` : ''}
                                  </p>
                                  {item.attempts.length ? <AttemptsTable communicationId={item.id} attempts={item.attempts} /> : <p className="text-[var(--app-muted)]">Nenhum destinatário registrado.</p>}
                                  {canResendCe ? (
                                    <div>
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        className="app-btn--sm"
                                        loading={ceResendMutation.isPending && ceResendMutation.variables?.customerId === item.customer_id && ceResendMutation.variables?.voyageId === item.anchor_voyage_id}
                                        disabled={ceResendMutation.isPending}
                                        onClick={() => void resendCeMercante(item)}
                                      >
                                        <RotateCcw size={14} aria-hidden="true" /> Reenviar CE e Taxas
                                      </Button>
                                    </div>
                                  ) : null}
                                  {ceResend && latestCeKeys.has(item.id) ? <CeResendResult result={ceResend} /> : null}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-8 text-center text-[var(--app-muted)]">{historyCommunicationId > 0 ? (historyFiltered ? 'Nenhum Comunicado com os filtros atuais.' : 'Comunicado não encontrado.') : 'Nenhum comunicado registrado ainda.'}</p>
            )}
          </Block>
        </>
      )}

      <Modal
        open={previewModalOpen}
        onClose={() => {
          setPreviewModalOpen(false)
          setCustomPreviewRow(null)
        }}
        title={`Pré-visualização do Comunicado: ${customerCommunicationKindLabel(kind)}`}
        className="max-w-3xl w-full"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3 text-xs space-y-1">
            <div className="text-[var(--app-text)]">
              <span className="font-semibold text-[var(--app-muted)]">Destinatário: </span>
              {activePreviewRow
                ? `${activePreviewRow.customerName} (${activePreviewRow.eligibleRecipients[0]?.email ?? 'sem e-mail'})`
                : 'Cliente Demonstração (exemplo@cliente.com.br)'}
            </div>
            <div className="text-[var(--app-text)]">
              <span className="font-semibold text-[var(--app-muted)]">Assunto: </span>
              <span className="font-medium text-[var(--app-text-strong)]">{activePreview?.subject ?? <NoValue label="Sem assunto" />}</span>
            </div>
          </div>

          {activePreview ? (
            <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--app-border)] bg-white p-6 text-slate-800 shadow-sm">
              <div
                className="prose prose-sm max-w-none text-slate-800"
                dangerouslySetInnerHTML={{
                  __html: activePreview.html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? activePreview.html,
                }}
              />
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-[var(--app-muted)]">
              Não foi possível renderizar a prévia deste comunicado.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPreviewModalOpen(false)
                setCustomPreviewRow(null)
              }}
            >
              Fechar
            </Button>
            {showConference && selectedRows.length ? (
              <Button
                onClick={() => {
                  setPreviewModalOpen(false)
                  setCustomPreviewRow(null)
                  void handleDispatch()
                }}
                loading={sending}
              >
                <Send size={15} /> Disparar ({selectedRows.length})
              </Button>
            ) : null}
          </div>
        </div>
      </Modal>
    </>
  )
}

/** Divisória interna do painel da direita, que é um cartão sem padding. */
function PanelRule() {
  return <div className="h-px bg-[var(--app-border)]" />
}

/**
 * Escolha visível: o operador lê todas as opções e a descrição de cada uma sem
 * abrir nada. É um `radio` de verdade — não um botão com `aria-pressed` — porque
 * modo e modelo são escolha única entre opções já na tela, e o radio traz
 * navegação por seta e leitura de grupo sem código extra.
 */
function ChoiceOption({
  name,
  title,
  hint,
  checked,
  onSelect,
  layout,
}: {
  name: string
  title: string
  hint: string
  checked: boolean
  onSelect: () => void
  layout: 'segment' | 'row'
}) {
  return (
    <label
      /* O fundo mora só no condicional: duas utilitárias `bg-*` na mesma classe
         têm a mesma especificidade, e quem vence é a ordem do CSS gerado — não a
         ordem em que foram escritas aqui. */
      className={`flex cursor-pointer gap-2.5 rounded-lg border p-3.5 transition-colors focus-within:ring-3 focus-within:ring-[var(--app-border-focus)] ${
        checked
          ? 'border-[var(--app-blue-btn)] bg-[var(--app-blue-soft)]'
          : 'border-[var(--app-border)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-hover)]'
      } ${layout === 'segment' ? 'flex-col gap-1' : 'items-start'}`}
    >
      {layout === 'row' ? (
        <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-0.5 shrink-0" />
      ) : (
        <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      )}
      <span className="min-w-0">
        <span className="block text-sm font-bold text-[var(--app-text-strong)]">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--app-muted)]">{hint}</span>
      </span>
    </label>
  )
}

/**
 * Uma linha por cliente. A tabela substituiu os cartões empilhados porque a
 * conferência é leitura comparada — quantos B/Ls, quais e-mails, qual situação —
 * e cabe muito mais cliente na primeira dobra.
 */
function ConferenceRow({
  row,
  selected,
  resendLabel,
  onToggle,
  onPreview,
}: {
  row: CustomerCommunicationConferenceRow
  selected: boolean
  resendLabel: string | null
  onToggle: () => void
  onPreview: () => void
}) {
  // Tabela limpa (lote 5a): sem fundo vermelho na linha; a situação em texto,
  // âmbar no que impede o envio, com o motivo escrito.
  const situation = row.blocked
    ? <StatusText tone="warning">{row.eligibleRecipients.length ? row.blockedReason ?? 'Bloqueado' : 'Sem contato elegível'}</StatusText>
    : selected ? <>Elegível</> : <StatusText tone="muted">Desmarcado</StatusText>
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          checked={selected}
          disabled={row.blocked}
          onChange={onToggle}
          aria-label={`Selecionar ${row.customerName}`}
        />
      </td>
      <td className="app-table__text">
        <span className="font-semibold text-[var(--app-text-strong)]">{row.customerName}</span>
        {row.terminalName ? <span className="text-[var(--app-muted)]"> · {row.terminalName}</span> : null}
      </td>
      <td className="font-mono">{row.customerCnpj ? <CopyValue value={formatCnpjCpf(row.customerCnpj)} label="CNPJ/CPF" /> : <NoValue label="CNPJ não informado" />}</td>
      <td>
        {/* Comunicado institucional não vincula B/L: `bls` vem vazio e `sourceBls`
            só comprova que o cliente é comunicável. Somar um no outro faria a
            coluna prometer vínculo de carga onde não há nenhum. */}
        {row.bls.length ? (
          <span title={row.bls.map((bl) => bl.id).join(', ')}>{row.bls.length}</span>
        ) : (
          <span className="text-[var(--app-muted)]" title={row.sourceBls.map((bl) => bl.id).join(', ')}>
            {row.sourceBls.length ? `${row.sourceBls.length} de origem` : 'Sem vínculo'}
          </span>
        )}
      </td>
      <td className="app-table__text app-table__text--wrap">
        {row.eligibleRecipients.length ? row.eligibleRecipients.map((contact) => contact.email).join(', ') : <NoValue label="Sem contato elegível" />}
        {row.excludedRecipients.length ? (
          <span className="text-[var(--app-muted)]"> · {plural(row.excludedRecipients.length, 'excluído', 'excluídos')} ({row.excludedRecipients.map((item) => excludedReasonLabel(item.reason)).join(', ')})</span>
        ) : null}
      </td>
      <td>
        {situation}
        {resendLabel ? <span className="text-[var(--app-muted)]"> · {resendLabel}</span> : null}
      </td>
      <td>
        <RowActionButton label={`Ver e-mail de ${row.customerName}`} title="Ver e-mail" icon={Eye} onClick={onPreview} />
      </td>
    </tr>
  )
}

function excludedReasonLabel(reason: string): string {
  if (reason === 'preferencia_desligada') return 'preferência desligada'
  if (reason === 'email_ausente') return 'sem e-mail'
  if (reason === 'suprimido_complaint') return 'complaint'
  if (reason === 'suprimido_bounce') return 'bounce'
  if (reason === 'contato_desativado') return 'contato desativado'
  return reason
}

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Uma linha por destinatário (plano dos e-mails, 3.3): o e-mail exato usado no
 * envio (migration 451, ponto 8 de 2026-10-23; o mascarado só nos envios
 * anteriores, que não guardaram o endereço, e depois da retenção de 1 ano),
 * quando foi registrado, real ou simulado, a situação e o motivo traduzido — o
 * texto técnico do provedor fica no `title`. Tela interna: o Portal não lê
 * estas tentativas.
 */
function AttemptsTable({ communicationId, attempts }: { communicationId: number; attempts: CustomerCommunicationHistoryItem['attempts'] }) {
  return (
    <div className="app-table-scroll mt-3 rounded-lg border border-[var(--app-border)]">
      <table className="app-table app-table--nested app-table--compact">
        <caption className="sr-only">{`Destinatários do Comunicado ${communicationId}`}</caption>
        <thead>
          <tr>
            <th scope="col" className="app-table__text-head">Destinatário</th>
            <th scope="col">Registrado em</th>
            <th scope="col">Envio</th>
            <th scope="col">Situação</th>
            <th scope="col" className="app-table__text-head">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {[...attempts].sort((left, right) => left.id - right.id).map((attempt) => {
            const failed = isFailedCustomerCommunicationAttempt(attempt.status)
            const reason = customerCommunicationAttemptReason(attempt.last_error)
            return (
              <tr key={attempt.id}>
                <td className="app-table__text text-xs" title={attempt.recipient_email ? undefined : 'Envio anterior à gravação do endereço exato ou com mais de 1 ano: só o endereço mascarado foi guardado'}>{attempt.recipient_email ?? attempt.recipient_masked}</td>
                <td className="whitespace-nowrap tabular-nums text-xs">{formatDateTime(attempt.created_at)}</td>
                <td>{attempt.dispatch_mode === 'simulado' ? 'Simulado' : attempt.dispatch_mode === 'real' ? 'Real' : <NoValue label="Modo não registrado" />}</td>
                <td>{failed ? <StatusText tone="danger">{customerCommunicationAttemptStatusLabel(attempt)}</StatusText> : customerCommunicationAttemptStatusLabel(attempt)}</td>
                <td className="app-table__text app-table__text--wrap" title={attempt.last_error ?? undefined}>{reason ?? <NoValue label="Sem motivo registrado" />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CeResendResult({ result }: { result: { summary?: CeMercanteCommunicationDispatchSummary; error?: string } }) {
  const summary = result.summary
  const text = result.error
    ? `Reenvio não feito: ${result.error}`
    : !summary
      ? null
      : summary.status === 'enviado'
        ? `CE e Taxas reenviado (tentativa ${summary.attemptDiscriminator}).`
        : summary.status === 'simulado'
          ? `Reenvio registrado em simulação (tentativa ${summary.attemptDiscriminator}); nenhum e-mail saiu.`
          : summary.status === 'parcial'
            ? `Reenvio parcial: ${summary.sentCount} enviado(s), ${summary.simulatedCount} simulado(s), ${summary.failedCount} falha(s)${summary.reason ? ` (${summary.reason})` : ''}; confira os destinatários no Histórico.`
            : `Reenvio não feito: ${summary.reason ?? 'falha no envio.'}`
  if (!text) return null
  const problem = Boolean(result.error) || (summary ? summary.status !== 'enviado' && summary.status !== 'simulado' : false)
  return (
    <p role="status" className="mt-3 text-xs">
      {problem ? <StatusText tone="warning">{text}</StatusText> : text}
    </p>
  )
}

/**
 * Resumo do lote (plano dos e-mails, 3.2): quantos saíram, quantos ficaram
 * simulados e quem falhou, com o motivo. "Repetir só as falhas" reenvia os
 * mesmos itens, no mesmo Comunicado.
 */
function BatchResult({
  summary,
  attachmentCustomers,
  retrying,
  onRetry,
}: {
  summary: { sent: number; simulated: number; failed: CustomerCommunicationBatchOutcome[]; retryable: CustomerCommunicationBatchOutcome[] }
  attachmentCustomers: number
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <div role="status" className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3 text-xs leading-relaxed text-[var(--app-text)]">
      <p className="font-semibold text-[var(--app-text-strong)]">Resultado do disparo</p>
      <p className="mt-1">
        {summary.sent} enviado(s) · {summary.simulated} simulado(s) ·{' '}
        {summary.failed.length ? <StatusText tone="danger">{summary.failed.length} falha(s)</StatusText> : 'nenhuma falha'}
      </p>
      {attachmentCustomers ? <p className="mt-1">Anexo enviado a {attachmentCustomers} Cliente(s). Os anexos foram retirados para o próximo disparo.</p> : null}
      {summary.failed.length ? (
        <>
          <ul className="mt-2 space-y-1">
            {summary.failed.map((outcome) => (
              <li key={outcome.key}>
                <strong className="font-semibold">{outcome.customerName}</strong> · {outcome.input.recipient}: {outcome.reason ?? 'Falha no envio do comunicado.'}
                {outcome.permanent ? <> <StatusText tone="warning">Não adianta repetir; corrija o contato.</StatusText></> : null}
              </li>
            ))}
          </ul>
          {summary.retryable.length ? (
            <Button type="button" variant="secondary" className="app-btn--sm mt-2.5" loading={retrying} onClick={onRetry}>
              <RotateCcw size={14} aria-hidden="true" /> Repetir só as falhas ({summary.retryable.length})
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
