import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

// Migration 128 (ADR 0077, decisões de 2026-10-02): toda correção do B/L —
// alteração direta, reimportação ou Baplie — é tratada no fim da transação.
// Sem pagamento reemite; com pagamento abate o saldo e restitui o excedente.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'


const actorId = '00000000-0000-0000-0000-000000839001'
const customerId = 99283901
const otherCustomerId = 99283909
const carrierId = 99283902
const vesselId = 99283903
const voyageId = 99283904
const chargeTableId = 99283905
const perContainerItem = 99283906
const dropOffItem = 99283907
const prefix = 'R839-'
const bl = {
  soc: 'R839-BL-SOC',
  pairA: 'R839-BL-PA',
  pairB: 'R839-BL-PB',
  partial: 'R839-BL-PP',
  full: 'R839-BL-PF',
  more: 'R839-BL-PM',
  moveA: 'R839-BL-MA',
  moveB: 'R839-BL-MB',
  vehicle: 'R839-BL-VH',
  vehicleB: 'R839-BL-VB',
  baplie: 'R839-BL-BP',
}
const allBls = Object.values(bl)

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`], { encoding: 'utf8' }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regproc('public.process_invoice_basis_changes') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = migrationApplied() ? describe : describe.skip

function asAdmin(sql: string) {
  return spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${actorId}';
    ${sql};
    COMMIT;
  `], { encoding: 'utf8' })
}

function adminJson<T>(sql: string): T {
  const result = asAdmin(sql)
  expect(result.status, result.stderr).toBe(0)
  const line = result.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{') || l.startsWith('[')).at(-1)
  return JSON.parse(line ?? '{}') as T
}

function issueByCe(blId: string, ce: string) {
  const result = asAdmin(`DO $$ BEGIN PERFORM public.apply_ce_mercante_update('${blId}', '${ce}', '${actorId}'::uuid); END $$`)
  expect(result.status, result.stderr).toBe(0)
  return Number(psql(`SELECT id FROM public.invoices WHERE bl_id = '${blId}' AND status = 'issued' AND invoice_type = 'individual'`))
}

function receivableId(blId: string) {
  return Number(psql(`SELECT id FROM public.bl_receivables WHERE bl_id = '${blId}' AND source = 'local_charges'`))
}

function consolidate(blIds: string[]) {
  return adminJson<{ invoice_id: number }>(
    `SELECT public.create_local_consolidated_invoice(${customerId}, ARRAY[${blIds.map(receivableId).join(',')}]::bigint[], NULL, '${actorId}'::uuid)`,
  ).invoice_id
}

function successor(invoiceId: number) {
  return psql(`SELECT coalesce(string_agg(id || '|' || total_brl || '|' || status, ','), '') FROM public.invoices WHERE replaces_invoice_id = ${invoiceId}`)
}

function activeAlerts(type: string, invoiceId: number) {
  return psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
    WHERE ai.item_type = '${type}' AND ai.status = 'active' AND a.entity_type = 'invoice' AND a.entity_id = '${invoiceId}'`)
}

function cleanup() {
  const bls = `ARRAY['${allBls.join("','")}']::text[]`
  const invoices = `(SELECT id FROM public.invoices WHERE customer_id IN (${customerId}, ${otherCustomerId}))`
  const invoiceKeys = `(SELECT id::text FROM public.invoices WHERE customer_id IN (${customerId}, ${otherCustomerId}))`
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT ai.id FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
      WHERE a.entity_type = 'invoice' AND a.entity_id IN ${invoiceKeys});
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_type = 'invoice' AND entity_id IN ${invoiceKeys});
    DELETE FROM public.alert_items WHERE metadata->>'bl_id' LIKE '${prefix}%';
    DELETE FROM public.alerts WHERE entity_type = 'invoice' AND entity_id IN ${invoiceKeys};
    DO $$ BEGIN IF to_regclass('public.invoice_customer_changes') IS NOT NULL THEN DELETE FROM public.invoice_customer_changes WHERE bl_id LIKE 'R839-%'; END IF; END $$;
    DO $$ BEGIN IF to_regclass('public.demurrage_refunds') IS NOT NULL THEN DELETE FROM public.demurrage_refunds WHERE invoice_id IN (SELECT id FROM public.demurrage_invoices WHERE customer_id IN (${customerId},${otherCustomerId})); END IF; END $$;
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (SELECT id FROM public.demurrage_invoices WHERE customer_id IN (${customerId},${otherCustomerId}));
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM public.demurrage_invoices WHERE customer_id IN (${customerId},${otherCustomerId}));
    DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM public.demurrage_invoices WHERE customer_id IN (${customerId},${otherCustomerId}));
    DELETE FROM public.demurrage_invoices WHERE customer_id IN (${customerId},${otherCustomerId});
    DELETE FROM public.invoice_basis_pending_changes WHERE bl_id = ANY(${bls});
    DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN ${invoices};
    DELETE FROM public.cod_adjustments WHERE bl_id = ANY(${bls}); DELETE FROM public.bl_transshipments WHERE bl_id = ANY(${bls}); DELETE FROM public.voyage_omissions WHERE voyage_id = ${voyageId}; DELETE FROM public.invoice_corrections WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_refunds WHERE invoice_id IN ${invoices};
    DELETE FROM public.ledger_settlements WHERE invoice_id IN ${invoices};
    DO $$ BEGIN IF to_regclass('public.financial_payment_attempts') IS NOT NULL THEN DELETE FROM public.financial_payment_attempts WHERE created_by='${actorId}'; END IF; END $$;
    DELETE FROM public.ledger_payment_requests WHERE created_by = '${actorId}';
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_items WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_receivable_links WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_bls WHERE invoice_id IN ${invoices};
    DELETE FROM public.payments WHERE invoice_id IN ${invoices};
    DELETE FROM public.billing_batches WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.portal_notifications WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.invoices WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.bl_receivables WHERE bl_id = ANY(${bls});
    DELETE FROM public.import_pending_effects WHERE entity_id = ANY(${bls});
    DELETE FROM public.charge_calculations WHERE bl_id = ANY(${bls});
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id = ${chargeTableId};
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    DELETE FROM public.vehicles WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_containers WHERE bl_id = ANY(${bls});
    DELETE FROM public.bls WHERE id = ANY(${bls});
    DELETE FROM public.charge_table_items WHERE charge_table_id = ${chargeTableId};
    DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
    DELETE FROM public.voyages WHERE id IN (${voyageId}, ${voyageId + 100});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id IN (${customerId}, ${otherCustomerId}));
    DELETE FROM public.customer_contacts WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.customers WHERE id IN (${customerId}, ${otherCustomerId});
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}';
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('130 — segurança de correções, cobranças Pix e COD', () => {
  beforeEach(() => {
    cleanup()
    const customers = [[customerId, 128001], [otherCustomerId, 128009]] as const
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'basis-128@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'Administrativo 128', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = 'administrativo', active = true;
      ${customers.map(([id, ns]) => `
        INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${id}, '${syntheticCnpj(ns)}', 'Cliente ${ns}');
        INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
          VALUES (${id}, 'Financeiro ${ns}', 'financeiro-${ns}@example.test', 'financeiro', true);
        INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
          VALUES (${id}, 'Fixture: gate aberto', '${actorId}', now() + interval '1 day');`).join('\n')}
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 128');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 128', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'R839', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
        VALUES (${chargeTableId}, 'Tabela 128', 'R839POD', CURRENT_DATE - 30, true, 'container');
      -- COC: R$ 600 por container (500 + Drop Off 100). SOC: R$ 500.
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency, applies_to_soc)
        VALUES (${perContainerItem}, ${chargeTableId}, 'Taxa por container 128', 'container', 500, 500, 'container_distinct_voyage', 'base', 'any', 'BRL', true),
               (${dropOffItem}, ${chargeTableId}, 'Drop Off 128', 'container', 100, 100, 'container_distinct_voyage', 'base', 'any', 'BRL', false);
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante)
      VALUES ${allBls.map((id) => `('${id}', ${voyageId}, ${customerId}, 'R839POD', 'container', 'pending', 'not_calculated', 'reconciled', NULL)`).join(', ')};
      INSERT INTO public.bl_containers (bl_id, container_number, type)
      VALUES ${allBls.map((id, i) => `('${id}', 'RCCU128${String(i).padStart(4, '0')}', '22G1')`).join(', ')};
    `)
  })

  afterEach(cleanup)

  it('oito confirmações concorrentes do mesmo Pix criam uma única baixa', async () => {
    const invoice = issueByCe(bl.full, '839000000000021')
    const txid = psql(`SELECT txid FROM public.local_pix_charge_versions WHERE invoice_id=${invoice} ORDER BY id DESC LIMIT 1`)
    const results = await Promise.all(Array.from({ length: 8 }, () => new Promise<string>((resolve, reject) => {
      execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
        BEGIN;
        SET LOCAL ROLE authenticated;
        SET LOCAL request.jwt.claim.role = 'authenticated';
        SET LOCAL request.jwt.claim.sub = '${actorId}';
        SELECT public.reconcile_invoice_payment_by_txid('${txid}',600);
        COMMIT;
      `], { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout))
    })))
    const settled = results.filter((output) => output.includes('"settled": true'))
    expect(settled).toHaveLength(1)
    expect(psql(`SELECT count(*) || '|' || sum(amount_brl) FROM public.payments WHERE invoice_id=${invoice}`)).toBe('1|600.00')
    expect(psql(`SELECT count(*) FROM public.ledger_settlements WHERE pix_txid='${txid}'`)).toBe('1')
    expect(psql(`SELECT status || '|' || balance_brl FROM public.invoices WHERE id=${invoice}`)).toBe('paid|0.00')
  })

  it.each([1, 99.99, 100, 200, 499.99, 500, 550, 600, 650])(
    'redução de R$ 600 para R$ 500 após receber R$ %s conserva dinheiro e saldo', (paid) => {
      const invoice = issueByCe(bl.full, '839000000000022')
      adminJson(`SELECT public.register_ledger_invoice_payment(${invoice},${paid})`)
      psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.full}'`)
      const state = JSON.parse(psql(`SELECT jsonb_build_object(
        'total', total_brl, 'received', total_paid_brl, 'balance', balance_brl,
        'refund', (SELECT coalesce(sum(amount_brl),0) FROM public.invoice_refunds WHERE invoice_id=${invoice})
      ) FROM public.invoices WHERE id=${invoice}`))
      expect(state).toEqual({ total: 600, received: paid, balance: Math.max(Math.round((500 - paid) * 100) / 100, 0), refund: Math.max(Math.round((paid - 500) * 100) / 100, 0) })
      expect(successor(invoice)).toBe('')
      expect(psql(`SELECT count(*) FROM public.invoice_basis_pending_changes WHERE bl_id='${bl.full}'`)).toBe('0')
    },
  )

  it('troca de Cliente após pagamento preserva a fatura original e mantém alerta até restituição', () => {
    const invoice = issueByCe(bl.full, '839000000000023')
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoice},200)`)
    psql(`UPDATE public.bls SET customer_id=${otherCustomerId} WHERE id='${bl.full}'`)
    expect(psql(`SELECT customer_id || '|' || total_brl || '|' || total_paid_brl FROM public.invoices WHERE id=${invoice}`))
      .toBe(`${customerId}|600.00|200.00`)
    expect(successor(invoice)).toBe('')
    expect(activeAlerts('fatura_desatualizada', invoice)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id WHERE i.customer_id=${otherCustomerId}`)).toBe('0')
  })

  it('duas chaves distintas para o mesmo comprovante manual geram dois lançamentos', () => {
    const invoice = issueByCe(bl.full, '839000000000024')
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoice},200,'ted','2026-10-04T12:00:00Z',NULL,'manual','Mesmo comprovante','${actorId}'::uuid,'00000000-0000-0000-0000-000000839024'::uuid)`)
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoice},200,'ted','2026-10-04T12:00:00Z',NULL,'manual','Mesmo comprovante','${actorId}'::uuid,'00000000-0000-0000-0000-000000839026'::uuid)`)
    expect(psql(`SELECT count(*) || '|' || sum(amount_brl) FROM public.payments WHERE invoice_id=${invoice}`)).toBe('2|400.00')
    expect(psql(`SELECT balance_brl FROM public.invoices WHERE id=${invoice}`)).toBe('200.00')
  })

  it('repetir a baixa manual com a mesma chave e conteúdo cria um único lançamento', () => {
    const invoice = issueByCe(bl.full, '839000000000025')
    const command = `SELECT public.register_ledger_invoice_payment(
      p_invoice_id => ${invoice}, p_amount_brl => 200, p_method => 'ted',
      p_paid_at => '2026-10-04T12:00:00Z'::timestamptz, p_pix_txid => NULL::text, p_source => 'manual',
      p_notes => NULL::text, p_actor => '${actorId}'::uuid,
      p_request_id => '00000000-0000-0000-0000-000000839025'::uuid
    )`
    expect(asAdmin(command).status).toBe(0)
    expect(asAdmin(command).status).toBe(0)
    expect(psql(`SELECT count(*) || '|' || sum(amount_brl) FROM public.payments WHERE invoice_id=${invoice}`)).toBe('1|200.00')
    expect(psql(`SELECT balance_brl FROM public.invoices WHERE id=${invoice}`)).toBe('400.00')
    expect(asAdmin(command.replace('2026-10-04T12:00:00Z', '2026-10-04T12:00:01Z')).stderr).toContain('outro payload')
  })

  it('lote de Pix com uma linha inválida desfaz também a linha válida', () => {
    const first = issueByCe(bl.full, '839000000000027')
    const second = issueByCe(bl.partial, '839000000000028')
    const matches = [first, second].map((invoice, index) => ({
      source: 'local', invoice_id: invoice,
      txid: psql(`SELECT txid FROM public.local_pix_charge_versions WHERE invoice_id=${invoice} ORDER BY id DESC LIMIT 1`),
      amount: index === 0 ? 600 : 599, paid_at: '2026-10-04T12:00:00Z',
    }))
    const result = asAdmin(`SELECT public.confirm_unified_pix_matches('${JSON.stringify(matches)}'::jsonb)`)
    expect(result.status).not.toBe(0)
    expect(psql(`SELECT count(*) FROM public.payments WHERE invoice_id IN (${first},${second})`)).toBe('0')
    expect(psql(`SELECT sum(balance_brl) FROM public.invoices WHERE id IN (${first},${second})`)).toBe('1200.00')
  })


  it('atualiza o Pix pelo saldo sem mudar o total e aceita a cobrança histórica com refund', () => {
    psql(`INSERT INTO public.bl_containers(bl_id,container_number,type) VALUES ('${bl.partial}','RCCU8390001','22G1')`)
    const inv=issueByCe(bl.partial,'839000000000001');
    adminJson(`SELECT public.register_ledger_invoice_payment(${inv},200)`);
    psql(`DELETE FROM public.bl_containers WHERE bl_id='${bl.partial}' AND container_number='RCCU8390001'`);
    const row=psql(`SELECT total_brl || '|' || balance_brl || '|' || (pix_payload LIKE '%54071200.00%') FROM public.invoices WHERE id=${inv}`);

    expect(row).toBe('1200.00|400.00|false'); expect(psql(`SELECT pix_payload LIKE '%5406400.00%' FROM public.invoices WHERE id=${inv}`)).toBe('t');
    const qrPay=adminJson<{matched:boolean;settled:boolean}>(`SELECT public.reconcile_invoice_payment_by_txid((SELECT invoice_number FROM public.invoices WHERE id=${inv}),1200)`);
    expect(qrPay).toMatchObject({matched:true,settled:true});
    expect(psql(`SELECT sum(amount_brl) FROM public.invoice_refunds WHERE invoice_id=${inv}`)).toBe('800.00');
    expect(activeAlerts('restituicao_pendente',inv)).toBe('1');
    expect(psql(`SELECT count(*) FROM public.ledger_settlements WHERE invoice_id=${inv} AND source='pix_extract'`)).toBe('1');
    psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.partial}'`);
    expect(psql(`SELECT sum(amount_brl) FROM public.invoice_refunds WHERE invoice_id=${inv}`)).toBe('900.00');
    expect(psql(`SELECT metadata->>'pending_brl' FROM public.alert_items WHERE item_type='restituicao_pendente' AND status='active' AND metadata->>'invoice_id'='${inv}'`)).toBe('900.00');
    expect(psql(`SELECT count(*) FROM public.invoice_basis_pending_changes WHERE bl_id='${bl.partial}'`)).toBe('0');

  });
  it('bloqueia estorno da baixa que sustenta restituição',()=>{
    const inv=issueByCe(bl.full,'839000000000002');
    adminJson<{payment_id:number}>(`SELECT public.register_ledger_invoice_payment(${inv},600)`);
    psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.full}'`);
    const payment=Number(psql(`SELECT id FROM public.payments WHERE invoice_id=${inv}`));
    const reverse=asAdmin(`SELECT public.reverse_invoice_payment(${payment},'Baixa registrada por engano')`);
    expect(reverse.status).toBe(1); expect(reverse.stderr).toContain('financia restituicao');

  });
  it('distribui restituição pelos pagamentos individual e consolidado',()=>{
    psql(`INSERT INTO public.bl_containers(bl_id,container_number,type) VALUES ('${bl.soc}','RCCU8390003','22G1')`);
    const ind=issueByCe(bl.soc,'839000000000003');
    adminJson(`SELECT public.register_ledger_invoice_payment(${ind},600)`);
    const con=consolidate([bl.soc]);
    adminJson(`SELECT public.register_ledger_invoice_payment(${con},600)`);
    psql(`DELETE FROM public.bl_containers WHERE bl_id='${bl.soc}' AND container_number='RCCU8390003'; UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.soc}'`);
    const row=psql(`SELECT original_amount_brl || '|' || correction_amount_brl FROM public.bl_receivables WHERE bl_id='${bl.soc}'`);
    const quote=psql(`SELECT public._quote_bl_local_charges('${bl.soc}',1)`);

    expect(row).toBe('1200.00|700.00'); expect(psql(`SELECT sum(amount_brl) FROM public.invoice_refunds WHERE invoice_id IN (${ind},${con})`)).toBe('700.00');
    expect(JSON.parse(quote).total_brl).toBe(500);
  });
  it('consolidada recriada com total de B/Ls ainda não recalculados',()=>{
    issueByCe(bl.pairA,'839000000000004'); issueByCe(bl.pairB,'839000000000005');
    const con=consolidate([bl.pairA,bl.pairB]);
    psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id IN ('${bl.pairA}','${bl.pairB}')`);

    expect(successor(con)).toMatch(/\|1000\.00\|issued$/);
    const txid = psql(`SELECT invoice_number FROM public.invoices WHERE id=${con}`);
    expect(adminJson(`SELECT public.reconcile_invoice_payment_by_txid('${txid}',1200)`)).toMatchObject({settled:true});
    const replacement = Number(psql(`SELECT id FROM public.invoices WHERE replaces_invoice_id=${con}`));
    expect(psql(`SELECT count(*) FROM public.ledger_settlements WHERE invoice_id=${replacement} AND source='pix_extract' AND pix_txid IS NOT NULL`)).toBe('1');
    expect(psql(`SELECT sum(amount_brl) FROM public.invoice_refunds WHERE invoice_id=${replacement}`)).toBe('200.00');
  });
  it('concilia QR antigo na sucessora e não repete a baixa',()=>{
    const inv=issueByCe(bl.baplie,'839000000000006');
    const oldTxid=psql(`SELECT invoice_number FROM public.invoices WHERE id=${inv}`);
    psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.baplie}'`);
    const result=adminJson<{matched:boolean;reason:string}>(`SELECT public.reconcile_invoice_payment_by_txid('${oldTxid}',600)`);

    expect(adminJson(`SELECT public.reconcile_invoice_payment_by_txid('${oldTxid}',600)`)).toMatchObject({matched:false,reason:'already_reconciled'});
    expect(result.matched).toBe(true); expect((result as unknown as {settled:boolean}).settled).toBe(true); expect(psql(`SELECT sum(amount_brl) FROM public.invoice_refunds WHERE invoice_id=(SELECT id FROM public.invoices WHERE replaces_invoice_id=${inv})`)).toBe('100.00');
  });
  it('resolve alerta após redução automática',()=>{
    const inv=issueByCe(bl.more,'839000000000007');
    adminJson(`SELECT public.register_ledger_invoice_payment(${inv},200)`);
    psql(`INSERT INTO public.bl_containers(bl_id,container_number,type) VALUES ('${bl.more}','RCCU8390007','22G1')`);
    expect(activeAlerts('fatura_desatualizada',inv)).toBe('1');
    psql(`DELETE FROM public.bl_containers WHERE bl_id='${bl.more}' AND container_number='RCCU8390007'; UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.more}'`);
    const state=psql(`SELECT original_amount_brl || '|' || correction_amount_brl || '|' || balance_brl FROM public.bl_receivables WHERE bl_id='${bl.more}'`);

    expect(state).toBe('600.00|100.00|300.00');expect(activeAlerts('fatura_desatualizada',inv)).toBe('0');
  });


  it('rejeita valor diferente do QR histórico e encaminha cobrança já paga à revisão', () => {
    const inv = issueByCe(bl.baplie, '839000000000011')
    const txid = psql(`SELECT invoice_number FROM public.invoices WHERE id=${inv}`)
    psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.baplie}'`)
    expect(adminJson(`SELECT public.reconcile_invoice_payment_by_txid('${txid}',500)`))
      .toMatchObject({matched:true,settled:false,reason:'charge_amount_mismatch'})
    const current = psql(`SELECT txid FROM public.local_pix_charge_versions WHERE invoice_id=(SELECT id FROM public.invoices WHERE replaces_invoice_id=${inv}) ORDER BY id DESC LIMIT 1`)
    expect(adminJson(`SELECT public.reconcile_invoice_payment_by_txid('${current}',500)`)).toMatchObject({settled:true})
    expect(adminJson(`SELECT public.reconcile_invoice_payment_by_txid('${txid}',600)`))
      .toMatchObject({matched:false,reason:'historical_charge_requires_review'})
  })

  it('não transfere Pix antigo para outro Cliente nem baixa fatura cancelada sem sucessora', () => {
    const inv = issueByCe(bl.baplie, '839000000000012')
    const txid = psql(`SELECT invoice_number FROM public.invoices WHERE id=${inv}`)
    psql(`UPDATE public.bls SET customer_id=${otherCustomerId} WHERE id='${bl.baplie}'`)
    expect(adminJson(`SELECT public.reconcile_invoice_payment_by_txid('${txid}',600)`))
      .toMatchObject({matched:false,reason:'historical_charge_requires_review'})
    const other = issueByCe(bl.full, '839000000000013')
    const otherTxid = psql(`SELECT invoice_number FROM public.invoices WHERE id=${other}`)
    adminJson(`SELECT public.cancel_invoice(${other},'Cancelamento definitivo do teste')`)
    expect(adminJson(`SELECT public.reconcile_invoice_payment_by_txid('${otherTxid}',600)`))
      .toMatchObject({matched:false,reason:'historical_charge_requires_review'})
    expect(psql(`SELECT count(*) FROM public.payments WHERE invoice_id IN (${inv},${other})`)).toBe('0')
  })

  it('recalcula o vizinho ao cancelar outro B/L do container compartilhado', () => {
    psql(`INSERT INTO public.bl_containers(bl_id,container_number,type)
      SELECT '${bl.moveB}',container_number,type FROM public.bl_containers WHERE bl_id='${bl.moveA}'`)
    const inv = issueByCe(bl.moveA, '839000000000014')
    adminJson(`SELECT public.cancel_bl('${bl.moveB}','Cancelamento do B/L vizinho')`)
    const debug = psql(`SELECT jsonb_build_object('pending',(SELECT jsonb_agg(p) FROM public.invoice_basis_pending_changes p), 'quote',public._quote_bl_local_charges('${bl.moveA}',1),'invoice',(SELECT row_to_json(i) FROM public.invoices i WHERE id=${inv}))`)
    expect(successor(inv), debug).toMatch(/\|600\.00\|issued$/)
    expect(psql(`SELECT count(*) FROM public.invoice_basis_pending_changes WHERE bl_id='${bl.moveA}'`)).toBe('0')
  })

  it('persiste falha financeira e permite retry sem editar novamente o B/L', () => {
    const inv = issueByCe(bl.full, '839000000000015')
    adminJson(`SELECT public.register_ledger_invoice_payment(${inv},600)`)
    psql(`ALTER TABLE public.invoice_refunds ADD CONSTRAINT r839_fail_refund CHECK (amount_brl <> 100) NOT VALID`)
    try {
      psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.full}'`)
      expect(psql(`SELECT count(*) FROM public.invoice_basis_pending_changes WHERE bl_id='${bl.full}'`)).toBe('1')
      expect(psql(`SELECT correction_amount_brl FROM public.bl_receivables WHERE bl_id='${bl.full}'`)).toBe('0.00')
    } finally { psql(`ALTER TABLE public.invoice_refunds DROP CONSTRAINT r839_fail_refund`) }
    adminJson(`SELECT public.retry_invoice_basis_changes('${bl.full}')`)
    expect(psql(`SELECT correction_amount_brl FROM public.bl_receivables WHERE bl_id='${bl.full}'`)).toBe('100.00')
    expect(psql(`SELECT count(*) FROM public.invoice_basis_pending_changes WHERE bl_id='${bl.full}'`)).toBe('0')
    expect(psql(`SELECT sum(amount_brl) FROM public.invoice_refunds WHERE invoice_id=${inv}`)).toBe('100.00')
  })


  it('não permite que baixa de outro B/L sustente restituição em consolidada', () => {
    issueByCe(bl.pairA, '839000000000016')
    issueByCe(bl.pairB, '839000000000017')
    const con = consolidate([bl.pairA, bl.pairB])
    const first = adminJson<{payment_id:number}>(`SELECT public.register_ledger_invoice_payment(${con},600)`)
    adminJson(`SELECT public.register_ledger_invoice_payment(${con},600)`)
    psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.pairA}'`)
    const reverse = asAdmin(`SELECT public.reverse_invoice_payment(${first.payment_id},'Baixa registrada por engano')`)
    expect(reverse.status, reverse.stdout).toBe(1)
    expect(reverse.stderr).toContain('financia restituicao')
    expect(psql(`SELECT sum(amount_brl) FROM public.ledger_settlements WHERE invoice_id=${con} AND receivable_id=${receivableId(bl.pairA)}`)).toBe('600.00')
  })


  it('inclui os vizinhos da viagem de destino ao mover um B/L pago', () => {
    psql(`INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES (${voyageId + 100},${vesselId},'R839-DEST','active');
      UPDATE public.bls SET voyage_id=${voyageId + 100} WHERE id='${bl.moveB}';
      INSERT INTO public.bl_containers(bl_id,container_number,type)
        SELECT '${bl.moveB}',container_number,type FROM public.bl_containers WHERE bl_id='${bl.moveA}'`)
    const a = issueByCe(bl.moveA, '839000000000018')
    const b = issueByCe(bl.moveB, '839000000000019')
    adminJson(`SELECT public.register_ledger_invoice_payment(${a},600)`)
    adminJson(`SELECT public.register_ledger_invoice_payment(${b},1200)`)
    psql(`UPDATE public.bls SET voyage_id=${voyageId + 100} WHERE id='${bl.moveA}'`)
    expect(psql(`SELECT correction_amount_brl FROM public.bl_receivables WHERE bl_id='${bl.moveB}'`)).toBe('300.00')
    expect(psql(`SELECT sum(amount_brl) FROM public.invoice_refunds WHERE invoice_id IN (${a},${b})`)).toBe('600.00')
  })

  it.each([
    { failFirst: false, paid: 600, refund: 100, balance: '0.00' },
    { failFirst: true, paid: 600, refund: 100, balance: '0.00' },
    { failFirst: false, paid: 200, refund: 0, balance: '300.00' },
  ])('liquida COD uma só vez (pago=$paid, retry=$failFirst)',({failFirst,paid,refund,balance})=>{
    const inv=issueByCe(bl.vehicleB,'839000000000008');
    adminJson(`SELECT public.register_ledger_invoice_payment(${inv},${paid})`);
    psql(`INSERT INTO public.voyage_omissions(id,voyage_id,omitted_pod,discharge_pod,omitted_by) VALUES (99283988,${voyageId},'R839POD','R839DST','${actorId}')`);
    psql(`INSERT INTO public.bl_transshipments(bl_id,omission_id,disposition) VALUES ('${bl.vehicleB}',99283988,'transshipment')`);
    // A mesma tabela passa a resolver o destino novo por R$ 500.
    if (failFirst) psql(`ALTER TABLE public.invoice_refunds ADD CONSTRAINT r839_fail_cod CHECK (amount_brl <> 100) NOT VALID`);
    const result=asAdmin(`UPDATE public.charge_tables SET pod='R839DST' WHERE id=${chargeTableId}; UPDATE public.charge_table_items SET value_brl=0,unit_value_brl=0 WHERE id=${dropOffItem}; SELECT public.set_bl_cod('${bl.vehicleB}',99283988,'Destino corrigido por COD','${actorId}'::uuid)`);
    expect(result.status,result.stderr).toBe(0);

    const cod=Number(psql(`SELECT id FROM public.cod_adjustments WHERE bl_id='${bl.vehicleB}'`));
    if (failFirst) {
      psql(`ALTER TABLE public.invoice_refunds DROP CONSTRAINT r839_fail_cod`);
      expect(psql(`SELECT status FROM public.cod_adjustments WHERE id=${cod}`)).toBe('pending');
      adminJson(`SELECT public.retry_invoice_basis_changes('${bl.vehicleB}')`);
    }
    expect(psql(`SELECT status FROM public.cod_adjustments WHERE id=${cod}`)).toBe('settled');

    expect(adminJson(`SELECT public.settle_cod_adjustment(${cod})`)).toMatchObject({status:'settled'});
    const total=psql(`SELECT coalesce(sum(amount_brl),0)::numeric(14,2) FROM public.invoice_refunds WHERE invoice_id=${inv}`);
    expect(total).toBe(refund.toFixed(2));
    expect(psql(`SELECT balance_brl FROM public.invoices WHERE id=${inv}`)).toBe(balance);
    expect(adminJson(`SELECT public.settle_cod_adjustment(${cod})`)).toMatchObject({status:'settled'});
    expect(psql(`SELECT coalesce(sum(amount_brl),0)::numeric(14,2) FROM public.invoice_refunds WHERE invoice_id=${inv}`)).toBe(refund.toFixed(2));

  });

  it('recibo preserva bruto, devolução pendente e líquido após confirmação bancária', () => {
    const inv = issueByCe(bl.full, '839000000000028')
    adminJson(`SELECT public.register_ledger_invoice_payment(${inv},600)`)
    psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.full}'`)
    expect(adminJson(`SELECT public.list_invoice_details(${inv})`)).toMatchObject({financial_summary:{gross_received_brl:600,pending_refund_brl:100,refunded_brl:0,net_received_brl:600}})
    const refund = Number(psql(`SELECT id FROM public.invoice_refunds WHERE invoice_id=${inv}`))
    const invalid = asAdmin(`SELECT public.confirm_invoice_refund(${refund}, '', '', now())`)
    expect(invalid.status).toBe(1)
    expect(psql(`SELECT status FROM public.invoice_refunds WHERE id=${refund}`)).toBe('pending')
    const sql = `SELECT public.confirm_invoice_refund(${refund},'BANCO-REF-${refund}','Cliente original','2026-10-01T12:00:00Z')`
    adminJson(sql)
    adminJson(sql)
    expect(adminJson(`SELECT public.list_invoice_details(${inv})`)).toMatchObject({financial_summary:{gross_received_brl:600,pending_refund_brl:0,refunded_brl:100,net_received_brl:500}})
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type='invoice_refund' AND entity_id='${refund}' AND field_name='refund_confirmed'`)).toBe('1')
  })

  it('CNPJ pago exige devolver ao Cliente original e só depois cobra o novo Cliente', () => {
    const invoice = issueByCe(bl.full, '839000000000029')
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoice},200)`)
    const oldReceivable = receivableId(bl.full)
    psql(`UPDATE public.bls SET customer_id=${otherCustomerId} WHERE id='${bl.full}'`)
    expect(psql(`SELECT status FROM public.invoice_customer_changes WHERE receivable_id=${oldReceivable}`)).toBe('pending_refund')
    expect(psql(`SELECT count(*) FROM public.invoices WHERE customer_id=${otherCustomerId}`)).toBe('0')
    expect(psql(`SELECT sum(amount_brl) FROM public.invoice_refunds WHERE correction_receivable_id=${oldReceivable}`)).toBe('200.00')
    expect(adminJson(`SELECT public.retry_invoice_basis_changes('${bl.full}')`)).toMatchObject({status:'pending_refund'})
    const refund = Number(psql(`SELECT id FROM public.invoice_refunds WHERE correction_receivable_id=${oldReceivable}`))
    adminJson(`SELECT public.confirm_invoice_refund(${refund},'CNPJ-REF-${refund}','Cliente original','2026-10-01T12:00:00Z')`)
    const diagnostic = psql(`SELECT jsonb_build_object('change',row_to_json(c),'pending',(SELECT row_to_json(p) FROM public.invoice_basis_pending_changes p WHERE p.bl_id=c.bl_id)) FROM public.invoice_customer_changes c WHERE receivable_id=${oldReceivable}`)
    expect(psql(`SELECT status FROM public.invoice_customer_changes WHERE receivable_id=${oldReceivable}`),diagnostic).toBe('completed')
    expect(psql(`SELECT total_brl || '|' || total_paid_brl || '|' || balance_brl FROM public.invoices WHERE customer_id=${otherCustomerId}`)).toBe('600.00|0.00|600.00')
    expect(psql(`SELECT customer_id || '|' || total_paid_brl FROM public.invoices WHERE id=${invoice}`)).toBe(`${customerId}|200.00`)
    expect(psql(`SELECT source FROM public.bl_receivables WHERE id=${oldReceivable}`)).toBe(`local_charges_archived:${oldReceivable}`)
    adminJson(`SELECT public.retry_invoice_basis_changes('${bl.full}')`)
    expect(psql(`SELECT count(*) FROM public.invoices WHERE customer_id=${otherCustomerId}`)).toBe('1')
  })

  it('mesma referência bancária financia duas baixas; replay de baixa cancelada é recusado', () => {
    const inv = issueByCe(bl.full, '839000000000030')
    const sql = `SELECT public.register_verified_invoice_payment(${inv},150,'ted','2026-10-01T12:00:00Z',NULL,'00000000-0000-0000-0000-000000839030','BANCO-UNICO-30')`
    const first = adminJson<{payment_id:number}>(sql)
    expect(adminJson(sql)).toMatchObject({payment_id:first.payment_id})
    // Um PIX pode pagar mais de uma cobrança: a referência se repete com outra chave de tentativa.
    const second = adminJson<{payment_id:number}>(sql.replace('000000839030','000000839031').replace(',150,',',50,'))
    expect(second.payment_id).not.toBe(first.payment_id)
    expect(psql(`SELECT count(*) FROM public.payments WHERE invoice_id=${inv} AND bank_reference='BANCO-UNICO-30'`)).toBe('2')
    adminJson(`SELECT public.reverse_invoice_payment(${second.payment_id},'Baixa lançada sem recebimento')`)
    adminJson(`SELECT public.reverse_invoice_payment(${first.payment_id},'Baixa lançada sem recebimento')`)
    const replay = asAdmin(sql)
    expect(replay.status).toBe(1)
    expect(replay.stderr).toContain('foi cancelada')
    expect(psql(`SELECT count(*) FROM public.payments WHERE invoice_id=${inv}`)).toBe('0')
  })

  it('restituição excepcional de Demurrage respeita lastro, preserva baixa e cancela após devolução integral', () => {
    const dem = 99283970
    // Fixture de documento já recebido, com conjunto físico completo.
    psql(`SET session_replication_role=replica;
      UPDATE public.bl_containers SET discharge_date='2026-09-01',return_date='2026-09-11' WHERE bl_id='${bl.full}';
      SET session_replication_role=origin;
      BEGIN;
      INSERT INTO public.demurrage_invoices(id,doc_number,bl_id,customer_id,status,paid_at,total_usd,current_roe,current_total_brl,roe_source)
        VALUES(${dem},'R839-DEM-REF','${bl.full}',${customerId},'paid','2026-10-01',100,5.5,550,'manual');
      INSERT INTO public.demurrage_invoice_items(invoice_id,container_id,container_number,container_type,discharge_date,return_date,total_days,free_days,subtotal_usd)
        SELECT ${dem},id,container_number,type,discharge_date,return_date,10,0,100 FROM public.bl_containers WHERE bl_id='${bl.full}';
      COMMIT;`)

    expect(asAdmin(`UPDATE public.bls SET customer_id=${otherCustomerId} WHERE id='${bl.full}'`).status).toBe(1)
    expect(asAdmin(`SELECT public.request_financial_refund('demurrage',${dem},551,'Cancelamento por cobrança indevida','cancel','00000000-0000-0000-0000-000000839050')`).status).toBe(1)
    const sql = `SELECT public.request_financial_refund('demurrage',${dem},550,'Cancelamento por cobrança indevida','cancel','00000000-0000-0000-0000-000000839051')`
    const requested = adminJson<{refund_id:number}>(sql)
    expect(adminJson(sql)).toMatchObject({refund_id:requested.refund_id,idempotent:true})
    expect(asAdmin(`SELECT public.reverse_demurrage_payment(${dem},'Não houve recebimento verdadeiro')`).status).toBe(1)
    adminJson(`SELECT public.confirm_demurrage_refund(${requested.refund_id},'DEM-REF-${requested.refund_id}','Cliente original','2026-10-01T12:00:00Z')`)
    expect(psql(`SELECT status||'|'||paid_at||'|'||current_total_brl||'|'||current_roe FROM public.demurrage_invoices WHERE id=${dem}`)).toBe('cancelled|2026-10-01|550.00|5.5000')
    expect(adminJson(`SELECT public.list_financial_refunds('demurrage',${dem})`)).toMatchObject({received_brl:550,refunds:[{status:'settled',amount_brl:550}]})
    psql(`UPDATE public.bls SET customer_id=${otherCustomerId} WHERE id='${bl.full}'`)
    expect(psql(`SELECT customer_id FROM public.demurrage_invoices WHERE id=${dem}`)).toBe(String(customerId))
  })

  it('cancelamento financeiro de B/L parcialmente pago abate saldo e restitui somente o recebido', () => {
    const inv=issueByCe(bl.full,'839000000000031')
    adminJson(`SELECT public.register_ledger_invoice_payment(${inv},200)`)
    const result=adminJson(`SELECT public.prepare_bl_financial_cancellation(${inv},'${bl.full}','Cancelamento autorizado por cobrança indevida')`)
    expect(result).toMatchObject({offset_brl:400,refund_brl:200,balance_brl:0})
    expect(adminJson(`SELECT public.prepare_bl_financial_cancellation(${inv},'${bl.full}','Cancelamento autorizado por cobrança indevida')`)).toMatchObject({status:'already_prepared'})
    const refund=Number(psql(`SELECT id FROM public.invoice_refunds WHERE invoice_id=${inv}`))
    adminJson(`SELECT public.confirm_invoice_refund(${refund},'CANCEL-REF-${refund}','Cliente original','2026-10-01T12:00:00Z')`)
    expect(adminJson(`SELECT public.cancel_bl('${bl.full}','Cobrança cancelada e devolução concluída')`)).toMatchObject({cancelled:true})
    expect(psql(`SELECT total_paid_brl FROM public.invoices WHERE id=${inv}`)).toBe('200.00')
    expect(psql(`SELECT count(*) FROM public.invoice_refunds WHERE invoice_id=${inv}`)).toBe('1')
  })

  it('cancelar B/L integralmente pago gera restituição integral sem apagar recebimento', () => {
    const inv=issueByCe(bl.full,'839000000000032')
    adminJson(`SELECT public.register_ledger_invoice_payment(${inv},600)`)
    expect(adminJson(`SELECT public.cancel_bl('${bl.full}','Cancelamento operacional autorizado')`)).toMatchObject({cancelled:true})
    expect(psql(`SELECT sum(amount_brl) FROM public.invoice_refunds WHERE invoice_id=${inv}`)).toBe('600.00')
    expect(psql(`SELECT total_paid_brl FROM public.invoices WHERE id=${inv}`)).toBe('600.00')
  })

  it('fatura avulsa devolve até o recebido e cancela sem apagar o pagamento', () => {
    const invoice=adminJson<{invoice_id:number}>(`SELECT public.create_manual_invoice(${customerId},'Taxa excepcional',1,600,'Teste de restituição')`).invoice_id
    const payment=adminJson<{payment_id:number}>(`SELECT public.register_verified_invoice_payment(${invoice},200,'ted','2026-10-01T12:00:00Z',NULL,'00000000-0000-0000-0000-000000839060','AVULSA-BANCO-60')`)
    expect(asAdmin(`SELECT public.request_financial_refund('manual',${invoice},201,'Cancelamento por cobrança indevida','cancel','00000000-0000-0000-0000-000000839061')`).status).toBe(1)
    const refund=adminJson<{refund_id:number}>(`SELECT public.request_financial_refund('manual',${invoice},200,'Cancelamento por cobrança indevida','cancel','00000000-0000-0000-0000-000000839062')`).refund_id
    expect(asAdmin(`SELECT public.reverse_invoice_payment(${payment.payment_id},'Lançamento feito sem recebimento')`).status).toBe(1)
    expect(asAdmin(`SELECT public.settle_invoice_refund(${refund})`).status).toBe(1)
    adminJson(`SELECT public.confirm_invoice_refund(${refund},'AVULSA-REF-${refund}','Cliente original','2026-10-01T12:00:00Z')`)
    expect(psql(`SELECT status||'|'||total_paid_brl||'|'||balance_brl FROM public.invoices WHERE id=${invoice}`)).toBe('cancelled|200.00|0.00')
    expect(adminJson(`SELECT public.list_invoice_details(${invoice})`)).toMatchObject({financial_summary:{gross_received_brl:200,refunded_brl:200,net_received_brl:0}})
  })

  it('troca de CNPJ em consolidada restitui só o B/L alterado e Financeiro conclui a reemissão', () => {
    issueByCe(bl.pairA,'839000000000033')
    issueByCe(bl.pairB,'839000000000034')
    const con=consolidate([bl.pairA,bl.pairB])
    adminJson(`SELECT public.register_ledger_invoice_payment(${con},1200)`)
    const old=receivableId(bl.pairA)
    psql(`UPDATE public.bls SET customer_id=${otherCustomerId} WHERE id='${bl.pairA}'`)
    expect(psql(`SELECT sum(amount_brl) FROM public.invoice_refunds WHERE correction_receivable_id=${old}`)).toBe('600.00')
    const refund=Number(psql(`SELECT id FROM public.invoice_refunds WHERE correction_receivable_id=${old}`))
    psql(`UPDATE public.user_profiles SET role='financeiro' WHERE id='${actorId}'`)
    const confirmation=adminJson(`SELECT public.confirm_invoice_refund(${refund},'CON-CNPJ-REF-${refund}','Cliente original','2026-10-01T12:00:00Z')`)
    expect(confirmation).toMatchObject({status:'settled'})
    const diagnostic=psql(`SELECT jsonb_build_object('change',(SELECT row_to_json(c) FROM public.invoice_customer_changes c WHERE receivable_id=${old}), 'pending',(SELECT row_to_json(p) FROM public.invoice_basis_pending_changes p WHERE p.bl_id='${bl.pairA}'))`)
    expect(psql(`SELECT status FROM public.invoice_customer_changes WHERE receivable_id=${old}`),diagnostic).toBe('completed')
    expect(psql(`SELECT original_amount_brl||'|'||settled_amount_brl||'|'||balance_brl FROM public.bl_receivables WHERE id=${receivableId(bl.pairB)}`)).toBe('600.00|600.00|0.00')
    expect(psql(`SELECT customer_id||'|'||total_paid_brl FROM public.invoices WHERE id=${con}`)).toBe(`${customerId}|1200.00`)
    expect(adminJson(`SELECT public.list_invoice_details(${con})`)).toMatchObject({financial_summary:{gross_received_brl:1200,refunded_brl:600,net_received_brl:600}})
    expect(psql(`SELECT total_brl||'|'||total_paid_brl FROM public.invoices WHERE customer_id=${otherCustomerId}`)).toBe('600.00|0.00')
  })

  it('recibo de individual coberta identifica consolidada, data e devolução atribuída a seu B/L', () => {
    const a=issueByCe(bl.pairA,'839000000000035')
    const b=issueByCe(bl.pairB,'839000000000036')
    const con=consolidate([bl.pairA,bl.pairB])
    adminJson(`SELECT public.register_ledger_invoice_payment(${con},1200,'ted','2026-10-01T12:00:00Z')`)
    psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.pairA}'`)
    const refund=Number(psql(`SELECT id FROM public.invoice_refunds WHERE invoice_id=${con}`))
    adminJson(`SELECT public.confirm_invoice_refund(${refund},'COVERED-REF-${refund}','Cliente original','2026-10-01T12:00:00Z')`)
    expect(adminJson(`SELECT public.list_invoice_details(${a})`)).toMatchObject({financial_summary:{gross_received_brl:600,refunded_brl:100,pending_refund_brl:0,net_received_brl:500,paid_at:'2026-10-01T12:00:00+00:00',covered_by_invoice_number:psql(`SELECT invoice_number FROM public.invoices WHERE id=${con}`)}})
    expect(adminJson(`SELECT public.list_invoice_details(${b})`)).toMatchObject({financial_summary:{gross_received_brl:600,refunded_brl:0,net_received_brl:600}})
  })

  it('leitura sem Financeiro não confirma restituição nem altera sua evidência diretamente', () => {
    const inv=issueByCe(bl.full,'839000000000037')
    adminJson(`SELECT public.register_ledger_invoice_payment(${inv},600)`)
    psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.full}'`)
    const refund=Number(psql(`SELECT id FROM public.invoice_refunds WHERE invoice_id=${inv}`))
    psql(`UPDATE public.user_profiles SET role='equipamentos' WHERE id='${actorId}'`)
    expect(asAdmin(`SELECT public.confirm_invoice_refund(${refund},'NO-AUTH-REF','Cliente original','2026-10-01T12:00:00Z')`).status).toBe(1)
    expect(asAdmin(`UPDATE public.invoice_refunds SET status='settled' WHERE id=${refund}`).status).toBe(1)
    expect(psql(`SELECT status FROM public.invoice_refunds WHERE id=${refund}`)).toBe('pending')
    psql(`SET session_replication_role=replica; UPDATE public.user_profiles SET role='administrativo' WHERE id='${actorId}'; SET session_replication_role=origin`)
    adminJson(`SELECT public.confirm_invoice_refund(${refund},'GUARD-REF-${refund}','Cliente original','2026-10-01T12:00:00Z')`)
    expect(asAdmin(`DELETE FROM public.invoice_refunds WHERE id=${refund}`).status).toBe(1)
    expect(psql(`SELECT status FROM public.invoice_refunds WHERE id=${refund}`)).toBe('settled')
  })

  it('falha de reemissão após devolver preserva restituição e permite retry sem duplicar cobrança', () => {
    const inv=issueByCe(bl.full,'839000000000038')
    adminJson(`SELECT public.register_ledger_invoice_payment(${inv},600)`)
    const old=receivableId(bl.full)
    psql(`UPDATE public.bls SET customer_id=${otherCustomerId} WHERE id='${bl.full}'; UPDATE public.customer_billing_portal_releases SET granted_at=now()-interval '2 days',review_at=now()-interval '1 day' WHERE customer_id=${otherCustomerId}`)
    const refund=Number(psql(`SELECT id FROM public.invoice_refunds WHERE correction_receivable_id=${old}`))
    adminJson(`SELECT public.confirm_invoice_refund(${refund},'RETRY-CNPJ-REF-${refund}','Cliente original','2026-10-01T12:00:00Z')`)
    expect(psql(`SELECT status FROM public.invoice_customer_changes WHERE receivable_id=${old}`)).toBe('reissue_pending')
    expect(JSON.parse(psql(`SELECT ce_unlock_private.item('${bl.full}')`))).toMatchObject({ paid: false, can_submit: false })
    expect(psql(`SELECT status FROM public.invoice_refunds WHERE id=${refund}`)).toBe('settled')
    psql(`UPDATE public.customer_billing_portal_releases SET review_at=now()+interval '1 day' WHERE customer_id=${otherCustomerId}`)
    expect(adminJson(`SELECT public.retry_invoice_basis_changes('${bl.full}')`)).toMatchObject({status:'completed'})
    expect(psql(`SELECT count(*) FROM public.invoice_basis_pending_changes WHERE bl_id='${bl.full}'`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.invoices WHERE customer_id=${otherCustomerId}`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.invoice_refunds WHERE correction_receivable_id=${old}`)).toBe('1')
  })

  it('excedente de avulsa registra bruto integral e cria restituição do que ultrapassa o saldo', () => {
    const inv=adminJson<{invoice_id:number}>(`SELECT public.create_manual_invoice(${customerId},'Taxa avulsa com excedente',1,100,'Teste de excedente')`).invoice_id
    expect(adminJson(`SELECT public.register_verified_invoice_payment(${inv},125,'ted','2026-10-01T12:00:00Z',NULL,'00000000-0000-0000-0000-000000839070','AVULSA-EXCEDENTE-70')`)).toMatchObject({refund_due_brl:25})
    expect(psql(`SELECT total_paid_brl||'|'||balance_brl FROM public.invoices WHERE id=${inv}`)).toBe('125.00|0.00')
    expect(psql(`SELECT amount_brl FROM public.invoice_refunds WHERE invoice_id=${inv}`)).toBe('25.00')
    expect(adminJson(`SELECT public.list_invoice_details(${inv})`)).toMatchObject({financial_summary:{gross_received_brl:125,pending_refund_brl:25,net_received_brl:125}})
  })

  it('baixa falsa com excedente ainda não devolvido cancela excesso pendente e reabre avulsa', () => {
    const inv=adminJson<{invoice_id:number}>(`SELECT public.create_manual_invoice(${customerId},'Taxa avulsa',1,100,'Teste de baixa falsa')`).invoice_id
    const payment=adminJson<{payment_id:number}>(`SELECT public.register_verified_invoice_payment(${inv},125,'ted','2026-10-01T12:00:00Z',NULL,'00000000-0000-0000-0000-000000839071','AVULSA-ERRO-71')`).payment_id
    expect(psql(`SELECT status FROM public.invoice_refunds WHERE invoice_id=${inv}`)).toBe('pending')
    adminJson(`SELECT public.reverse_invoice_payment(${payment},'Comprovante falso, não houve recebimento')`)
    expect(psql(`SELECT total_paid_brl||'|'||balance_brl||'|'||status FROM public.invoices WHERE id=${inv}`)).toBe('0.00|100.00|issued')
    expect(psql(`SELECT count(*) FROM public.invoice_refunds WHERE invoice_id=${inv} AND status='pending'`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE field_name='pending_excess_cancelled' AND changed_by='${actorId}'`)).toBe('1')
  })

  it('relink interno do importador preserva documento pago e prepara restituição original', () => {
    const inv=issueByCe(bl.full,'839000000000039')
    adminJson(`SELECT public.register_ledger_invoice_payment(${inv},200)`)
    expect(asAdmin(`SELECT public.relink_bl_customer('${bl.full}',${otherCustomerId},'${actorId}','Cliente corrigido')`).status).toBe(1)
    expect(JSON.parse(psql(`SELECT public.relink_bl_customer('${bl.full}',${otherCustomerId},'${actorId}','CNPJ do consignatário corrigido')`))).toMatchObject({applied:true,financial_policy:'refund_original_then_reissue'})
    expect(psql(`SELECT customer_id||'|'||total_paid_brl FROM public.invoices WHERE id=${inv}`)).toBe(`${customerId}|200.00`)
    expect(psql(`SELECT amount_brl FROM public.invoice_refunds WHERE invoice_id=${inv}`)).toBe('200.00')
    expect(psql(`SELECT count(*) FROM public.invoices WHERE customer_id=${otherCustomerId}`)).toBe('0')
  })

  it('CNPJ de B/L com avulsa recebida exige devolver antes e preserva o cadastro enquanto pendente', () => {
    const inv=adminJson<{invoice_id:number}>(`SELECT public.create_manual_invoice(${customerId},'Serviço do B/L',1,100,'Serviço adicional','${bl.full}')`).invoice_id
    adminJson(`SELECT public.register_verified_invoice_payment(${inv},100,'ted','2026-10-01T12:00:00Z',NULL,'00000000-0000-0000-0000-000000839072','CNPJ-AVULSA-72')`)
    expect(asAdmin(`UPDATE public.bls SET customer_id=${otherCustomerId} WHERE id='${bl.full}'`).status).toBe(1)
    expect(psql(`SELECT customer_id FROM public.bls WHERE id='${bl.full}'`)).toBe(String(customerId))
    const refund=adminJson<{refund_id:number}>(`SELECT public.request_financial_refund('manual',${inv},100,'Troca de CNPJ com devolução integral','cancel','00000000-0000-0000-0000-000000839073')`).refund_id
    adminJson(`SELECT public.confirm_invoice_refund(${refund},'CNPJ-AVULSA-REF-${refund}','Cliente original','2026-10-01T12:00:00Z')`)
    psql(`UPDATE public.bls SET customer_id=${otherCustomerId} WHERE id='${bl.full}'`)
    expect(psql(`SELECT customer_id FROM public.bls WHERE id='${bl.full}'`)).toBe(String(otherCustomerId))
    expect(psql(`SELECT customer_id FROM public.invoices WHERE id=${inv}`)).toBe(String(customerId))
  })

  it.each([200, 600])('CE não aproveita R$ %s do Cliente anterior durante troca de CNPJ', (amount) => {
    const invoice = issueByCe(bl.full, '839000000000081')
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoice},${amount})`)
    const old = receivableId(bl.full)
    expect(JSON.parse(psql(`SELECT ce_unlock_private.item('${bl.full}')`)).paid).toBe(amount === 600)
    psql(`UPDATE public.bls SET customer_id=${otherCustomerId} WHERE id='${bl.full}'`)
    expect(psql(`SELECT status FROM public.invoice_customer_changes WHERE receivable_id=${old}`)).toBe('pending_refund')
    expect(JSON.parse(psql(`SELECT ce_unlock_private.item('${bl.full}')`))).toMatchObject({ paid: false, can_submit: false })
    const payload = JSON.stringify({ customer_id: otherCustomerId, bl_ids: [bl.full], request_key: '00000000-0000-0000-0000-000000839081' })
    const draft = asAdmin(`SELECT public.ce_unlock_command('draft','${payload}'::jsonb)`)
    expect(draft.status, 'rascunho CE deve revalidar a pendência financeira').toBe(1)
    expect(draft.stderr).toContain('não pode ser solicitado')
    const refund = Number(psql(`SELECT id FROM public.invoice_refunds WHERE correction_receivable_id=${old}`))
    adminJson(`SELECT public.confirm_invoice_refund(${refund},'CE-CNPJ-REF-${refund}','Cliente original','2026-10-01T12:00:00Z')`)
    expect(psql(`SELECT status FROM public.invoice_customer_changes WHERE receivable_id=${old}`)).toBe('completed')
    expect(JSON.parse(psql(`SELECT ce_unlock_private.item('${bl.full}')`))).toMatchObject({ paid: false, can_submit: false })
    const next = Number(psql(`SELECT id FROM public.invoices WHERE customer_id=${otherCustomerId} AND status='issued' AND invoice_type='individual'`))
    adminJson(`SELECT public.register_ledger_invoice_payment(${next},600)`)
    expect(JSON.parse(psql(`SELECT ce_unlock_private.item('${bl.full}')`))).toMatchObject({ paid: true, can_submit: true })
  })

  it('CE conserva aptidão por redução normal com restituição de excedente pendente', () => {
    const invoice = issueByCe(bl.full, '839000000000082')
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoice},600)`)
    psql(`UPDATE public.bl_containers SET ownership='SOC' WHERE bl_id='${bl.full}'`)
    expect(psql(`SELECT sum(amount_brl) FROM public.invoice_refunds WHERE invoice_id=${invoice} AND status='pending'`)).toBe('100.00')
    expect(JSON.parse(psql(`SELECT ce_unlock_private.item('${bl.full}')`))).toMatchObject({ paid: true, can_submit: true })
  })

  it.each([200, 600])('nova cobrança após devolver R$ %s conserva saldo e permite pagamento próprio', (amount) => {
    const original = issueByCe(bl.full, '839000000000083')
    adminJson(`SELECT public.register_ledger_invoice_payment(${original},${amount})`)
    const old = receivableId(bl.full)
    psql(`UPDATE public.bls SET customer_id=${otherCustomerId} WHERE id='${bl.full}'`)
    const refund = Number(psql(`SELECT id FROM public.invoice_refunds WHERE correction_receivable_id=${old}`))
    adminJson(`SELECT public.confirm_invoice_refund(${refund},'NEW-CNPJ-REF-${refund}','Cliente original','2026-10-01T12:00:00Z')`)
    const current = receivableId(bl.full)
    expect(psql(`SELECT status FROM public.bl_receivables WHERE id=${old}`)).toBe('void')
    expect(psql(`SELECT settled_amount_brl||'|'||balance_brl||'|'||status FROM public.bl_receivables WHERE id=${current}`)).toBe('0.00|600.00|open')
    const next = Number(psql(`SELECT id FROM public.invoices WHERE customer_id=${otherCustomerId} AND status='issued' AND invoice_type='individual'`))
    adminJson(`SELECT public.register_ledger_invoice_payment(${next},600)`)
    expect(psql(`SELECT sum(amount_brl) FROM public.ledger_settlements WHERE receivable_id=${current}`)).toBe('600.00')
    expect(psql(`SELECT total_paid_brl FROM public.invoices WHERE id=${original}`)).toBe(`${amount}.00`)
    // Voltar ao CNPJ inicial não reutiliza nenhum recebimento já restituído.
    psql(`UPDATE public.bls SET customer_id=${customerId} WHERE id='${bl.full}'`)
    const second = Number(psql(`SELECT id FROM public.invoice_refunds WHERE correction_receivable_id=${current}`))
    adminJson(`SELECT public.confirm_invoice_refund(${second},'BACK-CNPJ-REF-${second}','Cliente anterior','2026-10-01T12:00:00Z')`)
    expect(psql(`SELECT settled_amount_brl||'|'||balance_brl FROM public.bl_receivables WHERE id=${receivableId(bl.full)}`)).toBe('0.00|600.00')
  })

});
