import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Building2, CheckCircle2, Eye, History, Info, Mail, Paperclip, Pencil, Send, Users } from 'lucide-react'
import { Badge, type BadgeTone } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { MetricCard } from '../components/ui/MetricCard'
import { Modal } from '../components/ui/Modal'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useAppSettings, useSetCommunicationsEnabled } from '../hooks/useAppSettings'
import { useAuth } from '../hooks/useAuth'
import { useCustomerCommunicationConference, useCustomerCommunicationHistory, useCustomerCommunicationSavedTemplates, useDispatchCustomerCommunication, useSaveCustomerCommunicationSavedTemplate, useVoyageCommunicationCoverage } from '../hooks/useCustomerCommunications'
import {
  DEFAULT_CUSTOMER_COMMUNICATION_FILTERS,
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
  type CustomerCommunicationConferenceRow,
  type CustomerCommunicationConference,
  type CustomerCommunicationBlCandidate,
  type CustomerCommunicationDispatchMode,
  type CustomerCommunicationFilters,
} from '../services/customerCommunications'
import {
  CUSTOMER_COMMUNICATION_BOXES,
  type CommunicationBoxCode,
  type CustomerCommunicationAudience,
} from '../services/customerCommunicationBoxes'
import {
  assertValidCommunicationAttachments,
  renderCustomerCommunicationTemplate,
  type CommunicationAttachment,
  type CustomerCommunicationKind,
  type CustomerCommunicationTemplateInput,
} from '../services/customerCommunicationTemplates'
import { customerCommunicationKindLabel, customerCommunicationStatusLabel } from '../services/customerCommunications'

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
  { value: 'institucional', title: 'Institucional', hint: 'Cliente cadastrado, com ou sem carga a bordo' },
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

function statusTone(status: string): BadgeTone {
  if (status === 'enviado') return 'green'
  if (status === 'falha') return 'red'
  return 'yellow'
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
  const [selectionState, setSelectionState] = useState<{ scope: CustomerCommunicationConference | undefined; keys: Set<string> }>({ scope: undefined, keys: new Set() })
  const [institutionalSubject, setInstitutionalSubject] = useState('')
  const [institutionalBody, setInstitutionalBody] = useState('')
  const [resendConfirmationScope, setResendConfirmationScope] = useState<CustomerCommunicationConference | undefined>(undefined)
  const [attachments, setAttachments] = useState<Array<CommunicationAttachment & { contentBase64: string }>>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null)
  const [dispatchError, setDispatchError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [customPreviewRow, setCustomPreviewRow] = useState<CustomerCommunicationConferenceRow | null>(null)
  const [coverageFilters, setCoverageFilters] = useState({ vessel: '', voyage: '', month: '' })
  const [historyFilters, setHistoryFilters] = useState({ vessel: '', month: '', kind: '', status: '', origin: '' })
  // Só o Comunicado livre deixa o operador escolher o público; os demais modelos
  // recebem o público imposto por `getCustomerCommunicationAudienceRule`.
  const [freeAudience, setFreeAudience] = useState<CustomerCommunicationAudience>({ mode: 'todos' })
  const { data: settings } = useAppSettings()
  const { effectiveRole, isAdmin } = useAuth()
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
  const historyQuery = useCustomerCommunicationHistory({ id: Number.isInteger(historyCommunicationId) && historyCommunicationId > 0 ? historyCommunicationId : undefined, customerId: historyCustomerId, ...historyFilters })
  const coverageQuery = useVoyageCommunicationCoverage(coverageFilters)
  const savedTemplatesQuery = useCustomerCommunicationSavedTemplates()
  const saveTemplateMutation = useSaveCustomerCommunicationSavedTemplate()
  const dispatchMutation = useDispatchCustomerCommunication()
  const conference = conferenceQuery.data
  const tab: CommunicationTab = searchParams.get('tab') === 'historico' ? 'historico' : searchParams.get('tab') === 'disparo' ? 'disparo' : 'cobertura'

  const defaultSelectedKeys = useMemo(
    () => new Set((conference?.rows ?? []).filter((row) => row.selected).map((row) => row.key)),
    [conference],
  )
  const selectedKeys = selectionState.scope === conference ? selectionState.keys : defaultSelectedKeys
  const resendConfirmed = resendConfirmationScope === conference && conference !== undefined

  const selectedRows = useMemo(
    () => (conference?.rows ?? []).filter((row) => selectedKeys.has(row.key) && !row.blocked),
    [conference?.rows, selectedKeys],
  )
  // Institucional e livre carregam `dispatch_id` novo a cada lote: um envio anterior
  // não é reenvio do mesmo Comunicado, então vira informação e não trava.
  const resendGateApplies = requiresResendConfirmation(kind)
  const previouslyContacted = selectedRows.filter((row) => row.nextAttemptDiscriminator > 0).length
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
    setSelectionState({ scope: conference, keys: new Set(keys) })
    setDispatchMessage(null)
  }

  function toggleRow(key: string) {
    if (!conference) return
    setSelectionState((current) => {
      const next = current.scope === conference ? new Set(current.keys) : new Set(defaultSelectedKeys)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return { scope: conference, keys: next }
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
    if (!activePreview) {
      setDispatchError('Não foi possível renderizar o comunicado selecionado.')
      return
    }
    setSending(true)
    let sent = 0
    let simulated = 0
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
        let snapshotMismatch = false
        for (const row of selectedRows) {
          const freshRow = freshMap.get(row.key)
          if (!freshRow || freshRow.recipientSnapshot !== row.recipientSnapshot) {
            snapshotMismatch = true
            break
          }
        }
        if (snapshotMismatch) {
          setResendConfirmationScope(undefined)
          setDispatchError('A lista de destinatários mudou. Confira novamente antes de enviar.')
          setSending(false)
          return
        }
      } catch {
        // Se a verificação de rede falhar, a validação autoritativa final fica com o backend
      }

      const dispatchId = userWritten ? crypto.randomUUID() : null
      const dispatchAnchored = userWritten
      for (const row of selectedRows) {
        const input = userWritten
          ? { ...row.renderInput, subject: institutionalSubject, body: institutionalBody }
          : row.renderInput
        const rendered = renderCustomerCommunicationTemplate(kind, input)
        for (const contact of row.eligibleRecipients) {
          const result = await dispatchMutation.mutateAsync({
            customerId: row.customerId,
            kind,
            nature,
            audience,
            recipient: contact.email!.trim(),
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            blIds: row.bls.map((bl) => bl.id),
            anchorVoyageId: dispatchAnchored ? null : row.sourceBls[0]?.voyageId ?? null,
            anchorPort: dispatchAnchored ? null : row.sourceBls[0]?.pod ?? null,
            anchorAtracacaoId: kind === 'aviso_atracacao_nob' ? row.sourceBls[0]?.terminalStateId ?? null : null,
            attemptDiscriminator: row.nextAttemptDiscriminator,
            dispatchId,
            vesselName: input.vesselName,
            voyageNumber: input.voyageNumber,
            terminalName: input.terminalName,
            attachments,
          })
          sent += 1
          if (result.status === 'simulado') simulated += 1
        }
      }
      setDispatchMessage(settings?.communications_enabled === false
        ? `${sent} tentativa(s) registrada(s) em simulação; nenhum e-mail saiu do sistema.`
        : `${sent} e-mail(s) encaminhado(s)${simulated ? `, ${simulated} em simulação` : ''}.`)
      setConferenceRequested(false)
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : 'Falha ao disparar os comunicados.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Comunicação com Clientes"
        description="Conferência e envio controlado de avisos operacionais e institucionais."
        action={
          <Link to="/clientes" className="app-btn app-btn--secondary">
            Voltar para Clientes
          </Link>
        }
      />

      {settings?.communications_enabled === false ? (
        <div role="status" className="app-surface mb-6 flex flex-col gap-3 rounded-xl border border-l-4 border-[var(--app-border)] border-l-amber-500 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
              <AlertTriangle size={18} />
            </div>
            <div>
              <div className="text-sm font-bold text-[var(--app-text-strong)]">Modo de simulação permanente</div>
              <p className="mt-0.5 text-xs text-[var(--app-muted)]">A chave global está desligada. Os comunicados serão registrados como simulados e nenhum e-mail será enviado ao Resend.</p>
            </div>
          </div>
          {canToggleCommunications ? (
            <Button
              type="button"
              variant="secondary"
              loading={setCommunicationsMutation.isPending}
              onClick={() => {
                void (async () => {
                  const confirmed = await confirm({
                    title: 'Ativar envio real',
                    message: 'Confirma a ativação da chave global de envio? Os próximos disparos de comunicados e cobranças enviarão e-mails reais aos clientes via Resend.',
                    confirmLabel: 'Ativar envio real',
                    tone: 'danger',
                  })
                  if (confirmed) await setCommunicationsMutation.mutateAsync(true)
                })()
              }}
            >
              Ativar envio real
            </Button>
          ) : null}
        </div>
      ) : settings?.communications_enabled === true ? (
        <div role="status" className="app-surface mb-6 flex flex-col gap-3 rounded-xl border border-l-4 border-[var(--app-border)] border-l-emerald-500 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <div className="text-sm font-bold text-[var(--app-text-strong)]">Canal de envio real ativo</div>
              <p className="mt-0.5 text-xs text-[var(--app-muted)]">A chave global está ligada. E-mails reais são disparados aos contatos elegíveis via Resend.</p>
            </div>
          </div>
          {canToggleCommunications ? (
            <Button
              type="button"
              variant="secondary"
              loading={setCommunicationsMutation.isPending}
              onClick={() => {
                void (async () => {
                  const confirmed = await confirm({
                    title: 'Desativar envio real',
                    message: 'Deseja desativar a chave global de envio e retornar ao modo de simulação?',
                    confirmLabel: 'Desativar envio real',
                    tone: 'danger',
                  })
                  if (confirmed) await setCommunicationsMutation.mutateAsync(false)
                })()
              }}
            >
              Desativar envio real
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        <button type="button" className={`app-tab ${tab === 'cobertura' ? 'app-tab--active' : ''}`} onClick={() => selectTab('cobertura')}>
          <CheckCircle2 size={15} className="mr-2 inline" /> Cobertura de viagens
        </button>
        <button
          type="button"
          className={`app-tab ${tab === 'disparo' ? 'app-tab--active' : ''}`}
          onClick={() => selectTab('disparo')}
        >
          <Mail size={15} className="mr-2 inline" /> Disparo
        </button>
        <button
          type="button"
          className={`app-tab ${tab === 'historico' ? 'app-tab--active' : ''}`}
          onClick={() => selectTab('historico')}
        >
          <History size={15} className="mr-2 inline" /> Histórico
        </button>
      </div>

      {tab === 'cobertura' ? (
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><h2 className="text-lg font-semibold text-[var(--app-text-strong)]">Painel de cobertura</h2><p className="text-sm text-[var(--app-muted)]">Acompanhe a régua automática e os clientes ainda pendentes por viagem.</p></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Navio"><Input value={coverageFilters.vessel} onChange={(e) => setCoverageFilters({ ...coverageFilters, vessel: e.target.value })} placeholder="Navio" /></Field>
              <Field label="Viagem"><Input value={coverageFilters.voyage} onChange={(e) => setCoverageFilters({ ...coverageFilters, voyage: e.target.value })} placeholder="Viagem" /></Field>
              <Field label="Mês"><Input type="month" value={coverageFilters.month} onChange={(e) => setCoverageFilters({ ...coverageFilters, month: e.target.value })} /></Field>
            </div>
          </div>
          {coverageQuery.isLoading ? <div className="mt-5 text-sm text-[var(--app-muted)]">Carregando cobertura...</div> : null}
          {coverageQuery.isError ? <div className="mt-5"><InlineError message="Não foi possível carregar a cobertura." /></div> : null}
          <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--app-border)] text-xs uppercase text-[var(--app-muted)]"><th scope="col" className="p-3">Viagem</th><th scope="col" className="p-3">Clientes</th><th scope="col" className="p-3">NOA</th><th scope="col" className="p-3">NOR</th><th scope="col" className="p-3">NOB</th><th scope="col" className="p-3">CE / Taxas</th></tr></thead><tbody>{(coverageQuery.data ?? []).map((row) => <tr key={row.voyageId} className="border-b border-[var(--app-border)]"><td className="p-3 font-medium">{row.vesselName} · {row.voyageNumber}</td><td className="p-3">{row.customers}</td><td className="p-3"><Badge tone={row.noa.sent >= row.noa.total ? 'green' : 'yellow'}>{row.noa.sent}/{row.noa.total}</Badge></td><td className="p-3"><Badge tone={row.nor.sent >= row.nor.total ? 'green' : 'yellow'}>{row.nor.sent}/{row.nor.total}</Badge></td><td className="p-3"><Badge tone={row.nob.sent >= row.nob.total ? 'green' : 'yellow'}>{row.nob.sent}/{row.nob.total}</Badge></td><td className="p-3"><Badge tone={row.finance.pending ? 'yellow' : 'green'}>{row.finance.sent}/{row.finance.ready} enviados · {row.finance.pending} pendentes</Badge></td></tr>)}{!coverageQuery.data?.length ? <tr><td colSpan={6} className="p-8 text-center text-[var(--app-muted)]">Nenhuma viagem encontrada.</td></tr> : null}</tbody></table></div>
        </Card>
      ) : tab === 'disparo' ? (
        <div className="space-y-5">
          {showConference ? (
            /* Depois de conferir, a composição vira uma faixa de uma linha. O que
               merece a tela inteira daqui em diante é a lista de quem recebe. */
            <Card className="flex flex-wrap items-center gap-4 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--app-blue-soft)] text-[var(--app-blue)]">
                <Mail size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-[var(--app-text)]">{dispatchSentence}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge tone="slate">Modo {activeModeOption?.title}</Badge>
                  <Badge tone="slate">{attachments.length ? `${attachments.length} anexo(s)` : 'Sem anexos'}</Badge>
                </div>
              </div>
              <Button type="button" variant="secondary" onClick={() => setConferenceRequested(false)}>
                <Pencil size={15} /> Editar composição
              </Button>
            </Card>
          ) : null}

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            {showConference ? (
              <Card className="overflow-hidden p-0">
                <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div>
                    <h2 className="comunicacao-titulo text-base font-bold text-[var(--app-text-strong)]">Destinatários conferidos</h2>
                    <p className="mt-0.5 text-xs text-[var(--app-muted)]">
                      Desmarque quem não deve receber. A seleção vale só para esta conferência.
                    </p>
                  </div>
                  {selectableKeys.length ? (
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => setSelection(selectableKeys)}>
                        Marcar todos
                      </Button>
                      <Button type="button" variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => setSelection([])}>
                        Desmarcar
                      </Button>
                    </div>
                  ) : null}
                </div>

                {conference?.rows.length ? (
                  <>
                    <div className="app-table-scroll">
                      <table className="app-table">
                        <thead>
                          <tr>
                            <th scope="col" className="w-12 p-3"><span className="sr-only">Selecionar</span></th>
                            <th scope="col" className="p-3 text-left">Cliente</th>
                            <th scope="col" className="w-20 p-3 text-left">B/Ls</th>
                            <th scope="col" className="p-3 text-left">Destinatários</th>
                            <th scope="col" className="w-44 p-3 text-left">Situação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {conference.rows.map((row) => (
                            <ConferenceRow
                              key={row.key}
                              row={row}
                              selected={selectedKeys.has(row.key)}
                              resendLabel={row.nextAttemptDiscriminator > 0 ? (resendGateApplies ? `Reenvio ${row.nextAttemptDiscriminator}` : `${row.nextAttemptDiscriminator} envio(s) anterior(es)`) : null}
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
                    <div className="border-t border-[var(--app-border)] bg-[var(--app-surface-muted)] px-5 py-3 text-xs text-[var(--app-muted)]">
                      {conference.rows.length} cliente(s) no recorte
                      {blockedRows.length ? ` · ${blockedRows.length} bloqueado(s) por cadastro` : ''}
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
                    Nenhuma carga atende aos critérios informados.
                  </div>
                )}
              </Card>
            ) : (
              <Card>
                <ComposerLabel>Modo</ComposerLabel>
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

                <ComposerRule />

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
                    <ComposerLabel>Modelo</ComposerLabel>
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

                <ComposerRule />

                {dispatchMode === 'carga' ? (
                  <>
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <ComposerLabel inline>Recorte da carga</ComposerLabel>
                      <span className="text-xs text-[var(--app-muted)]">Navio/Viagem, POL ou POD: ao menos um é obrigatório</span>
                    </div>
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
                          />
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
                    <ComposerLabel>Recorte dos clientes</ComposerLabel>
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

                {userWritten ? (
                  <>
                    <ComposerRule />
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <ComposerLabel inline>Mensagem</ComposerLabel>
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
                  </>
                ) : null}
              </Card>
            )}

            <Card className="p-0">
              <div className="p-5">
                <h2 className="comunicacao-titulo text-base font-bold text-[var(--app-text-strong)]">
                  {showConference ? 'Pronto para disparar' : 'O que será enviado'}
                </h2>
                {showConference ? (
                  <p className="mt-2 text-sm leading-relaxed text-[var(--app-text)]">
                    <strong className="font-bold">{selectedEmailCount} e-mail(s)</strong> para{' '}
                    <strong className="font-bold">{selectedRows.length} cliente(s)</strong>. Um e-mail por cliente — nunca vários
                    clientes no mesmo destinatário.
                  </p>
                ) : (
                  <p className="mt-2 text-sm leading-relaxed text-[var(--app-text)]">{dispatchSentence}</p>
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
                <div className="grid grid-cols-2 gap-2.5">
                  <MetricCard label="Clientes" value={showConference ? conference.totalCustomers : '—'} />
                  <MetricCard label="E-mails elegíveis" value={showConference ? conference.totalEligibleEmails : '—'} />
                  <MetricCard label="Excluídos" value={showConference ? conference.totalExcludedEmails : '—'} />
                  <MetricCard label="Selecionados" value={showConference ? selectedRows.length : '—'} tone={showConference ? 'primary' : 'secondary'} />
                </div>
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
                      onChange={(event) => setResendConfirmationScope(event.target.checked ? conference : undefined)}
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
                    {previouslyContacted} cliente(s) selecionado(s) já receberam outro comunicado deste modelo. Como o texto é escrito
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
                      disabled={!selectedRows.length || messageMissing || (hasResend && !resendConfirmed)}
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
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">Histórico de Comunicados</h2>
              <p className="mt-0.5 text-sm text-[var(--app-muted)]">O histórico é permanente e distingue enviados, simulados e falhas.</p>
            </div>
            <Badge tone="blue">{historyQuery.data?.length ?? 0} registros</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            <Input placeholder="Navio" value={historyFilters.vessel} onChange={(e) => setHistoryFilters({ ...historyFilters, vessel: e.target.value })} />
            <Input type="month" value={historyFilters.month} onChange={(e) => setHistoryFilters({ ...historyFilters, month: e.target.value })} />
            <Select value={historyFilters.kind} onChange={(e) => setHistoryFilters({ ...historyFilters, kind: e.target.value })}><option value="">Todos os modelos</option>{KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.title}</option>)}</Select>
            <Select value={historyFilters.status} onChange={(e) => setHistoryFilters({ ...historyFilters, status: e.target.value })}><option value="">Todos os status</option><option value="enviado">Enviado</option><option value="simulado">Simulado</option><option value="parcial">Parcial</option><option value="falha">Falha</option></Select>
            <Select value={historyFilters.origin} onChange={(e) => setHistoryFilters({ ...historyFilters, origin: e.target.value as '' | 'manual' | 'automatico' })}><option value="">Todas as origens</option><option value="automatico">Robô automático</option><option value="manual">Operador</option></Select>
          </div>
          {historyQuery.isLoading ? <div className="mt-5 text-sm text-[var(--app-muted)]">Carregando histórico...</div> : null}
          {historyQuery.isError ? <div className="mt-5"><InlineError message="Não foi possível carregar o histórico." /></div> : null}
          <div className="mt-5 grid gap-3">
            {historyQuery.data?.map((item) => (
              <div key={item.id} className="app-surface rounded-xl border border-[var(--app-border)] p-4 shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(item.status)}>{customerCommunicationStatusLabel(item.status)}</Badge>
                  <Badge tone={item.origin === 'automatico' ? 'blue' : 'slate'}>{item.origin === 'automatico' ? 'Robô automático' : 'Operador'}</Badge>
                  <span className="font-semibold text-[var(--app-text-strong)]">{customerCommunicationKindLabel(item.kind)}</span>
                  <span className="text-xs text-[var(--app-muted)]">#{item.id} · tentativa {item.attempt_discriminator}</span>
                </div>
                <div className="mt-2 text-sm text-[var(--app-text)]">
                  {item.customer?.cnpj_cpf ? (
                    <Link to={`/clientes/${encodeURIComponent(item.customer.cnpj_cpf)}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                      {item.customer.name}
                    </Link>
                  ) : (
                    item.customer?.name ?? `Cliente ${item.customer_id}`
                  )}
                  {item.vessel_name ? ` · ${item.vessel_name}` : ''}
                  {item.voyage_number ? ` / ${item.voyage_number}` : ''}
                  {item.anchor_port ? ` · ${item.anchor_port}` : ''}
                  {item.terminal_name ? ` · ${item.terminal_name}` : ''}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--app-muted)]">
                  <span>{new Date(item.created_at).toLocaleString('pt-BR')}</span>
                  {item.bl_links.length ? <span>B/Ls: {item.bl_links.map((link) => link.bl_id).join(', ')}</span> : <span>Institucional</span>}
                  <span>{item.attempts.length} tentativa(s) registrada(s)</span>
                </div>
                {item.attachments.length ? (
                  <div className="mt-2 text-xs text-[var(--app-muted-soft)]">
                    Anexos: {item.attachments.map((attachment) => `${attachment.file_name} (${formatAttachmentSize(attachment.size_bytes)})`).join(', ')}
                  </div>
                ) : null}
              </div>
            ))}
            {!historyQuery.isLoading && !historyQuery.isError && !historyQuery.data?.length ? (
              <div className="py-8 text-center text-sm text-[var(--app-muted)]">{historyCommunicationId > 0 ? 'Comunicado não encontrado.' : 'Nenhum comunicado registrado ainda.'}</div>
            ) : null}
          </div>
        </Card>
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
              <span className="font-medium text-[var(--app-text-strong)]">{activePreview?.subject ?? '—'}</span>
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
            {conference && selectedRows.length ? (
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

/** Rótulo de seção do compositor: uma régua só para a coluna inteira. */
function ComposerLabel({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return (
    <span className={`block text-xs font-semibold uppercase tracking-[0.06em] text-[var(--app-muted)] ${inline ? '' : 'mb-2'}`}>
      {children}
    </span>
  )
}

/** Divisória entre as perguntas do compositor. */
function ComposerRule() {
  return <div className="my-5 h-px bg-[var(--app-border)]" />
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
  return (
    <tr className={row.blocked ? 'bg-[var(--app-red-soft)]' : selected ? 'bg-[var(--app-blue-soft)]' : ''}>
      <td className="p-3 align-top">
        <input
          type="checkbox"
          checked={selected}
          disabled={row.blocked}
          onChange={onToggle}
          aria-label={`Selecionar ${row.customerName}`}
        />
      </td>
      <td className="p-3 align-top">
        <div className="font-semibold text-[var(--app-text-strong)]">{row.customerName}</div>
        <div className="mt-0.5 font-mono text-[11px] text-[var(--app-muted)]">{row.customerCnpj || 'CNPJ não informado'}</div>
        {row.terminalName ? <div className="mt-1"><Badge tone="blue">{row.terminalName}</Badge></div> : null}
      </td>
      <td className="p-3 align-top">
        {/* Comunicado institucional não vincula B/L: `bls` vem vazio e `sourceBls`
            só comprova que o cliente é comunicável. Somar um no outro faria a
            coluna prometer vínculo de carga onde não há nenhum. */}
        {row.bls.length ? (
          <span className="font-mono" title={row.bls.map((bl) => bl.id).join(', ')}>{row.bls.length}</span>
        ) : (
          <span className="text-[11px] text-[var(--app-muted)]" title={row.sourceBls.map((bl) => bl.id).join(', ')}>
            Sem vínculo
            {row.sourceBls.length ? <span className="mt-0.5 block">{row.sourceBls.length} de origem</span> : null}
          </span>
        )}
      </td>
      <td className="p-3 align-top">
        {row.eligibleRecipients.length ? (
          <div className="flex flex-wrap gap-1.5">
            {row.eligibleRecipients.map((contact) => {
              const boxCodes = (contact as { matchedBoxCodes?: string[]; boxCodes?: string[] }).matchedBoxCodes ?? (contact as { boxCodes?: string[] }).boxCodes
              return (
                <span key={contact.id} className="inline-flex items-center gap-1 rounded border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-1.5 py-0.5 text-[11px] text-[var(--app-text)]">
                  {contact.email}
                  {boxCodes?.length ? (
                    <span className="text-[10px] text-[var(--app-muted)]">
                      {boxCodes.map((code) => (code === 'documentacao_operacao' ? 'D&O' : code === 'financeiro' ? 'Fin' : 'Dem')).join(', ')}
                    </span>
                  ) : null}
                </span>
              )
            })}
          </div>
        ) : (
          <div className="text-[var(--app-red)]">Nenhum contato elegível neste recorte.</div>
        )}
        {row.excludedRecipients.length ? (
          <div className="mt-1.5 text-[11px] text-[var(--app-gold-strong)]">
            {row.excludedRecipients.length} excluído(s) · {row.excludedRecipients.map((item) => excludedReasonLabel(item.reason)).join(', ')}
          </div>
        ) : null}
      </td>
      <td className="p-3 align-top">
        <div className="flex flex-wrap items-center gap-1.5">
          {row.blocked ? <Badge tone="red">Bloqueado</Badge> : selected ? <Badge tone="green">Elegível</Badge> : <Badge tone="slate">Desmarcado</Badge>}
          {resendLabel ? <Badge tone="yellow">{resendLabel}</Badge> : null}
        </div>
        <button
          type="button"
          onClick={onPreview}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--app-blue)] shadow-xs hover:bg-[var(--app-surface-hover)]"
        >
          <Eye size={13} /> Ver e-mail
        </button>
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
