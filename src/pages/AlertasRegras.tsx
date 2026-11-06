import { ChevronRight, FilterX } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { EmptyState, PageHeader } from '../components/ui/Card'
import { Block, Fact, FactList, LeadValue } from '../components/ui/Block'
import { Button } from '../components/ui/Button'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { Field, Input, Select } from '../components/ui/Input'
import { NoValue } from '../components/ui/NoValue'
import { StatusText } from '../components/ui/StatusText'
import { useToast } from '../components/ui/Toast'
import { useAlertTypeSettings } from '../hooks/useAlertTypeSettings'
import { useAuth } from '../hooks/useAuth'
import { formatBrasiliaDateTime } from '../lib/dates'
import { userFacingErrorMessage } from '../lib/errors'
import {
  ALERT_RULES,
  ALERT_RULE_DEPARTMENTS,
  ALERT_RULE_DEPARTMENT_LABELS,
  ALERT_RULE_DOMAINS,
  ALERT_RULE_SEVERITY_LABELS,
  ALERT_RULE_SEVERITY_MEANINGS,
  alertFallbackSentence,
  departmentNames,
  type AlertRule,
  type AlertRuleDepartment,
  type AlertRuleDomain,
  type AlertRuleSeverity,
} from '../services/alertRulesCatalog'
import { setAlertTypeSeverity, type AlertTypeSetting } from '../services/alertTypeSettings'
import { ENTITY_TYPE_LABELS } from '../services/alerts'
import { afterGravidadeDoAlertaAlterada } from '../services/cacheEffects'

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

type SettingsState = {
  byType: ReadonlyMap<string, AlertTypeSetting>
  loading: boolean
  failed: boolean
}

/** Gravidade que vale agora: a do banco (trocada na tela) ou, sem ela, a de fábrica. */
function liveSeverity(rule: AlertRule, settings: SettingsState): AlertRuleSeverity {
  return settings.byType.get(rule.type)?.severity ?? rule.severity
}

export function AlertasRegras() {
  const [searchParams, setSearchParams] = useSearchParams()
  const settingsQuery = useAlertTypeSettings()
  const settings: SettingsState = {
    byType: settingsQuery.byType,
    loading: settingsQuery.isPending,
    failed: settingsQuery.isError,
  }
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
      if (severity !== ALL_FILTER_VALUE && (settingsQuery.byType.get(rule.type)?.severity ?? rule.severity) !== severity) return false
      if (!normalizedQuery) return true

      // O código interno do tipo não aparece na tela, mas continua valendo na busca.
      const searchable = [
        rule.type,
        rule.label,
        rule.summary,
        rule.trigger,
        rule.timing,
        rule.resolution,
        rule.impact,
        rule.afterResolution,
        rule.destinationLabel,
        rule.routingNote ?? '',
        ENTITY_TYPE_LABELS[rule.entityType],
        ...rule.notifiedDepartments.map((item) => ALERT_RULE_DEPARTMENT_LABELS[item]),
        rule.domain,
      ].join(' ').toLocaleLowerCase('pt-BR')
      return searchable.includes(normalizedQuery)
    })
  }, [department, domain, query, severity, settingsQuery.byType])

  const selectedRule = filteredRules.find((rule) => rule.type === selectedParam) ?? filteredRules[0] ?? null

  const settingsPending = settingsQuery.isPending
  useEffect(() => {
    // Com a gravidade vigente ainda carregando, o filtro de gravidade usa a de
    // fábrica: reescrever a regra do link agora perderia a escolhida.
    if (settingsPending) return
    const current = searchParams.get('regra')
    const nextRule = selectedRule?.type ?? null
    if (current === nextRule || (!current && !nextRule)) return

    const next = new URLSearchParams(searchParams)
    if (nextRule) next.set('regra', nextRule)
    else next.delete('regra')
    setSearchParams(next, { replace: true })
  }, [searchParams, selectedRule?.type, setSearchParams, settingsPending])

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
            placeholder="Nome do alerta, assunto ou o que ele cobra"
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
              {/* Os assuntos do capítulo 20 do manual, na ordem dele. */}
              {ALERT_RULE_DOMAINS.map((topic) => {
                const rules = filteredRules.filter((rule) => rule.domain === topic)
                if (!rules.length) return null
                return (
                  <div key={topic} role="group" aria-label={topic}>
                    <p className="border-b border-[var(--app-border-soft)] bg-[var(--app-bg)] px-4 py-1.5 text-xs font-semibold text-[var(--app-muted)]">
                      {topic}
                    </p>
                    {rules.map((rule) => (
                      <RuleListItem
                        key={rule.type}
                        rule={rule}
                        severity={liveSeverity(rule, settings)}
                        selected={selectedRule?.type === rule.type}
                        onSelect={() => updateFilter('regra', rule.type)}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState
              icon={FilterX}
              title="Nenhuma regra encontrada"
              description="Tente remover um filtro ou buscar por outro termo."
            />
          )}
        </Block>

        {selectedRule ? <RuleDetail rule={selectedRule} settings={settings} /> : null}
      </div>
    </>
  )
}

function SeverityText({ severity }: { severity: AlertRuleSeverity }) {
  return severity === 'critical'
    ? <StatusText tone="danger">{ALERT_RULE_SEVERITY_LABELS[severity]}</StatusText>
    : <>{ALERT_RULE_SEVERITY_LABELS[severity]}</>
}

function RuleListItem({
  rule,
  severity,
  selected,
  onSelect,
}: {
  rule: AlertRule
  severity: AlertRuleSeverity
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
          <SeverityText severity={severity} /> · {departmentNames(rule.responsibleDepartments)}
        </span>
      </span>
      <ChevronRight size={15} className={selected ? 'text-[var(--app-link)]' : 'text-[var(--app-muted)]'} aria-hidden="true" />
    </button>
  )
}

/**
 * Detalhe da regra (ADR 0130): o que é e o que acontece se ninguém agir,
 * quando abre e fecha, quem recebe, como resolver e a gravidade, que o
 * Administrativo troca aqui. Sem código interno, migration nem endereço de
 * tela; o código continua valendo na busca.
 */
function RuleDetail({ rule, settings }: { rule: AlertRule; settings: SettingsState }) {
  const severity = liveSeverity(rule, settings)
  const alsoNotified = rule.notifiedDepartments.filter((department) => !rule.responsibleDepartments.includes(department))

  return (
    <div id={`regra-${rule.type}`} className="grid gap-4">
      <div>
        <h2 className="text-xl font-bold text-[var(--app-text-strong)]">{rule.label}</h2>
        <p className="mt-1 text-[var(--app-muted)]"><SeverityText severity={severity} /> · {rule.domain}</p>
      </div>

      <Block title="O que é" headingLevel={3}>
        <LeadValue>{rule.summary}</LeadValue>
        <FactList columns={2}>
          <Fact label="Se ninguém agir">{rule.impact}</Fact>
          <Fact label="Onde aparece">{ENTITY_TYPE_LABELS[rule.entityType] ?? rule.entityType}</Fact>
        </FactList>
      </Block>

      <Block title="Quando abre e quando fecha" headingLevel={3}>
        <LeadValue>{rule.trigger}</LeadValue>
        <FactList columns={2}>
          <Fact label="Aparece">{rule.timing}</Fact>
          <Fact label="Fecha">{rule.afterResolution}</Fact>
        </FactList>
      </Block>

      <div className="grid gap-4 xl:grid-cols-2">
        <Block title="Quem recebe" headingLevel={3}>
          <LeadValue>{departmentNames(rule.responsibleDepartments)}</LeadValue>
          {alsoNotified.length ? <p className="mt-3">Também recebe no sino: {departmentNames(alsoNotified)}.</p> : null}
          {rule.routingNote ? <p className="mt-3">{rule.routingNote}</p> : null}
          <p className="mt-3 text-[var(--app-muted)]">Todas as equipes veem o alerta na fila, e qualquer pessoa ativa pode resolvê-lo.</p>
          <p className="mt-3 text-[var(--app-muted)]">{alertFallbackSentence(rule, severity)}</p>
        </Block>

        <Block
          title="Como resolver"
          headingLevel={3}
          aside={<Link to={rule.destination} className="app-btn app-btn--secondary app-btn--sm">{rule.destinationLabel}</Link>}
        >
          <LeadValue>{rule.resolution}</LeadValue>
          {rule.destinationNote ? <p className="mt-2 text-[var(--app-muted)]">{rule.destinationNote}</p> : null}
        </Block>
      </div>

      <SeverityBlock rule={rule} settings={settings} />
    </div>
  )
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/**
 * Gravidade vigente do tipo (migration 603): a de fábrica pode ter sido
 * trocada pelo Administrativo, com motivo. A troca vale para os alertas
 * abertos do tipo e para os próximos, e fica no Histórico de ações.
 */
function SeverityBlock({ rule, settings }: { rule: AlertRule; settings: SettingsState }) {
  const { can } = useAuth()
  const confirmWithReason = useConfirmWithReason()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const setting = settings.byType.get(rule.type) ?? null
  const severity = liveSeverity(rule, settings)
  const target: AlertRuleSeverity = severity === 'critical' ? 'normal' : 'critical'
  const canChange = can('manage_alert_rules')
  const lastChange = setting?.lastChange ?? null

  async function changeSeverity() {
    if (!setting) return
    const openCount = setting.activeItems
    const teams = departmentNames(rule.notifiedDepartments)
    const openSentence = openCount > 0
      ? `${plural(openCount, 'alerta aberto', 'alertas abertos')} deste tipo ${openCount === 1 ? 'passa' : 'passam'} a ${ALERT_RULE_SEVERITY_LABELS[target]} agora, e os próximos já abrem assim.`
      : `Os próximos alertas deste tipo já abrem como ${ALERT_RULE_SEVERITY_LABELS[target]}.`
    const effect = target === 'normal'
      ? `Normal: sai do alto da fila e do cartão Críticos; se ninguém de ${teams} estiver ativo, o aviso deixa de ir ao Administrativo.`
      : `Crítico: vai para o alto da fila, em vermelho, e conta no cartão Críticos; se ninguém de ${teams} estiver ativo, o aviso vai ao Administrativo.`
    const reason = await confirmWithReason({
      title: 'Trocar a gravidade',
      message: `Trocar a gravidade de "${rule.label}" de ${ALERT_RULE_SEVERITY_LABELS[severity]} para ${ALERT_RULE_SEVERITY_LABELS[target]}?`,
      consequence: `${openSentence} ${effect} O sino não avisa de novo os alertas que já estavam abertos.`,
      reversibility: `Dá para voltar a ${ALERT_RULE_SEVERITY_LABELS[severity]} aqui, com motivo. A troca fica em Admin › Histórico de ações, com o seu nome.`,
      reasonLabel: 'Motivo da troca (obrigatório, 10 caracteres ou mais)',
      confirmLabel: `Trocar para ${ALERT_RULE_SEVERITY_LABELS[target]}`,
    })
    if (reason === null) return
    setSaving(true)
    try {
      const result = await setAlertTypeSeverity(rule.type, target, reason)
      await afterGravidadeDoAlertaAlterada(queryClient)
      const moved = result.activeItems > 0 ? ` ${plural(result.activeItems, 'alerta aberto mudou', 'alertas abertos mudaram')} junto.` : ''
      showToast(`${rule.label} agora é ${ALERT_RULE_SEVERITY_LABELS[result.severity]}.${moved}`, 'success')
    } catch (err) {
      showToast(`Falha ao trocar a gravidade: ${userFacingErrorMessage(err, 'tente novamente.')}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Block
      title="Gravidade"
      headingLevel={3}
      aside={canChange ? (
        <Button
          variant="secondary"
          className="app-btn--sm"
          onClick={() => void changeSeverity()}
          disabled={!setting}
          loading={saving}
          title={setting ? undefined : 'Aguardando a gravidade vigente'}
        >
          Trocar para {ALERT_RULE_SEVERITY_LABELS[target]}
        </Button>
      ) : null}
    >
      <LeadValue tone={severity === 'critical' ? 'danger' : 'default'} detail={ALERT_RULE_SEVERITY_MEANINGS[severity]}>
        {ALERT_RULE_SEVERITY_LABELS[severity]}
      </LeadValue>
      <FactList columns={3}>
        <Fact label="Abertos agora">
          {setting ? plural(setting.activeItems, 'alerta', 'alertas') : <NoValue label={settings.loading ? 'Carregando' : 'Sem leitura'} />}
        </Fact>
        <Fact label="Gravidade de fábrica">{ALERT_RULE_SEVERITY_LABELS[rule.severity]}</Fact>
        <Fact label="Última troca">
          {lastChange
            ? `${formatBrasiliaDateTime(new Date(lastChange.at))}${lastChange.byName ? `, por ${lastChange.byName}` : ''}`
            : setting ? 'Nunca trocada' : <NoValue label={settings.loading ? 'Carregando' : 'Sem leitura'} />}
        </Fact>
      </FactList>
      {lastChange?.reason ? (
        <p className="mt-3">
          Motivo{lastChange.previousSeverity ? ` (era ${ALERT_RULE_SEVERITY_LABELS[lastChange.previousSeverity]})` : ''}: {lastChange.reason}
        </p>
      ) : null}
      {settings.failed ? (
        <p className="mt-3"><StatusText tone="warning">Não foi possível ler a gravidade vigente: a tela mostra a de fábrica.</StatusText></p>
      ) : null}
      {!canChange ? <p className="mt-3 text-[var(--app-muted)]">Só o Administrativo troca a gravidade, com motivo.</p> : null}
    </Block>
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
