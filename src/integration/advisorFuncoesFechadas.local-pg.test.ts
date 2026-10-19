import { execPsql, spawnPsql } from './localPsql'
import { expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 302 (advisor do Supabase de 19/10/2026, ADR 0090): nenhuma função
// do projeto executável por `anon`, trigger fora do alcance dos clientes,
// `search_path` fixo em toda função e índice nas FKs de B/L, faturas e
// Demurrage. Varre o catálogo inteiro, não a lista da 302: função nova que
// nascer aberta ou sem `search_path` derruba esta suíte no CI, antes do advisor.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function asRole(role: 'anon' | 'authenticated', sql: string): { output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE ${role}; ${sql}; COMMIT;`], { encoding: 'utf8' })
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

function migration302Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_invoices_replaced_by_invoice_id';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration302Applied, 'migration302Applied (advisor: funções fechadas e índices de FK)')

describeLocal('302 — funções fechadas, search_path fixo e índices de FK', () => {
  it('nenhuma função do projeto é executável por anon', () => {
    expect(lines(psql(`SELECT p.oid::regprocedure ${PROJECT_FUNCTIONS}
      AND has_function_privilege('anon', p.oid, 'EXECUTE') ORDER BY 1;`))).toEqual([])
  })

  it('função de trigger não é executável por PUBLIC, anon nem authenticated', () => {
    expect(lines(psql(`SELECT p.oid::regprocedure ${PROJECT_FUNCTIONS}
      AND p.prorettype IN ('trigger'::regtype, 'event_trigger'::regtype)
      AND (has_function_privilege('public', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      ORDER BY 1;`))).toEqual([])
  })

  it('programação de navios só com sessão: anon recebe 42501, authenticated lê', () => {
    const anon = asRole('anon', 'SELECT count(*) FROM public.portal_ship_schedule()')
    expect(anon.error).toMatch(/permission denied for function portal_ship_schedule/)
    const logado = asRole('authenticated', 'SELECT count(*) FROM public.portal_ship_schedule()')
    expect(logado.error).toBe('')
    expect(logado.output).toMatch(/^\d+$/)
  })

  it('função criada agora nasce sem EXECUTE para PUBLIC, anon e authenticated', () => {
    // execPsql termina a chamada com ROLLBACK: a função de prova não fica no banco.
    const privileges = psql(`BEGIN;
      CREATE FUNCTION public.advisor_302_probe() RETURNS integer LANGUAGE sql SET search_path = '' AS 'SELECT 1';
      CREATE FUNCTION ce_unlock_private.advisor_302_probe() RETURNS integer LANGUAGE sql SET search_path = '' AS 'SELECT 1';
      SELECT string_agg(format('%s %s', role, fn), ',' ORDER BY fn, role)
      FROM unnest(ARRAY['public.advisor_302_probe()', 'ce_unlock_private.advisor_302_probe()']) fn,
           unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) role
      WHERE has_function_privilege(role, fn, 'EXECUTE');`)
    // service_role segue o default do schema `public` (é por ele que as Edge
    // Functions chamam RPC sem grant explícito); os três clientes ficam fora.
    expect(privileges.split(',').filter((grant) => !grant.startsWith('service_role '))).toEqual([''])
  })

  it('toda função do projeto fixa search_path', () => {
    expect(lines(psql(`SELECT p.oid::regprocedure ${PROJECT_FUNCTIONS}
      AND p.prokind IN ('f', 'p')
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
      ORDER BY 1;`))).toEqual([])
  })

  it('search_path vazio não muda o resultado das funções puras', () => {
    // Um search_path hostil do chamador não alcança mais o corpo.
    expect(psql(`SET search_path = pg_temp, public;
      SELECT concat_ws('|',
        public.normalize_port_code(' vitória '),
        public.bl_cargo_mode_matches_filter('misto', 'container'),
        public._demurrage_roe_from_ptax(5),
        public.agency_report_alert_entity_id(1, 'brssz', NULL, 'x'),
        public.agency_report_deadline_date('2026-10-16'),
        ce_unlock_private.sla_deadline('2026-10-17 15:00-03') AT TIME ZONE 'America/Sao_Paulo');`))
      .toBe('BRVIX|t|5.3250|1::BRSSZ::x|2026-10-21|2026-10-19 12:00:00')
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
