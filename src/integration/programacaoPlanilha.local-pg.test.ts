// Etapa 11 do plano de correção das importações (migration 188): a
// Programação por planilha grava numa transação. Viagem nova é criada uma vez
// (duas linhas iguais não duplicam) e uma linha inválida desfaz o arquivo todo.
// Migration 193: IMO só identifica com 7 dígitos e IMO distinto nunca funde;
// Viagem cancelada é recusada com o nome dela; a última linha da mesma Viagem
// e porto vale; Viagem oculta enviada sem data nova é publicada.
// Migration 199: dois arquivos simultâneos da mesma Viagem nova, um com IMO e
// outro sem, esperam um pelo outro e não duplicam navio nem Viagem.
// Migration 201: dois arquivos com as mesmas Viagens novas em ordens
// diferentes não se travam mutuamente (deadlock). Migration 202: o navio sem
// IMO achado pelo nome recebe o IMO do arquivo, e outra grafia com o mesmo IMO
// não duplica navio nem Viagem.
//
// Namespace exclusivo: navios 'A235 *', IMO 9235xxx, usuário ...0000002350NN.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const userId = '00000000-0000-0000-0000-000000235001'
const carrierName = 'A235 CARRIER'

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

/** psql em outra sessão, sem bloquear o teste (para abrir uma janela de concorrência). */
function runAsync(sql: string): Promise<{ code: number | null; stderr: string }> {
  const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, stderr })))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const voyagesOfNamespace = `(SELECT v.id FROM public.voyages v JOIN public.vessels s ON s.id = v.vessel_id WHERE s.name LIKE 'A235 %')`

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by = '${userId}';
    -- Navios e Viagens semeados direto (seedVoyage) deixam Histórico sem autor.
    DELETE FROM public.audit_logs WHERE (entity_type = 'voyages' AND entity_id IN (SELECT v.id::text FROM public.voyages v JOIN public.vessels s ON s.id = v.vessel_id WHERE s.name LIKE 'A235 %'))
      OR (entity_type = 'vessels' AND entity_id IN (SELECT id::text FROM public.vessels WHERE name LIKE 'A235 %'))
      OR (entity_type = 'carriers' AND entity_id IN (SELECT id::text FROM public.carriers WHERE name = '${carrierName}'));
    DELETE FROM public.voyages WHERE id IN ${voyagesOfNamespace};
    DELETE FROM public.vessels WHERE name LIKE 'A235 %';
    DELETE FROM public.carriers WHERE name = '${carrierName}';
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
  `)
}

function row(vessel: string, imo: string, voyage: string, eta: string, voyageId: number | null = null) {
  return { voyage_id: voyageId, vessel_name: vessel, vessel_imo: imo, voyage_number: voyage,
    changes: [{ entity_type: 'voyage_pod_schedule', port: 'BRSSA', field_name: 'eta', old_value: null, new_value: eta, justification: 'Atualizacao manual de ETA por POD' }] }
}

/** Navio e Viagem do namespace, gravados direto (sem passar pela planilha). */
function seedVoyage(vessel: string, imo: string | null, voyage: string, status = 'active', showOnPortal = true): string {
  return psql(`
    WITH c AS (INSERT INTO public.carriers (name) VALUES ('${carrierName}') RETURNING id),
         s AS (INSERT INTO public.vessels (name, imo, carrier_id) SELECT '${vessel}', ${imo ? `'${imo}'` : 'NULL'}, id FROM c RETURNING id)
    INSERT INTO public.voyages (vessel_id, voyage_number, status, show_on_portal)
    SELECT id, '${voyage}', '${status}', ${showOnPortal} FROM s RETURNING id;`)
}

function apply(rows: unknown[]) {
  return asUser(`SELECT public.apply_schedule_sheet_atomic('${JSON.stringify(rows)}'::jsonb, '${carrierName}', '');`)
}

describeLocal('Programação por planilha atômica (migration 188)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'a235-equip@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'A235 Equipamentos', 'equipamentos', true);
    `)
  })

  afterAll(cleanup)

  it('cria a Viagem nova uma vez, publica no Portal e grava a agenda com o id dela', () => {
    const result = apply([row('A235 ALFA', '9235001', '001N', '2026-11-01'), row('A235 ALFA', '9235001', '001N', '2026-11-02')])
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ created: 1, updated: 1, changes: 2 })
    expect(psql(`SELECT count(*) FROM public.voyages WHERE id IN ${voyagesOfNamespace};`)).toBe('1')
    const voyageId = psql(`SELECT id FROM public.voyages WHERE id IN ${voyagesOfNamespace};`)
    expect(psql(`SELECT show_on_portal FROM public.voyages WHERE id = ${voyageId};`)).toBe('t')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'voyage_pod_schedule' AND entity_id = '${voyageId}::BRSSA';`)).toBe('2')
  })

  it('uma linha que falha desfaz o arquivo inteiro', () => {
    const before = psql(`SELECT count(*) FROM public.audit_logs WHERE changed_by = '${userId}';`)
    const failed = apply([row('A235 BETA', '9235002', '002N', '2026-11-03'), row('A235 GAMA', '9235003', '003N', '2026-11-04', 99235999)])
    expect(failed.stderr).toMatch(/Viagem 99235999 não encontrada/)
    expect(psql(`SELECT count(*) FROM public.vessels WHERE name = 'A235 BETA';`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE changed_by = '${userId}';`)).toBe(before)
  })

  it('nome igual com IMO cadastrado diferente é recusado: nunca grava na Viagem do outro navio', () => {
    const otherVoyage = seedVoyage('A235 DELTA', '9235004', '004N')
    const refused = apply([row('A235 DELTA', '9235005', '004N', '2026-11-05')])
    expect(refused.stderr).toMatch(/Navio A235 DELTA com IMO conflitante \(9235004 vs 9235005\)/)
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = '${otherVoyage}::BRSSA';`)).toBe('0')
  })

  it('IMO sem 7 dígitos ("TBA") não casa com navios sem IMO: a Viagem nova ganha navio próprio', () => {
    seedVoyage('A235 ZETA', null, '005N')
    seedVoyage('A235 ETA', null, '005N')
    const result = apply([row('A235 EPSILON', 'TBA', '005N', '2026-11-06')])
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ created: 1 })
    expect(psql(`SELECT s.name || ':' || COALESCE(s.imo, '-') FROM public.voyages v JOIN public.vessels s ON s.id = v.vessel_id
      WHERE v.id = ${JSON.parse(result.stdout).voyage_ids[0]};`)).toBe('A235 EPSILON:-')
  })

  it('Viagem cancelada é recusada com mensagem de negócio que a nomeia', () => {
    const cancelled = seedVoyage('A235 THETA', '9235008', '008N', 'cancelled', false)
    const byId = apply([row('A235 THETA', '9235008', '008N', '2026-11-08', Number(cancelled))])
    expect(byId.stderr).toMatch(/Viagem A235 THETA 008N cancelada: a programação dela não muda/)
    const bySearch = apply([row('A235 THETA', '9235008', '008N', '2026-11-08')])
    expect(bySearch.stderr).toMatch(/Viagem A235 THETA 008N cancelada/)
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = '${cancelled}::BRSSA';`)).toBe('0')
  })

  it('mesma Viagem e porto em duas linhas: a última do arquivo é a vigente para quem lê por horário', () => {
    const result = apply([row('A235 IOTA', '9235009', '009N', '2026-11-09'), row('A235 IOTA', '9235009', '009N', '2026-11-10')])
    expect(result.stderr).toBe('')
    const voyageId = JSON.parse(result.stdout).voyage_ids[0]
    expect(psql(`SELECT count(DISTINCT changed_at) FROM public.audit_logs WHERE entity_id = '${voyageId}::BRSSA' AND field_name = 'eta';`)).toBe('2')
    expect(psql(`SELECT new_value FROM public.audit_logs WHERE entity_id = '${voyageId}::BRSSA' AND field_name = 'eta' ORDER BY changed_at DESC LIMIT 1;`)).toBe('2026-11-10')
  })

  it('Viagem existente oculta enviada sem data nova passa a aparecer no Portal', () => {
    const hidden = seedVoyage('A235 KAPPA', '9235010', '010N', 'active', false)
    const result = apply([{ voyage_id: Number(hidden), vessel_name: 'A235 KAPPA', vessel_imo: '9235010', voyage_number: '010N', changes: [] }])
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ created: 0, updated: 1, changes: 0 })
    expect(psql(`SELECT show_on_portal FROM public.voyages WHERE id = ${hidden};`)).toBe('t')
  })

  it('dois arquivos simultâneos da mesma Viagem nova, um com IMO e outro sem, criam um navio e uma Viagem', async () => {
    const asUserPrefix = `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${userId}';`
    const sheet = (imo: string, eta: string) => `SELECT public.apply_schedule_sheet_atomic('${JSON.stringify([row('A235 LAMBDA', imo, '011N', eta)])}'::jsonb, '${carrierName}', '');`
    // O arquivo com IMO grava e segura a transação aberta; o sem IMO chega no meio.
    const withImo = runAsync(`BEGIN; ${asUserPrefix} ${sheet('9235011', '2026-11-11')} SELECT pg_sleep(2); COMMIT;`)
    await sleep(500)
    const withoutImo = runAsync(`${asUserPrefix} ${sheet('', '2026-11-12')}`)
    const [first, second] = await Promise.all([withImo, withoutImo])
    expect(first).toEqual({ code: 0, stderr: '' })
    expect(second).toEqual({ code: 0, stderr: '' })
    expect(psql(`SELECT count(*) || ':' || string_agg(COALESCE(imo, '-'), ',') FROM public.vessels WHERE name = 'A235 LAMBDA';`)).toBe('1:9235011')
    expect(psql(`SELECT count(*) FROM public.voyages v JOIN public.vessels s ON s.id = v.vessel_id WHERE s.name = 'A235 LAMBDA';`)).toBe('1')
  })

  it('dois arquivos com as mesmas Viagens novas em ordens diferentes não se travam mutuamente', async () => {
    const asUserPrefix = `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${userId}';`
    const mu = row('A235 MU', '', '012N', '2026-11-12')
    const nu = row('A235 NU', '', '013N', '2026-11-13')
    const sheet = (rows: unknown[]) => `SELECT public.apply_schedule_sheet_atomic('${JSON.stringify(rows)}'::jsonb, '${carrierName}', '');`
    // Outra sessão segura a trava da Viagem NU. O arquivo [NU, MU] espera por
    // ela; o [MU, NU] chega depois. Pegando as travas na ordem do arquivo, o
    // segundo seguraria MU e esperaria NU enquanto o primeiro, já com NU,
    // esperaria MU.
    const nuKey = `hashtextextended('schedule_voyage:name:A235 NU:013N', 0)`
    const holder = runAsync(`SELECT pg_advisory_lock(${nuKey}); SELECT pg_sleep(1.5); SELECT pg_advisory_unlock(${nuKey});`)
    await sleep(300)
    const reversed = runAsync(`${asUserPrefix} ${sheet([nu, mu])}`)
    await sleep(300)
    const ordered = runAsync(`${asUserPrefix} ${sheet([mu, nu])}`)
    const [held, first, second] = await Promise.all([holder, reversed, ordered])
    expect(held.code).toBe(0)
    expect(first).toEqual({ code: 0, stderr: '' })
    expect(second).toEqual({ code: 0, stderr: '' })
    expect(psql(`SELECT count(*) FROM public.voyages v JOIN public.vessels s ON s.id = v.vessel_id WHERE s.name IN ('A235 MU', 'A235 NU');`)).toBe('2')
  })

  it('navio sem IMO achado pelo nome recebe o IMO, e outra grafia com o mesmo IMO não duplica', () => {
    const result = apply([
      row('A235 XI', '', '014N', '2026-11-14'),
      row('A235 XI', '9235014', '014N', '2026-11-14'),
      row('A235 X1', '9235014', '014N', '2026-11-14'),
    ])
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ created: 1, updated: 2 })
    expect(psql(`SELECT string_agg(name || ':' || COALESCE(imo, '-'), ',') FROM public.vessels WHERE name IN ('A235 XI', 'A235 X1');`)).toBe('A235 XI:9235014')
    expect(psql(`SELECT count(*) FROM public.voyages v JOIN public.vessels s ON s.id = v.vessel_id WHERE s.name IN ('A235 XI', 'A235 X1');`)).toBe('1')
  })
})
