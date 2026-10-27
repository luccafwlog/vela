// Lote 9 das correções decididas pelo dono em 2026-10-27 (migration 477; ADR
// 0109): todos os setores gravam terminal e datas da escala, TBC não é
// terminal (a Atracação TBC vazia sai e o ATA exige terminal em toda frente),
// omitir e reverter recalculam a Viagem e o porto omitido não é Porto de
// Transbordo. Cada cenário roda numa transação desfeita no fim.
//
// Namespace exclusivo: Viagem 47700001, usuários 47700000-...-00000000000N.
import { spawnPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const DOC = '47700000-0000-4000-8000-000000000001'
const OPE = '47700000-0000-4000-8000-000000000002'
const TERMINAL = '47700000-0000-4000-8000-0000000000d1'
const VOYAGE = 47700001
const IMPORT_ONLY = '{"tem_exportacao":false,"granito":false,"vazios":false,"has_empty":false,"discharge_ports":[],"linked":false,"schedule":{"tem_importacao":true}}'
const WITH_ATA = '{"tem_exportacao":false,"granito":false,"vazios":false,"has_empty":false,"discharge_ports":[],"linked":false,"schedule":{"tem_importacao":true,"ata":"2026-10-20T08:00:00Z"}}'

const FIXTURES = `
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users(id, email) VALUES ('${DOC}', 'a477-doc@test.local'), ('${OPE}', 'a477-ope@test.local');
  INSERT INTO public.user_profiles(id, full_name, role, active) VALUES
    ('${DOC}', 'A477 Paula', 'documentacao', true), ('${OPE}', 'A477 Carlos', 'operacoes', true);
  INSERT INTO public.carriers(id, name) VALUES (${VOYAGE}, 'A477');
  INSERT INTO public.vessels(id, carrier_id, name) VALUES (${VOYAGE}, ${VOYAGE}, 'A477 VESSEL');
  INSERT INTO public.voyages(id, vessel_id, voyage_number) VALUES (${VOYAGE}, ${VOYAGE}, '477A');
  INSERT INTO public.depots(id, code, name, tipo, port_id)
    SELECT '${TERMINAL}', 'T477', 'Terminal 477', 'terminal_portuario', id FROM public.ports WHERE locode = 'BRVIX' LIMIT 1;
  SET LOCAL session_replication_role = origin;
`

const as = (user: string) => `RESET ROLE; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true) IS NOT NULL; SET LOCAL ROLE authenticated;`

function front(terminal: string | null) {
  return `'[{"sentido":"importacao","modalidade":"carga_cheia","terminal_id":${terminal ? `"${terminal}"` : 'null'},"source":"operational_data"}]'`
}

function save(port: string, revision: number, terminal: string | null, atd: string | null, expectation = IMPORT_ONLY) {
  const terminals = terminal
    ? `'[{"terminal_id":"${terminal}","terminal_atb":"2026-10-20T10:00:00Z","terminal_atd":${atd ? `"${atd}"` : 'null'},"terminal_rtw":null}]'`
    : `'[{"terminal_id":null}]'`
  return `SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, '${port}', ${revision}, ${front(terminal)}, ${terminals}, '${expectation}', NULL) IS NOT NULL;`
}

/** Roda o cenário numa transação desfeita; devolve as linhas que começam com '>'. */
function scenario(sql: string): { lines: string[]; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  return { lines: run.stdout.split('\n').filter((line) => line.startsWith('>')), stderr: run.stderr }
}

describeLocal('Viagens e escalas decididas pelo dono (migration 477)', () => {
  it('02-viagens-adr:2 e 13: a Documentação grava terminal, ATB e ATD; a Atracação TBC vazia sai e a Viagem conclui', () => {
    const { lines, stderr } = scenario(`
      ${as(DOC)}
      ${save('BRVIX', 0, null, null)}
      SELECT '>tbc=' || count(*) FROM public.voyage_escala_terminal_state WHERE voyage_id = ${VOYAGE} AND terminal_id IS NULL;
      ${save('BRVIX', 1, TERMINAL, '2026-10-21T10:00:00Z')}
      SELECT '>tbc=' || count(*) FROM public.voyage_escala_terminal_state WHERE voyage_id = ${VOYAGE} AND terminal_id IS NULL;
      SELECT '>status=' || status FROM public.voyages WHERE id = ${VOYAGE};
    `)
    expect(stderr).toBe('')
    expect(lines).toEqual(['>tbc=1', '>tbc=0', '>status=completed'])
  })

  it('02-viagens-adr:13: com o ATA registrado, frente em TBC é recusada', () => {
    const { stderr } = scenario(`${as(OPE)} ${save('BRVIX', 0, null, null, WITH_ATA)}`)
    expect(stderr).toMatch(/TBC não é terminal/)
  })

  it('02-viagens-adr:2: trocar o terminal de uma frente segue de Operações e do Administrativo', () => {
    const { stderr } = scenario(`
      ${as(OPE)}
      ${save('BRVIX', 0, TERMINAL, null)}
      ${as(DOC)}
      SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRVIX', 1, ${front(null)}, '[{"terminal_id":null}]', '${IMPORT_ONLY}', 'Terminal errado');
    `)
    expect(stderr).toMatch(/Somente Operações e o Administrativo removem atracação/)
  })

  it('02-viagens-adr:14 e 15: omitir a última escala pendente conclui a Viagem, reverter reabre; o porto omitido não é transbordo', () => {
    const { lines, stderr } = scenario(`
      ${as(OPE)}
      ${save('BRVIX', 0, TERMINAL, '2026-10-21T10:00:00Z')}
      SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRSSA', 0, '[]', '[]', '${IMPORT_ONLY}', NULL) IS NOT NULL;
      SELECT '>antes=' || status FROM public.voyages WHERE id = ${VOYAGE};
      DO $$ BEGIN
        PERFORM public.omit_voyage_escala(${VOYAGE}, 'BRSSA', 'BRSSA', 'Armador omitiu', '${OPE}');
        RAISE EXCEPTION 'aceitou o porto omitido como transbordo';
      EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;
      SELECT public.omit_voyage_escala(${VOYAGE}, 'BRSSA', 'BRVIX', 'Armador omitiu', '${OPE}') IS NOT NULL;
      SELECT '>omitida=' || status FROM public.voyages WHERE id = ${VOYAGE};
      SELECT public.revert_voyage_omission(id, 'Armador voltou atrás', '${OPE}') IS NULL
        FROM public.voyage_omissions WHERE voyage_id = ${VOYAGE} AND omitted_pod = 'BRSSA';
      SELECT '>revertida=' || status FROM public.voyages WHERE id = ${VOYAGE};
    `)
    expect(stderr).toBe('')
    expect(lines).toEqual(['>antes=active', '>omitida=completed', '>revertida=active'])
  })
})
