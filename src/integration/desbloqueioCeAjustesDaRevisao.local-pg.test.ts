// Migration 487 (revisão da PR #1070; decisões do dono de 2026-10-27; ADR
// 0110): o B/L que passa de uma solicitação para outra conta pelo primeiro
// envio (o rascunho e o envio VIP concordam), e a solicitação VIP que já tinha
// o anual ligado continua coberta. Cada cenário roda numa transação desfeita.
//
// Namespace exclusivo: Clientes 9487001/9487002, B/Ls L487-*, usuários ...000487NNN.
import { spawnPsql } from './localPsql'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

// Cliente VIP com os anuais de 2025 aprovados e três B/Ls com CE, pagos e entregues.
const FIXTURES = `
SET LOCAL session_replication_role=replica;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-000000487001','l11adm@example.test'),('00000000-0000-0000-0000-000000487002','l11a@example.test'),('00000000-0000-0000-0000-000000487003','l11b@example.test');
INSERT INTO public.user_profiles(id,full_name,role,active) VALUES ('00000000-0000-0000-0000-000000487001','L487 adm','administrativo',true);
INSERT INTO public.customers(id,cnpj_cpf,name) VALUES (9487001,'48700100000101','L487 A'),(9487002,'48700200000102','L487 B');
INSERT INTO public.customer_portal_accounts(customer_id,auth_user_id,active,account_situation) VALUES (9487001,'00000000-0000-0000-0000-000000487002',true,'ativo'),(9487002,'00000000-0000-0000-0000-000000487003',true,'ativo');
INSERT INTO public.carriers(id,name) VALUES(9487001,'L487 carrier');
INSERT INTO public.vessels(id,name,carrier_id) VALUES(9487001,'L487 vessel',9487001);
INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(9487001,9487001,'L487-V','active');
INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante,created_at) VALUES
 ('L487-X',9487001,9487001,'948700000000001','2025-11-20T10:00:00-03:00'),
 ('L487-Y',9487001,9487001,'948700000000002','2025-11-20T10:00:00-03:00'),
 ('L487-Z',9487001,9487001,'948700000000003','2025-11-20T10:00:00-03:00');
INSERT INTO public.bl_receivables(id,bl_id,customer_id,original_amount_brl,settled_amount_brl,balance_brl,status,source) VALUES
 (9487001,'L487-X',9487001,100,100,0,'settled','local_charges'),(9487002,'L487-Y',9487001,100,100,0,'settled','local_charges'),(9487003,'L487-Z',9487001,100,100,0,'settled','local_charges');
INSERT INTO public.ledger_settlements(receivable_id,amount_brl,source) VALUES (9487001,100,'manual'),(9487002,100,'manual'),(9487003,100,'manual');
INSERT INTO public.ce_unlock_vip_customers(customer_id,enabled) VALUES (9487001,true),(9487002,true);
-- anuais 2025 de A e B
INSERT INTO public.ce_unlock_documents(id,customer_id,type,source,status,file_name,storage_path,size_bytes,hash,uploaded_by,coverage_year,valid_from,valid_until,created_at,reviewed_at) VALUES
 ('a0000000-0000-0000-0000-000000002025',9487001,'termo','vip_annual','approved','t.pdf','x/1',1,repeat('a',64),'00000000-0000-0000-0000-000000487002',2025,'2025-01-01','2025-12-31','2025-01-01T10:00:00-03:00','2025-01-01T10:00:00-03:00'),
 ('a1000000-0000-0000-0000-000000002025',9487001,'procuracao','vip_annual','approved','p.pdf','x/2',1,repeat('a',64),'00000000-0000-0000-0000-000000487002',2025,'2025-01-01','2025-12-31','2025-01-01T10:00:00-03:00','2025-01-01T10:00:00-03:00'),
 ('b0000000-0000-0000-0000-000000002025',9487002,'termo','vip_annual','approved','t.pdf','x/3',1,repeat('a',64),'00000000-0000-0000-0000-000000487003',2025,'2025-01-01','2025-12-31','2025-01-01T10:00:00-03:00','2025-01-01T10:00:00-03:00'),
 ('b1000000-0000-0000-0000-000000002025',9487002,'procuracao','vip_annual','approved','p.pdf','x/4',1,repeat('a',64),'00000000-0000-0000-0000-000000487003',2025,'2025-01-01','2025-12-31','2025-01-01T10:00:00-03:00','2025-01-01T10:00:00-03:00');
INSERT INTO public.ce_unlock_bl_deliveries(bl_id,delivered) VALUES ('L487-X',true),('L487-Y',true),('L487-Z',true);
SET LOCAL session_replication_role=origin;
`

// O INSERT da 487 que guarda os vínculos da transição, reexecutado sobre os
// dados do cenário (que nascem depois da migration).
const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/487_desbloqueio_ce_ajustes_da_revisao.sql'), 'utf8')
const keepTransition = migration.slice(
  migration.indexOf('INSERT INTO public.ce_unlock_annual_kept_by_transition'),
  migration.indexOf('ON CONFLICT DO NOTHING;') + 'ON CONFLICT DO NOTHING;'.length,
)

/** Roda o cenário numa transação desfeita; devolve as linhas que começam com '>'. */
function scenario(sql: string): { lines: string[]; stderr: string } {
  const run = spawnPsql(['-X', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  return { lines: run.stdout.split('\n').filter((line) => line.startsWith('>')), stderr: run.stderr }
}

describeLocal('Desbloqueio de CE: ajustes da revisão (migration 487)', () => {
  it('P8a: B/L da solicitação enviada em dezembro passa para uma nova em 2026 — o rascunho nasce VIP e o envio aceita', () => {
    const { lines, stderr } = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.ce_unlock_requests(id,customer_id,source,state,created_by,created_at)
        VALUES ('c4870000-0000-0000-0000-000000000002',9487001,'vip_annual','in_review','00000000-0000-0000-0000-000000487002','2025-12-15T10:00:00-03:00');
      INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request,termo_document_id,procuracao_document_id)
        VALUES ('c4870000-0000-0000-0000-000000000002','L487-X','948700000000001','a0000000-0000-0000-0000-000000002025','a1000000-0000-0000-0000-000000002025');
      INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,created_at)
        VALUES (9487001,'c4870000-0000-0000-0000-000000000002','submit','00000000-0000-0000-0000-000000487002','2025-12-15T10:00:00-03:00');
      SET LOCAL session_replication_role = origin;
      SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000487002';
      DO $$
      DECLARE v_draft jsonb; v_sent jsonb;
      BEGIN
        v_draft := public.portal_ce_unlock_command('draft', '{"bl_ids":["L487-X"],"request_key":"11111111-1111-1111-1111-111111111487"}'::jsonb);
        RAISE NOTICE '>rascunho=%', v_draft->>'source';
        v_sent := public.portal_ce_unlock_command('submit', jsonb_build_object('request_id', v_draft->>'id',
          'expected_version', (v_draft->>'version')::bigint, 'request_key', '22222222-2222-2222-2222-222222222487'));
        RAISE NOTICE '>envio=%', v_sent->>'state';
      END $$;
    `)
    const notices = stderr.split('\n').map((line) => line.replace(/^NOTICE:\s+/, '')).filter((line) => line.startsWith('>'))
    expect(stderr).not.toMatch(/ERROR/)
    expect(notices).toEqual(['>rascunho=vip_annual', '>envio=completed'])
    expect(lines).toEqual([])
  })

  it('P8b: solicitação VIP exportada com o anual ligado pela regra anterior não reabre', () => {
    const { lines, stderr } = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.ce_unlock_requests(id,customer_id,source,state,created_by,created_at)
        VALUES ('c4870000-0000-0000-0000-000000000003',9487001,'vip_annual','completed','00000000-0000-0000-0000-000000487002','2026-01-05T10:00:00-03:00');
      INSERT INTO public.ce_unlock_exports(id,layout_version,rows,snapshot,created_by)
        VALUES ('e4870000-0000-0000-0000-000000000003','zpt-5-v2','[]','[]','00000000-0000-0000-0000-000000487001');
      INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request,termo_document_id,procuracao_document_id,exported_at,export_id)
        VALUES ('c4870000-0000-0000-0000-000000000003','L487-Z','948700000000003','a0000000-0000-0000-0000-000000002025','a1000000-0000-0000-0000-000000002025','2026-01-06T10:00:00-03:00','e4870000-0000-0000-0000-000000000003');
      INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,created_at) VALUES
        (9487001,'c4870000-0000-0000-0000-000000000003','submit','00000000-0000-0000-0000-000000487002','2026-01-05T10:00:00-03:00'),
        (9487001,'c4870000-0000-0000-0000-000000000003','complete','00000000-0000-0000-0000-000000487002','2026-01-05T11:00:00-03:00');
      SET LOCAL session_replication_role = origin;
      -- A 487 roda com esta solicitação já existente.
      ${keepTransition}
      SELECT '>guardado=' || count(*) FROM public.ce_unlock_annual_kept_by_transition WHERE bl_id = 'L487-Z';
      SELECT public.ce_unlock_refresh_open() IS NOT NULL;
      SELECT '>' || state FROM public.ce_unlock_requests WHERE id = 'c4870000-0000-0000-0000-000000000003';
      SELECT '>' || string_agg(action, ',' ORDER BY id) FROM public.ce_unlock_events WHERE request_id = 'c4870000-0000-0000-0000-000000000003';
    `)
    expect(stderr).not.toMatch(/ERROR/)
    expect(keepTransition.startsWith('INSERT INTO public.ce_unlock_annual_kept_by_transition')).toBe(true)
    expect(lines).toEqual(['>guardado=2', '>completed', '>submit,complete'])
  })
})
