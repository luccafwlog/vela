// Migration 616 (ADR 0132, decisão 7): o B/L que fica pronto depois do
// Comunicado de CE e Taxas da Viagem abre "Reenviar Comunicado de CE e Taxas";
// o B/L já comunicado e o B/L ainda sem CE não abrem; o Comunicado seguinte
// com o B/L fecha (gatilho da 469). Cada cenário roda numa transação desfeita.
//
// Namespace exclusivo: Cliente/Viagem 996160, B/Ls 'A616-*'.
import { execPsql } from './localPsql'
import { describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const ID = 996160

function sql(q: string): string[] {
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    .replaceAll(String.fromCharCode(13), '').trim().split('\n').filter((line) => line.startsWith('>'))
}

const state = `SELECT '>' || a.entity_id || '|' || i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.item_type = 'comunicado_ce_reenvio_pendente' AND a.entity_id LIKE 'A616-%' ORDER BY a.entity_id;`

const FIXTURE = `
  SET LOCAL request.jwt.claim.role = 'service_role';
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${ID}, '${syntheticCnpj(61601)}', 'A616');
  INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${ID}, 1, 'A616', 'active');
  INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, ce_mercante, review_status, financial_status, charge_status) VALUES
    ('A616-SENT', ${ID}, ${ID}, 'container', '996160000000001', 'ok', 'invoiced', 'calculated'),
    ('A616-LATE', ${ID}, ${ID}, 'container', '996160000000002', 'ok', 'invoiced', 'calculated'),
    ('A616-NOCE', ${ID}, ${ID}, 'container', NULL, 'ok', 'pending', 'calculated');
  INSERT INTO public.customer_communications (id, customer_id, kind, nature, status, anchor_voyage_id, created_at)
    VALUES (${ID}, ${ID}, 'ce_mercante_taxas', 'documentacao', 'enviado', ${ID}, now() - interval '2 days');
  INSERT INTO public.customer_communication_bls (communication_id, bl_id) VALUES (${ID}, 'A616-SENT');
  SET LOCAL session_replication_role = origin;
  SELECT public.reconcile_ce_taxas_late_bl_alerts('teste_616') >= 0;
`

local('Reenvio do CE e Taxas para B/L pronto depois do Comunicado (migration 616)', () => {
  it('só o B/L pronto e ainda não comunicado abre o alerta; a rodada seguinte não duplica', () => {
    expect(sql(`BEGIN; ${FIXTURE} SELECT public.reconcile_ce_taxas_late_bl_alerts('teste_616') >= 0; ${state} ROLLBACK;`))
      .toEqual(['>A616-LATE|active'])
  })

  it('o Comunicado enviado com o B/L fecha o alerta', () => {
    expect(sql(`BEGIN; ${FIXTURE}
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.customer_communications (id, customer_id, kind, nature, status, anchor_voyage_id, attempt_discriminator)
        VALUES (${ID + 1}, ${ID}, 'ce_mercante_taxas', 'documentacao', 'pendente', ${ID}, 1);
      INSERT INTO public.customer_communication_bls (communication_id, bl_id) VALUES (${ID + 1}, 'A616-SENT'), (${ID + 1}, 'A616-LATE');
      SET LOCAL session_replication_role = origin;
      UPDATE public.customer_communications SET status = 'enviado' WHERE id = ${ID + 1};
      ${state} ROLLBACK;`)).toEqual(['>A616-LATE|resolved'])
  })
})
