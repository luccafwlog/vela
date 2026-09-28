import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Search, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useReviewQueue, type ReviewCustomer, type ReviewQueueItem } from '../hooks/useReview'
import {
  getGroupLinkedItem,
  getReviewItemDocumentCandidates,
  groupReviewItems,
  hasCustomerDocumentConflict,
  needsCustomerLink,
  reviewReasonLabel,
  type ReviewGroup,
} from './revisaoHelpers'
import { extractErrorText } from '../lib/errors'
import { canonicalizeValidCnpj, formatCnpj } from '../lib/cnpj'
import { invalidateReviewQueueCaches } from '../components/review/reviewCaches'
import { ReviewGroupBlock } from '../components/review/ReviewGroupBlock'
import type { ReviewCustomerOnboardingInput } from '../components/review/ReviewCustomerOnboarding'
import { ReviewDrawer } from '../components/review/ReviewDrawer'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { addCustomerEmail } from '../services/customers'
import { calculateBlLocalCharges } from '../services/charges/chargeOperationsService'
import { queryKeys } from '../services/queryKeys'
import {
  applyInlineBlReviewFix,
  ConcurrentEditError,
  recomputeBlReviewGate,
  saveGraniteBlReview,
  type SaveBlReviewResult,
} from '../services/review'
import { tryAutoIssueInvoice } from '../services/reviewBillingAutomation'
import { useReviewCustomerGroup } from '../hooks/useReviewCustomerGroup'

type RecalcNotice = { id: string; label: string; source: 'bl' | 'granite' }

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

export function Revisao() {
  const [searchParams] = useSearchParams()
  const initialCliente = readQueueTarget(searchParams) ?? ''
  const initialReason = searchParams.get('motivo') || searchParams.get('reason') || null

  const { data, isLoading, error, graniteUnavailable } = useReviewQueue()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const reviewCustomerGroup = useReviewCustomerGroup()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchText, setSearchText] = useState(initialCliente)
  const [reasonFilter, setReasonFilter] = useState<string | null>(initialReason)
  // A fila inicia recolhida; o conjunto guarda apenas os grupos que o operador abriu.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const [savingGroupKey, setSavingGroupKey] = useState<string | null>(null)
  const [savingInlineId, setSavingInlineId] = useState<string | null>(null)
  const [recalcQueue, setRecalcQueue] = useState<RecalcNotice[]>([])
  const [recalcingId, setRecalcingId] = useState<string | null>(null)

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

  function addRecalcNotice(notice: RecalcNotice) {
    setRecalcQueue((current) => (current.some((n) => n.id === notice.id) ? current : [...current, notice]))
  }

  function dismissRecalcNotice(id: string) {
    setRecalcQueue((current) => current.filter((n) => n.id !== id))
  }

  async function handleInlineError(error: unknown) {
    if (error instanceof ConcurrentEditError) {
      await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      showToast('Este B/L foi alterado por outro usuário. A fila foi recarregada.', 'error')
      return
    }
    showToast('Falha ao salvar a correção inline.', 'error')
  }

  async function handleInlineField(item: ReviewQueueItem, field: 'ce_mercante' | 'bb_weight_ton', rawValue: string) {
    if (!user || item.source !== 'bl') return
    let value: string | number
    if (field === 'bb_weight_ton') {
      const parsed = Number(rawValue)
      if (!rawValue.trim() || !Number.isFinite(parsed) || parsed <= 0) {
        showToast('Informe um peso válido em toneladas.', 'error')
        return
      }
      value = parsed
    } else {
      if (!rawValue.trim()) {
        showToast('Informe o CE Mercante.', 'error')
        return
      }
      value = rawValue.trim()
    }

    const before = (item[field] as string | number | null) ?? null
    const confirmed = await confirm({
      title: 'Salvar correção da Revisão',
      message: `Salvar a correção de ${field === 'ce_mercante' ? 'CE Mercante' : 'peso de carga solta'} no B/L ${item.id}?`,
      confirmLabel: 'Salvar correção',
      affected: { summary: `B/L ${item.id} · ${item.customer?.name ?? 'cliente não vinculado'}` },
      changes: [{
        field: field === 'ce_mercante' ? 'CE Mercante' : 'Peso carga solta (ton)',
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
      await finishBlCorrection(item, item.customer_id ?? null, result, 'Pendência atualizada')
    } catch (err) {
      await handleInlineError(err)
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

    if (invoiced) {
      dismissRecalcNotice(item.id)
      showToast(`${actionLabel} e fatura emitida automaticamente.`, 'success')
      return
    }
    if (!result.resolved) {
      showToast(`${actionLabel}. Ainda falta: ${result.pendencias.join(', ')}.`, 'info')
      return
    }
    if (blockedMessage) {
      addRecalcNotice({ id: item.id, label: item.id, source: 'bl' })
      showToast(`${actionLabel}, mas o faturamento automático não concluiu: ${blockedMessage}`, 'info')
      return
    }
    showToast(`${actionLabel}. B/L pronto para faturamento.`, 'success')
  }

  async function handleRecalc(notice: RecalcNotice) {
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

  const filteredData = useMemo(() => {
    if (!data) return []
    let result = data
    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim()
      result = result.filter(
        (item) =>
          item.id.toLowerCase().includes(q) ||
          (item.consignee ?? '').toLowerCase().includes(q) ||
          (item.shipper ?? '').toLowerCase().includes(q) ||
          (item.customer?.name ?? '').toLowerCase().includes(q) ||
          (item.customer?.cnpj_cpf ?? '').includes(q) ||
          (item.manifest_customer_cnpj_cpf ?? '').includes(q) ||
          (item.customer_id ? String(item.customer_id) === q : false) ||
          (item.source === 'granite' && item.bl_number ? item.bl_number.toLowerCase().includes(q) : false),
      )
    }
    if (reasonFilter) {
      result = result.filter((item) => item.review_reasons?.includes(reasonFilter))
    }
    return result
  }, [data, searchText, reasonFilter])

  const groups = useMemo(() => groupReviewItems(filteredData), [filteredData])

  const visibleExpandedGroups = useMemo(() => {
    const targetCliente = readQueueTarget(searchParams)
    if (targetCliente && groups.length > 0) {
      const q = targetCliente.toLowerCase().trim()
      const matchingKeys = groups
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
        .map((g) => g.key)

      const merged = new Set(expandedGroups)
      matchingKeys.forEach((k) => merged.add(k))
      return merged
    }
    return expandedGroups
  }, [searchParams, groups, expandedGroups])

  const allReasons = useMemo(() => {
    if (!data) return []
    const reasons = new Set<string>()
    for (const item of data) {
      for (const r of item.review_reasons ?? []) reasons.add(r)
    }
    return [...reasons].sort()
  }, [data])

  const selected = selectedId ? (filteredData.find((item) => item.id === selectedId) ?? null) : null
  const selectedGroup = selected ? groups.find((group) => group.items.some((item) => item.id === selected.id)) ?? null : null
  const currentIndex = selectedId ? filteredData.findIndex((item) => item.id === selectedId) : -1
  const activeFilterCount = (searchText.trim() ? 1 : 0) + (reasonFilter ? 1 : 0)
  const filterDescription = describeActiveFilters([
    { label: 'Busca', value: searchText },
    { label: 'Motivo', value: reasonFilter ? reviewReasonLabel(reasonFilter) : null },
  ])
  const emptyState = describeEmptyState({
    entitySingular: 'B/L pendente',
    entityPlural: 'B/Ls pendentes',
    hasActiveFilters: activeFilterCount > 0,
    emptyWithoutFilters: 'Nenhum B/L pendente de revisão.',
    emptyWithFilters: 'Nenhum B/L corresponde ao filtro.',
  })

  function handleClose() {
    setSelectedId(null)
  }

  // Navegacao por id: calcula o proximo ANTES do refetch remover o item
  // resolvido, evitando pular o item seguinte (bug do indice posicional).
  function handleSaved(resolved: boolean) {
    if (!resolved || currentIndex < 0) return
    const nextId = filteredData[currentIndex + 1]?.id ?? null
    setSelectedId(nextId)
  }

  function toggleGroupCollapsed(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Vincula um cliente a todos os B/Ls do grupo que ainda nao tem cliente.
  // Resolve "o mesmo problema do mesmo cliente" de uma vez (gargalo de volume).
  async function handleGroupLinkCustomer(group: ReviewGroup, customer: ReviewCustomer) {
    if (!user) return
    const targets = group.items.filter(needsCustomerLink)
    if (targets.length === 0) return
    const confirmed = await confirm({
      title: 'Vincular cliente ao grupo',
      message: `Vincular ${customer.name} (${formatCnpj(customer.cnpj_cpf)}) aos registros pendentes deste grupo?`,
      confirmLabel: 'Vincular cliente',
      affected: {
        summary: `${targets.length} registro(s) · ${group.displayName}`,
        items: targets.map((item) => `${item.source === 'granite' ? 'Granito ' + item.bl_number : 'B/L ' + item.id}`),
      },
      consequence: 'Atualiza os vínculos de cliente. Para B/Ls, se essa for a última pendência e os gates estiverem liberados, a fatura poderá ser emitida automaticamente.',
      reversibility: 'O vínculo pode ser corrigido pela Revisão antes da emissão. Faturas emitidas seguem o cancelamento restrito ao perfil Administrativo quando não houver pagamento.',
    })
    if (!confirmed) return
    setSavingGroupKey(group.key)
    let successCount = 0
    let errorCount = 0
    let invoiceCount = 0
    const pendingBls: string[] = []
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
          } else {
            pendingBls.push(item.id)
          }
        }
        successCount++
      } catch {
        errorCount++
      }
    }
    setSavingGroupKey(null)
    await invalidateReviewQueueCaches(queryClient, {
      includeCustomers: true,
      includeCharges: true,
      includeInvoices: true,
    })
    const invoiceSummary = invoiceCount > 0 ? ` ${invoiceCount} fatura(s) emitida(s).` : ''
    const pendingSummary = pendingBls.length > 0 ? ` ${pendingBls.length} ainda com pendências (e-mail/portal/peso).` : ''
    showToast(
      errorCount
        ? `${successCount} de ${targets.length} B/Ls vinculados; ${errorCount} falharam.${invoiceSummary}${pendingSummary}`
        : `${successCount} B/L(s) vinculados a ${group.displayName}.${invoiceSummary}${pendingSummary}`,
      errorCount ? 'error' : 'success',
    )
  }

  async function handleGroupOnboard(group: ReviewGroup, input: ReviewCustomerOnboardingInput) {
    if (!user) return
    const selectedCnpj = canonicalizeValidCnpj(input.cnpjCpf)
    const blIds = group.items
      .filter((item) => item.source === 'bl')
      .filter((item) => item.customer_id == null || getReviewItemDocumentCandidates(item).every((candidate) => !selectedCnpj || candidate === selectedCnpj))
      .map((item) => item.id)
    if (!blIds.length || (group.identityKind === 'conflict' && group.items.length !== 1)) {
      showToast('Nenhum B/L elegível para o cadastro deste grupo.', 'error')
      return
    }
    const confirmed = await confirm({
      title: input.customerId ? 'Vincular cliente à Revisão' : 'Cadastrar cliente pela Revisão',
      message: `${input.customerId ? 'Adicionar o e-mail e vincular o cliente' : 'Criar o cliente'} ${input.name} (${formatCnpj(selectedCnpj)}) aos B/Ls deste grupo?`,
      confirmLabel: input.sendPortalInvite ? 'Salvar e enviar convite' : 'Salvar cadastro',
      affected: {
        summary: `${blIds.length} B/L(s) · ${input.name} · ${formatCnpj(selectedCnpj)}`,
        items: blIds.map((id) => `B/L ${id}`),
      },
      consequence: `Salva o cliente e o contato ${input.email}.${input.sendPortalInvite ? ` Inicia também o convite do Portal para ${input.email}.` : ''} B/Ls liberados por essa correção poderão ter a fatura emitida automaticamente.`,
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
      for (const item of graniteTargets) {
        try {
          await saveGraniteBlReview({ graniteBlId: item.id, clientId: result.onboarding.customer.id, changedBy: user.id })
          graniteLinkedCount++
          evaluateRecalcNotice(item)
        } catch {
          // A falha pontual no Granito não desfaz o onboarding transacional dos B/Ls.
        }
      }

      const pendingCount = result.onboarding.bls.filter((bl) => !bl.resolved).length
      const inviteMessage = result.portalInvite === 'failed' ? ' Não foi possível iniciar o convite do Portal; o cadastro foi concluído.' : ''
      const invoiceMessage = invoiceCount > 0 ? ` ${invoiceCount} fatura(s) emitida(s).` : ''
      const graniteMessage = graniteLinkedCount > 0 ? ` ${graniteLinkedCount} item(ns) de Granito vinculado(s).` : ''
      const resolvedCount = result.onboarding.bls.filter((bl) => bl.resolved).length
      showToast(`${resolvedCount} B/L(s) vinculados; ${pendingCount} ainda com pendências.${graniteMessage}${invoiceMessage}${inviteMessage}`, result.portalInvite === 'failed' ? 'info' : 'success')
      await invalidateReviewQueueCaches(queryClient, { includeCustomers: true, includeCharges: true, includeInvoices: true, includePortal: input.sendPortalInvite })
    } catch (err) {
      if (err instanceof ConcurrentEditError) {
        await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
        showToast('Este grupo foi alterado por outro usuário. A fila foi recarregada.', 'error')
      } else {
        showToast(`Falha ao concluir o onboarding do cliente. ${extractErrorText(err)}`.trim(), 'error')
      }
    } finally {
      setSavingGroupKey(null)
    }
  }

  // Apos uma correcao de nivel-cliente (e-mail/portal), reavalia o gate de todos
  // os B/Ls ja vinculados do grupo: os que zerarem saem da fila e, se elegiveis,
  // sao faturados. O updated_at do B/L nao muda (alteramos tabelas do cliente),
  // entao o lock otimista continua valido.
  async function refreshGroupGate(group: ReviewGroup) {
    if (!user) return
    let invoiceCount = 0
    for (const item of group.items) {
      if (item.source !== 'bl' || item.customer_id == null) continue
      try {
        const result = await recomputeBlReviewGate({
          blId: item.id,
          expectedUpdatedAt: item.updated_at ?? null,
          changedBy: user.id,
        })
        if (result.resolved && item.customer_id) {
          const autoInvoice = await tryAutoIssueInvoice({ blId: item.id, customerId: item.customer_id, actorId: user.id })
          if (autoInvoice.status === 'invoiced') invoiceCount++
        }
      } catch {
        // Conflito de concorrencia ou falha pontual: a invalidacao abaixo recarrega o estado real.
      }
    }
    await invalidateReviewQueueCaches(queryClient, {
      includeGranite: false,
      includeCharges: true,
      includeInvoices: true,
    })
    return invoiceCount
  }

  async function handleGroupAddEmail(group: ReviewGroup, email: string) {
    if (!user) return
    const linked = getGroupLinkedItem(group)
    const customerId = linked?.customer?.id
    if (!customerId) return
    if (!email.trim() || !email.includes('@')) {
      showToast('Informe um e-mail válido.', 'error')
      return
    }
    const targets = group.items.filter((item) => item.source === 'bl' && item.customer_id === customerId)
    const confirmed = await confirm({
      title: 'Salvar e-mail do cliente',
      message: `Adicionar ${email.trim().toLowerCase()} como contato de ${group.displayName}?`,
      confirmLabel: 'Salvar e-mail',
      affected: {
        summary: `${group.displayName} · ${targets.length} B/L(s) vinculados`,
        items: targets.map((item) => `B/L ${item.id}`),
      },
      consequence: 'O endereço fica disponível como contato do cliente; esta ação não envia e-mail. A atualização pode liberar o gate de emissão, então faturas elegíveis poderão ser emitidas automaticamente.',
      reversibility: 'O contato pode ser corrigido ou removido no cadastro do cliente. Faturas emitidas não podem ser apagadas e só podem ser canceladas pelo perfil Administrativo quando não houver pagamento.',
    })
    if (!confirmed) return
    setSavingGroupKey(group.key)
    try {
      await addCustomerEmail(customerId, email)
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      const invoiceCount = await refreshGroupGate(group)
      showToast(
        `E-mail vinculado a ${group.displayName}.${invoiceCount ? ` ${invoiceCount} fatura(s) emitida(s).` : ''}`,
        'success',
      )
    } catch (err) {
      showToast(`Falha ao salvar e-mail. ${extractErrorText(err)}`.trim(), 'error')
    } finally {
      setSavingGroupKey(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Revisão Manual"
        description="Fila de B/Ls com pendências de importação que exigem validação humana, agrupada por cliente."
      />

      <div className="review-toolbar mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Buscar B/L, cliente, consignatário..."
            aria-label="Buscar B/L, cliente, consignatário..."
            className="app-review-search__input"
          />
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted-soft)]" size={15} />
          {searchText ? (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] transition-colors hover:text-[var(--app-text)]"
              onClick={() => setSearchText('')}
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        {allReasons.length > 0 ? (
          <Select
            aria-label="Filtrar por inconsistência"
            value={reasonFilter ?? ''}
            onChange={(event) => setReasonFilter(event.target.value || null)}
            className="review-reason-filter w-full sm:w-72"
          >
            <option value="">Todas as inconsistências</option>
            {allReasons.map((reason) => (
              <option
                key={reason}
                value={reason}
              >
                {reviewReasonLabel(reason)}
              </option>
            ))}
          </Select>
        ) : null}

        {data && data.length > 0 ? (
          <span className="review-toolbar__count ml-auto text-xs">
            {formatResultCount(groups.length, 'cliente', 'clientes')} · {formatResultCount(filteredData.length, 'B/L', 'B/Ls')} de {data.length}
          </span>
        ) : null}
      </div>

      {recalcQueue.length > 0 ? (
        <div className="mb-3 space-y-2">
          {recalcQueue.map((notice) => (
            <div
              key={notice.id}
              className="review-recalc-notice flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-sm"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} />
                <span>
                  {notice.source === 'granite'
                    ? `Granito ${notice.label}: o cálculo de taxas precisa ser refeito em /granito.`
                    : `${notice.label}: taxas locais ainda pendentes de recálculo.`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {notice.source === 'bl' ? (
                  <Button
                    variant="secondary"
                    className="px-3 py-1 text-xs"
                    loading={recalcingId === notice.id}
                    onClick={() => handleRecalc(notice)}
                  >
                    Recalcular
                  </Button>
                ) : (
                  <Link className="app-table__action" to="/granito">
                    Abrir Granito
                  </Link>
                )}
                <button
                  type="button"
                  className="review-recalc-notice__dismiss"
                  onClick={() => dismissRecalcNotice(notice.id)}
                  aria-label="Dispensar aviso"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <Card className="review-queue-card overflow-hidden p-0">
        <div className="review-queue-card__summary flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-[var(--app-text-strong)]">{formatResultCount(filteredData.length, 'pendência retornada', 'pendências retornadas')}</span>
          <span className="text-xs text-[var(--app-muted)]">{filterDescription}</span>
        </div>
        {error ? <InlineError message="Erro ao carregar a fila de revisão." /> : null}
        {graniteUnavailable ? (
          <InlineError message="Não foi possível carregar os B/Ls de granito — a fila abaixo pode estar incompleta. Recarregue a página ou contate o suporte." />
        ) : null}

        {isLoading ? (
          <div className="px-4 py-8 text-center text-[var(--app-muted)]">Carregando fila de revisão...</div>
        ) : null}
        {!isLoading && !filteredData.length ? (
          <EmptyState title={emptyState.title} description={emptyState.description} />
        ) : null}

        <div className="review-queue-card__groups divide-y">
          {groups.map((group) => (
            <ReviewGroupBlock
              key={group.key}
              group={group}
              collapsed={!visibleExpandedGroups.has(group.key)}
              savingGroup={savingGroupKey === group.key}
              savingInlineId={savingInlineId}
              onToggle={() => toggleGroupCollapsed(group.key)}
              onGroupLink={(customer) => handleGroupLinkCustomer(group, customer)}
              onGroupAddEmail={(email) => handleGroupAddEmail(group, email)}
              onGroupOnboard={(input) => void handleGroupOnboard(group, input)}
              onCorrect={(id) => setSelectedId(id)}
              onInlineField={handleInlineField}
            />
          ))}
        </div>
      </Card>

      <ReviewDrawer
        item={selected}
        currentIndex={currentIndex}
        totalItems={filteredData.length}
        onClose={handleClose}
        onSaved={handleSaved}
        onReviewSaved={evaluateRecalcNotice}
        onNavigate={(id) => setSelectedId(id)}
        siblingIds={filteredData.map((item) => item.id)}
        allowCustomerLink={Boolean(
          selected?.source === 'bl' && selected.customer_id != null
            || selectedGroup?.identityKind === 'conflict'
            || (selected && hasCustomerDocumentConflict(selected)),
        )}
      />

    </>
  )
}
