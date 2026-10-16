/** Caixa "Mostrar inativas" das Tarifas de Demurrage; o estado vem de `useShowInactive`. */
export function ShowInactiveToggle({ checked, onChange, label, hiddenCount }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  /** Quantas ficam escondidas com o filtro desligado. */
  hiddenCount: number
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}{!checked && hiddenCount > 0 ? ` (${hiddenCount})` : ''}
    </label>
  )
}
