// Migration 326 (lote 5b da identidade visual, achados V1 e V6): local e
// serviço inativos não entram em lançamento novo do Embarque de vazios — nem
// na unidade incluída à mão nem na linha de serviço —, e o que já foi lançado
// continua editável sem trocar de local ou serviço. As mensagens chegam com
// acento.
//
// Migration 331 (decisão do responsável de 2026-10-20): o destino inativo do
// transporte também é recusado em lançamento novo.
//
// Namespace exclusivo: ids 99326xxx, containers 'AZCU326xxxx', depots 'A326…',
// usuário ...0000003260NN.
import { resolve } from 'node:path'
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const userId = '00000000-0000-0000-0000-000000326001'
const carrierId = 99326001
const vesselId = 99326002
const voyageId = 99326003
const activeDepot = 'A326ATV'
const inactiveDepot = 'A326INA'
const terminal = 'A326TER'
const destination = 'A326DST'
const migration331Path = resolve(process.cwd(), 'supabase/migrations/331_vazios_destino_inativo_recusado.sql')

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

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.vazios_bookings WHERE voyage_id = ${voyageId};
    DELETE FROM public.vazios_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.vazios_export_service_lines WHERE operation_id IN (SELECT id FROM public.vazios_export_operations WHERE voyage_id = ${voyageId});
    DELETE FROM public.vazios_export_operations WHERE voyage_id = ${voyageId};
    DELETE FROM public.depot_services WHERE depot_id IN (SELECT id FROM public.depots WHERE code LIKE 'A326%');
    DELETE FROM public.depots WHERE code LIKE 'A326%';
    DELETE FROM public.audit_logs WHERE changed_by = '${userId}';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
  `)
}

function createBooking(container: string, depotCode: string) {
  return asUser(`SELECT public.create_manual_vazios_booking(${operationId}, ${voyageId}, '${userId}', '${container}', '40HC',
    ${depotId(depotCode)}, 'vazio', '2026-09-01', '2026-09-20', '2026-09-21')`)
}

function insertLine(service: string, depotCode: string) {
  return asUser(`INSERT INTO public.vazios_export_service_lines (operation_id, service_id, local_id, quantidade, valor_unitario)
    VALUES (${operationId}, ${serviceId(service)}, ${depotId(depotCode)}, 1, 10)`)
}

function setActive(table: 'depots' | 'depot_services', where: string, active: boolean) {
  // Desativar é do Administrativo pela tela; aqui só prepara o cenário.
  psql(`SET session_replication_role = replica; UPDATE public.${table} SET active = ${active} WHERE ${where}; SET session_replication_role = origin;`)
}

describeLocal('Embarque de vazios: local e serviço inativos recusados (migration 326)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'a326-equip@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'A326 Equipamentos', 'equipamentos', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A326 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A326 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A326', 'active');
      INSERT INTO public.depots (code, active, tipo, free_time_vazio_days, free_time_material_days) VALUES
        ('${activeDepot}', true, 'depot', 10, 10),
        ('${inactiveDepot}', false, 'depot', 10, 10),
        ('${destination}', true, 'depot', 10, 10);
      INSERT INTO public.depots (code, active, tipo, port_id)
        SELECT '${terminal}', true, 'terminal_portuario', id FROM public.ports WHERE locode LIKE 'BR%' ORDER BY id LIMIT 1;
      INSERT INTO public.depot_services (depot_id, name, natureza, rate_brl, active) VALUES
        (${depotId(activeDepot)}, 'A326 HANDLING', 'geral', 10, true),
        (${depotId(activeDepot)}, 'A326 HANDLING ANTIGO', 'geral', 10, false),
        (${depotId(inactiveDepot)}, 'A326 HANDLING INATIVO', 'geral', 10, true);
      INSERT INTO public.depot_services (depot_id, name, natureza, rate_brl, active, route_destino_id) VALUES
        (${depotId(activeDepot)}, 'A326 TRANSPORTE', 'transporte', 10, true, ${depotId(destination)});
      INSERT INTO public.vazios_export_operations (voyage_id, embark_port) VALUES (${voyageId}, 'BRVIX');
    `)
  })

  afterAll(cleanup)

  it('unidade manual: local inativo é recusado; local ativo é aceito', () => {
    expect(createBooking('AZCU3260001', inactiveDepot).stderr).toMatch(/Local inativo: escolha um local ativo/)
    expect(createBooking('AZCU3260002', activeDepot).stderr).toBe('')
    expect(psql(`SELECT count(*) FROM public.vazios_bookings WHERE voyage_id = ${voyageId}`)).toBe('1')
  })

  it('editar a unidade: trocar para local inativo é recusado; editar sem trocar segue aceito depois de desativar', () => {
    const booking = psql(`SELECT id FROM public.vazios_bookings WHERE container_number = 'AZCU3260002'`)
    const update = (depotCode: string, handOut: string) => asUser(`SELECT public.update_manual_vazios_booking('${booking}', 'AZCU3260002', '40HC',
      ${depotId(depotCode)}, 'vazio', '2026-09-01', '${handOut}', '2026-09-21')`)
    expect(update(inactiveDepot, '2026-09-20').stderr).toMatch(/Local inativo/)

    setActive('depots', `code = '${activeDepot}'`, false)
    try {
      expect(update(activeDepot, '2026-09-19').stderr).toBe('')
      expect(psql(`SELECT hand_out_date FROM public.vazios_bookings WHERE id = '${booking}'`)).toBe('2026-09-19')
      // Migration 332: a alteração grava o "Atualizado em" da unidade.
      expect(psql(`SELECT updated_at > created_at FROM public.vazios_bookings WHERE id = '${booking}'`)).toBe('t')
    } finally {
      setActive('depots', `code = '${activeDepot}'`, true)
    }
  })

  it('linha de serviço: serviço inativo e local inativo são recusados; ativos são aceitos', () => {
    expect(insertLine('A326 HANDLING ANTIGO', activeDepot).stderr).toMatch(/Serviço inativo: escolha um serviço ativo/)
    expect(insertLine('A326 HANDLING INATIVO', inactiveDepot).stderr).toMatch(/Local inativo/)
    expect(insertLine('A326 HANDLING', activeDepot).stderr).toBe('')
  })

  it('a observação da linha já lançada continua editável depois de desativar o serviço', () => {
    setActive('depot_services', `name = 'A326 HANDLING'`, false)
    try {
      expect(asUser(`UPDATE public.vazios_export_service_lines SET observation = 'Conferido'
        WHERE service_id = ${serviceId('A326 HANDLING')}`).stderr).toBe('')
      expect(psql(`SELECT observation FROM public.vazios_export_service_lines WHERE service_id = ${serviceId('A326 HANDLING')}`)).toBe('Conferido')
    } finally {
      setActive('depot_services', `name = 'A326 HANDLING'`, true)
    }
  })

  it('as mensagens do banco chegam com acento', () => {
    expect(asUser(`SELECT public.create_manual_vazios_booking(${operationId}, ${voyageId}, '${userId}', 'AZCU3260003', '40HC',
      ${depotId(terminal)}, 'vazio', '2026-09-01', NULL, '2026-09-21')`).stderr).toMatch(/Terminal portuário não aceita entrada ou saída\./)
    expect(asUser(`SELECT public.create_manual_vazios_booking(${operationId}, ${voyageId}, '${userId}', 'AZCU3260004', '40HC',
      ${depotId(activeDepot)}, 'vazio', NULL, NULL, '2026-09-21')`).stderr).toMatch(/Depot exige entrada e saída válidas\./)
    expect(asUser(`SELECT public.create_manual_vazios_booking(${operationId}, ${voyageId}, '${userId}', 'XX1', '40HC',
      ${depotId(activeDepot)}, 'vazio', NULL, NULL, NULL)`).stderr).toMatch(/Container inválido\./)
  })

  it('transporte para destino inativo é recusado; a linha já lançada segue editável (migration 331)', () => {
    execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-1', '-d', databaseUrl, '-f', migration331Path], { encoding: 'utf8' })
    const insertTransport = () => asUser(`INSERT INTO public.vazios_export_service_lines (operation_id, service_id, local_id, destino_id, quantidade, valor_unitario)
      VALUES (${operationId}, ${serviceId('A326 TRANSPORTE')}, ${depotId(activeDepot)}, ${depotId(destination)}, 1, 10)`)
    expect(insertTransport().stderr).toBe('')
    setActive('depots', `code = '${destination}'`, false)
    try {
      expect(insertTransport().stderr).toMatch(/Destino inativo: escolha um transporte para local ativo/)
      expect(asUser(`UPDATE public.vazios_export_service_lines SET observation = 'Conferido'
        WHERE service_id = ${serviceId('A326 TRANSPORTE')}`).stderr).toBe('')
      expect(psql(`SELECT count(*) FROM public.vazios_export_service_lines WHERE service_id = ${serviceId('A326 TRANSPORTE')}`)).toBe('1')
    } finally {
      setActive('depots', `code = '${destination}'`, true)
    }
  })
})
