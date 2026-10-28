// Migration 483 (revisão da PR #1070; ADR 0093, decisão 17): dois Pix pagos
// no mesmo QR e os dois em análise. A conciliação pelo extrato quita a fatura
// e fecha um Pix só; o outro continua em análise com a Restituição
// `pix_duplicate` e o alerta. O cenário roda numa transação desfeita no fim.
//
// Namespace exclusivo: Cliente 9830010, fatura 9830100, Pix E483DUP*.
import { spawnPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const FIN = '98300000-0000-4000-8000-000000000001'
const TXID = 'VELA483000000000000000000000000A'

describeLocal('Pix em dobro na mesma cobrança (migration 483)', () => {
  it('o extrato quita a fatura, fecha o Pix mais antigo e o outro vira Restituição pix_duplicate em análise', () => {
    const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
      BEGIN;
      SET LOCAL session_replication_role = replica;
      INSERT INTO auth.users (id, email) VALUES ('${FIN}', 'fin483@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${FIN}', 'Fin 483', 'financeiro', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (9830010, '98300000000110', 'Cliente 483');
      INSERT INTO public.invoices (id, invoice_number, customer_id, total_brl, balance_brl, invoice_type, status)
        VALUES (9830100, 'RVW483-AV', 9830010, 10, 10, 'manual', 'issued');
      INSERT INTO public.itau_pix_charges (invoice_id, txid, amount_brl, expiration_seconds, status)
        VALUES (9830100, '${TXID}', 10, 3600, 'active');
      SET LOCAL session_replication_role = origin;
      -- Sem a conta da baixa automática, os dois Pix entram em análise.
      UPDATE public.app_settings SET itau_pix_settlement_actor = NULL WHERE id = 1;
      SET LOCAL request.jwt.claim.role = 'service_role';
      SELECT public.itau_pix_receive('E483DUP1', '${TXID}', 10, now() - interval '10 min') IS NOT NULL;
      SELECT public.itau_pix_receive('E483DUP2', '${TXID}', 10, now() - interval '5 min') IS NOT NULL;
      SET LOCAL request.jwt.claim.role = 'authenticated';
      SET LOCAL request.jwt.claim.sub = '${FIN}';
      SET LOCAL request.jwt.claims = '{"sub":"${FIN}","role":"authenticated"}';
      SELECT public.reconcile_invoice_payment_by_txid('${TXID}', 10, now()) IS NOT NULL;
      RESET request.jwt.claim.role;
      SELECT '>' || string_agg(end_to_end_id || ':' || status, ',' ORDER BY end_to_end_id)
        FROM public.itau_pix_receipts WHERE end_to_end_id LIKE 'E483DUP%';
      SELECT '>fatura=' || status FROM public.invoices WHERE id = 9830100;
      SELECT '>restituicao=' || string_agg(origin || ':' || itau_end_to_end_id || ':' || amount_brl, ',')
        FROM public.invoice_refunds WHERE invoice_id = 9830100;
      SELECT '>alerta=' || string_agg(metadata->>'end_to_end_id', ',')
        FROM public.alert_items WHERE item_type = 'pix_unreconciled' AND status = 'active'
         AND metadata->>'end_to_end_id' LIKE 'E483DUP%';
      ROLLBACK;
    `], { encoding: 'utf8' })
    expect(run.stderr).toBe('')
    expect(run.stdout.split('\n').filter((line) => line.startsWith('>'))).toEqual([
      '>E483DUP1:handled,E483DUP2:review',
      '>fatura=paid',
      '>restituicao=pix_duplicate:E483DUP2:10.00',
      '>alerta=E483DUP2',
    ])
  })
})
