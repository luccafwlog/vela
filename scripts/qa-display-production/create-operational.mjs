import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { FIXTURE_PREFIX } from './fixture-config.mjs'
import { isMain } from './fixture-runtime.mjs'

const PREFIX = FIXTURE_PREFIX
const USER_EMAIL = process.env.SUPABASE_INTEGRATION_EMAIL

const customers = [
  ['QA26000100000101', `${PREFIX} Cliente Alpha`, 'Alpha QA Logistics'],
  ['QA26000100000201', `${PREFIX} Cliente Bravo`, 'Bravo QA Imports'],
  ['QA26000100000301', `${PREFIX} Cliente Charlie`, 'Charlie QA Trading'],
  ['QA26000100000401', `${PREFIX} Cliente Delta`, 'Delta QA Granite'],
]

const voyages = [
  { vessel: `${PREFIX} OCEAN ONE`, imo: '9926001', number: 'QAD26A', status: 'active' },
  { vessel: `${PREFIX} OCEAN TWO`, imo: '9926002', number: 'QAD26B', status: 'completed' },
]

async function authClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key || !process.env.SUPABASE_INTEGRATION_PASSWORD) throw new Error('authenticated Supabase env is required')
  const client = createClient(url, key, { auth: { persistSession: false } })
  const { data: authData, error } = await client.auth.signInWithPassword({ email: USER_EMAIL, password: process.env.SUPABASE_INTEGRATION_PASSWORD })
  if (error) throw error
  return { client, userId: authData.user.id }
}

async function getOrCreateCarrier(client) {
  const { data, error } = await client.from('carriers').select('id').eq('scac', 'QAD').maybeSingle()
  if (error) throw error
  if (data) return data.id
  const created = await client.from('carriers').insert({ name: `${PREFIX} Carrier`, scac: 'QAD' }).select('id').single()
  if (created.error) throw created.error
  return created.data.id
}

export async function createOperationalFixture(client, userId) {
  const catalog = { prefix: PREFIX, createdBy: USER_EMAIL, userId, customers: [], voyages: [], vessels: [], bls: [], bl_containers: [], createdAt: new Date().toISOString() }
  for (const [cnpj, name, tradeName] of customers) {
    const existing = await client.from('customers').select('id,cnpj_cpf').eq('cnpj_cpf', cnpj).maybeSingle()
    if (existing.error) throw existing.error
    let customerCreated = false
    const result = existing.data ?? (await client.rpc('create_customer_with_contacts', {
      p_customer: { cnpj_cpf: cnpj, name, trade_name: tradeName, address: 'QA Synthetic Address', city: 'Vitoria', state: 'ES', zip: '29000000', notes: PREFIX },
      p_contacts: [{ name: 'Contato QA', email: null, phone: null, purpose: 'geral', is_primary: true }],
    })).data
    customerCreated = !existing.data
    if (!result) throw new Error(`customer creation failed: ${cnpj}`)
    const customerId = result.id ?? result
    const contact = await client.from('customer_contacts').select('id').eq('customer_id', customerId).eq('email', `qa-${customerId}@example.invalid`).maybeSingle()
    if (contact.error) throw contact.error
    if (!contact.data) {
      const contactInsert = await client.from('customer_contacts').insert({ customer_id: customerId, name: 'Contato QA', email: `qa-${customerId}@example.invalid`, purpose: 'faturamento', is_primary: true })
      if (contactInsert.error) throw contactInsert.error
    }
    catalog.customers.push({ id: customerId, cnpj, created: customerCreated })
  }
  const carrierId = await getOrCreateCarrier(client)
  for (const item of voyages) {
    const existing = await client.from('voyages').select('id').eq('voyage_number', item.number).maybeSingle()
    if (existing.error) throw existing.error
    let voyageId = existing.data?.id
    let vesselId
    let voyageCreated = false
    if (!voyageId) {
      const vessel = await client.from('vessels').insert({ name: item.vessel, imo: item.imo, carrier_id: carrierId }).select('id').single()
      if (vessel.error) throw vessel.error
      vesselId = vessel.data.id
      const voyage = await client.from('voyages').insert({ vessel_id: vessel.data.id, voyage_number: item.number, status: item.status, show_on_portal: true }).select('id').single()
      if (voyage.error) throw voyage.error
      voyageId = voyage.data.id
      voyageCreated = true
    }
    catalog.voyages.push({ id: voyageId, number: item.number, status: item.status, created: voyageCreated })
    if (vesselId) catalog.vessels.push({ id: vesselId, created: true })
    const scheduleRows = [
      ['voyage_pol_schedule', `${voyageId}::QINGDAO`, 'etd', '2026-09-01'],
      ['voyage_pol_schedule', `${voyageId}::SHANGHAI`, 'etd', '2026-09-03'],
      ['voyage_pol_schedule', `${voyageId}::TAICANG`, 'etd', '2026-09-05'],
      ['voyage_pod_schedule', `${voyageId}::SALVADOR`, 'eta', '2026-10-01'],
      ['voyage_pod_schedule', `${voyageId}::VITORIA`, 'eta', '2026-10-04'],
      ['voyage_pod_schedule', `${voyageId}::PECEM`, 'eta', '2026-10-08'],
    ].map(([entity_type, entity_id, field_name, new_value]) => ({ entity_type, entity_id, field_name, old_value: null, new_value, changed_by: null, justification: PREFIX }))
    const existingSchedules = await client.from('audit_logs').select('entity_id,field_name').in('entity_id', scheduleRows.map((row) => row.entity_id)).in('field_name', ['etd', 'eta'])
    if (existingSchedules.error) throw existingSchedules.error
    const existingKeys = new Set((existingSchedules.data ?? []).map((row) => `${row.entity_id}:${row.field_name}`))
    const missingRows = scheduleRows.filter((row) => !existingKeys.has(`${row.entity_id}:${row.field_name}`)).map((row) => ({ ...row, changed_by: userId }))
    const schedules = missingRows.length ? await client.from('audit_logs').insert(missingRows) : { error: null }
    if (schedules.error) throw schedules.error
  }
  catalog.bls = []
  const blSpecs = [
    ['QAD26-BL-001', 34, 1, 'QINGDAO', 'SALVADOR', '40HC', 'QADU2600001', false, false],
    ['QAD26-BL-002', 34, 2, 'SHANGHAI', 'VITORIA', '20GP', 'QADU2600002', false, false],
    ['QAD26-BL-003', 34, 3, 'TAICANG', 'PECEM', '40RF', 'QADU2600003', true, false],
    ['QAD26-BL-004', 35, 4, 'NINGBO', 'SALVADOR', '20TK', 'QADU2600004', false, true],
    ['QAD26-BL-005', 35, 1, 'NANSHA', 'VITORIA', '40HC', 'QADU2600005', false, false],
    ['QAD26-BL-006', 35, 2, 'SHANGHAI', 'PECEM', '40GP', 'QADU2600006', false, false],
  ]
  for (const [id, voyage_id, customer_id, pol, pod, type, container_number, is_imo, is_oog] of blSpecs) {
    const bl = await client.from('bls').select('id').eq('id', id).maybeSingle()
    if (bl.error) throw bl.error
    const blCreated = !bl.data
    if (!bl.data) {
      const createdBl = await client.from('bls').insert({ id, voyage_id, customer_id, pol, pod, shipper: `${PREFIX} Shipper`, consignee: `${PREFIX} Consignee`, notify_party: `${PREFIX} Notify`, cargo_description: `${PREFIX} synthetic cargo`, total_weight_kg: 12000, total_cbm: 35, incoterm: 'FOB', payment_type: 'PREPAID', notes: PREFIX }).select('id').single()
      if (createdBl.error) throw createdBl.error
    }
    const existingContainer = await client.from('bl_containers').select('id').eq('bl_id', id).eq('container_number', container_number).maybeSingle()
    if (existingContainer.error) throw existingContainer.error
    let container = existingContainer.data
    const containerCreated = !container
    if (!container) {
      const createdContainer = await client.from('bl_containers').insert({ bl_id: id, container_number, type, tare_weight_kg: 3800, gross_weight_kg: 15800, cbm: 35, is_imo, is_oog, imo_class: is_imo ? '3' : null, un_number: is_imo ? '1203' : null }).select('id').single()
      if (createdContainer.error) throw createdContainer.error
      container = createdContainer.data
    }
    if (!container) throw new Error(`container creation failed: ${container_number}`)
    catalog.bls.push({ id, voyage_id, customer_id, pod, container_id: container.id, container_number, type, created: blCreated })
    catalog.bl_containers.push({ id: container.id, bl_id: id, created: containerCreated })
  }
  catalog.vehicles = []
  const vehicleSpecs = [
    ['QAD26-CH-001', 'VOLKSWAGEN', 'NIVUS', 1450, 9, 'QAD26-BL-001', 34],
    ['QAD26-CH-002', 'PEUGEOT', '2008', 1500, 10, 'QAD26-BL-001', 34],
    ['QAD26-CH-003', 'TOYOTA', 'COROLLA', 1600, 10, 'QAD26-BL-004', 35],
  ]
  for (const [chassis, brand, model, weight_kg, cbm, bl_id, voyage_id] of vehicleSpecs) {
    const blContainer = catalog.bls.find((row) => row.id === bl_id)
    const existing = await client.from('vehicles').select('id').eq('chassis', chassis).maybeSingle()
    if (existing.error) throw existing.error
    const vehicle = existing.data ?? (await client.from('vehicles').insert({ chassis, brand, model, weight_kg, cbm, bl_id, voyage_id, container_id: blContainer.container_id }).select('id').single()).data
    if (!vehicle) throw new Error(`vehicle creation failed: ${chassis}`)
    catalog.vehicles.push({ id: vehicle.id, chassis, bl_id, created: !existing.data })
  }
  catalog.granite = []
  const existingGraniteManifest = await client.from('granite_manifests').select('id').eq('vessel_voyage', `${PREFIX} OCEAN TWO / QAD26B`).maybeSingle()
  if (existingGraniteManifest.error) throw existingGraniteManifest.error
  const graniteManifest = existingGraniteManifest.data ? { data: existingGraniteManifest.data, error: null } : await client.from('granite_manifests').insert({ voyage_id: 35, vessel_voyage: `${PREFIX} OCEAN TWO / QAD26B`, loading_port: 'TAICANG', discharge_port: 'VITORIA', total_bls: 2, total_weight_kg: 48000, imported_by: userId }).select('id').single()
  if (graniteManifest.error) throw graniteManifest.error
  for (const [bl_number, customer_id, weight, blocks, m3] of [['QAD26-GR-001', 4, 24000, 12, 18.5], ['QAD26-GR-002', 3, 24000, 10, 17.2]]) {
    const existingGranite = await client.from('granite_bls').select('id').eq('bl_number', bl_number).maybeSingle()
    if (existingGranite.error) throw existingGranite.error
    const granite = existingGranite.data ? { data: existingGranite.data, error: null } : await client.from('granite_bls').insert({ manifest_id: graniteManifest.data.id, client_id: customer_id, bl_number, vessel_voyage: `${PREFIX} OCEAN TWO / QAD26B`, loading_port: 'TAICANG', discharge_port: 'VITORIA', shipper_name: `${PREFIX} Quarry`, consignee_name: `${PREFIX} Stone Buyer`, shipper_m3: m3, shipper_weight_kg: weight, blocks_qty: blocks, received_blocks_qty: blocks, final_m3: m3, real_weight_kg: weight, remarks: PREFIX }).select('id').single()
    if (granite.error) throw granite.error
    catalog.granite.push({ id: granite.data.id, bl_number, created: !existingGranite.data })
  }
  const depot = await client.from('depots').select('code').eq('active', true).eq('tipo', 'depot').limit(1).single()
  if (depot.error) throw depot.error
  const emptyBookings = [
    { container_number: 'QADU2600101', container_type: '20GP', local_code: depot.data.code, condition: 'vazio', hand_in_date: '2026-09-10', hand_out_date: '2026-09-12', movement_date: '2026-09-15' },
    { container_number: 'QADU2600102', container_type: '40HC', local_code: depot.data.code, condition: 'vazio', hand_in_date: '2026-09-10', hand_out_date: '2026-09-12', movement_date: '2026-09-15' },
    { container_number: 'QADU2600103', container_type: '40RF', local_code: depot.data.code, condition: 'material', hand_in_date: '2026-09-10', hand_out_date: '2026-09-12', movement_date: '2026-09-15' },
  ]
  const emptyResult = await client.rpc('import_vazios_bookings_transactional', { p_voyage_id: 34, p_port: 'VITORIA', p_uploaded_by: userId, p_bookings: emptyBookings })
  if (emptyResult.error) throw emptyResult.error
  catalog.emptyContainers = { ...emptyResult.data, depotCode: depot.data.code, created: true }
  const demurrageContainer = catalog.bls.find((row) => row.id === 'QAD26-BL-001')
  const primaryBl = catalog.bls.find((row) => row.id === 'QAD26-BL-001')
  const primaryCustomerId = primaryBl.customer_id
  const demurrageItems = [{ container_id: demurrageContainer.container_id, container_number: 'QADU2600001', container_type: '40HC', discharge_date: '2026-08-01', return_date: '2026-08-12', total_days: 11, free_days: 5, days_p1: 5, rate_p1_usd: 20, days_p2: 1, rate_p2_usd: 40, subtotal_usd: 140 }]
  const demurrage = await client.rpc('create_demurrage_invoice_with_items', { p_doc_number: 'QAD26-DEM-001', p_bl_id: primaryBl.id, p_customer_id: primaryCustomerId, p_total_usd: 140, p_ready_at: '2026-08-12', p_roe_manual: true, p_roe: 5.4, p_current_roe: 5.4, p_roe_source: 'manual', p_items: demurrageItems })
  if (demurrage.error && !/duplicate|Ja existe fatura de Demurrage/i.test(String(demurrage.error.message))) throw demurrage.error
  catalog.demurrage = { ...(demurrage.data ?? { doc_number: 'QAD26-DEM-001' }), reused: !demurrage.data, created: Boolean(demurrage.data) }
  const currentStatus = await client.from('bls').select('financial_status').eq('id', 'QAD26-BL-001').single()
  if (currentStatus.error) throw currentStatus.error
  if (currentStatus.data.financial_status !== 'invoiced' && currentStatus.data.financial_status !== 'paid') {
    const localCalc = await client.rpc('calculate_bl_local_charges', { p_bl_id: 'QAD26-BL-001', p_actor: userId, p_recalculate: true })
    if (localCalc.error) throw localCalc.error
    const currentBl = await client.from('bls').select('updated_at').eq('id', 'QAD26-BL-001').single()
    if (currentBl.error) throw currentBl.error
    const reviewed = await client.rpc('save_bl_review', { p_bl_id: 'QAD26-BL-001', p_expected_updated_at: currentBl.data.updated_at, p_update_payload: {}, p_audit_rows: [], p_changed_by: userId })
    if (reviewed.error) throw reviewed.error
  const queueSync = await client.rpc('refresh_customer_reconciliation_queue_for_bl', { p_bl_id: 'QAD26-BL-001' })
  if (queueSync.error) throw queueSync.error
  const queue = await client.from('customer_reconciliation_queue').select('id,bl_id,status').eq('bl_id', 'QAD26-BL-001').eq('status', 'pending')
  if (queue.error) throw queue.error
    for (const row of queue.data ?? []) {
      const approved = await client.rpc('approve_customer_reconciliation', { p_queue_id: row.id, p_customer_id: primaryCustomerId, p_notes: PREFIX, p_actor: userId })
      if (approved.error) throw approved.error
    }
    const ready = await client.rpc('mark_bl_ready_for_billing', { p_bl_id: 'QAD26-BL-001', p_actor: userId })
    if (ready.error) throw ready.error
    const localInvoice = await client.rpc('create_invoice_from_bls_with_ledger', { p_bl_ids: [primaryBl.id], p_customer_id: primaryCustomerId, p_due_date: '2026-09-30', p_notes: `${PREFIX} local charges`, p_issue_now: true, p_actor: userId })
    if (localInvoice.error) throw localInvoice.error
    if (localInvoice.data?.invoice_id == null) throw new Error('operational invoice RPC did not return invoice_id')
    if (localInvoice.error) throw localInvoice.error
    catalog.localInvoice = { ...localInvoice.data, created: true }
    catalog.invoices = [{ id: localInvoice.data.invoice_id, blId: primaryBl.id, customerId: primaryCustomerId, status: 'partial', usedBy: 'operational', created: true }]
    const receivables = await client.from('bl_receivables').select('id').eq('bl_id', 'QAD26-BL-001')
    if (receivables.error) throw receivables.error
    catalog.receivables = (receivables.data ?? []).map((row) => ({ id: row.id, created: false }))
    const invoiceId = Number(localInvoice.data?.invoice_id)
    const payment = await client.rpc('register_invoice_payment', { p_invoice_id: invoiceId, p_amount_brl: 1000, p_payment_method: 'pix', p_paid_at: '2026-08-20T12:00:00Z', p_notes: `${PREFIX} synthetic PIX partial`, p_actor: userId })
    if (payment.error) throw payment.error
    catalog.syntheticPayment = payment.data
  } else {
    const existingInvoice = await client.from('invoices').select('id').eq('notes', `${PREFIX} local charges`).maybeSingle()
    if (existingInvoice.error) throw existingInvoice.error
    catalog.localInvoice = { invoice_id: existingInvoice.data?.id, reused: true, created: false }
    catalog.invoices = existingInvoice.data ? [{ id: existingInvoice.data.id, blId: primaryBl.id, customerId: primaryCustomerId, status: 'partial', usedBy: 'operational', created: false }] : []
    const receivables = await client.from('bl_receivables').select('id').eq('bl_id', 'QAD26-BL-001')
    if (receivables.error) throw receivables.error
    catalog.receivables = (receivables.data ?? []).map((row) => ({ id: row.id, created: false }))
  }
  // A conta do Portal nasce só pelo provisionamento (Edge Functions); a RPC
  // legada de conta com senha própria saiu na migration 234 (ADR 0083, item 21).
  const accounts = await client.from('customer_portal_accounts').select('id,customer_id').in('customer_id', [1, 2, 3, 4])
  if (accounts.error) throw accounts.error
  catalog.portalAccounts = (accounts.data ?? []).map((account) => ({ customerId: account.customer_id, account: { id: account.id }, created: false }))
  return catalog
}

if (isMain(import.meta.url, process.argv[1])) {
  const { client, userId } = await authClient()
  const catalog = await createOperationalFixture(client, userId)
  await fs.mkdir('artifacts/qa-display-production', { recursive: true })
  await fs.writeFile('artifacts/qa-display-production/operational-fixture.json', `${JSON.stringify(catalog, null, 2)}\n`)
  console.log(JSON.stringify(catalog, null, 2))
}
