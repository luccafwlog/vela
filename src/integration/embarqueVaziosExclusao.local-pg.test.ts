// Migration 544 (decisão do dono de 2026-10-30): o Administrativo exclui, com
// motivo, o Embarque de vazios vazio criado na escala errada. Com unidade,
// linha de serviço ou ADR de Saída fechado, a exclusão é recusada com o motivo.
// Sem o embarque, o gatilho da 541 deixa a frente Vazios EXP voltar para TBC. Cada cenário
// roda numa transação desfeita no fim.
//
// Namespace exclusivo: Viagem 54400001, usuários 54400000-...-00000000000{1,2}.
import { spawnPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USER = '54400000-0000-4000-8000-000000000001'
const ADM = '54400000-0000-4000-8000-000000000002'
const TERMINAL = '54400000-0000-4000-8000-0000000000d1'
const VOYAGE = 54400001

const FIXTURES = `
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users(id, email) VALUES ('${USER}', 'e544-equip@test.local'), ('${ADM}', 'e544-adm@test.local');
  INSERT INTO public.user_profiles(id, full_name, role, active) VALUES
    ('${USER}', 'E544 Eva', 'equipamentos', true), ('${ADM}', 'E544 Ana', 'administrativo', true);
  INSERT INTO public.carriers(id, name) VALUES (${VOYAGE}, 'E544');
  INSERT INTO public.vessels(id, carrier_id, name) VALUES (${VOYAGE}, ${VOYAGE}, 'E544 VESSEL');
  INSERT INTO public.voyages(id, vessel_id, voyage_number) VALUES (${VOYAGE}, ${VOYAGE}, '544A');
  INSERT INTO public.depots(id, code, name, tipo, port_id)
    SELECT '${TERMINAL}', 'T544', 'Terminal 544', 'terminal_portuario', id FROM public.ports WHERE locode = 'BRVIX' LIMIT 1;
  SET LOCAL session_replication_role = origin;
`

const as = (id: string) => `RESET ROLE; SELECT set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated"}', true) IS NOT NULL; SET LOCAL ROLE authenticated;`
const createEmbarque = `${as(USER)} CREATE TEMP TABLE IF NOT EXISTS e544 AS SELECT (public.create_vazios_export_operation(${VOYAGE}, 'BRVIX', '${TERMINAL}')->>'id')::uuid AS id;`
const remove = (dryRun: boolean, reason: string | null) =>
  `SELECT '>r=' || public.delete_vazios_export_operation((SELECT id FROM e544), ${dryRun}, ${reason ? `'${reason}'` : 'NULL'})::text;`
const count = `RESET ROLE; SELECT '>embarques=' || count(*) FROM public.vazios_export_operations WHERE voyage_id = ${VOYAGE};`

function scenario(sql: string): { lines: string[]; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  return { lines: run.stdout.split('\n').filter((line) => line.startsWith('>')), stderr: run.stderr }
}

describeLocal('Exclusão do Embarque de vazios vazio (migration 544)', () => {
  it('só o Administrativo exclui', () => {
    const { stderr } = scenario(`${createEmbarque} ${as(USER)} ${remove(false, 'escala errada')}`)
    expect(stderr).toMatch(/Somente o Administrativo pode excluir embarque de vazios/)
  })

  it('a prévia não grava; sem motivo recusa; com motivo exclui, audita e libera a frente para TBC', () => {
    const { lines, stderr } = scenario(`${createEmbarque} GRANT SELECT ON e544 TO authenticated; ${as(ADM)}
      ${remove(true, null)} ${count}
      ${as(ADM)} ${remove(false, 'Escala errada: era BRPNG')} ${count}
      SELECT '>audit=' || justification FROM public.audit_logs
        WHERE entity_type = 'vazios_export_operation' AND entity_id = (SELECT id::text FROM e544);
      RESET ROLE; UPDATE public.voyage_escala_operation_fronts SET terminal_id = NULL
        WHERE voyage_id = ${VOYAGE} AND sentido = 'exportacao' AND modalidade = 'vazio';
      SELECT '>tbc=ok';`)
    expect(stderr).toBe('')
    expect(lines).toEqual([
      '>r={"deleted": false, "dry_run": true, "reasons": [], "deletable": true}',
      '>embarques=1',
      '>r={"deleted": true, "dry_run": false, "reasons": [], "deletable": true}',
      '>embarques=0',
      `>audit=Escala errada: era BRPNG (Viagem ${VOYAGE}, BRVIX)`,
      '>tbc=ok',
    ])
    const noReason = scenario(`${createEmbarque} GRANT SELECT ON e544 TO authenticated; ${as(ADM)} ${remove(false, '  ')}`)
    expect(noReason.stderr).toMatch(/Informe o motivo da exclusão do embarque de vazios/)
  })

  it('com unidade, linha de serviço ou ADR de Saída fechado, recusa com os motivos e não exclui', () => {
    const { lines, stderr } = scenario(`${createEmbarque} GRANT SELECT ON e544 TO authenticated;
      RESET ROLE; SET LOCAL session_replication_role = replica;
      INSERT INTO public.vazios_bookings (manifest_id, container_number, voyage_id, condition, local_id, operation_id)
        VALUES (gen_random_uuid(), 'TSTU5440001', ${VOYAGE}, 'vazio', '${TERMINAL}', (SELECT id FROM e544));
      INSERT INTO public.vazios_export_service_lines (operation_id, service_id, local_id)
        VALUES ((SELECT id FROM e544), gen_random_uuid(), '${TERMINAL}');
      UPDATE public.agency_departure_reports SET status = 'closed' WHERE voyage_id = ${VOYAGE};
      SET LOCAL session_replication_role = origin;
      ${as(ADM)} ${remove(false, 'escala errada')} ${count}`)
    expect(stderr).toBe('')
    expect(lines).toEqual([
      '>r={"deleted": false, "dry_run": false, "reasons": ["Embarque com unidades embarcadas", "Embarque com linhas de serviço", "ADR de Saída do porto fechado"], "deletable": false}',
      '>embarques=1',
    ])
  })
})
