import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Block, Fact, FactList } from '../ui/Block'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { SegmentedControl } from '../ui/SegmentedControl'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { InlineError } from '../ui/Card'
import { QueryStateGate } from '../shared/QueryStateGate'
import {
  AUDIT_SUBJECTS,
  AUDIT_SUBJECT_AREAS,
  auditSubjectLabel,
  auditValueFacts,
  brasiliaDay,
  describeActionGroup,
  describeAuditAction,
  describeAuditLog,
  displayAuditValue,
  formatBrasiliaDateTimeWithSeconds,
} from './auditLogPresentation'
import { readRecordedReason } from '../../lib/auditReasons'
import { listAllUserProfiles } from '../../services/adminUsers'
import {
  LOG_PAGE_SIZE,
  PORTAL_AUTHOR,
  SYSTEM_AUTHOR,
  fetchActionHistory,
  fetchActionHistoryActions,
  fetchActionHistoryForExport,
  type ActionHistoryAction,
  type ActionHistoryFilters,
  type ActionHistoryRow,
  type AuditAction,
} from '../../services/adminObservability'
import { exportActionHistoryWorkbook } from '../../services/exports'
import { queryKeys } from '../../services/queryKeys'
import { departmentLabel } from '../../lib/departmentLabel'
import { userFacingErrorMessage } from '../../lib/errors'

type Period = 'hoje' | '7' | '30' | 'tudo' | 'datas'

type HistoryFilters = {
  search: string
  subject: string
  changedBy: string
  action: AuditAction | ''
  period: Period
  dateFrom: string
  dateTo: string
  page: number
}

// A aba abre nos últimos 30 dias: o recorte que a pessoa costuma procurar, e a
// leitura não percorre o histórico inteiro a cada abertura (migration 603).
const EMPTY_FILTERS: HistoryFilters = { search: '', subject: '', changedBy: '', action: '', period: '30', dateFrom: '', dateTo: '', page: 0 }

const ACTION_OPTIONS: ReadonlyArray<{ value: AuditAction; label: string }> = [
  { value: 'criou', label: 'Criou' },
  { value: 'alterou', label: 'Alterou' },
  { value: 'excluiu', label: 'Excluiu' },
]

const PERIOD_OPTIONS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: 'hoje', label: 'Hoje' },
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: 'tudo', label: 'Tudo' },
  { value: 'datas', label: 'Escolher datas' },
]

const LINES_PAGE_SIZE = 200

/** Os filtros da tela no formato da leitura, com o período rápido virado em dias de Brasília. */
function toQueryFilters(filters: HistoryFilters, now: Date = new Date()): ActionHistoryFilters {
  const entityTypes = AUDIT_SUBJECTS.find((subject) => subject.id === filters.subject)?.entityTypes ?? []
  const range = filters.period === 'hoje' ? { from: brasiliaDay(0, now), to: '' }
    : filters.period === '7' ? { from: brasiliaDay(6, now), to: '' }
    : filters.period === '30' ? { from: brasiliaDay(29, now), to: '' }
    : filters.period === 'datas' ? { from: filters.dateFrom, to: filters.dateTo }
    : { from: '', to: '' }
  return {
    entityTypes,
    changedBy: filters.changedBy,
    action: filters.action,
    dateFrom: range.from,
    dateTo: range.to,
    search: filters.search.trim(),
    page: filters.page,
  }
}

/**
 * Histórico de ações (Administração): uma linha por ação — o que uma pessoa ou
 * o sistema gravou de uma vez —, com quem fez, quando (com os segundos), o que
 * fez e o motivo, tudo pelo nome. A leitura vem da RPC
 * `admin_action_history_actions` (migration 603); a linha aberta traz o resumo
 * por registro e, campo a campo, as linhas da ação (`admin_action_history`).
 */
export function AdminHistoryTab() {
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_FILTERS)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const queryFilters = toQueryFilters(filters)
  const query = useQuery({
    queryKey: queryKeys.admin.auditLogs(queryFilters),
    queryFn: () => fetchActionHistoryActions(queryFilters),
    staleTime: 30_000,
  })
  // A lista "Por" usa as pessoas já carregadas na aba Usuários (mesma consulta).
  const usersQuery = useQuery({ queryKey: queryKeys.admin.users(), queryFn: listAllUserProfiles })
  const people = [...(usersQuery.data ?? [])].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))
  const rows = query.data?.rows ?? []
  const total = query.data?.count ?? 0
  const capped = query.data?.capped ?? false
  const hasFilters = Boolean(filters.search || filters.subject || filters.changedBy || filters.action || filters.period !== EMPTY_FILTERS.period)
  const update = (patch: Partial<HistoryFilters>) => setFilters((current) => ({ ...current, ...patch, page: 0 }))
  const subjectsById = new Map(AUDIT_SUBJECTS.map((subject) => [subject.id, subject]))

  async function exportWorkbook() {
    setExporting(true)
    setExportError(null)
    try {
      const { page: _page, ...rest } = queryFilters
      void _page
      const result = await fetchActionHistoryForExport(rest)
      await exportActionHistoryWorkbook(result.rows.map(exportRow), exportFilterLines(filters, rest, result.capped))
    } catch (error) {
      setExportError(userFacingErrorMessage(error, 'Não foi possível exportar o histórico. Tente novamente.'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="app-filter-grid mb-4">
        <Field label="Busca">
          <Input
            type="search"
            value={filters.search}
            placeholder="B/L, CE, container, navio ou Cliente"
            onChange={(e) => update({ search: e.target.value })}
          />
        </Field>
        <Field label="Assunto">
          <Select value={filters.subject} onChange={(e) => update({ subject: e.target.value })}>
            <option value="">Todos</option>
            {AUDIT_SUBJECT_AREAS.map((area) => (
              <optgroup key={area.label} label={area.label}>
                {area.subjects.map((id) => subjectsById.get(id)).filter((subject) => subject !== undefined).map((subject) => (
                  <option key={subject.id} value={subject.id}>{subject.label}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Ação">
          <Select value={filters.action} onChange={(e) => update({ action: e.target.value as AuditAction | '' })}>
            <option value="">Qualquer ação</option>
            {ACTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>
        <Field label="Por">
          <Select value={filters.changedBy} onChange={(e) => update({ changedBy: e.target.value })}>
            <option value="">Qualquer autor</option>
            <option value={SYSTEM_AUTHOR}>Sistema</option>
            <option value={PORTAL_AUTHOR}>Cliente pelo Portal</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
          </Select>
        </Field>
        {filters.period === 'datas' ? (
          <>
            <Field label="De">
              <Input type="date" value={filters.dateFrom} onChange={(e) => update({ dateFrom: e.target.value })} />
            </Field>
            <Field label="Até">
              <Input type="date" value={filters.dateTo} onChange={(e) => update({ dateTo: e.target.value })} />
            </Field>
          </>
        ) : null}
        {hasFilters ? (
          <div className="flex items-end"><Button variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Limpar filtros</Button></div>
        ) : null}
      </div>
      <SegmentedControl<Period>
        className="mb-4"
        label="Período"
        options={PERIOD_OPTIONS}
        value={filters.period}
        onChange={(period) => update({ period })}
      />

      <Block
        title="Histórico de ações"
        aside={(
          <span className="flex flex-wrap items-center gap-3">
            {query.data ? <span>{capped ? 'Mais de 10.000 ações' : `${total.toLocaleString('pt-BR')} ${total === 1 ? 'ação' : 'ações'}`}</span> : null}
            <Button variant="secondary" className="app-btn--sm" disabled={exporting || !query.data || total === 0} onClick={() => void exportWorkbook()}>
              {exporting ? 'Exportando…' : 'Exportar planilha'}
            </Button>
          </span>
        )}
        flush
      >
        {exportError ? <div className="px-4 pt-3"><InlineError message={exportError} /></div> : null}
        <QueryStateGate
          isLoading={query.isLoading}
          isError={Boolean(query.error)}
          hasData={query.data !== undefined && query.data !== null}
          errorMessage="Não foi possível carregar o histórico de ações."
          onRetry={() => void query.refetch?.()}
          loadingLabel="Carregando o histórico…"
        >
          {rows.length === 0 && filters.page > 0 ? (
            // A página passou do fim (linhas apagadas pela retenção enquanto a tela estava aberta).
            <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-[var(--app-muted)]">
              <p>Esta página não tem mais ações.</p>
              <Button variant="secondary" onClick={() => setFilters((current) => ({ ...current, page: 0 }))}>Voltar à primeira página</Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-[var(--app-muted)]">
              {hasFilters ? 'Nenhuma ação com estes filtros.' : 'Nenhuma ação registrada.'}
            </p>
          ) : (
            <>
              <div className="app-table-scroll">
                <table className="app-table">
                  <caption className="sr-only">Histórico de ações</caption>
                  <thead>
                    <tr>
                      <th scope="col"><span className="sr-only">Abrir</span></th>
                      <th scope="col">Quando</th>
                      <th scope="col" className="app-table__text-head">Por</th>
                      <th scope="col" className="app-table__text-head">O que fez</th>
                      <th scope="col" className="app-table__text-head">Registro</th>
                      <th scope="col" className="app-table__text-head">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <ActionRow
                        key={row.action_key}
                        row={row}
                        open={openKey === row.action_key}
                        onToggle={() => setOpenKey(openKey === row.action_key ? null : row.action_key)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Acima do teto a busca para de contar: o rodapé diz "de mais de
                  10.000", igual ao título, e Próxima segue enquanto a página vier cheia. */}
              <TableFooterPagination
                page={filters.page}
                pageBase={0}
                pageSize={LOG_PAGE_SIZE}
                totalCount={total}
                totalPages={Math.max(1, Math.ceil(total / LOG_PAGE_SIZE))}
                countIsFloor={capped ? { rowsOnPage: rows.length } : undefined}
                onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
              />
            </>
          )}
        </QueryStateGate>
      </Block>
    </>
  )
}

type ActorLike = Pick<ActionHistoryRow, 'actor_kind' | 'actor_name' | 'actor_email' | 'actor_department'>

/** Autor na coluna Por: o nome; Sistema para rotina e gatilho; login sem cadastro por extenso. */
function actorLabel(row: ActorLike): string {
  if (row.actor_kind === 'sistema') return 'Sistema'
  if (row.actor_name) return row.actor_name
  return row.actor_kind === 'portal' ? 'Cliente pelo Portal' : 'Login sem cadastro interno'
}

/** Detalhe do autor (linha aberta e dica): e-mail e setor gravado na hora da ação. */
function actorDetail(row: ActorLike): string {
  if (row.actor_kind === 'sistema') return 'Ação automática (rotina, importação ou gatilho do sistema)'
  const department = row.actor_kind === 'equipe' && row.actor_department ? departmentLabel(row.actor_department) : null
  return [row.actor_email, department && department !== '—' ? department : null].filter(Boolean).join(' · ') || 'Sem e-mail no cadastro'
}

/**
 * O motivo como a tela mostra: "Origem: …" quando é rastro de onde a mudança
 * veio (ação automática, importação, texto que o banco grava); o texto da
 * pessoa quando é motivo; `null` quando não há motivo (texto padrão some).
 */
function reasonText(row: Pick<ActionHistoryRow, 'actor_kind' | 'justification'>): { label: 'Origem' | 'Motivo'; text: string } | null {
  const reason = readRecordedReason(row.justification)
  if (!reason) return null
  return { label: row.actor_kind === 'sistema' || reason.origin ? 'Origem' : 'Motivo', text: reason.text }
}

function ActionRow({ row, open, onToggle }: { row: ActionHistoryAction; open: boolean; onToggle: () => void }) {
  const summary = describeAuditAction(row)
  const actor = actorLabel(row)
  const detail = actorDetail(row)
  const reason = reasonText(row)
  const others = row.entity_count - 1
  const record = row.entity_label
    ? (others > 0 ? `${row.entity_label} e mais ${others.toLocaleString('pt-BR')}` : row.entity_label)
    : null
  return (
    <Fragment>
      <tr>
        <td>
          <button type="button" className="app-table__icon-button" aria-expanded={open} aria-label={`${open ? 'Recolher' : 'Abrir'} ${summary}`} onClick={onToggle}>
            {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          </button>
        </td>
        <td className="tabular-nums whitespace-nowrap">{formatBrasiliaDateTimeWithSeconds(row.changed_at)}</td>
        <td className="app-table__text" title={detail}>{actor}</td>
        <td className="app-table__text app-table__text--wrap">{summary}</td>
        <td className="app-table__text" title={record ?? undefined}>{record ?? <NoValue label="Registro sem nome" />}</td>
        <td className="app-table__text app-table__text--wrap">
          {reason ? (reason.label === 'Origem' ? `Origem: ${reason.text}` : reason.text) : <NoValue label="Sem motivo" />}
        </td>
      </tr>
      {open ? (
        <tr data-row-detail>
          <td colSpan={6}>
            {row.line_count <= 1 ? (
              <FactList columns={reason ? 4 : 3}>
                <Fact label="Autor">{actor} · {detail}</Fact>
                <Fact label="De"><AuditValue row={row} side="old" /></Fact>
                <Fact label="Para"><AuditValue row={row} side="new" /></Fact>
                {reason ? <Fact label={reason.label}>{reason.text}</Fact> : null}
              </FactList>
            ) : (
              <div className="grid gap-3">
                <FactList columns={reason ? 3 : 2}>
                  <Fact label="Autor">{actor} · {detail}</Fact>
                  <Fact label="O que a ação fez">
                    <span className="grid gap-0.5">
                      {row.groups.map((group) => <span key={`${group.entity_type}:${group.kind}`}>{describeActionGroup(group)}</span>)}
                    </span>
                  </Fact>
                  {reason ? <Fact label={reason.label}>{reason.text}</Fact> : null}
                </FactList>
                <ActionLines actionKey={row.action_key} lineCount={row.line_count} />
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}

/** As linhas da ação, campo a campo, lidas só quando a pessoa pede. */
function ActionLines({ actionKey, lineCount }: { actionKey: string; lineCount: number }) {
  const [shown, setShown] = useState(false)
  const [page, setPage] = useState(0)
  const query = useQuery({
    queryKey: queryKeys.admin.auditActionLines(actionKey, page),
    queryFn: () => fetchActionHistory(
      { entityTypes: [], changedBy: '', action: '', dateFrom: '', dateTo: '', page },
      { actionKey, pageSize: LINES_PAGE_SIZE },
    ),
    enabled: shown,
    staleTime: 30_000,
  })
  if (!shown) {
    return (
      <div>
        <Button variant="secondary" className="app-btn--sm" onClick={() => setShown(true)}>
          Ver campo a campo ({lineCount.toLocaleString('pt-BR')} {lineCount === 1 ? 'linha' : 'linhas'})
        </Button>
      </div>
    )
  }
  const lines = query.data?.rows ?? []
  return (
    <QueryStateGate
      isLoading={query.isLoading}
      isError={Boolean(query.error)}
      hasData={query.data !== undefined && query.data !== null}
      errorMessage="Não foi possível carregar as linhas desta ação."
      onRetry={() => void query.refetch?.()}
      loadingLabel="Carregando as linhas…"
    >
      <div className="app-table-scroll">
        <table className="app-table app-table--nested">
          <caption className="sr-only">Linhas da ação, campo a campo</caption>
          <thead>
            <tr>
              <th scope="col" className="app-table__text-head">Assunto</th>
              <th scope="col" className="app-table__text-head">Registro</th>
              <th scope="col" className="app-table__text-head">O que mudou</th>
              <th scope="col" className="app-table__text-head">De</th>
              <th scope="col" className="app-table__text-head">Para</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={`${line.source}:${line.id}`}>
                <td className="app-table__text">{auditSubjectLabel(line.entity_type)}</td>
                <td className="app-table__text" title={line.entity_label ?? undefined}>{line.entity_label ?? <NoValue label="Registro sem nome" />}</td>
                <td className="app-table__text app-table__text--wrap">{describeAuditLog(line)}</td>
                <td className="app-table__text app-table__text--wrap"><AuditValue row={line} side="old" /></td>
                <td className="app-table__text app-table__text--wrap"><AuditValue row={line} side="new" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lineCount > LINES_PAGE_SIZE ? (
        <TableFooterPagination
          page={page}
          pageBase={0}
          pageSize={LINES_PAGE_SIZE}
          totalCount={lineCount}
          totalPages={Math.max(1, Math.ceil(lineCount / LINES_PAGE_SIZE))}
          onPageChange={setPage}
        />
      ) : null}
    </QueryStateGate>
  )
}

type AuditValueRow = Pick<ActionHistoryRow, 'entity_type' | 'field_name' | 'old_value' | 'new_value' | 'old_label' | 'new_label' | 'value_labels'>

function AuditValue({ row, side }: { row: AuditValueRow; side: 'old' | 'new' }) {
  const value = side === 'old' ? row.old_value : row.new_value
  const label = side === 'old' ? row.old_label : row.new_label
  if (value == null || value.trim() === '') return <NoValue label="Sem valor" />
  const facts = auditValueFacts(row.entity_type, value, row.value_labels)
  if (!facts) return <>{displayAuditValue(row.field_name, value, row.entity_type, label)}</>
  if (!facts.length) return <>Registro sem dados para mostrar</>
  return (
    <span className="grid gap-0.5">
      {facts.map((fact) => <span key={fact.label}>{fact.label}: {fact.value}</span>)}
    </span>
  )
}

/** Texto de De ou Para na planilha (o registro em JSON vira "Campo: valor; …"). */
function exportValue(row: ActionHistoryRow, side: 'old' | 'new'): string {
  const value = side === 'old' ? row.old_value : row.new_value
  const label = side === 'old' ? row.old_label : row.new_label
  if (value == null || value.trim() === '') return ''
  const facts = auditValueFacts(row.entity_type, value, row.value_labels)
  if (!facts) return displayAuditValue(row.field_name, value, row.entity_type, label)
  return facts.map((fact) => `${fact.label}: ${fact.value}`).join('; ')
}

/** Uma linha da planilha: os mesmos nomes da tela, nunca o código. */
function exportRow(row: ActionHistoryRow): Record<string, unknown> {
  const reason = reasonText(row)
  return {
    Quando: formatBrasiliaDateTimeWithSeconds(row.changed_at),
    Por: actorLabel(row),
    'E-mail do autor': row.actor_kind === 'sistema' ? '' : row.actor_email ?? '',
    Assunto: auditSubjectLabel(row.entity_type),
    Registro: row.entity_label ?? '',
    'O que mudou': describeAuditLog(row),
    De: exportValue(row, 'old'),
    Para: exportValue(row, 'new'),
    Motivo: reason ? (reason.label === 'Origem' ? `Origem: ${reason.text}` : reason.text) : '',
  }
}

function exportFilterLines(filters: HistoryFilters, query: Omit<ActionHistoryFilters, 'page'>, capped: boolean) {
  const subject = AUDIT_SUBJECTS.find((entry) => entry.id === filters.subject)?.label ?? ''
  const action = ACTION_OPTIONS.find((option) => option.value === filters.action)?.label ?? ''
  const lines = [
    { Filtro: 'Busca', Valor: filters.search.trim() },
    { Filtro: 'Assunto', Valor: subject },
    { Filtro: 'Ação', Valor: action },
    { Filtro: 'De', Valor: query.dateFrom ? query.dateFrom.split('-').reverse().join('/') : '' },
    { Filtro: 'Até', Valor: query.dateTo ? query.dateTo.split('-').reverse().join('/') : '' },
  ].filter((line) => line.Valor)
  return capped ? [...lines, { Filtro: 'Limite', Valor: 'Só as 10.000 linhas mais recentes do recorte' }] : lines
}
