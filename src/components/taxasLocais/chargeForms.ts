// Tipos e estados iniciais dos formulários de Taxas Locais. Ficam separados dos
// componentes de tab para satisfazer a regra react-refresh (um arquivo só com
// componentes) e permitir reuso entre página e tabs.

export type LocalChargeTab = 'tabelas' | 'overrides'

export type CargoModeFilter = '' | 'container' | 'carga_solta' | 'granito'

export type OverrideForm = {
  id: number | null
  customerId: string
  chargeItemId: string
  overrideValue: string
  validFrom: string
  validTo: string
  notes: string
}

export type ChargeTableForm = {
  id: number | null
  name: string
  cargoMode: 'container' | 'carga_solta' | 'granito'
  pod: string
  validFrom: string
  validTo: string
  active: boolean
  notes: string
}

export type ChargeTableItemForm = {
  id: number | null
  chargeTableId: string
  name: string
  category: 'base' | 'other_charge'
  applicationBasis: 'bl' | 'container_distinct_voyage' | 'weight_ton' | 'teu'
  cargoProfile: 'standard' | 'imo' | 'oog' | 'any'
  currency: 'BRL' | 'USD'
  unitValue: string
  manualOnly: boolean
  /** false: o motor não conta containers SOC (Drop Off, Damage Protection) */
  appliesToSoc: boolean
  active: boolean
  sortOrder: string
}

export const EMPTY_OVERRIDE_FORM: OverrideForm = {
  id: null,
  customerId: '',
  chargeItemId: '',
  overrideValue: '',
  validFrom: '',
  validTo: '',
  notes: '',
}

export const EMPTY_TABLE_FORM: ChargeTableForm = {
  id: null,
  name: '',
  cargoMode: 'container',
  pod: '',
  validFrom: '',
  validTo: '',
  active: true,
  notes: '',
}

export const EMPTY_TABLE_ITEM_FORM: ChargeTableItemForm = {
  id: null,
  chargeTableId: '',
  name: '',
  category: 'base',
  applicationBasis: 'bl',
  cargoProfile: 'any',
  currency: 'BRL',
  unitValue: '',
  manualOnly: false,
  appliesToSoc: true,
  active: true,
  sortOrder: '100',
}

export type ChargeFilterProps = {
  cargoModeFilter: CargoModeFilter
  setCargoModeFilter: (value: CargoModeFilter) => void
  podFilter: string
  setPodFilter: (value: string) => void
}
