// Migration 606 (decisões do dono de 2026-11-06, ADR 0130): a Unidade
// embarcada tem porto de descarga (POD) obrigatório e o POL do embarque; o
// Embarque direto sai de um terminal do porto do embarque; o Nº do Manifesto
// Mercante da rota de exportação fica enquanto a rota tem unidade; a
// armazenagem é por (depot, condição, tamanho) e congela o free time do depot
// no lançamento.
//
// Namespace exclusivo: ids 99606xxx, containers 'PDCU606xxxx', locais 'P606…',
// usuário ...000000606001.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const userId = '00000000-0000-0000-0000-000000606001'
const carrierId = 99606001
const vesselId = 99606002
const voyageId = 99606003
const depot = 'P606DEP'
const terminalVix = 'P606VIX'
const terminalSsz = 'P606SSZ'
const manifestoNumero = '1226501860603'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string): { stdout: string; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${userId}'; ${sql}; COMMIT;`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

const depotId = (code: string) => `(SELECT id FROM public.depots WHERE code = '${code}')`
const serviceId = (name: string) => `(SELECT id FROM public.depot_services WHERE name = '${name}')`
const operationId = `(SELECT id FROM public.vazios_export_operations WHERE voyage_id = ${voyageId})`

function createUnit(container: string, local: string, pod: string | null, dates: [string | null, string | null] = ['2026-10-01', '2026-10-20']) {
  const sqlText = (value: string | null) => (value === null ? 'NULL' : `'${value}'`)
  return asUser(`SELECT public.create_manual_vazios_booking(${operationId}, ${voyageId}, '${userId}', '${container}', '40HC',
    ${depotId(local)}, 'vazio', ${sqlText(dates[0])}, ${sqlText(dates[1])}, '2026-10-21', ${sqlText(pod)})`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.vazios_bookings WHERE voyage_id = ${voyageId};
    DELETE FROM public.vazios_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.vazios_export_service_lines WHERE operation_id IN (SELECT id FROM public.vazios_export_operations WHERE voyage_id = ${voyageId});
    DELETE FROM public.vazios_export_operations WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyage_route_ce_master WHERE voyage_id = ${voyageId};
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${voyageId};
    DELETE FROM public.depot_services WHERE depot_id IN (SELECT id FROM public.depots WHERE code LIKE 'P606%');
    DELETE FROM public.depots WHERE code LIKE 'P606%';
    DELETE FROM public.audit_logs WHERE changed_by = '${userId}';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('Embarque de vazios: POD, terminal do porto, manifesto da rota, tamanho e free time (migration 606)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'p606-equip@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'P606 Equipamentos', 'equipamentos', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'P606 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'P606 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'P606', 'active');
      INSERT INTO public.depots (code, active, tipo, free_time_vazio_days, free_time_material_days) VALUES ('${depot}', true, 'depot', 30, 10);
      INSERT INTO public.depots (code, active, tipo, port_id) SELECT '${terminalVix}', true, 'terminal_portuario', id FROM public.ports WHERE locode = 'BRVIX' ORDER BY id LIMIT 1;
      INSERT INTO public.depots (code, active, tipo, port_id) SELECT '${terminalSsz}', true, 'terminal_portuario', id FROM public.ports WHERE locode = 'BRSSZ' ORDER BY id LIMIT 1;
      INSERT INTO public.depot_services (depot_id, name, natureza, condition, container_type, rate_brl) VALUES
        (${depotId(depot)}, 'P606 ARMAZENAGEM 20', 'armazenagem', 'vazio', '20', 1.58),
        (${depotId(depot)}, 'P606 ARMAZENAGEM 40', 'armazenagem', 'vazio', '40', 3.14),
        (${depotId(depot)}, 'P606 ARMAZENAGEM MATERIAL', 'armazenagem', 'material', NULL, 6.71),
        (${depotId(depot)}, 'P606 HANDLING 40', 'geral', NULL, '40', 90);
      INSERT INTO public.voyage_escala_operation_fronts (voyage_id, port, port_id, sentido, modalidade, terminal_id, source)
        SELECT ${voyageId}, 'BRVIX', d.port_id, 'exportacao', 'vazio', d.id, 'export_declaration'
        FROM public.depots AS d WHERE d.code = '${terminalVix}';
      INSERT INTO public.vazios_export_operations (voyage_id, embark_port) VALUES (${voyageId}, 'BRVIX');
    `)
  })

  afterAll(cleanup)

  it('POD obrigatório, gravado no LOCODE e diferente do porto do embarque; POL é o do embarque', () => {
    expect(createUnit('PDCU6060001', depot, null).stderr).toMatch(/Porto de descarga obrigatório no container PDCU6060001/)
    expect(createUnit('PDCU6060001', depot, 'BRVIT').stderr).toMatch(/não pode ser o porto do embarque \(BRVIX\)/)
    expect(createUnit('PDCU6060001', depot, 'XX').stderr).toMatch(/Porto de descarga inválido no container PDCU6060001/)
    expect(createUnit('PDCU6060001', depot, 'Shanghai').stderr).toBe('')
    expect(psql(`SELECT pol || '>' || pod FROM public.vazios_bookings WHERE container_number = 'PDCU6060001'`)).toBe('BRVIX>CNSHA')
  })

  it('a planilha recusa unidade sem POD e grava o POD de cada unidade', () => {
    const payload = (pod: string | null) => JSON.stringify([{ container_number: 'PDCU6060002', container_type: '20DV', local_code: depot, condition: 'vazio', hand_in_date: '2026-10-01', hand_out_date: '2026-10-10', movement_date: '2026-10-11', pod }])
    expect(asUser(`SELECT public.import_vazios_bookings_transactional(${voyageId}, 'BRVIX', '${userId}', '${payload(null)}'::jsonb)`).stderr).toMatch(/Planilha inválida/)
    expect(asUser(`SELECT public.import_vazios_bookings_transactional(${voyageId}, 'BRVIX', '${userId}', '${payload('CNNGB')}'::jsonb)`).stderr).toBe('')
    expect(psql(`SELECT pol || '>' || pod FROM public.vazios_bookings WHERE container_number = 'PDCU6060002'`)).toBe('BRVIX>CNNGB')
  })

  it('Embarque direto só de terminal do porto do embarque', () => {
    expect(createUnit('PDCU6060003', terminalSsz, 'CNSHA', [null, null]).stderr)
      .toMatch(/O terminal portuário P606SSZ fica em BRSSZ, e o embarque é em BRVIX/)
    expect(createUnit('PDCU6060003', terminalVix, 'CNSHA', [null, null]).stderr).toBe('')
  })

  it('o Nº do Manifesto Mercante da rota de exportação fica enquanto a rota tem unidade', () => {
    expect(asUser(`SELECT public.set_voyage_route_ce_master(${voyageId}, 'BRVIX', 'CNNGB', '${manifestoNumero}', '${userId}', 'vazios')`).stderr).toBe('')
    expect(psql(`SELECT natureza || ':' || pol || '>' || pod FROM public.manifestos_mercante WHERE numero = '${manifestoNumero}'`)).toBe('vazio:BRVIX>CNNGB')
    // A limpeza dos Vazios de importação não apaga o Nº da rota de exportação viva.
    psql(`SELECT public._vazios_importacao_prune(${voyageId})`)
    expect(psql(`SELECT count(*) FROM public.manifestos_mercante WHERE numero = '${manifestoNumero}'`)).toBe('1')
    // A última unidade da rota sai: o Nº sai junto, como na importação.
    const booking = psql(`SELECT id FROM public.vazios_bookings WHERE container_number = 'PDCU6060002'`)
    expect(asUser(`SELECT public.delete_manual_vazios_booking('${booking}', 'Unidade lançada no porto errado')`).stderr).toBe('')
    expect(psql(`SELECT count(*) FROM public.manifestos_mercante WHERE numero = '${manifestoNumero}'`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.voyage_route_ce_master WHERE voyage_id = ${voyageId} AND ce_master = '${manifestoNumero}'`)).toBe('0')
  })

  it('armazenagem por tamanho: uma linha por (depot, condição, tamanho), com o tamanho do serviço', () => {
    const insertStorage = (service: string, condition: string) => asUser(`INSERT INTO public.vazios_export_service_lines
      (operation_id, service_id, local_id, condition, quantidade, valor_unitario)
      VALUES (${operationId}, ${serviceId(service)}, ${depotId(depot)}, '${condition}', 0, 1)`)
    expect(insertStorage('P606 ARMAZENAGEM 20', 'vazio').stderr).toBe('')
    expect(insertStorage('P606 ARMAZENAGEM 40', 'vazio').stderr).toBe('')
    expect(insertStorage('P606 ARMAZENAGEM 20', 'vazio').stderr).toMatch(/uq_vazios_storage_line_operation_local_condition_size/)
    expect(psql(`SELECT string_agg(s.name || '=' || COALESCE(l.container_type, '-'), ',' ORDER BY s.name)
      FROM public.vazios_export_service_lines l JOIN public.depot_services s ON s.id = l.service_id
      WHERE l.operation_id = ${operationId}`)).toBe('P606 ARMAZENAGEM 20=20,P606 ARMAZENAGEM 40=40')
    // Linha geral também recebe o tamanho do serviço.
    expect(asUser(`INSERT INTO public.vazios_export_service_lines (operation_id, service_id, local_id, quantidade, valor_unitario)
      VALUES (${operationId}, ${serviceId('P606 HANDLING 40')}, ${depotId(depot)}, 2, 90)`).stderr).toBe('')
    expect(psql(`SELECT container_type FROM public.vazios_export_service_lines WHERE service_id = ${serviceId('P606 HANDLING 40')}`)).toBe('40')
    // O catálogo só aceita 20 ou 40.
    expect(spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `INSERT INTO public.depot_services (depot_id, name, natureza, container_type, rate_brl) VALUES (${depotId(depot)}, 'P606 X', 'geral', '45', 1)`],
    { encoding: 'utf8' }).stderr).toMatch(/depot_services_container_size_check/)
  })

  it('free time congelado na linha de armazenagem: mudar o cadastro não muda a linha', () => {
    const line = `(SELECT id FROM public.vazios_export_service_lines WHERE service_id = ${serviceId('P606 ARMAZENAGEM 20')})`
    expect(psql(`SELECT free_time_days FROM public.vazios_export_service_lines WHERE id = ${line}`)).toBe('30')
    psql(`UPDATE public.depots SET free_time_vazio_days = 5 WHERE code = '${depot}'`)
    // Editar a linha (quantidade) não refaz o free time nem o tamanho, nem por escrita direta.
    expect(asUser(`UPDATE public.vazios_export_service_lines SET quantidade = 3, free_time_days = 0, container_type = '40' WHERE id = ${line}`).stderr).toBe('')
    expect(psql(`SELECT free_time_days || ':' || container_type FROM public.vazios_export_service_lines WHERE id = ${line}`)).toBe('30:20')
    // Linha nova lançada depois da mudança leva o free time novo; material usa o da condição.
    expect(asUser(`INSERT INTO public.vazios_export_service_lines (operation_id, service_id, local_id, condition, quantidade, valor_unitario)
      VALUES (${operationId}, ${serviceId('P606 ARMAZENAGEM MATERIAL')}, ${depotId(depot)}, 'material', 0, 6.71)`).stderr).toBe('')
    expect(psql(`SELECT free_time_days FROM public.vazios_export_service_lines WHERE service_id = ${serviceId('P606 ARMAZENAGEM MATERIAL')}`)).toBe('10')
  })
})
