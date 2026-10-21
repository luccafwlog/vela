import { normalizePortCode, normalizeStoredPortCode, STORED_PORT_ALIAS_VALUES } from './portCode'

// Read filters use the same aliases as public.normalize_port_code (BRNVT and
// BRREC are their own ports, ADR 0095 decision 12). Preserve unknown codes: the
// import resolver's stricter allowlist is unsuitable for displaying an already
// persisted operational destination.
const storedAliases = new Set(STORED_PORT_ALIAS_VALUES)
export function normalizeInformationPort(value: string | null | undefined): string | null {
  const raw = value?.trim().toUpperCase() || null
  if (!raw) return null
  return storedAliases.has(raw) ? normalizeStoredPortCode(raw) : normalizePortCode(raw) ?? raw
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
