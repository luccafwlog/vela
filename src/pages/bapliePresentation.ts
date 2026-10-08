// Apresentação da Conciliação Baplie × B/L em /baplie. Só traduz o resultado
// de `reconcileBaplieWithManifest` (regra em services/baplieReconciliation.ts)
// em situação, cobertura e próxima ação; nenhuma regra de conciliação vive aqui.
import {
  normalizeContainerNumber,
  routeKey as baplieRouteKey,
  type BaplieReconciliationResult,
} from '../services/baplieReconciliation'

type StagedRow = {
  container_number: string
  status: string | null
  pol: string | null
  pod: string | null
}

export type ReconciliationState =
  /** Viagem sem B/L: não há documento para comparar. */
  | 'no_bls'
  /** Ainda lendo B/Ls ou a conciliação. */
  | 'loading'
  | 'error'
  /** Há B/Ls, mas nenhuma rota de cheios do Baplie tem B/L com containers. */
  | 'awaiting_route_coverage'
  | 'divergent'
  | 'clean'

export type ReconciliationOverview = {
  state: ReconciliationState
  full: number
  empty: number
  /** Cheios do Baplie que entram na conciliação (rota com B/L). */
  inScope: number
  /** Cheios em conciliação que têm container de B/L correspondente. */
  covered: number
  missingInManifest: number
  missingInBaplie: number
  ownershipMismatch: number
  pendingRoutes: string[]
  /** Cheios fora da conciliação porque a rota ainda não tem B/L. */
  onPendingRoutes: number
}

// Mesmo critério do serviço: só `empty` fica fora; status ausente conta como cheio.
function isFull(row: StagedRow) {
  return row.status !== 'empty'
}

export function formatRouteKey(route: string) {
  const [pol, pod] = route.split('::')
  return `${pol} → ${pod}`
}

export function buildReconciliationOverview({
  staged,
  blsExist,
  reconciliation,
  loading,
  failed,
}: {
  staged: readonly StagedRow[]
  blsExist: boolean | undefined
  reconciliation: BaplieReconciliationResult | undefined
  loading: boolean
  failed: boolean
}): ReconciliationOverview {
  const fullRows = staged.filter(isFull)
  const empty = staged.length - fullRows.length
  const items = reconciliation?.items ?? []
  const pendingRoutes = reconciliation?.pendingRoutes ?? []
  const pending = new Set(pendingRoutes)
  const onPendingRoutes = fullRows.filter((row) => {
    const key = baplieRouteKey(row)
    return key !== null && pending.has(key)
  }).length
  const missingInManifest = items.filter((item) => item.kind === 'missing_in_manifest').length
  const missingInBaplie = items.filter((item) => item.kind === 'missing_in_baplie').length
  const ownershipMismatch = items.filter((item) => item.kind === 'ownership_mismatch').length
  const inScope = Math.max(0, fullRows.length - onPendingRoutes)

  let state: ReconciliationState
  if (failed) state = 'error'
  else if (blsExist === false) state = 'no_bls'
  else if (loading || blsExist === undefined || !reconciliation) state = 'loading'
  else if (reconciliation.source === 'awaiting_route_coverage') state = 'awaiting_route_coverage'
  else state = items.length ? 'divergent' : 'clean'

  return {
    state,
    full: fullRows.length,
    empty,
    inScope,
    covered: Math.max(0, inScope - missingInManifest),
    missingInManifest,
    missingInBaplie,
    ownershipMismatch,
    pendingRoutes,
    onPendingRoutes,
  }
}

export type RowCoverage = { label: string; tone: 'success' | 'warning' | 'neutral' | 'info'; key: CoverageFilter }
export type CoverageFilter = 'covered' | 'missing' | 'ownership' | 'out_of_scope' | 'empty'

export function indexReconciliation(reconciliation: BaplieReconciliationResult | undefined) {
  // O item de SOC/COC traz o número como está no B/L; o do Baplie pode vir com
  // outra grafia. A chave é o número normalizado, como na conciliação.
  return new Map((reconciliation?.items ?? []).map((item) => [normalizeContainerNumber(item.container_number), item.kind]))
}

/**
 * Situação de um container do Baplie na conciliação, em texto. `null` quando
 * a conciliação ainda não tem resultado (carregando ou erro).
 */
export function describeRowCoverage(
  row: StagedRow,
  overview: ReconciliationOverview,
  reconciliation: BaplieReconciliationResult | undefined,
  index: ReadonlyMap<string, string> = indexReconciliation(reconciliation),
): RowCoverage | null {
  if (!isFull(row)) return { label: 'Fora da conciliação', tone: 'neutral', key: 'empty' }
  if (overview.state === 'no_bls') return { label: 'Viagem sem B/L', tone: 'neutral', key: 'out_of_scope' }
  if (!reconciliation || overview.state === 'loading' || overview.state === 'error') return null
  const key = baplieRouteKey(row)
  if (overview.state === 'awaiting_route_coverage' || (key !== null && overview.pendingRoutes.includes(key))) {
    return { label: 'Fora · rota sem B/L', tone: 'neutral', key: 'out_of_scope' }
  }
  const kind = index.get(normalizeContainerNumber(row.container_number))
  if (kind === 'missing_in_manifest') return { label: 'Sem B/L', tone: 'warning', key: 'missing' }
  if (kind === 'ownership_mismatch') return { label: 'Com B/L · SOC/COC diverge', tone: 'warning', key: 'ownership' }
  return { label: 'Com B/L', tone: 'success', key: 'covered' }
}
