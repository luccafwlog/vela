import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Block, LeadValue } from '../ui/Block'
import { Button } from '../ui/Button'
import { CopyValue } from '../ui/CopyValue'
import { Field, Input } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { InlineCustomerPicker, InlineFieldEditor } from '../shared/ReviewInlineEditors'
import type { ReviewCustomer, ReviewQueueItem } from '../../hooks/useReview'
import { isDeactivatedCustomerSuggestion } from '../../services/customerReconciliation'
import { formatCnpjCpf } from '../../lib/utils'
import {
  getGroupLinkedItem,
  getReviewCargoTypeLabel,
  getReviewItemCauses,
  needsCustomerLink,
  needsWeightFix,
  describeCnpjSource,
  REVIEW_CAUSE_LABELS,
  type ReviewGroup,
  type ReviewGroupSummary,
  validateWeightTon,
} from '../../pages/revisaoHelpers'
import { ReviewBlCheckForm, type ReviewBlCheckValues } from './ReviewBlCheckForm'
import { ReviewCustomerForm, type ReviewCustomerOnboardingInput } from './ReviewCustomerForm'
import { ReviewCnpjCandidates, ReviewRawLines } from './ReviewEvidence'
import { ReviewPortalBlock } from './ReviewPortalBlock'

type BlItem = Extract<ReviewQueueItem, { source: 'bl' }>

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function itemLabel(item: ReviewQueueItem) {
  return item.source === 'granite' ? item.bl_number : item.id
}

function voyageText(item: ReviewQueueItem) {
  const vessel = item.voyage?.vessel?.name
  const voyage = item.voyage?.voyage_number
  if (!vessel && !voyage) return null
  return `${vessel ?? '—'} / ${voyage ?? '—'}`
}

function routeText(item: ReviewQueueItem) {
  return item.pol || item.pod ? `${item.pol ?? '—'} → ${item.pod ?? '—'}` : null
}

/** Pendências de um registro em texto, uma vez cada, no vocabulário da fila. */
function pendencyText(item: ReviewQueueItem) {
  return getReviewItemCauses(item)
    .map((cause) => (cause === 'outros' ? 'Conferir os dados' : REVIEW_CAUSE_LABELS[cause]))
    .join(' · ')
}

/** Sugestão de Cliente por nome (B16) ou o Cliente desativado com o CNPJ (B17). */
function Suggestion({ item, onUse }: { item: ReviewQueueItem; onUse?: (customer: ReviewCustomer) => void }) {
  const suggested = item.suggested_customer
  if (!suggested?.name) return null
  if (isDeactivatedCustomerSuggestion(item)) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="app-status-text app-status-text--warning">
          Cliente desativado com este CNPJ: {suggested.name} ({formatCnpjCpf(suggested.cnpj_cpf)}). Reative o cliente ou escolha outro.
        </p>
        <Link className="app-btn app-btn--secondary app-btn--sm" to={`/clientes/${encodeURIComponent(suggested.cnpj_cpf)}`}>Abrir ficha do Cliente</Link>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p>Sugestão por nome: <strong>{suggested.name}</strong> ({formatCnpjCpf(suggested.cnpj_cpf)}). Confira o CNPJ antes de vincular.</p>
      {onUse ? <Button variant="secondary" className="app-btn--sm" onClick={() => onUse(suggested)}>Usar a sugestão</Button> : null}
    </div>
  )
}

/**
 * O que abre embaixo da linha do Cliente na fila da Revisão. Muda conforme a
 * pendência (aprovado em 2026-10-16): um bloco de foco por caso, na ordem da
 * próxima ação, e embaixo os B/Ls do grupo só para conferência.
 */
export function ReviewGroupDetail({
  group,
  summary,
  savingGroup,
  savingInlineId,
  onGroupLink,
  onGroupOnboard,
  onInlineWeight,
  onCheckSave,
}: {
  group: ReviewGroup
  summary: ReviewGroupSummary
  savingGroup: boolean
  savingInlineId: string | null
  onGroupLink: (customer: ReviewCustomer) => void
  onGroupOnboard: (input: ReviewCustomerOnboardingInput) => void
  onInlineWeight: (item: ReviewQueueItem, value: string) => void
  onCheckSave: (item: BlItem, values: ReviewBlCheckValues) => void
}) {
  const [proposedCnpj, setProposedCnpj] = useState<{ cnpj: string; seq: number } | null>(null)
  const [proposedCustomer, setProposedCustomer] = useState<{ customer: ReviewCustomer; seq: number } | null>(null)
  const [formCnpj, setFormCnpj] = useState<string | null>(null)
  const [graniteTarget, setGraniteTarget] = useState<ReviewCustomer | null>(null)
  const [email, setEmail] = useState('')

  const blItems = group.items.filter((item): item is BlItem => item.source === 'bl')
  const graniteItems = group.items.filter((item) => item.source === 'granite')
  const unlinkedBls = blItems.filter(needsCustomerLink)
  const unlinkedGranite = graniteItems.filter(needsCustomerLink)
  const linked = getGroupLinkedItem(group)?.customer ?? null
  const expectedCnpjs = group.candidateCnpjs.length ? group.candidateCnpjs : group.cnpj ? [group.cnpj] : []
  const weightItems = blItems.filter(needsWeightFix)
  const checkItems = blItems.filter((item) => getReviewItemCauses(item).includes('outros'))
  const deactivated = unlinkedBls.find(isDeactivatedCustomerSuggestion) ?? null
  const suggestionItem = unlinkedBls.find((item) => item.suggested_customer?.name) ?? null
  const kind = summary.nextAction.kind

  function useCnpj(cnpj: string) {
    setProposedCnpj((current) => ({ cnpj, seq: (current?.seq ?? 0) + 1 }))
  }
  function useCustomer(customer: ReviewCustomer) {
    setProposedCustomer((current) => ({ customer, seq: (current?.seq ?? 0) + 1 }))
  }

  const customerForm = (
    <ReviewCustomerForm
      blCount={unlinkedBls.length}
      expectedCnpjs={expectedCnpjs}
      initialName={group.displayName}
      initialCnpj={group.cnpj ?? ''}
      initialEmail={blItems.find((item) => item.manifest_customer_email)?.manifest_customer_email ?? ''}
      proposedCnpj={proposedCnpj}
      proposedCustomer={proposedCustomer}
      saving={savingGroup}
      onCnpjChange={setFormCnpj}
      onOnboard={onGroupOnboard}
      onLink={onGroupLink}
    />
  )

  let customerBlock = null
  if (unlinkedBls.length > 0) {
    if (group.identityKind === 'conflict') {
      customerBlock = (
        <Block title="Confirmar o CNPJ do cliente" headingLevel={3} aside={`${group.displayName} · o B/L cita CNPJs diferentes`}>
          <div className="grid gap-4">
            <ReviewCnpjCandidates group={group} selectedCnpj={formCnpj} onUse={useCnpj} />
            <ReviewRawLines items={unlinkedBls} />
            {proposedCnpj ? customerForm : <p className="text-[var(--app-muted)]">Escolha o CNPJ do consignatário para cadastrar ou vincular o cliente.</p>}
          </div>
        </Block>
      )
    } else if (group.identityKind === 'name') {
      customerBlock = (
        <Block title="Identificar o cliente" headingLevel={3} aside={`${group.displayName} · nenhum CNPJ lido no B/L`}>
          <div className="grid gap-4">
            <ReviewRawLines items={unlinkedBls} />
            {suggestionItem ? <Suggestion item={suggestionItem} onUse={useCustomer} /> : null}
            {customerForm}
          </div>
        </Block>
      )
    } else {
      customerBlock = (
        <Block title="Cadastrar o cliente" headingLevel={3} aside={`${group.displayName} · ${plural(unlinkedBls.length, 'B/L', 'B/Ls')}`}>
          <div className="grid gap-4">
            {group.cnpj ? (
              <LeadValue detail={describeCnpjSource(group, group.cnpj)}>
                <CopyValue value={group.cnpj} label="CNPJ">{formatCnpjCpf(group.cnpj)}</CopyValue>
              </LeadValue>
            ) : null}
            {deactivated ? <Suggestion item={deactivated} /> : (
              <>
                {suggestionItem ? <Suggestion item={suggestionItem} onUse={useCustomer} /> : null}
                {customerForm}
              </>
            )}
          </div>
        </Block>
      )
    }
  } else if (kind === 'email' && linked) {
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    customerBlock = (
      <Block title="Completar o e-mail do cliente" headingLevel={3} aside={linked.name}>
        <div className="grid gap-3">
          <p className="text-[var(--app-muted)]">{summary.nextAction.detail}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <Field label="E-mail principal">
                <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="financeiro@cliente.com.br" />
              </Field>
            </div>
            <Button
              disabled={!validEmail}
              loading={savingGroup}
              loadingLabel="Salvando…"
              onClick={() => onGroupOnboard({ customerId: linked.id, cnpjCpf: linked.cnpj_cpf, name: linked.name, email: email.trim().toLowerCase(), sendPortalInvite: false })}
            >
              Adicionar e-mail
            </Button>
          </div>
        </div>
      </Block>
    )
  } else if (unlinkedGranite.length > 0) {
    customerBlock = (
      <Block title="Vincular o cliente ao Granito" headingLevel={3} aside="Granito não gera fatura: o vínculo libera o cálculo de apoio no módulo Granito">
        <div className="grid gap-4">
          <table className="app-table app-table--nested">
            <caption className="sr-only">Registros de Granito sem cliente</caption>
            <thead>
              <tr>
                <th scope="col">Registro</th>
                <th scope="col" className="app-table__text-head">Consignatário no registro</th>
                <th scope="col">Navio / Viagem</th>
              </tr>
            </thead>
            <tbody>
              {unlinkedGranite.map((item) => (
                <tr key={item.id}>
                  <td>{itemLabel(item)}</td>
                  <td className="app-table__text">{item.consignee || item.shipper || <NoValue label="Sem consignatário" />}</td>
                  <td>{voyageText(item) ?? <NoValue label="Sem viagem informada" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {unlinkedGranite.map((item) => <Suggestion key={item.id} item={item} onUse={setGraniteTarget} />)}
          <InlineCustomerPicker label="Cliente cadastrado" saving={savingGroup} expectedCnpjs={expectedCnpjs} onSelect={setGraniteTarget} />
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--app-border-soft)] pt-3">
            <p className="min-w-0 flex-1 text-[var(--app-muted)]">
              {graniteTarget ? <>Vai vincular <strong>{plural(unlinkedGranite.length, 'registro', 'registros')}</strong> a <strong>{graniteTarget.name}</strong>.</> : 'Escolha o cliente cadastrado.'}
            </p>
            <Link className="app-btn app-btn--secondary app-btn--sm" to="/granito">Abrir Granito</Link>
            <Button disabled={!graniteTarget} loading={savingGroup} loadingLabel="Salvando…" onClick={() => graniteTarget && onGroupLink(graniteTarget)}>
              Vincular
            </Button>
          </div>
        </div>
      </Block>
    )
  }

  return (
    <div className="grid gap-3">
      {customerBlock}

      {weightItems.length ? (
        <Block title="Informar o peso da carga solta" headingLevel={3} aside="o cálculo das Taxas Locais depende dele" flush>
          <table className="app-table app-table--nested">
            <caption className="sr-only">B/Ls sem o peso da carga solta</caption>
            <thead>
              <tr>
                <th scope="col">B/L</th>
                <th scope="col" className="app-table__text-head">Descrição da carga</th>
                <th scope="col">Volumes</th>
                <th scope="col">CBM</th>
                <th scope="col">Peso (t)</th>
              </tr>
            </thead>
            <tbody>
              {weightItems.map((item) => (
                <tr key={item.id}>
                  <td><CopyValue value={item.id} label="número do B/L"><Link className="app-link" to={`/bls/${encodeURIComponent(item.id)}`}>{item.id}</Link></CopyValue></td>
                  <td className="app-table__text" title={item.cargo_description ?? undefined}>{item.cargo_description || <NoValue label="Sem descrição" />}</td>
                  <td>{item.bb_packages_qty ?? <NoValue label="Sem volumes" />}</td>
                  <td>{item.bb_cbm ? `${Number(item.bb_cbm).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m³` : <NoValue label="Sem CBM" />}</td>
                  <td>
                    <InlineFieldEditor
                      key={`${item.id}:${item.updated_at ?? ''}`}
                      type="decimal"
                      label={`Peso da carga solta do B/L ${item.id}, em toneladas`}
                      placeholder="0,000"
                      initial={item.bb_weight_ton != null ? String(item.bb_weight_ton) : ''}
                      saving={savingInlineId === item.id}
                      validate={validateWeightTon}
                      onSave={(value) => onInlineWeight(item, value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      ) : null}

      {summary.causeCounts.portal > 0 && linked ? <ReviewPortalBlock customer={linked} blCount={blItems.length} /> : null}

      {checkItems.map((item) => (
        <Block
          key={item.id}
          title="Conferir os dados do B/L"
          headingLevel={3}
          aside={`B/L ${item.id} · ${getReviewCargoTypeLabel(item)}${routeText(item) ? ` · ${routeText(item)}` : ''}`}
        >
          <div className="grid gap-3">
            <p className="text-[var(--app-muted)]">A pendência não tem motivo registrado. Confira os dados e salve: o sistema recalcula e o B/L sai da fila se não sobrar nada.</p>
            <ReviewBlCheckForm key={`${item.id}:${item.updated_at ?? ''}`} item={item} saving={savingInlineId === item.id} onSave={onCheckSave} />
          </div>
        </Block>
      ))}

      <table className="app-table app-table--nested">
        <caption className="sr-only">Registros de {group.displayName} em revisão</caption>
        <thead>
          <tr>
            <th scope="col">B/L</th>
            <th scope="col">Carga</th>
            <th scope="col">Navio / Viagem</th>
            <th scope="col">Trecho</th>
            <th scope="col" className="app-table__text-head">Pendências</th>
          </tr>
        </thead>
        <tbody>
          {group.items.map((item) => (
            <tr key={item.id}>
              <td>
                {item.source === 'bl' ? (
                  <CopyValue value={item.id} label="número do B/L"><Link className="app-link" to={`/bls/${encodeURIComponent(item.id)}`}>{item.id}</Link></CopyValue>
                ) : (
                  <CopyValue value={item.bl_number} label="número do B/L">{item.bl_number}</CopyValue>
                )}
              </td>
              <td>{item.source === 'granite' ? 'Granito' : getReviewCargoTypeLabel(item)}</td>
              <td>{voyageText(item) ?? <NoValue label="Sem viagem informada" />}</td>
              <td>{routeText(item) ?? <NoValue label="Sem trecho" />}</td>
              <td className="app-table__text">{pendencyText(item)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
