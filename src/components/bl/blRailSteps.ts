import type { Step } from '../ui/StepRail'
import type { RailStage } from '../../services/blRails'

/**
 * Converte os trilhos do B/L (`services/blRails`) para o `StepRail` comum.
 *
 * - Operacional: a primeira etapa pendente vira a atual ("Em andamento"),
 *   para o trilho dizer onde a carga está.
 * - Documental: bloqueio continua bloqueio; a primeira pendência simples vira a
 *   atual, a mesma que a próxima ação aponta.
 * - Desvio por omissão de escala não tem estado próprio no trilho comum: fica
 *   como pendente e o texto da etapa diz para onde a carga foi.
 */
export function railStagesToSteps(stages: RailStage[]): Step[] {
  let currentAssigned = false
  return stages.map((stage) => {
    let state: Step['state']
    if (stage.state === 'done') state = 'done'
    else if (stage.state === 'blocked') state = 'blocked'
    else if (stage.state === 'pending' && !currentAssigned) state = 'current'
    else state = 'pending'
    if (state === 'current' || (state === 'blocked' && !currentAssigned)) currentAssigned = true
    return { key: stage.key, label: stage.label, detail: stage.detail, state, href: stage.href }
  })
}

/** Texto do link da próxima ação: diz para onde a pessoa vai, não só "abrir". */
export function nextActionLinkLabel(href: string | undefined) {
  if (!href) return null
  if (href.startsWith('/revisao')) return 'Resolver na Revisão'
  if (href.startsWith('/taxas-locais')) return 'Abrir a fatura'
  if (href.includes('tab=faturamento')) return 'Ir para Faturamento'
  if (href.includes('tab=detalhes')) return 'Ir para Detalhes do B/L'
  if (href.startsWith('/viagens')) return 'Abrir a Viagem'
  return 'Abrir'
}
