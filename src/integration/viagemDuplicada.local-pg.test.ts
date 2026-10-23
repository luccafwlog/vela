// Migration 413 (revisão manual de 2026-10-22, item A1): navio e número de
// viagem já cadastrados são recusados no banco, qualquer que seja o caminho
// (botão Nova Viagem, Chegadas e Saídas ou API direta).
//
// Namespace exclusivo: ids 99413xxx, navios 'D413 *', usuário ...000413001.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { execPsql, spawnPsql } from './localPsql'
import { describeWithProbe } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000413001'
const carrierId = 99413001
const claims = `SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${actorId}';`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${claims} ${sql}; COMMIT;`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Papel `authenticated`, como a tela grava pela Data API. */
function asUser(sql: string): { output: string; error: string | null } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; ${claims} ${sql}; COMMIT;`], { encoding: 'utf8' })
  const error = run.stderr.split('\n').find((line) => line.startsWith('ERROR:')) ?? null
  return { output: run.stdout.trim(), error: error?.trim() ?? null }
}

function probe(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_trigger WHERE tgname = 'guard_voyage_identity_unique'`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(probe, 'migration 413 aplicada')

function cleanup() {
  psql(`
    SET LOCAL session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}'
      OR (entity_type IN ('voyages', 'vessels') AND entity_id IN (SELECT id::text FROM public.voyages WHERE id BETWEEN 99413100 AND 99413199));
    DELETE FROM public.voyages WHERE id BETWEEN 99413100 AND 99413199 OR vessel_id BETWEEN 99413010 AND 99413019;
    DELETE FROM public.vessels WHERE id BETWEEN 99413010 AND 99413019;
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}'
  `)
}

describeLocal('Viagem duplicada recusada no banco (413)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'd413@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'D413 Operações', 'operacoes', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'D413 Carrier');
      INSERT INTO public.vessels (id, name, imo, carrier_id) VALUES
        (99413010, 'D413 GREEN ITAJAI', '9876543', ${carrierId}),
        -- Cadastro repetido do mesmo navio, sem IMO e com espaços diferentes.
        (99413011, ' d413  green itajai ', NULL, ${carrierId}),
        -- Mesmo nome, outro IMO: outro navio.
        (99413012, 'D413 GREEN ITAJAI', '9000001', ${carrierId}),
        (99413013, 'D413 GREEN SANTOS', NULL, ${carrierId}),
        -- Mesmo IMO do primeiro com outra grafia do nome: o mesmo navio (416).
        (99413014, 'D413 GRN ITAJAY', '987-6543', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (99413100, 99413010, '11', 'active'),
        (99413101, 99413013, '7', 'active')
    `)
  })

  afterAll(cleanup)

  it('o mesmo navio e número é recusado, sem diferença de caixa nem espaços', () => {
    const result = asUser(`INSERT INTO public.voyages (vessel_id, voyage_number, status) VALUES (99413010, ' 11 ', 'active')`)
    expect(result.error).toBe('ERROR:  Já existe a viagem D413 GREEN ITAJAI / 11. Abra a viagem existente em vez de cadastrar outra.')
  })

  it('o cadastro repetido do navio pelo nome também é recusado', () => {
    expect(asUser(`INSERT INTO public.voyages (vessel_id, voyage_number, status) VALUES (99413011, '11', 'active')`).error)
      .toMatch(/Já existe a viagem D413 GREEN ITAJAI \/ 11/)
  })

  it('o mesmo nome com outro IMO é outro navio e passa', () => {
    const result = asUser(`INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99413102, 99413012, '11', 'active') RETURNING id`)
    expect(result.error).toBeNull()
    expect(result.output).toBe('99413102')
  })

  it('416: o mesmo IMO com outra grafia do nome é o mesmo navio e é recusado', () => {
    expect(asUser(`INSERT INTO public.voyages (vessel_id, voyage_number, status) VALUES (99413014, '11', 'active')`).error)
      .toMatch(/Já existe a viagem D413 GREEN ITAJAI \/ 11/)
  })

  it('trocar o número para o de outra viagem do navio é recusado; editar outro campo passa', () => {
    expect(asUser(`UPDATE public.voyages SET voyage_number = '11' WHERE id = 99413101`).error).toBeNull()
    psql(`INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99413103, 99413013, '8', 'active')`)
    expect(asUser(`UPDATE public.voyages SET voyage_number = '11' WHERE id = 99413103`).error)
      .toMatch(/Já existe a viagem D413 GREEN SANTOS \/ 11/)
    expect(asUser(`UPDATE public.voyages SET show_on_portal = true WHERE id = 99413103`).error).toBeNull()
  })

  it('a viagem cancelada conta e a mensagem manda reativar', () => {
    psql(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99413104, 99413013, '9', 'cancelled')
    `)
    expect(asUser(`INSERT INTO public.voyages (vessel_id, voyage_number, status) VALUES (99413013, '9', 'active')`).error)
      .toBe('ERROR:  Já existe a viagem D413 GREEN SANTOS / 9, cancelada. Reative-a em Viagens em vez de cadastrar outra.')
  })

  it('duplicata antiga continua editável no que não é navio nem número', () => {
    psql(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99413105, 99413010, '11', 'active')
    `)
    expect(asUser(`UPDATE public.voyages SET show_on_portal = true WHERE id = 99413105`).error).toBeNull()
  })
})
