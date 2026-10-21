// Migration 190 — correções da revisão da PR 929 (plano de correção das
// importações e do CE Mercante). Cada caso falha sem a migration:
// - funções internas da 176/178/179 não são executáveis por `authenticated`;
// - a conferência do Baplie lê as escalas por `list_voyage_eligible_pods`;
// - a planilha de datas aceita o segundo B/L que divide o container;
// - UPDATE em itens de carga solta não esbarra na modalidade de carga;
// - a ATA da Viagem não preenche a descarga;
// - o Alerta de fila parada reconcilia no pg_cron, sem JWT;
// - a fatura de B/L e de Granito da Viagem Cancelada pode ser cancelada, e
//   consolidada e avulsa não nascem nela;
// - o NOA automático ignora a Viagem Cancelada;
// - efeito de B/L Cancelado sai como `superseded`; `vehicle_followup` não
//   cancela fatura com pagamento;
// - o primeiro contexto de importação da transação vale até o fim.
// Migration 197: o status de Demurrage "em atraso" volta a ser gravado.
// Migration 200: container de B/L ou de Viagem Cancelados sai do atraso.
// Migration 201: a planilha de datas confere a prévia que viu a descarga vazia.
//
// Namespace exclusivo: ids 99190xxx, B/Ls 'R190-*', usuário ...000000190001.
// A limpeza roda com `session_replication_role = replica`, porque a Viagem
// Cancelada recusa mudança nas linhas dela.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 366: estas RPCs antigas saíram da API (só `service_role`); o
// teste as chama como o servidor, com os claims do usuário (RESET ROLE), como
// fazem as RPCs de lote da tela.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000190001'
const carrierId = 99190001
const vesselId = 99190002
const voyageId = 99190003
const cancelledVoyageId = 99190004
const customerId = 99190005
const contactId = 99190006
const overdueVoyageId = 99190007
const blInvoiceId = 99190010
const graniteInvoiceId = 99190011
const paidInvoiceId = 99190012
const graniteManifestId = '00000000-0000-0000-0000-000000190051'
const graniteBlId = '00000000-0000-0000-0000-000000190052'
const bl = {
  shareA: 'R190-SHA',
  shareB: 'R190-SHB',
  breakbulk: 'R190-BB',
  cancelledVoyage: 'R190-CV',
  cancelledBl: 'R190-CB',
  overdue: 'R190-OVD',
  overdueVoyage: 'R190-OVC',
}
const allBls = Object.values(bl)
const sharedContainer = 'RVCU1900001'
const blList = allBls.map((id) => `'${id}'`).join(', ')

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function run(sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' })
}

function asService(sql: string) {
  return run(`SET request.jwt.claim.role = 'service_role'; ${sql}`)
}

function asAdmin(sql: string) {
  return run(`
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${adminId}';
    ${sql};
    COMMIT;
  `)
}

function lastJson<T>(stdout: string): T {
  const line = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{') || l.startsWith('[')).at(-1)
  return JSON.parse(line ?? 'null') as T
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.list_voyage_eligible_pods(bigint)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 190 (list_voyage_eligible_pods)')

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${customerId}:%';
    DELETE FROM public.payments WHERE invoice_id IN (${blInvoiceId}, ${graniteInvoiceId}, ${paidInvoiceId});
    DELETE FROM public.invoice_receivable_links WHERE bl_id IN (${blList});
    DELETE FROM public.invoice_granite_bls WHERE invoice_id = ${graniteInvoiceId};
    DELETE FROM public.invoice_bls WHERE bl_id IN (${blList});
    DELETE FROM public.invoice_document_snapshots WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoices WHERE customer_id = ${customerId};
    DELETE FROM public.bl_receivables WHERE bl_id IN (${blList});
    -- 355/372: o recálculo automático (base nova, ETA) grava cálculo do B/L.
    DELETE FROM public.charge_calculations WHERE bl_id IN (${blList});
    -- 378: o primeiro cálculo fixa o preço e registra a versão da regra.
    DELETE FROM public.bl_price_freeze_items WHERE bl_id IN (${blList});
    DELETE FROM public.bl_price_freezes WHERE bl_id IN (${blList});
    DELETE FROM public.bl_charge_table_links WHERE bl_id IN (${blList});
    DELETE FROM public.pricing_rule_versions WHERE customer_id = ${customerId};
    DELETE FROM public.bl_breakbulk_items WHERE bl_id IN (${blList});
    DELETE FROM public.bl_containers WHERE bl_id IN (${blList});
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (${blList});
    DELETE FROM public.bls WHERE id IN (${blList});
    DELETE FROM public.granite_bls WHERE id = '${graniteBlId}';
    DELETE FROM public.granite_manifests WHERE id = '${graniteManifestId}';
    CREATE TEMP TABLE r190_alerts AS SELECT id FROM public.alerts
      WHERE type IN ('import_effects_queue_stalled', 'import_effect_blocked')
        AND (entity_type = 'import_effect_queue' OR entity_id IN (SELECT id::text FROM public.import_pending_effects WHERE entity_id IN (${blList})));
    CREATE TEMP TABLE r190_items AS SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM r190_alerts);
    DELETE FROM public.internal_notifications WHERE alert_item_id IN (SELECT id FROM r190_items) OR alert_id IN (SELECT id FROM r190_alerts);
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM r190_items);
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM r190_items);
    DELETE FROM public.alert_notification_failures WHERE alert_item_id IN (SELECT id FROM r190_items) OR alert_id IN (SELECT id FROM r190_alerts);
    DELETE FROM public.alert_items WHERE id IN (SELECT id FROM r190_items);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r190_alerts);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id IN (${blList}));
    DELETE FROM public.import_pending_effects WHERE entity_id IN (${blList});
    DELETE FROM public.audit_logs WHERE entity_id IN (${blList}) OR entity_id LIKE '${voyageId}%' OR entity_id LIKE '${cancelledVoyageId}%'
      OR entity_id LIKE '${overdueVoyageId}%' OR changed_by = '${adminId}';
    DELETE FROM public.voyages WHERE id IN (${voyageId}, ${cancelledVoyageId}, ${overdueVoyageId});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customer_contact_box_links WHERE contact_id = ${contactId};
    DELETE FROM public.customer_contacts WHERE id = ${contactId};
    SET session_replication_role = origin;
    SET vela.retention = 'on';
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${customerId}
      OR account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id = ${customerId});
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id = ${customerId});
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id = '${adminId}';
    DELETE FROM auth.users WHERE id = '${adminId}';
  `)
}

describeLocal('Correções da revisão das importações (migration 190)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'r190-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'R190 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${syntheticCnpj(190005)}', 'R190 CLIENTE');
      INSERT INTO public.customer_contacts (id, customer_id, name, email) VALUES (${contactId}, ${customerId}, 'R190 Contato', 'r190-contato@example.test');
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES (${contactId}, 'documentacao_operacao') ON CONFLICT DO NOTHING;
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'R190 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'R190 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyageId}, ${vesselId}, 'R190A', 'active'),
        (${cancelledVoyageId}, ${vesselId}, 'R190C', 'active'),
        (${overdueVoyageId}, ${vesselId}, 'R190D', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status) VALUES
        ('${bl.shareA}', ${voyageId}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated'),
        ('${bl.shareB}', ${voyageId}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated'),
        ('${bl.breakbulk}', ${voyageId}, ${customerId}, 'CNSHA', 'BRSSA', 'carga_solta', 'pending', 'not_calculated'),
        ('${bl.cancelledVoyage}', ${cancelledVoyageId}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated'),
        ('${bl.cancelledBl}', ${voyageId}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated'),
        ('${bl.overdue}', ${voyageId}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated'),
        ('${bl.overdueVoyage}', ${overdueVoyageId}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated');
      UPDATE public.bls SET free_time_override = 5 WHERE id IN ('${bl.overdue}', '${bl.overdueVoyage}');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES
        ('${bl.shareA}', '${sharedContainer}', '40HC'),
        ('${bl.shareB}', '${sharedContainer}', '40HC');
      INSERT INTO public.bl_breakbulk_items (bl_id, item_description) VALUES ('${bl.breakbulk}', 'R190 MAQUINA');
      INSERT INTO public.granite_manifests (id, voyage_id, vessel_voyage) VALUES ('${graniteManifestId}', ${cancelledVoyageId}, 'R190 NAVIO R190C');
      INSERT INTO public.granite_bls (id, manifest_id, bl_number) VALUES ('${graniteBlId}', '${graniteManifestId}', 'R190-GRA-1');
    `)
    // Desde a 363 a Viagem com fatura viva não se cancela: o estado legado
    // (fatura já emitida na Viagem Cancelada) é montado depois do cancelamento.
    const cancelled = asAdmin(`SELECT public.cancel_voyage(${cancelledVoyageId}, 'Armador cancelou a escala (R190)', '${adminId}')`)
    expect(cancelled.status, cancelled.stderr).toBe(0)
    psql(`
      SET session_replication_role = replica;
      UPDATE public.bls SET financial_status = 'invoiced' WHERE id = '${bl.cancelledVoyage}';
      UPDATE public.granite_bls SET charge_status = 'invoiced' WHERE id = '${graniteBlId}';
      INSERT INTO public.invoices (id, invoice_number, customer_id, total_brl, status, bl_id) VALUES
        (${blInvoiceId}, 'R190-INV-BL', ${customerId}, 100, 'issued', '${bl.cancelledVoyage}'),
        (${graniteInvoiceId}, 'R190-INV-GRA', ${customerId}, 100, 'issued', NULL),
        (${paidInvoiceId}, 'R190-INV-PAGA', ${customerId}, 100, 'paid', '${bl.cancelledBl}');
      INSERT INTO public.invoice_bls (invoice_id, bl_id) VALUES (${blInvoiceId}, '${bl.cancelledVoyage}'), (${paidInvoiceId}, '${bl.cancelledBl}');
      INSERT INTO public.invoice_granite_bls (invoice_id, granite_bl_id) VALUES (${graniteInvoiceId}, '${graniteBlId}');
      INSERT INTO public.payments (invoice_id, amount_brl, paid_at) VALUES (${paidInvoiceId}, 100, now());
      UPDATE public.bls SET cancelled_at = now(), financial_status = 'paid' WHERE id = '${bl.cancelledBl}';
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('funções internas de rateio, grupo de Demurrage e fila não são executáveis por authenticated', () => {
    const grants = psql(`
      SELECT string_agg(has_function_privilege('authenticated', f, 'EXECUTE')::text, ',' ORDER BY f)
      FROM unnest(ARRAY[
        'public.bl_container_share_signature(text)',
        'public.demurrage_group_anchor(text)',
        'public.demurrage_group_bl_ids(text)',
        'public.import_effects_queue_health()'
      ]) AS f
    `)
    expect(grants).toBe('false,false,false,false')
    const attempt = asAdmin(`SELECT public.bl_container_share_signature('${bl.shareA}')`)
    expect(attempt.stderr).toMatch(/permission denied/)
  })

  it('a conferência do Baplie lê as escalas da Viagem como usuário interno', () => {
    expect(psql(`SELECT has_function_privilege('anon', 'public.list_voyage_eligible_pods(bigint)', 'EXECUTE')`)).toBe('f')
    const pods = asAdmin(`SELECT count(*) FROM public.list_voyage_eligible_pods(${voyageId})`)
    expect(pods.status, pods.stderr).toBe(0)
    const portalLike = run(`
      BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated';
      SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000190999';
      SELECT count(*) FROM public.list_voyage_eligible_pods(${voyageId}); COMMIT;`)
    expect(portalLike.stderr).toMatch(/sem permissao/i)
  })

  it('a ATA da Viagem não preenche a descarga dos containers', () => {
    const ata = run(`UPDATE public.voyages SET ata = '2026-08-30 10:00+00' WHERE id = ${voyageId}`)
    expect(ata.status, ata.stderr).toBe(0)
    expect(psql(`SELECT count(*) FROM public.bl_containers WHERE bl_id = '${bl.shareA}' AND discharge_date IS NOT NULL`)).toBe('0')
  })

  it('a planilha de datas aceita o segundo B/L que divide o container com a mesma data', () => {
    // A prévia leu os dois B/Ls antes de gravar: descarga vazia em ambos.
    const row = (blId: string) => `public.apply_container_dates_atomic(gen_random_uuid(), '${blId}',
      '[{"container_number":"${sharedContainer}","discharge_date":"2026-09-01","return_date":"2026-09-10",
         "expected_discharge_date":null,"expected_return_date":null}]'::jsonb, '${adminId}'::uuid)`
    const first = asAdmin(`RESET ROLE; SELECT ${row(bl.shareA)}`)
    expect(first.status, first.stderr).toBe(0)
    // O primeiro B/L propagou a data ao irmão; a linha do irmão não é prévia obsoleta.
    const second = asAdmin(`RESET ROLE; SELECT ${row(bl.shareB)}`)
    expect(second.status, second.stderr).toBe(0)
    expect(lastJson<{ unchanged_ids: number[] }>(second.stdout).unchanged_ids).toHaveLength(1)
    expect(psql(`SELECT string_agg(return_date::text, ',') FROM public.bl_containers WHERE bl_id IN ('${bl.shareA}', '${bl.shareB}')`))
      .toBe('2026-09-10,2026-09-10')
  })

  it('a planilha de datas confere a prévia que viu a descarga vazia (201)', () => {
    psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('${bl.shareA}', 'RVCU2010001', '40HC')`)
    // Outra sessão grava a descarga depois da prévia, que a viu vazia.
    psql(`UPDATE public.bl_containers SET discharge_date = '2026-09-02' WHERE container_number = 'RVCU2010001'`)
    const stale = asAdmin(`RESET ROLE; SELECT public.apply_container_dates_atomic(gen_random_uuid(), '${bl.shareA}',
      '[{"container_number":"RVCU2010001","discharge_date":"2026-09-05","return_date":null,
         "expected_discharge_date":null,"expected_return_date":null}]'::jsonb, '${adminId}'::uuid)`)
    expect(stale.stderr).toMatch(/Preview obsoleto para RVCU2010001/)
    expect(psql(`SELECT discharge_date FROM public.bl_containers WHERE container_number = 'RVCU2010001'`)).toBe('2026-09-02')
  })

  it('UPDATE em item de carga solta não esbarra na modalidade de carga', () => {
    const update = run(`UPDATE public.bl_breakbulk_items SET item_description = 'R190 MAQUINA CORRIGIDA' WHERE bl_id = '${bl.breakbulk}'`)
    expect(update.stderr).toBe('')
    expect(psql(`SELECT item_description FROM public.bl_breakbulk_items WHERE bl_id = '${bl.breakbulk}'`)).toBe('R190 MAQUINA CORRIGIDA')
  })

  it('o Alerta de fila parada abre e fecha pelo job, sem JWT', () => {
    psql(`INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, created_by, next_attempt_at, created_at)
          VALUES (gen_random_uuid(), 'provisional_charges', '${bl.shareA}', '${adminId}', now() - interval '2 hours', now() - interval '2 hours')`)
    const opened = run(`SELECT public.reconcile_import_effects_queue_alert()`)
    expect(opened.stderr).toBe('')
    expect(psql(`SELECT count(*) FROM public.alert_items WHERE item_type = 'import_effects_queue_stalled' AND status = 'active'`)).toBe('1')

    psql(`DELETE FROM public.import_pending_effects WHERE entity_id = '${bl.shareA}'`)
    const closed = run(`SELECT public.reconcile_import_effects_queue_alert()`)
    expect(closed.stderr).toBe('')
    expect(psql(`SELECT count(*) FROM public.alert_items WHERE item_type = 'import_effects_queue_stalled' AND status = 'active'`)).toBe('0')
  })

  it('efeito em backoff não acende o Alerta de fila parada', () => {
    psql(`INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, created_by, status, attempts, next_attempt_at, created_at)
          VALUES (gen_random_uuid(), 'provisional_charges', '${bl.shareB}', '${adminId}', 'retry_wait', 3, now() + interval '30 minutes', now() - interval '2 hours')`)
    run(`SELECT public.reconcile_import_effects_queue_alert()`)
    expect(psql(`SELECT count(*) FROM public.alert_items WHERE item_type = 'import_effects_queue_stalled' AND status = 'active'`)).toBe('0')
    psql(`DELETE FROM public.import_pending_effects WHERE entity_id = '${bl.shareB}'`)
  })

  it('a fatura de B/L e a de Granito da Viagem Cancelada podem ser canceladas', () => {
    const blInvoice = asAdmin(`SELECT public.cancel_invoice(${blInvoiceId}, 'Viagem cancelada (R190)', '${adminId}')`)
    expect(blInvoice.status, blInvoice.stderr).toBe(0)
    const graniteInvoice = asAdmin(`SELECT public.cancel_invoice(${graniteInvoiceId}, 'Viagem cancelada (R190)', '${adminId}')`)
    expect(graniteInvoice.status, graniteInvoice.stderr).toBe(0)
    expect(psql(`SELECT string_agg(status, ',' ORDER BY id) FROM public.invoices WHERE id IN (${blInvoiceId}, ${graniteInvoiceId})`))
      .toBe('cancelled,cancelled')
    expect(psql(`SELECT financial_status FROM public.bls WHERE id = '${bl.cancelledVoyage}'`)).toBe('pending')
    // Outra mudança no B/L da Viagem Cancelada continua recusada.
    const other = run(`UPDATE public.bls SET pod = 'BRRIG' WHERE id = '${bl.cancelledVoyage}'`)
    expect(other.stderr).toMatch(/cancelada/)
  })

  it('consolidada e avulsa não nascem na Viagem Cancelada', () => {
    const link = run(`
      SET session_replication_role = replica;
      INSERT INTO public.bl_receivables (bl_id, customer_id, source, original_amount_brl, balance_brl) VALUES ('${bl.cancelledVoyage}', ${customerId}, 'local_charges', 10, 10);
      SET session_replication_role = origin;
      INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id)
      SELECT ${blInvoiceId}, id, bl_id FROM public.bl_receivables WHERE bl_id = '${bl.cancelledVoyage}';
    `)
    expect(link.stderr).toMatch(/cancelada/)
    const avulsa = run(`INSERT INTO public.invoices (invoice_number, customer_id, total_brl, status, voyage_id)
                        VALUES ('R190-AVULSA', ${customerId}, 10, 'draft', ${cancelledVoyageId})`)
    expect(avulsa.stderr).toMatch(/cancelada/)
  })

  it('o NOA automático ignora a Viagem Cancelada', () => {
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value, changed_at)
      VALUES ('voyage_pod_schedule', '${cancelledVoyageId}::BRSSA', 'eta', (now() + interval '2 days')::text, now());
      SET session_replication_role = origin;
    `)
    const evaluation = asService(`SELECT public.evaluate_and_dispatch_automatic_communications(now())`)
    expect(evaluation.status, evaluation.stderr).toBe(0)
    const candidates = lastJson<Array<{ voyage_id: number }>>(evaluation.stdout)
    expect(candidates.filter((c) => c.voyage_id === cancelledVoyageId)).toEqual([])
  })

  it('efeito de B/L Cancelado sai como superseded, sem Alerta de bloqueio', () => {
    const effectId = psql(`
      INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, created_by, status, attempts, leased_by, lease_until)
      VALUES (gen_random_uuid(), 'local_billing', '${bl.cancelledBl}', '${adminId}', 'running', 1, 'r190-worker', now() + interval '5 minutes')
      RETURNING id`)
    const processed = asService(`SELECT public.process_import_effect(${effectId}, 'r190-worker')`)
    expect(processed.status, processed.stderr).toBe(0)
    expect(psql(`SELECT status || '|' || (result->>'reason') FROM public.import_pending_effects WHERE id = ${effectId}`))
      .toBe('superseded|bl_cancelled')
    expect(psql(`SELECT count(*) FROM public.alert_items WHERE item_type = 'import_effect_blocked' AND status = 'active' AND metadata->>'effect_id' = '${effectId}'`)).toBe('0')
  })

  it('vehicle_followup não cancela fatura com pagamento', () => {
    const followup = asService(`
      SET import_effects.consumer = 'vehicle_followup';
      SELECT public._run_import_effect_vehicle_followup('${bl.cancelledBl}', '${adminId}'::uuid)`)
    expect(followup.status, followup.stderr).toBe(0)
    expect(lastJson<{ status: string; reason: string }>(followup.stdout)).toMatchObject({
      status: 'skipped', reason: 'paid_invoice_follows_adr_0077',
    })
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${paidInvoiceId}`)).toBe('paid')
  })

  it('o primeiro contexto de importação da transação vale até o fim', () => {
    const context = psql(`
      BEGIN;
      SELECT public._set_import_context('B/L', ${voyageId}, NULL);
      SELECT public._set_import_context('Baplie (marcas)', ${voyageId}, NULL);
      SELECT current_setting('vela.import_context');
      COMMIT;`)
    expect(context.split('\n').at(-1)).toBe('Importação de B/L · Viagem R190 NAVIO R190A')
  })

  it('id numérico longo não estoura a busca da Viagem do efeito', () => {
    expect(psql(`SELECT COALESCE(public._import_effect_voyage_id('local_billing', '12345678901234567890123')::text, 'nulo')`)).toBe('nulo')
  })

  it('o container sem devolução fica em atraso quando passa do free time (197)', () => {
    const status = (number: string) => psql(`SELECT demurrage_status FROM public.bl_containers WHERE container_number = '${number}'`)
    psql(`
      INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date) VALUES
        ('${bl.overdue}', 'RVCU1970001', '40HC', current_date - 10),
        ('${bl.overdue}', 'RVCU1970002', '40HC', current_date - 2);
      INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, ownership) VALUES
        ('${bl.overdue}', 'RVCU1970003', '40HC', current_date - 10, 'SOC');
    `)
    expect(status('RVCU1970001')).toBe('overdue')
    expect(status('RVCU1970002')).toBe('within_free_time')
    expect(status('RVCU1970003')).toBe('within_free_time')

    psql(`UPDATE public.bl_containers SET return_date = current_date WHERE container_number = 'RVCU1970001'`)
    expect(status('RVCU1970001')).toBe('returned')

    // Ninguém mexeu no container e o free time venceu: o job diário refaz.
    psql(`SET session_replication_role = replica;
          UPDATE public.bl_containers SET discharge_date = current_date - 20 WHERE container_number = 'RVCU1970002';`)
    expect(status('RVCU1970002')).toBe('within_free_time')
    const refreshed = run(`SELECT public.refresh_containers_demurrage_status()`)
    expect(refreshed.status, refreshed.stderr).toBe(0)
    expect(status('RVCU1970002')).toBe('overdue')
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.refresh_containers_demurrage_status()', 'EXECUTE')`)).toBe('f')
  })

  it('container de B/L ou de Viagem Cancelados sai do atraso (200)', () => {
    const status = (number: string) => psql(`SELECT demurrage_status FROM public.bl_containers WHERE container_number = '${number}'`)
    psql(`INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date) VALUES
      ('${bl.overdueVoyage}', 'RVCU2000001', '40HC', current_date - 10);`)
    expect(status('RVCU1970002')).toBe('overdue')
    expect(status('RVCU2000001')).toBe('overdue')

    // Cancelar o B/L tira o container do atraso na hora; reativar devolve.
    const cancelledBl = asAdmin(`SELECT public.cancel_bl('${bl.overdue}', 'B/L substituído (R200)', false)`)
    expect(cancelledBl.status, cancelledBl.stderr).toBe(0)
    expect(status('RVCU1970002')).toBe('within_free_time')
    expect(run(`SELECT public.refresh_containers_demurrage_status()`).status).toBe(0)
    expect(status('RVCU1970002')).toBe('within_free_time')
    const reactivated = asAdmin(`SELECT public.reactivate_bl('${bl.overdue}', 'Cancelamento por engano (R200)')`)
    expect(reactivated.status, reactivated.stderr).toBe(0)
    expect(status('RVCU1970002')).toBe('overdue')

    // Viagem Cancelada: o atraso sai, o job não o devolve e o container segue selado.
    const cancelledVoyage = asAdmin(`SELECT public.cancel_voyage(${overdueVoyageId}, 'Armador cancelou a escala (R200)', '${adminId}')`)
    expect(cancelledVoyage.status, cancelledVoyage.stderr).toBe(0)
    expect(status('RVCU2000001')).toBe('within_free_time')
    expect(run(`SELECT public.refresh_containers_demurrage_status()`).status).toBe(0)
    expect(status('RVCU2000001')).toBe('within_free_time')
    expect(run(`UPDATE public.bl_containers SET demurrage_status = 'overdue' WHERE container_number = 'RVCU2000001'`).status).toBe(0)
    expect(status('RVCU2000001')).toBe('within_free_time')
    expect(run(`UPDATE public.bl_containers SET discharge_date = current_date WHERE container_number = 'RVCU2000001'`).stderr)
      .toMatch(/cancelada: operação selada/)
  })
})
