import { ChevronRight, FilterX } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState, PageHeader } from '../components/ui/Card'
import { Block, Fact, FactList, LeadValue } from '../components/ui/Block'
import { Button } from '../components/ui/Button'
import { Field, Input, Select } from '../components/ui/Input'
import { StatusText } from '../components/ui/StatusText'
import {
  ALERT_CRITICAL_FALLBACK_NOTE,
  ALERT_RULES,
  ALERT_RULE_DEPARTMENTS,
  ALERT_RULE_DEPARTMENT_LABELS,
  ALERT_RULE_DOMAINS,
  ALERT_RULE_SEVERITY_LABELS,
  type AlertRule,
  type AlertRuleDepartment,
  type AlertRuleDomain,
  type AlertRuleSeverity,
} from '../services/alertRulesCatalog'
import { ENTITY_TYPE_LABELS } from '../services/alerts'

export type AlertRuleDepartmentFilter = 'all' | 'todos' | AlertRuleDepartment

const DEPARTMENTS: Array<{ value: AlertRuleDepartmentFilter; label: string }> = [
  { value: 'all', label: 'Qualquer setor' },
  { value: 'todos', label: 'Aplicável a todos os setores' },
  { value: 'documentacao', label: 'Documentação' },
  { value: 'equipamentos', label: 'Equipamentos' },
  { value: 'operacoes', label: 'Operações' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'administrativo', label: 'Administrativo' },
]

const SEVERITIES: Array<{ value: 'all' | AlertRuleSeverity; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'critical', label: 'Crítico' },
  { value: 'normal', label: 'Normal' },
]

const ALL_FILTER_VALUE = 'all'

export function AlertasRegras() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const department = isDepartmentFilter(searchParams.get('setor')) ? searchParams.get('setor') as 'todos' | AlertRuleDepartment : ALL_FILTER_VALUE
  const domain = isDomain(searchParams.get('dominio')) ? searchParams.get('dominio') as AlertRuleDomain : ALL_FILTER_VALUE
  const severity = isSeverity(searchParams.get('gravidade')) ? searchParams.get('gravidade') as AlertRuleSeverity : ALL_FILTER_VALUE
  const selectedParam = searchParams.get('regra')

  const filteredRules = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
    return ALERT_RULES.filter((rule) => {
      // O setor filtra por quem é notificado, não só por quem responde: um
      // mesmo alerta pode chegar a mais de um setor. O valor especial 'todos'
      // filtra somente regras aplicáveis a todos os setores operacionais.
      if (department === 'todos') {
        const appliesToAll = ALERT_RULE_DEPARTMENTS.every((dep) => rule.notifiedDepartments.includes(dep))
        if (!appliesToAll) return false
      } else if (department !== ALL_FILTER_VALUE && !rule.notifiedDepartments.includes(department)) {
        return false
      }
      if (domain !== ALL_FILTER_VALUE && rule.domain !== domain) return false
      if (severity !== ALL_FILTER_VALUE && rule.severity !== severity) return false
      if (!normalizedQuery) return true

      const searchable = [
        rule.type,
        rule.summary,
        rule.trigger,
        rule.timing,
        rule.resolution,
        rule.destination,
        rule.destinationLabel,
        rule.routingNote ?? '',
        ENTITY_TYPE_LABELS[rule.entityType],
        ...rule.notifiedDepartments.map((item) => ALERT_RULE_DEPARTMENT_LABELS[item]),
        rule.domain,
      ].join(' ').toLocaleLowerCase('pt-BR')
      return searchable.includes(normalizedQuery)
    })
  }, [department, domain, query, severity])

  const selectedRule = filteredRules.find((rule) => rule.type === selectedParam) ?? filteredRules[0] ?? null

  useEffect(() => {
    const current = searchParams.get('regra')
    const nextRule = selectedRule?.type ?? null
    if (current === nextRule || (!current && !nextRule)) return

    const next = new URLSearchParams(searchParams)
    if (nextRule) next.set('regra', nextRule)
    else next.delete('regra')
    setSearchParams(next, { replace: true })
  }, [searchParams, selectedRule?.type, setSearchParams])

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (!value || value === ALL_FILTER_VALUE) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  function clearFilters() {
    const next = new URLSearchParams()
    if (selectedRule) next.set('regra', selectedRule.type)
    setSearchParams(next, { replace: true })
  }

  const hasFilters = Boolean(
    query
    || department !== ALL_FILTER_VALUE
    || domain !== ALL_FILTER_VALUE
    || severity !== ALL_FILTER_VALUE,
  )

  return (
    <>
      <PageHeader
        title="Regras de alertas"
        action={(
          <Link to="/alertas" className="app-btn app-btn--secondary">
            Voltar para Alertas
          </Link>
        )}
      />

      <div className="app-filter-grid mb-4">
        <Field label="Busca">
          <Input
            type="search"
            value={query}
            onChange={(event) => updateFilter('q', event.target.value)}
            placeholder="Nome, gatilho, registro ou tela"
            aria-label="Buscar regras de alertas"
          />
        </Field>
        <Field label="Setor avisado">
          <Select value={department} onChange={(event) => updateFilter('setor', event.target.value)}>
            {DEPARTMENTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>
        <Field label="Assunto">
          <Select value={domain} onChange={(event) => updateFilter('dominio', event.target.value)}>
            <option value={ALL_FILTER_VALUE}>Todos</option>
            {ALERT_RULE_DOMAINS.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Gravidade">
          <Select value={severity} onChange={(event) => updateFilter('gravidade', event.target.value)}>
            {SEVERITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>
        <div><Button variant="ghost" onClick={clearFilters} disabled={!hasFilters}>Limpar filtros</Button></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(250px,0.7fr)_minmax(0,1.5fr)] lg:items-start">
        <Block
          title="Regras"
          aside={`${filteredRules.length} ${filteredRules.length === 1 ? 'regra' : 'regras'}`}
          flush
        >
          {filteredRules.length ? (
            <div className="max-h-[min(66vh,720px)] overflow-y-auto" role="list" aria-label="Regras de alertas">
              {filteredRules.map((rule) => (
                <RuleListItem
                  key={rule.type}
                  rule={rule}
                  selected={selectedRule?.type === rule.type}
                  onSelect={() => updateFilter('regra', rule.type)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={FilterX}
              title="Nenhuma regra encontrada"
              description="Tente remover um filtro ou buscar por outro termo."
            />
          )}
        </Block>

        {selectedRule ? <RuleDetail rule={selectedRule} /> : null}
      </div>
    </>
  )
}

function departmentList(departments: AlertRuleDepartment[]): string {
  return departments.map((department) => ALERT_RULE_DEPARTMENT_LABELS[department]).join(' · ')
}

function SeverityText({ severity }: { severity: AlertRuleSeverity }) {
  return severity === 'critical'
    ? <StatusText tone="danger">{ALERT_RULE_SEVERITY_LABELS[severity]}</StatusText>
    : <>{ALERT_RULE_SEVERITY_LABELS[severity]}</>
}

function RuleListItem({
  rule,
  selected,
  onSelect,
}: {
  rule: AlertRule
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      aria-controls={`regra-${rule.type}`}
      className={`flex w-full items-center gap-3 border-b border-[var(--app-border-soft)] px-4 py-3 text-left ${selected
        ? 'bg-[var(--app-strip)] shadow-[inset_3px_0_0_var(--app-link)]'
        : 'hover:bg-[var(--app-surface-hover)]'}`}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[var(--app-text-strong)]">{rule.label}</span>
        <span className="mt-0.5 block text-xs text-[var(--app-muted)]">
          <SeverityText severity={rule.severity} /> · {departmentList(rule.responsibleDepartments)} · {rule.domain}
        </span>
      </span>
      <ChevronRight size={15} className={selected ? 'text-[var(--app-link)]' : 'text-[var(--app-muted)]'} aria-hidden="true" />
    </button>
  )
}

/**
 * Detalhe da regra em três blocos com dado principal (lote 5a): Quando abre,
 * Quem recebe e Como resolver. Sem o código interno e o endereço da tela; o
 * código continua valendo na busca.
 */
function RuleDetail({ rule }: { rule: AlertRule }) {
  const alsoNotified = rule.notifiedDepartments.filter((department) => !rule.responsibleDepartments.includes(department))

  return (
    <div id={`regra-${rule.type}`} className="grid gap-4">
      <div>
        <h2 className="text-xl font-bold text-[var(--app-text-strong)]">{rule.label}</h2>
        <p className="mt-1 text-[var(--app-muted)]"><SeverityText severity={rule.severity} /> · {rule.domain}</p>
      </div>

      <Block title="Quando abre" headingLevel={3}>
        <LeadValue>{rule.trigger}</LeadValue>
        <FactList columns={3}>
          <Fact label="Registro">{ENTITY_TYPE_LABELS[rule.entityType] ?? rule.entityType}</Fact>
          <Fact label="Aparece">{rule.timing}</Fact>
          <Fact label="Fecha">{rule.afterResolution}</Fact>
        </FactList>
      </Block>

      <div className="grid gap-4 xl:grid-cols-2">
        <Block title="Quem recebe" headingLevel={3}>
          <LeadValue>{departmentList(rule.responsibleDepartments)}</LeadValue>
          <FactList columns={2}>
            <Fact label="Responsável">{departmentList(rule.responsibleDepartments)}</Fact>
            <Fact label="Avisados">{departmentList(rule.notifiedDepartments)}</Fact>
          </FactList>
          {alsoNotified.length ? <p className="mt-3 text-[var(--app-muted)]">Além do responsável, também recebe: {departmentList(alsoNotified)}.</p> : null}
          {rule.routingNote ? <p className="mt-3 text-[var(--app-muted)]">{rule.routingNote}</p> : null}
          {rule.severity === 'critical' ? <p className="mt-3 text-[var(--app-muted)]" title={ALERT_CRITICAL_FALLBACK_NOTE}>Sem ninguém ativo nesses setores, o alerta crítico vai para o Administrativo.</p> : null}
        </Block>

        <Block
          title="Como resolver"
          headingLevel={3}
          aside={<Link to={rule.destination} className="app-btn app-btn--secondary app-btn--sm">{rule.destinationLabel}</Link>}
        >
          <LeadValue>{rule.resolution}</LeadValue>
          {rule.destinationNote ? <p className="mt-2 text-[var(--app-muted)]">{rule.destinationNote}</p> : null}
          <FactList columns={1}>
            <Fact label="Dispensa">{rule.dismissal}</Fact>
          </FactList>
          {rule.domain === 'Portal' ? (
            <p className="mt-3 text-[var(--app-muted)]">O Portal pode ser a origem do evento, mas este alerta é tratado pela equipe interna na fila de Alertas.</p>
          ) : null}
        </Block>
      </div>
    </div>
  )
}

function isDepartmentFilter(value: string | null): value is 'todos' | AlertRuleDepartment {
  return value === 'todos' || Boolean(value && value in ALERT_RULE_DEPARTMENT_LABELS)
}

function isDomain(value: string | null): value is AlertRuleDomain {
  return value !== null && ALERT_RULE_DOMAINS.includes(value as AlertRuleDomain)
}

function isSeverity(value: string | null): value is AlertRuleSeverity {
  return value === 'critical' || value === 'normal'
}
