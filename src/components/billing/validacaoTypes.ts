export type OpsFilters = {
  search: string
  cargoMode: '' | 'container' | 'carga_solta' | 'misto' | 'granito'
  pod: string
  voyageId: string
  blockCode: '' | BillingBlockCode
  includeResolved: boolean
}

export type BillingBlockCode = 'sem_cliente' | 'calculo_incompleto' | 'aguardando_ce' | 'portal_nao_provisionado' | 'faturado' | 'isento' | 'pronto' | 'operacao_granito'

export type BatchOperation = 'recalculate'
