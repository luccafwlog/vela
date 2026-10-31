import { normalizeVesselImo } from '../lib/vesselAlias'
import { escalaPortCode, knownPorts, normalizePortCode } from './portCode'
import { z } from 'zod'
import { listVoyageEscalaSchedulesByVoyageIds } from './voyageRouteSchedules'

export const DEFAULT_CARRIER_NAME = 'Cosco Shipping Specialized Carriers'
export const DEFAULT_CARRIER_SCAC = 'CSSC'

export type VoyageFormValues = {
  carrierName: string
  carrierScac: string
  vesselName: string
  vesselImo: string
  voyageNumber: string
  status: 'active' | 'completed' | 'cancelled'
  indicatedFirstBrazilianPort?: string | null
  indicatedFirstBrazilianEta?: string | null
}

export const initialVoyageFormValues: VoyageFormValues = {
  carrierName: DEFAULT_CARRIER_NAME,
  carrierScac: DEFAULT_CARRIER_SCAC,
  vesselName: '',
  vesselImo: '',
  voyageNumber: '',
  status: 'active',
  indicatedFirstBrazilianPort: null,
  indicatedFirstBrazilianEta: null,
}

export const voyageFormSchema = z.object({
  carrierName: z.string().min(2, 'Armador obrigatorio (min. 2 caracteres)'),
  carrierScac: z.string(),
  vesselName: z.string().min(2, 'Navio obrigatorio (min. 2 caracteres)'),
  vesselImo: z.string(),
  voyageNumber: z.string().min(1, 'Numero da viagem obrigatorio'),
  status: z.enum(['active', 'completed', 'cancelled']),
  indicatedFirstBrazilianPort: z.string().nullable().optional(),
  indicatedFirstBrazilianEta: z.string().nullable().optional(),
}).superRefine((data, ctx) => {
  const imo = normalizeVesselImo(data.vesselImo)
  if (imo && !/^\d{7}$/.test(imo)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['vesselImo'],
      message: 'IMO deve ter 7 dígitos',
    })
  }
  const hasIndicatedPort = Boolean(data.indicatedFirstBrazilianPort?.trim())
  const hasIndicatedEta = Boolean(data.indicatedFirstBrazilianEta?.trim())

  if (hasIndicatedPort && !hasIndicatedEta) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['indicatedFirstBrazilianEta'],
      message: 'Informe o ETA do 1º porto brasileiro indicado',
    })
  }
  if (!hasIndicatedPort && hasIndicatedEta) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['indicatedFirstBrazilianPort'],
      message: 'Informe o 1º porto brasileiro indicado',
    })
  }
})

export type VoyageFormErrors = Partial<Record<keyof VoyageFormValues, string>>

export function normalizeVoyageFormValues(values: VoyageFormValues): VoyageFormValues {
  const port = values.indicatedFirstBrazilianPort?.trim().toUpperCase() || null
  const eta = values.indicatedFirstBrazilianEta?.trim() || null
  return {
    ...values,
    carrierName: values.carrierName.trim(),
    carrierScac: values.carrierScac.trim().toUpperCase(),
    vesselName: values.vesselName.trim().toUpperCase(),
    vesselImo: values.vesselImo.trim(),
    voyageNumber: values.voyageNumber.trim().toUpperCase(),
    indicatedFirstBrazilianPort: port && eta ? port : null,
    indicatedFirstBrazilianEta: port && eta ? eta : null,
  }
}

/** Validação que depende do estado persistido das Escalas da viagem. */
export async function validateIndicatedFirstBrazilianPort(values: VoyageFormValues, voyageId: number | undefined) {
  const port = values.indicatedFirstBrazilianPort?.trim()
  const eta = values.indicatedFirstBrazilianEta?.trim()
  if (!port || !eta) return null
  if (!voyageId) return 'A indicação só pode ser ativada depois que a viagem tiver uma escala.'

  const schedules = (await listVoyageEscalaSchedulesByVoyageIds([voyageId])).get(voyageId) ?? []
  const activeSchedules = schedules.filter((schedule) => !schedule.deleted && schedule.temImportacao)
  if (!activeSchedules.length) return 'A indicação exige a existência de ao menos uma Escala própria na viagem.'
  const etas = activeSchedules.map((schedule) => schedule.eta).filter((value): value is string => Boolean(value))
  if (!etas.length) return null
  const minEta = [...etas].sort()[0]
  if (eta >= minEta) return `O ETA indicado (${eta}) deve ser anterior ao menor ETA das escalas próprias (${minEta})`
  return null
}

/**
 * Porto adicionado na Nova Viagem. Origem (`pol`) grava o ETD do POL, que
 * aparece em Chegadas e Saídas; destino (`pod`) cria a escala da Viagem com o
 * ETA (a escala é sempre num porto brasileiro).
 */
export type VoyagePortStop = {
  code: string
  kind: 'pol' | 'pod'
  /** Data ISO (AAAA-MM-DD). */
  date: string
}

const KNOWN_PORTS = knownPorts()

/** Sugestões de cada seletor: portos do exterior na origem, do Brasil no destino. */
export const VOYAGE_PORT_SUGGESTIONS: Record<VoyagePortStop['kind'], Array<{ code: string; name: string | null }>> = {
  pol: KNOWN_PORTS.filter((port) => !port.code.startsWith('BR')),
  pod: KNOWN_PORTS.filter((port) => port.code.startsWith('BR')),
}

/** Nome e LOCODE do porto ("Qingdao (CNTAO)"), ou só o código sem nome. */
export function voyagePortLabel(code: string): string {
  const name = KNOWN_PORTS.find((port) => port.code === code)?.name
  return name ? `${name} (${code})` : code
}

/**
 * Porto digitado num dos seletores da Nova Viagem, conferido contra o lado
 * escolhido pelo operador. Destino: porto brasileiro, conhecido ou qualquer
 * LOCODE BR bem formado (`escalaPortCode`, a regra do modal da Escala; o
 * servidor cadastra o porto novo). Origem: porto do exterior que o sistema
 * reconhece, porque LOCODE de origem desconhecido não é gravado.
 * ponytail: a lista de origens é a de `portCode.ts`; porto novo (Busan, por
 * exemplo) entra nela, e o upgrade é um cadastro de LOCODE completo.
 */
export function resolveVoyagePortStop(value: string, kind: VoyagePortStop['kind']): { code: string } | { error: string } {
  const typed = value.trim().toUpperCase()
  if (!typed) return { error: 'Informe o porto.' }
  const brazilian = escalaPortCode(typed)
  const known = normalizePortCode(typed)
  if (kind === 'pod') {
    if (brazilian?.startsWith('BR')) return { code: brazilian }
    if (known) return { error: `${known} não é porto brasileiro. O destino cria a escala, que é sempre no Brasil; porto do exterior vai em Origem.` }
    return { error: 'Porto brasileiro não reconhecido: use o nome ou o LOCODE com BR e mais 3 caracteres (ex.: SALVADOR, BRSSZ).' }
  }
  if (brazilian?.startsWith('BR') || known?.startsWith('BR')) {
    return { error: 'Porto brasileiro vai em Destino: ele cria a escala da viagem.' }
  }
  if (known) return { code: known }
  return { error: 'Porto de origem fora da lista de portos do sistema. Escolha um dos sugeridos (ex.: QINGDAO, CNTAO).' }
}
