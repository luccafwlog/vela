import { Fragment, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { usePortalProvisioning } from '../hooks/usePortalProvisioning'
import { comparePriority, type QueueRow } from '../services/portalProvisioning'
import { PortalReviewPanel } from '../components/portal/PortalReviewPanel'
import { accountSituationLabel, getPortalNextAction, provisioningDecisionLabel } from '../lib/portalProvisioningViewModel'
import { exportPortalProvisioningWorkbook } from '../services/exports'
import { formatCnpjCpf } from '../lib/utils'
import { canonicalizeDocument } from '../lib/cnpj'

type Preset = 'todos' | 'aguardando_analise' | 'criticas' | 'sem_email' | 'convite_pendente' | 'convite_expirado' | 'falha_no_envio' | 'ativo'
const presets: Array<{ value: Preset; label: string }> = [
  { value: 'todos', label: 'Todos' }, { value: 'criticas', label: 'Pendências críticas' }, { value: 'aguardando_analise', label: 'Aguardando análise' },
  { value: 'sem_email', label: 'Sem email' }, { value: 'convite_pendente', label: 'Ativação pendente' }, { value: 'convite_expirado', label: 'Convites expirados' }, { value: 'falha_no_envio', label: 'Falhas de envio' },
  { value: 'ativo', label: 'Contas ativas' },
]

function matchesPreset(row: QueueRow, preset: Preset) {
  if (preset === 'todos') return true
  if (preset === 'criticas') return row.hasCriticalAlert
  if (preset === 'sem_email') return !row.recovery_email && row.candidates.length === 0
  if (preset === 'ativo') return row.account_situation === 'ativo'
  return row.account_situation === preset || row.provisioning_decision === preset
}

export function ClientesPortal() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data = [], isLoading, error, refetch } = usePortalProvisioning()
  const [search, setSearch] = useState('')
  const selectedCustomerId = Number(searchParams.get('cliente')) || null
  const preset = (searchParams.get('filtro') as Preset) || 'aguardando_analise'
  const selected = data.find((row) => row.customer_id === selectedCustomerId)
  const rowRefs = useRef(new Map<number, HTMLButtonElement>())
  const rows = useMemo(() => data.filter((row) => {
    const text = `${row.customer_name} ${row.cnpj_cpf}`.toLowerCase()
    const normalizedSearch = canonicalizeDocument(search)
    return (text.includes(search.toLowerCase()) || (normalizedSearch.length >= 2 && row.cnpj_cpf.includes(normalizedSearch))) && matchesPreset(row, preset)
  }).sort(comparePriority), [data, preset, search])
  const visibleRows = selected && !rows.some((row) => row.customer_id === selected.customer_id) ? [selected] : rows
  const presetCounts: Record<Preset, number> = useMemo(() => ({
    todos: data.length,
    criticas: data.filter((row) => row.hasCriticalAlert).length,
    aguardando_analise: data.filter((row) => row.provisioning_decision === 'aguardando_analise').length,
    sem_email: data.filter((row) => !row.recovery_email && !row.candidates.length).length,
    convite_pendente: data.filter((row) => row.account_situation === 'convite_pendente').length,
    convite_expirado: data.filter((row) => row.account_situation === 'convite_expirado').length,
    falha_no_envio: data.filter((row) => row.account_situation === 'falha_no_envio').length,
    ativo: data.filter((row) => row.account_situation === 'ativo').length,
  }), [data])

  function updateParams(update: (next: URLSearchParams) => void) {
    setSearchParams((current) => { const next = new URLSearchParams(current); update(next); return next }, { replace: true })
  }
  function selectPreset(value: Preset) { updateParams((next) => next.set('filtro', value)) }
  function returnToQueue() { updateParams((next) => { next.delete('cliente'); next.set('filtro', 'todos') }) }
  function toggleRow(row: QueueRow) {
    updateParams((next) => next.get('cliente') === String(row.customer_id) ? next.delete('cliente') : next.set('cliente', String(row.customer_id)))
  }
  function closeRow() {
    const closingId = selectedCustomerId
    updateParams((next) => next.delete('cliente'))
    if (closingId) requestAnimationFrame(() => rowRefs.current.get(closingId)?.focus())
  }

  return (
    <>
      <Breadcrumb items={[{ label: 'Clientes', to: '/clientes' }, { label: 'Provisionamento do Portal' }]} />
      <PageHeader
        title="Provisionamento do Portal"
        description="Fila operacional de análise, convites e situações do Portal."
        action={
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="app-btn app-btn--ghost app-btn--sm inline-flex items-center gap-1.5"
              aria-label="Exportar XLSX"
              title="Exportar XLSX"
              onClick={() => void exportPortalProvisioningWorkbook(rows)}
            >
              <Download size={15} aria-hidden="true" />
              <span>Exportar XLSX</span>
            </button>
            <Link className="app-touch-link text-sm text-cyan-300" to="/clientes">
              ← Voltar para Clientes
            </Link>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filtros de provisionamento">
          {presets.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={preset === item.value}
              className={`app-tab inline-flex items-center gap-1.5 ${preset === item.value ? 'app-tab--active' : ''}`}
              onClick={() => selectPreset(item.value)}
            >
              <span>{item.label}</span>
              <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                preset === item.value
                  ? 'bg-amber-400 text-slate-900 dark:bg-amber-300 dark:text-slate-950 font-bold'
                  : 'bg-[var(--app-surface-muted)] text-[var(--app-muted)]'
              }`}>
                {presetCounts[item.value]}
              </span>
            </button>
          ))}
        </div>
        <Input
          aria-label="Buscar cliente"
          className="min-w-64"
          placeholder="Buscar razão social ou CNPJ"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {selected && !rows.some((row) => row.customer_id === selected.customer_id) ? <div className="mb-3 flex items-center justify-between rounded-lg border border-cyan-400/30 bg-cyan-400/5 px-3 py-2 text-sm">Cliente selecionado fora do filtro atual.<button type="button" className="text-cyan-300 underline" onClick={returnToQueue}>Voltar para a fila</button></div> : null}
      {error ? <InlineError message="Erro ao carregar a fila do Portal." /> : null}
      <Card className="overflow-hidden p-0">
        <div className="app-table-scroll"><table className="app-table app-table--compact min-w-[900px] text-left text-sm"><thead><tr><th>Cliente</th><th>Situação</th><th>Decisão</th><th>Email de Recuperação</th><th>Alertas</th><th>Próxima ação</th></tr></thead><tbody>
          {isLoading ? <tr><td colSpan={6} className="px-4 py-8 text-center">Carregando fila...</td></tr> : null}
          {!isLoading && !visibleRows.length ? <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--app-muted)]">Nenhum cliente neste filtro.</td></tr> : null}
          {visibleRows.map((row) => {
            const expanded = selectedCustomerId === row.customer_id
            return <Fragment key={row.customer_id}>
              <tr className={expanded ? 'bg-cyan-400/10' : 'cursor-pointer'} onClick={() => toggleRow(row)}>
                <td className="px-4 py-3"><button ref={(element) => { if (element) rowRefs.current.set(row.customer_id, element); else rowRefs.current.delete(row.customer_id) }} type="button" className="text-left" aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); toggleRow(row) }}><div className="font-medium">{row.customer_name}</div><div className="font-mono text-xs text-[var(--app-muted)]">{formatCnpjCpf(row.cnpj_cpf)}</div></button></td>
                <td className="px-4 py-3"><Badge tone={row.account_situation === 'ativo' ? 'green' : row.account_situation === 'falha_no_envio' ? 'red' : 'yellow'}>{accountSituationLabel(row.account_situation)}</Badge></td>
                <td className="px-4 py-3">{provisioningDecisionLabel(row.provisioning_decision)}</td><td className="px-4 py-3">{row.recovery_email ?? (row.candidates[0]?.email ?? 'Sem email')}</td>
                <td className="px-4 py-3">{row.hasCriticalAlert ? 'Crítico' : '—'}</td><td className="px-4 py-3">{getPortalNextAction(row)}</td>
              </tr>
              {expanded ? <tr><td colSpan={6} className="bg-[var(--app-surface-muted)] p-4"><PortalReviewPanel row={row} variant="inline" onClose={closeRow} onSaved={() => void refetch()} /></td></tr> : null}
            </Fragment>
          })}
        </tbody></table></div>
      </Card>
    </>
  )
}
