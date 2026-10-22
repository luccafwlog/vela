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
