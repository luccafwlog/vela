import type { ReactNode } from 'react'
import { NoValue } from '../ui/NoValue'

/** Contêiner como a lista de BLs e a ficha do B/L o leem para a carga. */
export type CargoContainer = {
  ownership?: string | null
  gross_weight_kg?: number | string | null
  cbm?: number | string | null
  return_date?: string | null
}

type BreakbulkFields = {
  bb_machine_qty?: number | string | null
  bb_packages_qty?: number | string | null
  bb_packages_total?: number | string | null
  bb_weight_ton?: number | string | null
  bb_cbm?: number | string | null
}

export /** "2 contêineres · 2 COC · 48.500 kg · 112,5 m³ · 1 de 2 devolvido". */
function containerSummary(containers: CargoContainer[]) {
  const soc = containers.filter((container) => container.ownership === 'SOC').length
  const coc = containers.length - soc
  const weight = containers.reduce((sum, container) => sum + Number(container.gross_weight_kg ?? 0), 0)
  const cbm = containers.reduce((sum, container) => sum + Number(container.cbm ?? 0), 0)
  const returned = containers.filter((container) => container.ownership !== 'SOC' && container.return_date).length
  const parts = [
    `${containers.length} ${containers.length === 1 ? 'contêiner' : 'contêineres'}`,
    [coc ? `${coc} COC` : '', soc ? `${soc} SOC` : ''].filter(Boolean).join(' · '),
    weight ? `${weight.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg` : '',
    cbm ? `${cbm.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 3 })} m³` : '',
    coc ? `${returned} de ${coc} ${returned === 1 ? 'devolvido' : 'devolvidos'}` : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

export function hasBreakbulkData(bl: BreakbulkFields) {
  return [bl.bb_machine_qty, bl.bb_packages_qty, bl.bb_packages_total, bl.bb_weight_ton, bl.bb_cbm].some((value) => value != null)
}

export function formatOptionalText(value: number | string) {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

export function formatOptionalNumber(value: number | string | null | undefined, emptyLabel: string): ReactNode {
  if (value === null || value === undefined || value === '') return <NoValue label={emptyLabel} />
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : <NoValue label={emptyLabel} />
}
