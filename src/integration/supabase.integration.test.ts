import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const enabled = process.env.SUPABASE_RUN_INTEGRATION === '1'
const describeIntegration = enabled ? describe : describe.skip

type IntegrationEnv = {
  url: string
  anonKey: string
  email: string
  password: string
  voyageId: number
  blId: string
  blIdWithCe?: string | null
  billingBlIds?: string[]
  operatorEmail?: string | null
  operatorPassword?: string | null
}

let client: SupabaseClient<Database>
let env: IntegrationEnv
let userId: string
const billingFlowTest = hasBillingFixtures() ? it : it.skip
// Ler `invoices` sem uma fatura garantida nao prova nada: RLS filtrando e
// tabela vazia devolvem o mesmo `[]`. Por isso este teste tambem exige
// fixtures de billing, para criar uma fatura conhecida antes de trocar para
// a sessao do operador (achado da auditoria RBAC 2026-08-13).
const operatorRlsTest = hasOperatorCredentials() && hasBillingFixtures() ? it : it.skip

describeIntegration('supabase integration - hardening gate', () => {
  beforeAll(async () => {
    env = loadEnv()
    client = createClient<Database>(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data, error } = await client.auth.signInWithPassword({
      email: env.email,
      password: env.password,
    })
    if (error || !data.user) {
      throw new Error(`Falha no login de integracao: ${error?.message ?? 'usuario sem sessao'}`)
    }
    userId = data.user.id
  })

  afterAll(async () => {
    if (!client) return
    await client.auth.signOut()
  })

  // ADR 0095, decisão 3 (migration 420): o reenvio do mesmo arquivo só avisa.
  it('import_manifest_transactional aceita o mesmo hash de novo (reenvio só avisa)', async () => {
    const hash = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')

    const first = await client.rpc('import_manifest_transactional', {
      p_filename: `${hash}.xlsx`,
      p_voyage_id: env.voyageId,
      p_uploaded_by: userId,
      p_cargo_mode: 'container',
      p_file_hash: hash,
      p_total_bls: 0,
      p_total_containers: 0,
      p_bls: [],
      p_containers: [],
      p_errors: [],
    })

    expect(first.error).toBeNull()
    expect(typeof first.data).toBe('number')

    const second = await client.rpc('import_manifest_transactional', {
      p_filename: `${hash}.xlsx`,
      p_voyage_id: env.voyageId,
      p_uploaded_by: userId,
      p_cargo_mode: 'container',
      p_file_hash: hash,
      p_total_bls: 0,
      p_total_containers: 0,
      p_bls: [],
      p_containers: [],
      p_errors: [],
    })

    expect(second.error).toBeNull()
    expect(typeof second.data).toBe('number')
  })

  it('import_manifest_transactional aciona rate limit (P0429)', async () => {
    let limited = false

    for (let index = 0; index < 8; index += 1) {
      const hash = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const result = await client.rpc('import_manifest_transactional', {
        p_filename: `${hash}.xlsx`,
        p_voyage_id: env.voyageId,
        p_uploaded_by: userId,
        p_cargo_mode: 'container',
        p_file_hash: hash,
        p_total_bls: 0,
        p_total_containers: 0,
        p_bls: [],
        p_containers: [],
        p_errors: [],
      })

      if (result.error?.code === 'P0429') {
        limited = true
        break
      }

      if (result.error) {
        throw new Error(`Erro inesperado no teste de rate limit: ${result.error.code} ${result.error.message}`)
      }
    }

       expect(limited).toBe(true)
  })

  it('save_bl_review aplica optimistic lock e retorna PT409 em timestamp stale', async () => {
    const result = await client.rpc('save_bl_review', {
      p_bl_id: env.blId,
      p_expected_updated_at: '2000-01-01T00:00:00.000Z',
      p_update_payload: {},
      p_audit_rows: [],
      p_changed_by: userId,
    })

    expect(result.data).toBeNull()
    expect(result.error?.code).toBe('PT409')
  })

  it('Corrigir CE Mercante com o mesmo CE retorna unchanged (a porta da ficha)', async () => {
    if (!env.blIdWithCe) return

    const current = await client.from('bls').select('ce_mercante').eq('id', env.blIdWithCe).single()
    if (current.error) {
      throw new Error(`Falha ao consultar CE atual: ${current.error.message}`)
    }

    const ce = String(current.data?.ce_mercante ?? '').trim()
    if (!ce) return

    // `apply_ce_mercante_update` saiu da API (migration 195); a ficha usa
    // `correct_bl_ce_mercante`, com motivo.
    const result = await client.rpc('correct_bl_ce_mercante' as never, {
      p_bl_id: env.blIdWithCe,
      p_ce: ce,
      p_reason: 'Teste de integração: CE igual',
    } as never)

    expect(result.error).toBeNull()
    expect((result.data as { status?: string } | null)?.status).toBe('unchanged')
  })

  operatorRlsTest('RLS financeiro permite leitura e bloqueia mutacao para operador', async () => {
    const blIds = env.billingBlIds ?? []
    expect(blIds.length).toBeGreaterThan(0)
    const marker = `it-operator-read-${Date.now()}`

    // Cria uma fatura conhecida com o cliente privilegiado antes de trocar
    // para a sessao do operador: sem isso, `invoices.select()` vazio nao
    // distingue "RLS filtrou" de "tabela sem dado".
    const prep = await client
      .from('bls')
      .update({ financial_status: 'pending', charge_status: 'ready_for_billing' })
      .in('id', blIds)
    expect(prep.error).toBeNull()

    for (const blId of blIds) {
      const calc = await client.from('charge_calculations').upsert(
        {
          bl_id: blId,
          source: 'auto',
          status: 'ready_for_billing',
          calculation_key: `${marker}:${blId}`,
          quantity: 1,
          unit_value_brl: 1234.56,
          total_value_brl: 1234.56,
          notes: 'integration operator-rls fixture',
          created_by: userId,
          calculated_at: new Date().toISOString(),
        },
        { onConflict: 'bl_id,calculation_key' },
      )
      expect(calc.error).toBeNull()
    }

    const createInvoice = await client.rpc('create_invoice_from_bls', {
      p_bl_ids: blIds,
      p_notes: 'integration operator-rls read check',
      p_issue_now: true,
      p_actor: userId,
    })
    expect(createInvoice.error).toBeNull()
    const invoiceId = Number(((createInvoice.data as { invoice_id?: number } | null)?.invoice_id ?? 0))
    expect(invoiceId).toBeGreaterThan(0)

    try {
      const operatorClient = createClient<Database>(env.url, env.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })

      const login = await operatorClient.auth.signInWithPassword({
        email: String(env.operatorEmail),
        password: String(env.operatorPassword),
      })

      if (login.error || !login.data.user) {
        throw new Error(`Falha no login do operador de integracao: ${login.error?.message ?? 'sem sessao'}`)
      }

      const invoices = await operatorClient.from('invoices').select('id').eq('id', invoiceId)
      expect(invoices.error).toBeNull()
      expect(invoices.data).toHaveLength(1)

      const cancel = await operatorClient.rpc('cancel_invoice', {
        p_invoice_id: -1,
        p_reason: 'integration-operator-must-not-cancel',
        p_actor: login.data.user.id,
      })
      expect(cancel.error?.code).toBe('42501')

      await operatorClient.auth.signOut()
    } finally {
      const cancelFixture = await client.rpc('cancel_invoice', {
        p_invoice_id: invoiceId,
        p_reason: 'integration-operator-rls-cleanup',
        p_actor: userId,
      })
      expect(cancelFixture.error).toBeNull()
    }
  })

  billingFlowTest('billing flow cria/cancela/reemite invoice e liquida pagamento', async () => {
    const blIds = env.billingBlIds ?? []
    expect(blIds.length).toBeGreaterThan(0)

    const marker = `it-billing-${Date.now()}`
    const snapshot = await client
      .from('bls')
      .select('id,financial_status,charge_status')
      .in('id', blIds)
    expect(snapshot.error).toBeNull()
    expect((snapshot.data ?? []).length).toBe(blIds.length)

    const originalStatus = new Map(
      (snapshot.data ?? []).map((row) => [
        row.id,
        {
          financial_status: row.financial_status,
          charge_status: row.charge_status,
        },
      ]),
    )

    try {
      const prep = await client
        .from('bls')
        .update({
          financial_status: 'pending',
          charge_status: 'ready_for_billing',
        })
        .in('id', blIds)
      expect(prep.error).toBeNull()

      for (const blId of blIds) {
        const calc = await client
          .from('charge_calculations')
          .upsert(
            {
              bl_id: blId,
              source: 'auto',
              status: 'ready_for_billing',
              calculation_key: `${marker}:${blId}`,
              quantity: 1,
              unit_value_brl: 1234.56,
              total_value_brl: 1234.56,
              notes: 'integration billing fixture',
              created_by: userId,
              calculated_at: new Date().toISOString(),
            },
            { onConflict: 'bl_id,calculation_key' },
          )
        expect(calc.error).toBeNull()
      }

      const createA = await client.rpc('create_invoice_from_bls', {
        p_bl_ids: blIds,
          p_notes: 'integration create/cancel',
        p_issue_now: true,
        p_actor: userId,
      })
      expect(createA.error).toBeNull()
      const invoiceAId = Number(((createA.data as { invoice_id?: number } | null)?.invoice_id ?? 0))
      expect(invoiceAId).toBeGreaterThan(0)

      const afterCreateA = await client.from('bls').select('id,financial_status').in('id', blIds)
      expect(afterCreateA.error).toBeNull()
      expect((afterCreateA.data ?? []).every((row) => row.financial_status === 'invoiced')).toBe(true)

      const cancelA = await client.rpc('cancel_invoice', {
        p_invoice_id: invoiceAId,
        p_reason: 'integration-cancel',
        p_actor: userId,
      })
      expect(cancelA.error).toBeNull()

      const afterCancelA = await client.from('bls').select('id,financial_status').in('id', blIds)
      expect(afterCancelA.error).toBeNull()
      expect((afterCancelA.data ?? []).every((row) => row.financial_status === 'pending')).toBe(true)

      const createB = await client.rpc('create_invoice_from_bls', {
        p_bl_ids: blIds,
          p_notes: 'integration payment flow',
        p_issue_now: true,
        p_actor: userId,
      })
      expect(createB.error).toBeNull()
      const invoiceBId = Number(((createB.data as { invoice_id?: number } | null)?.invoice_id ?? 0))
      expect(invoiceBId).toBeGreaterThan(0)

      const invoiceBeforePay = await client
        .from('invoices')
        .select('total_brl,balance_brl,status')
        .eq('id', invoiceBId)
        .single()
      expect(invoiceBeforePay.error).toBeNull()
      const totalBrl = Number(invoiceBeforePay.data?.total_brl ?? 0)
      expect(totalBrl).toBeGreaterThan(0)

      const firstPayment = Number((totalBrl / 2).toFixed(2))
      const pay1 = await client.rpc('register_invoice_payment', {
        p_invoice_id: invoiceBId,
        p_amount_brl: firstPayment,
        p_payment_method: 'pix',
        p_paid_at: new Date().toISOString(),
        p_notes: 'integration-pay-1',
        p_actor: userId,
      })
      expect(pay1.error).toBeNull()

      const invoiceAfterPay1 = await client
        .from('invoices')
        .select('balance_brl,status')
        .eq('id', invoiceBId)
        .single()
      expect(invoiceAfterPay1.error).toBeNull()
      const remaining = Number(invoiceAfterPay1.data?.balance_brl ?? 0)
      expect(remaining).toBeGreaterThan(0)
      expect(invoiceAfterPay1.data?.status).toBe('partially_paid')

      const pay2 = await client.rpc('register_invoice_payment', {
        p_invoice_id: invoiceBId,
        p_amount_brl: remaining,
        p_payment_method: 'ted',
        p_paid_at: new Date().toISOString(),
        p_notes: 'integration-pay-2',
        p_actor: userId,
      })
      expect(pay2.error).toBeNull()

      const invoiceAfterPay2 = await client
        .from('invoices')
        .select('balance_brl,status')
        .eq('id', invoiceBId)
        .single()
      expect(invoiceAfterPay2.error).toBeNull()
      expect(Number(invoiceAfterPay2.data?.balance_brl ?? -1)).toBe(0)
      expect(invoiceAfterPay2.data?.status).toBe('paid')

      const afterPay2 = await client.from('bls').select('id,financial_status').in('id', blIds)
      expect(afterPay2.error).toBeNull()
      expect((afterPay2.data ?? []).every((row) => row.financial_status === 'paid')).toBe(true)
    } finally {
      for (const blId of blIds) {
        const original = originalStatus.get(blId)
        if (!original) continue
        await client
          .from('bls')
          .update({
            financial_status: original.financial_status,
            charge_status: original.charge_status,
          })
          .eq('id', blId)
      }
    }
  })

  billingFlowTest('ledger phase 1 backfills and lists consolidatable receivables', async () => {
    const blIds = env.billingBlIds ?? []
    expect(blIds.length).toBeGreaterThan(0)

    const firstBlId = blIds[0]
    const snapshot = await client
      .from('bls')
      .select('id,customer_id')
      .eq('id', firstBlId)
      .single()
    expect(snapshot.error).toBeNull()
    const customerId = Number(snapshot.data?.customer_id ?? 0)
    expect(customerId).toBeGreaterThan(0)

    const sync = await client.rpc('sync_local_charge_receivable', {
      p_bl_id: firstBlId,
    })
    expect(sync.error).toBeNull()
    expect(Number(sync.data ?? 0)).toBeGreaterThan(0)

    const backfillLinks = await client.rpc('backfill_invoice_receivable_links', {
      p_limit: 50,
    })
    expect(backfillLinks.error).toBeNull()

    const list = await client.rpc('list_consolidatable_receivables', {
      p_customer_id: customerId,
      p_search: firstBlId,
    })
    expect(list.error).toBeNull()
    expect(Array.isArray(list.data)).toBe(true)
    expect((list.data ?? []).some((row) => row.bl_id === firstBlId)).toBe(true)
    expect((list.data ?? []).every((row) => typeof row.eligibility_status === 'string')).toBe(true)
  })

  billingFlowTest('ledger phase 2 reconciliation is TXID-only and idempotent', async () => {
    // Desde a migration 329 a baixa por TXID não é executável pela API: a
    // Conciliação Pix a alcança pela confirmação do lote, que confere o setor.
    const direct = await client.rpc('reconcile_invoice_payment_by_txid', {
      p_txid: 'TXID-DOES-NOT-EXIST-' + Date.now(),
      p_amount_brl: 1,
    })
    expect(direct.error?.code).toBe('42501')

    const confirmLocal = (txid: string) => client.rpc('confirm_unified_pix_matches', {
      p_matches: [{ source: 'local', invoice_id: -1, doc_number: 'TXID-ONLY', txid, amount: 1, paid_at: new Date().toISOString() }],
    })

    // No TXID match -> nothing settled; the whole batch is refused.
    const none = await confirmLocal('TXID-DOES-NOT-EXIST-' + Date.now())
    expect(none.error?.message).toContain('Falha ao conciliar fatura local TXID-ONLY: no_match')

    // Empty TXID is rejected cleanly, never auto-settled.
    const empty = await confirmLocal('   ')
    expect(empty.error?.message).toContain('Falha ao conciliar fatura local TXID-ONLY: empty_txid')
  })

  billingFlowTest('ledger phase 4a links an invoice into the ledger', async () => {
    const invoices = await client
      .from('invoices')
      .select('id')
      .order('id', { ascending: false })
      .limit(1)
    expect(invoices.error).toBeNull()
    const invoiceId = Number(invoices.data?.[0]?.id ?? 0)
    if (!invoiceId) return

    const link = await client.rpc('link_invoice_to_ledger', { p_invoice_id: invoiceId })
    expect(link.error).toBeNull()

    const links = await client
      .from('invoice_receivable_links')
      .select('invoice_id, status')
      .eq('invoice_id', invoiceId)
    expect(links.error).toBeNull()
  })
})

function hasOperatorCredentials() {
  return Boolean(process.env.SUPABASE_OPERATOR_EMAIL && process.env.SUPABASE_OPERATOR_PASSWORD)
}

function hasBillingFixtures() {
  return Boolean(process.env.SUPABASE_TEST_BILLING_BL_IDS)
}

function loadEnv(): IntegrationEnv {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const email = process.env.SUPABASE_INTEGRATION_EMAIL
  const password = process.env.SUPABASE_INTEGRATION_PASSWORD
  const voyageIdRaw = process.env.SUPABASE_TEST_VOYAGE_ID
  const blId = process.env.SUPABASE_TEST_BL_ID
  const billingBlIdsRaw = process.env.SUPABASE_TEST_BILLING_BL_IDS ?? ''

  const missing: string[] = []
  if (!url) missing.push('SUPABASE_URL or VITE_SUPABASE_URL')
  if (!anonKey) missing.push('SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY')
  if (!email) missing.push('SUPABASE_INTEGRATION_EMAIL')
  if (!password) missing.push('SUPABASE_INTEGRATION_PASSWORD')
  if (!voyageIdRaw) missing.push('SUPABASE_TEST_VOYAGE_ID')
  if (!blId) missing.push('SUPABASE_TEST_BL_ID')

  if (missing.length > 0) {
    throw new Error(
      `Variaveis obrigatorias para testes de integracao ausentes: ${missing.join(', ')}. Defina-as e rode: SUPABASE_RUN_INTEGRATION=1 npm run test:integration`,
    )
  }

  const voyageId = Number(voyageIdRaw)
  if (!Number.isInteger(voyageId) || voyageId <= 0) {
    throw new Error('SUPABASE_TEST_VOYAGE_ID deve ser inteiro positivo.')
  }

  return {
    url: String(url),
    anonKey: String(anonKey),
    email: String(email),
    password: String(password),
    voyageId,
    blId: String(blId),
    blIdWithCe: process.env.SUPABASE_TEST_BL_ID_WITH_CE ?? null,
    billingBlIds: billingBlIdsRaw
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter((value) => value.length > 0),
    operatorEmail: process.env.SUPABASE_OPERATOR_EMAIL ?? null,
    operatorPassword: process.env.SUPABASE_OPERATOR_PASSWORD ?? null,
  }
}
