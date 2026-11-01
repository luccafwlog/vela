import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Block, Fact, FactList } from '../ui/Block'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { QueryStateGate } from '../shared/QueryStateGate'
import {
  AUDIT_SUBJECTS,
  auditSubjectLabel,
  auditValueFacts,
  describeAuditLog,
  displayAuditValue,
  formatBrasiliaDateTime,
} from './auditLogPresentation'
import { listAllUserProfiles } from '../../services/adminUsers'
import {
  LOG_PAGE_SIZE,
  PORTAL_AUTHOR,
  SYSTEM_AUTHOR,
  fetchActionHistory,
  type ActionHistoryRow,
  type AuditAction,
} from '../../services/adminObservability'
import { queryKeys } from '../../services/queryKeys'
import { departmentLabel } from '../../lib/departmentLabel'

type HistoryFilters = { subject: string; changedBy: string; action: AuditAction | ''; dateFrom: string; dateTo: string; page: number }

const EMPTY_FILTERS: HistoryFilters = { subject: '', changedBy: '', action: '', dateFrom: '', dateTo: '', page: 0 }

const ACTION_OPTIONS: ReadonlyArray<{ value: AuditAction; label: string }> = [
  { value: 'criou', label: 'Criou' },
  { value: 'alterou', label: 'Alterou' },
  { value: 'excluiu', label: 'Excluiu' },
]

/**
 * Histórico de ações (Administração): quem fez, quando, em qual registro, o
 * que mudou e o motivo, tudo pelo nome. A leitura vem da RPC
 * `admin_action_history` (migration 558), que resolve registro, autor e
 * valores; o número interno nunca chega à tela.
 */
export function AdminHistoryTab() {
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_FILTERS)
  const [openId, setOpenId] = useState<number | null>(null)
  const entityTypes = AUDIT_SUBJECTS.find((subject) => subject.id === filters.subject)?.entityTypes ?? []
  const query = useQuery({
    queryKey: queryKeys.admin.auditLogs(filters),
    queryFn: () => fetchActionHistory({
      entityTypes,
      changedBy: filters.changedBy,
      action: filters.action,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      page: filters.page,
    }),
    staleTime: 30_000,
  })
  // A lista "Por" usa as pessoas já carregadas na aba Usuários (mesma consulta).
  const usersQuery = useQuery({ queryKey: queryKeys.admin.users(), queryFn: listAllUserProfiles })
  const people = [...(usersQuery.data ?? [])].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))
  const rows = query.data?.rows ?? []
  const total = query.data?.count ?? 0
  const capped = query.data?.capped ?? false
  const hasFilters = Boolean(filters.subject || filters.changedBy || filters.action || filters.dateFrom || filters.dateTo)
  const update = (patch: Partial<HistoryFilters>) => setFilters((current) => ({ ...current, ...patch, page: 0 }))

  return (
    <>
      <div className="app-filter-grid mb-4">
        <Field label="Assunto">
          <Select value={filters.subject} onChange={(e) => update({ subject: e.target.value })}>
            <option value="">Todos</option>
            {AUDIT_SUBJECTS.map((subject) => <option key={subject.id} value={subject.id}>{subject.label}</option>)}
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
        <Field label="De">
          <Input type="date" value={filters.dateFrom} onChange={(e) => update({ dateFrom: e.target.value })} />
        </Field>
        <Field label="Até">
          <Input type="date" value={filters.dateTo} onChange={(e) => update({ dateTo: e.target.value })} />
        </Field>
        {hasFilters ? (
          <div className="flex items-end"><Button variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Limpar filtros</Button></div>
        ) : null}
      </div>

      <Block title="Histórico de ações" aside={query.data ? (capped ? 'Mais de 10.000 registros' : `${total} ${total === 1 ? 'registro' : 'registros'}`) : null} flush>
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
                      <th scope="col" className="app-table__text-head">Assunto</th>
                      <th scope="col" className="app-table__text-head">Registro</th>
                      <th scope="col" className="app-table__text-head">O que mudou</th>
                      <th scope="col" className="app-table__text-head">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <HistoryRow
                        key={row.id}
                        row={row}
                        open={openId === row.id}
                        onToggle={() => setOpenId(openId === row.id ? null : row.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <TableFooterPagination
                page={filters.page}
                pageBase={0}
                pageSize={LOG_PAGE_SIZE}
                totalCount={total}
                totalPages={Math.max(1, Math.ceil(total / LOG_PAGE_SIZE))}
                onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
              />
            </>
          )}
        </QueryStateGate>
      </Block>
    </>
  )
}

/** Autor na coluna Por: o nome; Sistema para rotina e gatilho; login sem cadastro por extenso. */
function actorLabel(row: Pick<ActionHistoryRow, 'actor_kind' | 'actor_name'>): string {
  if (row.actor_kind === 'sistema') return 'Sistema'
  if (row.actor_name) return row.actor_name
  return row.actor_kind === 'portal' ? 'Cliente pelo Portal' : 'Login sem cadastro interno'
}

/** Detalhe do autor (linha aberta e dica): e-mail e setor gravado na hora da ação. */
function actorDetail(row: ActionHistoryRow): string {
  if (row.actor_kind === 'sistema') return 'Ação automática (rotina, importação ou gatilho do sistema)'
  const department = row.actor_kind === 'equipe' && row.actor_department ? departmentLabel(row.actor_department) : null
  return [row.actor_email, department && department !== '—' ? department : null].filter(Boolean).join(' · ') || 'Sem e-mail no cadastro'
}

/** O texto da justificativa: "Origem" quando é o contexto de uma ação automática. */
function reasonLabel(row: ActionHistoryRow): string {
  return row.actor_kind === 'sistema' ? 'Origem' : 'Motivo'
}

function HistoryRow({ row, open, onToggle }: { row: ActionHistoryRow; open: boolean; onToggle: () => void }) {
  const summary = describeAuditLog(row)
  const actor = actorLabel(row)
  const detail = actorDetail(row)
  return (
    <Fragment>
      <tr>
        <td>
          <button type="button" className="app-table__icon-button" aria-expanded={open} aria-label={`${open ? 'Recolher' : 'Abrir'} ${summary}`} onClick={onToggle}>
            {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          </button>
        </td>
        <td className="tabular-nums whitespace-nowrap">{formatBrasiliaDateTime(row.changed_at)}</td>
        <td className="app-table__text" title={detail}>{actor}</td>
        <td className="app-table__text">{auditSubjectLabel(row.entity_type)}</td>
        <td className="app-table__text" title={row.entity_label ?? undefined}>{row.entity_label ?? <NoValue label="Registro sem nome" />}</td>
        <td className="app-table__text app-table__text--wrap">{summary}</td>
        <td className="app-table__text app-table__text--wrap">
          {row.justification ? (row.actor_kind === 'sistema' ? `Origem: ${row.justification}` : row.justification) : <NoValue label="Sem motivo" />}
        </td>
      </tr>
      {open ? (
        <tr data-row-detail>
          <td colSpan={7}>
            <FactList columns={row.justification ? 4 : 3}>
              <Fact label="Autor">{actor} · {detail}</Fact>
              <Fact label="De"><AuditValue row={row} side="old" /></Fact>
              <Fact label="Para"><AuditValue row={row} side="new" /></Fact>
              {row.justification ? <Fact label={reasonLabel(row)}>{row.justification}</Fact> : null}
            </FactList>
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}

function AuditValue({ row, side }: { row: ActionHistoryRow; side: 'old' | 'new' }) {
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
