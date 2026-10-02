import { execFileSync, spawnSync } from 'node:child_process'
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
    DELETE FROM public.invoice_basis_pending_changes WHERE bl_id = ANY(${bls});
    DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN ${invoices};
    DELETE FROM public.cod_adjustments WHERE bl_id = ANY(${bls}); DELETE FROM public.bl_transshipments WHERE bl_id = ANY(${bls}); DELETE FROM public.voyage_omissions WHERE voyage_id = ${voyageId}; DELETE FROM public.invoice_corrections WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_refunds WHERE invoice_id IN ${invoices};
    DELETE FROM public.ledger_settlements WHERE invoice_id IN ${invoices};
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

});
