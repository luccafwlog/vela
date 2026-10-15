import type { CustomerContact } from '../types/database'
import { getEmailSuppressionReason, type EmailSuppressionRow } from './customerCommunications'
import { supabase } from './supabase'

export const CUSTOMER_COMMUNICATION_BOXES = [
  {
    code: 'documentacao_operacao',
    label: 'Documentação e Operação',
    description: 'CE e Taxas, NOA, NOR e NOB.',
  },
  {
    code: 'financeiro',
    label: 'Financeiro',
    description: 'CE e Taxas e Cobranças de Demurrage.',
  },
  {
    code: 'demurrage',
    label: 'Demurrage',
    description: 'Cobranças de Demurrage e futuros comunicados de Demurrage.',
  },
] as const

export type CommunicationBoxCode = (typeof CUSTOMER_COMMUNICATION_BOXES)[number]['code']

export type CustomerCommunicationAudience =
  | { mode: 'todos' }
  | { mode: 'caixa'; boxCode: CommunicationBoxCode }

/** Linha de `customer_communication_box_kinds`: a caixa recebe o modelo. */
export type CommunicationBoxKind = {
  box_code: string
  kind: string
}

/**
 * O mapa caixa → modelo vem do banco (`customer_communication_box_kinds`), a
 * mesma tabela que a Edge Function consulta antes de enviar (item B18 do plano
 * de correções de 2026-10-14). O navegador não guarda uma cópia.
 */
export async function fetchCommunicationBoxKinds(kind?: string): Promise<CommunicationBoxKind[]> {
  let query = supabase.from('customer_communication_box_kinds').select('box_code, kind')
  if (kind) query = query.eq('kind', kind)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as CommunicationBoxKind[]
}

export type CustomerContactBoxLink = {
  contact_id: number
  box_code: string
}

export type CustomerCommunicationRecipient = CustomerContact & {
  boxCodes: CommunicationBoxCode[]
  matchedBoxCodes: CommunicationBoxCode[]
}

export type CustomerCommunicationExcludedReason =
  | 'contato_desativado'
  | 'email_ausente'
  | 'suprimido_complaint'
  | 'suprimido_bounce'

export type ExcludedCustomerCommunicationRecipient = {
  contact: CustomerContact
  reason: CustomerCommunicationExcludedReason
}

export type ResolvedRecipients = {
  eligible: CustomerCommunicationRecipient[]
  excluded: ExcludedCustomerCommunicationRecipient[]
  blocked: boolean
}

export type ExtendedCustomerContact = Partial<CustomerContact> & {
  id: number
  email?: string | null
  deactivated_at?: string | null
  active?: boolean
  origin?: string
  box_codes?: readonly string[]
}

function toCustomerContact(contact: ExtendedCustomerContact): CustomerContact {
  return {
    id: contact.id,
    customer_id: contact.customer_id ?? null,
    name: contact.name ?? null,
    email: contact.email ?? null,
    email_normalized: contact.email_normalized ?? (contact.email ? normalizeEmail(contact.email) : null),
    phone: contact.phone ?? null,
    is_primary: contact.is_primary ?? null,
    created_at: contact.created_at ?? null,
    purpose: contact.purpose ?? null,
    deactivated_at: contact.deactivated_at ?? null,
    updated_at: contact.updated_at ?? contact.created_at ?? new Date().toISOString(),
    origin: contact.origin ?? 'interno',
  }
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

export function getBoxesForKind(kind: string | undefined, boxKinds: readonly CommunicationBoxKind[]): CommunicationBoxCode[] {
  if (!kind) return []
  return CUSTOMER_COMMUNICATION_BOXES
    .filter((box) => boxKinds.some((row) => row.box_code === box.code && row.kind === kind))
    .map((box) => box.code)
}

export function resolveCustomerCommunicationRecipientsByBoxes(input: {
  contacts: readonly ExtendedCustomerContact[]
  boxLinks?: readonly CustomerContactBoxLink[]
  /** Linhas de `customer_communication_box_kinds`; sem elas, nenhum modelo tem caixa. */
  boxKinds?: readonly CommunicationBoxKind[]
  kind?: string
  audience?: CustomerCommunicationAudience
  portalSuppressions?: readonly EmailSuppressionRow[]
  communicationSuppressions?: readonly EmailSuppressionRow[]
}): ResolvedRecipients {
  const contactBoxesMap = new Map<number, Set<CommunicationBoxCode>>()

  // Mapear vinculos das tabelas se fornecidos
  if (input.boxLinks) {
    for (const link of input.boxLinks) {
      const code = link.box_code as CommunicationBoxCode
      if (CUSTOMER_COMMUNICATION_BOXES.some((b) => b.code === code)) {
        const set = contactBoxesMap.get(link.contact_id) ?? new Set<CommunicationBoxCode>()
        set.add(code)
        contactBoxesMap.set(link.contact_id, set)
      }
    }
  }

  // Mapear vinculos existentes direto no objeto do contato (se vier de snapshot ou RPC)
  for (const contact of input.contacts) {
    if (contact.box_codes && Array.isArray(contact.box_codes)) {
      const set = contactBoxesMap.get(contact.id) ?? new Set<CommunicationBoxCode>()
      for (const code of contact.box_codes) {
        if (CUSTOMER_COMMUNICATION_BOXES.some((b) => b.code === code)) {
          set.add(code as CommunicationBoxCode)
        }
      }
      contactBoxesMap.set(contact.id, set)
    }
  }

  // Determinar caixas alvo do envio
  let targetBoxes: CommunicationBoxCode[] = []
  const isGeneralAudience =
    input.audience?.mode === 'todos' ||
    input.kind === 'institucional'

  if (input.audience && input.audience.mode === 'caixa') {
    targetBoxes = [input.audience.boxCode]
  } else if (!isGeneralAudience && input.kind) {
    targetBoxes = getBoxesForKind(input.kind, input.boxKinds ?? [])
  }

  const eligibleMap = new Map<string, CustomerCommunicationRecipient>()
  const excluded: ExcludedCustomerCommunicationRecipient[] = []

  for (const contact of input.contacts) {
    // 1. Verificar desativacao logica
    const isDeactivated =
      contact.deactivated_at != null || contact.active === false
    if (isDeactivated) {
      excluded.push({ contact: toCustomerContact(contact), reason: 'contato_desativado' })
      continue
    }

    // 2. Verificar presenca e validade do e-mail
    const emailNorm = normalizeEmail(contact.email)
    if (!emailNorm || !emailNorm.includes('@')) {
      excluded.push({ contact: toCustomerContact(contact), reason: 'email_ausente' })
      continue
    }

    // 3. Verificar supressoes de bounce ou complaint
    const suppression = getEmailSuppressionReason(emailNorm, {
      channel: 'comunicados',
      sharedSuppressions: input.portalSuppressions,
      communicationSuppressions: input.communicationSuppressions,
    })

    if (suppression === 'complaint') {
      excluded.push({ contact: toCustomerContact(contact), reason: 'suprimido_complaint' })
      continue
    }
    if (suppression === 'bounce_permanente') {
      excluded.push({ contact: toCustomerContact(contact), reason: 'suprimido_bounce' })
      continue
    }

    // 4. Se nao for audiencia geral, verificar vinculo com as caixas alvo
    const contactBoxes = Array.from(contactBoxesMap.get(contact.id) ?? [])
    const matchedBoxes: CommunicationBoxCode[] = isGeneralAudience
      ? contactBoxes
      : contactBoxes.filter((box) => targetBoxes.includes(box))

    if (!isGeneralAudience && matchedBoxes.length === 0) {
      // Nao alcancado por esta caixa / modelo
      continue
    }

    // 5. Deduplicacao por e-mail normalizado dentro do mesmo cliente
    const existing = eligibleMap.get(emailNorm)
    if (existing) {
      // Mescla matchedBoxes e boxCodes sem duplicar
      for (const b of contactBoxes) {
        if (!existing.boxCodes.includes(b)) existing.boxCodes.push(b)
      }
      for (const b of matchedBoxes) {
        if (!existing.matchedBoxCodes.includes(b)) existing.matchedBoxCodes.push(b)
      }
      if (contact.is_primary && !existing.is_primary) {
        existing.is_primary = true
        existing.id = contact.id
        existing.name = contact.name ?? existing.name
      }
    } else {
      eligibleMap.set(emailNorm, {
        ...toCustomerContact(contact),
        boxCodes: contactBoxes,
        matchedBoxCodes: matchedBoxes,
      })
    }
  }

  const eligible = Array.from(eligibleMap.values()).sort((a, b) => {
    if (a.is_primary && !b.is_primary) return -1
    if (!a.is_primary && b.is_primary) return 1
    return a.id - b.id
  })

  // Bloqueado se nao houver nenhum destinatario elegivel
  let blocked = eligible.length === 0

  // Se o envio exige uma caixa especifica, e nenhuma das caixas alvo tem destinatario
  if (!blocked && !isGeneralAudience && targetBoxes.length > 0) {
    const hasCoverage = targetBoxes.some((targetBox) =>
      eligible.some((rec) => rec.matchedBoxCodes.includes(targetBox)),
    )
    if (!hasCoverage) {
      blocked = true
    }
  }

  return { eligible, excluded, blocked }
}

export function buildRecipientSnapshot(input: {
  customerId: number
  kind: string
  audience?: CustomerCommunicationAudience
  recipients: readonly CustomerCommunicationRecipient[]
}): string {
  const sorted = [...input.recipients]
    .map(
      (r) =>
        `${r.id}:${normalizeEmail(r.email)}:${[...(r.matchedBoxCodes || [])].sort().join(',')}`,
    )
    .sort()
    .join('|')
  const audienceKey =
    input.audience?.mode === 'caixa'
      ? `caixa:${input.audience.boxCode}`
      : 'todos'
  return `${input.customerId}:${input.kind}:${audienceKey}:${sorted}`
}
