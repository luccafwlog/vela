import { ChevronRight, FilterX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { EmptyState, PageHeader } from '../components/ui/Card'
import { Block, Fact, FactList, LeadValue } from '../components/ui/Block'
import { Button } from '../components/ui/Button'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { Drawer } from '../components/ui/Drawer'
import { SegmentedControl, type SegmentedOption } from '../components/ui/SegmentedControl'
import { useNarrowViewport } from '../components/bl/useNarrowViewport'
import { AlertLinkSample, AlertRulesMap, type AlertMapCard, type AlertMapFocus } from '../components/alerts/AlertRulesMap'
import { AlertChainBlock, AlertMapLegend, AlertMapTourBar, AlertMapTours, InactionWalkBar, NoticeDetail, StakeDetail } from '../components/alerts/AlertRuleChain'
import { NoValue } from '../components/ui/NoValue'
import { StatusText } from '../components/ui/StatusText'
import { useToast } from '../components/ui/Toast'
import { useAlertTypeSettings } from '../hooks/useAlertTypeSettings'
import { useAlertQueueCountsByType } from '../hooks/useAlertQueueCountsByType'
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
import { setAlertTypeEscalation, setAlertTypeSeverity, type AlertTypeSetting } from '../services/alertTypeSettings'
import {
  ALERT_BUILTIN_ESCALATION,
  ALERT_DEV_ROUTING,
  ALERT_LINK_KINDS,
  ALERT_MAP_NOTICES,
  ALERT_MAP_SHORT_LABELS,
  ALERT_MAP_STATIONS,
  ALERT_MAP_TOURS,
  ALERT_STAKES,
  inactionWalk,
  isAlertMapNotice,
  stakeCauses,
  stakeLabel,
  type AlertLinkKind,
  type AlertMapNodeId,
  type AlertMapTour,
  type AlertMapNoticeId,
  type AlertStakeId,
  type InactionWalk,
} from '../services/alertRulesMap'
import { ENTITY_TYPE_LABELS } from '../services/alerts'
import { afterGravidadeDoAlertaAlterada } from '../services/cacheEffects'

export type AlertRuleDepartmentFilter = 'all' | 'todos' | 'dev' | AlertRuleDepartment
type AlertRulesView = 'mapa' | 'lista'

const DEPARTMENTS: Array<{ value: AlertRuleDepartmentFilter; label: string }> = [
  { value: 'all', label: 'Qualquer setor' },
  { value: 'todos', label: 'Aplicável a todos os setores' },
  { value: 'documentacao', label: 'Documentação' },
  { value: 'equipamentos', label: 'Equipamentos' },
  { value: 'operacoes', label: 'Operações' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'administrativo', label: 'Administrativo' },
  { value: 'dev', label: 'Conta Dev' },
]

const SEVERITIES: Array<{ value: 'all' | AlertRuleSeverity; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'critical', label: 'Crítico' },
  { value: 'normal', label: 'Normal' },
]

const VIEWS: Array<SegmentedOption<AlertRulesView>> = [
  { value: 'mapa', label: 'Mapa' },
  { value: 'lista', label: 'Lista' },
]

const ALL_FILTER_VALUE = 'all'
// Abaixo disso a ficha do mapa abre em painel lateral sobre a tela.
const MAP_SIDE_PANEL_QUERY = '(max-width: 1279px)'

const TEAM_ORDER: AlertRuleDepartment[] = ['operacoes', 'documentacao', 'equipamentos', 'financeiro', 'administrativo']
const TEAM_ABBR: Record<AlertRuleDepartment, string> = {
  operacoes: 'Oper',
  documentacao: 'Doc',
  equipamentos: 'Equip',
  financeiro: 'Fin',
  administrativo: 'Adm',
}
const RULES_BY_TYPE = new Map<string, AlertRule>(ALERT_RULES.map((rule) => [rule.type, rule]))
const MAP_NODES = new Set<string>(ALERT_MAP_STATIONS.flatMap((station) => station.nodes))
const NOTICE_COUNT = Object.keys(ALERT_MAP_NOTICES).length

type SettingsState = {
  byType: ReadonlyMap<string, AlertTypeSetting>
  loading: boolean
  failed: boolean
}

type RuleFilters = {
  query: string
  department: AlertRuleDepartmentFilter
  domain: typeof ALL_FILTER_VALUE | AlertRuleDomain
  severity: typeof ALL_FILTER_VALUE | AlertRuleSeverity
}

/** Gravidade que vale agora: a do banco (trocada na tela) ou, sem ela, a de fábrica. */
function liveSeverity(rule: AlertRule, settings: SettingsState): AlertRuleSeverity {
  return settings.byType.get(rule.type)?.severity ?? rule.severity
}

/**
 * Quem recebe, para o filtro de setor: o alerta técnico só da conta Dev
 * (migration 620) não conta para o Administrativo; 'dev' é todo alerta que a
 * conta Dev recebe à parte (só ela, junto com a equipe ou pela causa).
 */
function receivesRule(rule: AlertRule, department: AlertRuleDepartmentFilter): boolean {
  const dev = ALERT_DEV_ROUTING[rule.type]
  if (department === ALL_FILTER_VALUE) return true
  if (department === 'dev') return Boolean(dev)
  if (dev === 'only') return false
  // O valor especial 'todos' filtra somente regras aplicáveis a todos os setores operacionais.
  if (department === 'todos') return ALERT_RULE_DEPARTMENTS.every((dep) => rule.notifiedDepartments.includes(dep))
  return rule.notifiedDepartments.includes(department)
}

function ruleMatches(rule: AlertRule, filters: RuleFilters, severity: AlertRuleSeverity): boolean {
  // O setor filtra por quem é notificado, não só por quem responde: um
  // mesmo alerta pode chegar a mais de um setor.
  if (!receivesRule(rule, filters.department)) return false
  if (filters.domain !== ALL_FILTER_VALUE && rule.domain !== filters.domain) return false
  if (filters.severity !== ALL_FILTER_VALUE && severity !== filters.severity) return false
  const query = filters.query.trim().toLocaleLowerCase('pt-BR')
  if (!query) return true
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
  return searchable.includes(query)
}

/** Marco do mapa no filtro: sem gravidade nem assunto, só entra sem esses filtros. */
function noticeMatches(id: AlertMapNoticeId, filters: RuleFilters): boolean {
  const notice = ALERT_MAP_NOTICES[id]
  if (filters.severity !== ALL_FILTER_VALUE || filters.domain !== ALL_FILTER_VALUE || filters.department === 'dev') return false
  if (filters.department !== ALL_FILTER_VALUE && notice.teams !== 'todos' && (filters.department === 'todos' || !notice.teams.includes(filters.department))) return false
  const query = filters.query.trim().toLocaleLowerCase('pt-BR')
  return !query || `${notice.label} ${notice.summary} ${notice.when}`.toLocaleLowerCase('pt-BR').includes(query)
}

function nodeLabel(id: AlertMapNodeId): string {
  return isAlertMapNotice(id) ? ALERT_MAP_NOTICES[id].label : RULES_BY_TYPE.get(id)?.label ?? id
}

function buildCards(settings: SettingsState): Map<AlertMapNodeId, AlertMapCard> {
  const cards = new Map<AlertMapNodeId, AlertMapCard>()
  for (const id of MAP_NODES as Set<AlertMapNodeId>) {
    if (isAlertMapNotice(id)) {
      const notice = ALERT_MAP_NOTICES[id]
      cards.set(id, {
        id,
        label: notice.label,
        fullLabel: notice.label,
        notice: notice.channel,
        severity: null,
        escalation: null,
        teams: notice.teams === 'todos' ? ['Todos'] : TEAM_ORDER.filter((team) => (notice.teams as AlertRuleDepartment[]).includes(team)).map((team) => TEAM_ABBR[team]),
        dev: null,
      })
      continue
    }
    const rule = RULES_BY_TYPE.get(id)
    if (!rule) continue
    const dev = ALERT_DEV_ROUTING[rule.type] ?? null
    const hours = settings.byType.get(rule.type)?.escalateAfterHours ?? null
    cards.set(id, {
      id,
      label: ALERT_MAP_SHORT_LABELS[rule.type] ?? rule.label,
      fullLabel: rule.label,
      notice: null,
      severity: liveSeverity(rule, settings),
      escalation: ALERT_BUILTIN_ESCALATION[rule.type] ?? (hours ? `Crítico após ${hours} h` : null),
      teams: dev === 'only' ? [] : TEAM_ORDER.filter((team) => rule.notifiedDepartments.includes(team)).map((team) => TEAM_ABBR[team]),
      dev,
    })
  }
  return cards
}

export function AlertasRegras() {
  const [searchParams, setSearchParams] = useSearchParams()
  const settingsQuery = useAlertTypeSettings()
  const countsQuery = useAlertQueueCountsByType()
  const settings: SettingsState = {
    byType: settingsQuery.byType,
    loading: settingsQuery.isPending,
    failed: settingsQuery.isError,
  }
  const sidePanelAsDrawer = useNarrowViewport(MAP_SIDE_PANEL_QUERY)
  const [walkState, setWalkState] = useState<{ walk: InactionWalk; step: number } | null>(null)
  const [tourState, setTourState] = useState<{ tour: AlertMapTour; step: number } | null>(null)
  const stakesRef = useRef<HTMLDetailsElement>(null)

  const view: AlertRulesView = searchParams.get('visao') === 'lista' ? 'lista' : 'mapa'
  const query = searchParams.get('q') ?? ''
  const department = isDepartmentFilter(searchParams.get('setor')) ? searchParams.get('setor') as AlertRuleDepartmentFilter : ALL_FILTER_VALUE
  const domain = isDomain(searchParams.get('dominio')) ? searchParams.get('dominio') as AlertRuleDomain : ALL_FILTER_VALUE
  const severity = isSeverity(searchParams.get('gravidade')) ? searchParams.get('gravidade') as AlertRuleSeverity : ALL_FILTER_VALUE
  const selectedParam = searchParams.get('regra')
  const stakeParam = isStake(searchParams.get('parado')) ? searchParams.get('parado') as AlertStakeId : null
  const filters = useMemo<RuleFilters>(() => ({ query, department, domain, severity }), [query, department, domain, severity])

  const filteredRules = useMemo(
    () => ALERT_RULES.filter((rule) => ruleMatches(rule, filters, settingsQuery.byType.get(rule.type)?.severity ?? rule.severity)),
    [filters, settingsQuery.byType],
  )

  // Na lista, como antes: sem regra escolhida, vale a primeira do filtro.
  const selectedRule = filteredRules.find((rule) => rule.type === selectedParam) ?? filteredRules[0] ?? null
  // No mapa, só o que foi escolhido: sem escolha, a ficha ensina a ler o mapa.
  const mapSelected = selectedParam && MAP_NODES.has(selectedParam) ? selectedParam as AlertMapNodeId : null

  const settingsPending = settingsQuery.isPending
  useEffect(() => {
    // Com a gravidade vigente ainda carregando, o filtro de gravidade usa a de
    // fábrica: reescrever a regra do link agora perderia a escolhida.
    if (view !== 'lista' || settingsPending) return
    const current = searchParams.get('regra')
    const nextRule = selectedRule?.type ?? null
    if (current === nextRule || (!current && !nextRule)) return

    const next = new URLSearchParams(searchParams)
    if (nextRule) next.set('regra', nextRule)
    else next.delete('regra')
    setSearchParams(next, { replace: true })
  }, [searchParams, selectedRule?.type, setSearchParams, settingsPending, view])

  const cards = useMemo(
    () => buildCards({ byType: settingsQuery.byType, loading: false, failed: false }),
    [settingsQuery.byType],
  )

  function changeParams(change: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams)
    change(next)
    setSearchParams(next, { replace: true })
  }

  function updateFilter(key: string, value: string) {
    changeParams((next) => {
      if (!value || value === ALL_FILTER_VALUE) next.delete(key)
      else next.set(key, value)
    })
  }

  function clearFilters() {
    const next = new URLSearchParams()
    if (view === 'lista' && selectedRule) next.set('regra', selectedRule.type)
    if (view === 'mapa' && selectedParam) next.set('regra', selectedParam)
    if (view === 'lista') next.set('visao', 'lista')
    if (stakeParam) next.set('parado', stakeParam)
    setSearchParams(next, { replace: true })
  }

  function setView(next: AlertRulesView) {
    setWalkState(null)
    changeParams((params) => {
      if (next === 'lista') params.set('visao', 'lista')
      else params.delete('visao')
      params.delete('parado')
    })
  }

  function revealCard(id: AlertMapNodeId) {
    const element = document.querySelector(`[data-node="${id}"]`)
    if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  /** Escolher pela ficha: vai ao alerta e o mostra no mapa. */
  function selectNode(id: AlertMapNodeId) {
    setWalkState(null)
    setTourState(null)
    changeParams((next) => {
      next.set('regra', id)
      next.delete('parado')
    })
    if (view === 'mapa') revealCard(id)
  }

  /** Clicar no cartão: escolhe, ou solta se já estava escolhido. */
  function toggleCard(id: AlertMapNodeId) {
    if (mapSelected === id && !walkState) clearSelection()
    else selectNode(id)
  }

  function selectStake(stake: AlertStakeId | null) {
    setWalkState(null)
    setTourState(null)
    changeParams((next) => {
      next.delete('regra')
      if (stake) next.set('parado', stake)
      else next.delete('parado')
    })
  }

  function clearSelection() {
    setWalkState(null)
    setTourState(null)
    changeParams((next) => {
      next.delete('regra')
      next.delete('parado')
    })
  }

  function startWalk(id: AlertMapNodeId) {
    setTourState(null)
    setWalkState({ walk: inactionWalk(id), step: 0 })
    changeParams((next) => {
      next.delete('visao')
      next.delete('parado')
      next.set('regra', id)
    })
    revealCard(id)
  }

  /** Roteiro: cada passo escolhe um alerta ou uma coisa parada, sem sair do mapa. */
  function tourTo(tour: AlertMapTour, step: number) {
    const bounded = Math.max(0, Math.min(step, tour.steps.length - 1))
    const current = tour.steps[bounded]
    setWalkState(null)
    setTourState({ tour, step: bounded })
    changeParams((next) => {
      next.delete('visao')
      if ('node' in current) {
        next.set('regra', current.node)
        next.delete('parado')
      } else {
        next.set('parado', current.stake)
        next.delete('regra')
      }
    })
    if ('node' in current) revealCard(current.node)
  }

  function walkTo(step: number) {
    if (!walkState) return
    const bounded = Math.max(0, Math.min(step, walkState.walk.steps.length))
    setWalkState({ walk: walkState.walk, step: bounded })
    const reached = walkState.walk.steps[bounded]
    if (reached?.length && bounded > 0) revealCard(reached[0])
  }

  const hasFilters = Boolean(
    query
    || department !== ALL_FILTER_VALUE
    || domain !== ALL_FILTER_VALUE
    || severity !== ALL_FILTER_VALUE,
  )

  const mapMatches = (id: AlertMapNodeId) => {
    if (isAlertMapNotice(id)) return noticeMatches(id, filters)
    const rule = RULES_BY_TYPE.get(id)
    return rule ? ruleMatches(rule, filters, liveSeverity(rule, settings)) : false
  }
  const mapMatchCount = [...MAP_NODES].filter((id) => mapMatches(id as AlertMapNodeId)).length

  const focus: AlertMapFocus | null = walkState
    ? { kind: 'walk', walk: walkState.walk, step: walkState.step }
    : mapSelected
      ? { kind: 'node', id: mapSelected }
      : stakeParam
        ? { kind: 'stake', id: stakeParam }
        : null
  const walkStakes = walkState && walkState.step >= walkState.walk.steps.length ? walkState.walk.stakes : []
  const openStakes = walkStakes.length > 0 || Boolean(stakeParam && !tourState)
  useEffect(() => {
    // Quem trava o quê nasce recolhido; abre quando a tela escolhe uma coisa parada.
    if (openStakes && stakesRef.current) stakesRef.current.open = true
  }, [openStakes])

  const chainFor = (id: AlertMapNodeId) => (
    <AlertChainBlock id={id} labelOf={nodeLabel} onSelect={selectNode} onStake={selectStake} onWalk={startWalk} />
  )
  const isCritical = (id: AlertMapNodeId) => {
    const rule = isAlertMapNotice(id) ? null : RULES_BY_TYPE.get(id)
    return rule ? liveSeverity(rule, settings) === 'critical' : false
  }

  const mapDetail = mapSelected
    ? isAlertMapNotice(mapSelected)
      ? <NoticeDetail id={mapSelected}>{chainFor(mapSelected)}</NoticeDetail>
      : <RuleDetail rule={RULES_BY_TYPE.get(mapSelected)!} settings={settings} chain={chainFor(mapSelected)} />
    : stakeParam
      ? (
        <StakeDetail
          stake={stakeParam}
          labelOf={nodeLabel}
          isCritical={isCritical}
          impactOf={(id) => (isAlertMapNotice(id) ? '' : RULES_BY_TYPE.get(id)?.impact ?? '')}
          summaryOf={(id) => (isAlertMapNotice(id) ? ALERT_MAP_NOTICES[id].summary : RULES_BY_TYPE.get(id)?.summary ?? '')}
          onSelect={selectNode}
        />
      )
      : null
  const drawerTitle = mapSelected ? nodeLabel(mapSelected) : stakeParam ? stakeLabel(stakeParam) : 'Regras de alertas'

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

      <SegmentedControl label="Visão" options={VIEWS} value={view} onChange={setView} className="mb-4" />

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

      {view === 'mapa' ? (
        <>
          <div className="grid gap-3">
            <AlertMapTours activeId={tourState?.tour.id ?? null} onStart={(id) => tourTo(ALERT_MAP_TOURS.find((tour) => tour.id === id)!, 0)} />

            <details ref={stakesRef} className="group rounded-[var(--app-radius)] border border-[var(--app-border-soft)] bg-[var(--app-surface)]">
              <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-[var(--app-radius)] bg-[var(--app-strip)] px-4 py-2.5 group-open:rounded-b-none group-open:border-b group-open:border-[var(--app-border-soft)]">
                <span className="font-semibold text-[var(--app-strip-text)]"><span aria-hidden="true" className="mr-1.5 inline-block transition-transform group-open:rotate-90">▸</span>Quem trava o quê</span>
                <span className="text-sm text-[var(--app-muted)]">Escolha o que está parado: a ficha mostra o alerta que avisa e os alertas que podem ser a causa</span>
              </summary>
              <div className="flex flex-wrap gap-1.5 p-3" role="group" aria-label="Quem trava o quê">
                {ALERT_STAKES.map((stake) => {
                  const total = stakeCauses(stake.id).length
                  const pressed = stakeParam === stake.id
                  return (
                    <Button
                      key={stake.id}
                      variant={pressed ? 'primary' : walkStakes.includes(stake.id) ? 'danger' : 'secondary'}
                      className="app-btn--sm"
                      aria-pressed={pressed}
                      onClick={() => selectStake(pressed ? null : stake.id)}
                    >
                      {stake.label} <span className="text-xs">{total}</span>
                    </Button>
                  )
                })}
              </div>
            </details>
          </div>

          <div className="mb-2 mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-[var(--app-muted)]">
            <span>
              {MAP_NODES.size - NOTICE_COUNT} alertas e {NOTICE_COUNT} avisos em {ALERT_MAP_STATIONS.length} momentos.
              {hasFilters ? ` ${mapMatchCount} ${mapMatchCount === 1 ? 'atende' : 'atendem'} aos filtros.` : ''}
            </span>
            {(Object.keys(ALERT_LINK_KINDS) as AlertLinkKind[]).map((kind) => (
              <span key={kind} className="inline-flex items-center gap-1.5"><AlertLinkSample kind={kind} />{ALERT_LINK_KINDS[kind].label}</span>
            ))}
          </div>

          <div className={sidePanelAsDrawer ? 'grid gap-4' : 'grid grid-cols-[minmax(0,1fr)_400px] items-start gap-4'}>
            <AlertRulesMap
              cards={cards}
              matches={mapMatches}
              focus={focus}
              counts={countsQuery.data}
              onSelect={toggleCard}
            />
            {sidePanelAsDrawer ? null : (
              <aside aria-label="Ficha" className="sticky top-3 grid max-h-[calc(100vh-24px)] gap-4 overflow-y-auto">
                {mapDetail ?? <AlertMapLegend />}
              </aside>
            )}
          </div>

          {sidePanelAsDrawer ? (
            <Drawer open={Boolean(mapDetail) && !walkState && !tourState} title={drawerTitle} onClose={clearSelection}>
              {mapDetail}
            </Drawer>
          ) : null}

          {tourState ? (
            <AlertMapTourBar tour={tourState.tour} step={tourState.step} onStep={(step) => tourTo(tourState.tour, step)} onClose={clearSelection} />
          ) : null}

          {walkState ? (
            <InactionWalkBar walk={walkState.walk} step={walkState.step} labelOf={nodeLabel} onStep={walkTo} onClose={() => setWalkState(null)} />
          ) : null}
        </>
      ) : (
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

          {selectedRule ? (
            <RuleDetail
              rule={selectedRule}
              settings={settings}
              chain={MAP_NODES.has(selectedRule.type) ? chainFor(selectedRule.type as AlertMapNodeId) : null}
            />
          ) : null}
        </div>
      )}
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
function RuleDetail({ rule, settings, chain }: { rule: AlertRule; settings: SettingsState; chain?: ReactNode }) {
  const severity = liveSeverity(rule, settings)
  const alsoNotified = rule.notifiedDepartments.filter((department) => !rule.responsibleDepartments.includes(department))

  return (
    <div id={`regra-${rule.type}`} className="grid gap-4">
      <div>
        <h2 className="text-xl font-bold text-[var(--app-text-strong)]">{rule.label}</h2>
        <p className="mt-1 text-[var(--app-muted)]"><SeverityText severity={severity} /> · {rule.domain}</p>
      </div>

      {chain}

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
      <EscalationBlock rule={rule} settings={settings} />
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

/**
 * Reforço por tempo (migration 604, ADR 0131, D8): o alerta Normal aberto há
 * mais de N horas vira Crítico e avisa de novo no sino. Só o Administrativo
 * liga, muda ou tira, com motivo.
 */
function EscalationBlock({ rule, settings }: { rule: AlertRule; settings: SettingsState }) {
  const { can } = useAuth()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [hours, setHours] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const setting = settings.byType.get(rule.type) ?? null
  const severity = liveSeverity(rule, settings)
  const current = setting?.escalateAfterHours ?? null
  const canChange = can('manage_alert_rules')
  const last = setting?.lastEscalationChange ?? null
  const parsedHours = Number(hours)
  const validHours = Number.isInteger(parsedHours) && parsedHours >= 1 && parsedHours <= 720
  const validReason = reason.trim().length >= 10

  function openDialog() {
    setHours(current ? String(current) : '')
    setReason('')
    setOpen(true)
  }

  async function save(next: number | null) {
    setSaving(true)
    try {
      await setAlertTypeEscalation(rule.type, next, reason)
      await afterGravidadeDoAlertaAlterada(queryClient)
      showToast(next ? `${rule.label} agora vira Crítico depois de ${plural(next, 'hora', 'horas')} aberto.` : `${rule.label} ficou sem reforço por tempo.`, 'success')
      setOpen(false)
    } catch (err) {
      showToast(`Falha ao trocar o reforço: ${userFacingErrorMessage(err, 'tente novamente.')}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const lead = current
    ? `Vira Crítico depois de ${plural(current, 'hora', 'horas')} aberto`
    : 'Sem reforço por tempo'
  const showButton = canChange && setting && (severity === 'normal' || current !== null)

  return (
    <Block
      title="Reforço por tempo"
      headingLevel={3}
      aside={showButton ? (
        <Button variant="secondary" className="app-btn--sm" onClick={openDialog}>
          {current ? 'Mudar reforço' : 'Definir reforço'}
        </Button>
      ) : null}
    >
      <LeadValue tone={current ? 'warning' : 'muted'}>{lead}</LeadValue>
      <p className="text-[var(--app-muted)]">
        {severity === 'critical'
          ? 'Este alerta já é Crítico: o reforço só vale para alerta Normal.'
          : 'O alerta Normal que ficar aberto mais tempo que isso passa a Crítico, sobe na fila e avisa de novo no sino. Fechar e reabrir recomeça a contagem.'}
      </p>
      {last ? (
        <p className="mt-2">
          Última troca: {formatBrasiliaDateTime(new Date(last.at))}{last.byName ? `, por ${last.byName}` : ''}{last.reason ? `. Motivo: ${last.reason}` : ''}
        </p>
      ) : null}
      {!canChange ? <p className="mt-2 text-[var(--app-muted)]">Só o Administrativo define o reforço, com motivo.</p> : null}

      <Modal open={open} size="sm" title="Reforço por tempo" onClose={() => (saving ? undefined : setOpen(false))}>
        <div className="grid gap-4">
          <p>Depois de quantas horas aberto o alerta <b>{rule.label}</b> vira Crítico?</p>
          <Field label="Horas (de 1 a 720)">
            <Input id="reforco-horas" type="number" min={1} max={720} step={1} value={hours} onChange={(event) => setHours(event.target.value)} />
          </Field>
          <p className="text-[var(--app-muted)]">Vale para os alertas abertos agora e os próximos: os que já passaram desse tempo viram Críticos em até 5 minutos e avisam de novo no sino.</p>
          <Field label="Motivo da troca (obrigatório, 10 caracteres ou mais)">
            <Textarea id="reforco-motivo" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Voltar</Button>
            {current ? (
              <Button variant="secondary" onClick={() => void save(null)} disabled={!validReason} loading={saving}>Tirar reforço</Button>
            ) : null}
            <Button onClick={() => void save(parsedHours)} disabled={!validHours || !validReason || parsedHours === current} loading={saving}>Salvar reforço</Button>
          </div>
        </div>
      </Modal>
    </Block>
  )
}

function isDepartmentFilter(value: string | null): value is 'todos' | 'dev' | AlertRuleDepartment {
  return value === 'todos' || value === 'dev' || Boolean(value && value in ALERT_RULE_DEPARTMENT_LABELS)
}

function isStake(value: string | null): value is AlertStakeId {
  return ALERT_STAKES.some((stake) => stake.id === value)
}

function isDomain(value: string | null): value is AlertRuleDomain {
  return value !== null && ALERT_RULE_DOMAINS.includes(value as AlertRuleDomain)
}

function isSeverity(value: string | null): value is AlertRuleSeverity {
  return value === 'critical' || value === 'normal'
}
