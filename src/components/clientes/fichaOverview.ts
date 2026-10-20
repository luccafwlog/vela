// Pendências da Visão geral da ficha do Cliente: o que pede ação, a
// consequência e onde resolver. Só traduz o que as consultas já trazem; as
// regras continuam no banco (gate do Portal, Liberação, Revisão, Demurrage).
import { accountSituationLabel, hasBrokenRecoveryEmail, hasPortalPendency, isPortalReadyForBilling } from '../../lib/portalProvisioningViewModel'
import { formatDate } from '../../lib/utils'
import type { QueueRow } from '../../services/portalProvisioning'
import type { FichaTabId } from './fichaTabConfig'

export type OverviewTone = 'danger' | 'warning' | 'info'

export type OverviewAction =
  | { label: string; to: string }
  | { label: string; tab: FichaTabId }

/** Bloco da Visão geral onde a pendência aparece (regra 5: no bloco do assunto). */
export type OverviewBlock = 'portal' | 'saldo' | 'contato' | 'bls'

export type OverviewItem = {
  key: string
  block: OverviewBlock
  tone: OverviewTone
  title: string
  detail?: string
  actions: OverviewAction[]
}

/** Fonte consultada; `undefined` enquanto carrega, `null` quando falhou. */
type Source<T> = T | undefined | null

type PortalFacts = Pick<QueueRow, 'account_situation' | 'provisioning_decision' | 'hasCriticalAlert' | 'recovery_email' | 'recoveryEmailStatus' | 'recoveryEmailSuppressed'>

/**
 * Perfis que leem o Email de Recuperação no console: os cinco, como o banco
 * (`portal_list_provisioning_console` dá acesso completo a todos desde a
 * migration `250`; achado P2 do lote 5b alinhou Operações).
 */
export const RECOVERY_EMAIL_READER_ROLES: readonly string[] = ['administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos']

/**
 * Leitura do Gate de faturamento do Portal (conta ativa com Email de
 * Recuperação utilizável, migration `084`). Perfil que não lê o Email de
 * Recuperação no console vê só a situação da conta e uma falha já conhecida,
 * para não acusar trava que a tela não consegue ver. O banco continua sendo a
 * autoridade.
 */
export function portalLooksReadyForBilling(portal: PortalFacts, recoveryEmailVisible: boolean) {
  return recoveryEmailVisible
    ? isPortalReadyForBilling(portal)
    : portal.account_situation === 'ativo' && !hasBrokenRecoveryEmail(portal)
}

export type OverviewInput = {
  customerId: number
  customerName: string
  /** CNPJ/CPF canônico do Cliente. */
  customerDocument: string
  /** `false` quando o console não devolve Conta de Portal para o Cliente. */
  portal: Source<PortalFacts | false>
  /** O perfil lê o Email de Recuperação no console do Portal. */
  recoveryEmailVisible: boolean
  /** Liberação de faturamento sem Portal vigente: data de revisão; `false` sem liberação vigente. */
  releaseUntil: Source<string | false>
  blsInReview: number
  hasPrimaryEmail: boolean
  pendingReconciliation: Source<number>
  /** `false` quando o perfil não lê Demurrage. */
  // Demurrage não vence (ADR 0014; B29): a ficha só sinaliza a disputa aberta.
  demurrage: Source<{ disputes: number } | false>
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

/**
 * Fila da Revisão recortada no Cliente. A busca da Revisão casa por trecho
 * (`?cliente=<id>` também acharia B/Ls cujo número ou CNPJ contém o id); o
 * documento completo só casa com o próprio Cliente.
 */
export function revisaoHref(customerDocument: string) {
  return `/revisao?busca=${encodeURIComponent(customerDocument)}`
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
  if (portalKnown) {
    // Sem linha na fila do Portal (`false`) é o mesmo que "sem conta": o gate
    // de faturamento fica fechado do mesmo jeito.
    const portal = input.portal || null
    if (!portal || !portalLooksReadyForBilling(portal, input.recoveryEmailVisible)) {
      // Conta não ativa, ou ativa sem Email de Recuperação utilizável: nos
      // dois casos o gate fica fechado e a fatura, retida.
      const accountActive = portal ? !hasPortalPendency(portal) : false
      const cause = portal && accountActive
        ? (hasBrokenRecoveryEmail(portal) ? 'Email de Recuperação com falha' : 'Conta de Portal sem Email de Recuperação')
        : null
      const situation = portal ? accountSituationLabel(portal.account_situation).toLowerCase() : 'sem conta'
      const critical = portal?.hasCriticalAlert ?? false
      if (releaseKnown && input.releaseUntil) {
        items.push({
          key: 'portal',
          block: 'portal',
          tone: 'info',
          title: `${cause ?? `Portal não ativo (${situation})`}; faturamento liberado sem Portal até ${formatDate(input.releaseUntil)}`,
          detail: 'Faturas saem sem esperar o Portal até a data de revisão; depois, voltam a ficar retidas.',
          actions: [provisioningLink, { label: 'Ver a Liberação', tab: 'financeiro' }],
        })
      } else {
        items.push({
          key: 'portal',
          block: 'portal',
          tone: critical ? 'danger' : 'warning',
          title: cause ?? (critical ? `Pendência crítica de Portal (${situation})` : `Portal não provisionado (${situation})`),
          detail: accountActive
            ? 'A conta está ativa, mas sem Email de Recuperação utilizável o Portal não está pronto: com o CE Mercante registrado, as faturas ficam retidas até o e-mail ser corrigido ou o Administrativo conceder a Liberação de faturamento sem Portal.'
            : 'Com o CE Mercante registrado, as faturas ficam retidas até a Conta de Portal ficar ativa ou o Administrativo conceder a Liberação de faturamento sem Portal.',
          actions: [provisioningLink, { label: 'Liberação na aba Financeiro', tab: 'financeiro' }],
        })
      }
    } else if (portal?.hasCriticalAlert) {
      items.push({
        key: 'portal',
        block: 'portal',
        tone: 'danger',
        title: 'Alerta crítico aberto',
        detail: 'Há alerta crítico aberto para o Cliente ou um dos seus B/Ls.',
        actions: [provisioningLink],
      })
    }
  }

  if (input.blsInReview > 0) {
    items.push({
      key: 'revisao',
      block: 'bls',
      tone: 'warning',
      title: `${plural(input.blsInReview, 'B/L', 'B/Ls')} em revisão`,
      detail: 'Não são faturados enquanto a revisão estiver aberta.',
      actions: [{ label: 'Abrir na Revisão', to: revisaoHref(input.customerDocument) }],
    })
  }

  if (track('Reconciliação de cliente', input.pendingReconciliation) && input.pendingReconciliation > 0) {
    items.push({
      key: 'reconciliacao',
      block: 'bls',
      tone: 'warning',
      title: `${plural(input.pendingReconciliation, 'B/L vinculado por nome', 'B/Ls vinculados por nome')}, aguardando confirmação`,
      detail: 'Confirme ou corrija o Cliente na seção Cliente de cada B/L.',
      actions: [{ label: 'Ver os B/Ls na aba BLs', tab: 'bls' }],
    })
  }

  if (track('Faturas de Demurrage', input.demurrage) && input.demurrage) {
    if (input.demurrage.disputes > 0) {
      items.push({
        key: 'disputas',
        block: 'saldo',
        tone: 'warning',
        title: `${plural(input.demurrage.disputes, 'disputa de Demurrage aberta', 'disputas de Demurrage abertas')}`,
        actions: [{ label: 'Ver na aba Financeiro', tab: 'financeiro' }],
      })
    }
  }

  if (track('Demurrage correndo', input.runningDemurrage) && input.runningDemurrage > 0) {
    items.push({
      key: 'correndo',
      block: 'saldo',
      tone: 'warning',
      title: `${plural(input.runningDemurrage, 'container com Demurrage correndo', 'containers com Demurrage correndo')}`,
      detail: 'Descarregados, sem devolução e fora do free time.',
      actions: [{ label: 'Abrir em Demurrage', to: `/demurrage?lente=atraso&busca=${encodeURIComponent(input.customerName)}` }],
    })
  }

  if (!input.hasPrimaryEmail) {
    items.push({
      key: 'contato',
      block: 'contato',
      tone: 'warning',
      title: 'Sem contato principal com e-mail',
      detail: 'Os Comunicados não chegam ao Cliente. Não impede o faturamento.',
      actions: [{ label: 'Cadastrar na aba Cadastro e contatos', tab: 'cadastro' }],
    })
  }

  items.sort((left, right) => TONE_ORDER[left.tone] - TONE_ORDER[right.tone])
  return { items, loading, failed }
}
