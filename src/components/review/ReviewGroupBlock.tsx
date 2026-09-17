import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { InlineCustomerPicker, InlineFieldEditor } from '../shared/ReviewInlineEditors'
import type { ReviewQueueItem } from '../../hooks/useReview'
import { formatCnpjCpf } from '../../lib/utils'
import { formatResultCount } from '../../lib/operationalState'
import {
  getGroupLinkedItem,
  getReviewCargoTypeLabel,
  groupNeedsEmail,
  needsCustomerLink,
  needsWeightFix,
  reviewReasonLabel,
  type ReviewGroup,
} from '../../pages/revisaoHelpers'
import { ReviewCustomerOnboarding, type ReviewCustomerOnboardingInput } from './ReviewCustomerOnboarding'
import { ReviewDocumentEvidence } from './ReviewDocumentEvidence'

const customerLevelReasons = new Set([
  'Cliente nao vinculado',
  'Cliente sem e-mail cadastrado',
  'Acesso ao portal nao provisionado',
])

export function ReviewGroupBlock({
  group,
  collapsed,
  savingGroup,
  savingInlineId,
  onToggle,
  onGroupLink,
  onGroupAddEmail,
  onGroupOnboard,
  onCorrect,
  onInlineField,
}: {
  group: ReviewGroup
  collapsed: boolean
  savingGroup: boolean
  savingInlineId: string | null
  onToggle: () => void
  onGroupLink: (customerId: number) => void
  onGroupAddEmail: (email: string) => void
  onGroupOnboard: (input: ReviewCustomerOnboardingInput) => void
  onCorrect: (id: string) => void
  onInlineField: (item: ReviewQueueItem, field: 'ce_mercante' | 'bb_weight_ton', value: string) => void
}) {
  const [emailDraft, setEmailDraft] = useState('')
  const unlinkedCount = group.items.filter(needsCustomerLink).length
  const hasLinkedCustomer = getGroupLinkedItem(group) != null
  const needsEmail = groupNeedsEmail(group)
  const blItems = group.items.filter((item) => item.source === 'bl')
  const linked = getGroupLinkedItem(group)
  const allItemsAreBls = group.items.every((item) => item.source === 'bl')
  const showConflictOnboarding = group.identityKind === 'conflict' && group.items.length === 1 && unlinkedCount > 0
  // Mixed-source groups keep one customer-oriented action. The explicit
  // exception prevents the source check from becoming an accidental gate.
  const showMixedSourceOnboarding = group.items.some((item) => item.source === 'granite') && blItems.length > 0 && group.identityKind !== 'conflict' && (unlinkedCount > 0 || needsEmail)
  const showOnboarding = (allItemsAreBls && (group.canBulkOnboard || group.identityKind === 'name') && (unlinkedCount > 0 || needsEmail)) || showConflictOnboarding || showMixedSourceOnboarding
  const groupReasons = useMemo(() => {
    const reasons = new Set<string>()
    for (const item of group.items) {
      for (const reason of item.review_reasons ?? []) {
        if (!customerLevelReasons.has(reason)) reasons.add(reason)
      }
    }
    return [...reasons]
  }, [group.items])

  return (
    <div>
      <div className="review-group__header">
        <button
          type="button"
          onClick={onToggle}
          className="review-group__toggle"
          aria-expanded={!collapsed}
        >
          <ChevronDown
            size={16}
            className={`review-group__chevron ${collapsed ? '-rotate-90' : ''}`}
          />
          <span className="review-group__name">{group.displayName}</span>
        </button>
        <div className="review-group__identity">
          {group.cnpj ? <span className="review-group__cnpj">{formatCnpjCpf(group.cnpj)}</span> : null}
          {group.identityKind === 'conflict' ? (
            <>
              <Badge tone="yellow">Cadastro de cliente pendente</Badge>
              <Badge tone="red">CNPJs divergentes</Badge>
            </>
          ) : null}
          {group.identityKind === 'name' ? <Badge tone="yellow">Cadastro de cliente pendente</Badge> : null}
          {hasLinkedCustomer && unlinkedCount === 0 ? <Badge tone="blue">Cliente vinculado</Badge> : null}
          {hasLinkedCustomer && needsEmail ? <Badge tone="yellow">E-mail pendente</Badge> : null}
        </div>
        <Badge tone="slate">{formatResultCount(group.items.length, 'B/L', 'B/Ls')}</Badge>
        {groupReasons.length > 0 ? <span className="review-group__issue-count">{formatResultCount(groupReasons.length, 'pendência operacional', 'pendências operacionais')}</span> : null}
        <div className="review-group__actions">
          {unlinkedCount > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--app-muted)]">Vincular cliente existente a {unlinkedCount}:</span>
              <InlineCustomerPicker saving={savingGroup} onSelect={onGroupLink} />
            </div>
          ) : null}
          {hasLinkedCustomer && needsEmail && blItems.length === 0 ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={emailDraft}
                onChange={(event) => setEmailDraft(event.target.value)}
                placeholder="E-mail de faturamento"
                className="w-52 py-1 text-xs"
                disabled={savingGroup}
              />
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                loading={savingGroup}
                onClick={() => onGroupAddEmail(emailDraft)}
              >
                Salvar e-mail
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        <div className="review-group__body">
          {group.identityKind === 'conflict' || (group.identityKind === 'name' && blItems.length > 0) ? <ReviewDocumentEvidence group={group} /> : null}
          {groupReasons.length > 0 ? (
            <div className="review-group__reason-strip">
              <span>Pendências específicas do B/L</span>
              <div className="flex flex-wrap gap-1.5">
                {groupReasons.map((reason) => <Badge key={reason} tone="yellow">{reviewReasonLabel(reason)}</Badge>)}
              </div>
            </div>
          ) : null}
          {showOnboarding ? (
            <ReviewCustomerOnboarding
              group={showMixedSourceOnboarding ? { ...group, items: blItems, canBulkOnboard: true } : group}
              existingCustomerId={linked?.customer?.id ?? null}
              existingCustomer={linked?.customer ?? null}
              initialName={linked?.customer?.name ?? group.displayName}
              initialCnpj={linked?.customer?.cnpj_cpf ?? group.cnpj ?? ''}
              initialEmail={linked?.customer?.customer_contacts?.find((contact) => contact.email?.trim())?.email ?? blItems.find((item) => item.manifest_customer_email)?.manifest_customer_email ?? ''}
              saving={savingGroup}
              onSelectExistingCustomer={() => undefined}
              onSubmit={onGroupOnboard}
            />
          ) : null}
          <div className="app-table-scroll review-group__table-scroll">
          <table className="app-table app-table--compact review-group__table min-w-[760px] text-left text-sm">
            <tbody className="divide-y">
              {group.items.map((item) => (
                <tr key={item.id} className="hover:bg-[var(--app-surface-hover)]">
                  <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">
                    <div className="flex items-center gap-2">
                      {item.source === 'granite' ? <Badge tone="blue">Granito</Badge> : null}
                      {item.source === 'granite' ? item.bl_number : item.id}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="app-table__cell-stack">
                      <div className="flex flex-wrap gap-2">
                        {(item.review_reasons?.filter((reason) => !showOnboarding || !customerLevelReasons.has(reason)).length
                          ? item.review_reasons.filter((reason) => !showOnboarding || !customerLevelReasons.has(reason))
                          : showOnboarding ? [] : ['Pendente de revisão']
                        ).map((reason) => (
                          <Badge key={reason} tone="yellow">
                            {reviewReasonLabel(reason)}
                          </Badge>
                        ))}
                        {showOnboarding && item.review_reasons?.some((reason) => customerLevelReasons.has(reason)) ? (
                          <Badge tone="slate">{getReviewCargoTypeLabel(item)}</Badge>
                        ) : null}
                      </div>
                      {item.source === 'granite' && item.suggested_customer?.name ? (
                        <div className="text-xs text-[var(--app-gold-strong)]">
                          Sugerido: <strong>{item.suggested_customer.name}</strong> — confirme em Corrigir Dados
                        </div>
                      ) : null}
                      {item.source === 'bl' && needsWeightFix(item) ? (
                        <div className="grid max-w-xs gap-1">
                          <span className="text-xs font-medium text-[var(--app-muted)]">
                            Informar peso BB para liberar cálculo
                          </span>
                          <InlineFieldEditor
                            type="number"
                            placeholder="Peso BB (ton)"
                            initial={item.bb_weight_ton != null ? String(item.bb_weight_ton) : ''}
                            saving={savingInlineId === item.id}
                            onSave={(value) => onInlineField(item, 'bb_weight_ton', value)}
                          />
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--app-muted)]">
                    {item.voyage?.vessel?.name ?? '-'} / {item.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="secondary" className="review-group__correct-button" onClick={() => onCorrect(item.id)}>
                        Corrigir Dados
                      </Button>
                      {item.source === 'bl' ? (
                        <Link className="app-table__action" to={`/bls/${item.id}`}>
                          Abrir B/L
                        </Link>
                      ) : (
                        <Link className="app-table__action" to={`/granito`}>
                          Abrir Granito
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
