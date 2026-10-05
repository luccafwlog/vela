import { execFileSync } from 'node:child_process'
import { describe, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const describeLocal = enabled ? describe : describe.skip

describeLocal('BLs e CEs automáticos por escala — PostgreSQL descartável', () => {
  it('concilia o lote completo, respeita rota/porto e override, regride com perda de cobertura e aprova Granito', () => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) {
      throw new Error('Este teste exige banco local descartável.')
    }
    execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-d', databaseUrl], {
      encoding: 'utf8',
      input: `
        BEGIN;
        SET LOCAL session_replication_role = replica;
        INSERT INTO auth.users(id, email, aud, role)
        VALUES ('13400000-0000-4000-8000-0000000000a1', 'documental134@test.local', 'authenticated', 'authenticated');
        INSERT INTO public.user_profiles(id, full_name, role, active)
        VALUES ('13400000-0000-4000-8000-0000000000a1', 'Documental 134', 'administrativo', true);
        INSERT INTO public.carriers(id, name) VALUES (13400001, 'DOCUMENTAL TEST');
        INSERT INTO public.vessels(id, carrier_id, name) VALUES (13400001, 13400001, 'DOCUMENTAL TEST');
        INSERT INTO public.voyages(id, vessel_id, voyage_number) VALUES (13400001, 13400001, '134TEST');
        SET LOCAL session_replication_role = origin;
        CREATE FUNCTION pg_temp.check_status(p_port text, p_expected text) RETURNS void LANGUAGE plpgsql AS $$
        DECLARE actual text; snapshot text;
        BEGIN
          SELECT new_value INTO actual FROM public.audit_logs
          WHERE entity_type = 'voyage_pod_schedule' AND entity_id = '13400001::' || p_port AND field_name = 'ces'
          ORDER BY changed_at DESC, id DESC LIMIT 1;
          IF coalesce(actual, 'waiting') <> p_expected THEN
            RAISE EXCEPTION 'Porto %, esperado %, recebido %, rota/estado %', p_port, p_expected, actual,
              (SELECT pol || '/' || financial_status FROM public.bls WHERE id = 'DOC134A');
          END IF;
          SELECT pod_schedule_snapshot -> p_port ->> 'ces' INTO snapshot FROM public.voyages WHERE id = 13400001;
          IF coalesce(snapshot, 'waiting') <> p_expected THEN
            RAISE EXCEPTION 'Snapshot do porto %, esperado %, recebido %', p_port, p_expected, snapshot;
          END IF;
        END; $$;
        GRANT EXECUTE ON FUNCTION pg_temp.check_status(text, text) TO authenticated;
        SELECT set_config('request.jwt.claims', '{"sub":"13400000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
        SET LOCAL ROLE authenticated;
        DO $$ BEGIN
          IF has_table_privilege('authenticated', 'public.voyage_documental_state', 'INSERT')
            OR has_table_privilege('authenticated', 'public.voyage_documental_pending', 'INSERT')
            OR has_function_privilege('authenticated', 'public.sync_voyage_documental_status(bigint,boolean)', 'EXECUTE') THEN
            RAISE EXCEPTION 'Automação exposta ao cliente';
          END IF;
        END; $$;

        INSERT INTO public.bls(id, voyage_id, pol, pod) VALUES ('DOC134A', 13400001, 'CNTAC', 'BRVIX');
        INSERT INTO public.bl_containers(bl_id, container_number) VALUES ('DOC134A', 'ABCD1234567');
        SET CONSTRAINTS ALL IMMEDIATE;
        SELECT pg_temp.check_status('BRVIX', 'waiting');
        SET CONSTRAINTS ALL DEFERRED;
        INSERT INTO public.baplie_containers(voyage_id, container_number, status, pol, pod) VALUES
          (13400001, 'ABCD1234567', 'full', 'CNTAI', 'BRVIT'),
          (13400001, 'ABCD1234568', 'full', 'CNTAI', 'BRVIT'),
          (13400001, 'ABCD1234569', 'empty', 'CNTAI', 'BRVIX'),
          (13400001, 'ABCD1234570', 'full', 'CNTAI', 'BRSSZ');
        SET CONSTRAINTS ALL IMMEDIATE;
        SELECT pg_temp.check_status('BRVIX', 'waiting');
        SET CONSTRAINTS ALL DEFERRED;
        INSERT INTO public.bl_containers(bl_id, container_number) VALUES ('DOC134A', 'ABCD1234568');
        SET CONSTRAINTS ALL IMMEDIATE;
        SELECT pg_temp.check_status('BRVIX', 'received');
        SELECT pg_temp.check_status('BRSSZ', 'waiting');
        DO $$ BEGIN
          BEGIN
            INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by)
            VALUES ('voyage_pod_schedule', '13400001::BRVIX', 'ces', 'approved', 'approved', auth.uid());
            RAISE EXCEPTION 'Aceitou alteração sem justificativa';
          EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
          BEGIN
            INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, justification, changed_by)
            VALUES ('voyage_pod_schedule', '13400001::BRVIX', 'ces', 'inexistente', 'Não deve aceitar status inválido', auth.uid());
            RAISE EXCEPTION 'Aceitou status documental inválido';
          EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
        END; $$;
        INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, justification, changed_by)
        VALUES ('voyage_pod_schedule', '13400001::BRVIX', 'ces', 'received', 'partial', 'Estado legado', auth.uid());
        INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by)
        VALUES ('voyage_pod_schedule', '13400001::BRVIX', 'ces', 'partial', 'launching', auth.uid());
        SELECT pg_temp.check_status('BRVIX', 'launching');
        INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, justification, changed_at, changed_by)
        VALUES ('voyage_pod_schedule', '13400001::BRVIX', 'ces', 'received', 'approving', 'Conferência manual', clock_timestamp(), auth.uid());
        UPDATE public.bls SET notes = 'Sem alteração documental' WHERE id = 'DOC134A';
        SELECT pg_temp.check_status('BRVIX', 'approving');
        RESET ROLE;
        DELETE FROM public.voyage_documental_state WHERE voyage_id = 13400001 AND port = 'BRVIX';
        SELECT public.sync_voyage_documental_status(13400001, true);
        SET LOCAL ROLE authenticated;
        SELECT pg_temp.check_status('BRVIX', 'approving');
        SET CONSTRAINTS ALL DEFERRED;
        UPDATE public.bls SET ce_mercante = '134001' WHERE id = 'DOC134A';
        SET CONSTRAINTS ALL IMMEDIATE;
        SELECT pg_temp.check_status('BRVIX', 'approved');
        UPDATE public.bls SET pol = 'CNSHA' WHERE id = 'DOC134A';
        SELECT pg_temp.check_status('BRVIX', 'waiting');
        UPDATE public.bls SET pol = 'CNTAC' WHERE id = 'DOC134A';
        SELECT pg_temp.check_status('BRVIX', 'approved');
        SELECT public.cancel_bl('DOC134A', 'BL substituído pelo armador');
        SELECT pg_temp.check_status('BRVIX', 'waiting');
        SELECT public.reactivate_bl('DOC134A', 'Cancelamento por engano');
        SELECT pg_temp.check_status('BRVIX', 'approved');
        SET CONSTRAINTS ALL DEFERRED;
        -- Exclusão de filhos é uma escrita privilegiada no contrato existente.
        RESET ROLE;
        DELETE FROM public.bl_containers WHERE bl_id = 'DOC134A' AND container_number = 'ABCD1234568';
        SET CONSTRAINTS ALL IMMEDIATE;
        SET LOCAL ROLE authenticated;
        SELECT pg_temp.check_status('BRVIX', 'waiting');

        SET CONSTRAINTS ALL DEFERRED;
        INSERT INTO public.bls(id, voyage_id, pol, pod, cargo_mode) VALUES ('DOC134B', 13400001, 'CNTAI', 'BRSSA', 'carga_solta');
        SET CONSTRAINTS ALL IMMEDIATE;
        SELECT pg_temp.check_status('BRSSA', 'received');
        SET CONSTRAINTS ALL DEFERRED;
        UPDATE public.bls SET ce_mercante = '134002' WHERE id = 'DOC134B';
        SET CONSTRAINTS ALL IMMEDIATE;
        SELECT pg_temp.check_status('BRSSA', 'approved');
        INSERT INTO public.bls(id, voyage_id, pol, pod, cargo_mode) VALUES ('DOC134C', 13400001, 'CNTAI', 'BRSSA', 'carga_solta');
        SELECT pg_temp.check_status('BRSSA', 'received');
        UPDATE public.bls SET ce_mercante = '134004' WHERE id = 'DOC134C';
        SELECT pg_temp.check_status('BRSSA', 'approved');

        SELECT set_config('vela.documental_justification', 'Recebimento manual inicial de Granito', true);
        INSERT INTO public.voyage_export_schedules(voyage_id, pol, has_granite, has_empty, ce_status)
        VALUES (13400001, 'BRSSA', true, true, 'received');
        INSERT INTO public.granite_manifests(id, voyage_id, vessel_voyage, loading_port)
        VALUES ('13400000-0000-4000-8000-000000000001', 13400001, '134TEST', 'BRSSA');
        INSERT INTO public.granite_bls(manifest_id, bl_number, loading_port)
        VALUES ('13400000-0000-4000-8000-000000000001', 'GR134', 'BRSSA');
        DO $$ BEGIN
          IF (SELECT ce_status FROM public.voyage_export_schedules WHERE voyage_id = 13400001 AND pol = 'BRSSA') <> 'received' THEN
            RAISE EXCEPTION 'Granito perdeu recebimento manual inicial';
          END IF;
        END; $$;
        SELECT set_config('vela.documental_justification', 'BLs de Granito conferidos', true);
        UPDATE public.voyage_export_schedules SET ce_status = 'received' WHERE voyage_id = 13400001 AND pol = 'BRSSA';
        UPDATE public.granite_bls SET bl_number = 'GR134-CONFERIDO' WHERE bl_number = 'GR134';
        DO $$ BEGIN
          IF (SELECT ce_status FROM public.voyage_export_schedules WHERE voyage_id = 13400001 AND pol = 'BRSSA') <> 'received' THEN
            RAISE EXCEPTION 'Granito perdeu recebimento manual sem mudança documental';
          END IF;
        END; $$;
        UPDATE public.granite_bls SET ce_mercante = '134003' WHERE bl_number = 'GR134-CONFERIDO';
        DO $$ BEGIN
          IF (SELECT ce_status FROM public.voyage_export_schedules WHERE voyage_id = 13400001 AND pol = 'BRSSA') <> 'approved' THEN
            RAISE EXCEPTION 'Granito não aprovou com todos os CEs';
          END IF;
        END; $$;
        INSERT INTO public.voyage_export_schedules(voyage_id, pol, has_empty) VALUES (13400001, 'BRPEC', true);
        SELECT set_config('vela.documental_justification', 'Conferência manual de vazios', true);
        UPDATE public.voyage_export_schedules SET ce_status = 'received' WHERE voyage_id = 13400001 AND pol = 'BRPEC';
        DO $$ BEGIN
          BEGIN
            PERFORM public.save_voyage_escala_terminal_state_v2(13400001, 'BRPEC', 0,
              '[{"sentido":"exportacao","modalidade":"vazio","terminal_id":null,"source":"export_declaration"}]', '[]',
              '{"tem_exportacao":true,"vazios":true,"has_empty":true,"ce_status":"approved","schedule":{"ces":"approved","tem_importacao":false}}', '');
            RAISE EXCEPTION 'RPC aceitou alteração documental sem justificativa';
          EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
        END; $$;
        SELECT public.save_voyage_escala_terminal_state_v2(13400001, 'BRPEC', 0,
          '[{"sentido":"exportacao","modalidade":"vazio","terminal_id":null,"source":"export_declaration"}]', '[]',
          '{"tem_exportacao":true,"vazios":true,"has_empty":true,"ce_status":"approved","schedule":{"ces":"approved","tem_importacao":false}}',
          'Documentação de vazios conferida');
        DO $$ BEGIN
          IF (SELECT ce_status FROM public.voyage_export_schedules WHERE voyage_id = 13400001 AND pol = 'BRPEC') <> 'approved'
            OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id = '13400001::BRPEC' AND field_name = 'export_ces'
              AND new_value = 'approved' AND justification = 'Documentação de vazios conferida') THEN
            RAISE EXCEPTION 'RPC não persistiu override e justificativa da exportação';
          END IF;
        END; $$;
        UPDATE public.bls SET notes = 'Vazios EXP continuam manuais' WHERE id = 'DOC134A';
        DO $$ BEGIN
          IF (SELECT ce_status FROM public.voyage_export_schedules WHERE voyage_id = 13400001 AND pol = 'BRPEC') <> 'approved' THEN
            RAISE EXCEPTION 'Vazios perderam o status manual';
          END IF;
        END; $$;
        -- O lote tem uma única avaliação pendente e publica só o estado final.
        SET CONSTRAINTS ALL DEFERRED;
        INSERT INTO public.bls(id, voyage_id, pol, pod, ce_mercante)
        VALUES ('DOC134LOTE', 13400001, 'CNTAC', 'BRPNG', '134005');
        INSERT INTO public.bl_containers(bl_id, container_number)
        SELECT 'DOC134LOTE', 'ABCD' || (9000000 + n)::text FROM generate_series(1, 1000) n;
        INSERT INTO public.baplie_containers(voyage_id, container_number, status, pol, pod)
        SELECT 13400001, 'ABCD' || (9000000 + n)::text, 'full', 'CNTAI', 'BRPNG' FROM generate_series(1, 1000) n;
        RESET ROLE;
        DO $$ BEGIN
          IF (SELECT count(*) FROM public.voyage_documental_pending WHERE voyage_id = 13400001) <> 1 THEN
            RAISE EXCEPTION 'Lote não agrupou a avaliação por viagem';
          END IF;
        END; $$;
        SET CONSTRAINTS ALL IMMEDIATE;
        SET LOCAL ROLE authenticated;
        SELECT pg_temp.check_status('BRPNG', 'approved');
        RESET ROLE;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM public.voyage_documental_pending WHERE voyage_id = 13400001) THEN
            RAISE EXCEPTION 'Fila documental não esvaziou após avaliação';
          END IF;
          IF (SELECT count(*) FROM public.audit_logs WHERE entity_type = 'voyage_pod_schedule'
              AND entity_id = '13400001::BRPNG' AND field_name = 'ces') <> 1 THEN
            RAISE EXCEPTION 'Lote publicou estados intermediários';
          END IF;
        END; $$;
        ROLLBACK;
      `,
    })
  })
})
