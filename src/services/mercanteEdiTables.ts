// Tabelas de saída do EDI Mercante (issue #560). O Vela guarda o código do
// armador, do porto e do tipo de contêiner do jeito que o B/L traz; o Mercante
// exige os códigos das tabelas dele. Valores conferidos contra os EDIs do
// sistema externo e confirmados pelo dono em 2026-11-02.
// ponytail: tabelas fixas no código. Armador, terminal ou tipo novo exige mudar
// este arquivo; se isso ficar frequente, cada tabela vira coluna ou cadastro
// (código Mercante no cadastro do armador e do terminal, de→para de tipos).

/** Código da empresa de navegação no Mercante, pelo SCAC do armador. */
export const MERCANTE_CARRIER_CODE: Readonly<Record<string, string>> = {
  CSSC: 'CN001321', // COSCO Shipping Specialized Carriers
}

/** Código Mercante do terminal portuário, pelo código do terminal no Vela. */
export const MERCANTE_TERMINAL_CODE: Readonly<Record<string, string>> = {
  TVV: 'BRVIX004', // T.V.V. Terminal de Vila Velha
  PORTMAC: 'BRVIX006', // Cais de Capuaba - CODESA
}

/**
 * Porto em que o código do Mercante difere do código canônico do Vela. Os
 * demais saem como o Vela grava (e são conferidos na tabela do Mercante).
 */
export const MERCANTE_PORT_CODE: Readonly<Record<string, string>> = {
  CNTAC: 'CNTAG', // Taicang: CNTAC não existe no Mercante
  CNTAO: 'CNQIN', // Qingdao: o Mercante aceita os dois; o sistema externo usa CNQIN
}

/** UF do porto brasileiro de destino (campo UF de destino da carga, C5). */
export const BRAZILIAN_PORT_UF: Readonly<Record<string, string>> = {
  BRBEL: 'PA', BRFOR: 'CE', BRIGI: 'RJ', BRIOS: 'BA', BRITJ: 'SC',
  BRMAO: 'AM', BRMCZ: 'AL', BRNAT: 'RN', BRNVT: 'SC', BRPEC: 'CE',
  BRPNG: 'PR', BRREC: 'PE', BRRIG: 'RS', BRRIO: 'RJ', BRSFS: 'SC',
  BRSLZ: 'MA', BRSSA: 'BA', BRSSZ: 'SP', BRSUA: 'PE', BRVIX: 'ES',
}

/** De→para do tipo de contêiner do B/L para o tipo do Mercante (tabela Siscomex). */
export const MERCANTE_CONTAINER_TYPE: Readonly<Record<string, string>> = {
  '20GP': '22G1',
  '20HC': '25G1',
  '20OT': '22U1',
  '40FH': '45P3',
  '40FM': '49P0',
  '40FR': '42P3',
  '40GP': '42G1',
  '40HC': '45G1',
  '40OT': '42U1',
  '48FR': 'R9P0',
  '40FP': '42P4',
  '48FP': '42P8',
  '40FW': '69P0',
  '40EW': '89P0',
}

/** Código do componente do frete no Mercante, pela categoria da linha do B/L. */
export const MERCANTE_FREIGHT_COMPONENT: Readonly<Record<string, string>> = {
  THD: '017',
}

/** Código da moeda na tabela do Siscomex. */
export const MERCANTE_CURRENCY: Readonly<Record<string, string>> = {
  USD: '220',
  BRL: '790',
}
