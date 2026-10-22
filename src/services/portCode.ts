import { normalizeText } from '../lib/utils'

// Known port names -> UN/LOCODE for the desk's active lanes. B/L and manifest
// cells sometimes carry the city name ("SALVADOR, BRAZIL") instead of the code,
// so callers that persist pol/pod need this to store the canonical LOCODE.
// ponytail: hand-kept lookup for the lanes in use; the CSSC showcase ports
// are listed here so Portal schedules match manifest POL/POD codes. Upgrade
// path = load a real UN/LOCODE dataset if the list grows.
const PORT_NAME_TO_LOCODE: Array<[string, string]> = [
  ['salvador', 'BRSSA'],
  ['vitoria', 'BRVIX'],
  ['vitória', 'BRVIX'],
  ['pecem', 'BRPEC'],
  ['pecém', 'BRPEC'],
  ['santos', 'BRSSZ'],
  ['paranagua', 'BRPNG'],
  ['paranaguá', 'BRPNG'],
  ['itajai', 'BRITJ'],
  ['itajaí', 'BRITJ'],
  // Navegantes e Itajaí, Recife e Suape são portos e escalas distintos (ADR
  // 0095, decisão 12): nenhum dos quatro vira o outro.
  ['navegantes', 'BRNVT'],
  ['rio grande', 'BRRIG'],
  ['suape', 'BRSUA'],
  ['recife', 'BRREC'],
  ['rio de janeiro', 'BRRIO'],
  ['sepetiba', 'BRSEP'],
  ['manaus', 'BRMAO'],
  ['qingdao', 'CNTAO'],
  ['qindgao', 'CNTAO'],
  ['tsingtao', 'CNTAO'],
  ['cnqdg', 'CNTAO'],
  ['shanghai', 'CNSHA'],
  ['cnshg', 'CNSHA'],
  ['taicang', 'CNTAC'],
  ['taikang', 'CNTAC'],
  ['cntai', 'CNTAC'],
  ['cntag', 'CNTAC'],
  ['ningbo', 'CNNGB'],
  ['cnnbo', 'CNNGB'],
  // Zhoushan integra o complexo portuário Ningbo-Zhoushan: o Baplie codifica
  // CNZOS enquanto o B/L declara Ningbo (CNNGB). Mesma rota comercial.
  ['zhoushan', 'CNNGB'],
  ['cnzos', 'CNNGB'],
  ['zos', 'CNNGB'],
  ['nansha', 'CNNSA'],
  ['cnnan', 'CNNSA'],
  ['guangzhou', 'CNNSA'],
  ['cngzu', 'CNNSA'],
  ['zhangjiagang', 'CNZJG'],
  ['xiamen', 'CNXMN'],
  ['shekou', 'CNSHK'],
  ['shenzhen', 'CNSHK'],
  ['cnszk', 'CNSHK'],
  ['cnshe', 'CNSHK'],
  ['yantian', 'CNYTN'],
  // Zhuhai (Gaolan) é porto próprio do delta do Rio das Pérolas, não apelido
  // de Nansha nem de Shekou.
  ['zhuhai', 'CNZUH'],
  ['hong kong', 'HKHKG'],
  ['hongkong', 'HKHKG'],
  ['singapore', 'SGSIN'],
  ['new york', 'USNYC'],
  ['hamburg', 'DEHAM'],
]

// Códigos que já fazem parte do cadastro de escalas/rotas, mas que não
// precisam de alias textual para serem aceitos no contrato dos imports.
const KNOWN_PORT_CODES = new Set([
  ...PORT_NAME_TO_LOCODE.map(([, code]) => code),
  'BRVIX', 'BRVIT', 'BRBEL', 'BRFOR', 'BRIGI', 'BRIOS', 'BRMCZ', 'BRNAT',
  'BRSEP', 'BRSLZ', 'BRSFS', 'ITGOA', 'NLRTM',
])

// Códigos de 3 letras (sem prefixo de país) e LOCODEs alternativos que o Baplie
// da COSCO usa em LOC+6/LOC+12. Só casam com o valor inteiro: como substring
// ("sep", "vix") capturariam texto livre de manifesto.
const EXACT_PORT_ALIASES: Record<string, string> = {
  CNCAN: 'CNNSA', // Guangzhou, tratado como Nansha (mesma regra de 'guangzhou')
  TAO: 'CNTAO',
  VIX: 'BRVIX',
  VIT: 'BRVIX', // Vitória: VIX, VIT, BRVIT e BRVIX são o mesmo porto
  CNTCA: 'CNTAC', // Taicang (variante COSCO)
  TCA: 'CNTAC', // Taicang (LOC+6 do Baplie da COSCO)
  BRSPB: 'BRSEP', // Sepetiba (variante COSCO de 5 letras)
  SPB: 'BRSEP', // Sepetiba
  SEP: 'BRSEP',
}

export function normalizePortCode(value: string | null | undefined) {
  return resolvePortCode(value).code
}

/** Normaliza sem inventar LOCODE: devolve o código e se foi reconhecido. */
export function resolvePortCode(value: string | null | undefined): { code: string | null; recognized: boolean } {
  const normalized = (value ?? '').trim().toUpperCase()
  if (!normalized) return { code: null, recognized: false }

  if (normalized === 'BRVIT') return { code: 'BRVIX', recognized: true }
  const exact = EXACT_PORT_ALIASES[normalized]
  if (exact) return { code: exact, recognized: true }
  const text = normalizeText(normalized)
  const match = PORT_NAME_TO_LOCODE
    .map(([name, code]) => ({ code, index: text.indexOf(normalizeText(name)) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)[0]
  if (match) return { code: match.code, recognized: true }

  if (/^[A-Z]{5}$/.test(normalized)) {
    // Um LOCODE não reconhecido não pode virar texto persistido: o chamador
    // deve registrar a divergência e deixar o campo nulo no payload forçado.
    return KNOWN_PORT_CODES.has(normalized)
      ? { code: normalized, recognized: true }
      : { code: null, recognized: false }
  }
  const embeddedLocode = (normalized.match(/\b[A-Z]{2}[A-Z0-9]{3}\b/g) ?? [])
    .map((code) => (code === 'BRVIT' ? 'BRVIX' : code))
    .find((code) => KNOWN_PORT_CODES.has(code))
  if (embeddedLocode) {
    return { code: embeddedLocode, recognized: true }
  }

  return { code: null, recognized: false }
}

/** Todas as formas persistidas historicamente para o mesmo porto. */
export function portCodeVariants(value: string | null | undefined): string[] {
  const canonical = normalizePortCode(value)
  if (!canonical) return []
  const variants = new Set([canonical])
  for (const [name, code] of PORT_NAME_TO_LOCODE) {
    if (code === canonical) variants.add(name.toUpperCase())
  }
  if (canonical === 'BRVIX') ['BRVIT', 'VIX', 'VIT'].forEach((alias) => variants.add(alias))
  return [...variants]
}

// Cópia exata de `public.normalize_port_code` (migration 391). Filtros de
// leitura que mandam o porto ao banco e comparações com o que o banco decide
// (escopo da tabela de Taxas Locais, PODs do Baplie) usam esta régua:
// `normalizePortCode` é a do import, que também reconhece nomes dentro de um
// texto ("SALVADOR, BRAZIL") e por isso não serve para comparar valor gravado.
// Os apelidos exatos de `EXACT_PORT_ALIASES` estão aqui também (o teste
// `portCode.test.ts` confere).
// ponytail: tabela duplicada; `operationalLists.local-pg.test.ts` compara as
// duas e falha se divergirem. Upgrade: gerar esta tabela a partir do banco.
const STORED_PORT_ALIASES: Array<[string, string[]]> = [
  ['BRVIX', ['BRVIT', 'VIT', 'VITORIA', 'VITÓRIA', 'BRVIX', 'VIX']],
  ['BRSSA', ['SALVADOR', 'BRSSA', 'SSA']],
  ['BRPEC', ['PECEM', 'PECÉM', 'BRPEC', 'PEC']],
  ['BRSSZ', ['SANTOS', 'BRSSZ', 'SSZ']],
  ['BRPNG', ['PARANAGUA', 'PARANAGUÁ', 'BRPNG', 'PNG']],
  ['BRITJ', ['ITAJAI', 'ITAJAÍ', 'BRITJ', 'ITJ']],
  ['BRNVT', ['NAVEGANTES', 'BRNVT', 'NVT']],
  ['BRRIG', ['RIO GRANDE', 'BRRIG', 'RIG']],
  ['BRSUA', ['SUAPE', 'BRSUA', 'SUA']],
  ['BRREC', ['RECIFE', 'BRREC', 'REC']],
  ['BRRIO', ['RIO DE JANEIRO', 'BRRIO', 'BRRDJ']],
  ['BRSEP', ['SEPETIBA', 'BRSEP', 'BRSPB', 'SPB', 'SEP']],
  ['BRMAO', ['MANAUS', 'BRMAO']],
  ['CNTAO', ['QINGDAO', 'QINDGAO', 'TSINGTAO', 'CNTAO', 'CNQDG', 'QDG', 'TAO']],
  ['CNSHA', ['SHANGHAI', 'CNSHA', 'CNSHG', 'SHG']],
  ['CNTAC', ['TAICANG', 'TAIKANG', 'CNTAC', 'CNTAI', 'CNTAG', 'CNTCA', 'TCA']],
  ['CNNGB', ['NINGBO', 'CNNGB', 'CNNBO', 'NBO', 'ZHOUSHAN', 'CNZOS', 'ZOS']],
  ['CNNSA', ['NANSHA', 'CNNSA', 'CNNAN', 'GUANGZHOU', 'CNGZU', 'CNCAN']],
  ['CNZJG', ['ZHANGJIAGANG', 'CNZJG']],
  ['CNXMN', ['XIAMEN', 'AMOY', 'CNXMN', 'XMN']],
  ['CNSHK', ['SHEKOU', 'SHENZHEN', 'CNSHK', 'CNSZK', 'CNSHE']],
  ['CNYTN', ['YANTIAN', 'CNYTN', 'YTN']],
  ['HKHKG', ['HONG KONG', 'HONGKONG', 'HKHKG', 'HKG']],
]
const STORED_PORT_CODE = new Map(STORED_PORT_ALIASES.flatMap(([code, aliases]) => aliases.map((alias) => [alias, code] as const)))

/** Todos os sinônimos conhecidos pelo banco (para o teste de paridade). */
export const STORED_PORT_ALIAS_VALUES = [...STORED_PORT_CODE.keys()]

/** Porto como `public.normalize_port_code` o devolve; vazio vira null. */
export function normalizeStoredPortCode(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().toUpperCase()
  if (!normalized) return null
  return STORED_PORT_CODE.get(normalized) ?? normalized
}

/**
 * Grafias gravadas que `public.normalize_port_code` leva ao mesmo porto, para
 * filtrar uma coluna crua (`bls.pol`/`pod`) pelo porto canônico das opções.
 */
export function storedPortAliases(value: string | null | undefined): string[] {
  const canonical = normalizeStoredPortCode(value)
  if (!canonical) return []
  const aliases = STORED_PORT_ALIASES.find(([code]) => code === canonical)?.[1]
  return aliases ? [...aliases] : [canonical]
}
