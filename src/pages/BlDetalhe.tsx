/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Upload } from 'lucide-react'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import { Badge } from '../components/ui/Badge'
import { Card, PageHeader } from '../components/ui/Card'
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
import { ImportResultPanel } from '../components/shared/ImportResultPanel'
import { Button } from '../components/ui/Button'
import { useBlDetail } from '../hooks/useBls'
import { useBlEditForm } from '../hooks/useBlEditForm'
import { useBlCockpit } from '../hooks/useBlCockpit'
import { useAuth } from '../hooks/useAuth'
import { useSetBlDisposition } from '../hooks/useTransshipments'
import { useInvoiceLinks } from '../hooks/useBilling'
import { extractReviewReasons } from '../hooks/useReview'
import { listDemurrageInvoices } from '../services/demurrage/demurrageInvoices'
import { listDepots } from '../services/depots'
import { setBlTerminalOverride } from '../services/blTerminal'
import { buildDocumentalRail, buildOperationalRail, pickNextAction, summarizeDocumentalRail } from '../services/blRails'
import { getBlPortalStatus } from '../services/blPortalStatus'
import { queryKeys } from '../services/queryKeys'
import { useVoyageReconciliation } from '../hooks/useVoyageReconciliation'
import { cargoModeLabel, resolveCargoMode } from './blDetalheHelpers'

export type BlTab = 'visao-geral' | 'carga' | 'detalhes' | 'faturamento' | 'historico'

const BL_TAB_KEYS: BlTab[] = ['visao-geral', 'carga', 'detalhes', 'faturamento', 'historico']

// 'Carga' era uma seção no fim da aba "Detalhes do B/L", abaixo de um
// formulário de ~25 campos: ver os contêineres ou os itens de carga solta de um
// B/L custava quatro interações e uma rolagem. É o dado mais operacional da
// ficha e agora tem aba própria, logo após a visão geral.
export const BL_TABS: { key: BlTab; label: string }[] = [
  { key: 'visao-geral', label: 'Visão Geral' },
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
  const tabParam = searchParams.get('tab')
  const activeTab: BlTab = isBlTab(tabParam) ? tabParam : 'visao-geral'
  const { data: bl, isLoading, error } = useBlDetail(blId)
  const { user, profile } = useAuth()
  const queryClient = useQueryClient()
  const canEditVoyages = Boolean(profile || user)
  const canImport = Boolean(profile || user)
  const { setTransshipment, setCod } = useSetBlDisposition(bl?.voyage_id ?? 0)
  const cockpitQuery = useBlCockpit(bl)
  const { data: invoiceLinksByBl } = useInvoiceLinks(bl?.id ? [bl.id] : [])
  const { data: demurrageInvoices } = useQuery({
    queryKey: queryKeys.demurrage.invoices({ blId: bl?.id }),
    enabled: Boolean(bl?.id),
    queryFn: () => listDemurrageInvoices({ blId: bl!.id }),
  })
  const { data: portalStatus } = useQuery({
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
  const cargoMode = useMemo(() => resolveCargoMode(bl), [bl])
  const isContainerMode = cargoMode === 'container'
  const isMixedMode = cargoMode === 'misto'
  const hasContainers = isContainerMode || isMixedMode
  const { data: reconciliation, isLoading: reconciliationLoading, isError: reconciliationError } = useVoyageReconciliation(hasContainers ? bl?.voyage_id : null)
  const backHref = '/bls'
  const backLabel = 'Voltar aos BLs'
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
    return reconciliation.items.filter((item) => item.kind === 'missing_in_baplie' ? item.bl_id === bl.id : item.baplie_bl_ref === bl.id || numbers.has(item.container_number)).length
  }, [reconciliation, bl])

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
        <Breadcrumb items={[{ label: 'BLs', to: '/bls' }, { label: 'Carregando...' }]} />
        <SkeletonCard lines={5} />
      </>
    )
  }

  if (error || !bl || !form) {
    return (
      <>
        <Breadcrumb
          items={[
            { label: 'BLs', to: '/bls' },
            { label: 'B/L não encontrado' },
          ]}
        />
        <PageHeader
          title="Detalhes do B/L"
          description="Consulta de informações do conhecimento de embarque."
          action={
            <Link className="text-sm font-semibold text-[var(--app-link)] hover:underline" to="/bls">
              <ArrowLeft className="mr-1 inline" size={16} />Voltar para BLs
            </Link>
          }
        />
        <Card className="text-red-200">B/L não encontrado ou erro ao consultar o Supabase.</Card>
      </>
    )
  }

  return (
    <>
      <Breadcrumb
        items={[
          { label: 'BLs', to: '/bls' },
          { label: `B/L ${bl.id}` },
        ]}
      />
      {/* A modalidade estava só no texto do título, concatenada com um hífen.
          Agora é um badge com tom próprio, ao lado do identificador — a mesma
          leitura de relance que a coluna Carga dá na lista. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={cargoMode === 'misto' ? 'yellow' : cargoMode === 'carga_solta' ? 'green' : 'blue'}>
          {cargoModeLabel(cargoMode)}
        </Badge>
      </div>
      <PageHeader
        title={`B/L ${bl.id}`}
        description={
          isMixedMode
            ? 'Edição manual com auditoria. Esta tela exibe containers, carga solta e veículos vinculados a este B/L misto.'
            : isContainerMode
              ? 'Edição manual com auditoria. Esta tela exibe containers e veículos vinculados a este B/L.'
              : 'Edição manual com auditoria. Esta tela exibe o resumo operacional do manifesto BB vinculado a este B/L.'
        }
        action={
          <div className="flex flex-wrap justify-end gap-2">
            {hasContainers && canImport ? (
              <Button variant="secondary" onClick={() => setBlFreightOpen(true)}>
                <Upload size={16} />
                Importar B/L
              </Button>
            ) : null}
            <Link className="text-sm font-semibold text-[#58a6ff] hover:underline" to={backHref}>
              <ArrowLeft className="mr-1 inline" size={16} />
              {backLabel}
            </Link>
          </div>
        }
      />

      <div className="mb-5">
        <BlRailsPipeline operational={operational} documental={documental} documentalSummary={documentalSummary} nextAction={pickNextAction(documental)} />
      </div>

      <div className="mb-5 grid gap-3">
        <ImportResultPanel entityId={bl.id} />
        {hasContainers && bl.voyage_id != null ? (
          <ImportResultPanel entityId={String(bl.voyage_id)} title="Processamento físico da viagem" />
        ) : null}
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-[#30363d]">
        {BL_TABS.map((tab) => {
          const isActive = tab.key === activeTab
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                const next = new URLSearchParams(searchParams)
                if (tab.key === 'visao-geral') next.delete('tab')
                else next.set('tab', tab.key)
                setSearchParams(next, { replace: true })
              }}
              className={`px-4 py-2 text-sm font-semibold transition-colors ${
                isActive
                  ? 'border-b-2 border-[#1f6feb] text-white'
                  : 'border-b-2 border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Abas montadas incondicionalmente (prop `active`) para preservar estado de formulários ao trocar de aba. */}
      <BlVisaoGeralTab
        active={activeTab === 'visao-geral'}
        bl={bl}
        cockpit={cockpitQuery.data}
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

      <BlFaturamentoTab active={activeTab === 'faturamento'} bl={bl} />

      <BlHistoricoTab active={activeTab === 'historico'} blId={blId} />

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
