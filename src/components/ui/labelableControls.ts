/**
 * Controles que repassam `id` ao `<input>`/`<select>`/`<textarea>`. O `Field`
 * só liga o rótulo por `htmlFor` a eles; os demais filhos continuam envolvidos
 * pelo `<label>`.
 */
const labelableControls = new Set<unknown>(['input', 'select', 'textarea'])

/** Registra um componente que repassa `id` ao elemento rotulável. */
export function markLabelableControl(type: unknown) {
  labelableControls.add(type)
}

export function isLabelableControl(type: unknown) {
  return labelableControls.has(type)
}
