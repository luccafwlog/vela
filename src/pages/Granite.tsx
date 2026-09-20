import { useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Mountain, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { PreviewBox } from '../components/ui/PreviewBox'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { useToast } from '../components/ui/Toast'
import { TruncationNote } from '../components/shared/TruncationNote'
import { CeMercanteImportModal } from '../components/shared/CeMercanteImportModal'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { useAuth } from '../hooks/useAuth'
import { useCancellableFileRead } from '../hooks/useCancellableFileRead'
import { PAGE_SIZES, usePageFilters } from '../hooks/usePageFilters'
import {
  parseGraniteManifestFile,
  importGraniteManifest,
  type ParsedGraniteManifest,
  type ReconciliationStatus,
} from '../services/graniteImport'
import { listGraniteBls, calculateGraniteBlCharges } from '../services/graniteCharges'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { canonicalizeDocument, normalizeCnpj } from '../lib/cnpj'
import { loadCustomerMaps, findMatchedCustomer, resolveCustomerLink } from '../services/customerReconciliation'
import { rowErrorsToImportIssues } from '../services/importValidation'
import { ImportIssuesPanel } from '../components/shared/ImportIssuesPanel'
import { ImportReadProgress } from '../components/shared/ImportReadProgress'
import { ImportResultPanel } from '../components/shared/ImportResultPanel'

type Filters = {
  search: string
  voyageId: string
  dischargePort: string
  page: number
  pageSize: number
}

export function Granite() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const canWrite = Boolean(profile || user)
  const { showToast } = useToast()
  const initialVoyageId = searchParams.get('voyage') ?? ''

  const { filters, updateFilter } = usePageFilters<Filters>({
    search: '',
    voyageId: initialVoyageId,
    dischargePort: '',
    page: 1,
    pageSize: 20,
  })

  const [uploadOpen, setUploadOpen] = useState(false)
  const [ceMercanteOpen, setCeMercanteOpen] = useState(false)
  const [voyageId, setVoyageId] = useState(initialVoyageId)
  const { file, preview: manifest, parsing, progress, readFile, cancel: cancelReading, updatePreview } = useCancellableFileRead<ParsedGraniteManifest>(parseGraniteManifestFile)
  const [submitting, setSubmitting] = useState(false)
  // Overrides de CNPJ feitos inline no preview
  const [cnpjOverrides, setCnpjOverrides] = useState<Record<number, string>>({})
  const [chargeBlId, setChargeBlId] = useState<string | null>(null)
  const [resultBlId, setResultBlId] = useState<string | null>(null)
  const [chargeLines, setChargeLines] = useState<Array<{ description: string | null; charge_type: string | null; quantity: number | null; unit_value: number | null; subtotal: number | null; currency: string | null }>>([])

  const { data, isLoading, error } = useQuery({
    queryKey: ['granite-bls', filters],
    queryFn: () => listGraniteBls(filters),
  })

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setCnpjOverrides({})
    try {
      const parsed = await readFile(nextFile)
      if (!parsed) return
      showToast('Preview carregado.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao ler arquivo.', 'error')
    }
  }

  async function handleCnpjOverride(rowIndex: number, cnpj: string) {
    setCnpjOverrides((prev) => ({ ...prev, [rowIndex]: cnpj }))
    if (!manifest) return
    const canonical = canonicalizeDocument(cnpj)
    if (canonical.length < 14) return
    const maps = await loadCustomerMaps()
    const bl = manifest.bls[rowIndex]
    const match = findMatchedCustomer({ cnpjCpf: cnpj, consignee: bl.shipper_name ?? '' }, maps)
    const link = resolveCustomerLink(match)
    if (link.status !== 'missing_customer') {
      updatePreview((currentManifest) => ({
        ...currentManifest,
        bls: currentManifest.bls.map((b, i) =>
          i === rowIndex
            ? {
                ...b,
                shipper_cnpj: cnpj,
                clientId: link.customerId,
                suggestedClientId: link.suggestedCustomerId,
                reconciliationStatus: link.status === 'matched_document' ? 'matched' as ReconciliationStatus : 'suggested_name' as ReconciliationStatus,
              }
            : b,
        ),
      }))
    }
  }

  async function handleImport() {
    if (!manifest || manifest.rowErrors.length > 0 || !voyageId || !user) return
    setSubmitting(true)
    try {
      const { pendingCount } = await importGraniteManifest({
        filename: file?.name ?? 'granito.xlsx',
        voyageId: Number(voyageId),
        manifest,
        uploadedBy: user.id,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        // P0-4: a seção "Carga carregada" do ADR soma peso/blocos de
        // granite_bls; sem esta linha, o import não refletia na aba.
        queryClient.invalidateQueries({ queryKey: ['agency-report'] }),
      ])
      const msg = pendingCount
        ? `Importado com ${manifest.bls.length} B/Ls. ${pendingCount} com reconciliação pendente.`
        : `${manifest.bls.length} B/Ls importados com sucesso.`
      showToast(msg, 'success')
      closeUpload()
      setVoyageId('')
      setCnpjOverrides({})
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  function closeUpload() {
    cancelReading()
    setUploadOpen(false)
  }

  async function handleCalculateCharges(blId: string) {
    try {
      const lines = await calculateGraniteBlCharges(blId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
      setChargeLines(lines)
      setChargeBlId(blId)
      showToast('Quantidades operacionais do Granito calculadas.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao calcular taxas.', 'error')
    }
  }

  const pendingInManifest = manifest?.bls.filter((bl) => bl.reconciliationStatus !== 'matched').length ?? 0
  const activeFilterCount = [filters.search, filters.voyageId, filters.dischargePort]
    .filter((value) => String(value ?? '').trim() !== '').length
  const filterDescription = describeActiveFilters([
    { label: 'Texto', value: filters.search },
    { label: 'Viagem', value: filters.voyageId },
    { label: 'Porto', value: filters.dischargePort },
  ])
  const emptyState = describeEmptyState({
    entitySingular: 'B/L de granito',
    entityPlural: 'B/Ls de granito',
    hasActiveFilters: activeFilterCount > 0,
    emptyWithoutFilters: 'Nenhum B/L de granito importado ainda.',
    emptyWithFilters: 'Nenhum B/L de granito encontrado.',
  })

  return (
    <>
      <PageHeader
        title="Manifestos Granito"
        description="Importação do relatório de cargas COSCO (Granito)."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#21262d] px-4 text-sm font-semibold text-slate-100 transition hover:bg-[#30363d]"
              to="/granito/taxas"
            >
              <Mountain size={16} />
              Tabela de Taxas — Granito
            </Link>
            {canWrite ? (
              <>
                <Button variant="secondary" onClick={() => setCeMercanteOpen(true)}>
                  <Upload size={16} />
                  Importar CE Mercante
                </Button>
                <Button onClick={() => setUploadOpen(true)}>
                  <Upload size={16} />
                  Importar Planilha COSCO
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Texto livre">
            <Input
              placeholder="B/L, Shipper ou CNPJ"
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
            />
          </Field>
          <VoyageCombobox
            clearable
            label="Viagem"
            selectedVoyageId={filters.voyageId}
            onSelect={(id) => updateFilter('voyageId', id == null ? '' : String(id))}
          />
          <Field label="Porto de descarga">
            <Input
              placeholder="Ex: ITMDX"
              value={filters.dischargePort}
              onChange={(e) => updateFilter('dischargePort', e.target.value)}
            />
          </Field>
          <Field label="Por página">
            <Select value={filters.pageSize} onChange={(e) => updateFilter('pageSize', Number(e.target.value))}>
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>{s}/pag.</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-1 border-b border-[#30363d] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-white">{formatResultCount(data?.count ?? 0, 'B/L retornado', 'B/Ls retornados')}</span>
          <span className="text-xs text-slate-400">{filterDescription}</span>
        </div>
        {error ? <InlineError message="Erro ao carregar B/Ls de granito." /> : null}

        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1200px] text-left text-sm whitespace-nowrap">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">B/L</th>
                <th scope="col" className="px-4 py-3">Booking</th>
                <th scope="col" className="px-4 py-3">Shipper</th>
                <th scope="col" className="px-4 py-3">CNPJ</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="px-4 py-3">Peso Real (kg)</th>
                <th scope="col" className="px-4 py-3">Peso Real (ton)</th>
                <th scope="col" className="px-4 py-3">CBM Final</th>
                <th scope="col" className="px-4 py-3">Fase</th>
                <th scope="col" className="px-4 py-3">Status Taxas</th>
                <th scope="col" className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={11}>
                    Carregando...
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-0">
                    <EmptyState title={emptyState.title} description={emptyState.description} />
                  </td>
                </tr>
              ) : null}
              {(data?.rows ?? []).map((bl) => (
                <tr key={bl.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-[#58a6ff]">{bl.bl_number}</td>
                  <td className="px-4 py-3">{bl.booking_number ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span className="app-table__truncate app-table__truncate--lg" title={bl.shipper_name ?? '-'}>
                      {(bl as { customer?: { name?: string } }).customer?.name ?? bl.shipper_name ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{bl.shipper_cnpj ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span className="app-table__truncate app-table__truncate--xl" title={bl.vessel_voyage ?? '-'}>
                      {bl.vessel_voyage ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{bl.real_weight_kg != null ? Number(bl.real_weight_kg).toLocaleString('pt-BR') : '-'}</td>
                  <td className="px-4 py-3">
                    {bl.real_weight_kg != null ? Number(Number(bl.real_weight_kg) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 }) : '-'}
                  </td>
                  <td className="px-4 py-3">{bl.final_m3 != null ? Number(bl.final_m3).toLocaleString('pt-BR') : '-'}</td>
                  <td className="px-4 py-3">{bl.phase ?? '-'}</td>
                  <td className="px-4 py-3">
                    <ChargeStatusBadge status={bl.charge_status} />
                  </td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <>
                        <button
                          className="app-table__action mr-2"
                          onClick={() => handleCalculateCharges(bl.id)}
                        >
                          Calcular taxas
                        </button>
                        <button
                          className="app-table__action"
                          onClick={() => setResultBlId(bl.id)}
                        >
                          Ver resultado
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <TableFooterPagination
          page={filters.page}
          pageSize={filters.pageSize}
          totalCount={data?.count ?? 0}
          totalPages={totalPages}
          countLabel={`${data?.count ?? 0} registros`}
          onPageChange={(page) => updateFilter('page', page)}
        />
      </Card>

      {/* Modal de taxas calculadas */}
      <Modal open={chargeBlId !== null} onClose={() => { setChargeBlId(null); setChargeLines([]) }} title="Taxas do B/L">
        {chargeLines.length === 0 ? (
          <p className="app-panel__meta">Nenhuma taxa ativa cadastrada. <a href="/granito/taxas">Acesse Granito &gt; Taxas</a> para cadastrar.</p>
        ) : (
          <div className="app-table-scroll">
            <table className="app-table app-table--compact w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2">Taxa</th>
                  <th scope="col" className="px-3 py-2">Tipo</th>
                  <th scope="col" className="px-3 py-2">Quantidade</th>
                  <th scope="col" className="px-3 py-2">Valor Unit.</th>
                  <th scope="col" className="px-3 py-2">Subtotal</th>
                  <th scope="col" className="px-3 py-2">Moeda</th>
                </tr>
              </thead>
              <tbody>
                {chargeLines.map((line, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{line.description ?? '-'}</td>
                    <td className="px-3 py-2">{line.charge_type ?? '-'}</td>
                    <td className="px-3 py-2">{line.quantity != null ? Number(line.quantity).toLocaleString('pt-BR') : '-'}</td>
                    <td className="px-3 py-2">{line.unit_value != null ? Number(line.unit_value).toLocaleString('pt-BR', { minimumFractionDigits: 4 }) : '-'}</td>
                    <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{line.subtotal != null ? Number(line.subtotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}</td>
                    <td className="px-3 py-2">{line.currency ?? 'BRL'}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[#58a6ff]/30">
                  <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase text-[var(--app-muted)]">Total</td>
                  <td className="px-3 py-2 font-bold text-[#58a6ff]">
                    {chargeLines.reduce((sum, l) => sum + Number(l.subtotal ?? 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2">BRL</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div className="app-modal__actions">
          <p className="mr-auto text-sm text-[var(--app-muted)]">O apoio quantitativo permanece operacional; revise o cliente e recalcule os dados quando necessário.</p>
          <Button variant="ghost" onClick={() => { setChargeBlId(null); setChargeLines([]) }}>
            Fechar
          </Button>
        </div>
      </Modal>

      <Modal open={resultBlId !== null} onClose={() => setResultBlId(null)} title="Resultado persistido do B/L">
        <ImportResultPanel entityId={resultBlId} alwaysVisible />
        <div className="app-modal__actions">
          <Button variant="ghost" onClick={() => setResultBlId(null)}>Fechar</Button>
        </div>
      </Modal>

      {/* Modal de importação */}
      <Modal open={uploadOpen && canWrite} onClose={closeUpload} title="Importar Planilha COSCO — Granito">
        <div className="grid gap-5">
          <div className="app-panel app-panel--padded text-sm">
            <div className="app-panel__title">Formato esperado</div>
            <div className="app-panel__meta mt-2">
              Planilha "Relatorio de Cargas/Booking" exportada pela COSCO. Colunas obrigatorias: <strong>BL</strong> e <strong>Real Weight</strong>.
              CNPJ pode vir vazio — resolva antes de confirmar.
            </div>
          </div>

          <VoyageCombobox
            required
            label="Viagem de destino"
            selectedVoyageId={voyageId}
            onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
          />

          <Field label="Arquivo .xls / .xlsx">
            <Input accept=".xlsx,.xls" type="file" onChange={handleFile} />
          </Field>

          {parsing ? <ImportReadProgress progress={progress} /> : null}

          {manifest ? (
            <div className="grid gap-4">
              <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
                <PreviewBox label="B/Ls validos" value={manifest.bls.length} />
                <PreviewBox label="Peso Real total (ton)" value={manifest.bls.reduce((s, b) => s + b.real_weight_kg / 1000, 0)} decimals={3} />
                <PreviewBox label="Erros de parser" value={manifest.rowErrors.length} />
              </div>

              {pendingInManifest > 0 ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  {pendingInManifest} B/L(s) sem cliente resolvido. Preencha os CNPJs abaixo ou confirme importar com reconciliação pendente.
                </div>
              ) : null}

              <div className="app-table-scroll max-h-80 rounded-xl border border-[var(--app-border)]">
                <table className="app-table app-table--compact min-w-[900px] text-left text-sm whitespace-nowrap">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">Status</th>
                      <th scope="col" className="px-3 py-2">BL</th>
                      <th scope="col" className="px-3 py-2">Shipper</th>
                      <th scope="col" className="px-3 py-2">CNPJ</th>
                      <th scope="col" className="px-3 py-2">Peso Real (kg)</th>
                      <th scope="col" className="px-3 py-2">Fase</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manifest.bls.slice(0, 50).map((bl, idx) => (
                      <tr key={bl.bl_number}>
                        <td className="px-3 py-2">
                          <ReconciliationBadge status={bl.reconciliationStatus} />
                        </td>
                        <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{bl.bl_number}</td>
                        <td className="px-3 py-2">
                          <span className="app-table__truncate app-table__truncate--lg">{bl.shipper_name ?? '-'}</span>
                        </td>
                        <td className="px-3 py-2">
                          {bl.reconciliationStatus !== 'matched' ? (
                            <Input
                              placeholder="Digite o CNPJ"
                              className="w-40 text-xs"
                              value={cnpjOverrides[idx] ?? ''}
                              maxLength={14}
                              onChange={(e) => handleCnpjOverride(idx, normalizeCnpj(e.target.value))}
                            />
                          ) : (
                            bl.shipper_cnpj ?? '-'
                          )}
                        </td>
                        <td className="px-3 py-2">{Number(bl.real_weight_kg).toLocaleString('pt-BR')}</td>
                        <td className="px-3 py-2">{bl.phase ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TruncationNote shown={50} total={manifest.bls.length} noun="B/L" nounPlural="B/Ls" />

              <ImportIssuesPanel issues={rowErrorsToImportIssues(manifest.rowErrors)} filename="granito-issues.csv" />
            </div>
          ) : null}

          <div className="app-modal__actions">
            <Button variant="secondary" disabled={submitting} onClick={parsing ? cancelReading : closeUpload}>{parsing ? 'Cancelar leitura' : 'Cancelar'}</Button>
            <Button disabled={!manifest || manifest.rowErrors.length > 0 || !voyageId || !user} loading={submitting} onClick={handleImport}>
              Confirmar importação
            </Button>
          </div>
        </div>
      </Modal>

      <CeMercanteImportModal
        open={ceMercanteOpen && canWrite}
        target="granite"
        lockedVoyageId={filters.voyageId ? Number(filters.voyageId) : undefined}
        onClose={() => setCeMercanteOpen(false)}
      />
    </>
  )
}

function ChargeStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'calculated': return <span className="app-badge app-badge--blue">Calculado</span>
    case 'ready_for_billing': return <span className="app-badge app-badge--blue">Calculado (legado)</span>
    case 'invoiced': return <span className="app-badge app-badge--slate">Estado legado</span>
    default: return <span className="app-badge app-badge--slate">Não calc.</span>
  }
}

function ReconciliationBadge({ status }: { status: ReconciliationStatus }) {
  switch (status) {
    case 'matched': return <span className="app-badge app-badge--green">✓ OK</span>
    case 'suggested_name': return <span className="app-badge app-badge--yellow">Sugestão</span>
    case 'missing_cnpj': return <span className="app-badge app-badge--yellow">⚠ CNPJ</span>
    case 'not_found': return <span className="app-badge app-badge--red">✗ Não cad.</span>
  }
}
