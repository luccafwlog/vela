import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Search, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { EmptyState, PageHeader } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { MetricCard } from '../components/ui/MetricCard'
import { SkeletonTable } from '../components/ui/Skeleton'
import { SummaryStrip } from '../components/ui/SummaryStrip'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { useAuth } from '../hooks/useAuth'
import { useReviewQueue, type ReviewCustomer, type ReviewQueueItem } from '../hooks/useReview'
import {
  countReviewCauses,
  flattenReviewGroupIds,
  getReviewItemCauses,
  getReviewItemDocumentCandidates,
  groupReviewItems,
  hasCustomerDocumentConflict,
  needsCustomerLink,
  readReviewCauseParam,
  REVIEW_CAUSE_LABELS,
  sortReviewGroupsByPriority,
  summarizeRemainingPendencies,
  summarizeReviewGroup,
  type ReviewCause,
  type ReviewGroup,
} from './revisaoHelpers'
import { extractErrorText } from '../lib/errors'
import { canonicalizeValidCnpj, formatCnpj } from '../lib/cnpj'
import { invalidateReviewQueueCaches } from '../components/review/reviewCaches'
import { ReviewGroupBlock } from '../components/review/ReviewGroupBlock'
import type { ReviewCustomerOnboardingInput } from '../components/review/ReviewCustomerOnboarding'
import { ReviewDrawer } from '../components/review/ReviewDrawer'
import { ReviewOutcomes, type ReviewOutcome, type ReviewRecalcNotice } from '../components/review/ReviewOutcomes'
import { calculateBlLocalCharges } from '../services/charges/chargeOperationsService'
import { queryKeys } from '../services/queryKeys'
import {
  applyInlineBlReviewFix,
  ConcurrentEditError,
  saveGraniteBlReview,
  type SaveBlReviewResult,
} from '../services/review'
import { tryAutoIssueInvoice } from '../services/reviewBillingAutomation'
import { useReviewCustomerGroup } from '../hooks/useReviewCustomerGroup'

// Endereçamento da fila por URL. `?bl=` existe para quem chega de outra tela
// apontando um B/L específico (a Validação, ADR 0061): o filtro da fila já casa
// por `item.id`, então o alvo entra como termo de busca e o grupo dele abre.
// Sem isso o operador cai na fila inteira para procurar à mão.
function readQueueTarget(params: URLSearchParams) {
  return (
    params.get('cliente') ||
    params.get('busca') ||
    params.get('q') ||
    params.get('bl') ||
    null
  )
}

// Causas com cartão próprio: no máximo quatro números, e cada um filtra.
const CARD_CAUSES: ReviewCause[] = ['cliente', 'peso', 'portal', 'granito']

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function matchesSearch(item: ReviewQueueItem, q: string) {
  return item.id.toLowerCase().includes(q) ||
    (item.consignee ?? '').toLowerCase().includes(q) ||
    (item.shipper ?? '').toLowerCase().includes(q) ||
    (item.customer?.name ?? '').toLowerCase().includes(q) ||
    (item.customer?.cnpj_cpf ?? '').includes(q) ||
    (item.manifest_customer_cnpj_cpf ?? '').includes(q) ||
    (item.customer_id ? String(item.customer_id) === q : false) ||
    (item.source === 'granite' && item.bl_number ? item.bl_number.toLowerCase().includes(q) : false)
}

export function Revisao() {
  const [searchParams, setSearchParams] = useSearchParams()
  // Alvo de chegada (Alertas, Validação, ficha do B/L): abre os grupos que
  // casam com ele uma vez. A busca digitada depois só filtra.
  const [arrivalTarget] = useState(() => readQueueTarget(searchParams))
  const searchText = readQueueTarget(searchParams) ?? ''
  const causeFilter = readReviewCauseParam(searchParams)

  const reviewQueue = useReviewQueue()
  const { data, isLoading, error, graniteUnavailable } = reviewQueue
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const reviewCustomerGroup = useReviewCustomerGroup()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // A fila inicia recolhida; o mapa guarda o que o operador abriu ou fechou.
  const [openOverrides, setOpenOverrides] = useState<Map<string, boolean>>(new Map())

  const [savingGroupKey, setSavingGroupKey] = useState<string | null>(null)
  const [savingInlineId, setSavingInlineId] = useState<string | null>(null)
  const [recalcQueue, setRecalcQueue] = useState<ReviewRecalcNotice[]>([])
  const [recalcingId, setRecalcingId] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<ReviewOutcome[]>([])

  function updateParams(update: (next: URLSearchParams) => void) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      update(next)
      return next
    }, { replace: true })
  }

  function setSearchText(value: string) {
    updateParams((next) => {
      for (const key of ['cliente', 'q', 'bl']) next.delete(key)
      if (value) next.set('busca', value)
      else next.delete('busca')
    })
  }

  function setCauseFilter(cause: ReviewCause | null) {
    updateParams((next) => {
      next.delete('motivo')
      next.delete('reason')
      if (cause) next.set('causa', cause)
      else next.delete('causa')
    })
  }

  function clearFilters() {
    updateParams((next) => {
      for (const key of ['cliente', 'busca', 'q', 'bl', 'causa', 'motivo', 'reason']) next.delete(key)
    })
  }

  const outcomeSeq = useRef(0)
  function pushOutcome(outcome: Omit<ReviewOutcome, 'id'>) {
    outcomeSeq.current += 1
    const id = `outcome-${outcomeSeq.current}`
    // Mantém os cinco mais recentes: o histórico completo fica na auditoria.
    setOutcomes((current) => [{ ...outcome, id }, ...current].slice(0, 5))
  }

  // Apos resolver a revisao, se as taxas locais continuam pendentes de recalculo
  // (ou o granito ainda nao foi faturado), avisa no mesmo contexto.
  function evaluateRecalcNotice(item: ReviewQueueItem) {
    if (item.source === 'bl') {
      if (item.charge_status === 'review_required') {
        addRecalcNotice({ id: item.id, label: item.id, source: 'bl' })
      }
      return
    }
    const blocking = !['ready_for_billing', 'invoiced'].includes(item.charge_status ?? '')
    if (blocking) {
      addRecalcNotice({ id: item.id, label: item.bl_number, source: 'granite' })
    }
  }

  function addRecalcNotice(notice: ReviewRecalcNotice) {
    setRecalcQueue((current) => (current.some((n) => n.id === notice.id) ? current : [...current, notice]))
  }

  function dismissRecalcNotice(id: string) {
    setRecalcQueue((current) => current.filter((n) => n.id !== id))
  }

  async function handleInlineField(item: ReviewQueueItem, field: 'ce_mercante' | 'bb_weight_ton', rawValue: string) {
    if (!user || item.source !== 'bl') return
    let value: string | number
    if (field === 'bb_weight_ton') {
      // O editor já valida junto do campo; aqui só se protege a gravação.
      const parsed = Number(rawValue.replace(',', '.'))
      if (!rawValue.trim() || !Number.isFinite(parsed) || parsed <= 0) return
      value = parsed
    } else {
      if (!rawValue.trim()) return
      value = rawValue.trim()
    }
    const fieldLabel = field === 'ce_mercante' ? 'CE Mercante' : 'Peso da carga solta (t)'

    const before = (item[field] as string | number | null) ?? null
    const confirmed = await confirm({
      title: 'Salvar correção da Revisão',
      message: `Salvar ${field === 'ce_mercante' ? 'o CE Mercante' : 'o peso da carga solta'} do B/L ${item.id}?`,
      confirmLabel: 'Salvar correção',
      affected: { summary: `B/L ${item.id} · ${item.customer?.name ?? 'sem cliente vinculado'}` },
      changes: [{
        field: fieldLabel,
        before: before == null ? '' : String(before),
        after: String(value),
      }],
      consequence: 'Atualiza o dado documental e reavalia a pendência. Se esta correção liberar o último gate, o cálculo e a emissão da fatura poderão ocorrer automaticamente.',
      reversibility: 'O dado pode ser corrigido novamente antes da emissão. Uma fatura emitida não pode ser apagada; sem pagamento, seu cancelamento é restrito ao perfil Administrativo.',
    })
    if (!confirmed) return

    setSavingInlineId(item.id)
    try {
      const result = await applyInlineBlReviewFix({
        blId: item.id,
        field,
        value,
        previousValue: (item[field] as string | number | null) ?? null,
        changedBy: user.id,
        expectedUpdatedAt: item.updated_at ?? null,
      })
      await finishBlCorrection(item, item.customer_id ?? null, result, `${fieldLabel.replace(' (t)', '')} salvo`)
    } catch (err) {
      if (err instanceof ConcurrentEditError) {
        await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
        pushOutcome({ tone: 'danger', title: `B/L ${item.id}: não foi salvo`, lines: ['Outro usuário alterou este B/L. A fila foi recarregada; confira o valor e salve de novo.'] })
      } else {
        pushOutcome({ tone: 'danger', title: `B/L ${item.id}: falha ao salvar a correção`, lines: [extractErrorText(err) || 'Tente de novo.'] })
      }
    } finally {
      setSavingInlineId(null)
    }
  }

  // Centraliza o pos-correcao de um B/L comum: so tenta faturar quando o gate
  // canonico nao reporta mais pendencias; senao mantem na fila informando o que
  // ainda falta. Evita faturar B/L que o cliente nao conseguiria visualizar.
  async function finishBlCorrection(
    item: ReviewQueueItem,
    customerId: number | null,
    result: SaveBlReviewResult,
    actionLabel: string,
  ) {
    let invoiced = false
    let blockedMessage: string | null = null

    if (result.resolved && customerId) {
      const autoInvoice = await tryAutoIssueInvoice({ blId: item.id, customerId, actorId: user?.id ?? null })
      invoiced = autoInvoice.status === 'invoiced'
      if (autoInvoice.status === 'blocked') blockedMessage = autoInvoice.message
    }

    await invalidateReviewQueueCaches(queryClient, { blId: item.id, includeCustomers: true })

    const title = `B/L ${item.id}: ${actionLabel.charAt(0).toLowerCase()}${actionLabel.slice(1)}`
    if (invoiced) {
      dismissRecalcNotice(item.id)
      pushOutcome({ tone: 'success', title, lines: ['Saiu da revisão e a fatura foi emitida automaticamente.'] })
      return
    }
    if (!result.resolved) {
      pushOutcome({ tone: 'warning', title, lines: [`Continua em revisão: ${summarizeRemainingPendencies([result.pendencias]) ?? 'pendência não informada'}.`] })
      return
    }
    if (blockedMessage) {
      addRecalcNotice({ id: item.id, label: item.id, source: 'bl' })
      pushOutcome({ tone: 'warning', title, lines: [`Saiu da revisão, mas o faturamento automático não concluiu: ${blockedMessage}`] })
      return
    }
    pushOutcome({ tone: 'success', title, lines: ['Saiu da revisão e está pronto para faturamento.'] })
  }

  async function handleRecalc(notice: ReviewRecalcNotice) {
    const confirmed = await confirm({
      title: 'Recalcular taxas locais',
      message: `Recalcular as taxas do registro ${notice.label}?`,
      confirmLabel: 'Recalcular',
      affected: { summary: `${notice.source === 'granite' ? 'Granito' : 'B/L'} ${notice.label}` },
      consequence: 'Atualiza o cálculo com a tabela e as regras vigentes e registra o resultado. O novo valor é calculado pelo servidor e não pode ser antecipado neste diálogo.',
      reversibility: 'É possível executar novo recálculo enquanto o registro não estiver faturado. B/Ls faturados são bloqueados.',
    })
    if (!confirmed) return
    setRecalcingId(notice.id)
    try {
      const result = await calculateBlLocalCharges(notice.id, { actorId: user?.id ?? null, recalculate: true })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
      ])
      if (result.status === 'review_required') {
        showToast('Recálculo concluído, mas ainda há pendências de revisão nas taxas locais.', 'info')
      } else {
        dismissRecalcNotice(notice.id)
        showToast('Taxas locais recalculadas.', 'success')
      }
    } catch (error) {
      const message = extractErrorText(error)
      showToast(
        message.toLowerCase().includes('ja foi faturado')
          ? `Fatura já emitida para ${notice.id} — cancele e reemita para corrigir.`
          : 'Falha ao recalcular as taxas locais.',
        'error',
      )
    } finally {
      setRecalcingId(null)
    }
  }

  const searchedData = useMemo(() => {
    if (!data) return []
    const q = searchText.toLowerCase().trim()
    return q ? data.filter((item) => matchesSearch(item, q)) : data
  }, [data, searchText])

  const causeCounts = useMemo(() => countReviewCauses(searchedData), [searchedData])

  const filteredData = useMemo(
    () => (causeFilter ? searchedData.filter((item) => getReviewItemCauses(item).includes(causeFilter)) : searchedData),
    [searchedData, causeFilter],
  )

  const groups = useMemo(() => sortReviewGroupsByPriority(groupReviewItems(filteredData)), [filteredData])
  const summaries = useMemo(() => new Map(groups.map((group) => [group.key, summarizeReviewGroup(group)])), [groups])
  // O drawer anda na mesma ordem em que a fila aparece na tela.
  const orderedIds = useMemo(() => flattenReviewGroupIds(groups), [groups])
  const blockedBlCount = useMemo(() => filteredData.filter((item) => item.source === 'bl').length, [filteredData])

  // Grupos que o alvo de chegada abre por padrão; o clique do operador prevalece.
  const arrivalKeys = useMemo(() => {
    if (!arrivalTarget) return new Set<string>()
    const q = arrivalTarget.toLowerCase().trim()
    return new Set(groups
      .filter((group) =>
        group.displayName.toLowerCase().includes(q) ||
        (group.cnpj && group.cnpj.includes(q)) ||
        group.items.some((item) =>
          item.id.toLowerCase().includes(q) ||
          (item.customer_id && String(item.customer_id) === q) ||
          (item.customer?.name && item.customer.name.toLowerCase().includes(q)) ||
          (item.consignee && item.consignee.toLowerCase().includes(q))
        )
      )
      .map((group) => group.key))
  }, [arrivalTarget, groups])

  function isGroupOpen(key: string) {
    return openOverrides.get(key) ?? arrivalKeys.has(key)
  }

  const selected = selectedId ? (filteredData.find((item) => item.id === selectedId) ?? null) : null
  const selectedGroup = selected ? groups.find((group) => group.items.some((item) => item.id === selected.id)) ?? null : null
  const currentIndex = selectedId ? orderedIds.indexOf(selectedId) : -1
  const hasActiveFilters = Boolean(searchText.trim() || causeFilter)

  function handleClose() {
    setSelectedId(null)
  }

  // Navegacao por id: calcula o proximo ANTES do refetch remover o item
  // resolvido, evitando pular o item seguinte (bug do indice posicional).
  function handleSaved(resolved: boolean) {
    if (!resolved || currentIndex < 0) return
    const nextId = orderedIds[currentIndex + 1] ?? null
    setSelectedId(nextId)
  }

  function toggleGroupCollapsed(key: string) {
    setOpenOverrides((current) => new Map(current).set(key, !isGroupOpen(key)))
  }

  // Vincula um cliente a todos os registros do grupo que ainda nao tem cliente.
  // Resolve "o mesmo problema do mesmo cliente" de uma vez (gargalo de volume).
  async function handleGroupLinkCustomer(group: ReviewGroup, customer: ReviewCustomer) {
    if (!user) return
    const targets = group.items.filter(needsCustomerLink)
    if (targets.length === 0) return
    const customerCnpj = canonicalizeValidCnpj(customer.cnpj_cpf)
    const evidence = group.candidateCnpjs.length ? group.candidateCnpjs : group.cnpj ? [group.cnpj] : []
    const cnpjCheck = !evidence.length
      ? 'O B/L não traz CNPJ para comparar; confirme pelo nome e pelo texto original.'
      : customerCnpj && evidence.includes(customerCnpj)
        ? `O CNPJ ${formatCnpj(customer.cnpj_cpf)} confere com o lido no B/L.`
        : `Atenção: o CNPJ ${formatCnpj(customer.cnpj_cpf)} é diferente do lido no B/L (${evidence.map((cnpj) => formatCnpj(cnpj)).join(', ')}).`
    const confirmed = await confirm({
      title: 'Vincular cliente ao grupo',
      message: `Vincular ${customer.name} (${formatCnpj(customer.cnpj_cpf)}) aos registros sem cliente deste grupo? ${cnpjCheck}`,
      confirmLabel: 'Vincular cliente',
      affected: {
        summary: `${plural(targets.length, 'registro', 'registros')} · ${group.displayName}`,
        items: targets.map((item) => `${item.source === 'granite' ? 'Granito ' + item.bl_number : 'B/L ' + item.id}`),
      },
      consequence: 'Atualiza os vínculos de cliente sem alterar contatos. Para B/Ls, se essa for a última pendência e os gates estiverem liberados, a fatura poderá ser emitida automaticamente.',
      reversibility: 'O vínculo pode ser corrigido pela Revisão antes da emissão. Faturas emitidas seguem o cancelamento restrito ao perfil Administrativo quando não houver pagamento.',
    })
    if (!confirmed) return
    setSavingGroupKey(group.key)
    let successCount = 0
    let invoiceCount = 0
    const failed: string[] = []
    const remaining: string[][] = []
    for (const item of targets) {
      try {
        if (item.source === 'granite') {
          await saveGraniteBlReview({ graniteBlId: item.id, clientId: customer.id, changedBy: user.id })
          evaluateRecalcNotice(item)
        } else {
          const result = await applyInlineBlReviewFix({
            blId: item.id,
            field: 'customer_id',
            value: customer.id,
            previousValue: item.customer_id ?? null,
            changedBy: user.id,
            expectedUpdatedAt: item.updated_at ?? null,
          })
          if (result.resolved) {
            const autoInvoice = await tryAutoIssueInvoice({ blId: item.id, customerId: customer.id, actorId: user.id })
            if (autoInvoice.status === 'invoiced') invoiceCount++
            else if (autoInvoice.status === 'blocked') addRecalcNotice({ id: item.id, label: item.id, source: 'bl' })
          } else {
            remaining.push(result.pendencias)
          }
        }
        successCount++
      } catch {
        failed.push(item.source === 'granite' ? item.bl_number : item.id)
      }
    }
    setSavingGroupKey(null)
    await invalidateReviewQueueCaches(queryClient, {
      includeCustomers: true,
      includeCharges: true,
      includeInvoices: true,
    })
    const lines: string[] = []
    if (invoiceCount) lines.push(`${plural(invoiceCount, 'fatura emitida', 'faturas emitidas')} automaticamente.`)
    const remainingText = summarizeRemainingPendencies(remaining)
    if (remainingText) lines.push(`Continuam em revisão: ${remainingText}.`)
    if (failed.length) lines.push(`Não vinculados: ${failed.join(', ')}. Tente de novo; os demais já foram gravados.`)
    pushOutcome({
      tone: failed.length === targets.length ? 'danger' : failed.length || remainingText ? 'warning' : 'success',
      title: `${group.displayName}: ${successCount} de ${plural(targets.length, 'registro vinculado', 'registros vinculados')} a ${customer.name}`,
      lines,
    })
  }

  async function handleGroupOnboard(group: ReviewGroup, input: ReviewCustomerOnboardingInput) {
    if (!user) return
    const selectedCnpj = canonicalizeValidCnpj(input.cnpjCpf)
    const blIds = group.items
      .filter((item) => item.source === 'bl')
      .filter((item) => item.customer_id == null || getReviewItemDocumentCandidates(item).every((candidate) => !selectedCnpj || candidate === selectedCnpj))
      .map((item) => item.id)
    if (!blIds.length || (group.identityKind === 'conflict' && group.items.length !== 1)) {
      pushOutcome({ tone: 'danger', title: `${group.displayName}: nada foi gravado`, lines: ['Nenhum B/L deste grupo pode receber o cadastro com esse CNPJ.'] })
      return
    }
    const confirmed = await confirm({
      title: input.customerId ? 'Vincular cliente à Revisão' : 'Cadastrar cliente pela Revisão',
      message: `${input.customerId ? 'Adicionar o e-mail e vincular o cliente' : 'Criar o cliente'} ${input.name} (${formatCnpj(selectedCnpj)}) aos B/Ls deste grupo?`,
      confirmLabel: input.sendPortalInvite ? 'Salvar e enviar convite' : 'Salvar cadastro',
      affected: {
        summary: `${plural(blIds.length, 'B/L', 'B/Ls')} · ${input.name} · ${formatCnpj(selectedCnpj)}`,
        items: blIds.map((id) => `B/L ${id}`),
      },
      consequence: `Salva o cliente e o contato ${input.email}.${input.sendPortalInvite ? ` Envia também o convite do Portal para ${input.email}.` : ''} B/Ls liberados por essa correção poderão ter a fatura emitida automaticamente.`,
      reversibility: 'Cadastro e contato podem ser corrigidos; um convite pode ser revogado. Faturas emitidas não podem ser apagadas e só podem ser canceladas pelo perfil Administrativo quando não houver pagamento.',
    })
    if (!confirmed) return
    setSavingGroupKey(group.key)
    try {
      const result = await reviewCustomerGroup.mutateAsync({
        blIds,
        customerId: input.customerId,
        cnpjCpf: input.cnpjCpf,
        name: input.name,
        email: input.email,
        changedBy: user.id,
        sendPortalInvite: input.sendPortalInvite,
      })
      let invoiceCount = 0
      for (const bl of result.onboarding.bls) {
        if (!bl.resolved || !bl.blId) continue
        try {
          const autoInvoice = await tryAutoIssueInvoice({
            blId: bl.blId,
            customerId: result.onboarding.customer.id,
            actorId: user.id,
          })
          if (autoInvoice.status === 'invoiced') invoiceCount++
        } catch {
          addRecalcNotice({ id: bl.blId, label: bl.blId, source: 'bl' })
        }
      }

      const graniteTargets = group.items.filter((item) => item.source === 'granite' && needsCustomerLink(item))
      let graniteLinkedCount = 0
      const graniteFailed: string[] = []
      for (const item of graniteTargets) {
        try {
          await saveGraniteBlReview({ graniteBlId: item.id, clientId: result.onboarding.customer.id, changedBy: user.id })
          graniteLinkedCount++
          evaluateRecalcNotice(item)
        } catch {
          // A falha pontual no Granito não desfaz o onboarding transacional dos B/Ls.
          graniteFailed.push(item.source === 'granite' ? item.bl_number : item.id)
        }
      }

      const remainingText = summarizeRemainingPendencies(result.onboarding.bls.filter((bl) => !bl.resolved).map((bl) => bl.pendencias))
      const resolvedCount = result.onboarding.bls.filter((bl) => bl.resolved).length
      const lines: string[] = []
      if (invoiceCount) lines.push(`${plural(invoiceCount, 'fatura emitida', 'faturas emitidas')} automaticamente.`)
      if (resolvedCount) lines.push(`${plural(resolvedCount, 'B/L saiu', 'B/Ls saíram')} da revisão.`)
      if (remainingText) lines.push(`Continuam em revisão: ${remainingText}.`)
      if (graniteLinkedCount) lines.push(`${plural(graniteLinkedCount, 'registro de Granito vinculado', 'registros de Granito vinculados')}.`)
      if (graniteFailed.length) lines.push(`Granito não vinculado: ${graniteFailed.join(', ')}. Vincule pelo grupo ou pelo Granito.`)
      if (result.portalInvite === 'sent') lines.push(`Convite do Portal enviado para ${input.email}.`)
      if (result.portalInvite === 'failed') lines.push('O convite do Portal não foi enviado; o cadastro foi concluído. Envie pelo Provisionamento do Portal.')
      pushOutcome({
        tone: result.portalInvite === 'failed' || graniteFailed.length || remainingText ? 'warning' : 'success',
        title: `${result.onboarding.customer.name}: cliente ${input.customerId ? 'vinculado' : 'cadastrado'} em ${plural(result.onboarding.bls.length, 'B/L', 'B/Ls')}`,
        lines,
      })
      await invalidateReviewQueueCaches(queryClient, { includeCustomers: true, includeCharges: true, includeInvoices: true, includePortal: input.sendPortalInvite })
    } catch (err) {
      if (err instanceof ConcurrentEditError) {
        await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
        pushOutcome({ tone: 'danger', title: `${group.displayName}: nada foi gravado`, lines: ['Outro usuário alterou este grupo. A fila foi recarregada; confira e tente de novo.'] })
      } else {
        pushOutcome({ tone: 'danger', title: `${group.displayName}: nada foi gravado`, lines: [extractErrorText(err) || 'Falha ao concluir o cadastro do cliente.'] })
      }
    } finally {
      setSavingGroupKey(null)
    }
  }

  const summaryItems = data
    ? [
        { label: groups.length === 1 ? 'cliente' : 'clientes', value: groups.length },
        { label: filteredData.length === 1 ? 'registro em revisão' : 'registros em revisão', value: filteredData.length },
        { label: blockedBlCount === 1 ? 'B/L sem faturamento' : 'B/Ls sem faturamento', value: blockedBlCount, tone: blockedBlCount ? 'warning' as const : 'default' as const },
      ]
    : []

  return (
    <>
      <PageHeader title="Revisão" />

      {data && data.length > 0 ? (
        <div className="review-causes" role="group" aria-label="Filtrar por causa">
          {CARD_CAUSES.map((cause) => (
            <MetricCard
              key={cause}
              label={REVIEW_CAUSE_LABELS[cause]}
              value={causeCounts[cause]}
              selected={causeFilter === cause}
              onSelect={() => setCauseFilter(causeFilter === cause ? null : cause)}
            />
          ))}
        </div>
      ) : null}

      {outcomes.length || recalcQueue.length ? (
        <ReviewOutcomes
          outcomes={outcomes}
          recalcNotices={recalcQueue}
          recalcingId={recalcingId}
          onDismissOutcome={(id) => setOutcomes((current) => current.filter((outcome) => outcome.id !== id))}
          onDismissRecalc={dismissRecalcNotice}
          onRecalc={(notice) => void handleRecalc(notice)}
        />
      ) : null}

      <section className="review-queue" aria-label="Fila de revisão">
        <div className="review-toolbar">
          <div className="review-search">
            <Search className="review-search__icon" size={15} aria-hidden="true" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Buscar B/L, cliente, consignatário..."
              aria-label="Buscar B/L, cliente, consignatário ou CNPJ"
              className="app-review-search__input"
            />
            {searchText ? (
              <button type="button" className="review-search__clear" onClick={() => setSearchText('')} aria-label="Limpar busca">
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {data ? <SummaryStrip items={summaryItems} label="Resumo da fila" className="review-toolbar__summary" /> : null}
          {hasActiveFilters ? (
            <div className="review-toolbar__filters">
              <span>
                {causeFilter ? `Causa: ${REVIEW_CAUSE_LABELS[causeFilter]}` : null}
                {causeFilter && searchText.trim() ? ' · ' : null}
                {searchText.trim() ? `Busca: “${searchText.trim()}”` : null}
              </span>
              <button type="button" className="review-link-button" onClick={clearFilters}>Limpar filtros</button>
            </div>
          ) : null}
          {causeCounts.outros > 0 && causeFilter !== 'outros' ? (
            <button type="button" className="review-link-button review-toolbar__other" onClick={() => setCauseFilter('outros')}>
              {plural(causeCounts.outros, 'registro com outra pendência', 'registros com outras pendências')}
            </button>
          ) : null}
        </div>

        {graniteUnavailable ? (
          <div className="review-partial" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <p>Os registros de Granito não carregaram; a fila abaixo mostra só os B/Ls.</p>
            <Button variant="secondary" className="app-btn--sm" onClick={() => void reviewQueue.refetch?.()}>Tentar novamente</Button>
          </div>
        ) : null}

        <QueryStateGate
          isLoading={isLoading}
          isError={Boolean(error)}
          isPaused={reviewQueue.fetchStatus === 'paused'}
          hasData={data !== undefined}
          errorMessage="Não foi possível carregar a fila de revisão. Nenhum dado foi alterado."
          onRetry={reviewQueue.refetch ? () => void reviewQueue.refetch() : undefined}
          loadingLabel="Carregando a fila de revisão…"
          loadingFallback={<SkeletonTable rows={6} cols={3} label="Carregando a fila de revisão" />}
        >
          {!filteredData.length ? (
            hasActiveFilters ? (
              <EmptyState
                title="Nenhum registro corresponde ao filtro"
                description="A fila tem pendências fora deste recorte."
                action={<Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>}
              />
            ) : (
              <EmptyState
                title="Nenhum B/L em revisão"
                description="Os B/Ls entram aqui quando a importação encontra cliente sem vínculo, Portal não provisionado ou peso da carga solta ausente."
              />
            )
          ) : (
            <div className="review-groups">
              {groups.map((group) => (
                <ReviewGroupBlock
                  key={group.key}
                  group={group}
                  summary={summaries.get(group.key)!}
                  collapsed={!isGroupOpen(group.key)}
                  savingGroup={savingGroupKey === group.key}
                  savingInlineId={savingInlineId}
                  onToggle={() => toggleGroupCollapsed(group.key)}
                  onGroupLink={(customer) => void handleGroupLinkCustomer(group, customer)}
                  onGroupOnboard={(input) => void handleGroupOnboard(group, input)}
                  onCorrect={(id) => setSelectedId(id)}
                  onInlineField={(item, field, value) => void handleInlineField(item, field, value)}
                />
              ))}
            </div>
          )}
        </QueryStateGate>
      </section>

      <ReviewDrawer
        item={selected}
        currentIndex={currentIndex}
        totalItems={orderedIds.length}
        onClose={handleClose}
        onSaved={handleSaved}
        onReviewSaved={evaluateRecalcNotice}
        onNavigate={(id) => setSelectedId(id)}
        siblingIds={orderedIds}
        allowCustomerLink={Boolean(
          selected?.source === 'bl' && selected.customer_id != null
            || selectedGroup?.identityKind === 'conflict'
            || (selected && hasCustomerDocumentConflict(selected)),
        )}
      />
    </>
  )
}
