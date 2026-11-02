// Gerador do EDI Mercante de Longo Curso Importação (issue #560): M5 (manifesto),
// C5 (conhecimento, um por B/L), I5 (item, um por contêiner do B/L) e V5
// (contêiner vazio). Posições e regras do manual "Definições dos leiautes
// esquemáticos EDI/Upload" do Mercante (v3.6); limpeza de texto, BOM, CRLF e o
// preenchimento até 5000 posições iguais aos do sistema externo que o Vela
// substitui. Função pura: recebe os dados já lidos e devolve o texto e o que
// impede ou merece aviso. Nada é descartado em silêncio.

import { COMPANY } from '../config/company'
import { isValidCnpj } from '../lib/cnpj'
import {
  BRAZILIAN_PORT_UF,
  MERCANTE_CONTAINER_TYPE,
  MERCANTE_CURRENCY,
  MERCANTE_FREIGHT_COMPONENT,
  MERCANTE_PORT_CODE,
} from './mercanteEdiTables'
import { MERCANTE_PORT_CODES, MERCANTE_TERMINAL_CODES } from './mercanteTableCodes'

export type MercanteEdiIssue = {
  /** Impedimento bloqueia o download; aviso só informa. */
  severity: 'impedimento' | 'aviso'
  /** B/L ou contêiner a que o problema se refere; vazio quando é do manifesto. */
  ref: string | null
  message: string
}

export type MercanteEdiHeader = {
  /** Código Mercante da empresa de navegação (ex.: CN001321). */
  carrierCode: string | null
  /** ATD no POL (AAAA-MM-DD): data de encerramento do manifesto. */
  closingDate: string | null
  /** ETA no POD (AAAA-MM-DD): data da operação. */
  operationDate: string | null
  pol: string
  pod: string
  voyageNumber: string
  vesselImo: string | null
  /** Código Mercante do terminal de descarregamento (ex.: BRVIX004). */
  terminalCode: string | null
  /** Código do terminal no Vela (ex.: TVV), para dizer qual falta na tabela. */
  terminalDepot: string | null
}

export type MercanteEdiFreightLine = {
  category: string | null
  description: string | null
  currency: string | null
  amount: number | null
  payment: string | null
}

export type MercanteEdiContainer = {
  number: string
  type: string | null
  grossKg: number | null
  tareKg: number | null
  cbm: number | null
  seal: string | null
  isImo: boolean
  imoClass: string | null
  unNumber: string | null
  /** O contêiner está em mais de um B/L ativo da Viagem (uso parcial). */
  shared: boolean
}

export type MercanteEdiBl = {
  id: string
  consigneeBlock: string | null
  consigneeCnpj: string | null
  shipperBlock: string | null
  notifyBlock: string | null
  notifyCnpj: string | null
  emissionDate: string | null
  description: string | null
  totalPackages: number | null
  packagesUnit: string | null
  totalCbm: number | null
  movementFrom: string | null
  ncmCodes: string[]
  freightLines: MercanteEdiFreightLine[]
  /** Código Mercante do terminal do B/L (exceção individual); vazio usa o do manifesto. */
  terminalCode: string | null
  /** Código no Vela da exceção de terminal do B/L; vazio quando o B/L herda o da frente. */
  terminalDepot: string | null
  containers: MercanteEdiContainer[]
}

export type MercanteEdiVazio = {
  number: string
  type: string | null
  tareKg: number | null
}

export type MercanteEdiResult = {
  /** Conteúdo do arquivo; `null` quando há impedimento. */
  content: string | null
  issues: MercanteEdiIssue[]
}

const M5_LENGTH = 164
const C5_LENGTH = 4104
// I5 e V5 têm menos posições úteis (2059 e 30), mas o sistema externo completa
// com brancos até 5000 e esse arquivo é o que o Mercante já recebe.
const ITEM_LENGTH = 5000
const BOM = '﻿'
const EOL = '\r\n'
const PARTY_LENGTH = 253
const DESCRIPTION_LENGTH = 506
const OBSERVATIONS_LENGTH = 253
const MAX_FREIGHT_COMPONENTS = 15
const MAX_SEALS = 4
const MAX_NCM = 191
const BL_ID_LENGTH = 18
const CONTAINER_NUMBER = /^[A-Z]{4}\d{7}$/
const VESSEL_IMO = /^\d{7}$/
const SAME_AS_CONSIGNEE = /^\s*SAME\s+AS\s+CONSIGNEE\b/i
const TO_ORDER = /^\s*TO\s+(THE\s+)?ORDER\b/i

// --- texto ---------------------------------------------------------------

/** Maiúsculas, sem acento, uma linha só. `º` vira `O` (Nº → NO). */
function asciiUpper(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[º°]/g, 'O')
    .replace(/ª/g, 'A')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[\r\n\t]+/g, ' ')
}

/**
 * Limpeza do texto. Ficam letras, dígitos, espaço, ponto, vírgula e dois-pontos;
 * na descrição também o hífen. O sistema externo tira o resto (`/ - @ + ( ) # *`
 * etc.; `28.772.926/0001-14` → `28.772.926000114`) e o Mercante aceita assim.
 * ponytail: lista conservadora, não um limite comprovado do Mercante.
 */
export function cleanMercanteText(value: string | null | undefined, kind: 'party' | 'description'): string {
  const text = asciiUpper(value)
  // Na descrição, barra, parênteses e asterisco separam palavras e códigos
  // ("NCM:8483/8708", "APPLICABLE(NOT USED)"): viram espaço para não colar
  // "84838708". Nas partes, somem, como no externo (CNPJ 28.772.926000114).
  const spaced = kind === 'description' ? text.replace(/[/\\()*|]/g, ' ') : text
  const allowed = kind === 'party' ? /[^A-Z0-9 .,:]/g : /[^A-Z0-9 .,:-]/g
  return spaced.replace(allowed, '').replace(/ {2,}/g, ' ').trim()
}

/** Quebra o texto em até `width` posições sem cortar palavra. */
function splitAtWord(text: string, width: number): [string, string] {
  if (text.length <= width) return [text, '']
  const cut = text.lastIndexOf(' ', width)
  const at = cut > 0 ? cut : width
  return [text.slice(0, at).trimEnd(), text.slice(at).trimStart()]
}

// --- campos posicionais -------------------------------------------------

function blank(length: number): string[] {
  return new Array<string>(length).fill(' ')
}

/** Escreve `value` alinhado à esquerda a partir da posição (base 1) do manual. */
function put(buffer: string[], position: number, value: string, width: number) {
  const text = value.slice(0, width)
  for (let index = 0; index < text.length; index += 1) buffer[position - 1 + index] = text[index]
}

function digits(value: number, width: number): string {
  return String(Math.max(0, Math.round(value))).padStart(width, '0').slice(-width)
}

/**
 * Número com casas decimais implícitas (25480 kg com 3 casas → `000025480000`)
 * num campo posicional que precisa caber inteiro: negativo ou maior que
 * o campo é impedimento, não um valor cortado em silêncio.
 */
function amount(ctx: Ctx, ref: string | null, label: string, value: number | null | undefined, width: number, places: number): string {
  const scaled = Math.round((value ?? 0) * 10 ** places)
  if (!Number.isFinite(scaled) || scaled < 0 || String(scaled).length > width) {
    block(ctx, ref, `${label} ${value ?? ''} não cabe no campo do Mercante (${width - places} dígitos inteiros, sem negativo).`)
  }
  return digits(scaled, width)
}

function date8(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(0, 8)
}

function documentDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/[^0-9A-Z]/gi, '').toUpperCase()
}

// --- regras --------------------------------------------------------------

/** Código do porto na tabela do Mercante. */
export function mercantePortCode(code: string): string {
  const upper = code.trim().toUpperCase()
  return MERCANTE_PORT_CODE[upper] ?? upper
}

/** Tipo do contêiner no Mercante, pelo de→para; `null` quando não há conversão. */
export function mercanteContainerType(type: string | null | undefined): string | null {
  const key = (type ?? '').replace(/\s+/g, '').toUpperCase()
  return MERCANTE_CONTAINER_TYPE[key] ?? null
}

/**
 * Modalidade do frete pelo Type of Movement do B/L: cada lado vira `H` (House,
 * FCL) ou `P` (Pier, LCL). FCL/FCL → HH, LCL/LCL → PP, LCL/FCL → PH.
 */
export function mercanteFreightModality(movementFrom: string | null | undefined): string | null {
  const sides = (movementFrom ?? '').toUpperCase().split(/[/-]/).map((side) => side.trim())
  if (sides.length !== 2) return null
  const letter = (side: string) => (side === 'FCL' ? 'H' : side === 'LCL' ? 'P' : null)
  const [origin, destination] = sides.map(letter)
  return origin && destination ? `${origin}${destination}` : null
}

function paymentCode(payment: string | null | undefined): string | null {
  const upper = (payment ?? '').trim().toUpperCase()
  if (upper.startsWith('PREPAID') || upper === 'P') return 'P'
  if (upper.startsWith('COLLECT') || upper === 'C') return 'C'
  return null
}

function freightCategory(line: MercanteEdiFreightLine): string {
  return (line.category || line.description || '').toUpperCase().trim().replace(/[\s-]+/g, '_')
}

/** NCM do item: os 4 primeiros dígitos de cada código do B/L, sem repetição. */
export function mercanteNcmPositions(codes: string[]): string[] {
  const positions: string[] = []
  for (const code of codes) {
    const position = code.replace(/\D/g, '').slice(0, 4)
    if (position.length === 4 && !positions.includes(position)) positions.push(position)
  }
  return positions
}

function seals(value: string | null | undefined): string[] {
  return asciiUpper(value).split(/[/,;\s]+/).map((seal) => seal.replace(/[^A-Z0-9]/g, '')).filter(Boolean)
}

/** Sigla do navio e da viagem no nome do arquivo: GREEN GUANGZHOU V.6 → GG6. */
export function mercanteFileTag(vesselName: string, voyageNumber: string): string {
  const initials = asciiUpper(vesselName).split(/\s+/).filter(Boolean).map((word) => word.replace(/[^A-Z0-9]/g, '').charAt(0)).join('')
  return `${initials}${asciiUpper(voyageNumber).replace(/[^A-Z0-9]/g, '')}`
}

/**
 * Nome do arquivo no padrão do sistema externo (`FWL_MERCANTE_<número>.TXT`) com a
 * sigla do navio e da viagem no fim. ponytail: o número é o instante da geração
 * (AAAAMMDDHHMM), único e sem gravação; se a geração passar a ser registrada no
 * Histórico, o número pode virar uma sequência própria.
 */
export function mercanteFileName(vesselName: string, voyageNumber: string, now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
  return `FWL_MERCANTE_${stamp}_${mercanteFileTag(vesselName, voyageNumber)}.TXT`
}

// --- montagem ------------------------------------------------------------

type Ctx = { issues: MercanteEdiIssue[] }

function block(ctx: Ctx, ref: string | null, message: string) {
  ctx.issues.push({ severity: 'impedimento', ref, message })
}

function warn(ctx: Ctx, ref: string | null, message: string) {
  ctx.issues.push({ severity: 'aviso', ref, message })
}

function checkHeader(ctx: Ctx, header: MercanteEdiHeader) {
  if (!header.carrierCode) block(ctx, null, 'Armador sem código Mercante: o código da empresa de navegação vai no cabeçalho do manifesto.')
  if (!date8(header.closingDate)) block(ctx, null, `Sem ATD no POL ${header.pol}: a data de encerramento do manifesto vem dele (Rotas e Manifestos → Editar).`)
  if (!date8(header.operationDate)) block(ctx, null, `Sem ETA no POD ${header.pod}: a data da operação vem dela.`)
  if (!header.vesselImo) block(ctx, null, 'Navio sem IMO no cadastro.')
  else if (!VESSEL_IMO.test(vesselImoDigits(header.vesselImo))) block(ctx, null, `IMO do navio "${header.vesselImo}" não tem 7 dígitos (cadastro do navio).`)
  if (!header.voyageNumber.trim()) block(ctx, null, 'Viagem sem número.')
  if (!header.terminalCode && header.terminalDepot) {
    block(ctx, null, `Terminal ${header.terminalDepot} do POD ${header.pod} sem código Mercante: o código precisa entrar na tabela de terminais do Vela.`)
  } else if (!header.terminalCode) {
    block(ctx, null, `Sem terminal de descarga no POD ${header.pod}: defina o terminal da frente de operação desta carga na escala.`)
  } else if (!MERCANTE_TERMINAL_CODES.has(header.terminalCode)) {
    block(ctx, null, `Terminal ${header.terminalCode} não existe na tabela de terminais do Mercante.`)
  }
  const pol = mercantePortCode(header.pol)
  const pod = mercantePortCode(header.pod)
  if (!MERCANTE_PORT_CODES.has(pol)) block(ctx, null, `Porto de origem ${pol} não existe na tabela de portos do Mercante.`)
  if (pol.startsWith('BR')) block(ctx, null, `Porto de origem ${pol} é brasileiro: o manifesto de Longo Curso Importação sai de porto estrangeiro.`)
  if (!pod.startsWith('BR') || !MERCANTE_PORT_CODES.has(pod)) block(ctx, null, `Porto de destino ${pod} não é um porto brasileiro da tabela do Mercante.`)
}

function vesselImoDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

function buildM5(header: MercanteEdiHeader, blCount: number, emptyCount: number | null): string {
  const record = blank(M5_LENGTH)
  put(record, 1, 'M5', 2)
  put(record, 3, digits(blCount, 4), 4)
  if (emptyCount !== null) put(record, 7, digits(emptyCount, 4), 4)
  put(record, 11, header.carrierCode ?? '', 14)
  put(record, 25, documentDigits(COMPANY.cnpj), 14)
  put(record, 39, date8(header.closingDate), 8)
  put(record, 47, date8(header.operationDate), 8)
  put(record, 55, mercantePortCode(header.pol), 5)
  put(record, 60, mercantePortCode(header.pod), 5)
  put(record, 65, header.voyageNumber.trim(), 10)
  put(record, 75, vesselImoDigits(header.vesselImo), 10)
  // 85–124: terminais de carregamento, só para porto brasileiro (origem é estrangeira).
  put(record, 125, header.terminalCode ?? '', 8)
  return record.join('')
}

function buildC5(ctx: Ctx, header: MercanteEdiHeader, bl: MercanteEdiBl): string {
  const ref = bl.id
  const record = blank(C5_LENGTH)
  const consignee = cleanMercanteText(bl.consigneeBlock, 'party')
  const consigneeCnpj = documentDigits(bl.consigneeCnpj)
  if (TO_ORDER.test(asciiUpper(bl.consigneeBlock))) {
    block(ctx, ref, 'B/L à ordem: o manifesto pede outro preenchimento (sem CNPJ), ainda não feito pelo Vela.')
  }
  if (!consignee) block(ctx, ref, 'Sem bloco do consignatário — reimporte o arquivo do B/L.')
  // ponytail: CPF (11) só tem o tamanho conferido; o CNPJ passa pelos dígitos verificadores.
  if (consigneeCnpj.length !== 14 && consigneeCnpj.length !== 11) block(ctx, ref, 'Sem CNPJ/CPF do consignatário — reimporte o arquivo do B/L.')
  else if (consigneeCnpj.length === 14 && !isValidCnpj(consigneeCnpj)) block(ctx, ref, `CNPJ do consignatário ${consigneeCnpj} inválido (dígitos verificadores) — corrija na ficha do B/L.`)
  if (bl.id.length > BL_ID_LENGTH) block(ctx, ref, `Número do B/L com mais de ${BL_ID_LENGTH} caracteres não cabe no Mercante.`)
  const shipper = cleanMercanteText(bl.shipperBlock, 'party')
  if (!shipper) block(ctx, ref, 'Sem bloco do embarcador (shipper) — reimporte o arquivo do B/L.')
  if (!date8(bl.emissionDate)) block(ctx, ref, 'Sem data de emissão do B/L.')
  if (consignee.length > PARTY_LENGTH) warn(ctx, ref, `Consignatário cortado em ${PARTY_LENGTH} caracteres.`)

  const sameAsConsignee = SAME_AS_CONSIGNEE.test(bl.notifyBlock ?? '') || !(bl.notifyBlock ?? '').trim()
  const notify = sameAsConsignee ? consignee : cleanMercanteText(bl.notifyBlock, 'party')
  const notifyCnpj = sameAsConsignee ? consigneeCnpj : documentDigits(bl.notifyCnpj)

  const trailer = bl.totalPackages ? ` TOTAL: ${bl.totalPackages} ${cleanMercanteText(bl.packagesUnit, 'description')}`.trimEnd() : ''
  if (!bl.totalPackages) warn(ctx, ref, 'Sem total de volumes: a descrição sai sem "TOTAL:".')
  const fullDescription = `${cleanMercanteText(bl.description, 'description')}${trailer}`.trim()
  if (!fullDescription) block(ctx, ref, 'Sem descrição da carga.')
  const [description, rest] = splitAtWord(fullDescription, DESCRIPTION_LENGTH)
  const [observations, lost] = splitAtWord(rest, OBSERVATIONS_LENGTH)
  if (lost) warn(ctx, ref, `Descrição longa: ${lost.length} caracteres não cabem na descrição e nas observações e ficaram de fora.`)

  const oceanFreight = bl.freightLines.filter((line) => freightCategory(line) === 'OCEAN_FREIGHT')
  const freightAmount = oceanFreight.reduce((total, line) => total + (line.amount ?? 0), 0)
  // O C5 tem uma moeda e um prepaid/collect para o frete básico: linhas de
  // Ocean Freight em moedas ou pagamentos diferentes não podem ser somadas.
  const distinct = (values: Array<string | null>) => new Set(values.map((value) => (value ?? '').trim().toUpperCase())).size
  if (distinct(oceanFreight.map((line) => line.currency)) > 1 || distinct(oceanFreight.map((line) => paymentCode(line.payment))) > 1) {
    block(ctx, ref, 'Ocean Freight em mais de uma moeda ou com prepaid e collect misturados: o manifesto tem um só frete básico.')
  }
  const freightCurrency = MERCANTE_CURRENCY[(oceanFreight[0]?.currency ?? '').toUpperCase()] ?? null
  const freightPayment = paymentCode(oceanFreight[0]?.payment ?? null)
  if (!(freightAmount > 0)) block(ctx, ref, 'Sem valor do frete marítimo (OCEAN FREIGHT) maior que zero.')
  if (oceanFreight.length && !freightCurrency) block(ctx, ref, `Moeda do frete ${oceanFreight[0]?.currency ?? '(vazia)'} sem código Mercante.`)
  if (oceanFreight.length && !freightPayment) block(ctx, ref, 'Frete marítimo sem prepaid/collect.')
  const modality = mercanteFreightModality(bl.movementFrom)
  if (!modality) block(ctx, ref, `Type of Movement "${bl.movementFrom ?? ''}" não é FCL ou LCL: a modalidade do frete vem dele.`)

  const pod = mercantePortCode(header.pod)
  const uf = BRAZILIAN_PORT_UF[pod] ?? null
  if (!uf) block(ctx, ref, `Sem UF para o porto ${pod}.`)
  const terminal = bl.terminalCode ?? header.terminalCode ?? ''
  if (bl.terminalDepot && !bl.terminalCode) block(ctx, ref, `Terminal ${bl.terminalDepot} da exceção do B/L sem código Mercante: o código precisa entrar na tabela de terminais do Vela.`)
  if (bl.terminalCode && !MERCANTE_TERMINAL_CODES.has(bl.terminalCode)) block(ctx, ref, `Terminal ${bl.terminalCode} do B/L não existe na tabela do Mercante.`)

  put(record, 1, 'C5', 2)
  put(record, 3, digits(bl.containers.length, 4), 4)
  put(record, 7, bl.id.toUpperCase(), 18)
  put(record, 25, 'N', 1) // BL à ordem
  put(record, 26, 'N', 1) // entrega no exterior
  put(record, 29, 'N', 1) // consignatário estrangeiro
  put(record, 30, consignee, PARTY_LENGTH)
  put(record, 368, consigneeCnpj, 14)
  put(record, 382, shipper, PARTY_LENGTH)
  put(record, 635, date8(bl.emissionDate), 8)
  put(record, 643, description, DESCRIPTION_LENGTH)
  put(record, 1149, observations, OBSERVATIONS_LENGTH)
  put(record, 1402, amount(ctx, ref, 'Cubagem do B/L', bl.totalCbm, 13, 3), 13)
  put(record, 1415, mercantePortCode(header.pol), 5)
  put(record, 1420, pod, 5)
  put(record, 1425, notifyCnpj, 14)
  put(record, 1439, notify, PARTY_LENGTH)
  put(record, 1740, '00000000', 8) // data do BL do primeiro transporte
  put(record, 1748, amount(ctx, ref, 'Ocean Freight', freightAmount, 13, 2), 13)
  put(record, 1761, freightCurrency ?? '', 3)
  put(record, 1764, freightPayment ?? '', 1)
  put(record, 1765, modality ?? '', 2)
  put(record, 1767, 'I', 1) // categoria da carga: importada
  put(record, 1768, uf ?? '', 2)
  put(record, 1770, terminal, 8)
  put(record, 1778, mercantePortCode(header.pol).slice(0, 2), 2)
  put(record, 1780, 'N', 1) // BL de serviço
  put(record, 1781, '0'.repeat(15), 15) // CE original (só BL de serviço)

  const components = bl.freightLines.filter((line) => freightCategory(line) !== 'OCEAN_FREIGHT')
  if (components.length > MAX_FREIGHT_COMPONENTS) block(ctx, ref, `Mais de ${MAX_FREIGHT_COMPONENTS} despesas: o manifesto tem lugar para ${MAX_FREIGHT_COMPONENTS}.`)
  for (let slot = 0; slot < MAX_FREIGHT_COMPONENTS; slot += 1) {
    const position = 3797 + slot * 20
    const line = components[slot]
    if (!line) {
      put(record, position, '0'.repeat(19), 19)
      continue
    }
    const category = freightCategory(line)
    const code = MERCANTE_FREIGHT_COMPONENT[category]
    const currency = MERCANTE_CURRENCY[(line.currency ?? '').toUpperCase()]
    const payment = paymentCode(line.payment)
    if (!code) block(ctx, ref, `Despesa "${line.description ?? category}" sem código de componente do frete no Mercante.`)
    if (!currency) block(ctx, ref, `Despesa "${line.description ?? category}" em moeda sem código Mercante (${line.currency ?? 'vazia'}).`)
    if (!payment) block(ctx, ref, `Despesa "${line.description ?? category}" sem prepaid/collect.`)
    put(record, position, code ?? '000', 3)
    put(record, position + 3, currency ?? '000', 3)
    put(record, position + 6, amount(ctx, ref, `Despesa "${line.description ?? category}"`, line.amount, 13, 2), 13)
    put(record, position + 19, payment ?? '', 1)
  }
  return record.join('')
}

function buildI5(ctx: Ctx, bl: MercanteEdiBl, container: MercanteEdiContainer, sequence: number, ncm: string[]): string {
  const ref = `${bl.id} · ${container.number}`
  const record = blank(ITEM_LENGTH)
  const type = mercanteContainerType(container.type)
  if (!type) block(ctx, ref, `Tipo de contêiner ${container.type ?? '(vazio)'} sem código Mercante na tabela de tipos.`)
  if (container.grossKg === null || container.grossKg === undefined) block(ctx, ref, 'Contêiner sem peso bruto.')
  if (container.tareKg === null || container.tareKg === undefined) block(ctx, ref, 'Contêiner sem tara.')
  if (container.cbm === null || container.cbm === undefined) block(ctx, ref, 'Contêiner sem cubagem.')
  const containerSeals = seals(container.seal)
  if (!containerSeals.length) warn(ctx, ref, 'Contêiner sem lacre: o Mercante bloqueia a carga se o lacre não for informado até a atracação.')
  if (containerSeals.length > MAX_SEALS) warn(ctx, ref, `Mais de ${MAX_SEALS} lacres: só os ${MAX_SEALS} primeiros entram.`)
  if (!CONTAINER_NUMBER.test(container.number)) block(ctx, ref, 'Número do contêiner fora do padrão ISO (4 letras e 7 dígitos).')
  const unNumber = (container.unNumber ?? '').replace(/\D/g, '')
  if (container.isImo && (!unNumber || !container.imoClass)) block(ctx, ref, 'Contêiner IMO sem número ONU ou classe.')

  put(record, 1, 'I5', 2)
  put(record, 3, '1', 1) // tipo do item: contêiner
  put(record, 4, digits(sequence, 4), 4)
  put(record, 8, amount(ctx, ref, 'Peso bruto', container.grossKg, 12, 3), 12)
  put(record, 20, type ?? '', 4)
  put(record, 24, container.number.toUpperCase(), 11)
  put(record, 35, amount(ctx, ref, 'Tara', container.tareKg, 9, 3), 9)
  put(record, 44, container.shared ? 'S' : ' ', 1)
  if (container.isImo && unNumber) {
    put(record, 449, unNumber.padStart(6, '0').slice(-6), 6)
    put(record, 455, asciiUpper(container.imoClass).trim(), 4)
  }
  put(record, 459, amount(ctx, ref, 'Cubagem', container.cbm, 13, 3), 13)
  containerSeals.slice(0, MAX_SEALS).forEach((seal, index) => put(record, 472 + index * 15, seal, 15))
  ncm.slice(0, MAX_NCM).forEach((code, index) => put(record, 532 + index * 8, code, 8))
  return record.join('')
}

function repeated(values: string[]): string[] {
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const value of values) (seen.has(value) ? twice : seen).add(value)
  return [...twice]
}

function finish(ctx: Ctx, lines: string[]): MercanteEdiResult {
  const blocked = ctx.issues.some((issue) => issue.severity === 'impedimento')
  const content = blocked ? null : `${BOM}${lines.map((line) => `${line}${EOL}`).join('')}`
  return { content, issues: ctx.issues }
}

/** EDI de carga em contêiner de uma rota (M5 + C5/I5 por B/L). */
export function buildMercanteCargoEdi(header: MercanteEdiHeader, bls: MercanteEdiBl[]): MercanteEdiResult {
  const ctx: Ctx = { issues: [] }
  checkHeader(ctx, header)
  if (!bls.length) block(ctx, null, 'A rota não tem B/L ativo de container.')
  if (bls.length > 9999) block(ctx, null, 'Mais de 9999 B/Ls no manifesto.')

  const sorted = [...bls].sort((left, right) => left.id.localeCompare(right.id))
  const lines = [buildM5(header, sorted.length, null)]
  for (const bl of sorted) {
    lines.push(buildC5(ctx, header, bl))
    if (!bl.containers.length) block(ctx, bl.id, 'B/L sem contêiner.')
    for (const number of repeated(bl.containers.map((container) => container.number))) {
      block(ctx, `${bl.id} · ${number}`, 'Contêiner repetido no mesmo B/L.')
    }
    const ncm = mercanteNcmPositions(bl.ncmCodes)
    if (!ncm.length) block(ctx, bl.id, 'B/L sem NCM (campo NCM da ficha do B/L).')
    if (ncm.length > MAX_NCM) warn(ctx, bl.id, `Mais de ${MAX_NCM} NCMs: só os ${MAX_NCM} primeiros entram.`)
    bl.containers.forEach((container, index) => lines.push(buildI5(ctx, bl, container, index + 1, ncm)))
  }
  return finish(ctx, lines)
}

/** EDI de contêineres vazios de uma rota (M5 sem conhecimento + V5). */
export function buildMercanteVaziosEdi(header: MercanteEdiHeader, vazios: MercanteEdiVazio[]): MercanteEdiResult {
  const ctx: Ctx = { issues: [] }
  checkHeader(ctx, header)
  if (!vazios.length) block(ctx, null, 'A rota não tem contêiner vazio.')
  if (vazios.length > 9999) block(ctx, null, 'Mais de 9999 vazios no manifesto.')

  for (const number of repeated(vazios.map((vazio) => vazio.number))) block(ctx, number, 'Contêiner vazio repetido na rota.')
  const lines = [buildM5(header, 0, vazios.length)]
  vazios.forEach((vazio, index) => {
    const ref = vazio.number
    const type = mercanteContainerType(vazio.type)
    if (!type) block(ctx, ref, `Tipo de contêiner ${vazio.type ?? '(vazio)'} sem código Mercante na tabela de tipos.`)
    if (vazio.tareKg === null || vazio.tareKg === undefined) block(ctx, ref, 'Vazio sem tara.')
    if (!CONTAINER_NUMBER.test(vazio.number)) block(ctx, ref, 'Número do contêiner fora do padrão ISO (4 letras e 7 dígitos).')
    const record = blank(ITEM_LENGTH)
    put(record, 1, 'V5', 2)
    put(record, 3, digits(index + 1, 4), 4)
    put(record, 7, type ?? '', 4)
    put(record, 11, vazio.number.toUpperCase(), 11)
    put(record, 22, amount(ctx, ref, 'Tara', vazio.tareKg, 9, 3), 9)
    lines.push(record.join(''))
  })
  return finish(ctx, lines)
}
