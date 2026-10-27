// Lote 10 das correções decididas pelo dono em 2026-10-27 (migration 478):
// B/L sem CE não entra em Manifesto Mercante, a cobertura Baplie / B/L ignora
// B/L cancelado e conta "cheio no B/L, vazio no Baplie" à parte, a planilha de
// datas recusa B/L cancelado e a Viagem cancelada trava a natureza do vazio e
// as linhas de serviço do Embarque. Cada cenário roda numa transação desfeita.
//
// Namespace exclusivo: Viagem 47800001, B/Ls 'A478-*', usuário ...478001.
import { spawnPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USER = '47800000-0000-4000-8000-000000478001'
const VOYAGE = 47800001

const FIXTURES = `
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users(id, email) VALUES ('${USER}', 'a478@test.local');
  INSERT INTO public.user_profiles(id, full_name, role, active) VALUES ('${USER}', 'A478 Bruno', 'equipamentos', true);
  INSERT INTO public.carriers(id, name) VALUES (${VOYAGE}, 'A478');
  INSERT INTO public.vessels(id, carrier_id, name) VALUES (${VOYAGE}, ${VOYAGE}, 'A478 VESSEL');
  INSERT INTO public.voyages(id, vessel_id, voyage_number) VALUES (${VOYAGE}, ${VOYAGE}, '478A');
  INSERT INTO public.bls(id, voyage_id, pol, pod) VALUES
    ('A478-ATIVO', ${VOYAGE}, 'CNSHA', 'BRVIX'), ('A478-CANC', ${VOYAGE}, 'CNSHA', 'BRVIX');
  INSERT INTO public.bl_containers(bl_id, container_number) VALUES
    ('A478-ATIVO', 'AAAU4780001'), ('A478-ATIVO', 'AAAU4780002'), ('A478-CANC', 'AAAU4780003');
  INSERT INTO public.baplie_containers(voyage_id, container_number, status, pol, pod) VALUES
    (${VOYAGE}, 'AAAU4780001', 'full', 'CNSHA', 'BRVIX'),
    (${VOYAGE}, 'AAAU4780002', 'empty', 'CNSHA', 'BRVIX');
  UPDATE public.bls SET cancelled_at = now(), cancelled_by = '${USER}', cancel_reason = 'teste 478' WHERE id = 'A478-CANC';
  SET LOCAL session_replication_role = origin;
`

const AS_USER = `SELECT set_config('request.jwt.claims', '{"sub":"${USER}","role":"authenticated"}', true) IS NOT NULL;`

function scenario(sql: string): { lines: string[]; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  return { lines: run.stdout.split('\n').filter((line) => line.startsWith('>')), stderr: run.stderr }
}

describeLocal('B/L, CE, Baplie e Equipamentos decididos pelo dono (migration 478)', () => {
  it('CEB-D01: Mover recusa B/L sem CE Mercante', () => {
    const { stderr } = scenario(`${AS_USER}
      SELECT public.move_bls_to_manifesto_mercante(ARRAY['A478-ATIVO'], '1226501860578', 'Teste 478');`)
    expect(stderr).toMatch(/B\/L sem CE Mercante não entra em Manifesto: A478-ATIVO/)
  })

  it('CEB-D04 e CEB-D13: a cobertura ignora o B/L cancelado e conta à parte o cheio no B/L que vem vazio no Baplie', () => {
    const { lines, stderr } = scenario(`
      ${AS_USER}
      UPDATE public.voyages SET status = 'active' WHERE id = ${VOYAGE};
      SELECT public.reconcile_voyage_baplie_coverage_alerts(${VOYAGE}, 'teste_478');
      SELECT '>' || i.message || '|' || (i.metadata->>'empty_in_baplie_count')
        FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
        WHERE a.entity_type = 'voyage' AND a.entity_id = '${VOYAGE}' AND i.item_type = 'voyage_baplie_documentary_coverage' AND i.status = 'active';
    `)
    expect(stderr).toBe('')
    // AAAU4780003 é do B/L cancelado: não conta. AAAU4780002 está a bordo, vazio.
    expect(lines).toEqual(['>1 container diverge entre o Baplie e os B/Ls (1 cheio no B/L, vazio no Baplie).|1'])
  })

  it('EQU-D7: a planilha de datas recusa a linha de B/L cancelado', () => {
    const { stderr } = scenario(`${AS_USER}
      SELECT public.apply_container_dates_atomic(gen_random_uuid(), 'A478-CANC',
        '[{"container_number":"AAAU4780003","discharge_date":"2026-10-10"}]'::jsonb, '${USER}');`)
    expect(stderr).toMatch(/B\/L A478-CANC cancelado: somente leitura\. Reative para corrigir\./)
  })

  it('EQU-D11: Viagem cancelada recusa a natureza do vazio e as linhas de serviço do Embarque', () => {
    const natureza = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.vazios_importacao_manifests(id, voyage_id) VALUES ('47800000-0000-4000-8000-0000000000a1', ${VOYAGE});
      INSERT INTO public.vazios_importacao_containers(manifest_id, voyage_id, container_number)
        VALUES ('47800000-0000-4000-8000-0000000000a1', ${VOYAGE}, 'AAAU4780009');
      UPDATE public.voyages SET status = 'cancelled' WHERE id = ${VOYAGE};
      SET LOCAL session_replication_role = origin;
      UPDATE public.vazios_importacao_containers SET natureza = 'cama' WHERE container_number = 'AAAU4780009';`)
    expect(natureza.stderr).toMatch(/Viagem 47800001 cancelada: operação selada e somente leitura/)

    const servico = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.vazios_export_operations(id, voyage_id, embark_port) VALUES ('47800000-0000-4000-8000-0000000000b1', ${VOYAGE}, 'BRVIX');
      UPDATE public.voyages SET status = 'cancelled' WHERE id = ${VOYAGE};
      SET LOCAL session_replication_role = origin;
      INSERT INTO public.vazios_export_service_lines(operation_id) VALUES ('47800000-0000-4000-8000-0000000000b1');`)
    expect(servico.stderr).toMatch(/Viagem 47800001 cancelada: operação selada e somente leitura/)
  })
})
