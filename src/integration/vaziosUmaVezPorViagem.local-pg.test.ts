// Lote 6 do plano docs/plans/2026-10-21-frente-das-importacoes.md (migration
// 398; ADR 0095, decisões 21 e 22; F-32). O vazio de importação existe uma
// vez por Viagem: a planilha vale sobre o Baplie, o Baplie não sobrescreve a
// planilha, o container de outra planilha em outra rota é recusado com o
// container e a rota, e o índice único segura a escrita que escapar das RPCs.
// Com o ADR de Saída fechado, nada muda no Embarque de vazios: incluir,
// editar, escrita direta na linha de serviço e troca de porto do embarque.
//
// Namespace exclusivo: ids 99398xxx, containers 'VZCU398xxxx', usuário ...0000003980NN.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const userId = '00000000-0000-0000-0000-000000398001'
const carrierId = 99398001
const vesselId = 99398002
const voyageId = 99398003
const depotCode = 'V398DEP'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  if (process.env.LOCAL_PG_REPRO === '1') return true
  try {
    return psql(`SELECT to_regproc('public.vazios_export_adr_locked') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 398 aplicada')

function asUser(sql: string): { stdout: string; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${userId}'; ${sql}; COMMIT;`],
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
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${voyageId};
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    DELETE FROM public.import_batches WHERE voyage_id = ${voyageId};
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

type Row = { container: string; pol?: string; pod: string }
let nextNumero = 1
const numeroOf = new Map<string, string>()

/** Planilha de Vazios de importação: um Nº de manifesto Mercante por rota, fixo por rota no teste. */
function planilha(rows: Row[]) {
  const containers = rows.map((row) => ({ container_number: row.container, container_type: '40HC', tare_kg: 3800, pol: row.pol ?? 'CNSHA', pod: row.pod }))
  const routes = [...new Set(containers.map((c) => `${c.pol}|${c.pod}`))]
  const manifestos = routes.map((key) => {
    if (!numeroOf.has(key)) numeroOf.set(key, `1226V3980${String(nextNumero++).padStart(4, '0')}`)
    const [pol, pod] = key.split('|')
    return { pol, pod, numero: numeroOf.get(key) }
  })
  return asUser(`SELECT public.import_vazios_importacao_transactional(${voyageId}, 'V398', '${userId}',
    '${JSON.stringify(containers)}'::jsonb, '${JSON.stringify(manifestos)}'::jsonb);`)
}

function baplie(rows: Row[]) {
  psql(`DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    INSERT INTO public.baplie_containers (voyage_id, container_number, status, size_type, weight_kg, pol, pod) VALUES
    ${rows.map((row) => `(${voyageId}, '${row.container}', 'empty', '45G1', 3800, '${row.pol ?? 'CNSHA'}', '${row.pod}')`).join(',\n')};`)
}

function confirmarBaplie(replace: boolean) {
  return asUser(`SELECT public.replace_vazios_from_baplie_transactional(${voyageId}, NULL, '${userId}', ${replace});`)
}

/** container:fonte:pod de cada vazio de importação da Viagem. */
function vazios(): string {
  return psql(`SELECT coalesce(string_agg(c.container_key || ':' || m.source || ':' || c.pod, ',' ORDER BY c.container_key), '')
    FROM public.vazios_importacao_containers c JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
    WHERE m.voyage_id = ${voyageId};`)
}

function resetVazios() {
  psql(`SET session_replication_role = replica;
    DELETE FROM public.vazios_importacao_containers WHERE manifest_id IN (SELECT id FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId});
    DELETE FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.voyage_route_ce_master WHERE voyage_id = ${voyageId};
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${voyageId};
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    SET session_replication_role = origin;`)
  numeroOf.clear()
}

describeLocal('398 — vazio de importação uma vez por Viagem; ADR de Saída fechado trava o Embarque de vazios', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'v398-equip@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'V398 Equipamentos', 'equipamentos', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'V398 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'V398 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'V398', 'active');
      INSERT INTO public.depots (code, active, tipo) VALUES ('${depotCode}', true, 'depot');
    `)
  })

  afterAll(cleanup)

  it('decisão 21: o Baplie não sobrescreve a planilha; cadastra só o que ela não trouxe', () => {
    resetVazios()
    expect(planilha([{ container: 'VZCU3980001', pod: 'BRVIX' }]).stderr).toBe('')
    // O Baplie traz o mesmo container em outra rota e um container novo.
    baplie([{ container: 'VZCU3980001', pod: 'BRSSZ' }, { container: 'VZCU3980002', pod: 'BRSSZ' }])

    const first = confirmarBaplie(false)
    expect(first.stderr).toBe('')
    expect(JSON.parse(first.stdout)).toMatchObject({ total: 1, planilha: 1 })
    expect(vazios()).toBe('VZCU3980001:manual:BRVIX,VZCU3980002:baplie:BRSSZ')

    // "Atualizar vazios do Baplie" também não desfaz a planilha.
    const again = confirmarBaplie(true)
    expect(again.stderr).toBe('')
    expect(JSON.parse(again.stdout)).toMatchObject({ total: 1, planilha: 1 })
    expect(vazios()).toBe('VZCU3980001:manual:BRVIX,VZCU3980002:baplie:BRSSZ')
  })

  it('decisão 21: Baplie com todos os vazios já na planilha não cria manifesto nem recusa', () => {
    resetVazios()
    expect(planilha([{ container: 'VZCU3980011', pod: 'BRVIX' }]).stderr).toBe('')
    baplie([{ container: 'VZCU3980011', pod: 'BRVIX' }])
    const result = confirmarBaplie(false)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ manifest_id: null, total: 0, planilha: 1 })
    expect(psql(`SELECT count(*) FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId} AND source = 'baplie';`)).toBe('0')
  })

  it('decisão 21: a planilha vale sobre o Baplie, em qualquer rota', () => {
    resetVazios()
    baplie([{ container: 'VZCU3980021', pod: 'BRSSZ' }, { container: 'VZCU3980022', pod: 'BRSSZ' }])
    expect(confirmarBaplie(false).stderr).toBe('')
    // A planilha traz VZCU3980021 em outra rota (BRVIX): ele sai do Baplie.
    const result = planilha([{ container: 'vzcu 3980021', pod: 'BRVIX' }])
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ replaced_from_baplie: 1 })
    expect(vazios()).toBe('VZCU3980021:manual:BRVIX,VZCU3980022:baplie:BRSSZ')
    expect(psql(`SELECT total_containers FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId} AND source = 'baplie';`)).toBe('1')
  })

  it('decisão 21: container de outra planilha em outra rota é recusado com o container e a rota', () => {
    resetVazios()
    expect(planilha([{ container: 'VZCU3980031', pod: 'BRVIX' }]).stderr).toBe('')
    const result = planilha([{ container: 'VZCU3980031', pod: 'BRSSZ' }, { container: 'VZCU3980032', pod: 'BRSSZ' }])
    expect(result.stderr).toMatch(/O container VZCU3980031 já está nos Vazios de importação desta Viagem na rota CNSHA → BRVIX, de outra planilha/)
    expect(result.stderr).not.toMatch(/duplicate key/)
    expect(vazios()).toBe('VZCU3980031:manual:BRVIX')

    // A mesma rota de volta substitui a rota inteira: aceito.
    expect(planilha([{ container: 'VZCU3980031', pod: 'BRVIX' }, { container: 'VZCU3980033', pod: 'BRVIX' }]).stderr).toBe('')
    expect(vazios()).toBe('VZCU3980031:manual:BRVIX,VZCU3980033:manual:BRVIX')
  })

  it('decisão 21: o mesmo container duas vezes na planilha é recusado', () => {
    resetVazios()
    const result = planilha([{ container: 'VZCU3980041', pod: 'BRVIX' }, { container: 'VZCU3980041', pod: 'BRSSZ' }])
    expect(result.stderr).toMatch(/O container VZCU3980041 aparece mais de uma vez na planilha \(CNSHA → BRSSZ e CNSHA → BRVIX\)/)
    expect(vazios()).toBe('')
  })

  it('decisão 21: o índice único segura a escrita fora das RPCs (mesma Viagem, número escrito de outro jeito)', () => {
    resetVazios()
    expect(planilha([{ container: 'VZCU3980051', pod: 'BRVIX' }]).stderr).toBe('')
    const insert = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `INSERT INTO public.vazios_importacao_manifests (id, voyage_id, source) VALUES ('00000000-0000-0000-0000-000003980051', ${voyageId}, 'baplie');
       INSERT INTO public.vazios_importacao_containers (manifest_id, container_number, pol, pod)
       VALUES ('00000000-0000-0000-0000-000003980051', 'vzcu-3980051', 'CNSHA', 'BRSSZ');`], { encoding: 'utf8' })
    expect(insert.stderr).toMatch(/vazios_importacao_containers_voyage_container_key/)
    expect(psql(`SELECT voyage_id || ':' || container_key FROM public.vazios_importacao_containers c
      WHERE c.container_number = 'VZCU3980051';`)).toBe(`${voyageId}:VZCU3980051`)
  })

  it('decisão 22: com o ADR de Saída fechado, incluir, editar, linha de serviço e troca de porto são recusados; reabrir solta', () => {
    psql(`INSERT INTO public.vazios_export_operations (voyage_id, embark_port) VALUES (${voyageId}, 'BRVIX');
      INSERT INTO public.depot_services (depot_id, name, natureza, condition, rate_brl)
      SELECT id, 'V398 handling', 'geral', NULL, 5 FROM public.depots WHERE code = '${depotCode}';`)
    const operation = psql(`SELECT id FROM public.vazios_export_operations WHERE voyage_id = ${voyageId};`)
    const depot = psql(`SELECT id FROM public.depots WHERE code = '${depotCode}';`)
    const include = (container: string) => asUser(`SELECT public.create_manual_vazios_booking('${operation}', ${voyageId}, '${userId}', '${container}', '40HC', '${depot}', 'vazio', '2026-09-01', '2026-09-02', '2026-09-02');`)
    expect(include('VZCU3980061').stderr).toBe('')
    const booking = psql(`SELECT id FROM public.vazios_bookings WHERE container_number = 'VZCU3980061';`)
    const edit = () => asUser(`SELECT public.update_manual_vazios_booking('${booking}', 'VZCU3980061', '20DV', '${depot}', 'vazio', '2026-09-01', '2026-09-03', '2026-09-03');`)
    const insertLine = () => asUser(`INSERT INTO public.vazios_export_service_lines (operation_id, service_id, local_id, quantidade, valor_unitario)
      SELECT '${operation}', s.id, s.depot_id, 1, 5 FROM public.depot_services s WHERE s.name = 'V398 handling'`)
    expect(insertLine().stderr).toBe('')
    const line = psql(`SELECT l.id FROM public.vazios_export_service_lines l JOIN public.depot_services s ON s.id = l.service_id WHERE s.name = 'V398 handling';`)
    const updateLine = () => asUser(`UPDATE public.vazios_export_service_lines SET quantidade = 7, observation = 'depois do ADR' WHERE id = '${line}'`)
    const movePort = () => asUser(`UPDATE public.vazios_export_operations SET embark_port = 'BRSSZ' WHERE id = '${operation}'`)
    const locked = () => asUser(`SELECT public.vazios_export_adr_locked(${voyageId}, 'brvix')`).stdout

    expect(locked()).toBe('f')
    psql(`INSERT INTO public.agency_departure_reports (voyage_id, port, status) VALUES (${voyageId}, 'BRVIX', 'closed');`)
    expect(locked()).toBe('t')

    const message = /ADR de Saída de BRVIX fechado: o Embarque de vazios não muda .*Reabra o ADR de Saída para mudar\./
    expect(include('VZCU3980062').stderr).toMatch(message)
    expect(edit().stderr).toMatch(message)
    expect(insertLine().stderr).toMatch(message)
    expect(updateLine().stderr).toMatch(message)
    expect(movePort().stderr).toMatch(message)
    expect(psql(`SELECT container_type || ':' || hand_out_date FROM public.vazios_bookings WHERE id = '${booking}';`)).toBe('40HC:2026-09-02')
    expect(psql(`SELECT quantidade::int FROM public.vazios_export_service_lines WHERE id = '${line}';`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.vazios_bookings WHERE voyage_id = ${voyageId};`)).toBe('1')

    psql(`SET request.jwt.claim.role = 'service_role'; UPDATE public.agency_departure_reports SET status = 'open' WHERE voyage_id = ${voyageId} AND port = 'BRVIX';`)
    expect(locked()).toBe('f')
    expect(include('VZCU3980062').stderr).toBe('')
    expect(edit().stderr).toBe('')
    expect(updateLine().stderr).toBe('')
    expect(psql(`SELECT container_type || ':' || hand_out_date FROM public.vazios_bookings WHERE id = '${booking}';`)).toBe('20DV:2026-09-03')
  })
  it('399: com o ADR de Saída fechado, criar o primeiro Embarque da Viagem e porto é recusado; a exclusão da Viagem passa', () => {
    psql(`INSERT INTO public.agency_departure_reports (voyage_id, port, status) VALUES (${voyageId}, 'BRRIO', 'closed');`)
    const message = /ADR de Saída de BRRIO fechado: o Embarque de vazios não muda/
    const create = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `INSERT INTO public.vazios_export_operations (voyage_id, embark_port) VALUES (${voyageId}, 'brrio');`], { encoding: 'utf8' })
    expect(create.stderr).toMatch(message)
    expect(psql(`SELECT count(*) FROM public.vazios_export_operations WHERE voyage_id = ${voyageId} AND upper(embark_port) = 'BRRIO';`)).toBe('0')
    // A exclusão pela RPC liga vela.deleting_records: o gatilho deixa apagar o Embarque com ADR fechado.
    expect(psql(`BEGIN; SET LOCAL vela.deleting_records = 'on';
      DELETE FROM public.vazios_export_operations WHERE voyage_id = ${voyageId};
      SELECT count(*) FROM public.vazios_export_operations WHERE voyage_id = ${voyageId}; ROLLBACK;`)).toBe('0')
  })
})
