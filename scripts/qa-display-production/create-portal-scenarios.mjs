import { FIXTURE_PREFIX, assertFixtureConfig } from './fixture-config.mjs'
import { requireIds } from './fixture-catalog.mjs'

async function rpc(client, name, payload) {
  const result = await client.rpc(name, payload)
  if (result?.error) throw result.error
  return result?.data ?? null
}

async function findRows(client, table, columns, predicate) {
  if (typeof client?.from !== 'function') return []
  const result = await predicate(client.from(table).select(columns))
  if (result?.error) throw result.error
  return result?.data ?? []
}

function requireFixture(fixture) {
  assertFixtureConfig()
  if (!fixture || fixture.prefix !== FIXTURE_PREFIX) throw new Error('fixture prefix mismatch')
  if (!fixture.userId || (fixture.customers?.length ?? 0) < 4) throw new Error('fixture requires four customers')
  const portalInvoices = (fixture.invoices ?? []).filter((invoice) => invoice.usedBy !== 'financial')
  if (portalInvoices.length < 4) throw new Error('fixture catalog requires four invoices not consumed by financial scenarios')
  requireIds(fixture, 'invoices')
}

function paymentId(result) {
  const id = result?.payment_id ?? result?.id
  if (id == null) throw new Error('payment RPC did not return a payment id')
  return id
}

async function openBalance(client, invoice) {
  const rows = await findRows(client, 'invoices', 'id,balance_due,total_amount,total_amount_brl,amount_paid', (query) => query.eq('id', invoice.id).limit(1))
  if (rows.length) {
    const row = rows[0]
    const balance = Number(row.balance_due ?? row.total_amount_brl ?? row.total_amount) - Number(row.amount_paid ?? 0)
    if (!Number.isFinite(balance) || balance <= 0) throw new Error(`invoice ${invoice.id} has no positive open balance`)
    return balance
  }
  const balance = Number(invoice.balance_brl ?? invoice.balance_due ?? 1)
  if (!Number.isFinite(balance) || balance <= 0) throw new Error(`invoice ${invoice.id} has no positive open balance`)
  return balance
}

export async function createPortalScenarios(client, fixture) {
  requireFixture(fixture)
  const existingAccounts = await findRows(client, 'customer_portal_accounts', 'id,customer_id,active,auth_user_id,contact_email,login_cnpj', (query) => query.in('customer_id', fixture.customers.slice(0, 4).map((customer) => customer.id)))
  const accountByCustomer = new Map(existingAccounts.map((account) => [account.customer_id, account]))
  // auth_user_id is intentionally absent: active=true is not a reachable state without provisioning auth.
  const accountStates = fixture.customers.slice(0, 4).map((customer) => ({ customerId: customer.id, active: Boolean(accountByCustomer.get(customer.id)?.auth_user_id) }))
  const invoices = fixture.invoices.filter((invoice) => invoice.usedBy !== 'financial').slice(0, 4)
  const balances = []
  for (const invoice of invoices) balances.push(await openBalance(client, invoice))

  const accounts = []
  // Só registra o estado das contas: a conta nasce pelo provisionamento (Edge
  // Functions); a RPC legada com senha própria saiu na migration 234.
  for (const state of accountStates) accounts.push(state)

  const event = await rpc(client, 'portal_return_to_analysis', {
    p_customer_id: fixture.customers[1].id, p_reason: `${FIXTURE_PREFIX} synthetic portal review`,
    p_actor_type: 'administrativo', p_request_id: 'QAD26-PORTAL-EVENT-001',
  })

  const reconciliations = []
  const exact = await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: invoices[0].id, p_amount_brl: balances[0], p_method: 'pix', p_pix_txid: 'QAD26-TEST-PIX-EXACT',
    p_source: 'pix_extract', p_notes: 'QAD26-TEST exact PIX', p_actor: fixture.userId,
  })
  reconciliations.push({ status: 'exact', paymentId: paymentId(exact), amountBrl: balances[0] })
  const partialAmount = Math.max(0.01, Math.min(balances[1] / 2, balances[1] - 0.01))
  const partial = await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: invoices[1].id, p_amount_brl: partialAmount, p_method: 'pix', p_pix_txid: null,
    p_source: 'manual', p_notes: 'QAD26-TEST partial payment', p_actor: fixture.userId,
  })
  reconciliations.push({ status: 'partial', paymentId: paymentId(partial), amountBrl: partialAmount })
  const overpaid = await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: invoices[2].id, p_amount_brl: balances[2] + 1, p_method: 'pix', p_pix_txid: null,
    p_source: 'manual', p_notes: 'QAD26-TEST overpayment', p_actor: fixture.userId,
  })
  reconciliations.push({ status: 'overpaid', paymentId: paymentId(overpaid), amountBrl: balances[2] + 1 })
  const reversible = await rpc(client, 'register_ledger_invoice_payment', {
    p_invoice_id: invoices[3].id, p_amount_brl: Math.min(1, balances[3]), p_method: 'pix', p_pix_txid: null,
    p_source: 'manual', p_notes: 'QAD26-TEST reversible payment', p_actor: fixture.userId,
  })
  const reversiblePaymentId = paymentId(reversible)
  await rpc(client, 'reverse_invoice_payment', { p_payment_id: reversiblePaymentId, p_reason: 'QAD26-TEST synthetic reversal', p_actor: fixture.userId })
  reconciliations.push({ status: 'reverted', paymentId: reversiblePaymentId })

  return { accounts, event: { result: event, requestId: 'QAD26-PORTAL-EVENT-001' }, reconciliations }
}

if ((await import('./fixture-runtime.mjs')).isMain(import.meta.url, process.argv[1])) {
  const { authClient, readCatalog, writeCatalog } = await import('./fixture-runtime.mjs')
  const { client, userId } = await authClient()
  const catalog = await readCatalog()
  catalog.userId = userId
  const result = await createPortalScenarios(client, catalog)
  const accountByCustomer = new Map(result.accounts.map((account) => [account.customerId, account]))
  catalog.portalAccounts = (catalog.portalAccounts ?? []).map((entry) => ({ ...entry, active: accountByCustomer.get(entry.customerId)?.active ?? entry.account?.active, account: entry.account ? { ...entry.account, active: accountByCustomer.get(entry.customerId)?.active ?? entry.account.active } : entry.account }))
  catalog.payments = [...(catalog.payments ?? []), ...result.reconciliations.map((item) => ({ id: item.paymentId, status: item.status, created: true }))]
  if (result.event?.result?.id) catalog.portalEvents = [...(catalog.portalEvents ?? []), { id: result.event.result.id, created: true }]
  await writeCatalog(catalog)
  console.log(JSON.stringify({ accountCount: result.accounts.length, reconciliationCount: result.reconciliations.length }, null, 2))
}
