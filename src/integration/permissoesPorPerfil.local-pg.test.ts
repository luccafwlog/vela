import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Bateria por perfil do modelo de permissões (ADR 0085; matriz em
// docs/operations/seguranca.md#modelo-de-permissões-por-perfil). Cada caso
// executa a ação como `authenticated` com o usuário do perfil, inclusive a
// escrita direta pela API (PostgREST = SQL como `authenticated` sob RLS), e
// confere permitido ou recusado. Itens P do plano
// docs/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const PROFILES = {
  administrativo: '85850000-0000-4000-8000-000000000001',
  financeiro: '85850000-0000-4000-8000-000000000002',
  operacoes: '85850000-0000-4000-8000-000000000003',
  documentacao: '85850000-0000-4000-8000-000000000004',
  equipamentos: '85850000-0000-4000-8000-000000000005',
} as const
type Profile = keyof typeof PROFILES
const ALL_PROFILES = Object.keys(PROFILES) as Profile[]

/** Executa como `authenticated` com o usuário do perfil; tudo numa transação. */
function runAs(profile: Profile, sql: string): { ok: boolean; output: string; error: string } {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${PROFILES[profile]}';
     SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { ok: result.status === 0, output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

/** Escrita direta recusada: o erro é de privilégio (42501) ou de RLS. */
function expectDenied(profile: Profile, sql: string) {
  const result = runAs(profile, sql)
  expect(result.ok, `${profile} deveria ser recusado em: ${sql}`).toBe(false)
  expect(result.error).toMatch(/permission denied|row-level security|sem permiss/i)
}

const CARRIER_ID = 99085001
const VESSEL_ID = 99085002
const VOYAGE_ID = 99085003
const TABLE_ID = 99085011
const ITEM_THC = 99085012
const ITEM_MANUAL = 99085013
const CUSTOMER_ID = 99085021
const DEM_INVOICE_ID = 99085031
const DEM_DRAFT_ID = 99085032
const DEM_ITEM_ID = 99085033
const CALC_THC_ID = 99085041
const CALC_MANUAL_ID = 99085042
const CONTAINER_ID = 99085051
const CONTACT_ID = 99085061
const INVOICE_ID = 99085071
const INVOICE_ITEM_ID = 99085072
const RECEIVABLE_ID = 99085073
const LIFECYCLE_ID = 99085074
const COUNTER_YEAR = 2085
const POD = 'P85PD'
const BL = 'P85-BL1'

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_id IN ('${BL}', '${DEM_INVOICE_ID}', '${DEM_DRAFT_ID}', '${DEM_ITEM_ID}')
      OR changed_by IN (${Object.values(PROFILES).map((id) => `'${id}'`).join(', ')});
    CREATE TEMP TABLE p85_invoices AS SELECT id FROM public.invoices WHERE id = ${INVOICE_ID} OR customer_id = ${CUSTOMER_ID};
    DELETE FROM public.itau_pix_charges WHERE invoice_id IN (SELECT id FROM p85_invoices);
    DELETE FROM public.audit_logs WHERE entity_id IN (SELECT id::text FROM p85_invoices);
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN (SELECT id FROM p85_invoices);
    DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM p85_invoices);
    DELETE FROM public.invoices WHERE id IN (SELECT id FROM p85_invoices) AND id <> ${INVOICE_ID};
    DELETE FROM public.payments WHERE invoice_id = ${INVOICE_ID};
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id = ${INVOICE_ID};
    DELETE FROM public.invoice_receivable_links WHERE invoice_id = ${INVOICE_ID};
    DELETE FROM public.invoice_bls WHERE invoice_id = ${INVOICE_ID};
    DELETE FROM public.invoice_items WHERE invoice_id = ${INVOICE_ID};
    DELETE FROM public.invoices WHERE id = ${INVOICE_ID};
    DELETE FROM public.ledger_settlements WHERE receivable_id = ${RECEIVABLE_ID};
    DELETE FROM public.bl_receivables WHERE id = ${RECEIVABLE_ID} OR bl_id = '${BL}';
    DELETE FROM public.invoice_counters WHERE year = ${COUNTER_YEAR};
    DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (${DEM_INVOICE_ID}, ${DEM_DRAFT_ID}) OR id = ${DEM_ITEM_ID};
    DELETE FROM public.demurrage_invoices WHERE id IN (${DEM_INVOICE_ID}, ${DEM_DRAFT_ID});
    DELETE FROM public.charge_calculations WHERE bl_id = '${BL}';
    DELETE FROM public.bl_containers WHERE bl_id = '${BL}';
    DELETE FROM public.bls WHERE id = '${BL}';
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id = ${TABLE_ID} OR charge_item_id IN (${ITEM_THC}, ${ITEM_MANUAL});
    DELETE FROM public.charge_table_items WHERE charge_table_id = ${TABLE_ID};
    DELETE FROM public.charge_tables WHERE id = ${TABLE_ID};
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id = ${CUSTOMER_ID});
    DELETE FROM public.customer_contact_change_events WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customer_contacts WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyage_export_schedules WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.baplie_containers WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id IN (${Object.values(PROFILES).map((id) => `'${id}'`).join(', ')});
    DELETE FROM auth.users WHERE id IN (${Object.values(PROFILES).map((id) => `'${id}'`).join(', ')});
    SET session_replication_role = origin;
  `)
}

function seed() {
  const users = ALL_PROFILES.map((profile) => `('${PROFILES[profile]}', '${profile}-p85@example.test')`).join(', ')
  const profiles = ALL_PROFILES.map((profile) => `('${PROFILES[profile]}', 'Perfil ${profile} P85', '${profile}', true)`).join(', ')
  psql(`
    INSERT INTO auth.users (id, email) VALUES ${users};
    INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ${profiles};
    SET session_replication_role = replica;
    INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador P85');
    INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio P85', ${CARRIER_ID});
    INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'P85V', 'active');
    INSERT INTO public.baplie_containers (voyage_id, container_number) VALUES (${VOYAGE_ID}, 'PCCU8500001');
    INSERT INTO public.voyage_export_schedules (voyage_id, pol) VALUES (${VOYAGE_ID}, '${POD}'), (${VOYAGE_ID}, 'P85XX');
    INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE P85 LTDA', '${syntheticCnpj(85021)}');
    INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary)
      VALUES (${CONTACT_ID}, ${CUSTOMER_ID}, 'Contato P85', 'principal-p85@example.test', true);
    INSERT INTO public.charge_tables (id, name, pod, valid_from, cargo_mode) VALUES (${TABLE_ID}, 'Tabela P85', '${POD}', '2020-01-01', 'container');
    INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, currency, manual_only) VALUES
      (${ITEM_THC}, ${TABLE_ID}, 'THC P85', 'container', 1300, 1300, 'BRL', false),
      (${ITEM_MANUAL}, ${TABLE_ID}, 'Taxa manual P85', 'bl', 200, 200, 'BRL', true);
    INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status)
      VALUES ('${BL}', ${VOYAGE_ID}, ${CUSTOMER_ID}, 'P85PL', '${POD}', 'container', 'pending', 'calculated', 'ok');
    INSERT INTO public.bl_containers (id, bl_id, container_number, type) VALUES (${CONTAINER_ID}, '${BL}', 'PCCU8500001', '40HC');
    INSERT INTO public.charge_calculations (id, bl_id, charge_item_id, source, status, calculation_key, quantity, unit_value_brl, total_value_brl)
      VALUES (${CALC_THC_ID}, '${BL}', ${ITEM_THC}, 'auto', 'calculated', 'p85:thc', 1, 1300, 1300),
             (${CALC_MANUAL_ID}, '${BL}', ${ITEM_MANUAL}, 'manual', 'calculated', 'p85:manual', 1, 200, 200);
    INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, status) VALUES
      (${DEM_INVOICE_ID}, 'DEM-P85-1', '${BL}', ${CUSTOMER_ID}, 'issued'),
      (${DEM_DRAFT_ID}, 'DEM-P85-2', '${BL}', ${CUSTOMER_ID}, 'draft');
    INSERT INTO public.demurrage_invoice_items (id, invoice_id, container_id, container_number, container_type,
      discharge_date, return_date, total_days, free_days, subtotal_usd)
      VALUES (${DEM_ITEM_ID}, ${DEM_INVOICE_ID}, ${CONTAINER_ID}, 'PCCU8500001', '40HC', '2026-09-01', '2026-09-20', 20, 7, 1300);
    INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, total_brl, balance_brl, status)
      VALUES (${INVOICE_ID}, 'P85-2085-0001', ${CUSTOMER_ID}, '${BL}', 1500, 1500, 'issued');
    INSERT INTO public.invoice_items (id, invoice_id, description, total_value_brl) VALUES (${INVOICE_ITEM_ID}, ${INVOICE_ID}, 'THC P85', 1500);
    INSERT INTO public.invoice_bls (invoice_id, bl_id) VALUES (${INVOICE_ID}, '${BL}');
    INSERT INTO public.bl_receivables (id, bl_id, customer_id) VALUES (${RECEIVABLE_ID}, '${BL}', ${CUSTOMER_ID});
    INSERT INTO public.invoice_lifecycle_events (id, invoice_id, event_type) VALUES (${LIFECYCLE_ID}, ${INVOICE_ID}, 'issued');
    INSERT INTO public.invoice_counters (year) VALUES (${COUNTER_YEAR});
    SET session_replication_role = origin;
  `)
}

function migration235Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT NOT has_table_privilege('authenticated', 'public.vessels', 'DELETE')
      AND position('B/L vinculado à escala' IN pg_get_functiondef('public.delete_escala'::regproc)) > 0;`) === 't'
  } catch {
    return false
  }
}

function migration241Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('is_admin' IN prosrc) = 0 FROM pg_proc WHERE proname = '_assert_actor_is_caller';`) === 't'
  } catch {
    return false
  }
}

function migration233Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT NOT has_table_privilege('authenticated', 'public.payments', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.invoice_counters', 'UPDATE');`) === 't'
  } catch {
    return false
  }
}

function migration232Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT NOT has_table_privilege('authenticated', 'public.customer_contacts', 'UPDATE')
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_bl_financial_status_port');`) === 't'
  } catch {
    return false
  }
}

function migration231Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT NOT has_table_privilege('authenticated', 'public.charge_calculations', 'UPDATE');`) === 't'
  } catch {
    return false
  }
}

function migration251Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('is_admin' IN prosrc) = 0 FROM pg_proc WHERE proname = 'revert_voyage_omission';`) === 't'
  } catch {
    return false
  }
}

function migration252Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('equipamentos' IN prosrc) > 0 FROM pg_proc WHERE proname = 'retry_import_effect';`) === 't'
  } catch {
    return false
  }
}

function migration253Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('_portal_actor_role' IN prosrc) = 0 FROM pg_proc WHERE proname = 'internal_save_portal_information';`) === 't'
  } catch {
    return false
  }
}

function migration254Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_policies WHERE policyname = 'demurrage_rates_update_active_global';`) === '1'
  } catch {
    return false
  }
}

function migration261Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'reactivate_catalog_row';`) === '1'
  } catch {
    return false
  }
}

function migration263Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_guard_catalog_active_change';`) === '2'
  } catch {
    return false
  }
}

function migration265Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('portal_provisioning_backfill', 'add_agency_report_occurrence');`) === '0'
  } catch {
    return false
  }
}

function migration250Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('equipamentos' IN prosrc) > 0 FROM pg_proc WHERE proname = 'actor' AND pronamespace = 'ce_unlock_private'::regnamespace;`) === 't'
  } catch {
    return false
  }
}

function migration247Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('is_financeiro_user()' IN prosrc) > 0 FROM pg_proc WHERE proname = 'confirm_unified_pix_matches';`) === 't'
  } catch {
    return false
  }
}

function migration246Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('is_admin()' IN prosrc) = 0 FROM pg_proc WHERE oid = 'public.resolve_stale_invoice(bigint,text)'::regprocedure;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(
  () => migration231Applied() && migration232Applied() && migration233Applied() && migration235Applied() && migration241Applied() && migration246Applied() && migration247Applied() && migration250Applied() && migration251Applied() && migration252Applied() && migration253Applied() && migration254Applied() && migration261Applied() && migration263Applied() && migration265Applied(),
  'migrations 231 a 266 (escrita só pelas RPCs, autor conferido, emissão, financeiro e leitura por perfil)')

describeLocal('Modelo de permissões por perfil (ADR 0085)', () => {
  beforeAll(() => {
    cleanup()
    seed()
  })
  afterAll(cleanup)

  // P2 — valores de cobrança só pelas RPCs (ADR 0077; ADR 0085, falha 1).
  it.each(ALL_PROFILES)('P2: %s não altera item de Invoice de Demurrage emitida pela API', (profile) => {
    expectDenied(profile, `UPDATE public.demurrage_invoice_items SET total_days = 0, subtotal_usd = 0 WHERE id = ${DEM_ITEM_ID}`)
    expectDenied(profile, `UPDATE public.demurrage_invoice_items SET invoice_id = ${DEM_DRAFT_ID} WHERE id = ${DEM_ITEM_ID}`)
    expectDenied(profile, `DELETE FROM public.demurrage_invoice_items WHERE id = ${DEM_ITEM_ID}`)
    expectDenied(profile, `INSERT INTO public.demurrage_invoice_items (invoice_id, container_id, container_number, container_type,
      discharge_date, return_date, total_days, free_days, subtotal_usd)
      VALUES (${DEM_DRAFT_ID}, ${CONTAINER_ID}, 'PCCU8500001', '40HC', '2026-09-01', '2026-09-02', 1, 0, 1)`)
    expect(psql(`SELECT invoice_id || ':' || total_days || ':' || subtotal_usd FROM public.demurrage_invoice_items WHERE id = ${DEM_ITEM_ID};`))
      .toBe(`${DEM_INVOICE_ID}:20:1300.00`)
  })

  it.each(ALL_PROFILES)('P2: %s não muda nem apaga o cálculo de Taxas Locais pela API', (profile) => {
    expectDenied(profile, `UPDATE public.charge_calculations SET total_value_brl = 1 WHERE id = ${CALC_THC_ID}`)
    expectDenied(profile, `UPDATE public.charge_calculations SET total_value_brl = 0, quantity = 0 WHERE id = ${CALC_MANUAL_ID}`)
    expectDenied(profile, `DELETE FROM public.charge_calculations WHERE id = ${CALC_MANUAL_ID}`)
    expectDenied(profile, `INSERT INTO public.charge_calculations (bl_id, source, status, calculation_key, quantity, total_value_brl)
      VALUES ('${BL}', 'manual', 'calculated', 'p85:forjada', 1, 4999)`)
    expect(psql(`SELECT string_agg(id || ':' || total_value_brl, ',' ORDER BY id) FROM public.charge_calculations WHERE bl_id = '${BL}';`))
      .toBe(`${CALC_THC_ID}:1300.00,${CALC_MANUAL_ID}:200.00`)
  })

  it('P2: o navegador continua lendo as duas tabelas', () => {
    expect(runAs('operacoes', `SELECT count(*) FROM public.charge_calculations WHERE bl_id = '${BL}'`).output).toBe('2')
    expect(runAs('financeiro', `SELECT count(*) FROM public.demurrage_invoice_items WHERE id = ${DEM_ITEM_ID}`).output).toBe('1')
  })

  it('P2: a taxa manual entra pela RPC para qualquer Departamento e sai pela RPC do Administrativo', () => {
    const added = runAs('operacoes', `SELECT public.add_manual_bl_charge('${BL}', ${ITEM_MANUAL}, 2, 'Taxa extra P85', NULL)`)
    expect(added.error).toBe('')
    const newId = psql(`SELECT id FROM public.charge_calculations WHERE bl_id = '${BL}' AND source = 'manual' AND id <> ${CALC_MANUAL_ID} ORDER BY id DESC LIMIT 1;`)
    expect(newId).not.toBe('')
    expect(psql(`SELECT total_value_brl FROM public.charge_calculations WHERE id = ${newId};`)).toBe('400.00')

    expect(runAs('operacoes', `SELECT public.delete_manual_bl_charge(${newId}, NULL)`).ok).toBe(false)
    const removed = runAs('administrativo', `SELECT public.delete_manual_bl_charge(${newId}, NULL)`)
    expect(removed.error).toBe('')
    expect(psql(`SELECT count(*) FROM public.charge_calculations WHERE id = ${newId};`)).toBe('0')
  })

  it('P2: B/L de container sem container abre a linha de revisão pelo gatilho, como dono', () => {
    // Gatilho guard_container_bl_without_containers (SECURITY DEFINER desde a 231).
    psql(`SET session_replication_role = replica; DELETE FROM public.bl_containers WHERE bl_id = '${BL}'; SET session_replication_role = origin;`)
    try {
      psql(`UPDATE public.bls SET charge_status = 'not_calculated' WHERE id = '${BL}';`)
      const result = runAs('documentacao', `UPDATE public.bls SET charge_status = 'calculated' WHERE id = '${BL}'`)
      expect(result.error).toBe('')
      expect(psql(`SELECT status FROM public.charge_calculations WHERE bl_id = '${BL}' AND calculation_key = 'review:no_container';`))
        .toBe('review_required')
    } finally {
      psql(`SET session_replication_role = replica;
        DELETE FROM public.charge_calculations WHERE bl_id = '${BL}' AND calculation_key = 'review:no_container';
        INSERT INTO public.bl_containers (id, bl_id, container_number, type) VALUES (${CONTAINER_ID}, '${BL}', 'PCCU8500001', '40HC') ON CONFLICT DO NOTHING;
        UPDATE public.bls SET charge_status = 'calculated', billing_hold_reason = NULL WHERE id = '${BL}';
        SET session_replication_role = origin;`)
    }
  })

  // P3 — contatos do Cliente e situação financeira do B/L (ADR 0060; ADR 0085, falhas 2 e 3).
  it.each(ALL_PROFILES)('P3: %s não troca nem cria contato do Cliente pela API', (profile) => {
    expectDenied(profile, `UPDATE public.customer_contacts SET email = 'desvio-p85@example.test' WHERE id = ${CONTACT_ID}`)
    expectDenied(profile, `UPDATE public.customer_contacts SET deactivated_at = now(), is_primary = false WHERE id = ${CONTACT_ID}`)
    expectDenied(profile, `INSERT INTO public.customer_contacts (customer_id, name, email, is_primary)
      VALUES (${CUSTOMER_ID}, 'Outro P85', 'outro-p85@example.test', true)`)
    expect(psql(`SELECT email || ':' || is_primary FROM public.customer_contacts WHERE id = ${CONTACT_ID};`))
      .toBe('principal-p85@example.test:true')
  })

  it('P3: a tela edita contatos pela RPC (Administrativo, Documentação, Equipamentos) e recusa Financeiro e Operações', () => {
    const contacts = (email: string) => `'[{"id": ${CONTACT_ID}, "name": "Contato P85", "email": "${email}", "is_primary": true, "active": true, "box_codes": []}]'::jsonb`
    for (const profile of ['financeiro', 'operacoes'] as const) {
      const denied = runAs(profile, `SELECT public.internal_save_customer_contact_configuration(${CUSTOMER_ID}, ${contacts('fin-p85@example.test')}, 'Teste P85')`)
      expect(denied.ok).toBe(false)
      expect(denied.error).toMatch(/Permissão negada/)
    }
    const saved = runAs('documentacao', `SELECT public.internal_save_customer_contact_configuration(${CUSTOMER_ID}, ${contacts('novo-p85@example.test')}, 'Teste P85')`)
    expect(saved.error).toBe('')
    expect(psql(`SELECT email FROM public.customer_contacts WHERE id = ${CONTACT_ID};`)).toBe('novo-p85@example.test')
    psql(`UPDATE public.customer_contacts SET email = 'principal-p85@example.test' WHERE id = ${CONTACT_ID};`)
  })

  it.each(ALL_PROFILES)('P3: %s não marca o B/L como faturado pela API', (profile) => {
    const result = runAs(profile, `UPDATE public.bls SET financial_status = 'invoiced' WHERE id = '${BL}'`)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/situação financeira do B\/L P85-BL1 muda só pela emissão/)
    expect(psql(`SELECT financial_status FROM public.bls WHERE id = '${BL}';`)).toBe('pending')
    // Outras colunas do B/L seguem graváveis pela API (escrita global, ADR 0046).
    expect(runAs(profile, `UPDATE public.bls SET financial_status = financial_status, consignee = 'P85 ${profile}' WHERE id = '${BL}'`).error).toBe('')
  })

  it('P3: B/L novo pela API nasce pendente; a baixa legada roda como dono', () => {
    const inserted = runAs('documentacao', `INSERT INTO public.bls (id, voyage_id, financial_status) VALUES ('P85-BL2', ${VOYAGE_ID}, 'paid')`)
    expect(inserted.ok).toBe(false)
    expect(psql(`SELECT prosecdef FROM pg_proc WHERE proname = 'register_invoice_payment';`)).toBe('t')
  })

  // P15 — faturas, pagamentos e recebíveis só pelas RPCs (ADR 0077; ADR 0085, falha 5).
  it.each(ALL_PROFILES)('P15: %s não escreve fatura, pagamento, recebível nem numeração pela API', (profile) => {
    expectDenied(profile, `INSERT INTO public.payments (invoice_id, amount_brl, payment_method) VALUES (${INVOICE_ID}, 1500, 'pix')`)
    expectDenied(profile, `UPDATE public.invoices SET status = 'paid', balance_brl = 0, total_paid_brl = 1500 WHERE id = ${INVOICE_ID}`)
    expectDenied(profile, `UPDATE public.invoices SET status = 'cancelled' WHERE id = ${INVOICE_ID}`)
    expectDenied(profile, `UPDATE public.invoice_items SET total_value_brl = 1 WHERE id = ${INVOICE_ITEM_ID}`)
    expectDenied(profile, `UPDATE public.bl_receivables SET status = 'paid' WHERE id = ${RECEIVABLE_ID}`)
    expectDenied(profile, `INSERT INTO public.ledger_settlements (receivable_id, amount_brl) VALUES (${RECEIVABLE_ID}, 1500)`)
    expectDenied(profile, `UPDATE public.invoice_counters SET last_number = 0 WHERE year = ${COUNTER_YEAR}`)
    expectDenied(profile, `DELETE FROM public.invoice_lifecycle_events WHERE id = ${LIFECYCLE_ID}`)
    expectDenied(profile, `DELETE FROM public.invoice_bls WHERE invoice_id = ${INVOICE_ID}`)
    expectDenied(profile, `DELETE FROM public.invoice_receivable_links WHERE invoice_id = ${INVOICE_ID}`)
    expectDenied(profile, `INSERT INTO public.billing_batches (customer_id) VALUES (${CUSTOMER_ID})`)
    expect(psql(`SELECT status || ':' || balance_brl FROM public.invoices WHERE id = ${INVOICE_ID};`)).toBe('issued:1500.00')
    expect(psql(`SELECT count(*) FROM public.payments WHERE invoice_id = ${INVOICE_ID};`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.invoice_lifecycle_events WHERE id = ${LIFECYCLE_ID};`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.invoice_bls WHERE invoice_id = ${INVOICE_ID};`)).toBe('1')
  })

  it('P15: a leitura das faturas continua global', () => {
    for (const profile of ALL_PROFILES) {
      expect(runAs(profile, `SELECT count(*) FROM public.invoices WHERE id = ${INVOICE_ID}`).output).toBe('1')
      expect(runAs(profile, `SELECT count(*) FROM public.invoice_lifecycle_events WHERE invoice_id = ${INVOICE_ID}`).output).toBe('1')
    }
  })

  // A21 — o caminho legado de contas do Portal sai (ADR 0083, item 21).
  it('A21: RPCs legadas e tabela de sessões antigas não existem; ninguém escreve em customer_portal_accounts pela API', () => {
    expect(psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('upsert_customer_portal_account', 'set_customer_portal_account_active');`)).toBe('0')
    expect(psql(`SELECT to_regclass('public.customer_portal_sessions') IS NULL;`)).toBe('t')
    expect(psql(`SELECT count(*) FROM cron.job WHERE jobname = 'cleanup-portal-sessions';`)).toBe('0')
    for (const profile of ALL_PROFILES) {
      expectDenied(profile, `UPDATE public.customer_portal_accounts SET active = true, account_situation = 'ativo' WHERE customer_id = ${CUSTOMER_ID}`)
      expectDenied(profile, `INSERT INTO public.customer_portal_accounts (customer_id) VALUES (${CUSTOMER_ID})`)
      expectDenied(profile, `DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID}`)
    }
    expect(psql(`SELECT cmd FROM pg_policies WHERE tablename = 'customer_portal_accounts';`)).toBe('SELECT')
  })

  // B25 (migration arquivada 203; migration 265): o backfill e o pré-voo do provisionamento do Portal não existem.
  it('B25: portal_provisioning_backfill e portal_provisioning_preflight saíram do catálogo', () => {
    expect(psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('portal_provisioning_backfill', 'portal_provisioning_preflight');`)).toBe('0')
  })

  // P10 (ADR 0030; ADR 0085, funções sem tela; migration 266).
  it('P10: a função sem tela add_agency_report_occurrence saiu do banco', () => {
    expect(psql(`SELECT count(*) FROM pg_proc WHERE proname = 'add_agency_report_occurrence';`)).toBe('0')
  })

  // A7 + P1 — escala com B/L não se exclui; exclusão só pela RPC (ADR 0083, item 7; ADR 0085, falha 4).
  it.each(ALL_PROFILES)('P1: %s não apaga pela API escala, Baplie, programação nem cadastro', (profile) => {
    for (const table of ['voyage_export_schedules', 'baplie_containers', 'vessel_schedules', 'vessels', 'carriers', 'ports',
      'charge_tables', 'granite_bls', 'vazios_manifests', 'import_batches', 'voyage_route_ce_master', 'bl_freight_lines',
      'alerts', 'pricing_rule_versions', 'customer_reconciliation_queue', 'billing_runs']) {
      expectDenied(profile, `DELETE FROM public.${table} WHERE false`)
    }
    expect(psql(`SELECT count(*) FROM public.voyage_export_schedules WHERE voyage_id = ${VOYAGE_ID};`)).toBe('2')
    expect(psql(`SELECT count(*) FROM public.charge_tables WHERE id = ${TABLE_ID};`)).toBe('1')
  })

  it('A7: delete_escala recusa a escala com B/L, na prévia e na execução', () => {
    const preview = JSON.parse(runAs('administrativo', `SELECT public.delete_escala(${VOYAGE_ID}, '${POD}', true, NULL)`).output) as { deletable: boolean; reasons: string[] }
    expect(preview.deletable).toBe(false)
    expect(preview.reasons).toContain('B/L vinculado à escala')
    const executed = JSON.parse(runAs('administrativo', `SELECT public.delete_escala(${VOYAGE_ID}, '${POD}', false, 'Escala errada P85')`).output) as { deleted: boolean }
    expect(executed.deleted).toBe(false)
    expect(psql(`SELECT count(*) FROM public.voyage_export_schedules WHERE voyage_id = ${VOYAGE_ID} AND pol = '${POD}';`)).toBe('1')
  })

  it('A7: delete_escala segue excluindo a escala sem B/L nem Trava, com motivo', () => {
    expect(runAs('operacoes', `SELECT public.delete_escala(${VOYAGE_ID}, 'P85XX', false, 'Escala errada P85')`).ok).toBe(false)
    const executed = JSON.parse(runAs('administrativo', `SELECT public.delete_escala(${VOYAGE_ID}, 'P85XX', false, 'Escala errada P85')`).output) as { deleted: boolean }
    expect(executed.deleted).toBe(true)
    expect(psql(`SELECT count(*) FROM public.voyage_export_schedules WHERE voyage_id = ${VOYAGE_ID} AND pol = 'P85XX';`)).toBe('0')
    psql(`INSERT INTO public.voyage_export_schedules (voyage_id, pol) VALUES (${VOYAGE_ID}, 'P85XX');`)
  })

  it('P1: delete_catalog_row segue excluindo cadastro sem uso, com motivo', () => {
    psql(`INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, currency) VALUES (99085014, ${TABLE_ID}, 'Item sem uso P85', 'bl', 10, 'BRL');`)
    const removed = runAs('administrativo', `SELECT public.delete_catalog_row('charge_table_items', '99085014', 'Item criado por engano P85')`)
    expect(removed.error).toBe('')
    expect(psql(`SELECT count(*) FROM public.charge_table_items WHERE id = 99085014;`)).toBe('0')
  })

  // P13 — Baplie sem container recusado no banco (ADR 0085, D15).
  it.each(ALL_PROFILES)('P13: %s importa Baplie vazio pela API → recusado, Baplie anterior intacto', (profile) => {
    for (const rows of [`'[]'::jsonb`, 'NULL::jsonb', `'{}'::jsonb`]) {
      const result = runAs(profile, `SELECT public.import_baplie_staging_transactional(${VOYAGE_ID}, ${rows})`)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/O Baplie não tem nenhum container/)
    }
    expect(psql(`SELECT string_agg(container_number, ',') FROM public.baplie_containers WHERE voyage_id = ${VOYAGE_ID};`)).toBe('PCCU8500001')
  })

  // P11 — o autor é quem está logado (ADR 0085, regra base 2; migration 241).
  it('P11: nem o Administrativo assina escrita em nome de outro usuário', () => {
    const other = PROFILES.financeiro
    const calls = [
      `SELECT public.add_manual_bl_charge('${BL}', ${ITEM_MANUAL}, 1, 'Autor forjado P85', '${other}')`,
      `SELECT public.calculate_bl_local_charges('${BL}', '${other}', true)`,
      `SELECT public.cancel_invoice(${INVOICE_ID}, 'Autor forjado P85', '${other}')`,
      `SELECT public.register_ledger_invoice_payment(${INVOICE_ID}, 10, 'pix', now(), NULL, 'manual', 'Autor forjado P85', '${other}', gen_random_uuid())`,
      `SELECT public.create_local_consolidated_invoice(${CUSTOMER_ID}, ARRAY[${RECEIVABLE_ID}]::bigint[], 'Autor forjado P85', '${other}')`,
      `SELECT public.mark_bl_ready_and_create_invoice('${BL}', ${CUSTOMER_ID}, 'Autor forjado P85', '${other}')`,
      `SELECT public.reverse_demurrage_payment(${DEM_INVOICE_ID}, 'Autor forjado P85', '${other}')`,
    ]
    for (const sql of calls) {
      const result = runAs('administrativo', sql)
      expect(result.ok, sql).toBe(false)
      expect(result.error, sql).toMatch(/Autor informado difere do usuário da sessão/)
    }
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${INVOICE_ID};`)).toBe('issued')
    // O próprio usuário (ou nenhum autor) segue para a regra da RPC.
    const own = runAs('administrativo', `SELECT public.add_manual_bl_charge('${BL}', ${ITEM_MANUAL}, 1, 'Autor certo P85', '${PROFILES.administrativo}')`)
    expect(own.error).not.toMatch(/Autor informado difere/)
    psql(`SET session_replication_role = replica; DELETE FROM public.charge_calculations WHERE bl_id = '${BL}' AND notes = 'Autor certo P85'; SET session_replication_role = origin;`)
  })

  // A9 + P4 — emissão por qualquer Departamento (ADR 0083, item 9; ADR 0085, D3; migration 246).
  it.each(ALL_PROFILES)('A9: %s emite fatura avulsa em nome próprio, com rastro', (profile) => {
    const result = runAs(profile, `SELECT public.create_manual_invoice(${CUSTOMER_ID}, 'Avulsa P4 ${profile}', 1, 10, NULL, NULL, NULL, '${PROFILES[profile]}')`)
    expect(result.error).toBe('')
    const invoiceId = (JSON.parse(result.output) as { invoice_id: number }).invoice_id
    expect(psql(`SELECT invoice_type || ':' || total_brl FROM public.invoices WHERE id = ${invoiceId};`)).toBe('manual:10.00')
    expect(psql(`SELECT count(*) FROM public.invoice_lifecycle_events WHERE invoice_id = ${invoiceId};`)).not.toBe('0')
  })

  it.each(ALL_PROFILES)('P4: %s passa da guarda de perfil em todas as RPCs de emissão e correção', (profile) => {
    // Entradas inexistentes: a recusa vem da regra de negócio, nunca do perfil.
    const calls = [
      `SELECT public.mark_bl_ready_and_create_invoice('P85-NAO-EXISTE')`,
      `SELECT public.mark_bls_ready_and_create_invoice(ARRAY['P85-NAO-EXISTE'], ${CUSTOMER_ID})`,
      `SELECT public.create_invoice_from_bls_with_ledger(ARRAY['P85-NAO-EXISTE'], ${CUSTOMER_ID})`,
      `SELECT public.create_local_consolidated_invoice(${CUSTOMER_ID}, ARRAY[-1]::bigint[])`,
      `SELECT public.issue_demurrage_invoice_for_bl('P85-NAO-EXISTE', 'P85-DEM-X')`,
      `SELECT public.retry_pending_consolidated_reissue(-1)`,
      `SELECT public.retry_invoice_basis_changes('P85-NAO-EXISTE')`,
      `SELECT public.resolve_stale_invoice(-1, 'Conferida P4')`,
    ]
    for (const call of calls) {
      const result = runAs(profile, call)
      expect(result.error, `${profile}: ${call}`).not.toMatch(/sem permiss|Credenciais invalidas|Sem permissão/i)
    }
  })

  // P5 — baixa, Restituição, desconto e Conciliação PIX (ADR 0085, base, D2, D4, D5; migration 247).
  const PERMISSION_DENIED = /sem permiss|Credenciais invalidas|Somente o Administrativo/i
  const FINANCE = new Set<Profile>(['administrativo', 'financeiro'])
  const P5_SETTLE = [
    `SELECT public.register_verified_invoice_payment(-1, 10, 'pix', now(), NULL, NULL, 'P5 baixa')`,
    `SELECT public.register_invoice_payment(-1, 10, 'pix', now(), NULL, NULL)`,
    `SELECT public.register_ledger_invoice_payment(-1, 10, 'pix', now(), NULL, 'manual', NULL, NULL, gen_random_uuid())`,
    `SELECT public.link_pix_reconciliation_candidate(-1, 'local', -1, NULL)`,
    `SELECT public.resolve_pix_reconciliation_exception(-1, 'P5-TXID', NULL, NULL, 'Encerrada no teste P5')`,
    `SELECT public.upsert_pix_reconciliation_exceptions('p5-extrato', '[]'::jsonb)`,
    `SELECT public.itau_pix_mark_receipt_handled('P5-E2E-NAO-EXISTE', 'Tratado no teste P5 por perfil')`,
    `SELECT public.reconcile_invoice_payment_by_txid('P5-TXID-NAO-EXISTE', 1, now())`,
    `SELECT public.confirm_unified_pix_matches('[]'::jsonb)`,
  ]
  const P5_READ = [
    `SELECT public.list_pix_reconciliation_exceptions(NULL)`,
    `SELECT public.list_pix_reconciliation_candidates(-1)`,
    `SELECT public.list_local_pix_candidates(ARRAY['P5-TXID'])`,
    `SELECT public.list_pix_txid_candidates(ARRAY['P5-TXID'])`,
    `SELECT public.itau_pix_monitor()`,
  ]
  const P5_ANY = [
    `SELECT public.request_financial_refund('manual', -1, 10, 'Justificativa da restituição P5', 'correction', gen_random_uuid())`,
    `SELECT public.cancel_financial_refund_authorization('manual', -1, 'Justificativa do cancelamento P5')`,
    `SELECT public.apply_demurrage_discount(gen_random_uuid(), -1, 'percent', 10, NULL, 'Desconto P5 por perfil', NULL)`,
  ]

  it.each(ALL_PROFILES)('P5: baixa manual e conciliar PIX só para Financeiro e Administrativo (%s)', (profile) => {
    for (const call of P5_SETTLE) {
      const result = runAs(profile, call)
      if (FINANCE.has(profile)) expect(result.error, `${profile}: ${call}`).not.toMatch(PERMISSION_DENIED)
      else expect(result.error, `${profile}: ${call}`).toMatch(PERMISSION_DENIED)
    }
  })

  it.each(ALL_PROFILES)('P5: %s lê a Conciliação, autoriza restituição e aplica desconto', (profile) => {
    for (const call of [...P5_READ, ...P5_ANY]) {
      expect(runAs(profile, call).error, `${profile}: ${call}`).not.toMatch(PERMISSION_DENIED)
    }
  })

  it('P5: Pix não conciliado, Fatura desatualizada e Restituição pendente avisam o Financeiro', () => {
    expect(psql(`SELECT string_agg(type, ',' ORDER BY type) FROM public.alert_type_catalog
      WHERE type IN ('pix_unreconciled', 'fatura_desatualizada', 'restituicao_pendente') AND 'financeiro' = ANY(audience_departments)
        AND 'administrativo' = ANY(audience_departments);`)).toBe('fatura_desatualizada,pix_unreconciled,restituicao_pendente')
  })

  // A18 + P12 — leitura global nas telas restantes (ADR 0085, D11, D12, D16, D17; migration 250).
  it.each(ALL_PROFILES)('P12: %s lê o Desbloqueio de CE com os documentos, as Disputas e o histórico do Portal', (profile) => {
    const reads = [
      `SELECT public.ce_unlock_read('model', '{}'::jsonb)`,
      `SELECT public.list_demurrage_disputes_internal(NULL)`,
      `SELECT public.portal_list_provisioning_events(${CUSTOMER_ID}, 10)`,
    ]
    for (const call of reads) {
      expect(runAs(profile, call).error, `${profile}: ${call}`).toBe('')
    }
    // O documento inexistente é recusado pelo documento, não pelo perfil.
    const document = runAs(profile, `SELECT public.ce_unlock_document_access(gen_random_uuid())`)
    expect(document.error).toMatch(/Documento não autorizado/)
    expect(document.error).not.toMatch(/Acesso negado ao desbloqueio/)
  })

  it.each(ALL_PROFILES)('A18: o console do Portal mostra Email de Recuperação e origem a %s', (profile) => {
    psql(`SET session_replication_role = replica;
      INSERT INTO public.customer_portal_accounts (customer_id, recovery_email, recovery_email_source)
      VALUES (${CUSTOMER_ID}, 'recuperacao-p85@example.test', 'informado_manualmente')
      ON CONFLICT (customer_id) DO UPDATE SET recovery_email = EXCLUDED.recovery_email, recovery_email_source = EXCLUDED.recovery_email_source;
      SET session_replication_role = origin;`)
    const result = runAs(profile, `SELECT row->>'recovery_email' || ':' || (row->>'recovery_email_source') FROM public.portal_list_provisioning_console(${CUSTOMER_ID}) AS row`)
    expect(result.error).toBe('')
    expect(result.output).toBe('recuperacao-p85@example.test:informado_manualmente')
  })

  it('P12: gerir o Desbloqueio de CE e responder Disputas seguem restritos', () => {
    expect(runAs('operacoes', `SELECT public.ce_unlock_read('exports', '{}'::jsonb)`).error).toMatch(/Acesso negado ao desbloqueio/)
    expect(runAs('equipamentos', `SELECT public.ce_unlock_read('exports', '{}'::jsonb)`).error).toMatch(/Acesso negado ao desbloqueio/)
  })

  // P6 — reabrir o ADR e reverter omissão por qualquer Departamento, com motivo (ADR 0085, D8 e D9; migration 251).
  it.each(ALL_PROFILES)('P6: %s reabre o ADR e reverte omissão; sem motivo é recusado', (profile) => {
    const user = PROFILES[profile]
    const calls = [
      `SELECT public.reopen_agency_departure_report(${VOYAGE_ID}, 'SSZ', 'motivo')`,
      `SELECT public.reopen_agency_departure_report_by_report_id(gen_random_uuid(), ${VOYAGE_ID}, 'SSZ', 'motivo')`,
      `SELECT public.revert_voyage_omission(-1, 'motivo', '${user}')`,
    ]
    for (const call of calls) {
      const result = runAs(profile, call)
      expect(result.ok, `${profile}: ${call}`).toBe(false)
      expect(result.error, `${profile}: ${call}`).not.toMatch(/sem permiss|Somente/i)
    }
    expect(runAs(profile, `SELECT public.reopen_agency_departure_report(${VOYAGE_ID}, 'SSZ', '  ')`).error).toMatch(/exige justificativa/)
    expect(runAs(profile, `SELECT public.revert_voyage_omission(-1, '', '${user}')`).error).toMatch(/exige justificativa/)
    expect(runAs(profile, `SELECT public.revert_voyage_omission(-1, 'motivo', '${PROFILES.administrativo === user ? PROFILES.financeiro : PROFILES.administrativo}')`).error)
      .toMatch(/proprio usuario/)
  })

  // P7 — reprocessar efeito de importação por qualquer Departamento (ADR 0085, D10; migration 252).
  it.each(ALL_PROFILES)('P7: %s reprocessa efeito de importação; sem justificativa é recusado', (profile) => {
    // O efeito inexistente é recusado pelo efeito, não pelo perfil.
    expect(runAs(profile, `SELECT public.retry_import_effect(-1, 'motivo')`).error).toMatch(/nao encontrado/)
    expect(runAs(profile, `SELECT public.retry_import_effect(-1, ' ')`).error).toMatch(/Justificativa obrigatoria/)
  })

  // P8 — Central de Informações do Portal por qualquer Departamento (ADR 0085, D7; migration 253).
  it.each(ALL_PROFILES)('P8: %s grava na Central de Informações, em todos os tipos', (profile) => {
    for (const kind of ['depot', 'agent', 'contact', 'carrier']) {
      // Dados vazios são recusados pela validação do tipo, não pelo perfil.
      const result = runAs(profile, `SELECT public.internal_save_portal_information('${kind}', '{}'::jsonb)`)
      expect(result.ok, `${profile}: ${kind}`).toBe(false)
      expect(result.error, `${profile}: ${kind}`).not.toMatch(/Sem permissão para alterar/)
    }
  })

  // P9 — tarifa e acordo de Demurrage por qualquer Departamento; ativar, desativar e excluir só o Administrativo
  // (ADR 0085, D6; ADR 0073, item 4; migration 254).
  it.each(ALL_PROFILES)('P9: %s cria e edita tarifa e acordo de Demurrage pela API; a troca de ativa é do Administrativo', (profile) => {
    const note = `p9-${profile}`
    try {
      const rate = runAs(profile, `INSERT INTO public.demurrage_rates (container_type, free_days, p1_day_from, p1_day_to, p1_usd, p2_day_from, p2_usd, valid_from, notes)
        VALUES ('P9X', 7, 8, 14, 10, 15, 20, '2099-01-01', '${note}') RETURNING id`)
      expect(rate.error).toBe('')
      const agreement = runAs(profile, `INSERT INTO public.customer_demurrage_agreements (customer_id, free_days, valid_from, notes)
        VALUES (${CUSTOMER_ID}, 10, '2099-01-01', '${note}') RETURNING id`)
      expect(agreement.error).toBe('')
      for (const table of ['demurrage_rates', 'customer_demurrage_agreements']) {
        expect(runAs(profile, `UPDATE public.${table} SET free_days = 9 WHERE notes = '${note}'`).error).toBe('')
        const toggle = runAs(profile, `UPDATE public.${table} SET active = false WHERE notes = '${note}'`)
        if (profile === 'administrativo') expect(toggle.error).toBe('')
        else expect(toggle.error).toMatch(/Somente o Administrativo desativa/)
        expectDenied(profile, `DELETE FROM public.${table} WHERE notes = '${note}'`)
      }
    } finally {
      psql(`DELETE FROM public.customer_demurrage_agreements WHERE notes = '${note}'; DELETE FROM public.demurrage_rates WHERE notes = '${note}';`)
    }
  })

  // B13 — reativar cadastro pede motivo, gravado no rastro; segue do Administrativo (ADR 0072; ADR 0073, item 4; migration 261).
  it.each(ALL_PROFILES)('B13: %s reativa tarifa só como Administrativo e com motivo', (profile) => {
    const note = `b13-${profile}`
    const id = psql(`INSERT INTO public.demurrage_rates (container_type, free_days, p1_day_from, p1_day_to, p1_usd, p2_day_from, p2_usd, valid_from, notes, active)
      VALUES ('B13X', 7, 8, 14, 10, 15, 20, '2099-01-01', '${note}', false) RETURNING id;`)
    try {
      const call = (reason: string) => runAs(profile, `SELECT public.reactivate_catalog_row('demurrage_rates', '${id}', '${reason}')`)
      if (profile !== 'administrativo') {
        expect(call('motivo').error).toMatch(/Somente o Administrativo reativa/)
        return
      }
      expect(call(' ').error).toMatch(/Informe o motivo/)
      expect(call('cliente voltou a operar').error).toBe('')
      expect(psql(`SELECT active FROM public.demurrage_rates WHERE id = ${id};`)).toBe('t')
      expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_type = 'demurrage_rates' AND entity_id = '${id}' AND field_name = 'reativado';`))
        .toBe('cliente voltou a operar')
    } finally {
      psql(`DELETE FROM public.audit_logs WHERE entity_type = 'demurrage_rates' AND entity_id = '${id}'; DELETE FROM public.demurrage_rates WHERE id = ${id};`)
    }
  })

  // B15 — desativar e reativar Local e serviço do Local são do Administrativo; reativar pede motivo (ADR 0073, item 8; migration 263).
  it.each(ALL_PROFILES)('B15: %s só desativa e reativa Local e serviço como Administrativo', (profile) => {
    const code = `B15${profile.slice(0, 3).toUpperCase()}`
    const depotId = psql(`INSERT INTO public.depots (code, name, active, tipo) VALUES ('${code}', 'B15 ${profile}', true, 'depot') RETURNING id;`)
    const serviceId = psql(`INSERT INTO public.depot_services (depot_id, name, natureza, rate_brl) VALUES ('${depotId}', 'B15 geral', 'geral', 1) RETURNING id;`)
    try {
      for (const [table, id] of [['depots', depotId], ['depot_services', serviceId]]) {
        const off = runAs(profile, `UPDATE public.${table} SET active = false WHERE id = '${id}'`)
        if (profile !== 'administrativo') {
          expect(off.error, `${profile}: ${table}`).toMatch(/Somente o Administrativo desativa ou reativa/)
          expect(runAs(profile, `SELECT public.reactivate_catalog_row('${table}', '${id}', 'motivo')`).error).toMatch(/Somente o Administrativo reativa/)
          continue
        }
        expect(off.error).toBe('')
        expect(runAs(profile, `UPDATE public.${table} SET active = true WHERE id = '${id}'`).error).toBe('')
        psql(`UPDATE public.${table} SET active = false WHERE id = '${id}';`)
        expect(runAs(profile, `SELECT public.reactivate_catalog_row('${table}', '${id}', 'voltou a operar')`).error).toBe('')
        expect(psql(`SELECT active FROM public.${table} WHERE id = '${id}';`)).toBe('t')
      }
      // Fora do Administrativo, editar os demais campos segue liberado.
      expect(runAs(profile, `UPDATE public.depots SET name = 'B15 editado' WHERE id = '${depotId}'`).error).toBe('')
    } finally {
      psql(`SET session_replication_role = replica;
        DELETE FROM public.audit_logs WHERE entity_id IN ('${depotId}', '${serviceId}');
        DELETE FROM public.depot_services WHERE id = '${serviceId}'; DELETE FROM public.depots WHERE id = '${depotId}';
        SET session_replication_role = origin;`)
    }
  })

  // P14 (ADR 0085, Consequências): percorre as linhas de exceção da matriz de Segurança
  // (docs/operations/seguranca.md#modelo-de-permissões-por-perfil) que não têm caso próprio acima.
  // Cada chamada usa registro inexistente ou valor inválido: quem tem o perfil passa da checagem
  // e cai na validação do registro; quem não tem é recusado com 42501 (privilégio).
  const ADM: Profile[] = ['administrativo']
  const FIN: Profile[] = ['administrativo', 'financeiro']
  const MATRIX_EXCEPTIONS: Array<{ row: string; allowed: Profile[]; call: string }> = [
    { row: 'Cancelar viagem', allowed: ADM, call: `public.cancel_voyage(-1, 'motivo', '{actor}')` },
    { row: 'Reativar viagem', allowed: ADM, call: `public.reactivate_voyage(-1, 'motivo')` },
    { row: 'Cancelar B/L', allowed: ADM, call: `public.cancel_bl('P14-INEXISTENTE', 'motivo', false)` },
    { row: 'Reativar B/L', allowed: ADM, call: `public.reactivate_bl('P14-INEXISTENTE', 'motivo')` },
    { row: 'Excluir taxa manual do B/L', allowed: ADM, call: `public.delete_manual_bl_charge(-1, '{actor}')` },
    { row: 'Excluir viagem com Trava', allowed: ADM, call: `public.delete_records('voyages', ARRAY['-1'], true, 'motivo')` },
    { row: 'Excluir escala', allowed: ADM, call: `public.delete_escala(-1, 'BRZZZ', true, 'motivo')` },
    { row: 'Cancelar baixa', allowed: ADM, call: `public.reverse_invoice_payment(-1, 'motivo', '{actor}')` },
    { row: 'Cancelar fatura', allowed: ADM, call: `public.cancel_invoice(-1, 'motivo', '{actor}')` },
    { row: 'Cancelar fatura consolidada', allowed: ADM, call: `public.obsolete_consolidated_invoice(-1, 'motivo', '{actor}')` },
    { row: 'Preparar cancelamento financeiro de B/L', allowed: ADM, call: `public.prepare_bl_financial_cancellation(-1, 'P14-INEXISTENTE', 'motivo')` },
    { row: 'Cancelar Invoice de Demurrage', allowed: ADM, call: `public.cancel_demurrage_invoice('{actor}', -1, 'motivo')` },
    { row: 'Cancelar baixa de Demurrage', allowed: ADM, call: `public.reverse_demurrage_payment(-1, 'motivo', '{actor}')` },
    { row: 'Intervalo da Régua', allowed: ADM, call: `public.set_demurrage_dunning_interval_days(0)` },
    { row: 'Desativar Cliente', allowed: ADM, call: `public.deactivate_customer(-1, 'motivo', true)` },
    { row: 'Reativar Cliente', allowed: ADM, call: `public.reactivate_customer(-1, 'motivo')` },
    { row: 'Trocar o CNPJ do Portal', allowed: ADM, call: `public.portal_admin_change_cnpj(-1, '00000000000000', 'motivo')` },
    { row: 'Conceder Liberação de faturamento', allowed: ADM, call: `public.grant_customer_billing_portal_release(-1, 'motivo', now() + interval '1 day')` },
    { row: 'Revogar Liberação de faturamento', allowed: ADM, call: `public.revoke_customer_billing_portal_release(-1, 'motivo')` },
    { row: 'Registrar a Restituição (fatura)', allowed: FIN, call: `public.confirm_invoice_refund(-1, 'comprovante', 'favorecido', now())` },
    { row: 'Registrar a Restituição (Demurrage)', allowed: FIN, call: `public.confirm_demurrage_refund(-1, 'comprovante', 'favorecido', now())` },
    { row: 'Liquidar Ajuste de COD', allowed: FIN, call: `public.settle_cod_adjustment(-1, '{actor}', NULL, 'motivo')` },
    { row: 'Baixa de Invoice de Demurrage', allowed: FIN, call: `public.register_demurrage_payment('{actor}', -1, current_date, 'motivo', 1, 1)` },
    { row: 'Informar PTAX', allowed: ['administrativo', 'financeiro', 'equipamentos'], call: `public.recalculate_demurrage_invoices_manual(0)` },
    { row: 'Responder Disputa', allowed: ['administrativo', 'equipamentos'], call: `public.add_demurrage_dispute_message(-1, 'mensagem', 'invalido')` },
    { row: 'Reabrir Disputa', allowed: ['administrativo', 'equipamentos'], call: `public.reopen_demurrage_dispute(-1, 'motivo')` },
  ]

  function sqlstateAs(profile: Profile, call: string): string {
    const body = call.replaceAll('{actor}', PROFILES[profile])
    const result = runAs(profile, `DO $p14$ BEGIN PERFORM ${body}; RAISE NOTICE 'P14:OK'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'P14:%', SQLSTATE; END $p14$`)
    return result.error.match(/P14:([0-9A-Z]+)/)?.[1] ?? `sem-resultado: ${result.error}`
  }

  it.each(MATRIX_EXCEPTIONS)('P14: $row — só $allowed passa da checagem de perfil', ({ allowed, call }) => {
    for (const profile of ALL_PROFILES) {
      const state = sqlstateAs(profile, call)
      if (allowed.includes(profile)) expect(state, `${profile}: ${call}`).not.toBe('42501')
      else expect(state, `${profile}: ${call}`).toBe('42501')
    }
  })

  it('P11: sem usuário na sessão (job com service_role) o autor informado vale', () => {
    expect(psql(`SET request.jwt.claim.role = 'service_role'; SELECT public._assert_actor_is_caller('${PROFILES.financeiro}'); SELECT 'ok';`)).toBe('ok')
  })
})

