import { supabase, supabasePortal } from './supabase'
import type { PortalSessionOverview } from './portalBilling'
import { PORTAL_WRITE_CONTRACTS, resolvePortalRpcName, type PortalContract } from './portalRpcContracts'

export type PortalScope = {
  mode: 'client' | 'inspect'
  customerId: number | null
  overview: PortalSessionOverview | null
  basePath: string
}

export const clientPortalScope: PortalScope = {
  mode: 'client',
  customerId: null,
  overview: null,
  basePath: '/portal',
}

export const portalWriteRpcNames: ReadonlySet<string> = new Set<string>(PORTAL_WRITE_CONTRACTS)

export function isPortalReadOnly(scope: Pick<PortalScope, 'mode'>): boolean {
  return scope.mode === 'inspect'
}

export function portalPath(scope: PortalScope, suffix = '') {
  if (!suffix) return scope.basePath
  return `${scope.basePath}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
}

export function inspectionRpcArgs(scope: PortalScope, args: Record<string, unknown> = {}) {
  return scope.mode === 'inspect' ? { p_customer_id: scope.customerId, ...args } : args
}

export async function openPortalInspection(customerId: number, origin: string | null) {
  const { data, error } = await supabase.rpc('portal_open_inspection', {
    p_customer_id: customerId,
    ...(origin == null ? {} : { p_origin: origin }),
  })
  if (error) throw error
  return data as PortalSessionOverview
}

export async function callPortalRpc<T = unknown>(scope: PortalScope, name: PortalContract, args: Record<string, unknown> = {}) {
  const client = scope.mode === 'inspect' ? supabase : supabasePortal
  const rpcName = resolvePortalRpcName(scope.mode, name)
  // portal_ship_schedule isn't customer-scoped (no portal_inspect_ variant
  // exists), so it keeps its name and its zero-arg signature in inspect mode too.
  const isShipSchedule = name === 'portal_ship_schedule'
  const rpc = (client as unknown as { rpc: (rpc: string, params?: Record<string, unknown>) => Promise<{ data: T | null; error: unknown }> }).rpc
  const rpcArgs = isShipSchedule ? args : inspectionRpcArgs(scope, args)
  const result = Object.keys(rpcArgs).length
    ? await rpc.call(client, rpcName, rpcArgs)
    : await rpc.call(client, rpcName)
  if (result.error) throw result.error
  return result.data
}
