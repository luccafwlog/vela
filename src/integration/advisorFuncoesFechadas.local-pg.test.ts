import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 320 (advisor do Supabase de 19/10/2026, ADR 0090): nenhuma função
// do projeto executável por `anon`, trigger fora do alcance dos clientes,
// `search_path` fixo em toda função (menos quatro SQL de volume, nomeadas
// abaixo) e índice nas FKs de B/L, faturas e Demurrage. Varre o catálogo inteiro, não a lista da 320: função nova que
// nascer aberta ou sem `search_path` derruba esta suíte no CI, antes do advisor.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

// `sub` simula a sessão do Supabase: auth.uid() e auth.jwt() leem estes claims.
function asRole(role: 'anon' | 'authenticated', sql: string, sub?: string): { output: string; error: string } {
  const claims = sub
    ? `SET LOCAL request.jwt.claims = '${JSON.stringify({ sub, role, iat: Math.floor(Date.now() / 1000) })}';`
    : ''
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE ${role}; ${claims} ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function lines(output: string): string[] {
  return output === '' ? [] : output.split('\n')
}

// Funções do projeto: schemas próprios, sem as de extensão (pg_trgm e
// btree_gist vivem em `public`, mas não são nossas).
const PROJECT_FUNCTIONS = `
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'ce_unlock_private', 'ops')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
    )`

// Sem `SET search_path` por desempenho (bloco 2 da migration 320): rodam linha
// a linha em listas de B/L, importações e fila de efeitos. Chamada de prova
// para conferir no plano que continuam expandidas inline.
const INLINE_SEM_SEARCH_PATH: ReadonlyArray<readonly [string, string]> = [
  ['public._import_effect_priority(text)', 'public._import_effect_priority(v.x)'],
  ['public.bl_cargo_mode_matches_filter(text,text)', "public.bl_cargo_mode_matches_filter(v.x, 'container')"],
  ['public.bl_operation_front_modalidade(text)', 'public.bl_operation_front_modalidade(v.x)'],
  ['public.normalize_port_code(text)', 'public.normalize_port_code(v.x)'],
]

function migration320Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_invoices_replaced_by_invoice_id';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration320Applied, 'migration320Applied (advisor: funções fechadas e índices de FK)')

describeLocal('320 — funções fechadas, search_path fixo e índices de FK', () => {
  it('nenhuma função do projeto é executável por anon, salvo a checagem que o PostgREST roda antes da requisição', () => {
    // ADR 0097: o PostgREST chama `pgrst.db_pre_request` com o papel da
    // requisição, inclusive `anon`; sem sessão a função não faz nada.
    expect(lines(psql(`SELECT p.oid::regprocedure ${PROJECT_FUNCTIONS}
      AND has_function_privilege('anon', p.oid, 'EXECUTE') ORDER BY 1;`)))
      .toEqual(psql(`SELECT to_regprocedure('public.check_internal_token_cutoff()') IS NOT NULL;`) === 't'
        ? ['check_internal_token_cutoff()']
        : [])
  })

  it('função de trigger não é executável por PUBLIC, anon nem authenticated', () => {
    expect(lines(psql(`SELECT p.oid::regprocedure ${PROJECT_FUNCTIONS}
      AND p.prorettype IN ('trigger'::regtype, 'event_trigger'::regtype)
      AND (has_function_privilege('public', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      ORDER BY 1;`))).toEqual([])
  })

  it('programação de navios só com sessão: anon recebe 42501, authenticated tem EXECUTE', () => {
    const anon = asRole('anon', 'SELECT count(*) FROM public.portal_ship_schedule()')
    expect(anon.error).toMatch(/permission denied for function portal_ship_schedule/)
    // Quem lê, além do grant, é decidido pela guarda da migration 337 (abaixo).
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.portal_ship_schedule()', 'EXECUTE');`)).toBe('t')
  })

  it('função criada agora nasce sem EXECUTE para PUBLIC, anon e authenticated', () => {
    // execPsql termina a chamada com ROLLBACK: a função de prova não fica no banco.
    const privileges = psql(`BEGIN;
      CREATE FUNCTION public.advisor_320_probe() RETURNS integer LANGUAGE sql SET search_path = '' AS 'SELECT 1';
      CREATE FUNCTION ce_unlock_private.advisor_320_probe() RETURNS integer LANGUAGE sql SET search_path = '' AS 'SELECT 1';
      SELECT string_agg(format('%s %s', role, fn), ',' ORDER BY fn, role)
      FROM unnest(ARRAY['public.advisor_320_probe()', 'ce_unlock_private.advisor_320_probe()']) fn,
           unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) role
      WHERE has_function_privilege(role, fn, 'EXECUTE');`)
    // service_role segue o default do schema `public` (é por ele que as Edge
    // Functions chamam RPC sem grant explícito); os três clientes ficam fora.
    expect(privileges.split(',').filter((grant) => !grant.startsWith('service_role '))).toEqual([''])
  })

  it('toda função do projeto fixa search_path, menos as quatro SQL de volume', () => {
    expect(lines(psql(`SELECT p.oid::regprocedure ${PROJECT_FUNCTIONS}
      AND p.prokind IN ('f', 'p')
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
      ORDER BY 1;`)).sort()).toEqual(INLINE_SEM_SEARCH_PATH.map(([signature]) => signature.replace('public.', '')).sort())
  })

  it('as quatro de volume seguem SQL simples, sem DEFINER e expandidas inline', () => {
    // A exceção só se justifica enquanto o planejador cola a função na
    // consulta (decisão do responsável em 19/10/2026, PR 975): com SET, ou
    // virando plpgsql/DEFINER, ela volta a ser chamada linha a linha.
    for (const [signature, call] of INLINE_SEM_SEARCH_PATH) {
      expect(psql(`SELECT l.lanname || ':' || p.prosecdef FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = '${signature}'::regprocedure;`)).toBe('sql:false')
      // Entrada variável: com constante o planejador calcula a função antes e o
      // plano não mostra a diferença.
      const plan = psql(`EXPLAIN (VERBOSE, COSTS OFF) SELECT ${call} FROM (SELECT 'misto' || g AS x FROM generate_series(1, 2) g) AS v;`)
      expect(plan).not.toContain(signature.split('(')[0].replace('public.', ''))
    }
  })

  it('search_path vazio não muda o resultado das funções puras', () => {
    // Um search_path hostil do chamador não alcança mais o corpo.
    expect(psql(`SET search_path = pg_temp, public;
      SELECT concat_ws('|',
        public.normalize_ncm_codes('["5509.12", "x"]')::text,
        public.agency_report_section_owner('veiculos'),
        public._demurrage_roe_from_ptax(5),
        public.agency_report_alert_entity_id(1, 'brssz', NULL, 'x'),
        public.agency_report_deadline_date('2026-10-16'),
        ce_unlock_private.sla_deadline('2026-10-17 15:00-03') AT TIME ZONE 'America/Sao_Paulo');`))
      .toBe('{550912}|equipamentos|5.3250|1::BRSSZ::x|2026-10-21|2026-10-19 12:00:00')
  })

  it('FK de B/L, faturas e Demurrage tem índice que começa pelas suas colunas', () => {
    expect(lines(psql(`
      SELECT c.conrelid::regclass || '.' || c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE c.contype = 'f'
        AND t.relnamespace = 'public'::regnamespace
        AND t.relname ~ '^(bls|bl_.*|invoices|invoice_.*|demurrage_.*)$'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid AND i.indisvalid
            AND (string_to_array(i.indkey::text, ' ')::smallint[])[1:array_length(c.conkey, 1)] = c.conkey
        )
      ORDER BY 1;`))).toEqual([])
  })
})

// Migration 337 (auditoria defensiva de 2026-10-19, ADR 0090): EXECUTE para
// `authenticated` não basta. Com o cadastro do Auth aberto, qualquer pessoa
// tinha conta `authenticated` sem perfil interno nem conta do Portal.
const INTERNAL_ACTIVE = '33700000-0000-4000-8000-000000000001'
const INTERNAL_INACTIVE = '33700000-0000-4000-8000-000000000002'
const PORTAL_ACTIVE = '33700000-0000-4000-8000-000000000003'
const PORTAL_REVOKED = '33700000-0000-4000-8000-000000000004'
const NO_PROFILE = '33700000-0000-4000-8000-000000000005'
const CUSTOMER_ACTIVE = 99337001
const CUSTOMER_REVOKED = 99337002
const CARRIER_ID = 99337011
const VESSEL_ID = 99337021
const VOYAGE_ID = 99337031

function cleanupSchedule() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_type IN ('voyage_pol_schedule', 'voyage_pod_schedule')
      AND entity_id LIKE '${VOYAGE_ID}::%';
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${CUSTOMER_ACTIVE}, ${CUSTOMER_REVOKED});
    DELETE FROM public.customers WHERE id IN (${CUSTOMER_ACTIVE}, ${CUSTOMER_REVOKED});
    DELETE FROM public.user_profiles WHERE id IN ('${INTERNAL_ACTIVE}', '${INTERNAL_INACTIVE}');
    DELETE FROM auth.users WHERE id IN ('${INTERNAL_ACTIVE}', '${INTERNAL_INACTIVE}', '${PORTAL_ACTIVE}', '${PORTAL_REVOKED}', '${NO_PROFILE}');
    SET session_replication_role = origin;
  `)
}

function migration337Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE oid = 'public.portal_ship_schedule()'::regprocedure
      AND prosrc LIKE '%current_portal_customer_id()%';`) === '1'
  } catch {
    return false
  }
}

const describeSchedule = describeWithProbe(migration337Applied, 'migration337Applied (programação de navios exige sessão válida)')

describeSchedule('337 — programação de navios só para sessão interna ativa ou do Portal', () => {
  const SCHEDULE = `SELECT string_agg(concat_ws('|', voyage_id, vessel_name, voyage, port_code, kind, date_value, omitted), ',' ORDER BY kind, port_code)
    FROM public.portal_ship_schedule() WHERE voyage_id = ${VOYAGE_ID}`
  const EXPECTED = `${VOYAGE_ID}|Navio S337|S337V|BRSSZ|pod|2026-11-02|f,${VOYAGE_ID}|Navio S337|S337V|CNSHA|pol|2026-10-01|f`

  beforeAll(() => {
    cleanupSchedule()
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${INTERNAL_ACTIVE}', 'interno-s337@example.test'), ('${INTERNAL_INACTIVE}', 'inativo-s337@example.test'),
        ('${PORTAL_ACTIVE}', 'portal-s337@example.test'), ('${PORTAL_REVOKED}', 'revogado-s337@example.test'),
        ('${NO_PROFILE}', 'cadastro-aberto-s337@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${INTERNAL_ACTIVE}', 'Interno S337', 'documentacao', true),
        ('${INTERNAL_INACTIVE}', 'Inativo S337', 'documentacao', false);
      SET session_replication_role = replica;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES
        (${CUSTOMER_ACTIVE}, 'CLIENTE S337', '${syntheticCnpj(337001)}'),
        (${CUSTOMER_REVOKED}, 'CLIENTE S337 REVOGADO', '${syntheticCnpj(337002)}');
      INSERT INTO public.customer_portal_accounts (customer_id, auth_user_id, active, account_situation, credentials_revoked_at) VALUES
        (${CUSTOMER_ACTIVE}, '${PORTAL_ACTIVE}', true, 'ativo', NULL),
        (${CUSTOMER_REVOKED}, '${PORTAL_REVOKED}', true, 'ativo', now() + interval '1 hour');
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador S337');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio S337', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status, show_on_portal) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'S337V', 'active', true);
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value) VALUES
        ('voyage_pol_schedule', '${VOYAGE_ID}::CNSHA', 'etd', '2026-10-01'),
        ('voyage_pod_schedule', '${VOYAGE_ID}::BRSSZ', 'eta', '2026-11-02');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanupSchedule)

  it('conta authenticated sem perfil interno nem conta do Portal é recusada', () => {
    const semConta = asRole('authenticated', SCHEDULE, NO_PROFILE)
    expect(semConta.error).toMatch(/Sessao do portal invalida ou expirada/)
    expect(semConta.output).toBe('')
    const semSessao = asRole('authenticated', SCHEDULE)
    expect(semSessao.error).toMatch(/Sessao do portal invalida ou expirada/)
  })

  it('usuário interno inativo e credencial do Portal revogada são recusados', () => {
    expect(asRole('authenticated', SCHEDULE, INTERNAL_INACTIVE).error).toMatch(/Sessao do portal invalida ou expirada/)
    expect(asRole('authenticated', SCHEDULE, PORTAL_REVOKED).error).toMatch(/Sessao do portal invalida ou expirada/)
  })

  it('sessão interna ativa e sessão do Portal leem a mesma programação', () => {
    const interna = asRole('authenticated', SCHEDULE, INTERNAL_ACTIVE)
    expect(interna.error).toBe('')
    expect(interna.output).toBe(EXPECTED)
    const portal = asRole('authenticated', SCHEDULE, PORTAL_ACTIVE)
    expect(portal.error).toBe('')
    expect(portal.output).toBe(EXPECTED)
  })
})
