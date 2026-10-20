import { Field, Select } from '../ui/Input'
import { CARGO_MODE_OPTIONS } from './chargePresentation'
import type { ChargeFilterProps } from './chargeForms'

// Granito não tem taxa (lote 5b): sai do filtro, embora o banco ainda aceite o modo.
const FILTER_MODE_OPTIONS = CARGO_MODE_OPTIONS.filter((option) => option.value !== 'granito')

/**
 * Modo de carga e POD, compartilhados pelas duas abas. POD é escolha entre os
 * cadastrados (não texto livre): BRVIX e BRVIT caem no mesmo escopo, como no
 * motor.
 */
export function ChargeScopeFilters({
  cargoModeFilter,
  setCargoModeFilter,
  podFilter,
  setPodFilter,
  pods,
}: ChargeFilterProps & { pods: string[] }) {
  const options = podFilter && !pods.includes(podFilter) ? [...pods, podFilter] : pods
  return (
    <>
      <Field label="Modo de carga">
        <Select value={cargoModeFilter} onChange={(event) => setCargoModeFilter(event.target.value as ChargeFilterProps['cargoModeFilter'])}>
          <option value="">Todos</option>
          {FILTER_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </Field>
      <Field label="POD">
        <Select value={podFilter} onChange={(event) => setPodFilter(event.target.value)}>
          <option value="">Todos</option>
          {options.map((pod) => <option key={pod} value={pod}>{pod}</option>)}
        </Select>
      </Field>
    </>
  )
}
