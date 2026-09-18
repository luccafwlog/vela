import type { FormEvent } from 'react'
import { BlOperacionalTab } from './BlOperacionalTab'
import { BlFreightSection, type BlFreightLine } from './BlFreightSection'
import type { BlForm } from '../../hooks/useBlEditForm'
import type { CargoMode } from '../../pages/blDetalheHelpers'
import type { BLDetail } from '../../types/database'

// Formulário de edição manual e frete. O conteúdo de carga (contêineres, resumo
// de carga solta, itens e veículos) saiu daqui para a aba própria `Carga`.
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
  hasContainers: boolean
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
        hasContainers={props.hasContainers}
        onFieldChange={props.onFieldChange}
        onJustificationChange={props.onJustificationChange}
        onSubmit={props.onSubmit}
      />
      {props.hasContainers ? (
        <BlFreightSection freightLines={(props.bl.bl_freight_lines ?? []) as BlFreightLine[]} />
      ) : null}
    </div>
  )
}
