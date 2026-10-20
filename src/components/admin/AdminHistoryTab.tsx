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
  formatAuditValue,
  formatBrasiliaDateTime,
} from './auditLogPresentation'
import { listAllUserProfiles } from '../../services/adminUsers'
import { LOG_PAGE_SIZE, SYSTEM_AUTHOR, fetchAuditLogs, type AuditLogRow } from '../../services/adminObservability'
import { queryKeys } from '../../services/queryKeys'

type HistoryFilters = { subject: string; changedBy: string; dateFrom: string; dateTo: string; page: number }

const EMPTY_FILTERS: HistoryFilters = { subject: '', changedBy: '', dateFrom: '', dateTo: '', page: 0 }

/** Histórico de ações legível (lote 5b): quem, quando, o assunto e o que mudou. */
export function AdminHistoryTab() {
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_FILTERS)
  const [openId, setOpenId] = useState<number | null>(null)
  const entityTypes = AUDIT_SUBJECTS.find((subject) => subject.id === filters.subject)?.entityTypes ?? []
  const query = useQuery({
    queryKey: queryKeys.admin.auditLogs(filters),
    queryFn: () => fetchAuditLogs({ entityTypes, changedBy: filters.changedBy, dateFrom: filters.dateFrom, dateTo: filters.dateTo, page: filters.page }),
    staleTime: 30_000,
  })
  // A lista "Por" usa as pessoas já carregadas na aba Usuários (mesma consulta).
  const usersQuery = useQuery({ queryKey: queryKeys.admin.users(), queryFn: listAllUserProfiles })
  const people = [...(usersQuery.data ?? [])].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))
  const userNames = new Map(people.map((person) => [person.id, person.full_name]))
  const rows = query.data?.rows ?? []
  const total = query.data?.count ?? 0
  const hasFilters = Boolean(filters.subject || filters.changedBy || filters.dateFrom || filters.dateTo)
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
        <Field label="Por">
          <Select value={filters.changedBy} onChange={(e) => update({ changedBy: e.target.value })}>
            <option value="">Qualquer pessoa</option>
            <option value={SYSTEM_AUTHOR}>Sistema</option>
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

      <Block title="Histórico de ações" aside={query.data ? `${total} ${total === 1 ? 'registro' : 'registros'}` : null} flush>
        <QueryStateGate
          isLoading={query.isLoading}
          isError={Boolean(query.error)}
          hasData={query.data !== undefined && query.data !== null}
          errorMessage="Não foi possível carregar o histórico de ações."
          onRetry={() => void query.refetch?.()}
          loadingLabel="Carregando o histórico…"
        >
          {rows.length === 0 ? (
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
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <HistoryRow
                        key={row.id}
                        row={row}
                        recordLabel={auditRecordLabel(row, userNames)}
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

/**
 * Qual registro mudou: o Usuário pelo nome (da lista já carregada); os demais
 * pelo identificador gravado, curto. ponytail: sem consulta extra por entidade;
 * o upgrade é a RPC do histórico devolver o nome do registro.
 */
function auditRecordLabel(row: AuditLogRow, userNames: Map<string, string>): { text: string; title?: string } | null {
  const id = row.entity_id?.trim()
  if (!id) return null
  if (row.entity_type === 'user_profile') return { text: userNames.get(id) ?? 'Usuário fora da lista' }
  const readable = id.replace(/::/g, ' · ')
  return readable.length > 18 ? { text: `${readable.slice(0, 8)}…`, title: readable } : { text: readable }
}

function HistoryRow({ row, recordLabel, open, onToggle }: { row: AuditLogRow; recordLabel: { text: string; title?: string } | null; open: boolean; onToggle: () => void }) {
  const summary = describeAuditLog(row)
  return (
    <Fragment>
      <tr>
        <td>
          <button type="button" className="app-table__icon-button" aria-expanded={open} aria-label={`${open ? 'Recolher' : 'Abrir'} ${summary}`} onClick={onToggle}>
            {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          </button>
        </td>
        <td className="tabular-nums whitespace-nowrap">{formatBrasiliaDateTime(row.changed_at)}</td>
        <td className="app-table__text">{row.changed_by ? row.changer_name ?? 'Pessoa sem cadastro' : 'Sistema'}</td>
        <td className="app-table__text">{auditSubjectLabel(row.entity_type)}</td>
        <td className="app-table__text" title={recordLabel?.title}>{recordLabel ? recordLabel.text : <NoValue label="Sem registro" />}</td>
        <td className="app-table__text app-table__text--wrap">{summary}</td>
      </tr>
      {open ? (
        <tr data-row-detail>
          <td colSpan={6}>
            <FactList columns={row.justification ? 3 : 2}>
              <Fact label="De"><AuditValue entityType={row.entity_type} fieldName={row.field_name} value={row.old_value} /></Fact>
              <Fact label="Para"><AuditValue entityType={row.entity_type} fieldName={row.field_name} value={row.new_value} /></Fact>
              {row.justification ? <Fact label="Motivo">{row.justification}</Fact> : null}
            </FactList>
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}

function AuditValue({ entityType, fieldName, value }: { entityType: string; fieldName: string | null; value: string | null }) {
  if (value == null || value.trim() === '') return <NoValue label="Sem valor" />
  const facts = auditValueFacts(entityType, value)
  if (!facts) return <>{formatAuditValue(fieldName, value, entityType)}</>
  if (!facts.length) return <>Registro sem dados para mostrar</>
  return (
    <span className="grid gap-0.5">
      {facts.map((fact) => <span key={fact.label}>{fact.label}: {fact.value}</span>)}
    </span>
  )
}
