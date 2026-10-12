// Regras de formulário de Demurrage (etapa 11): validação de formato e ordem
// antes da gravação, com a mensagem que aparece junto do campo. Não decidem
// cálculo nem permissão; o banco continua dono das duas coisas.
import { demurrageDatesSchema } from '../../services/financialValidation'
import { formatDate, formatUSD } from '../../lib/utils'
import type { DemurrageRate } from '../../types/database'
import type { DemurrageRateUpsertInput } from '../../services/demurrage/demurrageRateUpsertPayload'
import type { DemurrageContainerRow } from '../../services/demurrage/demurrageContainers'
import type { CustomerDemurrageAgreementListItem } from '../../types/customerDemurrageAgreements'

/** Quem responde e reabre: Equipamentos (dono) e Administrativo (cobertura, migration 081). */
export function canAnswerDemurrageDispute(role: string | null | undefined) {
  return role === 'equipamentos' || role === 'administrativo'
}


export function parsePtaxInput(value: string): number | null {
  const ptax = Number(value.trim().replace(',', '.'))
  return Number.isFinite(ptax) && ptax > 0 ? ptax : null
}


export type AgreementErrors = Partial<Record<'customer' | 'freeDays' | 'p1' | 'p2' | 'validFrom' | 'validTo' | 'form', string>>

function parseMoney(value: string) {
  const text = value.trim()
  if (!text) return { value: null as number | null, valid: true }
  const number = Number(text.replace(',', '.'))
  return { value: number, valid: Number.isFinite(number) && number >= 0 }
}

/** Confere o formulário do acordo; devolve os erros por campo. */
export function validateAgreementDraft(draft: { customerId: number | null; freeDays: string; p1: string; p2: string; validFrom: string; validTo: string }) {
  const errors: AgreementErrors = {}
  const free = Number(draft.freeDays.trim())
  const p1 = parseMoney(draft.p1)
  const p2 = parseMoney(draft.p2)
  if (!draft.customerId) errors.customer = 'Escolha o Cliente na lista.'
  if (draft.freeDays.trim() === '' || !Number.isInteger(free) || free < 0) errors.freeDays = 'Informe os dias de free time (número inteiro, 0 ou mais).'
  if (!p1.valid) errors.p1 = 'Informe um valor em USD, 0 ou mais, ou deixe em branco.'
  if (!p2.valid) errors.p2 = 'Informe um valor em USD, 0 ou mais, ou deixe em branco.'
  if (!draft.validFrom) errors.validFrom = 'Informe o início da vigência.'
  if (draft.validTo && draft.validFrom && draft.validTo < draft.validFrom) errors.validTo = 'O fim da vigência não pode ser antes do início.'
  return { errors, free, p1: p1.value, p2: p2.value }
}


export type ContainerDatesInput = { discharge: string; ret: string | null; reason: string | null }

export type ContainerDatesErrors = Partial<Record<'discharge' | 'ret' | 'reason', string>>

/** Valida descarga, ordem das datas e o motivo exigido para remover a devolução gravada. */
export function validateContainerDates(
  container: Pick<DemurrageContainerRow, 'return_date'>,
  values: { discharge: string; ret: string; reason: string },
): { errors: ContainerDatesErrors; input: ContainerDatesInput | null } {
  if (!values.discharge) return { errors: { discharge: 'Informe a data de descarga.' }, input: null }
  const validation = demurrageDatesSchema.safeParse({ discharge: values.discharge, ret: values.ret })
  if (!validation.success) {
    const issue = validation.error.issues[0]
    return issue?.path[0] === 'ret'
      ? { errors: { ret: 'A devolução não pode ser anterior à descarga.' }, input: null }
      : { errors: { discharge: 'Data de descarga inválida.' }, input: null }
  }
  const removing = Boolean(container.return_date) && !validation.data.ret
  if (removing && !values.reason.trim()) {
    return { errors: { reason: 'Informe o motivo para remover a data de devolução.' }, input: null }
  }
  return {
    errors: {},
    input: { discharge: validation.data.discharge, ret: validation.data.ret, reason: removing ? values.reason.trim() : null },
  }
}


export type RateDraft = {
  container_type: string
  free_days: string
  p1_day_from: string
  p1_day_to: string
  p1_usd: string
  p2_day_from: string
  p2_usd: string
  valid_from: string
  valid_to: string
  notes: string
}

export type RateErrors = Partial<Record<keyof RateDraft, string>>

export const NEW_RATE: RateDraft = {
  container_type: '',
  free_days: '21',
  p1_day_from: '22',
  p1_day_to: '30',
  p1_usd: '',
  p2_day_from: '31',
  p2_usd: '',
  valid_from: '',
  valid_to: '',
  notes: '',
}

export function toDraftFromRate(rate: DemurrageRate | null): RateDraft {
  if (!rate) return NEW_RATE
  return {
    container_type: rate.container_type,
    free_days: String(rate.free_days),
    p1_day_from: String(rate.p1_day_from),
    p1_day_to: String(rate.p1_day_to),
    p1_usd: String(rate.p1_usd ?? ''),
    p2_day_from: String(rate.p2_day_from),
    p2_usd: String(rate.p2_usd ?? ''),
    valid_from: rate.valid_from?.slice(0, 10) ?? '',
    valid_to: rate.valid_to?.slice(0, 10) ?? '',
    notes: rate.notes ?? '',
  }
}

function wholeNumber(value: string) {
  const number = Number(value.trim())
  return value.trim() !== '' && Number.isInteger(number) && number >= 0 ? number : null
}

function money(value: string) {
  const number = Number(value.trim().replace(',', '.'))
  return value.trim() !== '' && Number.isFinite(number) && number >= 0 ? number : null
}

/**
 * Confere o formulário da tarifa padrão. Só regras de formato e ordem que o
 * cálculo pressupõe (faixa P1 com início e fim, vigência em ordem); o banco
 * continua dono do resto.
 */
export function validateRateDraft(draft: RateDraft): { errors: RateErrors; input: Omit<DemurrageRateUpsertInput, 'id' | 'active'> | null } {
  const errors: RateErrors = {}
  const freeDays = wholeNumber(draft.free_days)
  const p1From = wholeNumber(draft.p1_day_from)
  const p1To = wholeNumber(draft.p1_day_to)
  const p2From = wholeNumber(draft.p2_day_from)
  const p1Usd = money(draft.p1_usd)
  const p2Usd = money(draft.p2_usd)
  if (!draft.container_type.trim()) errors.container_type = 'Informe o tipo de container.'
  if (freeDays == null) errors.free_days = 'Informe os dias de free time (número inteiro).'
  if (p1From == null) errors.p1_day_from = 'Informe o dia de início de P1.'
  if (p1To == null) errors.p1_day_to = 'Informe o dia de fim de P1.'
  else if (p1From != null && p1To < p1From) errors.p1_day_to = 'O fim de P1 não pode ser antes do início.'
  if (p2From == null) errors.p2_day_from = 'Informe o dia de início de P2.'
  if (p1Usd == null) errors.p1_usd = 'Informe a diária de P1 em USD.'
  if (p2Usd == null) errors.p2_usd = 'Informe a diária de P2 em USD.'
  if (draft.valid_to && draft.valid_from && draft.valid_to < draft.valid_from) errors.valid_to = 'O fim da vigência não pode ser antes do início.'
  if (Object.keys(errors).length) return { errors, input: null }
  return {
    errors,
    input: {
      container_type: draft.container_type.trim().toUpperCase(),
      free_days: freeDays!,
      p1_day_from: p1From!,
      p1_day_to: p1To!,
      p1_usd: p1Usd!,
      p2_day_from: p2From!,
      p2_usd: p2Usd!,
      valid_from: draft.valid_from || null,
      valid_to: draft.valid_to || null,
      notes: draft.notes.trim() || null,
    },
  }
}


/** Diárias do acordo; campo vazio herda a tabela padrão. */
export function agreementRatesText(agreement: Pick<CustomerDemurrageAgreementListItem, 'p1_usd' | 'p2_usd'>) {
  const rate = (value: number | null | undefined) => (value != null ? `${formatUSD(value)}/dia` : 'tabela padrão')
  return `P1 ${rate(agreement.p1_usd)} · P2 ${rate(agreement.p2_usd)}`
}


/** Vigência do acordo em uma frase: "01/01/2026 a 31/12/2026" ou "desde 01/01/2026, sem data final". */
export function agreementPeriodText(agreement: Pick<CustomerDemurrageAgreementListItem, 'valid_from' | 'valid_to'>) {
  return agreement.valid_to
    ? `${formatDate(agreement.valid_from)} a ${formatDate(agreement.valid_to)}`
    : `desde ${formatDate(agreement.valid_from)}, sem data final`
}
