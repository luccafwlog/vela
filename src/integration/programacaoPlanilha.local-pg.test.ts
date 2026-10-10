// Etapa 11 do plano de correção das importações (migration 187): a
// Programação por planilha grava numa transação. Viagem nova é criada uma vez
// (duas linhas iguais não duplicam) e uma linha inválida desfaz o arquivo todo.
//
// Namespace exclusivo: navios 'A235 *', IMO 9235xxx, usuário ...0000002350NN.
import { execFileSync, spawnSync } from 'node:child_process'
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

const voyagesOfNamespace = `(SELECT v.id FROM public.voyages v JOIN public.vessels s ON s.id = v.vessel_id WHERE s.name LIKE 'A235 %')`

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by = '${userId}';
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

function apply(rows: unknown[]) {
  return asUser(`SELECT public.apply_schedule_sheet_atomic('${JSON.stringify(rows)}'::jsonb, '${carrierName}', '');`)
}

describeLocal('Programação por planilha atômica (migration 187)', () => {
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
})
