// A base de aplicação explica a quantidade ("por container", "por tonelada").
// Vem do cadastro do item e chega crua; o rótulo só a torna legível, sem
// inventar significado para valores que o cadastro ainda não conhece. O
// vocabulário é o mesmo do CHECK de charge_table_items (migration 016) e do
// motor de cálculo (274): 'bl', 'container_distinct_voyage', 'weight_ton',
// 'teu' — não os per_* que a UI tinha inventado.
const APPLICATION_BASIS_LABEL: Record<string, string> = {
  bl: 'por B/L',
  container_distinct_voyage: 'por container',
  weight_ton: 'por tonelada',
  teu: 'por TEU',
}

export function applicationBasisLabel(basis: string | null | undefined) {
  const key = (basis ?? '').trim().toLowerCase()
  if (!key) return null
  return APPLICATION_BASIS_LABEL[key] ?? key.replace(/_/g, ' ')
}
