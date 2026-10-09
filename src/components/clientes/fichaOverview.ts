// Pendências da Visão geral da ficha do Cliente: o que pede ação, a
// consequência e onde resolver. Só traduz o que as consultas já trazem; as
// regras continuam no banco (gate do Portal, Liberação, Revisão, Demurrage).
import { accountSituationLabel, hasBrokenRecoveryEmail, hasPortalPendency } from '../../lib/portalProvisioningViewModel'
import { formatDate } from '../../lib/utils'
import type { QueueRow } from '../../services/portalProvisioning'
import type { FichaTabId } from './fichaTabConfig'

export type OverviewTone = 'danger' | 'warning' | 'info'

export type OverviewAction =
  | { label: string; to: string }
  | { label: string; tab: FichaTabId }

export type OverviewItem = {
  key: string
  tone: OverviewTone
  title: string
  detail?: string
  actions: OverviewAction[]
}

/** Fonte consultada; `undefined` enquanto carrega, `null` quando falhou. */
type Source<T> = T | undefined | null

export type OverviewInput = {
  customerId: number
  customerName: string
  portal: Source<Pick<QueueRow, 'account_situation' | 'provisioning_decision' | 'hasCriticalAlert' | 'recoveryEmailStatus' | 'recoveryEmailSuppressed'> | false>
  /** Liberação de faturamento sem Portal vigente: data de revisão; `false` sem liberação vigente. */
  releaseUntil: Source<string | false>
  blsInReview: number
  hasPrimaryEmail: boolean
  pendingReconciliation: Source<number>
  /** `false` quando o perfil não lê Demurrage. */
  demurrage: Source<{ overdue: number; disputes: number } | false>
  runningDemurrage: Source<number>
}

export type OverviewResult = {
  items: OverviewItem[]
  /** Fontes que ainda carregam. */
  loading: string[]
  /** Fontes que falharam: a lista não afirma que está limpa. */
  failed: string[]
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

const TONE_ORDER: Record<OverviewTone, number> = { danger: 0, warning: 1, info: 2 }

export function buildFichaOverview(input: OverviewInput): OverviewResult {
  const items: OverviewItem[] = []
  const loading: string[] = []
  const failed: string[] = []
  const provisioningLink = { label: 'Abrir no Provisionamento do Portal', to: `/clientes/portal?cliente=${input.customerId}` }

  function track<T>(label: string, source: Source<T>): source is T {
    if (source === undefined) loading.push(label)
    else if (source === null) failed.push(label)
    return source !== undefined && source !== null
  }

  const portalKnown = track('Portal', input.portal)
  const releaseKnown = track('Liberação de faturamento', input.releaseUntil)
  if (portalKnown && input.portal) {
    const portal = input.portal
    if (hasPortalPendency(portal) || portal.hasCriticalAlert) {
      const situation = accountSituationLabel(portal.account_situation).toLowerCase()
      if (releaseKnown && input.releaseUntil) {
        items.push({
          key: 'portal',
          tone: 'info',
          title: `Portal não ativo (${situation}); faturamento liberado sem Portal até ${formatDate(input.releaseUntil)}`,
          detail: 'Faturas saem sem esperar o Portal até a data de revisão; depois, voltam a ficar retidas.',
          actions: [provisioningLink, { label: 'Ver a Liberação', tab: 'financeiro' }],
        })
      } else {
        items.push({
          key: 'portal',
          tone: portal.hasCriticalAlert ? 'danger' : 'warning',
          title: portal.hasCriticalAlert ? `Pendência crítica de Portal (${situation})` : `Portal não provisionado (${situation})`,
          detail: 'Com o CE Mercante registrado, as faturas ficam retidas até a Conta de Portal ficar ativa ou o Administrativo conceder a Liberação de faturamento sem Portal.',
          actions: [provisioningLink, { label: 'Liberação na aba Financeiro', tab: 'financeiro' }],
        })
      }
    } else if (hasBrokenRecoveryEmail(portal)) {
      items.push({
        key: 'recuperacao',
        tone: 'warning',
        title: 'Email de Recuperação com falha',
        detail: 'A conta funciona com a senha, mas a recuperação de senha não chega ao Cliente.',
        actions: [provisioningLink],
      })
    }
  }

  if (input.blsInReview > 0) {
    items.push({
      key: 'revisao',
      tone: 'warning',
      title: `${plural(input.blsInReview, 'B/L', 'B/Ls')} em revisão`,
      detail: 'Não são faturados enquanto a revisão estiver aberta.',
      actions: [{ label: 'Abrir na Revisão', to: `/revisao?cliente=${input.customerId}` }],
    })
  }

  if (track('Reconciliação de cliente', input.pendingReconciliation) && input.pendingReconciliation > 0) {
    items.push({
      key: 'reconciliacao',
      tone: 'warning',
      title: `${plural(input.pendingReconciliation, 'B/L vinculado por nome', 'B/Ls vinculados por nome')}, aguardando confirmação`,
      detail: 'Confirme ou corrija o Cliente na seção Cliente de cada B/L.',
      actions: [{ label: 'Ver os B/Ls na aba Operacional', tab: 'operacional' }],
    })
  }

  if (track('Faturas de Demurrage', input.demurrage) && input.demurrage) {
    if (input.demurrage.overdue > 0) {
      items.push({
        key: 'vencidas',
        tone: 'danger',
        title: `${plural(input.demurrage.overdue, 'fatura de Demurrage vencida', 'faturas de Demurrage vencidas')}`,
        actions: [{ label: 'Ver na aba Financeiro', tab: 'financeiro' }],
      })
    }
    if (input.demurrage.disputes > 0) {
      items.push({
        key: 'disputas',
        tone: 'warning',
        title: `${plural(input.demurrage.disputes, 'disputa de Demurrage aberta', 'disputas de Demurrage abertas')}`,
        actions: [{ label: 'Ver na aba Financeiro', tab: 'financeiro' }],
      })
    }
  }

  if (track('Demurrage correndo', input.runningDemurrage) && input.runningDemurrage > 0) {
    items.push({
      key: 'correndo',
      tone: 'warning',
      title: `${plural(input.runningDemurrage, 'container com Demurrage correndo', 'containers com Demurrage correndo')}`,
      detail: 'Descarregados, sem devolução e fora do free time.',
      actions: [{ label: 'Abrir em Demurrage', to: `/demurrage?busca=${encodeURIComponent(input.customerName)}` }],
    })
  }

  if (!input.hasPrimaryEmail) {
    items.push({
      key: 'contato',
      tone: 'warning',
      title: 'Sem contato principal com e-mail',
      detail: 'Os Comunicados não chegam ao Cliente. Não impede o faturamento.',
      actions: [{ label: 'Cadastrar na aba Cadastro e contatos', tab: 'cadastro' }],
    })
  }

  items.sort((left, right) => TONE_ORDER[left.tone] - TONE_ORDER[right.tone])
  return { items, loading, failed }
}
