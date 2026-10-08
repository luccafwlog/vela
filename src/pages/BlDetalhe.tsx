/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Ban, Copy, MoreHorizontal, RotateCcw, Upload } from 'lucide-react'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { SkeletonCard } from '../components/ui/Skeleton'
import { BlImportModal } from '../components/shared/BlImportModal'
import { BlCargaTab } from '../components/bl/BlCargaTab'
import { BlDetalhesTab } from '../components/bl/BlDetalhesTab'
import { BlFaturamentoTab } from '../components/bl/BlFaturamentoTab'
import { BlHistoricoTab } from '../components/bl/BlHistoricoTab'
import { BlVisaoGeralTab, type BaplieStatus } from '../components/bl/BlVisaoGeralTab'
import type { BlTerminalOverrideOption } from '../components/bl/BlTerminalOverrideCard'
import { BlRailsPipeline } from '../components/bl/BlRailsPipeline'
import { Button } from '../components/ui/Button'
import { useBlDetail } from '../hooks/useBls'
import { useBlEditForm } from '../hooks/useBlEditForm'
import { useBlCockpit } from '../hooks/useBlCockpit'
import { useAuth } from '../hooks/useAuth'
import { afterBlEstadoAlterado } from '../services/cacheEffects'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { cancelBl, reactivateBl } from '../services/blState'
import { userFacingErrorMessage } from '../lib/errors'
import { useSetBlDisposition } from '../hooks/useTransshipments'
import { useInvoiceLinks } from '../hooks/useBilling'
import { extractReviewReasons } from '../hooks/useReview'
import { listDemurrageInvoices } from '../services/demurrage/demurrageInvoices'
import { listDepots } from '../services/depots'
import { setBlTerminalOverride } from '../services/blTerminal'
import { CONTAINER_PROFILE_LABELS, containerProfileLabel, setContainerOwnership, setContainerProfile, type ContainerProfile } from '../services/vaziosNatureza'
import { containerOwnershipLabel, type ContainerOwnership } from '../lib/containerOwnership'
import { isBlFinanciallyLocked } from '../lib/chargeStatus'
import { buildDocumentalRail, buildOperationalRail, pickNextAction, summarizeDocumentalRail } from '../services/blRails'
import { getBlPortalStatus } from '../services/blPortalStatus'
import { queryKeys } from '../services/queryKeys'
import { useVoyageReconciliation } from '../hooks/useVoyageReconciliation'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { ActionMenu, type ActionMenuItem } from '../components/ui/ActionMenu'
import { formatDate } from '../lib/utils'
import { blsListHref } from './blsListState'
import { cargoModeLabel, resolveCargoMode } from './blDetalheHelpers'

export type BlTab = 'visao-geral' | 'carga' | 'detalhes' | 'faturamento' | 'historico'

const BL_TAB_KEYS: BlTab[] = ['visao-geral', 'carga', 'detalhes', 'faturamento', 'historico']

// 'Carga' era uma seção no fim da aba "Detalhes do B/L", abaixo de um
// formulário de ~25 campos: ver os contêineres ou os itens de carga solta de um
// B/L custava quatro interações e uma rolagem. É o dado mais operacional da
// ficha e agora tem aba própria, logo após a visão geral.
export const BL_TABS: { key: BlTab; label: string }[] = [
  { key: 'visao-geral', label: 'Visão geral' },
  { key: 'carga', label: 'Carga' },
  { key: 'detalhes', label: 'Detalhes do B/L' },
  { key: 'faturamento', label: 'Faturamento' },
  { key: 'historico', label: 'Histórico' },
]

export function isBlTab(value: string | null): value is BlTab {
  return (BL_TAB_KEYS as string[]).includes(value ?? '')
}

export function BlDetalhe() {
  const { blId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [blFreightOpen, setBlFreightOpen] = useState(false)
  const [cancelBlockedReasons, setCancelBlockedReasons] = useState<string[] | null>(null)
  const tabParam = searchParams.get('tab')
  const activeTab: BlTab = isBlTab(tabParam) ? tabParam : 'visao-geral'
  const { data: blData, isLoading, error, refetch } = useBlDetail(blId)
  const bl = blData ?? undefined
  const listHref = blsListHref()
  const { user, profile, isAdmin } = useAuth()
  const confirmWithReason = useConfirmWithReason()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const canEditVoyages = Boolean(profile || user)
  const canImport = Boolean(profile || user)
  const { setTransshipment, setCod } = useSetBlDisposition(bl?.voyage_id ?? 0)
  const cockpitQuery = useBlCockpit(bl)
  const cancelledAt = (bl as { cancelled_at?: string | null } | undefined)?.cancelled_at ?? null

  async function handleCancelBl() {
    if (!bl) return
    try {
      const preview = await cancelBl(bl.id, '', { dryRun: true })
      if (preview.reasons.length > 0) {
        // O bloqueio fica na ficha, perto da ação; o toast sumia com o motivo.
        setCancelBlockedReasons(preview.reasons)
        return
      }
      setCancelBlockedReasons(null)
      const reason = await confirmWithReason({
        title: 'Cancelar B/L',
        message: `Cancelar o B/L ${bl.id}? Use quando a carga não embarcou ou o armador reemitiu o documento com outro número.`,
        consequence: 'O B/L fica visível como cancelado, somente leitura, sai do faturamento e aparece como Cancelado no Portal. O CE fica livre para o B/L reemitido.',
        reversibility: 'Reativar B/L, pelo Administrativo, com motivo.',
        confirmLabel: 'Cancelar B/L',
        tone: 'danger',
      })
      if (reason === null) return
      const result = await cancelBl(bl.id, reason)
      if (!result.cancelled) {
        showToast(`O B/L não foi cancelado: ${result.reasons.join(', ')}.`, 'error')
        return
      }
      await afterBlEstadoAlterado(queryClient, { blId: bl.id, voyageId: bl.voyage_id })
      showToast('B/L cancelado.', 'success')
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Falha ao cancelar o B/L.'), 'error')
    }
  }

  async function handleReactivateBl() {
    if (!bl) return
    const reason = await confirmWithReason({
      title: 'Reativar B/L',
      message: `Reativar o B/L ${bl.id}?`,
      consequence: 'O B/L volta a ser editável, entra de novo no faturamento e deixa de aparecer como Cancelado no Portal.',
      reversibility: 'Cancele de novo se precisar.',
      confirmLabel: 'Reativar B/L',
      tone: 'primary',
    })
    if (reason === null) return
    try {
      await reactivateBl(bl.id, reason)
      await afterBlEstadoAlterado(queryClient, { blId: bl.id, voyageId: bl.voyage_id })
      showToast('B/L reativado.', 'success')
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Falha ao reativar o B/L.'), 'error')
    }
  }
  async function copyBlNumber() {
    if (!bl) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard indisponível')
      await navigator.clipboard.writeText(bl.id)
      showToast(`Número do B/L copiado: ${bl.id}`, 'success')
    } catch {
      showToast('Não foi possível copiar o número do B/L.', 'error')
    }
  }

  const { data: invoiceLinksByBl } = useInvoiceLinks(bl?.id ? [bl.id] : [])
  const { data: demurrageInvoices } = useQuery({
    queryKey: queryKeys.demurrage.invoices({ blId: bl?.id }),
    enabled: Boolean(bl?.id),
    queryFn: () => listDemurrageInvoices({ blId: bl!.id }),
  })
  const { data: portalStatus, isError: portalStatusError, refetch: refetchPortalStatus } = useQuery({
    queryKey: queryKeys.portal.blStatus(bl?.id),
    enabled: Boolean(bl?.id),
    queryFn: () => getBlPortalStatus({ blId: bl!.id, ceMercante: bl!.ce_mercante, customerId: bl!.customer_id }),
  })
  const { data: depots } = useQuery({
    queryKey: ['depots', 'list'],
    queryFn: listDepots,
    enabled: Boolean(bl?.id),
  })
  const terminalOverrideMutation = useMutation({
    mutationFn: (input: { terminalId: string | null; podPortId: number | null; justification: string }) => setBlTerminalOverride({
      blId: bl!.id,
      terminalId: input.terminalId,
      podPortId: input.podPortId,
      justification: input.justification,
      changedBy: user?.id,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(bl?.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs.detail('bl', bl?.id) }),
      ])
    },
  })
  const containerProfileMutation = useMutation({
    mutationFn: (input: { containerId: number; profile: ContainerProfile; justification: string }) => setContainerProfile({ ...input, changedBy: user?.id }),
    onSuccess: async () => {
      await Promise.all([
        afterBlEstadoAlterado(queryClient, { blId: bl!.id, voyageId: bl!.voyage_id }),
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs.detail('bl', bl?.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines(bl!.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.pendencies() }),
      ])
      showToast('Perfil do container atualizado e taxas recalculadas.', 'success')
    },
    onError: (error) => showToast(userFacingErrorMessage(error, 'Falha ao alterar o perfil do container.'), 'error'),
  })
  async function handleChangeContainerProfile(containerId: number, profile: ContainerProfile) {
    const container = bl?.bl_containers?.find((item) => item.id === containerId)
    if (!container) return
    const before = containerProfileLabel(container)
    const after = CONTAINER_PROFILE_LABELS[profile]
    if (before === after) return
    const justification = await confirmWithReason({
      title: 'Alterar perfil do container',
      message: `Alterar o perfil do container ${container.container_number}?`,
      changes: [{ field: 'Perfil', before, after }],
      consequence: 'As taxas locais deste B/L são recalculadas com o novo perfil. A alteração fica no histórico com autor e justificativa.',
      reversibility: 'Pode ser revertida escolhendo o perfil anterior, com nova justificativa. Uma reimportação do Baplie volta ao perfil do arquivo.',
      confirmLabel: 'Alterar e recalcular',
      reasonLabel: 'Justificativa',
    })
    if (justification === null) return
    containerProfileMutation.mutate({ containerId, profile, justification })
  }
  const containerOwnershipMutation = useMutation({
    mutationFn: (input: { containerId: number; ownership: ContainerOwnership; justification: string }) => setContainerOwnership({ ...input, changedBy: user?.id }),
    onSuccess: async () => {
      await Promise.all([
        afterBlEstadoAlterado(queryClient, { blId: bl!.id, voyageId: bl!.voyage_id }),
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs.detail('bl', bl?.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines(bl!.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.pendencies() }),
      ])
      showToast('SOC/COC do container atualizado e taxas recalculadas.', 'success')
    },
    onError: (error) => showToast(userFacingErrorMessage(error, 'Falha ao alterar SOC/COC do container.'), 'error'),
  })
  async function handleChangeContainerOwnership(containerId: number, ownership: ContainerOwnership) {
    const container = bl?.bl_containers?.find((item) => item.id === containerId)
    if (!container || container.ownership === ownership) return
    const justification = await confirmWithReason({
      title: 'Alterar SOC/COC do container',
      message: `Marcar o container ${container.container_number} como ${ownership}?`,
      changes: [{ field: 'SOC/COC', before: containerOwnershipLabel(container.ownership), after: ownership }],
      consequence: ownership === 'SOC'
        ? 'As taxas locais deste B/L são recalculadas sem Drop Off e Damage Protection para este container, e ele deixa de esperar devolução e Demurrage. A alteração fica no histórico com autor e justificativa.'
        : 'As taxas locais deste B/L são recalculadas cobrando Drop Off e Damage Protection deste container, e ele passa a esperar devolução. A alteração fica no histórico com autor e justificativa.',
      reversibility: 'Pode ser revertida com nova justificativa. Reimportar o B/L volta ao que o B/L declara ou, sem declaração, ao que o Baplie informa.',
      confirmLabel: 'Alterar e recalcular',
      reasonLabel: 'Justificativa',
    })
    if (justification === null) return
    containerOwnershipMutation.mutate({ containerId, ownership, justification })
  }
  const cargoMode = useMemo(() => resolveCargoMode(bl), [bl])
  const isContainerMode = cargoMode === 'container'
  const isMixedMode = cargoMode === 'misto'
  const hasContainers = isContainerMode || isMixedMode
  const { data: reconciliation, isLoading: reconciliationLoading, isError: reconciliationError } = useVoyageReconciliation(hasContainers ? bl?.voyage_id : null)
  const voyageLabel = [bl?.voyage?.vessel?.name, bl?.voyage?.voyage_number].filter(Boolean).join(' / ')
  const terminalOptions = useMemo<BlTerminalOverrideOption[]>(
    () => (depots ?? [])
      .filter((depot) => depot.tipo === 'terminal_portuario' && depot.active && depot.port_id != null)
      .map((depot) => ({ id: depot.id, code: depot.code, name: depot.name, portId: depot.port_id })),
    [depots],
  )

  const { form, setField, justification, setJustification, saving, changes, handleSubmit } = useBlEditForm(bl)

  const railContainers = useMemo(() => (bl?.bl_containers ?? []).map((container) => ({
    container_number: container.container_number,
    discharge_date: container.discharge_date,
    return_date: container.return_date,
    ownership: container.ownership,
  })), [bl?.bl_containers])
  const operational = useMemo(() => bl ? buildOperationalRail({ bl, polSchedule: cockpitQuery.data?.polSchedule ?? null, podSchedule: cockpitQuery.data?.podSchedule ?? null, containers: railContainers, omission: cockpitQuery.data?.omission ?? null }) : [], [bl, cockpitQuery.data, railContainers])
  const latestInvoice = bl ? invoiceLinksByBl?.[bl.id]?.[0] ?? null : null
  const reviewReasons = useMemo(() => extractReviewReasons(bl?.notes), [bl?.notes])
  const documental = useMemo(() => bl ? buildDocumentalRail({
    bl,
    latestInvoice: latestInvoice ? {
      id: latestInvoice.id,
      invoice_number: latestInvoice.invoice_number,
      status: latestInvoice.status,
      total_brl: latestInvoice.total_brl,
      invoice_type: latestInvoice.invoice_type,
    } : null,
    demurrageInvoices: (demurrageInvoices ?? []).map((invoice) => ({ id: invoice.id, status: invoice.status })),
    reviewReasons,
    portalVisibility: portalStatus?.visibility ?? null,
  }) : [], [bl, demurrageInvoices, latestInvoice, portalStatus?.visibility, reviewReasons])
  const documentalSummary = useMemo(() => summarizeDocumentalRail(documental), [documental])
  const blDivergenceCount = useMemo(() => {
    if (!reconciliation || !bl) return 0
    const numbers = new Set((bl.bl_containers ?? []).map((container) => container.container_number))
    return reconciliation.items.filter((item) => item.kind === 'missing_in_manifest' ? item.baplie_bl_ref === bl.id || numbers.has(item.container_number) : item.bl_id === bl.id).length
  }, [reconciliation, bl])

  // SOC/COC em que o Baplie discorda do B/L: o B/L vale, a aba Carga avisa.
  const ownershipDivergences = useMemo(() => new Map(
    (reconciliation?.items ?? []).flatMap((item) => item.kind === 'ownership_mismatch' && item.bl_id === bl?.id
      ? [[item.container_number, item.baplie_ownership] as const]
      : []),
  ), [reconciliation, bl?.id])

  const baplieStatus = useMemo((): BaplieStatus => {
    if (!hasContainers) return { state: 'not_imported', divergenceCount: 0 }
    if (reconciliationError) return { state: 'error', divergenceCount: 0 }
    if (reconciliationLoading || !reconciliation) return { state: 'loading', divergenceCount: 0 }
    if (reconciliation.source === 'not_imported') return { state: 'not_imported', divergenceCount: 0 }
    return { state: 'reconciled', divergenceCount: blDivergenceCount }
  }, [hasContainers, reconciliation, reconciliationLoading, reconciliationError, blDivergenceCount])

  const containerSummary = useMemo(
    () => ({
      distinct: countDistinctContainerNumbers(bl?.bl_containers),
      imo: countDistinctContainerNumbersBy(bl?.bl_containers, (container) => Boolean(container.is_imo)),
      oog: countDistinctContainerNumbersBy(bl?.bl_containers, (container) => Boolean(container.is_oog)),
      soc: countDistinctContainerNumbersBy(bl?.bl_containers, (container) => container.ownership === 'SOC'),
      coc: countDistinctContainerNumbersBy(bl?.bl_containers, (container) => container.ownership === 'COC'),
    }),
    [bl?.bl_containers],
  )

  // Dependa do objeto bl inteiro: identidade só muda em refetch e o cálculo é
  // barato — satisfaz react-hooks/preserve-manual-memoization sem suppression.
  const breakbulkSummary = useMemo(
    () => ({
      machines: Number(bl?.bb_machine_qty ?? 0),
      packages: Number(bl?.bb_packages_qty ?? 0),
      packagesTotal: Number(bl?.bb_packages_total ?? bl?.bb_packages_qty ?? 0),
      weightTon: Number(bl?.bb_weight_ton ?? 0),
      cbm: Number(bl?.bb_cbm ?? 0),
    }),
    [bl],
  )

  if (isLoading) {
    return (
      <>
        <Breadcrumb items={[{ label: 'BLs', to: listHref }, { label: 'Carregando…' }]} />
        <div className="app-bl-skeleton" role="status" aria-label="Carregando o B/L">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={6} />
        </div>
      </>
    )
  }

  if (error || blData === null || !bl || !form) {
    const missing = !error && blData === null
    return (
      <>
        <Breadcrumb items={[{ label: 'BLs', to: listHref }, { label: missing ? 'B/L não encontrado' : `B/L ${blId ?? ''}` }]} />
        <Card className="app-bl-missing">
          <h1 className="app-bl-missing__title">{missing ? `B/L ${blId ?? ''} não encontrado` : 'Não foi possível abrir este B/L'}</h1>
          <p className="app-bl-missing__text">
            {missing
              ? 'Confira o número. Um B/L excluído deixa de existir; um cancelado continua aparecendo na lista.'
              : userFacingErrorMessage(error, 'A consulta falhou. Tente de novo em instantes.')}
          </p>
          <div className="app-bl-missing__actions">
            {missing ? null : <Button variant="secondary" onClick={() => void refetch()}>Tentar novamente</Button>}
            <Link className="app-btn app-btn--ghost" to={listHref}>
              <ArrowLeft size={16} aria-hidden="true" />
              Voltar para BLs
            </Link>
          </div>
        </Card>
      </>
    )
  }

  const headerMenu: ActionMenuItem[] = [
    { key: 'copy', label: 'Copiar número do B/L', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => void copyBlNumber() },
    ...(isAdmin && cancelledAt
      ? [{ key: 'reactivate', label: 'Reativar B/L', icon: <RotateCcw size={14} aria-hidden="true" />, onSelect: () => void handleReactivateBl() }]
      : []),
    ...(isAdmin && bl.ce_mercante && !cancelledAt
      ? [{ key: 'cancel', label: 'Cancelar B/L', icon: <Ban size={14} aria-hidden="true" />, danger: true, onSelect: () => void handleCancelBl() }]
      : []),
  ]
  const cancelReason = (bl as { cancel_reason?: string | null }).cancel_reason ?? null

  return (
    <>
      <Breadcrumb
        items={[
          { label: 'BLs', to: listHref },
          { label: `B/L ${bl.id}` },
        ]}
      />
      <header className="app-bl-head">
        <div className="app-bl-head__copy">
          <p className="app-bl-head__eyebrow">
            <span>B/L</span>
            <span aria-hidden="true">·</span>
            <span>{cargoModeLabel(cargoMode)}</span>
            {cancelledAt ? <Badge tone="danger">Cancelado</Badge> : null}
          </p>
          <h1 className="app-bl-head__title">{bl.id}</h1>
          <p className="app-bl-head__context">
            {bl.voyage_id && voyageLabel ? <Link className="app-bl-link" to={`/viagens/${bl.voyage_id}`}>{voyageLabel}</Link> : <span>Sem viagem</span>}
            <span>{`${bl.pol ?? '—'} → ${bl.pod ?? '—'}`}</span>
            {bl.ce_mercante ? <span>CE <span className="app-bl-code">{bl.ce_mercante}</span></span> : null}
            {bl.customer?.name ? <span>{bl.customer.name}</span> : null}
          </p>
        </div>
        <div className="app-bl-head__actions">
          {hasContainers && canImport && !cancelledAt ? (
            <Button variant="secondary" onClick={() => setBlFreightOpen(true)}>
              <Upload size={16} aria-hidden="true" />
              Reimportar B/L
            </Button>
          ) : null}
          <ActionMenu
            label="Mais ações do B/L"
            menuId="bl-header-menu"
            triggerClassName="app-btn app-btn--secondary app-bl-head__more"
            trigger={<MoreHorizontal size={16} aria-hidden="true" />}
            items={headerMenu}
          />
        </div>
      </header>

      {cancelBlockedReasons && !cancelledAt ? (
        <div className="app-bl-notice app-bl-notice--warning app-bl-notice--row" role="alert">
          <span>
            <strong>O B/L {bl.id} não pode ser cancelado agora:</strong> {cancelBlockedReasons.join(', ')}. O Financeiro cancela ou estorna antes.
          </span>
          <Button variant="secondary" onClick={() => setCancelBlockedReasons(null)}>Fechar aviso</Button>
        </div>
      ) : null}

      {cancelledAt ? (
        <div className="app-bl-cancelled" role="status">
          <p>
            <strong>B/L cancelado em {formatDate(cancelledAt)}.</strong>{' '}
            Somente leitura: saiu do faturamento e aparece como Cancelado no Portal.
            {isAdmin ? ' Para desfazer, use Mais ações › Reativar B/L.' : ''}
          </p>
          {cancelReason ? <p className="app-bl-cancelled__reason">Motivo: {cancelReason}</p> : null}
        </div>
      ) : null}

      <BlRailsPipeline operational={operational} documental={documental} documentalSummary={documentalSummary} nextAction={pickNextAction(documental)} />

      <TabList label="Seções do B/L" className="app-bl-tabs">
        {BL_TABS.map((tab) => (
          <TabButton
            key={tab.key}
            id={`bl-tab-${tab.key}`}
            controls={tab.key === activeTab ? `bl-panel-${tab.key}` : undefined}
            active={tab.key === activeTab}
            label={tab.label}
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              if (tab.key === 'visao-geral') next.delete('tab')
              else next.set('tab', tab.key)
              setSearchParams(next, { replace: true })
            }}
          />
        ))}
      </TabList>

      <div id={`bl-panel-${activeTab}`} role="tabpanel" aria-labelledby={`bl-tab-${activeTab}`} className="app-bl-panel">
      {/* Abas montadas incondicionalmente (prop `active`) para preservar estado de formulários ao trocar de aba. */}
      <BlVisaoGeralTab
        active={activeTab === 'visao-geral'}
        bl={bl}
        cargoMode={cargoMode}
        containerSummary={containerSummary}
        breakbulkSummary={breakbulkSummary}
        omission={cockpitQuery.data?.omission}
        disposition={cockpitQuery.data?.transshipment?.disposition}
        savingDisposition={setTransshipment.isPending || setCod.isPending}
        onCod={canEditVoyages ? (justification) => {
          if (user?.id && bl?.voyage_id && cockpitQuery.data?.omission) setCod.mutate({ blId: bl.id, omissionId: cockpitQuery.data.omission.id, justification, changedBy: user.id })
        } : undefined}
        onRestore={canEditVoyages ? (justification) => {
          if (user?.id && bl?.voyage_id && cockpitQuery.data?.omission) setTransshipment.mutate({ blId: bl.id, omissionId: cockpitQuery.data.omission.id, justification, changedBy: user.id })
        } : undefined}
        portalStatus={portalStatus}
        portalStatusError={portalStatusError}
        onRetryPortalStatus={() => void refetchPortalStatus()}
        baplieStatus={baplieStatus}
        terminalOptions={terminalOptions}
        canEditTerminal={canEditVoyages}
        terminalOverrideSaving={terminalOverrideMutation.isPending}
        terminalOverrideError={terminalOverrideMutation.error instanceof Error ? terminalOverrideMutation.error.message : null}
        onSaveTerminalOverride={(input) => terminalOverrideMutation.mutate(input)}
      />
      <BlCargaTab
        active={activeTab === 'carga'}
        bl={bl}
        blId={blId}
        cargoMode={cargoMode}
        isContainerMode={isContainerMode}
        containerSummary={containerSummary}
        breakbulkSummary={breakbulkSummary}
        onChangeProfile={cancelledAt || isBlFinanciallyLocked(bl.financial_status) ? undefined : handleChangeContainerProfile}
        onChangeOwnership={cancelledAt || isBlFinanciallyLocked(bl.financial_status) ? undefined : handleChangeContainerOwnership}
        ownershipDivergences={ownershipDivergences}
      />

      <BlDetalhesTab
        active={activeTab === 'detalhes'}
        bl={bl}
        blId={blId}
        form={form}
        changes={changes}
        saving={saving}
        justification={justification}
        cargoMode={cargoMode}
        isContainerMode={isContainerMode}
        hasContainers={hasContainers}
        onFieldChange={setField}
        onJustificationChange={setJustification}
        onSubmit={handleSubmit}
      />

      <BlFaturamentoTab active={activeTab === 'faturamento'} bl={bl} activeInvoice={latestInvoice} demurrageInvoices={demurrageInvoices} />

      <BlHistoricoTab active={activeTab === 'historico'} blId={blId} />
      </div>

      <BlImportModal
        key={`${blFreightOpen ? 'open' : 'closed'}-${bl.voyage_id ?? 'none'}-${bl.id}`}
        open={blFreightOpen && canImport}
        onClose={() => setBlFreightOpen(false)}
        voyageId={bl.voyage_id}
        voyageLabel={voyageLabel || undefined}
        onlyBlId={bl.id}
      />
    </>
  )
}
