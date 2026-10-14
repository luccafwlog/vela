// Etapa 11 do plano de correção das importações (migration 187; ADR 0078,
// item 25). Reimportar Vazios de Importação da mesma rota substitui os
// containers dela preservando a natureza; o recadastro pelo Baplie preserva a
// natureza e não deixa manifestos vazios; o Embarque de Vazios atualiza por
// container e preserva as unidades incluídas à mão.
// Migration 192: a rota é comparada pela forma do cadastro (`normalize_port_code`,
// BRNVT → BRITJ) e o Nº pela forma canônica; corrigir o Nº atualiza o espelho
// `voyage_route_ce_master`.
//
// Namespace exclusivo: ids 99234xxx, containers 'AZCU234xxxx', usuário ...0000002340NN.
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const userId = '00000000-0000-0000-0000-000000234001'
const carrierId = 99234001
const vesselId = 99234002
const voyageId = 99234003
const depotCode = 'A234DEP'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string): { stdout: string; stderr: string } {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${userId}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.vazios_bookings WHERE voyage_id = ${voyageId};
    DELETE FROM public.agency_departure_reports WHERE voyage_id = ${voyageId};
    DELETE FROM public.vazios_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.vazios_export_service_lines WHERE operation_id IN (SELECT id FROM public.vazios_export_operations WHERE voyage_id = ${voyageId});
    DELETE FROM public.vazios_export_operations WHERE voyage_id = ${voyageId};
    DELETE FROM public.depot_services WHERE depot_id IN (SELECT id FROM public.depots WHERE code = '${depotCode}');
    DELETE FROM public.vazios_importacao_containers WHERE manifest_id IN (SELECT id FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId});
    DELETE FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyage_route_ce_master WHERE voyage_id = ${voyageId};
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${voyageId} OR numero = '1226A23409999';
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    DELETE FROM public.depots WHERE code = '${depotCode}';
    DELETE FROM public.audit_logs WHERE changed_by = '${userId}';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
  `)
}

function importVazios(containers: string[], numero: string) {
  const rows = containers.map((number) => ({ container_number: number, container_type: '40HC', tare_kg: 3800, pol: 'CNSHA', pod: 'BRVIX' }))
  return asUser(`SELECT public.import_vazios_importacao_transactional(${voyageId}, 'A234', '${userId}',
    '${JSON.stringify(rows)}'::jsonb, '[{"pol":"CNSHA","pod":"BRVIX","numero":"${numero}"}]'::jsonb);`)
}

function vazios(): string {
  return psql(`SELECT string_agg(c.container_number || ':' || COALESCE(c.natureza, '-'), ',' ORDER BY c.container_number)
    FROM public.vazios_importacao_containers c JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
    WHERE m.voyage_id = ${voyageId};`)
}

function bookings(rows: Array<{ container: string; date: string }>) {
  const payload = rows.map((row) => ({ container_number: row.container, container_type: '40HC', local_code: depotCode, condition: 'vazio', hand_in_date: row.date, hand_out_date: row.date, movement_date: row.date }))
  return asUser(`SELECT public.import_vazios_bookings_transactional(${voyageId}, 'BRVIX', '${userId}', '${JSON.stringify(payload)}'::jsonb);`)
}

describeLocal('Vazios: reimportação preserva natureza e unidades manuais (migration 187)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'a234-equip@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'A234 Equipamentos', 'equipamentos', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A234 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A234 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A234', 'active');
      INSERT INTO public.depots (code, active, tipo) VALUES ('${depotCode}', true, 'depot');
    `)
  })

  afterAll(cleanup)

  it('reimportar a mesma rota substitui os containers, reaproveita o Nº e preserva a natureza', () => {
    expect(importVazios(['AZCU2340001', 'AZCU2340002'], '1226A23400001').stderr).toBe('')
    psql(`UPDATE public.vazios_importacao_containers SET natureza = 'cama' WHERE container_number = 'AZCU2340001';`)

    const again = importVazios(['AZCU2340001', 'AZCU2340003'], '1226A23400001')
    expect(again.stderr).toBe('')
    expect(JSON.parse(again.stdout)).toMatchObject({ replaced_containers: 2 })
    expect(vazios()).toBe('AZCU2340001:cama,AZCU2340003:-')
    expect(psql(`SELECT count(*) FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId};`)).toBe('1')
    expect(psql(`SELECT string_agg(numero, ',') FROM public.manifestos_mercante WHERE voyage_id = ${voyageId};`)).toBe('1226A23400001')
  })

  it('o recadastro pelo Baplie preserva a natureza e não deixa manifesto vazio', () => {
    psql(`
      INSERT INTO public.baplie_containers (voyage_id, container_number, status, size_type, weight_kg, pol, pod)
      VALUES (${voyageId}, 'AZCU2340001', 'empty', '45G1', 3800, 'CNSHA', 'BRVIX');
      DELETE FROM public.vazios_importacao_containers WHERE container_number = 'AZCU2340003';
    `)
    // A natureza (cama) foi digitada na linha da planilha; o Baplie recadastra a Viagem.
    const replaced = asUser(`SELECT public.replace_vazios_from_baplie_transactional(${voyageId}, NULL, '${userId}', true);`)
    expect(replaced.stderr).toBe('')
    expect(psql(`SELECT natureza FROM public.vazios_importacao_containers c JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
      WHERE m.voyage_id = ${voyageId} AND m.source = 'baplie';`)).toBe('cama')

    psql(`DELETE FROM public.vazios_importacao_containers c USING public.vazios_importacao_manifests m
      WHERE m.id = c.manifest_id AND m.voyage_id = ${voyageId} AND m.source = 'manual';`)
    expect(asUser(`SELECT public.replace_vazios_from_baplie_transactional(${voyageId}, NULL, '${userId}', true);`).stderr).toBe('')
    expect(psql(`SELECT string_agg(source, ',') FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId};`)).toBe('baplie')
  })

  it('o Embarque de Vazios atualiza por container e preserva a unidade manual', () => {
    expect(bookings([{ container: 'AZCU2340011', date: '2026-10-01' }, { container: 'AZCU2340012', date: '2026-10-01' }]).stderr).toBe('')
    const operation = psql(`SELECT id FROM public.vazios_export_operations WHERE voyage_id = ${voyageId};`)
    const firstId = psql(`SELECT id FROM public.vazios_bookings WHERE container_number = 'AZCU2340011';`)
    const depot = psql(`SELECT id FROM public.depots WHERE code = '${depotCode}';`)
    expect(asUser(`SELECT public.create_manual_vazios_booking('${operation}', ${voyageId}, '${userId}', 'AZCU2340099', '40HC',
      '${depot}', 'vazio', '2026-10-02', '2026-10-02', '2026-10-02');`).stderr).toBe('')

    const result = bookings([{ container: 'AZCU2340011', date: '2026-10-05' }])
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ updated: 1, inserted: 0, removed: 1 })
    expect(psql(`SELECT string_agg(container_number || ':' || hand_in_date, ',' ORDER BY container_number) FROM public.vazios_bookings WHERE voyage_id = ${voyageId};`))
      .toBe('AZCU2340011:2026-10-05,AZCU2340099:2026-10-02')
    expect(psql(`SELECT id FROM public.vazios_bookings WHERE container_number = 'AZCU2340011';`)).toBe(firstId)
    // Nenhum manifesto órfão; os totais contam o que ficou.
    expect(psql(`SELECT count(*) FROM public.vazios_manifests vm WHERE vm.voyage_id = ${voyageId}
      AND NOT EXISTS (SELECT 1 FROM public.vazios_bookings b WHERE b.manifest_id = vm.id);`)).toBe('0')
    expect(psql(`SELECT sum(total_bookings) FROM public.vazios_manifests WHERE voyage_id = ${voyageId};`)).toBe('2')
  })

  function importRoute(container: string, pod: string, numero: string) {
    const rows = [{ container_number: container, container_type: '40HC', tare_kg: 3800, pol: 'CNSHA', pod }]
    return asUser(`SELECT public.import_vazios_importacao_transactional(${voyageId}, 'A234 ${pod}', '${userId}',
      '${JSON.stringify(rows)}'::jsonb, '[{"pol":"CNSHA","pod":"${pod}","numero":"${numero}"}]'::jsonb);`)
  }

  const nvtMirror = `SELECT ce_master FROM public.voyage_route_ce_master
    WHERE voyage_id = ${voyageId} AND cargo_mode = 'vazios' AND pol = 'CNSHA' AND pod = 'BRITJ';`

  // Achado V2 da revisão da PR 929: o Manifesto é gravado com BRITJ e o prune
  // comparava com o BRNVT do container, apagando o Manifesto recém-criado.
  it('rota com POD BRNVT: o Manifesto (BRITJ no cadastro) fica, o id volta e o espelho aponta para ele', () => {
    const result = importRoute('AZCU2340021', 'BRNVT', '1226A23400021')
    expect(result.stderr).toBe('')
    const ids = (JSON.parse(result.stdout) as { mercante_manifest_ids: string[] | null }).mercante_manifest_ids
    expect(ids).toHaveLength(1)
    expect(psql(`SELECT id || ':' || pol || '>' || pod FROM public.manifestos_mercante WHERE numero = '1226A23400021';`))
      .toBe(`${ids?.[0]}:CNSHA>BRITJ`)
    expect(psql(nvtMirror)).toBe('1226A23400021')
  })

  // Achados V11 e V10: o Nº é comparado na forma canônica (minúsculas e
  // separadores) e a correção chega ao espelho da rota.
  it('corrigir o Nº da rota (minúsculas e separadores) atualiza o Manifesto e o espelho', () => {
    const before = psql(`SELECT id FROM public.manifestos_mercante WHERE numero = '1226A23400021';`)
    expect(before).not.toBe('')
    const result = importRoute('AZCU2340021', 'BRNVT', '1226a2340-0022')
    expect(result.stderr).toBe('')
    expect(psql(`SELECT id FROM public.manifestos_mercante WHERE numero = '1226A23400022';`)).toBe(before)
    expect(psql(nvtMirror)).toBe('1226A23400022')
  })

  it('Nº já cadastrado em outra rota, escrito com minúsculas, é recusado com a mensagem de negócio', () => {
    psql(`INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza)
      VALUES (${voyageId}, 'CNSHA', 'BRSSZ', '1226A23409999', 'carga');`)
    const result = importRoute('AZCU2340031', 'BRVIX', '1226a2340.9999')
    expect(result.stderr).toMatch(/já foi cadastrado/)
    expect(result.stderr).not.toMatch(/duplicate key/)
  })

  // B12 (ADR 0033; migration 260): serviço de armazenagem sem condição é genérico e serve à linha de qualquer condição.
  it('B12 — linha de armazenagem aceita serviço sem condição; serviço de outra condição segue recusado', () => {
    psql(`INSERT INTO public.vazios_export_operations (voyage_id, embark_port) SELECT ${voyageId}, 'BRVIX'
      WHERE NOT EXISTS (SELECT 1 FROM public.vazios_export_operations WHERE voyage_id = ${voyageId});
      INSERT INTO public.depot_services (depot_id, name, natureza, condition, rate_brl)
      SELECT id, 'B12 armazenagem generica', 'armazenagem', NULL, 10 FROM public.depots WHERE code = '${depotCode}';
      INSERT INTO public.depot_services (depot_id, name, natureza, condition, rate_brl)
      SELECT id, 'B12 armazenagem material', 'armazenagem', 'material', 12 FROM public.depots WHERE code = '${depotCode}';`)
    const insertLine = (serviceName: string, condition: string) => spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `INSERT INTO public.vazios_export_service_lines (operation_id, service_id, local_id, condition, quantidade, valor_unitario)
       SELECT o.id, s.id, s.depot_id, '${condition}', 3, 10 FROM public.vazios_export_operations o, public.depot_services s
       WHERE o.voyage_id = ${voyageId} AND s.name = '${serviceName}' AND s.depot_id = (SELECT id FROM public.depots WHERE code = '${depotCode}');`], { encoding: 'utf8' })
    expect(insertLine('B12 armazenagem generica', 'vazio').stderr).toBe('')
    expect(insertLine('B12 armazenagem material', 'vazio').stderr).toMatch(/Armazenagem exige depot/)
  })

  // B14 (ADR 0071, item 4; migration 262): os vazios travam com o ADR de Saída fechado; Excluir unidade pede motivo.
  it('B14 — unidade manual e linha de serviço não saem com o ADR de Saída fechado; reabrir solta', () => {
    psql(`INSERT INTO public.vazios_export_operations (voyage_id, embark_port) SELECT ${voyageId}, 'BRVIX'
      WHERE NOT EXISTS (SELECT 1 FROM public.vazios_export_operations WHERE voyage_id = ${voyageId});`)
    const operation = psql(`SELECT id FROM public.vazios_export_operations WHERE voyage_id = ${voyageId};`)
    const depot = psql(`SELECT id FROM public.depots WHERE code = '${depotCode}';`)
    const created = asUser(`SELECT public.create_manual_vazios_booking('${operation}', ${voyageId}, '${userId}', 'AZCU2349991', '40HC', '${depot}', 'vazio', '2026-09-01', '2026-09-02', '2026-09-02');`)
    expect(created.stderr).toBe('')
    const booking = psql(`SELECT id FROM public.vazios_bookings WHERE voyage_id = ${voyageId} AND container_number = 'AZCU2349991';`)
    psql(`INSERT INTO public.depot_services (depot_id, name, natureza, condition, rate_brl)
      SELECT id, 'B14 handling', 'geral', NULL, 5 FROM public.depots WHERE code = '${depotCode}';
      INSERT INTO public.vazios_export_service_lines (operation_id, service_id, local_id, quantidade, valor_unitario)
      SELECT '${operation}', s.id, s.depot_id, 1, 5 FROM public.depot_services s WHERE s.name = 'B14 handling';
      INSERT INTO public.agency_departure_reports (voyage_id, port, status) VALUES (${voyageId}, 'BRVIX', 'closed');`)
    const line = psql(`SELECT l.id FROM public.vazios_export_service_lines l JOIN public.depot_services s ON s.id = l.service_id WHERE s.name = 'B14 handling';`)

    expect(asUser(`SELECT public.delete_manual_vazios_booking('${booking}', ' ')`).stderr).toMatch(/Informe o motivo/)
    expect(asUser(`SELECT public.delete_manual_vazios_booking('${booking}', 'lancada por engano')`).stderr).toMatch(/ADR de Saida fechado/)
    expect(asUser(`SELECT public.delete_catalog_row('vazios_export_service_lines', '${line}', 'custo errado')`).stderr).toMatch(/ADR de Saida fechado/)

    psql(`UPDATE public.agency_departure_reports SET status = 'open' WHERE voyage_id = ${voyageId} AND port = 'BRVIX';`)
    expect(asUser(`SELECT public.delete_manual_vazios_booking('${booking}', 'lancada por engano')`).stderr).toBe('')
    expect(asUser(`SELECT public.delete_catalog_row('vazios_export_service_lines', '${line}', 'custo errado')`).stderr).toBe('')
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_type = 'vazios_bookings' AND field_name = 'excluido' AND old_value LIKE '%AZCU2349991%' ORDER BY id DESC LIMIT 1;`)).toBe('lancada por engano')
  })
})
