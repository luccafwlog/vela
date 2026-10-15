import { FIXTURE_CODE, FIXTURE_PREFIX, PROTECTED_TABLES, assertFixtureConfig } from './fixture-config.mjs'
import { normalizeCatalog } from './fixture-catalog.mjs'

const ORDER = [
  ['portal_notifications', 'id'], ['portal_provisioning_events', 'id'], ['ledger_settlements', 'id'],
  ['payments', 'id'], ['payments', 'payment_id'], ['invoice_receivable_links', 'id'], ['invoices', 'id'], ['invoices', 'invoice_id'],
  ['demurrage_invoice_items', 'id'], ['demurrage_invoices', 'id'], ['bl_transshipments', 'id'],
  ['voyage_omissions', 'id'], ['vehicles', 'id'], ['bl_containers', 'id'], ['granite_bls', 'id'],
  ['bls', 'id'], ['vazios_importacao_containers', 'id'], ['vazios_bookings', 'id'], ['vazios_bookings', 'manifest_id'],
  ['vazios_export_operations', 'id'], ['voyage_scales', 'id'], ['audit_logs', 'id'],
  ['demurrage_invoices', 'doc_number'],
  ['customer_portal_accounts', 'id'], ['voyages', 'id'], ['vessels', 'id'], ['customers', 'id'],
]

export function isSyntheticId(value, catalogIds = new Set()) {
  if (typeof value === 'string') return value.startsWith(FIXTURE_PREFIX) || value.startsWith(FIXTURE_CODE) || (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) && catalogIds.has(value))
  return catalogIds.has(value)
}

export function assertCleanupCatalog(catalog) {
  assertFixtureConfig()
  if (!catalog || catalog.prefix !== FIXTURE_PREFIX) throw new Error('fixture catalog prefix mismatch')
  const entries = normalizeCatalog(catalog)
  if (!entries.length) throw new Error('fixture catalog is empty')
  const catalogIds = new Set(entries.map((entry) => entry.id))
  for (const entry of entries) {
    if (!isSyntheticId(entry.id, catalogIds)) throw new Error(`identifier is outside fixture: ${entry.id}`)
  }
  return entries
}

function buildOperations(catalog, { createdOnly = false } = {}) {
  const entries = normalizeCatalog(catalog)
  const orderKeys = new Set(ORDER.map(([table, column]) => `${table}:${column}`))
  const uncovered = entries.filter((entry) => !orderKeys.has(`${entry.table}:${entry.column}`))
  if (uncovered.length) throw new Error(`cleanup order has no position for ${uncovered[0].table}.${uncovered[0].column}`)
  return ORDER.flatMap(([table, column]) => {
    const ids = entries.filter((entry) => entry.table === table && entry.column === column && (!createdOnly || entry.created === true)).map((entry) => entry.id)
    return ids.length ? [{ table, column, ids }] : []
  })
}

export async function cleanupFixture(client, catalog, { dryRun = true } = {}) {
  assertCleanupCatalog(catalog)
  const operations = buildOperations(catalog, { createdOnly: !dryRun })
  if (operations.some((operation) => PROTECTED_TABLES.includes(operation.table))) {
    throw new Error('cleanup plan contains a protected table')
  }
  if (dryRun) return { dryRun: true, operations }
  // ADR 0085 (migrations 106, 109, 231-240): nenhuma tabela desta ordem aceita
  // DELETE de `authenticated`; a exclusão é só pelas RPCs, com motivo e trava.
  // O dry-run segue como inventário; a remoção usa o procedimento de limpeza.
  if (operations.length) {
    throw new Error('A API não apaga mais as tabelas da fixture (exclusão só pelas RPCs, ADR 0085). Use o dry-run como inventário e docs/operations/reset-ambiente.md para remover.')
  }
  for (const operation of operations) {
    const query = client.from(operation.table).delete().in(operation.column, operation.ids)
    const result = query?.then ? await query : query
    if (result?.error) throw result.error
  }
  return { dryRun: false, operations }
}

if ((await import('./fixture-runtime.mjs')).isMain(import.meta.url, process.argv[1])) {
  const { authClient, readCatalog } = await import('./fixture-runtime.mjs')
  const { client } = await authClient()
  const destructive = process.argv.includes('--destructive')
  const result = await cleanupFixture(client, await readCatalog(), { dryRun: !destructive })
  console.log(JSON.stringify(result, null, 2))
}
