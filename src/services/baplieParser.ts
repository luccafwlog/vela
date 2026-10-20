import { assertUploadFile } from '../lib/fileGuard'
import { isValidIsoContainerNumber, normalizeIsoContainerNumber } from '../lib/containerNumber'
import { ownershipFromEquipmentSupplier, type ContainerOwnership } from '../lib/containerOwnership'
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
  /** EQD 8077: 1 = SOC, 2 = COC; vazio = não informado */
  ownership?: ContainerOwnership | null
  /**
   * NAD+CA do container (operador). Não vai ao staging: a regra da Viagem
   * (`applyBaplieVoyageRules`) usa para ignorar container de outro operador.
   */
  operator?: string | null
}

export type ParsedBaplie = {
  vessel_name: string | null
  /**
   * De onde veio o nome do navio: `identification` = 4º componente do C222
   * (identificação do transporte), o único que bloqueia navio diferente;
   * `heuristic` = palpite (nome do armador no C040 ou último composto
   * alfabético), que só gera aviso.
   */
  vessel_name_source?: 'identification' | 'heuristic' | null
  voyage_number: string | null
  /**
   * Operador do cabeçalho (TDT, ou o NAD+CA mais frequente quando o TDT não
   * traz). Só é a referência de "outro operador" quando nenhum container do
   * arquivo está nos B/Ls da Viagem (ADR 0079, decisão 6).
   */
  operator?: string | null
  containers: BaplieContainer[]
  pods: string[]
  issues: ImportIssue[]
  encoding: ImportTextEncoding
}

// Em ordem de preferência. O SMDG 1.5 costuma mandar LOC+6/LOC+12 e o 2.2
// LOC+9/LOC+11; um arquivo que traga os dois fica com o porto de embarque (9)
// e de descarga (11), seja qual for a ordem dos segmentos.
const POL_QUALIFIERS = ['9', '6'] as const
const POD_QUALIFIERS = ['11', '12'] as const
const FINAL_DEST_QUALIFIERS = ['83'] as const
const WEIGHT_QUALIFIERS = new Set(['WT', 'VGM'])
const SLOT_QUALIFIER = '147'
// C222 (identificação do transporte): indicativo de chamada (103) ou nº IMO
// (146), agência e o NOME do navio no 4º componente.
const TRANSPORT_ID_QUALIFIERS = new Set(['103', '146'])
// DIM de excesso (5 = frente, 6 = trás, 7 = direita, 8 = esquerda, 9 = altura).
// DIM+1 (dimensões brutas) e demais medidas não são excesso.
const OOG_DIM_QUALIFIERS = new Set(['5', '6', '7', '8', '9'])

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
  let vessel_name_source: ParsedBaplie['vessel_name_source'] = null
  let voyage_number: string | null = null
  let tdtCarrier: string | null = null

  for (const seg of contentSegments) {
    if (seg.tag !== 'TDT') continue
    voyage_number = seg.components[2]?.[0]?.trim() || null
    // TDT 3127 (carrier): operador do cabeçalho, reserva da regra de outro operador da Viagem.
    tdtCarrier = seg.components[5]?.[0]?.trim().toUpperCase() || tdtCarrier
    const flat = seg.components.flat().map((c) => c.trim()).filter(Boolean)
    // Identificação do transporte (C222): call sign:código:agência:NOME. O C222 é
    // o composto com qualificador 103/146 (há dialeto que o põe fora do 8º
    // elemento) ou, sem qualificador, o 8º elemento do padrão.
    const transportId = seg.components.find((c, index) => index >= 3 && TRANSPORT_ID_QUALIFIERS.has((c[1] ?? '').trim()))
      ?? seg.components[8]
    const identified = transportId?.[3]?.trim() || null
    // ponytail: sem nome no C222, cai no 4º componente de outro composto (o C040
    // traz ali o nome do ARMADOR) e depois no último composto alfabético (pode
    // ser o call sign). Serve para mostrar e avisar; não bloqueia (E9-03).
    const named = seg.components.map((c) => c[3]?.trim()).find(Boolean)
    const vessel = identified ?? named ?? [...flat].reverse().find((part) => /[A-Z]/.test(part) && part !== '20')
    if (vessel && vessel !== voyage_number) {
      vessel_name = vessel.replace(/:/g, ' ').trim() || null
      vessel_name_source = vessel_name ? (identified ? 'identification' : 'heuristic') : null
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
    if (seg.tag === 'LOC' || seg.tag === 'MEA' || seg.tag === 'RFF' || seg.tag === 'EQD' || seg.tag === 'DIM' || seg.tag === 'DGS' || seg.tag === 'NAD') {
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
  const ignored: Array<{ container_number: string; reason: 'transshipment' | 'unknown_pod'; group: number; pod?: string | null }> = []
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
    existing.ownership = existing.ownership ?? next.ownership
    if (next.operator) existing.operator = next.operator
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
      const polRaw = rawPort(ownItems, POL_QUALIFIERS)
      const podRaw = rawPort(ownItems, POD_QUALIFIERS)
      const ownFinal = lastPort(ownItems, FINAL_DEST_QUALIFIERS)
      const useDeliveryAsPod = !ownPod.code && ownFinal.recognized && Boolean(ownFinal.code)
      const ownBl = lastValue(ownItems.filter((i) => i.tag === 'RFF' && (i.components[1]?.[0] ?? '') === 'BM').map((i) => i.components[1]?.[1]?.trim() || null))
      const weightValues = ownItems
        .filter((i) => i.tag === 'MEA' && WEIGHT_QUALIFIERS.has((i.components[1]?.[0] ?? '').trim()))
        .map((i) => parseWeight(i, delimiters))
      const ownWeightResult = lastValue(weightValues)
      const ownWeight = ownWeightResult?.value ?? null
      const ownOog = ownItems.some((i) => i.tag === 'DIM' && hasOogDims(i, delimiters))
      // Carga LQ (quantidade limitada) é carga normal: só o DGS em LQ deixa de
      // marcar IMO; outro DGS do mesmo container continua valendo.
      const dgsSegments = ownItems.filter((i) => i.tag === 'DGS')
      const isLimitedQuantity = (i: ParsedSegment) => i.components.flat().some((part) => part.trim().toUpperCase() === 'LQ')
      const limitedQuantity = dgsSegments.some(isLimitedQuantity)
      const dgs = lastValue(dgsSegments.filter((i) => !isLimitedQuantity(i)).map((i) => parseDgs(i)))
      const ownOperator = lastValue(ownItems.filter((i) => i.tag === 'NAD' && (i.components[1]?.[0] ?? '').trim() === 'CA')
        .map((i) => i.components[2]?.[0]?.trim().toUpperCase() || null))
      // EQD 8249 = 6: em transbordo, não descarrega nesta operação.
      const equipmentStatus = (eqd.components[5]?.[0] ?? '').trim()
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

      if (!isValidIsoContainerNumber(container_number)) {
        issues.push({
          row: group.order,
          field: 'container_number',
          code: 'invalid_iso',
          severity: 'warning',
          message: `Container ${container_number}: dígito verificador não confere (ISO 6346); confira o número com o armador.`,
        })
      }
      if (limitedQuantity) {
        issues.push({
          row: group.order,
          field: 'is_imo',
          code: 'invalid_group',
          severity: 'warning',
          message: dgs
            ? `Container ${container_number}: DGS em quantidade limitada (LQ) desconsiderado; o IMO vem dos demais DGS (classe ${dgs.imo_class ?? '—'}).`
            : `Container ${container_number}: carga LQ (quantidade limitada) tratada como carga normal, sem IMO.`,
        })
      }
      if (equipmentStatus === '6') {
        ignored.push({ container_number, reason: 'transshipment', group: group.order })
        return
      }
      // POD informado mas fora dos portos conhecidos (ex.: UYMVD): o container
      // não descarga nesta operação e sai com aviso, como o filtro de escalas
      // (ADR 0078, item 21). Só o arquivo sem nenhum container restante bloqueia.
      if (podRaw && !ownPod.recognized && !useDeliveryAsPod) {
        ignored.push({ container_number, reason: 'unknown_pod', group: group.order, pod: podRaw })
        return
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
        pod: useDeliveryAsPod ? ownFinal.code : ownPod.code,
        final_dest: ownFinal.code,
        bl_ref: ownBl,
        slot: group.slot,
        is_imo: Boolean(dgs),
        imo_class: dgs?.imo_class ?? null,
        un_number: dgs?.un_number ?? null,
        is_oog: ownOog,
        // EQD 8077 (equipment supplier) mora no elemento 4, antes do 8249.
        ownership: ownershipFromEquipmentSupplier(eqd.components[4]?.[0]),
        ...(ownOperator ? { operator: ownOperator } : {}),
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
      if (!fullEmptyCode || !['4', '5'].includes(fullEmptyCode)) {
        issues.push({
          row: group.order,
          field: 'status',
          code: 'invalid_group',
          severity: 'error',
          message: `Container ${container_number}: indicador cheio/vazio (EQD 8169) ausente ou inválido no conjunto ${group.order}.`,
        })
      }
      if (eqdPos === 0 && (!ownPol.code || !ownPol.recognized)) {
        issues.push({
          row: group.order,
          field: 'pol',
          code: 'unknown_port',
          severity: 'error',
          message: `Container ${container_number}: POL ${polRaw ? `não reconhecido (${polRaw})` : 'ausente'} no conjunto ${group.order}.`,
        })
      }
      if (useDeliveryAsPod || (eqdPos === 0 && !ownPod.code)) {
        issues.push({
          row: group.order,
          field: 'pod',
          code: 'unknown_port',
          severity: useDeliveryAsPod ? 'warning' : 'error',
          message: `Container ${container_number}: POD ${podRaw ? `não reconhecido (${podRaw})` : 'ausente'} no conjunto ${group.order}.${useDeliveryAsPod ? ` Utilizado o local de entrega ${ownFinal.code} (LOC+83) como porto de descarga; confira a descarga real.` : ''}`,
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

  // Operador do cabeçalho: o do TDT ou, sem ele, o NAD+CA mais frequente. O
  // filtro de outro operador mora na regra da Viagem (ADR 0079, decisão 6),
  // que conhece os containers dos B/Ls; este é só a reserva dela.
  // ponytail: a maioria decide quando o TDT não traz o operador; um navio com
  // slot dividido meio a meio fica com o primeiro mais frequente.
  const counts = new Map<string, number>()
  for (const container of containers) {
    if (container.operator) counts.set(container.operator, (counts.get(container.operator) ?? 0) + 1)
  }
  const operator = tdtCarrier ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  for (const item of ignored) {
    if (item.reason === 'unknown_pod') {
      issues.push({
        row: item.group,
        field: 'pod',
        code: 'unknown_port',
        severity: 'warning',
        message: `Container ${item.container_number}: porto de descarga não reconhecido (${item.pod}); fora das escalas, ignorado.`,
      })
      continue
    }
    issues.push({
      row: item.group,
      field: 'container_number',
      code: 'invalid_group',
      severity: 'warning',
      message: `Container ${item.container_number}: em transbordo (EQD 8249 = 6); ignorado nesta operação.`,
    })
  }
  if (!containers.length && ignored.length) {
    issues.push({
      row: 0,
      field: 'container_number',
      code: 'invalid_group',
      severity: 'error',
      message: `Nenhum container a importar: ${ignored.length === 1 ? 'o único container do arquivo foi ignorado' : `os ${ignored.length} containers do arquivo foram ignorados`} (avisos acima).`,
    })
  }

  const pods = Array.from(new Set(containers.map((c) => c.pod).filter((p): p is string => Boolean(p)))).sort()
  return { vessel_name, vessel_name_source, voyage_number, operator, containers, pods, issues, encoding: 'utf-8' }
}

function lastValue<T>(values: Array<T | null>): T | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== null && values[i] !== undefined) return values[i] as T
  }
  return null
}

type ParsedPort = { code: string | null; recognized: boolean }

/** Último LOC do qualificador preferido; o seguinte só quando o anterior falta. */
function rawPort(items: ParsedSegment[], qualifiers: readonly string[]): string | null {
  for (const qualifier of qualifiers) {
    const value = lastValue(items
      .filter((item) => item.tag === 'LOC' && qualifierOf(item) === qualifier)
      .map(locCodeOf))
    if (value) return value
  }
  return null
}

function lastPort(items: ParsedSegment[], qualifiers: readonly string[]): ParsedPort {
  const raw = rawPort(items, qualifiers)
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

// OOG só com excesso de dimensão maior que zero (ADR 0078, item 21): só os
// qualificadores de excesso contam, e o primeiro componente do DIM é a
// unidade (ex.: CMT), não uma medida.
function hasOogDims(segment: ParsedSegment, delimiters: Delimiters): boolean {
  if (!OOG_DIM_QUALIFIERS.has(qualifierOf(segment))) return false
  const dimsRaw = segment.rawElements[2] ?? ''
  const dims = splitRespectingRelease(dimsRaw, delimiters.component, delimiters.release)
  return dims.some((d) => {
    const value = Number(d.trim().replace(',', '.'))
    return d.trim() !== '' && Number.isFinite(value) && value > 0
  })
}

function parseDgs(segment: ParsedSegment): { imo_class: string | null; un_number: string | null } {
  const classPart = segment.components[2]?.[0] ?? ''
  return {
    imo_class: classPart.trim() || null,
    un_number: (segment.components[3]?.[0] ?? '').trim() || null,
  }
}
