import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { InlineCustomerPicker, InlineFieldEditor } from '../shared/ReviewInlineEditors'
import type { ReviewCustomer, ReviewQueueItem } from '../../hooks/useReview'
import { formatCnpjCpf } from '../../lib/utils'
import {
  getGroupLinkedItem,
  getReviewCargoTypeLabel,
  getReviewItemCauses,
  groupNeedsEmail,
  needsCustomerLink,
  needsWeightFix,
  REVIEW_CAUSE_LABELS,
  REVIEW_CAUSE_ORDER,
  reviewReasonLabel,
  type ReviewGroup,
  type ReviewGroupSummary,
  validateWeightTon,
} from '../../pages/revisaoHelpers'
import { ReviewCustomerOnboarding, type ReviewCustomerOnboardingInput } from './ReviewCustomerOnboarding'
import { ReviewDocumentEvidence } from './ReviewDocumentEvidence'

// Motivos resolvidos no nível do cliente (seção do grupo), não na linha; a
// linha os cita como "no grupo" a partir da causa.
const customerLevelReasons = new Set([
  'Cliente nao vinculado',
  'Acesso ao portal nao provisionado',
])

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function ReviewGroupBlock({
  group,
  summary,
  collapsed,
  savingGroup,
  savingInlineId,
  onToggle,
  onGroupLink,
  onGroupOnboard,
  onCorrect,
  onInlineField,
}: {
  group: ReviewGroup
  summary: ReviewGroupSummary
  collapsed: boolean
  savingGroup: boolean
  savingInlineId: string | null
  onToggle: () => void
  onGroupLink: (customer: ReviewCustomer) => void
  onGroupOnboard: (input: ReviewCustomerOnboardingInput) => void
  onCorrect: (id: string) => void
  onInlineField: (item: ReviewQueueItem, field: 'ce_mercante' | 'bb_weight_ton', value: string) => void
}) {
  const bodyId = useId()
  const [proposedCnpj, setProposedCnpj] = useState<{ cnpj: string; seq: number } | null>(null)
  // CNPJ válido que está no formulário agora, digitado ou escolhido.
  const [formCnpj, setFormCnpj] = useState<string | null>(null)
  const [quickLinkOpen, setQuickLinkOpen] = useState(false)
  const unlinkedCount = group.items.filter(needsCustomerLink).length
  const needsEmail = groupNeedsEmail(group)
  const blItems = group.items.filter((item) => item.source === 'bl')
  const linked = getGroupLinkedItem(group)
  const allItemsAreBls = group.items.every((item) => item.source === 'bl')
  const showConflictOnboarding = group.identityKind === 'conflict' && group.items.length === 1 && unlinkedCount > 0
  // Mixed-source groups keep one customer-oriented action. The explicit
  // exception prevents the source check from becoming an accidental gate.
  const showMixedSourceOnboarding = group.items.some((item) => item.source === 'granite') && blItems.length > 0 && group.identityKind !== 'conflict' && (unlinkedCount > 0 || needsEmail)
  const showOnboarding = (allItemsAreBls && (group.canBulkOnboard || group.identityKind === 'name') && (unlinkedCount > 0 || needsEmail)) || showConflictOnboarding || showMixedSourceOnboarding
  const showEvidence = blItems.some(needsCustomerLink)
  // Granito sem B/L não passa pelo cadastro transacional: o vínculo direto é o
  // caminho. Com um registro só, o botão da linha (com a sugestão) basta.
  const graniteOnlyLink = blItems.length === 0 && unlinkedCount > 1
  const quickLinkAvailable = showOnboarding && unlinkedCount > 0
  const expectedCnpjs = group.candidateCnpjs.length ? group.candidateCnpjs : group.cnpj ? [group.cnpj] : []
  const onboardingWeightCount = blItems.filter(needsWeightFix).length
  const remainingNote = onboardingWeightCount > 0
    ? `${plural(onboardingWeightCount, 'B/L continuará', 'B/Ls continuarão')} sem o peso da carga solta; informe na lista abaixo.`
    : null
  const { nextAction } = summary
  const causes = REVIEW_CAUSE_ORDER.filter((cause) => summary.causeCounts[cause] > 0)

  return (
    <article className="review-group" data-review-group={group.key}>
      <h2 className="review-group__heading">
        <button type="button" onClick={onToggle} className="review-group__toggle" aria-expanded={!collapsed} aria-controls={collapsed ? undefined : bodyId}>
          <ChevronDown size={16} aria-hidden="true" className={`review-group__chevron ${collapsed ? '-rotate-90' : ''}`} />
          <span className="review-group__identity">
            <span className="review-group__name">{group.displayName}</span>
            <span className="review-group__meta">
              {group.identityKind === 'conflict' ? <Badge tone="danger">CNPJs divergentes</Badge> : null}
              {group.cnpj ? <span className="review-code">{formatCnpjCpf(group.cnpj)}</span> : null}
              {group.cnpj ? <span aria-hidden="true">·</span> : null}
              <span>
                {summary.blCount > 0 ? plural(summary.blCount, 'B/L sem faturamento', 'B/Ls sem faturamento') : null}
                {summary.blCount > 0 && summary.graniteCount > 0 ? ' · ' : null}
                {summary.graniteCount > 0 ? plural(summary.graniteCount, 'registro de Granito', 'registros de Granito') : null}
              </span>
            </span>
          </span>
          <span className="review-group__next">
            <span className="review-group__next-label">Próxima ação</span>
            <span className="review-group__next-title">{nextAction.title}</span>
          </span>
          <span className="review-group__causes">
            {causes.map((cause) => (
              <span key={cause} className={`review-cause review-cause--${cause}`}>
                {REVIEW_CAUSE_LABELS[cause]}{summary.causeCounts[cause] > 1 ? ` (${summary.causeCounts[cause]})` : ''}
              </span>
            ))}
          </span>
        </button>
      </h2>

      {!collapsed ? (
        <div id={bodyId} className="review-group__body">
          <div className={`review-next review-next--${nextAction.kind}`}>
            <p className="review-next__detail">{nextAction.detail}</p>
            {nextAction.kind === 'portal' && summary.linkedCustomer ? (
              <div className="review-next__links">
                <Link className="review-link" to={`/clientes/portal?cliente=${summary.linkedCustomer.id}`}>
                  Abrir no Provisionamento do Portal <ArrowRight size={14} aria-hidden="true" />
                </Link>
                <Link className="review-link" to={`/clientes/${encodeURIComponent(summary.linkedCustomer.cnpj_cpf)}?tab=financeiro`}>
                  Liberação na ficha do Cliente <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            ) : linked?.customer && nextAction.kind !== 'portal' ? (
              <div className="review-next__links">
                <Link className="review-link" to={`/clientes/${encodeURIComponent(linked.customer.cnpj_cpf)}`}>
                  Ficha de {linked.customer.name} <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            ) : nextAction.kind === 'granite' ? (
              <div className="review-next__links">
                <Link className="review-link" to="/granito">Abrir Granito <ArrowRight size={14} aria-hidden="true" /></Link>
              </div>
            ) : null}
          </div>

          {showOnboarding || graniteOnlyLink ? (
            <div className={showEvidence && showOnboarding ? 'review-customer review-customer--split' : 'review-customer'}>
              {showEvidence && showOnboarding ? (
                <ReviewDocumentEvidence
                  group={group}
                  selectedCnpj={formCnpj}
                  onUseCnpj={(cnpj) => setProposedCnpj((current) => ({ cnpj, seq: (current?.seq ?? 0) + 1 }))}
                />
              ) : null}
              {showOnboarding ? (
                <div className="review-customer__form">
                  <ReviewCustomerOnboarding
                    group={showMixedSourceOnboarding ? { ...group, items: blItems, canBulkOnboard: true } : group}
                    existingCustomerId={linked?.customer?.id ?? null}
                    existingCustomer={linked?.customer ?? null}
                    initialName={linked?.customer?.name ?? group.displayName}
                    initialCnpj={linked?.customer?.cnpj_cpf ?? group.cnpj ?? ''}
                    initialEmail={linked?.customer?.customer_contacts?.find((contact) => contact.email?.trim())?.email ?? blItems.find((item) => item.manifest_customer_email)?.manifest_customer_email ?? ''}
                    saving={savingGroup}
                    proposedCnpj={proposedCnpj}
                    remainingNote={remainingNote}
                    onCnpjChange={setFormCnpj}
                    onSelectExistingCustomer={() => undefined}
                    onSubmit={onGroupOnboard}
                  />
                  {quickLinkAvailable ? (
                    <div className="review-quick-link">
                      <button
                        type="button"
                        className="review-link-button"
                        aria-expanded={quickLinkOpen}
                        onClick={() => setQuickLinkOpen((open) => !open)}
                      >
                        {quickLinkOpen ? 'Fechar o vínculo direto' : 'Vincular cliente cadastrado sem informar e-mail'}
                      </button>
                      {quickLinkOpen ? (
                        <div className="review-quick-link__body">
                          <p className="review-quick-link__hint">
                            Vincula {plural(unlinkedCount, 'registro', 'registros')} sem cliente e não mexe nos contatos. Você confirma antes de gravar.
                          </p>
                          <InlineCustomerPicker
                            label={`Cliente cadastrado para ${plural(unlinkedCount, 'registro sem cliente', 'registros sem cliente')}`}
                            saving={savingGroup}
                            expectedCnpjs={expectedCnpjs}
                            onSelect={onGroupLink}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="review-customer__form">
                  <h3 className="review-section-title">Vincular cliente aos {unlinkedCount} registros</h3>
                  <InlineCustomerPicker
                    label="Buscar cliente cadastrado"
                    saving={savingGroup}
                    expectedCnpjs={expectedCnpjs}
                    onSelect={onGroupLink}
                  />
                </div>
              )}
            </div>
          ) : null}

          <div className="review-items">
            <table className="app-table review-items__table">
              <caption className="sr-only">Registros de {group.displayName} em revisão</caption>
              <thead>
                <tr>
                  <th scope="col">B/L</th>
                  <th scope="col">Pendências</th>
                  <th scope="col">Navio / viagem</th>
                  <th scope="col"><span className="sr-only">Ação</span></th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => {
                  const rowReasons = (item.review_reasons ?? []).filter((reason) => !/^sugerido:/i.test(reason) && !customerLevelReasons.has(reason))
                  const causes = getReviewItemCauses(item)
                  const handledByGroup = causes.filter((cause) => cause === 'cliente' || cause === 'portal')
                  const label = item.source === 'granite' ? item.bl_number : item.id
                  return (
                    <tr key={item.id}>
                      <td data-label="B/L">
                        {item.source === 'bl' ? (
                          <Link className="review-items__id" to={`/bls/${encodeURIComponent(item.id)}`}>{item.id}</Link>
                        ) : (
                          <span className="review-items__id">{item.bl_number}</span>
                        )}
                        <span className="review-items__sub">{item.source === 'granite' ? 'Granito' : getReviewCargoTypeLabel(item)}</span>
                      </td>
                      <td data-label="Pendências">
                        <ul className="review-items__reasons">
                          {handledByGroup.map((cause) => (
                            <li key={cause} className="review-items__reason review-items__reason--group">
                              {REVIEW_CAUSE_LABELS[cause]} <span className="review-items__where">— no grupo</span>
                            </li>
                          ))}
                          {rowReasons.filter((reason) => !(item.source === 'granite' && /\(granito\)/i.test(reason))).map((reason) => (
                            <li key={reason} className="review-items__reason">{reviewReasonLabel(reason)}</li>
                          ))}
                          {item.source === 'granite' && needsCustomerLink(item) ? (
                            <li className="review-items__reason">Granito sem cliente vinculado</li>
                          ) : null}
                          {item.source === 'bl' && needsWeightFix(item) && !rowReasons.some((reason) => /peso bb|weight ton/i.test(reason)) ? (
                            <li className="review-items__reason">Peso da carga solta ausente</li>
                          ) : null}
                          {causes.length === 1 && causes[0] === 'outros' && !rowReasons.length ? (
                            <li className="review-items__reason">Pendente de revisão, sem motivo registrado</li>
                          ) : null}
                        </ul>
                        {item.source === 'granite' && item.suggested_customer?.name ? (
                          <p className="review-items__suggestion">
                            Sugestão por nome: <strong>{item.suggested_customer.name}</strong> ({formatCnpjCpf(item.suggested_customer.cnpj_cpf)}). Confirme o CNPJ antes de vincular.
                          </p>
                        ) : null}
                        {item.source === 'bl' && needsWeightFix(item) ? (
                          <InlineFieldEditor
                            key={`${item.id}:${item.updated_at ?? ''}`}
                            type="number"
                            label={`Peso da carga solta do B/L ${item.id}, em toneladas`}
                            placeholder="Peso (t)"
                            initial={item.bb_weight_ton != null ? String(item.bb_weight_ton) : ''}
                            saving={savingInlineId === item.id}
                            validate={validateWeightTon}
                            onSave={(value) => onInlineField(item, 'bb_weight_ton', value)}
                          />
                        ) : null}
                      </td>
                      <td data-label="Navio / viagem" className="review-items__voyage">
                        {item.voyage?.vessel?.name || item.voyage?.voyage_number
                          ? `${item.voyage?.vessel?.name ?? '—'} / ${item.voyage?.voyage_number ?? '—'}`
                          : <span aria-label="Sem viagem informada">—</span>}
                      </td>
                      <td className="review-items__action">
                        <Button
                          variant="secondary"
                          className="app-btn--sm"
                          aria-label={`${item.source === 'granite' ? 'Vincular cliente' : 'Corrigir dados'} de ${label}`}
                          onClick={() => onCorrect(item.id)}
                        >
                          {item.source === 'granite' ? 'Vincular cliente' : 'Corrigir dados'}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </article>
  )
}
