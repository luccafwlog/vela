import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
const migration308 = fs.readFileSync(path.join(migrationsDir, '308_restore_omit_voyage_escala.sql'), 'utf8').toLowerCase()
const migration309 = fs.readFileSync(path.join(migrationsDir, '309_revert_voyage_omission.sql'), 'utf8').toLowerCase()
const migration316 = fs.readFileSync(path.join(migrationsDir, '316_drop_dead_bl_transshipment_columns.sql'), 'utf8').toLowerCase()

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function getFunctionDefinition(signature: string) {
  return psql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`)
}

function compact(definition: string) {
  return definition
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    // pg_get_functiondef may serialize typed NULL defaults explicitly.
    .replace(/default null::(?:text|timestamp with time zone)/gi, 'default null')
    .toLowerCase()
}

describeLocal('contrato SQL das definições finais das RPCs de omissão', () => {
  let omitVoyageEscala: string
  let setBlCod: string
  let setBlTransshipment: string
  let updateVoyageOmission: string

  beforeAll(() => {
    // A definição final é a evidência do P0-3. Um scanner textual das migrations
    // é apenas rede secundária: fica cego a reescritas por DO/pg_get_functiondef
    // e não enxerga grants efetivos.
    omitVoyageEscala = getFunctionDefinition('public.omit_voyage_escala(bigint,text,text,text,uuid,text,text,text,timestamptz,timestamptz)')
    setBlCod = getFunctionDefinition('public.set_bl_cod(text,bigint,text,uuid)')
    setBlTransshipment = getFunctionDefinition('public.set_bl_transshipment(text,bigint,text,uuid)')
    updateVoyageOmission = getFunctionDefinition('public.update_voyage_omission(bigint,text,text,text,timestamptz,timestamptz,text,uuid)')
  })

  it('consulta a assinatura final e preserva o contrato global da omissão', () => {
    const definition = compact(omitVoyageEscala)

    expect(definition).toContain('create or replace function public.omit_voyage_escala(')
    expect(definition).toContain('p_onward_vessel_name text default null')
    expect(definition).toContain('p_onward_carrier text default null')
    expect(definition).toContain('p_onward_voyage_number text default null')
    expect(definition).toContain('p_onward_etd timestamp with time zone default null')
    expect(definition).toContain('p_onward_eta timestamp with time zone default null')
    expect(definition).toContain('insert into public.voyage_omissions(voyage_id, omitted_pod, discharge_pod, reason, omitted_by, onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta)')
    expect(definition).toContain("nullif(btrim(coalesce(p_onward_vessel_name, '')), '')")
    expect(definition).toContain("nullif(btrim(coalesce(p_onward_carrier, '')), '')")
    expect(definition).toContain("nullif(btrim(coalesce(p_onward_voyage_number, '')), '')")
    expect(definition).toContain('p_onward_etd')
    expect(definition).toContain('p_onward_eta')
    expect(definition).toContain('perform 1 from public.voyages where id = p_voyage_id for update')
    expect(definition).toContain('exception when unique_violation')
    expect(definition).toContain("v_constraint = 'voyage_omissions_voyage_id_omitted_pod_key'")
    expect(definition).toContain("raise exception 'a escala da viagem % ja foi omitida para o pod %.'")
    expect(definition).not.toContain('on conflict (voyage_id, omitted_pod) do update')
    expect(migration308).toContain('onward_vessel_name = excluded.onward_vessel_name')
    expect(migration308).toContain('onward_carrier = excluded.onward_carrier')
    expect(migration308).toContain('onward_voyage_number = excluded.onward_voyage_number')
    expect(migration308).toContain('onward_etd = excluded.onward_etd')
    expect(migration308).toContain('onward_eta = excluded.onward_eta')
    expect(migration309).toContain("nullif(btrim(coalesce(p_onward_vessel_name, '')), '')")
    expect(migration309).toContain("nullif(btrim(coalesce(p_onward_carrier, '')), '')")
    expect(migration309).toContain("nullif(btrim(coalesce(p_onward_voyage_number, '')), '')")
    expect(migration309).toContain('p_onward_etd')
    expect(migration309).toContain('p_onward_eta')
    expect(definition).not.toContain('v_omitted = v_discharge')
    expect(definition).toContain('insert into public.portal_notifications(customer_id, bl_id, type, title, message, link)')
  })

  it('consulta as definições finais de COD e transbordo com justificativa auditada', () => {
    const cod = compact(setBlCod)
    const transshipment = compact(setBlTransshipment)

    expect(cod).toContain('if auth.uid() is null or not public.is_active_user() or p_changed_by is distinct from auth.uid() then')
    expect(cod).toContain('p_justification text')
    expect(cod).toContain('marcar cod exige justificativa.')
    expect(cod).not.toContain('can_edit_voyages()')
    expect(cod).toContain("disposition = 'cod'")
    expect(cod).not.toContain('onward_vessel_name')
    expect(cod).not.toContain('onward_carrier')
    expect(cod).toContain('update public.bls set pod = v_discharge')
    expect(cod).toContain('select pod, customer_id, terminal_id, pod_port_id into v_old_pod, v_customer, v_old_terminal, v_old_pod_port_id from public.bls where id = p_bl_id for update')
    expect(cod).toContain('insert into public.portal_notifications(customer_id, bl_id, type, title, message, link)')
    expect(cod).toContain('to_regprocedure(\'public.apply_cod_financial_effect(text,bigint,text)\')')

    expect(transshipment).toContain('if auth.uid() is null or not public.is_active_user() or p_changed_by is distinct from auth.uid() then')
    expect(transshipment).toContain('p_justification text')
    expect(transshipment).not.toContain('can_edit_voyages()')
    expect(transshipment).toContain("disposition = 'transshipment'")
    expect(transshipment).not.toContain('p_onward_')
    expect(transshipment).toContain('set disposition = \'transshipment\', updated_at = now()')
    expect(transshipment).toContain('update public.bls set pod = v_original_pod')
    expect(transshipment).toContain('select pod, customer_id into v_old_pod, v_customer from public.bls where id = p_bl_id for update')
    expect(transshipment).toContain("'reversao de cod para transbordo: ' || v_justification")
    expect(transshipment).toContain("'correção de destino (cod)'")
  })

  it('consulta a definição final da complementação global sem notificar o Portal', () => {
    const definition = compact(updateVoyageOmission)

    expect(definition).toContain('if auth.uid() is null or not public.is_active_user() or p_changed_by is distinct from auth.uid() then')
    expect(definition).not.toContain('can_edit_voyages()')
    expect(definition).toContain('v_new_vessel := nullif(btrim(coalesce(p_onward_vessel_name, \'\')), \'\')')
    expect(definition).toContain('v_new_carrier := nullif(btrim(coalesce(p_onward_carrier, \'\')), \'\')')
    expect(definition).toContain('v_new_voyage := nullif(btrim(coalesce(p_onward_voyage_number, \'\')), \'\')')
    expect(definition).toContain('v_new_etd := p_onward_etd')
    expect(definition).toContain('v_new_eta := p_onward_eta')
    expect(definition).toContain("values ('voyage', v_old.voyage_id::text, 'transshipment_info'")
    expect(definition).toContain("select 'bls', bt.bl_id, 'transshipment_info'")
    expect(definition).not.toContain('portal_notifications')
  })

  it('mantém os grants finais das quatro RPCs no banco', () => {
    const signatures = [
      'public.omit_voyage_escala(bigint,text,text,text,uuid,text,text,text,timestamptz,timestamptz)',
      'public.set_bl_cod(text,bigint,text,uuid)',
      'public.set_bl_transshipment(text,bigint,text,uuid)',
      'public.update_voyage_omission(bigint,text,text,text,timestamptz,timestamptz,text,uuid)',
    ]

    for (const signature of signatures) {
      expect(psql(`SELECT has_function_privilege('authenticated', '${signature}', 'EXECUTE');`)).toBe('t')
      expect(psql(`SELECT has_function_privilege('anon', '${signature}', 'EXECUTE');`)).toBe('f')
    }
  })

  it('confirma no catálogo que can_edit_voyages não existe após o replay', () => {
    expect(psql(`
      SELECT NOT EXISTS (
        SELECT 1
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'can_edit_voyages'
      );
    `)).toBe('t')
  })

  it('confirma que os dados de transbordo não vivem mais no vínculo B/L', () => {
    expect(migration316).toContain('drop column if exists onward_vessel_name')
    expect(migration316).toContain('drop column if exists onward_eta')
    expect(setBlTransshipment).not.toContain('onward_vessel_name')
  })

  it('confirma no catálogo que a omissão do mesmo POD é permitida', () => {
    expect(psql(`
      SELECT NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS c
        JOIN pg_class AS r ON r.oid = c.conrelid
        JOIN pg_namespace AS n ON n.oid = r.relnamespace
        WHERE n.nspname = 'public'
          AND r.relname = 'voyage_omissions'
          AND c.contype = 'c'
          AND regexp_replace(lower(pg_get_constraintdef(c.oid)), '[[:space:]]', '', 'g') =
            'check((upper(btrim(omitted_pod))<>upper(btrim(discharge_pod))))'
      );
    `)).toBe('t')
  })
})
