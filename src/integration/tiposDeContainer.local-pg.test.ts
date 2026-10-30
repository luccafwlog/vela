import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 514 (ADR 0112, D28 a D34; lote 0B do plano da repaginação da
// Demurrage): cadastro Tipos de container, grupo de tarifa lido do cadastro e
// uma tarifa por grupo.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regclass('public.container_types') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migrationApplied')

const ADMIN_ID = '05130000-0000-4000-8000-0000000000a1'
const OPS_ID = '05130000-0000-4000-8000-0000000000b1'

function as(userId: string, sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    ROLLBACK;
  `], { encoding: 'utf8' })
}

/** Free time e situação pelas mesmas funções do gatilho de status (211), sem B/L. */
function freeDays(type: string) {
  return psql(`SELECT public._container_free_days('SEM-BL-514', '${type}', current_date);`)
}

function cleanup() {
  psql(`
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
  `)
}

describeLocal('514 — Tipos de container e uma tarifa por grupo', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${ADMIN_ID}', 'adm514@test.local', 'authenticated', 'authenticated'),
        ('${OPS_ID}', 'ops514@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Administrativo 514', 'administrativo', true),
        ('${OPS_ID}', 'Operações 514', 'operacoes', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
    `)
  })

  afterAll(cleanup)

  it('a carga inicial tem os 13 códigos dos B/Ls nos grupos decididos (D30)', () => {
    expect(psql(`SELECT string_agg(code || '=' || rate_group, ',' ORDER BY code) FROM public.container_types
      WHERE code IN ('20GP','20HC','20OT','40HC','40FR','40OT','40FH','40FM','40FP','40FW','40EW','48FR','48FP');`))
      .toBe('20GP=20GP,20HC=20GP,20OT=20FR,40EW=40FR,40FH=40FR,40FM=40FR,40FP=40FR,40FR=40FR,40FW=40FR,40HC=40GP,40OT=40FR,48FP=40FR,48FR=40FR')
    expect(psql(`SELECT count(*) FROM public.container_types
      WHERE code IN ('20GP','20HC','20OT','40HC','40FR','40OT','40FH','40FM','40FP','40FW','40EW','48FR','48FP');`)).toBe('13')
  })

  it('48FR, 40FM e 40FP acham a tarifa de 40\' especial; tipo fora do cadastro não acha nenhuma', () => {
    const special = psql(`SELECT free_days FROM public.demurrage_rates WHERE container_type = '40FR' AND active;`)
    for (const type of ['48FR', '40FM', '40fp ']) expect(freeDays(type)).toBe(special)
    expect(freeDays('45HC')).toBe('')
    // Sem free time, o container nunca entra em atraso (até o lote 1 levá-lo a Travado).
    expect(psql(`SELECT public._container_demurrage_status('SEM-BL-514', '45HC', current_date - 90, NULL, 'COC');`)).toBe('within_free_time')
    expect(psql(`SELECT public._container_demurrage_status('SEM-BL-514', '48FR', current_date - 90, NULL, 'COC');`)).toBe('overdue')
  })

  it('editar a tarifa do grupo 40\' dry muda o cálculo de um 40HC', () => {
    expect(psql(`
      BEGIN;
      UPDATE public.demurrage_rates SET free_days = 5 WHERE container_type = '40GP' AND active;
      SELECT public._container_free_days('SEM-BL-514', '40HC', current_date);
      ROLLBACK;`)).toBe('5')
  })

  it('o banco recusa uma segunda tarifa ativa do mesmo grupo na mesma vigência (D28)', () => {
    expect(() => psql(`
      BEGIN;
      INSERT INTO public.demurrage_rates (container_type, free_days, p1_day_from, p1_day_to, p1_usd, p2_day_from, p2_usd, valid_from)
        VALUES ('40GP', 21, 22, 30, 70, 31, 90, current_date);
      ROLLBACK;`)).toThrow(/demurrage_rates_one_per_group/)
    // Vigência encadeada passa: a atual termina antes da nova.
    expect(() => psql(`
      BEGIN;
      UPDATE public.demurrage_rates SET valid_to = current_date + 9 WHERE container_type = '40GP' AND active;
      INSERT INTO public.demurrage_rates (container_type, free_days, p1_day_from, p1_day_to, p1_usd, p2_day_from, p2_usd, valid_from)
        VALUES ('40GP', 21, 22, 30, 70, 31, 90, current_date + 10);
      ROLLBACK;`)).not.toThrow()
    // Tarifa só para grupo cadastrado.
    expect(() => psql(`
      BEGIN;
      INSERT INTO public.demurrage_rates (container_type, free_days, p1_day_from, p1_day_to, p1_usd, p2_day_from, p2_usd, valid_from)
        VALUES ('45HC', 21, 22, 30, 70, 31, 90, '2099-01-01');
      ROLLBACK;`)).toThrow(/demurrage_rates_container_type_group_fkey/)
  })

  it('o Portal mostra cada grupo com o nome e os códigos, igual à tela do Vela', () => {
    const rates = JSON.parse(psql(`SELECT public._portal_information_core(false)->'demurrage_rates';`)) as Array<{ container_type: string; group_name: string; codes: string[] }>
    expect(rates.map((rate) => rate.container_type)).toEqual(['20GP', '40GP', '20FR', '40FR', '20RF', '40RF'])
    const special = rates.find((rate) => rate.container_type === '40FR')!
    expect(special.group_name).toBe("40' especial")
    expect(special.codes).toEqual(expect.arrayContaining(['48FR', '40FM', '40FP', '40OT']))
  })

  it('qualquer setor inclui e edita tipo; desativar e excluir são do Administrativo (D34)', () => {
    const insert = `INSERT INTO public.container_types (code, description, rate_group) VALUES ('45HC', '45'' high cube', '40GP');`
    expect(as(OPS_ID, `${insert} UPDATE public.container_types SET description = 'x' WHERE code = '45HC';`).status).toBe(0)
    expect(as(OPS_ID, `UPDATE public.container_types SET active = false WHERE code = '40HC';`).stderr)
      .toMatch(/Somente o Administrativo desativa ou reativa tipos de container/)
    expect(as(ADMIN_ID, `UPDATE public.container_types SET active = false WHERE code = '40HC';`).status).toBe(0)
    expect(as(OPS_ID, `DELETE FROM public.container_types WHERE code = '40HC';`).stderr).toMatch(/permission denied/)
    expect(as(OPS_ID, `${insert} SELECT public.delete_catalog_row('container_types', (SELECT id::text FROM public.container_types WHERE code = '45HC'), 'teste');`).stderr)
      .toMatch(/Somente o Administrativo pode excluir/)
    expect(as(ADMIN_ID, `${insert} SELECT public.delete_catalog_row('container_types', (SELECT id::text FROM public.container_types WHERE code = '45HC'), 'teste');`).status).toBe(0)
    // Código repetido e grupo inexistente são recusados.
    expect(as(OPS_ID, `INSERT INTO public.container_types (code, rate_group) VALUES ('40HC', '40GP');`).stderr).toMatch(/container_types_code_key/)
    expect(as(OPS_ID, `INSERT INTO public.container_types (code, rate_group) VALUES ('45HC', 'XXXX');`).stderr).toMatch(/foreign key/)
    expect(as(OPS_ID, `INSERT INTO public.container_types (code, rate_group) VALUES ('45 hc', '40GP');`).stderr).toMatch(/check constraint/)
  })

  it('tipo já usado em B/L não se exclui: desativa', () => {
    expect(() => psql(`
      BEGIN;
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.bls (id, voyage_id, cargo_mode) VALUES ('BL-514-USO', -514, 'container');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES ('BL-514-USO', 'TEST5130001', '48FP');
      SET LOCAL session_replication_role = origin;
      DELETE FROM public.container_types WHERE code = '48FP';
      ROLLBACK;`)).toThrow(/já usado em B\/L: desative em vez de excluir/)
  })

  it('tipo desativado deixa de achar tarifa', () => {
    expect(psql(`
      BEGIN;
      UPDATE public.container_types SET active = false WHERE code = '40HC';
      SELECT coalesce(public._container_free_days('SEM-BL-514', '40HC', current_date)::text, 'sem');
      ROLLBACK;`)).toBe('sem')
  })
})
