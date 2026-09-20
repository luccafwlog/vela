/**
 * Converts an ISO 6346 size/type code to the operational TEU equivalent.
 * Unknown/non-standard codes intentionally remain unknown instead of being
 * counted as zero: the report must surface the reconciliation gap.
 */
export function teuForContainerType(type: string | null | undefined): number | null {
  const normalized = String(type ?? '').trim().toUpperCase().replace(/[\s-]/g, '')
  if (!normalized) return null
  if (/^45/.test(normalized)) return 2.25
  if (/^40/.test(normalized)) return 2
  if (/^20/.test(normalized)) return 1
  return null
}
export function calculateTeu(types: Array<string | null | undefined>) {
  return types.reduce(
    (result, type) => {
      const teu = teuForContainerType(type)
      if (teu == null) result.unknownTypeCount += 1
      else result.teu += teu
      return result
    },
    { teu: 0, unknownTypeCount: 0 },
  )
}
