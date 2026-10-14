import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { CopyValue } from '../ui/CopyValue'
import { Field, Input, Select } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { useToast } from '../ui/Toast'
import { useCustomerContainers } from '../../hooks/useCustomerFicha'
import { customerContainerView, type CustomerContainerView } from '../../services/demurrage/customerContainers'
import type { DemurrageContainerRow } from '../../services/demurrage/demurrageContainers'
import { fmtUSD } from '../../services/demurrage/demurragePresentation'
import { formatCountLabel, formatDate } from '../../lib/utils'
import { saoPauloTodayIso } from '../../lib/dates'
import type { useCustomerDetail } from '../../hooks/useCustomers'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>
type Line = { row: DemurrageContainerRow; view: CustomerContainerView }
type Situation = '' | 'com-cliente' | 'devolvidos' | 'em-curso' | 'a-faturar' | 'faturada' | 'soc'

const PAGE_SIZE = 20

const SITUATIONS: Array<{ value: Situation; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'com-cliente', label: 'Com o Cliente' },
  { value: 'devolvidos', label: 'Devolvidos' },
  { value: 'em-curso', label: 'Demurrage em curso' },
  { value: 'a-faturar', label: 'Demurrage a faturar' },
  { value: 'faturada', label: 'Demurrage faturada' },
  { value: 'soc', label: 'SOC' },
]

function matchesSituation({ row, view }: Line, situation: Situation) {
  if (situation === 'com-cliente') return Boolean(row.discharge_date) && !row.return_date && !view.soc
  if (situation === 'devolvidos') return Boolean(row.return_date)
  if (situation === 'em-curso') return view.demurrage.kind === 'running'
  if (situation === 'a-faturar') return view.demurrage.kind === 'to_bill'
  if (situation === 'faturada') return view.demurrage.kind === 'invoice'
  if (situation === 'soc') return view.soc
  return true
}

/**
 * Aba Contêineres da ficha do Cliente (pedida e aprovada em 2026-10-14):
 * uma linha por contêiner dos B/Ls do Cliente, em tabela limpa — oito
 * colunas, uma linha de título, nada embaixo do valor. Origem do free time e
 * "Não se aplica (SOC)" aparecem ao passar o mouse.
 */
export function ConteineresTab({ data }: { data: Data }) {
  const query = useCustomerContainers(data.id)
  const { showToast } = useToast()
  const [search, setSearch] = useState('')
  const [situation, setSituation] = useState<Situation>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)

  const lines = useMemo<Line[]>(() => {
    const today = saoPauloTodayIso()
    return (query.data ?? []).map((row) => ({ row, view: customerContainerView(row, today) }))
  }, [query.data])
  const term = search.trim().toLowerCase()
  const filtered = lines.filter((line) => (
    (!term || (line.row.container_number ?? '').toLowerCase().includes(term) || (line.row.bl_id ?? '').toLowerCase().includes(term))
    && matchesSituation(line, situation)
    && (!from || (line.row.discharge_date ?? '') >= from)
    && (!to || (line.row.discharge_date ?? '9999') <= to)
  ))
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const withCustomer = lines.filter((line) => matchesSituation(line, 'com-cliente')).length
  const openUsd = lines.reduce((sum, { view }) => sum + (view.demurrage.kind === 'running' || view.demurrage.kind === 'to_bill' ? view.demurrage.usd : 0), 0)

  function update<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      setPage(1)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const { exportCustomerContainersWorkbook } = await import('../../services/exports')
      await exportCustomerContainersWorkbook(data.name, filtered)
    } catch {
      showToast('Falha ao exportar os contêineres.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Block
      title="Contêineres"
      headingLevel={2}
      flush
      aside={(
        <>
          <span>
            {formatCountLabel(lines.length, 'contêiner', 'contêineres')} · {withCustomer} com o Cliente
            {openUsd > 0 ? <> · <StatusText tone="warning">{fmtUSD(openUsd)} em curso ou a faturar</StatusText></> : null}
          </span>
          <Button variant="secondary" className="app-btn--sm" loading={exporting} loadingLabel="Exportando…" disabled={!filtered.length} onClick={() => void handleExport()}>
            <Download size={14} aria-hidden="true" />
            Exportar
          </Button>
        </>
      )}
    >
      <div className="app-block__body">
        <div className="app-filter-grid">
          <Field label="Buscar contêiner ou B/L">
            <Input placeholder="Ex.: CSNU6012301" value={search} onChange={(event) => update(setSearch)(event.target.value)} />
          </Field>
          <Field label="Situação">
            <Select value={situation} onChange={(event) => update(setSituation)(event.target.value as Situation)}>
              {SITUATIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
          <Field label="Descarga de">
            <Input type="date" value={from} onChange={(event) => update(setFrom)(event.target.value)} />
          </Field>
          <Field label="até">
            <Input type="date" value={to} onChange={(event) => update(setTo)(event.target.value)} />
          </Field>
        </div>
      </div>
      {query.isLoading ? (
        <p className="app-block__body app-facts__detail" role="status">Carregando os contêineres…</p>
      ) : query.isError ? (
        <div className="app-block__body app-customer-notice app-customer-notice--danger" role="alert">
          <span>Não foi possível carregar os contêineres.</span>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
        </div>
      ) : !lines.length ? (
        <p className="app-block__body app-facts__detail">Nenhum contêiner nos B/Ls deste Cliente.</p>
      ) : !filtered.length ? (
        <p className="app-block__body app-facts__detail">Nenhum contêiner com esses filtros.</p>
      ) : (
        <>
          <div className="app-table-scroll">
            <table className="app-table app-table--compact">
              <caption className="sr-only">Contêineres dos B/Ls do Cliente</caption>
              <thead>
                <tr>
                  <th scope="col">Contêiner</th>
                  <th scope="col">B/L</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Descarga</th>
                  <th scope="col">Devolução</th>
                  <th scope="col">Dias</th>
                  <th scope="col">Free time</th>
                  <th scope="col">Demurrage</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ row, view }) => (
                  <tr key={row.id}>
                    <td className="app-customer-code whitespace-nowrap">
                      {row.container_number ? <CopyValue value={row.container_number} label="número do contêiner" /> : <NoValue label="Sem número do contêiner" />}
                    </td>
                    <td className="whitespace-nowrap"><Link className="app-customer-link app-customer-code" to={`/bls/${row.bl_id}`}>{row.bl_id}</Link></td>
                    <td className="whitespace-nowrap">
                      {row.type ?? <NoValue label="Sem tipo" />}
                      {view.soc ? <> <span className="app-status-text app-status-text--muted" title="Contêiner do Cliente: sem devolução nem Demurrage">SOC</span></> : null}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{row.discharge_date ? formatDate(row.discharge_date) : <NoValue label="Sem descarga" />}</td>
                    <td className="whitespace-nowrap tabular-nums">{row.return_date ? formatDate(row.return_date) : <NoValue label={view.soc ? 'Não se aplica (SOC)' : 'Sem devolução'} />}</td>
                    <td className="tabular-nums">
                      {view.days == null ? <NoValue label="Sem descarga" /> : view.overFreeTime ? <StatusText tone="warning">{view.days}</StatusText> : view.days}
                    </td>
                    <td className="tabular-nums" title={view.soc ? 'Não se aplica (SOC)' : view.freeTimeSourceLabel ? `Free time ${view.freeTimeSourceLabel}` : undefined}>
                      {view.freeTimeDays ?? <NoValue label={view.soc ? 'Não se aplica (SOC)' : 'Sem tarifa de Demurrage'} />}
                    </td>
                    <td className="whitespace-nowrap"><DemurrageCell view={view} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <TableFooterPagination page={currentPage} pageSize={PAGE_SIZE} totalCount={filtered.length} totalPages={totalPages} onPageChange={setPage} pageSizes={[PAGE_SIZE]} />
          ) : null}
        </>
      )}
    </Block>
  )
}

const INVOICE_STATUS_TEXT: Record<string, string> = { issued: 'em aberto', overdue: 'vencida', paid: 'paga' }

/** "US$ 1.540,00 em curso", "DEM-2026-0007 em aberto", "DEM-2026-0004 ✓ paga"; vazio sem cobrança. */
function DemurrageCell({ view }: { view: CustomerContainerView }) {
  const d = view.demurrage
  if (d.kind === 'soc') return <NoValue label="Não se aplica (SOC)" />
  if (d.kind === 'none') return <NoValue label="Sem Demurrage" />
  if (d.kind === 'error') return <span className="app-status-text app-status-text--muted" title={d.message}>Sem tarifa</span>
  if (d.kind === 'invoice') {
    const status = INVOICE_STATUS_TEXT[d.invoice.status] ?? d.invoice.status
    return (
      <>
        <Link className="app-customer-link" to={`/demurrage?tab=faturas&fatura=${d.invoice.id}`}>{d.invoice.doc_number}</Link>{' '}
        <StatusText tone={d.invoice.status === 'paid' ? 'paid' : d.invoice.status === 'overdue' ? 'warning' : 'muted'}>{status}</StatusText>
      </>
    )
  }
  return (
    <>
      <StatusText tone="warning">{fmtUSD(d.usd)}</StatusText>{' '}
      <StatusText tone="muted">{d.kind === 'running' ? 'em curso' : 'a faturar'}</StatusText>
    </>
  )
}
