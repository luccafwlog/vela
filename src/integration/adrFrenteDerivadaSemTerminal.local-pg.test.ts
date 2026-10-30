import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const voyageId = 9514001
const carrierId = 9514001
const vesselId = 9514001
const terminalId = '00000000-0000-0000-0000-000000951401'
const reportId = '00000000-0000-0000-0000-000000951402'
const manifestId = '00000000-0000-0000-0000-000000951403'
const graniteManifestId = '00000000-0000-0000-0000-000000951404'
const omissionId = 9514001
const adminId = '00000000-0000-0000-0000-000000951411'
const session = `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${adminId}';`

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `${session} ${sql}`], { encoding: 'utf8' }).trim()
}

function assertReadyToClose() {
  return spawnPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `${session} SELECT public.assert_voyage_escala_ready_for_report_close(${voyageId}, 'BRVIX', '${reportId}');`,
  ], { encoding: 'utf8' })
}

function persistFront(modalidade: string, sentido: 'importacao' | 'exportacao' = 'importacao') {
  const source = sentido === 'importacao' ? 'operational_data' : 'export_declaration'
  psql(`INSERT INTO public.voyage_escala_operation_fronts (voyage_id, port, port_id, sentido, modalidade, terminal_id, source)
    SELECT ${voyageId}, 'BRVIX', id, '${sentido}', '${modalidade}', '${terminalId}', '${source}' FROM public.ports WHERE locode = 'BRVIX';`)
}

const resetScenario = `
  DELETE FROM public.bl_transshipments WHERE omission_id = ${omissionId};
  DELETE FROM public.voyage_omissions WHERE id = ${omissionId};
  DELETE FROM public.vehicles WHERE voyage_id = ${voyageId};
  DELETE FROM public.bl_containers WHERE bl_id LIKE 'BL-514-%';
  DELETE FROM public.bls WHERE voyage_id = ${voyageId};
  DELETE FROM public.vazios_importacao_containers WHERE manifest_id = '${manifestId}';
  DELETE FROM public.vazios_importacao_manifests WHERE id = '${manifestId}';
  DELETE FROM public.granite_bls WHERE manifest_id = '${graniteManifestId}';
  DELETE FROM public.granite_manifests WHERE id = '${graniteManifestId}';
  DELETE FROM public.agency_departure_reports WHERE voyage_id = ${voyageId};
  DELETE FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${voyageId};
  DELETE FROM public.voyages WHERE id = ${voyageId};
  DELETE FROM public.vessels WHERE id = ${vesselId};
  DELETE FROM public.carriers WHERE id = ${carrierId};
  DELETE FROM public.depots WHERE id = '${terminalId}';
`
// As exclusões acima disparam a reconciliação dos alertas, que grava eventos
// com o autor da sessão: eles saem antes do usuário.
const removeUser = `
  DELETE FROM public.audit_logs WHERE changed_by = '${adminId}';
  DELETE FROM public.alert_item_events WHERE actor_id = '${adminId}';
  DELETE FROM public.user_profiles WHERE id = '${adminId}';
  DELETE FROM auth.users WHERE id = '${adminId}';
`

// Teste do dono em BRVIX (2026-10-30): veículos e vazios de importação da
// escala sumiam do ADR por terminal porque a frente deles não tinha terminal
// gravado, e o fechamento só recusava a frente TBC gravada.
describeLocal('migrations 514 a 516 — frente derivada dos dados sem terminal impede fechar o ADR', () => {
  beforeAll(() => {
    psql(`
      ${resetScenario}
      ${removeUser}
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'admin-514@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'Admin 514', 'administrativo', true);
    `)
  })

  beforeEach(() => {
    psql(`
      ${resetScenario}
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 514');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 514', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number) VALUES (${voyageId}, ${vesselId}, 'VOY-514');
      INSERT INTO public.depots (id, code, name, tipo, port_id)
      SELECT '${terminalId}', 'TST514', 'Terminal 514', 'terminal_portuario', id FROM public.ports WHERE locode = 'BRVIX';
      INSERT INTO public.agency_departure_reports (id, voyage_id, port, terminal_id, terminal_port_id)
      SELECT '${reportId}', ${voyageId}, 'BRVIX', '${terminalId}', id FROM public.ports WHERE locode = 'BRVIX';
      -- B/L com o POD na grafia antiga: a escala é BRVIX.
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode) VALUES ('BL-514-A', ${voyageId}, 'BRVIT', 'container');
    `)
    persistFront('carga_cheia')
  })

  afterAll(() => {
    psql(`${resetScenario} ${removeUser}`)
  })

  it('aceita a escala cujas frentes derivadas têm todas terminal gravado', () => {
    expect(psql(`SELECT public._escala_import_fronts_without_terminal(${voyageId}, 'BRVIX');`)).toBe('{}')
    expect(assertReadyToClose().status).toBe(0)
  })

  // Decisão do dono (2026-10-30): o veículo viaja em container e segue a
  // frente de Carga cheia; não há frente nem terminal próprio de veículo.
  it('não pede frente de veículo: o veículo segue a Carga cheia dos containers', () => {
    psql(`
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('BL-514-A', 'TSTU5140001', '40HC');
      INSERT INTO public.vehicles (bl_id, container_id, voyage_id, brand, model, chassis, cbm, weight_kg)
      SELECT 'BL-514-A', id, ${voyageId}, 'MARCA', 'MODELO', 'CHASSI514', 1, 1000 FROM public.bl_containers WHERE bl_id = 'BL-514-A';
    `)

    expect(psql(`SELECT public._escala_import_fronts_without_terminal(${voyageId}, 'BRVIX');`)).toBe('{}')
    expect(assertReadyToClose().status).toBe(0)
  })

  it('recusa a carga em transbordo de escala omitida sem frente com terminal no porto de descarga', () => {
    psql(`
      -- O B/L mantém o POD do porto omitido e descarrega em BRVIX.
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode) VALUES ('BL-514-T', ${voyageId}, 'BRSSZ', 'carga_solta');
      INSERT INTO public.voyage_omissions (id, voyage_id, omitted_pod, discharge_pod, omitted_by)
      VALUES (${omissionId}, ${voyageId}, 'BRSSZ', 'BRVIX', '${adminId}');
      INSERT INTO public.bl_transshipments (bl_id, omission_id, disposition) VALUES ('BL-514-T', ${omissionId}, 'transshipment');
    `)

    expect(psql(`SELECT public._escala_import_fronts_without_terminal(${voyageId}, 'BRVIX');`)).toBe('{carga_solta}')
    const refused = assertReadyToClose()
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('Frente TBC impede o fechamento do ADR: carga solta.')

    // Omissão revertida: o B/L deixa de ser transbordo e volta ao porto dele.
    psql(`UPDATE public.voyage_omissions SET reverted_at = now() WHERE id = ${omissionId};`)
    expect(assertReadyToClose().status).toBe(0)
  })

  it('recusa os vazios de importação e o B/L misto sem as duas frentes com terminal', () => {
    psql(`
      INSERT INTO public.vazios_importacao_manifests (id, voyage_id, source) VALUES ('${manifestId}', ${voyageId}, 'baplie');
      INSERT INTO public.vazios_importacao_containers (manifest_id, container_number, pol, pod) VALUES ('${manifestId}', 'TSTU5140002', 'CNSHA', 'BRVIX');
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode) VALUES ('BL-514-M', ${voyageId}, 'BRVIX', 'misto');
    `)

    expect(psql(`SELECT public._escala_import_fronts_without_terminal(${voyageId}, 'BRVIX');`)).toBe('{carga_solta,vazio}')
    const refused = assertReadyToClose()
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('Frente TBC impede o fechamento do ADR: carga solta, vazios de importação.')
  })

  it('recusa o Granito importado no porto, mesmo sem declaração de exportação, até a frente ganhar terminal', () => {
    psql(`
      INSERT INTO public.granite_manifests (id, voyage_id, vessel_voyage, loading_port)
      VALUES ('${graniteManifestId}', ${voyageId}, 'VESSEL 514', 'BRVIT');
      -- Sem porto no B/L: vale o do manifesto, na grafia antiga de Vitória.
      INSERT INTO public.granite_bls (manifest_id, bl_number) VALUES ('${graniteManifestId}', 'GRN-514-1');
    `)

    expect(psql(`SELECT public._escala_fronts_without_terminal(${voyageId}, 'BRVIX');`)).toBe('{exportacao:granito}')
    const refused = assertReadyToClose()
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('Frente TBC impede o fechamento do ADR: granito.')

    persistFront('granito', 'exportacao')
    expect(assertReadyToClose().status).toBe(0)
  })

  it('fica fechado para o usuário do app: só o banco consulta as frentes sem terminal', () => {
    const denied = spawnPsql([
      '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
      '-c', `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${adminId}', true); SELECT public._escala_import_fronts_without_terminal(${voyageId}, 'BRVIX'); COMMIT;`,
    ], { encoding: 'utf8' })
    expect(denied.status).not.toBe(0)
    expect(denied.stderr).toContain('permission denied')
    const deniedAll = spawnPsql([
      '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
      '-c', `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${adminId}', true); SELECT public._escala_fronts_without_terminal(${voyageId}, 'BRVIX'); COMMIT;`,
    ], { encoding: 'utf8' })
    expect(deniedAll.status).not.toBe(0)
    expect(deniedAll.stderr).toContain('permission denied')
  })
})
