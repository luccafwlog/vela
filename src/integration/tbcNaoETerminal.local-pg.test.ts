// Migrations 482 e 490 (revisão da PR #1070; ADR 0109): TBC não é terminal. A
// Atracação TBC sai sem a trava de documento do porto, não aceita ETB, ETD,
// ATB, ATD nem Restow, e a gravação v1 segue a regra do ATA. Cada cenário roda
// numa transação desfeita no fim.
//
// Namespace exclusivo: Viagem 48200001, usuários 48200000-...-00000000000N.
import { spawnPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '48200000-0000-4000-8000-000000000001'
const TERMINAL = '48200000-0000-4000-8000-0000000000d1'
const VOYAGE = 48200001
const IMPORT_ONLY = '{"tem_exportacao":false,"granito":false,"vazios":false,"has_empty":false,"discharge_ports":[],"linked":false,"schedule":{"tem_importacao":true}}'
const WITH_ATA = '{"tem_exportacao":false,"granito":false,"vazios":false,"has_empty":false,"discharge_ports":[],"linked":false,"schedule":{"tem_importacao":true,"ata":"2026-10-20T08:00:00Z"}}'

const FIXTURES = `
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users(id, email) VALUES ('${ADM}', 'a482-adm@test.local');
  INSERT INTO public.user_profiles(id, full_name, role, active) VALUES ('${ADM}', 'A482 Ana', 'administrativo', true);
  INSERT INTO public.carriers(id, name) VALUES (${VOYAGE}, 'A482');
  INSERT INTO public.vessels(id, carrier_id, name) VALUES (${VOYAGE}, ${VOYAGE}, 'A482 VESSEL');
  INSERT INTO public.voyages(id, vessel_id, voyage_number) VALUES (${VOYAGE}, ${VOYAGE}, '482A');
  INSERT INTO public.depots(id, code, name, tipo, port_id)
    SELECT '${TERMINAL}', 'T482', 'Terminal 482', 'terminal_portuario', id FROM public.ports WHERE locode = 'BRVIX' LIMIT 1;
  SET LOCAL session_replication_role = origin;
`

const asAdm = `RESET ROLE; SELECT set_config('request.jwt.claims', '{"sub":"${ADM}","role":"authenticated"}', true) IS NOT NULL; SET LOCAL ROLE authenticated;`
const tbcFront = `'[{"sentido":"importacao","modalidade":"carga_cheia","terminal_id":null,"source":"operational_data"}]'`
const terminalFront = `'[{"sentido":"importacao","modalidade":"carga_cheia","terminal_id":"${TERMINAL}","source":"operational_data"}]'`

/** Roda o cenário numa transação desfeita; devolve as linhas que começam com '>'. */
function scenario(sql: string): { lines: string[]; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  return { lines: run.stdout.split('\n').filter((line) => line.startsWith('>')), stderr: run.stderr }
}

describeLocal('TBC não é terminal (migrations 482 e 490)', () => {
  it('porto com B/L com CE: escolher o terminal da frente em TBC grava, a TBC sai e a Viagem conclui', () => {
    const { lines, stderr } = scenario(`
      ${asAdm}
      SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRVIX', 0, ${tbcFront}, '[{"terminal_id":null}]', '${IMPORT_ONLY}', NULL) IS NOT NULL;
      RESET ROLE;
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, ce_mercante)
        VALUES ('R482-BL1', ${VOYAGE}, 'CNSHA', 'BRVIX', 'container', '123456789012345');
      SET LOCAL session_replication_role = origin;
      ${asAdm}
      SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRVIX', 1, ${terminalFront},
        '[{"terminal_id":"${TERMINAL}","terminal_atb":"2026-10-20T10:00:00Z","terminal_atd":"2026-10-21T10:00:00Z","terminal_rtw":null}]',
        '${WITH_ATA}', NULL) IS NOT NULL;
      SELECT '>tbc=' || count(*) FROM public.voyage_escala_terminal_state WHERE voyage_id = ${VOYAGE} AND terminal_id IS NULL;
      SELECT '>status=' || status FROM public.voyages WHERE id = ${VOYAGE};
    `)
    expect(stderr).toBe('')
    expect(lines).toEqual(['>tbc=0', '>status=completed'])
  })

  it('a Atracação TBC recusa ATB, ATD e Restow, mesmo sem ATA', () => {
    const { stderr } = scenario(`
      ${asAdm}
      SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRVIX', 0, ${tbcFront},
        '[{"terminal_id":null,"terminal_atb":"2026-10-20T10:00:00Z","terminal_atd":null,"terminal_rtw":null}]', '${IMPORT_ONLY}', NULL);
    `)
    expect(stderr).toMatch(/TBC não é terminal: ETB, ETD, ATB, ATD e Restow/)
  })

  it('a Atracação TBC recusa também ETB e ETD estimados (migration 490)', () => {
    const { stderr } = scenario(`
      ${asAdm}
      SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRVIX', 0, ${tbcFront},
        '[{"terminal_id":null,"terminal_etb":"2026-10-20T10:00:00Z","terminal_etd":"2026-10-21T10:00:00Z"}]', '${IMPORT_ONLY}', NULL);
    `)
    expect(stderr).toMatch(/TBC não é terminal: ETB, ETD, ATB, ATD e Restow/)
  })

  it('a gravação v1 também recusa frente em TBC com o ATA registrado', () => {
    const { stderr } = scenario(`
      ${asAdm}
      SELECT public.save_voyage_escala_terminal_state(${VOYAGE}, 'BRVIX', 0, ${tbcFront}, '[{"terminal_id":null}]', '${WITH_ATA}', NULL);
    `)
    expect(stderr).toMatch(/Com o ATA registrado, toda frente de operação precisa de terminal/)
  })
})
