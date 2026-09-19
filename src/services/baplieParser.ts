import { assertUploadFile } from '../lib/fileGuard'
import { normalizeIsoContainerNumber } from '../lib/containerNumber'
import { parseImportNumber } from '../lib/importNumber'
import { resolvePortCode } from './portCode'
import { decodeImportBytes, detectImportFormat, type ImportTextEncoding } from './importText'
import type { ImportIssue } from './importValidation'

export type BaplieContainer = {
  container_number: string
  size_type: string | null
  status: 'full' | 'empty'
  weight_kg: number | null
  pol: string | null
  pod: string | null
  final_dest: string | null
  bl_ref: string | null
  slot: string | null
  is_imo: boolean
  imo_class: string | null
  un_number: string | null
  is_oog: boolean
}

export type ParsedBaplie = {
  vessel_name: string | null
  voyage_number: string | null
  containers: BaplieContainer[]
  pods: string[]
  issues: ImportIssue[]
  encoding: ImportTextEncoding
}

const POL_QUALIFIERS = new Set(['6', '9'])
const POD_QUALIFIERS = new Set(['11', '12'])
const FINAL_DEST_QUALIFIERS = new Set(['83'])
const WEIGHT_QUALIFIERS = new Set(['WT', 'VGM'])
const SLOT_QUALIFIER = '147'

type Delimiters = { component: string; element: string; release: string; terminator: string }

function parseDelimiters(text: string): { delimiters: Delimiters; body: string } {
  const bodyText = text.replace(/^\uFEFF/, '').trimStart()
  if (bodyText.startsWith('UNA') && bodyText.length >= 9) {
    const chars = bodyText.slice(3, 9)
    return {
      delimiters: {
        component: chars[0] ?? ':',
        element: chars[1] ?? '+',
        release: chars[3] ?? '?',
        terminator: chars[5] ?? "'",
      },
      body: bodyText.slice(9),
    }
  }
  return { delimiters: { component: ':', element: '+', release: '?', terminator: "'" }, body: bodyText }
}

function splitRespectingRelease(input: string, delimiter: string, release: string): string[] {
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (char === release && i + 1 < input.length) {
      current += input[i + 1]
      i += 1
      continue
    }
    if (char === delimiter) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

function splitSegments(body: string, delimiters: Delimiters): string[] {
  const segments: string[] = []
  let current = ''
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]
    if (char === delimiters.release && i + 1 < body.length) {
      current += char + body[i + 1]!
      i += 1
      continue
    }
    if (char === delimiters.terminator) {
      if (current.trim()) segments.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) segments.push(current.trim())
  return segments
}

type ParsedSegment = { tag: string; rawElements: string[]; components: string[][] }

function parseSegment(seg: string, delimiters: Delimiters): ParsedSegment {
  const rawElements = splitRespectingRelease(seg, delimiters.element, delimiters.release)
  const components = rawElements.map((el) => splitRespectingRelease(el, delimiters.component, delimiters.release))
  return { tag: (components[0]?.[0] ?? '').trim().toUpperCase(), rawElements, components }
}

function qualifierOf(segment: ParsedSegment): string {
  return (segment.components[1]?.[0] ?? '').trim()
}

function locCodeOf(segment: ParsedSegment): string | null {
  const code = (segment.components[2]?.[0] ?? '').trim()
  return code || null
}

export class BaplieParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BaplieParseError'
  }
}

export async function parseBaplieInWorker(buffer: ArrayBuffer): Promise<ParsedBaplie> {
  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker(new URL('./baplieWorker.ts', import.meta.url), { type: 'module' })
      const timeoutId = setTimeout(() => {
        worker.terminate()
        reject(new Error('Tempo limite de processamento do Baplie excedido no Web Worker (60s).'))
      }, 60_000)

      worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: ParsedBaplie; error?: string }>) => {
        clearTimeout(timeoutId)
        worker.terminate()
        if (event.data.ok && event.data.result) {
          resolve(event.data.result)
        } else {
          reject(new BaplieParseError(event.data.error || 'Falha no processamento do Baplie pelo Web Worker.'))
        }
      }

      worker.onerror = (error) => {
        clearTimeout(timeoutId)
        worker.terminate()
        const message = error instanceof ErrorEvent ? error.message : 'Falha na execução do Web Worker de Baplie'
        reject(new Error(message))
      }

      // Transferência de posse (zero-copy) do clone para a thread do Worker,
      // preservando o buffer original do chamador em caso de fallback de infraestrutura.
      const transferCopy = buffer.slice(0)
      worker.postMessage(transferCopy, [transferCopy])
    } catch (err) {
      reject(err)
    }
  })
}

export async function parseBaplieFile(file: File): Promise<ParsedBaplie> {
  assertUploadFile(file, ['edi', 'txt', 'edi2', 'bpl'])
  const buffer = await file.arrayBuffer()

  if (typeof Worker !== 'undefined') {
    try {
      return await parseBaplieInWorker(buffer)
    } catch (err) {
      // Se o worker processou o arquivo e detectou erro de validação/formato,
      // propaga o erro imediatamente em vez de reprocessar o mesmo arquivo inválido na main thread.
      if (err instanceof BaplieParseError) {
        throw err
      }
      // Fallback gracioso para a thread principal apenas em falhas de infraestrutura do Worker (CSP, inicialização)
    }
  }

  return parseBaplieBuffer(buffer)
}

export function parseBaplieBuffer(buffer: ArrayBuffer): ParsedBaplie {
  const format = detectImportFormat(buffer, { allowWindows1252Fallback: true })
  if (format !== 'edi') throw new Error('Arquivo Baplie não reconhecido como EDI.')
  const decoded = decodeImportBytes(buffer, { allowWindows1252Fallback: true })
  const parsed = parseBaplieText(decoded.text)
  return { ...parsed, encoding: decoded.encoding }
}

export function parseBaplieText(text: string): ParsedBaplie {
  const { delimiters, body } = parseDelimiters(text)
  const rawSegments = splitSegments(body, delimiters)
  const segments = rawSegments.map((seg, index) => ({ ...parseSegment(seg, delimiters), index }))
  const terminalIndex = segments.findLastIndex(({ tag }) => tag === 'UNZ' || tag === 'UNE') >= 0
    ? segments.findLastIndex(({ tag }) => tag === 'UNZ' || tag === 'UNE')
    : segments.findLastIndex(({ tag }) => tag === 'UNT')
  const contentSegments = terminalIndex >= 0 ? segments.slice(0, terminalIndex) : segments
  const trailingSegments = terminalIndex >= 0
    ? segments.slice(terminalIndex + 1).filter(({ tag }) => tag !== 'UNT' && tag !== 'UNZ' && tag !== 'UNE')
    : []

  let vessel_name: string | null = null
  let voyage_number: string | null = null

  for (const seg of contentSegments) {
    if (seg.tag !== 'TDT') continue
    voyage_number = seg.components[2]?.[0]?.trim() || null
    const flat = seg.components.flat().map((c) => c.trim()).filter(Boolean)
    const vessel = [...flat].reverse().find((part) => /[A-Z]/.test(part) && part !== '20')
    // O nome é o último composto alfabético do TDT; o número da viagem já saiu acima.
    if (vessel && vessel !== voyage_number) {
      vessel_name = vessel.replace(/:/g, ' ').trim() || null
    }
  }

  type Group = { slot: string | null; items: ParsedSegment[]; order: number }
  const groups: Group[] = []
  let current: Group | null = null
  let groupOrder = 0

  const closeCurrent = () => {
    if (current) groups.push(current)
    current = null
  }

  for (const seg of contentSegments) {
    if (seg.tag === 'LOC' && qualifierOf(seg) === SLOT_QUALIFIER) {
      closeCurrent()
      groupOrder += 1
      current = { slot: locCodeOf(seg), items: [], order: groupOrder }
      continue
    }
    if (seg.tag === 'UNT' || seg.tag === 'UNZ' || seg.tag === 'UNE') {
      closeCurrent()
      continue
    }
    if (seg.tag === 'LOC' || seg.tag === 'MEA' || seg.tag === 'RFF' || seg.tag === 'EQD' || seg.tag === 'DIM' || seg.tag === 'DGS') {
      if (!current) {
        // Segmento de container antes do primeiro slot: grupo implícito sem slot
        // (cobre EDI sem LOC+147 e ordem EQD→LOC no início).
        if (seg.tag === 'EQD') {
          groupOrder += 1
          current = { slot: null, items: [], order: groupOrder }
        } else {
          continue
        }
      }
      current.items.push(seg)
      continue
    }
  }
  closeCurrent()

  const containers: BaplieContainer[] = []
  const issues: ImportIssue[] = []
  for (const segment of trailingSegments) {
    issues.push({
      row: segment.index + 1,
      field: 'eof',
      code: 'invalid_group',
      severity: 'error',
      message: `Segmento ${segment.tag || 'desconhecido'} encontrado após o trailer do EDI.`,
    })
  }
  const seen = new Map<string, number>()

  const upsert = (next: BaplieContainer) => {
    const existing = containers.find((c) => c.container_number === next.container_number)
    if (!existing) {
      containers.push(next)
      return next
    }
    existing.size_type = next.size_type ?? existing.size_type
    existing.status = existing.status === 'full' || next.status === 'full' ? 'full' : 'empty'
    existing.weight_kg = next.weight_kg ?? existing.weight_kg
    existing.pol = next.pol ?? existing.pol
    existing.pod = next.pod ?? existing.pod
    existing.final_dest = next.final_dest ?? existing.final_dest
    existing.bl_ref = next.bl_ref ?? existing.bl_ref
    existing.slot = next.slot ?? existing.slot
    existing.is_imo = existing.is_imo || next.is_imo
    existing.imo_class = existing.imo_class ?? next.imo_class
    existing.un_number = existing.un_number ?? next.un_number
    existing.is_oog = existing.is_oog || next.is_oog
    return existing
  }

  for (const group of groups) {
    const eqdIndices = group.items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.tag === 'EQD')
    if (eqdIndices.length === 0) {
      issues.push({
        row: group.order,
        field: 'slot',
        code: 'invalid_group',
        severity: 'error',
        message: `Conjunto físico ${group.order} (slot ${group.slot ?? 'sem slot'}) sem container EQD.`,
      })
      continue
    }

    eqdIndices.forEach(({ item: eqd }, eqdPos) => {
      const eqdIndex = eqdIndices[eqdPos]?.idx ?? 0
      const nextEqdIndex = eqdIndices[eqdPos + 1]?.idx ?? group.items.length
      // Campos antes do primeiro EQD pertencem à primeira unidade (dialeto
      // LOC→EQD). Depois de cada EQD, o trecho até o próximo EQD pertence
      // somente à unidade corrente; isso evita que DGS/DIM de uma unidade
      // contaminem a seguinte.
      const ownItems = [
        ...(eqdPos === 0 ? group.items.slice(0, eqdIndex) : []),
        ...group.items.slice(eqdIndex, nextEqdIndex),
      ]
      const ownPol = lastPort(ownItems, POL_QUALIFIERS)
      const ownPod = lastPort(ownItems, POD_QUALIFIERS)
      const ownFinal = lastPort(ownItems, FINAL_DEST_QUALIFIERS)
      const ownBl = lastValue(ownItems.filter((i) => i.tag === 'RFF' && (i.components[1]?.[0] ?? '') === 'BM').map((i) => i.components[1]?.[1]?.trim() || null))
      const weightValues = ownItems
        .filter((i) => i.tag === 'MEA' && WEIGHT_QUALIFIERS.has((i.components[1]?.[0] ?? '').trim()))
        .map((i) => parseWeight(i, delimiters))
      const ownWeightResult = lastValue(weightValues)
      const ownWeight = ownWeightResult?.value ?? null
      const ownOog = ownItems.some((i) => i.tag === 'DIM' && hasOogDims(i, delimiters))
      const dgs = lastValue(ownItems.filter((i) => i.tag === 'DGS').map((i) => parseDgs(i)))
      const rawNumber = (eqd.components[2]?.[0] ?? '').trim()
      const container_number = normalizeIsoContainerNumber(rawNumber)
      if (!container_number) {
        issues.push({
          row: group.order,
          field: 'container_number',
          code: 'invalid_group',
          severity: 'error',
          message: `Conjunto físico ${group.order}: número de container inválido (${rawNumber || 'ausente'}).`,
        })
        return
      }
      if (seen.has(container_number)) {
        issues.push({
          row: group.order,
          field: 'container_number',
          code: 'invalid_group',
          severity: 'error',
          message: `Container ${container_number} duplicado (conjuntos ${seen.get(container_number)} e ${group.order}).`,
        })
      } else {
        seen.set(container_number, group.order)
      }

      const size_type = eqd.components[3]?.[0]?.trim() || null
      // EQD 8169 (full/empty indicator) mora no elemento 6. O elemento 5 e
      // 8249 (equipment status coded) e responde a outra pergunta (ex.: '2'
      // = export, nao vazio); lê-lo como indicador de vazio confunde os
      // dois campos e classifica containers vazios como cheios sempre que o
      // 8249 vem preenchido (#P0-1). Ausencia do 8169 nao vira 'full' por
      // default: fica marcada e bloqueia a confirmacao.
      const fullEmptyCode = (eqd.components[6]?.[0] ?? '').trim()
      const status: BaplieContainer['status'] = fullEmptyCode === '4' ? 'empty' : 'full'

      // EQDs consecutivos no mesmo slot não herdam campos da unidade anterior;
      // cada unidade só recebe os segmentos do seu próprio trecho.
      const next: BaplieContainer = {
        container_number,
        size_type,
        status,
        weight_kg: ownWeight,
        pol: ownPol.code,
        pod: ownPod.code,
        final_dest: ownFinal.code,
        bl_ref: ownBl,
        slot: group.slot,
        is_imo: Boolean(dgs),
        imo_class: dgs?.imo_class ?? null,
        un_number: dgs?.un_number ?? null,
        is_oog: ownOog,
      }
      const created = upsert(next)
      // Garante que duplicata preserve atributos físicos (compat) sem herdar
      // POL/POD/peso para unidades distintas.
      if (seen.get(container_number) !== group.order) {
        created.is_oog = created.is_oog || next.is_oog
      }

      // O dialeto LOC→EQD pode colocar rota/peso uma única vez antes de EQDs
      // consecutivos. Preserve a validação histórica do conjunto no primeiro
      // equipamento, sem transformar a ausência de repetição nos seguintes em
      // uma troca silenciosa de atributos.
      if (eqdPos === 0 && !fullEmptyCode) {
        issues.push({
          row: group.order,
          field: 'status',
          code: 'invalid_group',
          severity: 'error',
          message: `Container ${container_number}: indicador cheio/vazio (EQD 8169) ausente no conjunto ${group.order}.`,
        })
      }
      if (eqdPos === 0 && (!ownPol.code || !ownPol.recognized)) {
        issues.push({
          row: group.order,
          field: 'pol',
          code: 'unknown_port',
          severity: 'error',
          message: `Container ${container_number}: POL ${ownPol.code ? 'não reconhecido' : 'ausente'} no conjunto ${group.order}.`,
        })
      }
      if (eqdPos === 0 && (!ownPod.code || !ownPod.recognized)) {
        issues.push({
          row: group.order,
          field: 'pod',
          code: 'unknown_port',
          severity: 'error',
          message: `Container ${container_number}: POD ${ownPod.code ? 'não reconhecido' : 'ausente'} no conjunto ${group.order}.`,
        })
      }
      if (eqdPos === 0 && ownWeightResult?.issue) {
        issues.push({
          row: group.order,
          field: 'weight_kg',
          code: 'invalid_number',
          severity: 'error',
          message: `Container ${container_number}: peso inválido no conjunto ${group.order}.`,
        })
      } else if (eqdPos === 0 && next.status === 'full' && next.weight_kg == null) {
        issues.push({
          row: group.order,
          field: 'weight_kg',
          code: 'invalid_number',
          severity: 'error',
          message: `Container ${container_number}: peso ausente no conjunto ${group.order}.`,
        })
      }
    })
  }

  const pods = Array.from(new Set(containers.map((c) => c.pod).filter((p): p is string => Boolean(p)))).sort()
  return { vessel_name, voyage_number, containers, pods, issues, encoding: 'utf-8' }
}

function lastValue<T>(values: Array<T | null>): T | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== null && values[i] !== undefined) return values[i] as T
  }
  return null
}

type ParsedPort = { code: string | null; recognized: boolean }

function lastPort(items: ParsedSegment[], qualifiers: ReadonlySet<string>): ParsedPort {
  const raw = lastValue(items
    .filter((item) => item.tag === 'LOC' && qualifiers.has(qualifierOf(item)))
    .map(locCodeOf))
  if (!raw) return { code: null, recognized: false }
  const resolved = resolvePortCode(raw)
  return { code: resolved.code, recognized: resolved.recognized }
}

type ParsedWeight = { value: number | null; issue: 'invalid' | null }

// Fator de conversao para kg pelo qualificador UN/ECE R20 (elemento 6411 do
// componente de medida). KGM e o unico que o staging grava sem conversao;
// TNE/LBR convertem; qualquer outro codigo e desconhecido e bloqueia — nunca
// grava um numero sem saber a que unidade ele se refere (#P0-2).
const WEIGHT_UNIT_TO_KG: Record<string, number> = {
  KGM: 1,
  TNE: 1000,
  LBR: 0.45359237,
}

function parseWeight(segment: ParsedSegment, delimiters: Delimiters): ParsedWeight {
  const valueField = segment.rawElements[3] ?? segment.rawElements[2] ?? ''
  const parts = splitRespectingRelease(valueField, delimiters.component, delimiters.release)
  // parts[0] e o qualificador de unidade (6411, ex.: KGM/TNE/LBR); parts[1] e
  // o valor. Descartar parts[0] e ler direto o valor faz um MEA em toneladas
  // gravar o numero cru como se fosse quilos (1000x menor que o real).
  const hasUnitField = parts.length >= 2
  const unit = hasUnitField ? parts[0]!.trim().toUpperCase() : ''
  const value = (hasUnitField ? parts[1] : parts[0])?.trim() ?? ''
  if (!value) return { value: null, issue: null }

  const parsed = parseImportNumber(value, 'en-US')
  if (parsed.kind !== 'value') return { value: null, issue: 'invalid' }
  const number = Number(parsed.decimal)
  if (!Number.isFinite(number) || number < 0) return { value: null, issue: 'invalid' }

  // Sem qualificador de unidade no segmento: dialeto legado que sempre
  // gravou o valor cru como kg. Mantido para nao quebrar staging historico
  // sem MEA tipado; com qualificador presente, ele e obrigatoriamente
  // reconhecido.
  if (!hasUnitField) return { value: number, issue: null }
  const factor = WEIGHT_UNIT_TO_KG[unit]
  if (factor === undefined) return { value: null, issue: 'invalid' }
  return { value: number * factor, issue: null }
}

function hasOogDims(segment: ParsedSegment, delimiters: Delimiters): boolean {
  const dimsRaw = segment.rawElements[2] ?? ''
  const dims = splitRespectingRelease(dimsRaw, delimiters.component, delimiters.release)
  return dims.some((d) => d.trim() !== '' && d.trim() !== '0')
}

function parseDgs(segment: ParsedSegment): { imo_class: string | null; un_number: string | null } {
  const classPart = segment.components[2]?.[0] ?? ''
  return {
    imo_class: classPart.trim() || null,
    un_number: (segment.components[3]?.[0] ?? '').trim() || null,
  }
}
