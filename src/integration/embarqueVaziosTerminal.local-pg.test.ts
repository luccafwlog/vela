// Migration 541 (ADR 0113): o Embarque de vazios opera num terminal. Criar o
// embarque grava o terminal na frente Vazios EXP pela gravação da escala (frente,
// Atracação e ADR do terminal); sem terminal o banco recusa; com embarque, a
// frente não volta para TBC nem sai, e a escala não se exclui. Cada cenário roda
// numa transação desfeita no fim.
//
// Namespace exclusivo: Viagem 52000001, usuário 52000000-...-000000000001.
import { spawnPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USER = '52000000-0000-4000-8000-000000000001'
const ADM = '52000000-0000-4000-8000-000000000002'
const TERMINAL = '52000000-0000-4000-8000-0000000000d1'
const OTHER_TERMINAL = '52000000-0000-4000-8000-0000000000d2'
const VOYAGE = 52000001
const IMPORT_ONLY = '{"tem_exportacao":false,"granito":false,"vazios":false,"has_empty":false,"discharge_ports":[],"linked":false,"schedule":{"tem_importacao":true}}'
const EMPTY_EXPORT = '{"tem_exportacao":true,"granito":false,"vazios":true,"has_empty":true,"discharge_ports":[],"linked":false}'

const FIXTURES = `
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users(id, email) VALUES ('${USER}', 'e541-equip@test.local');
  INSERT INTO public.user_profiles(id, full_name, role, active) VALUES ('${USER}', 'E541 Eva', 'equipamentos', true);
  INSERT INTO auth.users(id, email) VALUES ('${ADM}', 'e541-adm@test.local');
  INSERT INTO public.user_profiles(id, full_name, role, active) VALUES ('${ADM}', 'E541 Ana', 'administrativo', true);
  INSERT INTO public.carriers(id, name) VALUES (${VOYAGE}, 'E541');
  INSERT INTO public.vessels(id, carrier_id, name) VALUES (${VOYAGE}, ${VOYAGE}, 'E541 VESSEL');
  INSERT INTO public.voyages(id, vessel_id, voyage_number) VALUES (${VOYAGE}, ${VOYAGE}, '541A');
  INSERT INTO public.depots(id, code, name, tipo, port_id)
    SELECT '${TERMINAL}', 'T541', 'Terminal 541', 'terminal_portuario', id FROM public.ports WHERE locode = 'BRVIX' LIMIT 1;
  INSERT INTO public.depots(id, code, name, tipo, port_id)
    SELECT '${OTHER_TERMINAL}', 'U541', 'Terminal 541 B', 'terminal_portuario', id FROM public.ports WHERE locode = 'BRVIX' LIMIT 1;
  SET LOCAL session_replication_role = origin;
`

const asUser = `RESET ROLE; SELECT set_config('request.jwt.claims', '{"sub":"${USER}","role":"authenticated"}', true) IS NOT NULL; SET LOCAL ROLE authenticated;`
const asAdm = `RESET ROLE; SELECT set_config('request.jwt.claims', '{"sub":"${ADM}","role":"authenticated"}', true) IS NOT NULL; SET LOCAL ROLE authenticated;`
const create = (terminal: string | null) =>
  `SELECT '>created=' || (r->>'created') || ' terminal=' || COALESCE(r->>'terminal_id', '-') FROM (SELECT public.create_vazios_export_operation(${VOYAGE}, 'brvix', ${terminal ? `'${terminal}'` : 'NULL'}) AS r) AS x;`
const frontsState = `
  RESET ROLE;
  SELECT '>front=' || sentido || '/' || modalidade || ':' || COALESCE(terminal_id::text, 'TBC')
    FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${VOYAGE} ORDER BY sentido, modalidade;
  SELECT '>atracacao=' || COALESCE(terminal_id::text, 'TBC') || ':' || COALESCE(terminal_atb::text, '-')
    FROM public.voyage_escala_terminal_state WHERE voyage_id = ${VOYAGE} ORDER BY terminal_id NULLS FIRST;
  SELECT '>adr=' || COALESCE(terminal_id::text, 'sem terminal') FROM public.agency_departure_reports WHERE voyage_id = ${VOYAGE} ORDER BY terminal_id NULLS FIRST;
  SELECT '>embarques=' || count(*) FROM public.vazios_export_operations WHERE voyage_id = ${VOYAGE};
`

/** Roda o cenário numa transação desfeita; devolve as linhas que começam com '>'. */
function scenario(sql: string): { lines: string[]; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${FIXTURES} ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  return { lines: run.stdout.split('\n').filter((line) => line.startsWith('>')), stderr: run.stderr }
}

describeLocal('Embarque de vazios exige terminal (migration 541)', () => {
  it('sem terminal, nem a RPC nem a escrita direta criam o embarque', () => {
    const rpc = scenario(`${asUser} ${create(null)}`)
    expect(rpc.stderr).toMatch(/Escolha o terminal onde o embarque de vazios de BRVIX opera/)

    const direct = scenario(`${asUser} INSERT INTO public.vazios_export_operations (voyage_id, embark_port) VALUES (${VOYAGE}, 'BRVIX');`)
    expect(direct.stderr).toMatch(/O Embarque de vazios de BRVIX precisa do terminal onde opera/)
  })

  it('escala sem frente: o terminal escolhido cria a frente Vazios EXP, a Atracação e o ADR do terminal', () => {
    const { lines, stderr } = scenario(`${asUser} ${create(TERMINAL)} ${frontsState}
      SELECT '>exportacao=' || tem_exportacao || ' vazios=' || has_empty FROM public.voyage_export_schedules WHERE voyage_id = ${VOYAGE};`)
    expect(stderr).toBe('')
    expect(lines).toEqual([
      `>created=true terminal=${TERMINAL}`,
      `>front=exportacao/vazio:${TERMINAL}`,
      `>atracacao=${TERMINAL}:-`,
      `>adr=${TERMINAL}`,
      '>embarques=1',
      '>exportacao=true vazios=true',
    ])
  })

  it('com o terminal na frente, o embarque usa esse: abre o existente e recusa outro terminal', () => {
    const { lines, stderr } = scenario(`${asUser} ${create(TERMINAL)} ${create(null)} ${create(TERMINAL)} ${frontsState}`)
    expect(stderr).toBe('')
    expect(lines).toEqual([
      `>created=true terminal=${TERMINAL}`,
      `>created=false terminal=${TERMINAL}`,
      `>created=false terminal=${TERMINAL}`,
      `>front=exportacao/vazio:${TERMINAL}`,
      `>atracacao=${TERMINAL}:-`,
      `>adr=${TERMINAL}`,
      '>embarques=1',
    ])

    const other = scenario(`${asUser} ${create(TERMINAL)} ${create(OTHER_TERMINAL)}`)
    expect(other.stderr).toMatch(/A frente Vazios EXP de BRVIX já opera no terminal T541: o embarque usa esse terminal/)
  })

  it('embarque antigo gravado com apelido do porto (BRVIT) sem terminal: recebe o terminal e é aberto, sem outro', () => {
    const { lines, stderr } = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.vazios_export_operations (voyage_id, embark_port) VALUES (${VOYAGE}, 'BRVIT');
      SET LOCAL session_replication_role = origin;
      ${asUser} ${create(TERMINAL)} ${frontsState}`)
    expect(stderr).toBe('')
    expect(lines).toEqual([
      `>created=false terminal=${TERMINAL}`,
      `>front=exportacao/vazio:${TERMINAL}`,
      `>atracacao=${TERMINAL}:-`,
      `>adr=${TERMINAL}`,
      '>embarques=1',
    ])
  })

  it('frente Vazios EXP em TBC numa escala já gravada: recebe o terminal, a TBC sai e as outras frentes ficam', () => {
    const fronts = `'[{"sentido":"importacao","modalidade":"carga_cheia","terminal_id":"${OTHER_TERMINAL}","source":"operational_data"},{"sentido":"exportacao","modalidade":"vazio","terminal_id":null,"source":"export_declaration"}]'`
    const { lines, stderr } = scenario(`
      ${asUser}
      SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRVIX', 0, ${fronts},
        '[{"terminal_id":null},{"terminal_id":"${OTHER_TERMINAL}","terminal_atb":"2026-10-20T10:00:00Z"}]', '${EMPTY_EXPORT}', NULL) IS NOT NULL;
      ${create(TERMINAL)} ${frontsState}`)
    expect(stderr).toBe('')
    expect(new Set(lines)).toEqual(new Set([
      `>created=true terminal=${TERMINAL}`,
      `>front=exportacao/vazio:${TERMINAL}`,
      `>front=importacao/carga_cheia:${OTHER_TERMINAL}`,
      `>atracacao=${TERMINAL}:-`,
      `>atracacao=${OTHER_TERMINAL}:2026-10-20 10:00:00+00`,
      `>adr=${TERMINAL}`,
      `>adr=${OTHER_TERMINAL}`,
      '>embarques=1',
    ]))
    expect(lines).toHaveLength(8)
  })

  it('com embarque, a frente não volta para TBC e a escala não se exclui; trocar de terminal na escala vale', () => {
    const tbc = scenario(`${asUser} ${create(TERMINAL)}
      SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRVIX', 1,
        '[{"sentido":"exportacao","modalidade":"vazio","terminal_id":null,"source":"export_declaration"}]',
        '[{"terminal_id":null},{"terminal_id":"${TERMINAL}"}]', '${EMPTY_EXPORT}', 'Voltar para TBC');`)
    expect(tbc.stderr).toMatch(/A escala BRVIX tem Embarque de vazios: a frente Vazios EXP não volta para TBC nem sai/)

    const removed = scenario(`${asUser} ${create(TERMINAL)}
      SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRVIX', 1, '[]', '[{"terminal_id":"${TERMINAL}"}]', '${IMPORT_ONLY}', 'Sem exportação');`)
    expect(removed.stderr).toMatch(/A escala BRVIX tem Embarque de vazios/)

    const deletion = scenario(`${asUser} ${create(TERMINAL)}
      ${asAdm}
      SELECT '>reasons=' || (public.delete_escala(${VOYAGE}, 'BRVIX', true, NULL)->'reasons')::text;`)
    expect(deletion.stderr).toBe('')
    expect(deletion.lines).toEqual([`>created=true terminal=${TERMINAL}`, '>reasons=["Embarque de vazios na escala"]'])

    const moved = scenario(`${asUser} ${create(TERMINAL)}
      SELECT public.save_voyage_escala_terminal_state_v2(${VOYAGE}, 'BRVIX', 1,
        '[{"sentido":"exportacao","modalidade":"vazio","terminal_id":"${OTHER_TERMINAL}","source":"export_declaration"}]',
        '[{"terminal_id":"${TERMINAL}"},{"terminal_id":"${OTHER_TERMINAL}"}]', '${EMPTY_EXPORT}', 'Troca de terminal') IS NOT NULL;
      ${frontsState}`)
    expect(moved.stderr).toBe('')
    expect(moved.lines).toContain(`>front=exportacao/vazio:${OTHER_TERMINAL}`)
  })

  it('o ADR fechado do terminal do embarque trava o embarque', () => {
    const { lines, stderr } = scenario(`${asUser} ${create(TERMINAL)}
      SELECT '>travado=' || public.vazios_export_adr_locked(${VOYAGE}, 'BRVIX');
      RESET ROLE;
      UPDATE public.agency_departure_reports SET status = 'closed', closed_at = now()
        WHERE voyage_id = ${VOYAGE} AND terminal_id = '${TERMINAL}';
      ${asUser}
      SELECT '>travado=' || public.vazios_export_adr_locked(${VOYAGE}, 'BRVIX');`)
    expect(stderr).toBe('')
    expect(lines).toEqual([`>created=true terminal=${TERMINAL}`, '>travado=false', '>travado=true'])
  })

  it('ADR de Saída fechado no terminal escolhido: a escala não muda e o embarque não nasce', () => {
    const { stderr } = scenario(`
      RESET ROLE;
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.agency_departure_reports (voyage_id, port, terminal_id, terminal_port_id, status, closed_at)
        SELECT ${VOYAGE}, 'BRVIX', '${TERMINAL}', port_id, 'closed', now() FROM public.depots WHERE id = '${TERMINAL}';
      SET LOCAL session_replication_role = origin;
      ${asUser} ${create(TERMINAL)}`)
    expect(stderr).toMatch(/ADR de Saída de T541 fechado: a escala não muda/)
  })
})
