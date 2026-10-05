import { normalizePortCode } from './portCode'

// Read filters use the same Brazilian aliases as public.normalize_port_code.
// Preserve unknown codes: the import resolver's stricter allowlist is unsuitable
// for displaying an already persisted operational destination.
const aliases: Record<string, string> = {
  SSA: 'BRSSA', PEC: 'BRPEC', SSZ: 'BRSSZ', PNG: 'BRPNG',
  ITJ: 'BRITJ', NVT: 'BRITJ', BRNVT: 'BRITJ', RIG: 'BRRIG',
  SUA: 'BRSUA', BRREC: 'BRSUA', BRRDJ: 'BRRIO',
}
export function normalizeInformationPort(value: string | null | undefined): string | null {
  const raw = value?.trim().toUpperCase() || null
  return raw ? aliases[raw] ?? normalizePortCode(raw) ?? raw : null
}

/** Portos atendidos nas consultas de Taxas Locais e Devolução do Portal. */
export const portalServicePorts = [
  { code: 'BRVIX', name: 'Vitória' },
  { code: 'BRSSA', name: 'Salvador' },
  { code: 'BRSUA', name: 'Suape' },
]
export function isPortalServicePort(value: string | null | undefined): boolean {
  return portalServicePorts.some(port => port.code === normalizeInformationPort(value))
}
