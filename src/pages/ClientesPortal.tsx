import { Fragment, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download, Eye } from 'lucide-react'
import { InlineError, PageHeader } from '../components/ui/Card'
import { Block } from '../components/ui/Block'
import { Button } from '../components/ui/Button'
import { CopyValue } from '../components/ui/CopyValue'
import { MetricCard } from '../components/ui/MetricCard'
import { NoValue } from '../components/ui/NoValue'
import { StatusText } from '../components/ui/StatusText'
import { Field, Input, Select } from '../components/ui/Input'
import { usePortalProvisioning } from '../hooks/usePortalProvisioning'
import { ClientesTabs } from '../components/customers/ClientesTabs'
import { comparePriority, type QueueRow } from '../services/portalProvisioning'
import { PortalReviewPanel } from '../components/portal/PortalReviewPanel'
import { accountSituationLabel, getPortalNextAction } from '../lib/portalProvisioningViewModel'
import { exportPortalProvisioningWorkbook } from '../services/exports'
import { formatCnpjCpf } from '../lib/utils'
import { canonicalizeDocument } from '../lib/cnpj'

// Seis cartões que filtram (lote 5a). "Todos" é nenhum cartão marcado; o
// alerta crítico virou o filtro Alerta.
type Preset = 'todos' | 'aguardando_analise' | 'sem_email' | 'convite_pendente' | 'convite_expirado' | 'falha_no_envio' | 'ativo'
const presets: Array<{ value: Exclude<Preset, 'todos'>; label: string; detail: string; asksAction: boolean }> = [
  { value: 'aguardando_analise', label: 'Aguardando análise', detail: 'sem decisão', asksAction: true },
  { value: 'sem_email', label: 'Sem e-mail', detail: 'nenhum contato com e-mail', asksAction: true },
  { value: 'convite_pendente', label: 'Ativação pendente', detail: 'convite enviado', asksAction: false },
  { value: 'convite_expirado', label: 'Convite expirado', detail: 'reenviar', asksAction: true },
  { value: 'falha_no_envio', label: 'Falha de envio', detail: 'revisar o e-mail', asksAction: true },
  { value: 'ativo', label: 'Contas ativas', detail: 'no Portal', asksAction: false },
]

function isPreset(value: string | null): value is Preset {
  return value === 'todos' || presets.some((item) => item.value === value)
}

function matchesPreset(row: QueueRow, preset: Preset) {
  if (preset === 'todos') return true
  if (preset === 'sem_email') return !row.recovery_email && row.candidates.length === 0
  if (preset === 'ativo') return row.account_situation === 'ativo'
  return row.account_situation === preset || row.provisioning_decision === preset
}

function situationTone(row: QueueRow) {
  if (row.account_situation === 'falha_no_envio') return 'danger' as const
  if (row.account_situation === 'ativo' || row.account_situation === 'convite_pendente') return 'default' as const
  return 'warning' as const
}

export function ClientesPortal() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data = [], isLoading, error, refetch } = usePortalProvisioning()
  const search = searchParams.get('busca') ?? ''
  const selectedCustomerId = Number(searchParams.get('cliente')) || null
  // "Pendências críticas" era um filtro do topo; quem chega com ele no
  // endereço cai em "todos" com o filtro Alerta ligado.
  const rawPreset = searchParams.get('filtro')
  const criticalOnly = searchParams.get('alerta') === 'critico' || rawPreset === 'criticas'
  const preset: Preset = isPreset(rawPreset) ? rawPreset : rawPreset === 'criticas' ? 'todos' : 'aguardando_analise'
  const selected = data.find((row) => row.customer_id === selectedCustomerId)
  const rowRefs = useRef(new Map<number, HTMLButtonElement>())
  const rows = useMemo(() => data.filter((row) => {
    const text = `${row.customer_name} ${row.cnpj_cpf}`.toLowerCase()
    const normalizedSearch = canonicalizeDocument(search)
    return (text.includes(search.toLowerCase()) || (normalizedSearch.length >= 2 && row.cnpj_cpf.includes(normalizedSearch)))
      && matchesPreset(row, preset)
      && (!criticalOnly || row.hasCriticalAlert)
  }).sort(comparePriority), [criticalOnly, data, preset, search])
  const visibleRows = selected && !rows.some((row) => row.customer_id === selected.customer_id) ? [selected] : rows
  const presetCounts = useMemo(() => presets.reduce((counts, item) => {
    counts[item.value] = data.filter((row) => matchesPreset(row, item.value)).length
    return counts
  }, {} as Record<Preset, number>), [data])
  const hasFilters = preset !== 'aguardando_analise' || criticalOnly || search.trim().length > 0
  const presetLabel = presets.find((item) => item.value === preset)?.label ?? 'Todos os Clientes'

  function updateParams(update: (next: URLSearchParams) => void) {
    setSearchParams((current) => { const next = new URLSearchParams(current); update(next); return next }, { replace: true })
  }
  function selectPreset(value: Preset) {
    updateParams((next) => next.set('filtro', next.get('filtro') === value ? 'todos' : value))
  }
  function returnToQueue() { updateParams((next) => { next.delete('cliente'); next.set('filtro', 'todos') }) }
  function toggleRow(row: QueueRow) {
    updateParams((next) => next.get('cliente') === String(row.customer_id) ? next.delete('cliente') : next.set('cliente', String(row.customer_id)))
  }
  function closeRow() {
    const closingId = selectedCustomerId
    updateParams((next) => next.delete('cliente'))
    if (closingId) requestAnimationFrame(() => rowRefs.current.get(closingId)?.focus())
  }
  function clearFilters() {
    updateParams((next) => { next.delete('busca'); next.delete('alerta'); next.set('filtro', 'aguardando_analise') })
  }

  return (
    <>
      <PageHeader
        title="Provisionamento do Portal"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link className="app-btn app-btn--secondary" to="/clientes/informacoes">Informações do Portal</Link>
            <Button variant="secondary" onClick={() => void exportPortalProvisioningWorkbook(rows)}>
              <Download size={15} aria-hidden="true" />
              Exportar
            </Button>
          </div>
        }
      />
      <ClientesTabs active="portal" />

      <div className="app-metric-row" role="group" aria-label="Filtros de provisionamento">
        {presets.map((item) => (
          <MetricCard
            key={item.value}
            label={item.label}
            value={presetCounts[item.value]}
            detail={item.detail}
            tone={item.asksAction && presetCounts[item.value] > 0 ? 'warning' : 'secondary'}
            onSelect={() => selectPreset(item.value)}
            selected={preset === item.value}
          />
        ))}
      </div>

      <div className="app-filter-grid mb-4">
        <Field label="Busca">
          <Input
            type="search"
            placeholder="Razão social ou CNPJ"
            value={search}
            onChange={(event) => updateParams((next) => { if (event.target.value) next.set('busca', event.target.value); else next.delete('busca') })}
          />
        </Field>
        <Field label="Alerta">
          <Select value={criticalOnly ? 'critico' : ''} onChange={(event) => updateParams((next) => {
            if (event.target.value) next.set('alerta', event.target.value); else next.delete('alerta')
            if (next.get('filtro') === 'criticas') next.set('filtro', 'todos')
          })}>
            <option value="">Todos</option>
            <option value="critico">Com alerta crítico</option>
          </Select>
        </Field>
        {hasFilters ? <div><Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button></div> : null}
      </div>

      {selected && !rows.some((row) => row.customer_id === selected.customer_id) ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <StatusText tone="muted">Cliente aberto fora do filtro atual.</StatusText>
          <Button type="button" variant="secondary" className="app-btn--sm" onClick={returnToQueue}>Voltar para a fila</Button>
        </div>
      ) : null}
      {error ? <InlineError message="Erro ao carregar a fila do Portal." /> : null}

      <Block title={presetLabel} aside={`${visibleRows.length} ${visibleRows.length === 1 ? 'Cliente' : 'Clientes'}`} flush>
        <div className="app-table-scroll">
          <table className="app-table min-w-[900px]">
            <caption className="sr-only">Fila de acesso ao Portal por Cliente</caption>
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Abrir</span></th>
                <th scope="col" className="app-table__text-head">Cliente</th>
                <th scope="col">CNPJ</th>
                <th scope="col">Conta</th>
                <th scope="col" className="app-table__text-head">E-mail de recuperação</th>
                <th scope="col">Alerta</th>
                <th scope="col">Ação</th>
                <th scope="col">Espiadinha</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? <tr><td colSpan={8} className="px-4 py-8 text-[var(--app-muted)]">Carregando a fila...</td></tr> : null}
              {!isLoading && !visibleRows.length ? <tr><td colSpan={8} className="px-4 py-8 text-[var(--app-muted)]">Nenhum Cliente neste filtro.</td></tr> : null}
              {visibleRows.map((row) => {
                const expanded = selectedCustomerId === row.customer_id
                return <Fragment key={row.customer_id}>
                  <tr>
                    <td>
                      <button
                        ref={(element) => { if (element) rowRefs.current.set(row.customer_id, element); else rowRefs.current.delete(row.customer_id) }}
                        type="button"
                        className="app-table__icon-button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Recolher' : 'Abrir'} a conta do Portal de ${row.customer_name}`}
                        onClick={() => toggleRow(row)}
                      >
                        {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                      </button>
                    </td>
                    <td className="app-table__text">
                      <button type="button" className="app-link text-left" onClick={() => toggleRow(row)}>{row.customer_name}</button>
                    </td>
                    <td className="font-mono"><CopyValue value={row.cnpj_cpf ? formatCnpjCpf(row.cnpj_cpf) : null} label="CNPJ/CPF" /></td>
                    <td><StatusText tone={situationTone(row)}>{accountSituationLabel(row.account_situation)}</StatusText></td>
                    {/* Só o e-mail gravado (achado A4): os contatos aparecem como escolha na linha aberta. */}
                    <td className="app-table__text" title={row.recovery_email ?? undefined}>
                      {row.recovery_email
                        ?? (row.candidates.length === 0 ? <StatusText tone="warning">Sem e-mail</StatusText> : <NoValue label="Sem e-mail de recuperação" />)}
                    </td>
                    <td>{row.hasCriticalAlert ? <StatusText tone="danger">Crítico</StatusText> : <NoValue label="Sem alerta crítico" />}</td>
                    <td><Button variant="secondary" className="app-btn--sm min-w-36" onClick={() => { if (!expanded) toggleRow(row) }}>{getPortalNextAction(row)}</Button></td>
                    <td>
                      <Link
                        to={`/clientes/portal/inspecao/${row.customer_id}?origem=provisionamento&aba=nova`}
                        target="_blank"
                        rel="noreferrer"
                        className="app-btn app-btn--secondary app-btn--icon"
                        title="Ver o Portal como o Cliente vê"
                        aria-label={`Espiadinha: ver o Portal como ${row.customer_name} vê`}
                      >
                        <Eye size={15} aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr data-row-detail>
                      <td colSpan={8} className="p-4">
                        <PortalReviewPanel row={row} variant="inline" onClose={closeRow} onSaved={() => void refetch()} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              })}
            </tbody>
          </table>
        </div>
      </Block>
    </>
  )
}
