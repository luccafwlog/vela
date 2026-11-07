import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { AlertLinkSample } from './AlertRulesMap'
import { ALERT_LINK_COLORS } from './alertLinkColors'
import {
  ALERT_DEV_ROUTING_LABELS,
  ALERT_LINK_KINDS,
  ALERT_MAP_NOTICES,
  ALERT_MAP_STATIONS,
  ALERT_MAP_TOURS,
  ALERT_STAKE_INFO,
  isStakeCause,
  linksOf,
  otherEnd,
  stakeLabel,
  stakesOf,
  type AlertLink,
  type AlertLinkKind,
  type AlertMapNodeId,
  type AlertMapTour,
  type AlertMapNoticeId,
  type AlertStakeId,
  type InactionWalk,
} from '../../services/alertRulesMap'

type LabelOf = (id: AlertMapNodeId) => string

function KindPill({ kind }: { kind: AlertLinkKind }) {
  return (
    <span
      className="mt-0.5 whitespace-nowrap rounded-full px-2 text-xs font-semibold leading-5 text-[var(--app-surface)]"
      style={{ background: ALERT_LINK_COLORS[kind].color }}
    >
      {ALERT_LINK_KINDS[kind].short}
    </span>
  )
}

function LinkList({ id, items, labelOf, onSelect, label }: {
  id: AlertMapNodeId
  items: AlertLink[]
  labelOf: LabelOf
  onSelect: (id: AlertMapNodeId) => void
  label: string
}) {
  if (!items.length) return null
  return (
    <div className="grid gap-2">
      <h4 className="text-xs font-semibold text-[var(--app-muted)]">{label}</h4>
      <ul className="grid gap-2" aria-label={label}>
        {items.map((item) => {
          const other = otherEnd(item, id)
          return (
            <li key={`${item.from}>${item.to}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
              <KindPill kind={item.kind} />
              <div className="min-w-0">
                <button type="button" className="app-link text-left" onClick={() => onSelect(other)}>{labelOf(other)}</button>
                <p className="text-sm text-[var(--app-muted)]">{item.text}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Cadeia do alerta (ADR 0134): o que vem antes, o que ele provoca se ninguém
 * agir, o que pode abrir em seguida, quem tem a mesma causa e o que fica
 * parado. "E se ninguém agir?" mostra a cascata passo a passo no mapa.
 */
export function AlertChainBlock({ id, labelOf, onSelect, onStake, onWalk }: {
  id: AlertMapNodeId
  labelOf: LabelOf
  onSelect: (id: AlertMapNodeId) => void
  onStake: (stake: AlertStakeId) => void
  onWalk: (id: AlertMapNodeId) => void
}) {
  const links = linksOf(id)
  const stakes = stakesOf(id)
  const isNotice = id in ALERT_MAP_NOTICES
  const none = !links.before.length && !links.inaction.length && !links.next.length && !links.same.length
  return (
    <Block
      title="Cadeia deste alerta"
      headingLevel={3}
      aside={isNotice ? null : <Button variant="secondary" className="app-btn--sm" onClick={() => onWalk(id)}>E se ninguém agir?</Button>}
    >
      <div className="grid gap-4">
        <LinkList id={id} items={links.before} labelOf={labelOf} onSelect={onSelect} label="Vem antes" />
        <LinkList id={id} items={links.inaction} labelOf={labelOf} onSelect={onSelect} label="Se ninguém agir" />
        <LinkList id={id} items={links.next} labelOf={labelOf} onSelect={onSelect} label="Em seguida, pode abrir" />
        <LinkList id={id} items={links.same} labelOf={labelOf} onSelect={onSelect} label="Mesma causa" />
        {none ? <p className="text-[var(--app-muted)]">Não abre nem segura outro alerta. O efeito dele fica no que para.</p> : null}
        {isNotice ? null : stakes.length ? (
          <div className="grid gap-2">
            <h4 className="text-xs font-semibold text-[var(--app-muted)]">Enquanto aberto, trava</h4>
            <div className="flex flex-wrap gap-1.5">
              {stakes.map((stake) => (
                <Button key={stake} variant="secondary" className="app-btn--sm" onClick={() => onStake(stake)}>{stakeLabel(stake)}</Button>
              ))}
            </div>
            <p className="text-sm text-[var(--app-muted)]">Clique para ver tudo o que pode travar cada um.</p>
          </div>
        ) : (
          <p className="text-[var(--app-muted)]">Não segura nada do Cliente nem do caixa: afeta a própria equipe.</p>
        )}
      </div>
    </Block>
  )
}

/** Ficha de um marco do mapa: aviso do sino ou e-mail, sem gravidade nem fila. */
export function NoticeDetail({ id, children }: { id: AlertMapNoticeId; children?: React.ReactNode }) {
  const notice = ALERT_MAP_NOTICES[id]
  const station = ALERT_MAP_STATIONS.find((item) => item.nodes.includes(id))
  const who = notice.teams === 'todos' ? 'Todos os usuários internos ativos' : notice.teams.map((team) => TEAM_NAMES[team]).join(' e ')
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-xl font-bold text-[var(--app-text-strong)]">{notice.label}</h2>
        <p className="mt-1 text-[var(--app-muted)]">
          {notice.channel === 'sino' ? 'Aviso do sino' : 'E-mail'}{station ? ` · ${station.when}, ${station.what}` : ''}
        </p>
      </div>
      {children}
      <Block title="O que é" headingLevel={3}>
        <LeadValue>{notice.summary}</LeadValue>
        <FactList columns={2}>
          <Fact label="Aparece">{notice.when}</Fact>
          <Fact label="Depois">{notice.after}</Fact>
        </FactList>
      </Block>
      <Block title="Quem recebe" headingLevel={3}>
        <LeadValue>{who}</LeadValue>
        <p className="mt-3 text-[var(--app-muted)]">É um aviso de acontecimento: não pede correção, não entra na fila de Alertas e não tem gravidade para trocar.</p>
      </Block>
    </div>
  )
}

const TEAM_NAMES: Record<string, string> = {
  operacoes: 'Operações',
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
  financeiro: 'Financeiro',
  administrativo: 'Administrativo',
}

/**
 * Ficha de uma coisa parada (Quem trava o quê): separa o alerta que avisa
 * (o sintoma) dos alertas que a travam (as causas), cada um com o motivo.
 */
export function StakeDetail({ stake, labelOf, isCritical, impactOf, summaryOf, onSelect }: {
  stake: AlertStakeId
  labelOf: LabelOf
  isCritical: (id: AlertMapNodeId) => boolean
  impactOf: (id: AlertMapNodeId) => string
  summaryOf: (id: AlertMapNodeId) => string
  onSelect: (id: AlertMapNodeId) => void
}) {
  const info = ALERT_STAKE_INFO[stake]
  const label = stakeLabel(stake)
  const groups = ALERT_MAP_STATIONS
    .map((station) => ({ station, ids: station.nodes.filter((id) => isStakeCause(id, stake)) }))
    .filter((group) => group.ids.length)
  const total = groups.reduce((sum, group) => sum + group.ids.length, 0)
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-xl font-bold text-[var(--app-text-strong)]">{label}</h2>
        <p className="mt-1 text-[var(--app-muted)]">{info.what}</p>
      </div>
      <Block title="Quem avisa que está parado" headingLevel={3}>
        <p className="text-sm text-[var(--app-muted)]">Este alerta abre quando {label} já está parado. Ele é o sintoma, não a causa.</p>
        <ul className="mt-2 grid gap-2" aria-label="Quem avisa">
          {info.warn.map((id) => (
            <li key={id}>
              <button type="button" className="app-link text-left" onClick={() => onSelect(id)}>{labelOf(id)}</button>
              <p className="text-sm text-[var(--app-muted)]">{summaryOf(id)}</p>
            </li>
          ))}
        </ul>
      </Block>
      <Block title="O que pode estar travando" headingLevel={3}>
        <p className="text-sm text-[var(--app-muted)]">
          {total === 1 ? '1 alerta' : `${total} alertas`}. Enquanto qualquer um deles estiver aberto, {label} fica parado. Resolva a causa e ele anda.
        </p>
        <div className="mt-3 grid gap-3">
          {groups.map(({ station, ids }) => (
            <div key={station.id}>
              <h4 className="text-table font-bold text-[var(--app-strip-text)]">{station.when} · {station.what}</h4>
              <ul className="mt-1 grid gap-2" aria-label={`Causas em ${station.when}`}>
                {ids.map((id) => (
                  <li key={id}>
                    <span className="flex flex-wrap items-center gap-2">
                      <button type="button" className="app-link text-left" onClick={() => onSelect(id)}>{labelOf(id)}</button>
                      {isCritical(id) ? <Badge tone="danger">Crítico</Badge> : null}
                      <span className="text-xs font-semibold text-[var(--app-gold-strong)]">→ trava {label}</span>
                    </span>
                    <p className="text-sm text-[var(--app-muted)]">{impactOf(id)}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Block>
    </div>
  )
}

/** Roteiros: histórias curtas sobre o mapa. Recolhido até alguém abrir. */
export function AlertMapTours({ activeId, onStart }: { activeId: string | null; onStart: (id: string) => void }) {
  return (
    <details className="group rounded-[var(--app-radius)] border border-[var(--app-border-soft)] bg-[var(--app-surface)]">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-[var(--app-radius)] bg-[var(--app-strip)] px-4 py-2.5 group-open:rounded-b-none group-open:border-b group-open:border-[var(--app-border-soft)]">
        <span className="font-semibold text-[var(--app-strip-text)]"><span aria-hidden="true" className="mr-1.5 inline-block transition-transform group-open:rotate-90">▸</span>Roteiros</span>
        <span className="text-sm text-[var(--app-muted)]">{ALERT_MAP_TOURS.length} histórias curtas, passo a passo, que mostram como os alertas se ligam</span>
      </summary>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2.5 p-3">
        {ALERT_MAP_TOURS.map((tour) => (
          <button
            key={tour.id}
            type="button"
            aria-pressed={activeId === tour.id}
            onClick={() => onStart(tour.id)}
            className={`grid content-start gap-1.5 rounded-[var(--app-radius)] border bg-[var(--app-surface)] p-3 text-left hover:border-[var(--app-navy)] ${activeId === tour.id ? 'border-[var(--app-navy)] shadow-[0_0_0_2px_var(--app-navy)]' : 'border-[var(--app-border)]'}`}
          >
            <span className="font-bold leading-snug text-[var(--app-strip-text)]">{tour.title}</span>
            <span className="text-sm text-[var(--app-muted)]">{tour.sub}</span>
            <span className="text-xs font-semibold text-[var(--app-strip-text)]">{tour.steps.length} passos · {tour.who}</span>
          </button>
        ))}
      </div>
    </details>
  )
}

/** Barra do roteiro, presa embaixo da tela. */
export function AlertMapTourBar({ tour, step, onStep, onClose }: {
  tour: AlertMapTour
  step: number
  onStep: (step: number) => void
  onClose: () => void
}) {
  const last = step >= tour.steps.length - 1
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
      <section aria-label="Roteiro" className="w-full max-w-[760px] overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-navy)] bg-[var(--app-surface)] shadow-[0_16px_40px_var(--app-border-focus)]">
        <header className="flex items-center gap-3 border-b border-[var(--app-border-soft)] bg-[var(--app-strip)] px-3 py-2 text-[var(--app-strip-text)]">
          <h2 className="text-sm font-bold">{tour.title}</h2>
          <span className="text-xs">Passo {step + 1} de {tour.steps.length}</span>
          <Button variant="ghost" className="app-btn--sm ml-auto" onClick={onClose}>Encerrar</Button>
        </header>
        <p className="px-3.5 py-2.5 text-sm" aria-live="polite">{tour.steps[step].text}</p>
        <div className="flex justify-end gap-2 px-3.5 pb-3">
          <Button variant="secondary" className="app-btn--sm" onClick={() => onStep(step - 1)} disabled={step === 0}>Voltar</Button>
          <Button className="app-btn--sm" onClick={() => (last ? onClose() : onStep(step + 1))}>{last ? 'Terminar' : 'Próximo passo'}</Button>
        </div>
      </section>
    </div>
  )
}

/** Como ler o mapa: as ligações e as marcas dos cartões. */
export function AlertMapLegend() {
  return (
    <Block title="Como ler o mapa" headingLevel={3}>
      <div className="grid gap-3">
        <p>Cada cartão é um alerta, no momento em que ele abre. Clique para ver de onde vem, o que provoca e o que fica parado.</p>
        <ul className="grid gap-1.5" aria-label="Ligações">
          {(Object.keys(ALERT_LINK_KINDS) as AlertLinkKind[]).map((kind) => (
            <li key={kind} className="flex items-center gap-2"><AlertLinkSample kind={kind} />{ALERT_LINK_KINDS[kind].label}</li>
          ))}
        </ul>
        <p className="text-[var(--app-muted)]">Vira, segura e atrapalha são o que acontece se ninguém agir. Depois é o caminho normal.</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="danger">Crítico</Badge>
          <Badge tone="warning">Crítico após 16 h</Badge>
          <Badge tone="neutral">Doc</Badge>
          <Badge tone="info">{ALERT_DEV_ROUTING_LABELS.only.tag}</Badge>
          <Badge tone="neutral">Aviso do sino</Badge>
        </div>
        <p className="text-[var(--app-muted)]">Gravidade, reforço, quem recebe, a conta Dev e os avisos que não são alertas. O número abaixo do nome é quantos estão na sua fila agora.</p>
      </div>
    </Block>
  )
}

/** Barra do "E se ninguém agir?", presa embaixo da tela enquanto o mapa mostra a cascata. */
export function InactionWalkBar({ walk, step, labelOf, onStep, onClose }: {
  walk: InactionWalk
  step: number
  labelOf: LabelOf
  onStep: (step: number) => void
  onClose: () => void
}) {
  const total = walk.steps.length + 1
  const last = step >= walk.steps.length
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
      <section aria-label="E se ninguém agir?" className="w-full max-w-[760px] overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-navy)] bg-[var(--app-surface)] shadow-[0_16px_40px_var(--app-border-focus)]">
        <header className="flex items-center gap-3 border-b border-[var(--app-border-soft)] bg-[var(--app-strip)] px-3 py-2 text-[var(--app-strip-text)]">
          <h2 className="text-sm font-bold">E se ninguém agir?</h2>
          <span className="text-xs">Passo {step + 1} de {total}</span>
          <Button variant="ghost" className="app-btn--sm ml-auto" onClick={onClose}>Encerrar</Button>
        </header>
        <div className="grid max-h-[34vh] gap-1.5 overflow-y-auto px-3.5 py-2.5 text-sm" aria-live="polite">
          {step === 0 ? (
            <p><b>{labelOf(walk.start)}</b> fica sem ninguém agir.{walk.steps.length === 1 ? ' Não vira nem segura outro alerta: o próximo passo mostra o que fica parado.' : ''}</p>
          ) : !last ? (
            <ul className="grid list-disc gap-1 pl-4">
              {walk.stepLinks[step].map((item) => (
                <li key={`${item.from}>${item.to}`}><b>{labelOf(item.from)}</b> {ALERT_LINK_KINDS[item.kind].short} <b>{labelOf(item.to)}</b>. {item.text}</li>
              ))}
            </ul>
          ) : (
            <p>
              <b>No fim, fica parado: </b>
              {walk.stakes.length ? walk.stakes.map(stakeLabel).join(', ') : 'nada do Cliente nem do caixa'}.
              {' '}Os cartões numerados no mapa mostram a ordem.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-3.5 pb-3">
          <Button variant="secondary" className="app-btn--sm" onClick={() => onStep(step - 1)} disabled={step === 0}>Voltar</Button>
          <Button className="app-btn--sm" onClick={() => onStep(last ? 0 : step + 1)}>{last ? 'Recomeçar' : 'Próximo passo'}</Button>
        </div>
      </section>
    </div>
  )
}
