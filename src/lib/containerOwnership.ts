// Propriedade do container: COC (do armador) ou SOC (do cliente, "shipper
// owned"). SOC não volta ao estoque: não tem devolução nem Demurrage, e não
// paga as taxas marcadas como "não cobra de SOC" (Drop Off, Damage Protection).
// Sem informação, o container é tratado como COC.
export type ContainerOwnership = 'SOC' | 'COC'

/** Lê o texto do B/L ("SOC", "S.O.C.", "SHIPPER OWNED", "COC", "CARRIER OWNED"...). */
export function normalizeContainerOwnership(raw: string | null | undefined): ContainerOwnership | null {
  const text = String(raw ?? '').toUpperCase()
  const compact = text.replace(/[^A-Z]/g, '')
  if (compact === 'SOC' || /SHIPPER\s*OWN/.test(text)) return 'SOC'
  if (compact === 'COC' || /CARRIER\s*OWN/.test(text)) return 'COC'
  return null
}

/** EQD 8077 (equipment supplier) do Baplie: 1 = shipper supplied, 2 = carrier supplied. */
export function ownershipFromEquipmentSupplier(code: string | null | undefined): ContainerOwnership | null {
  const value = String(code ?? '').trim()
  if (value === '1') return 'SOC'
  if (value === '2') return 'COC'
  return null
}

export function isSocContainer(container: { ownership?: string | null }): boolean {
  return container.ownership === 'SOC'
}

export function containerOwnershipLabel(ownership: string | null | undefined): string {
  return ownership === 'SOC' || ownership === 'COC' ? ownership : 'Não informado'
}

export const CONTAINER_OWNERSHIP_SOURCE_LABELS: Record<string, string> = {
  bl: 'B/L',
  baplie: 'Baplie',
  manual: 'Correção manual',
}
