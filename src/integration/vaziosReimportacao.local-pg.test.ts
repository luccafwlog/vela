// Etapa 11 do plano de correção das importações (migration 187; ADR 0078,
// item 25). Reimportar Vazios de Importação da mesma rota substitui os
// containers dela preservando a natureza; o recadastro pelo Baplie preserva a
// natureza e não deixa manifestos vazios; o Embarque de Vazios atualiza por
// container e preserva as unidades incluídas à mão.
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
    DELETE FROM public.vazios_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.vazios_export_operations WHERE voyage_id = ${voyageId};
    DELETE FROM public.vazios_importacao_containers WHERE manifest_id IN (SELECT id FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId});
    DELETE FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${voyageId};
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
})
