import type { FormEvent } from 'react'
import { BlOperacionalTab } from './BlOperacionalTab'
import { BlCargaTab, type ContainerSummary, type BreakbulkSummary } from './BlCargaTab'
import { BlFreightSection, type BlFreightLine } from './BlFreightSection'
import type { BlForm } from '../../hooks/useBlEditForm'
import type { CargoMode } from '../../pages/blDetalheHelpers'
import type { BLDetail } from '../../types/database'

export function BlDetalhesTab(props: {
  active: boolean
  bl: BLDetail
  blId?: string
  form: BlForm
  changes: (keyof BlForm)[]
  saving: boolean
  justification: string
  cargoMode: CargoMode
  isContainerMode: boolean
  containerSummary: ContainerSummary
  breakbulkSummary: BreakbulkSummary
  onFieldChange: <K extends keyof BlForm>(field: K, value: BlForm[K] | string) => void
  onJustificationChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
}) {
  if (!props.active) return null
  return (
    <div className="grid gap-5">
      <BlOperacionalTab
        active
        bl={props.bl}
        form={props.form}
        changes={props.changes}
        saving={props.saving}
        justification={props.justification}
        cargoMode={props.cargoMode}
        isContainerMode={props.isContainerMode}
        onFieldChange={props.onFieldChange}
        onJustificationChange={props.onJustificationChange}
        onSubmit={props.onSubmit}
      />
      <BlCargaTab
        active
        bl={props.bl}
        blId={props.blId}
        cargoMode={props.cargoMode}
        isContainerMode={props.isContainerMode}
        containerSummary={props.containerSummary}
        breakbulkSummary={props.breakbulkSummary}
      />
      {props.isContainerMode ? (
        <BlFreightSection freightLines={(props.bl.bl_freight_lines ?? []) as BlFreightLine[]} />
      ) : null}
    </div>
  )
}
