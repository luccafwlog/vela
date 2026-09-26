import { formatDate } from './utils'

export function normalizePortName(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase() || '-'
}

export function formatPortDisplayName(port: string | null | undefined) {
  const normalized = normalizePortName(port)

  const portNames: Record<string, string> = {
    CNNGB: 'NINGBO',
    CNNBO: 'NINGBO',
    CNNSA: 'NANSHA',
    CNNAN: 'NANSHA',
    CNSHG: 'SHANGHAI',
    CNSHA: 'SHANGHAI',
    CNTAC: 'TAICANG',
    CNTAG: 'TAICANG',
    CNTAI: 'TAICANG',
    CNTAO: 'QINGDAO',
    CNQDG: 'QINGDAO',
    CNZJG: 'ZHANGJIAGANG',
    CNXMN: 'XIAMEN',
    CNSHK: 'SHEKOU',
    CNYTN: 'YANTIAN',
    HKHKG: 'HONG KONG',
    // Lado brasileiro: os codigos canonicos sao os que `normalize_port_code`
    // (migration 365) produz, e e por eles que a tabela de cobranca e escolhida.
    // Sem estes nomes a tela mostra o LOCODE cru justamente no porto de descarga,
    // que e o dado que explica qual tabela foi usada.
    BRVIX: 'VITORIA',
    BRVIT: 'VITORIA',
    VIX: 'VITORIA',
    BRSSA: 'SALVADOR',
    BRSSZ: 'SANTOS',
    BRPNG: 'PARANAGUA',
    BRITJ: 'ITAJAI',
    BRRIG: 'RIO GRANDE',
    BRSUA: 'SUAPE',
    BRRIO: 'RIO DE JANEIRO',
    BRPEC: 'PECEM',
    BRMAO: 'MANAUS',
  }

  return portNames[normalized] ?? (String(port ?? '').trim() || '-')
}

export function formatMetric(value: number | null | undefined) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount.toLocaleString('pt-BR') : '0'
}

export function tokenizeInfoValue(value: string) {
  if (!value || value === '-') return []

  const tokens = value
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean)

  return tokens.length > 1 ? tokens : []
}

export function stripFileExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, '')
}

/**
 * Nome acessível do botão que edita uma Atracação no Planejamento por escala.
 * Usa só o que a linha mostra: o código do terminal, que identifica a
 * Atracação (o mesmo terminal ocorre uma vez por Escala), e a data de
 * atracação (ATB; ETB enquanto não atracou). Sem código — ou com o marcador
 * TBC — diz "terminal a definir"; nunca o UUID do terminal, que é código de
 * máquina para quem usa leitor de tela.
 */
export function atracacaoEditLabel(
  atracacao: { terminalCode?: string | null; atb?: string | null; etb?: string | null },
  port: string,
) {
  const code = atracacao.terminalCode?.trim()
  const terminal = code && code.toUpperCase() !== 'TBC' ? code : 'terminal a definir'
  const date = atracacao.atb ? `ATB ${formatDate(atracacao.atb)}` : atracacao.etb ? `ETB ${formatDate(atracacao.etb)}` : null
  return `Editar atracação ${terminal}${date ? `, ${date}` : ''}, da escala ${port}`
}
