import { useCallback, useMemo, useState } from 'react'
import { normalizeText } from '../../lib/utils'
import { useVoyageOptions } from '../../hooks/useBls'
import { Combobox, type ComboOption } from '../ui/Combobox'

type VoyageOption = {
  id: number
  voyage_number: string
  vessel?: { name: string } | null
}

type BaseProps = {
  label?: string
  initialValue?: string
  selectedVoyageId?: number | string | null
  placeholder?: string
  disabled?: boolean
  onSelect: (voyageId: number | null) => void
}

type VoyageComboboxProps = BaseProps & (
  | { required: true; clearable?: false }
  | { clearable: true; required?: false }
)

export function VoyageCombobox({
  label = 'Navio / Viagem',
  initialValue,
  selectedVoyageId = null,
  placeholder = 'Busque por navio ou viagem',
  disabled = false,
  required,
  clearable,
  onSelect,
}: VoyageComboboxProps) {
  const { data: voyages = [] } = useVoyageOptions()
  const isClearable = Boolean(clearable)
  const [manualText, setManualText] = useState<string | null>(null)

  const options = useMemo(
    () => voyages.map(toComboOption),
    [voyages],
  )
  const selectedInitialValue = useMemo(() => {
    if (initialValue != null) return initialValue
    if (selectedVoyageId == null || selectedVoyageId === '') return ''
    return options.find((option) => option.value === String(selectedVoyageId))?.label ?? ''
  }, [initialValue, options, selectedVoyageId])
  const resetKey = `${selectedVoyageId ?? ''}-${selectedInitialValue}`
  const [comboKey, setComboKey] = useState(resetKey)
  const [lastResetKey, setLastResetKey] = useState(resetKey)

  if (manualText == null && lastResetKey !== resetKey) {
    setComboKey(resetKey)
    setLastResetKey(resetKey)
  }

  const fetchOptions = useCallback(async (query: string) => {
    const term = normalizeText(query)
    if (!term) return options

    return options.filter((option) =>
      normalizeText(`${option.label} ${option.meta ?? ''}`).includes(term),
    )
  }, [options])

  const handleValueChange = useCallback((value: string) => {
    if (required || isClearable) {
      setManualText(value)
      onSelect(null)
    }
    void value
  }, [isClearable, onSelect, required])

  const handleSelectOption = useCallback((option: ComboOption) => {
    setManualText(null)
    setComboKey(`${option.value}-${option.label}`)
    setLastResetKey(`${option.value}-${option.label}`)
    onSelect(Number(option.value))
  }, [onSelect])

  return (
    <Combobox
      key={comboKey}
      label={label}
      initialValue={selectedInitialValue}
      placeholder={placeholder}
      onValueChange={handleValueChange}
      fetchOptions={fetchOptions}
      onSelectOption={handleSelectOption}
      minChars={required ? 1 : 0}
      refreshKey={options.length}
      disabled={disabled}
    />
  )
}

function toComboOption(voyage: VoyageOption): ComboOption {
  const vesselName = voyage.vessel?.name?.trim() || 'Navio não informado'
  const voyageNumber = voyage.voyage_number.trim()

  return {
    value: String(voyage.id),
    label: `${vesselName} / ${voyageNumber}`,
    meta: voyageNumber,
  }
}
