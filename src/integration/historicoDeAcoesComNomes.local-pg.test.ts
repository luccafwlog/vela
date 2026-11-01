import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 558: o Histórico de ações (Administração) lê autor, registro e
// valores pelo nome (RPC `admin_action_history`), nunca pelo número interno.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN_ID = '55855800-0000-4000-8000-000000000001'
const OPERATOR_ID = '55855800-0000-4000-8000-000000000002'
const PORTAL_ID = '55855800-0000-4000-8000-000000000003'
const CARRIER_ID = 99558001
const VESSEL_A = 99558002
const VESSEL_B = 99558003
const VOYAGE_ID = 99558004
const CUSTOMER_ID = 99558011
const GONE_CUSTOMER_ID = 99558012
const PORTAL_ACCOUNT_ID = 99558021
const DAY = '2031-05-08'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function asUser(userId: string, sql: string): { output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-F', '|', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${userId}';
     SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

/** Linhas do dia do teste, já com os nomes, na ordem da tela. */
function history(filters = ''): string[] {
  const result = asUser(ADMIN_ID, `SELECT action, actor_kind, coalesce(actor_name, '-'), coalesce(actor_email, '-'),
      coalesce(entity_label, '-'), coalesce(old_label, '-'), coalesce(new_label, '-'), coalesce(value_labels::text, '-')
    FROM public.admin_action_history(p_date_from => '${DAY}', p_date_to => '${DAY}'${filters})`)
  expect(result.error).toBe('')
  return result.output ? result.output.split('\n') : []
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_at::date BETWEEN '${DAY}'::date - 1 AND '${DAY}'::date + 1;
    DELETE FROM public.customer_portal_accounts WHERE id = ${PORTAL_ACCOUNT_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id IN (${VESSEL_A}, ${VESSEL_B});
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.customers WHERE id IN (${CUSTOMER_ID}, ${GONE_CUSTOMER_ID});
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${OPERATOR_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${OPERATOR_ID}', '${PORTAL_ID}');
    SET session_replication_role = origin;
  `)
}

function migration558Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'admin_action_history';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration558Applied, 'migration558Applied (Histórico de ações com nomes)')

describeLocal('558 — Histórico de ações com nomes, não números', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ADMIN_ID}', 'admin-558@example.test'),
        ('${OPERATOR_ID}', 'operacoes-558@example.test'),
        ('${PORTAL_ID}', 'portal-558@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Ana Administrativo 558', 'administrativo', true),
        ('${OPERATOR_ID}', 'Otávio Operações 558', 'operacoes', true);
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador 558');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES
        (${VESSEL_A}, 'Rio de Janeiro 558', ${CARRIER_ID}),
        (${VESSEL_B}, 'Santos 558', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_B}, 'V558', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES
        (${CUSTOMER_ID}, 'CLIENTE 558 LTDA', '${syntheticCnpj(558011)}');
      INSERT INTO public.customer_portal_accounts (id, customer_id, auth_user_id, active)
        VALUES (${PORTAL_ACCOUNT_ID}, ${CUSTOMER_ID}, '${PORTAL_ID}', true);
      -- Rastro do dia, como os gatilhos e as funções gravam:
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification) VALUES
        -- troca do navio da Viagem, pela equipe
        ('voyages', '${VOYAGE_ID}', 'vessel_id', '${VESSEL_A}', '${VESSEL_B}', '${OPERATOR_ID}', '${DAY} 10:00-03', NULL),
        -- agenda do POD (chave viagem::PORTO), com justificativa
        ('voyage_pod_schedule', '${VOYAGE_ID}::BRSSZ', 'eta', '2031-05-01', '2031-05-03', '${OPERATOR_ID}', '${DAY} 10:05-03', 'Atraso no porto anterior'),
        -- Cliente apagado: o nome vem do JSON da exclusão
        ('customers', '${GONE_CUSTOMER_ID}', 'excluido', '{"id": ${GONE_CUSTOMER_ID}, "name": "CLIENTE APAGADO 558"}', NULL, '${ADMIN_ID}', '${DAY} 11:00-03', 'Cadastro duplicado'),
        -- Navio criado: o Armador do JSON pelo nome
        ('vessels', '${VESSEL_A}', 'criado', NULL, '{"id": ${VESSEL_A}, "name": "Rio de Janeiro 558", "carrier_id": ${CARRIER_ID}}', NULL, '${DAY} 12:00-03', NULL),
        -- endereço mudado pelo Cliente no Portal
        ('customers', '${CUSTOMER_ID}', 'city', 'Santos', 'Vitória', '${PORTAL_ID}', '${DAY} 13:00-03', NULL);
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('fora do Administrativo, recusa', () => {
    const result = asUser(OPERATOR_ID, `SELECT count(*) FROM public.admin_action_history()`)
    expect(result.error).toMatch(/Somente o Administrativo/)
  })

  it('cada linha traz autor, registro e valores pelo nome', () => {
    expect(history()).toEqual([
      'alterou|portal|Cliente pelo Portal: CLIENTE 558 LTDA|portal-558@example.test|CLIENTE 558 LTDA|-|-|-',
      'criou|sistema|-|-|Rio de Janeiro 558|-|-|{"carrier_id": "Armador 558"}',
      'excluiu|equipe|Ana Administrativo 558|admin-558@example.test|CLIENTE APAGADO 558|-|-|-',
      'alterou|equipe|Otávio Operações 558|operacoes-558@example.test|Santos 558 / V558 · BRSSZ|-|-|-',
      'alterou|equipe|Otávio Operações 558|operacoes-558@example.test|Santos 558 / V558|Rio de Janeiro 558|Santos 558|-',
    ])
  })

  it('a justificativa gravada vem na linha', () => {
    const result = asUser(ADMIN_ID, `SELECT justification FROM public.admin_action_history(p_date_from => '${DAY}', p_date_to => '${DAY}') WHERE justification IS NOT NULL ORDER BY changed_at`)
    expect(result.output.split('\n')).toEqual(['Atraso no porto anterior', 'Cadastro duplicado'])
  })

  it('filtra por ação, por Sistema e pelo Portal, com o total da busca', () => {
    expect(history(`, p_action => 'excluiu'`)).toHaveLength(1)
    expect(history(`, p_actor => 'sistema'`)).toHaveLength(1)
    expect(history(`, p_actor => 'portal'`)).toHaveLength(1)
    expect(history(`, p_actor => '${OPERATOR_ID}', p_action => 'alterou'`)).toHaveLength(2)
    const total = asUser(ADMIN_ID, `SELECT DISTINCT total_count FROM public.admin_action_history(p_date_from => '${DAY}', p_date_to => '${DAY}', p_limit => 2)`)
    expect(total.output).toBe('5')
  })

  it('recusa filtro de ação ou autor desconhecido', () => {
    expect(asUser(ADMIN_ID, `SELECT count(*) FROM public.admin_action_history(p_action => 'apagou')`).error).toMatch(/Ação desconhecida/)
    expect(asUser(ADMIN_ID, `SELECT count(*) FROM public.admin_action_history(p_actor => '37')`).error).toMatch(/Autor desconhecido/)
  })
})
