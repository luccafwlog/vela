import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { execPsql, spawnPsql } from './localPsql'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 440: conta de integração (API ITAÚ) separada das pessoas, e a
// baixa automática do Pix com o papel Financeiro.
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const itauId = '44000000-0000-0000-0000-000000000440'
const personAdminId = '44000000-0000-0000-0000-000000000441'
const documentacaoId = '44000000-0000-0000-0000-000000000442'
const ids = [itauId, personAdminId, documentacaoId]
const idList = ids.map((id) => `'${id}'`).join(', ')
const customerId = 944001
const itauEmail = ' API-Itau-440@Example.Test '

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

// Sessão do navegador: papel authenticated com o usuário no JWT.
function asUser(userId: string, sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN;
    SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated';
    SELECT set_config('request.jwt.claim.sub', '${userId}', true);
    ${sql}
    COMMIT;`], { encoding: 'utf8' })
}

// Só as pessoas da fixture são Administrativas ativas; tudo desfeito no fim.
function withOnlyFixtureAdmins(sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN;
    SET LOCAL session_replication_role = replica;
    UPDATE public.user_profiles SET active = false WHERE role = 'administrativo' AND id NOT IN (${idList});
    SET LOCAL session_replication_role = origin;
    ${sql}
    ROLLBACK;`], { encoding: 'utf8' })
}

const migration = readFileSync('supabase/migrations/440_conta_de_integracao.sql', 'utf8')
const dataStep = migration.slice(migration.indexOf('-- 6 --- Dados'))

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.internal_notifications WHERE recipient_id IN (${idList});
    DELETE FROM public.alert_notification_failures WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE metadata->>'fixture' = 'conta-integracao-440');
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE metadata->>'fixture' = 'conta-integracao-440');
    DELETE FROM public.alert_items WHERE metadata->>'fixture' = 'conta-integracao-440';
    DELETE FROM public.alerts WHERE entity_type = 'conta_integracao_440';
    DELETE FROM public.itau_pix_receipts WHERE end_to_end_id LIKE 'E440%';
    DELETE FROM public.financial_payment_attempts WHERE created_by IN (${idList});
    DELETE FROM public.payments WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.itau_pix_charges WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoices WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.portal_suppressed_emails WHERE email = lower(btrim('${itauEmail}'));
    DELETE FROM public.audit_logs WHERE entity_type = 'user_profile' AND entity_id IN (${idList});
    DELETE FROM public.user_profiles WHERE id IN (${idList});
    DELETE FROM auth.users WHERE id IN (${idList});
    SET session_replication_role = origin;
    UPDATE public.app_settings SET pix_provider = 'static', itau_pix_settlement_actor = NULL WHERE id = 1;
  `)
}

const describeLocal = describeWithProbe(
  () => psql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'account_kind'`) === '1',
  'coluna user_profiles.account_kind (migration 440)',
)

describeLocal('440 — conta de integração (API ITAÚ) — PostgreSQL local', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;
      INSERT INTO auth.users (id, email) VALUES
        ('${itauId}', '${itauEmail}'), ('${personAdminId}', 'pessoa-admin-440@example.test'), ('${documentacaoId}', 'doc-440@example.test');
      -- Como em produção antes da 440: a conta da baixa é Administrativa e não se distingue das pessoas.
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${itauId}', 'API ITAÚ 440', 'administrativo', true),
        ('${personAdminId}', 'Pessoa Administrativa 440', 'administrativo', true),
        ('${documentacaoId}', 'Documentação 440', 'documentacao', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${syntheticCnpj(94401)}', 'Cliente 440');
      UPDATE public.app_settings SET itau_pix_settlement_actor = '${itauId}' WHERE id = 1;
    `)
  })
  afterAll(() => cleanup())

  it('toda conta nasce pessoa e o tipo só aceita pessoa ou integração', () => {
    expect(psql(`SELECT string_agg(DISTINCT account_kind, ',') FROM public.user_profiles WHERE id IN (${idList})`)).toBe('pessoa')
    const invalid = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `BEGIN; UPDATE public.user_profiles SET account_kind = 'robo' WHERE id = '${documentacaoId}'; ROLLBACK;`], { encoding: 'utf8' })
    expect(invalid.stderr).toMatch(/user_profiles_account_kind_check/)
  })

  it('pelo navegador ninguém muda o tipo de conta, nem o Administrativo; nome e setor seguem', () => {
    const own = asUser(documentacaoId, `UPDATE public.user_profiles SET account_kind = 'integracao' WHERE id = '${documentacaoId}';`)
    expect(own.stderr).toMatch(/permission denied for table user_profiles/)
    const byAdmin = asUser(personAdminId, `UPDATE public.user_profiles SET account_kind = 'integracao' WHERE id = '${documentacaoId}';`)
    expect(byAdmin.stderr).toMatch(/permission denied for table user_profiles/)
    const insert = asUser(personAdminId, `INSERT INTO public.user_profiles (id, full_name, role, active, account_kind)
      VALUES ('${documentacaoId}', 'x', 'documentacao', true, 'integracao');`)
    expect(insert.stderr).toMatch(/permission denied for table user_profiles/)
    // O que a tela grava continua liberado (Meu perfil e Editar acesso), desfeito no ROLLBACK.
    const allowed = withOnlyFixtureAdmins(`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated';
      SELECT set_config('request.jwt.claim.sub', '${personAdminId}', true);
      UPDATE public.user_profiles SET full_name = 'Pessoa 440', role = 'administrativo' WHERE id = '${personAdminId}';
      UPDATE public.user_profiles SET role = 'financeiro' WHERE id = '${documentacaoId}';`)
    expect(allowed.stderr).toBe('')
    expect(allowed.status).toBe(0)
    expect(psql(`SELECT account_kind FROM public.user_profiles WHERE id = '${documentacaoId}'`)).toBe('pessoa')
  })

  it('ambiente em que a conta da baixa é o único Administrativo: a migration só suprime o e-mail', () => {
    const result = withOnlyFixtureAdmins(`
      SET LOCAL session_replication_role = replica;
      UPDATE public.user_profiles SET active = false WHERE id = '${personAdminId}';
      SET LOCAL session_replication_role = origin;
      ${dataStep}
      SELECT 'STATE=' || account_kind || '|' || role || '|' || active || '|'
        || (SELECT count(*) FROM public.portal_suppressed_emails WHERE email = 'api-itau-440@example.test')
        FROM public.user_profiles WHERE id = '${itauId}';`)
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('único Administrativo ativo')
    expect(result.stdout).toContain('STATE=pessoa|administrativo|true|1')
  })

  it('a migration marca a conta da baixa como integração, suprime o e-mail e troca o papel para Financeiro, com histórico', () => {
    psql(dataStep)
    expect(psql(`SELECT account_kind || '|' || role || '|' || active FROM public.user_profiles WHERE id = '${itauId}'`)).toBe('integracao|financeiro|true')
    expect(psql(`SELECT email || '|' || reason FROM public.portal_suppressed_emails WHERE email = 'api-itau-440@example.test'`)).toBe('api-itau-440@example.test|bounce_permanente')
    // Mesmo histórico das outras mudanças de acesso (gatilho), com o motivo e autor "Sistema".
    const audit = psql(`SELECT string_agg(field_name || ':' || old_value || '>' || new_value || ':' || coalesce(changed_by::text, 'sistema'), ',' ORDER BY field_name)
      FROM public.audit_logs WHERE entity_type = 'user_profile' AND entity_id = '${itauId}'`)
    expect(audit).toBe('account_kind:pessoa>integracao:sistema,role:administrativo>financeiro:sistema')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'user_profile' AND entity_id = '${itauId}'
      AND justification LIKE 'Conta técnica da baixa automática do Pix (migration 440)%'`)).toBe('2')
    // As outras contas não mudam.
    expect(psql(`SELECT string_agg(account_kind || ':' || role, ',' ORDER BY id) FROM public.user_profiles WHERE id IN ('${personAdminId}', '${documentacaoId}')`))
      .toBe('pessoa:administrativo,pessoa:documentacao')

    // Rodar de novo não duplica supressão nem histórico, e o motivo não vaza para a sessão.
    psql(dataStep)
    expect(psql(`SELECT count(*) FROM public.portal_suppressed_emails WHERE email = 'api-itau-440@example.test'`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'user_profile' AND entity_id = '${itauId}'`)).toBe('2')
  })

  it('admin_list_users devolve o tipo de conta para a badge', () => {
    const result = asUser(personAdminId, `SELECT id || '|' || account_kind || '|' || email_bounced FROM public.admin_list_users() WHERE id IN (${idList}) ORDER BY id;`)
    expect(result.stderr).toBe('')
    // A primeira linha da saída é o set_config da sessão.
    expect(result.stdout.trim().split('\n').filter((line) => line.includes('|'))).toEqual([
      `${itauId}|integracao|true`,
      `${personAdminId}|pessoa|false`,
      `${documentacaoId}|pessoa|false`,
    ])
  })

  it('a conta de integração não conta como último Administrativo ativo', () => {
    // A integração volta a ser Administrativa dentro da transação: mesmo assim a
    // última pessoa Administrativa não é rebaixada nem desativada.
    for (const change of [`role = 'financeiro'`, 'active = false']) {
      const refused = withOnlyFixtureAdmins(`UPDATE public.user_profiles SET role = 'administrativo' WHERE id = '${itauId}';
        UPDATE public.user_profiles SET ${change} WHERE id = '${personAdminId}';`)
      expect(refused.status, change).not.toBe(0)
      expect(refused.stderr, change).toContain('Pessoa Administrativa 440 é o último usuário Administrativo ativo')
    }
    // Nem marcando a última pessoa como integração.
    const marked = withOnlyFixtureAdmins(`UPDATE public.user_profiles SET account_kind = 'integracao' WHERE id = '${personAdminId}';`)
    expect(marked.stderr).toContain('é o último usuário Administrativo ativo')
    // Mudar a própria conta de integração não esbarra na regra.
    const integration = withOnlyFixtureAdmins(`UPDATE public.user_profiles SET role = 'administrativo' WHERE id = '${itauId}';
      UPDATE public.user_profiles SET role = 'financeiro' WHERE id = '${itauId}';
      UPDATE public.user_profiles SET active = false WHERE id = '${itauId}';`)
    expect(integration.stderr).toBe('')
    expect(integration.status).toBe(0)
  })

  it('o sino não entrega aviso à conta de integração, nem no fallback crítico do Administrativo', () => {
    // A integração fica Administrativa e ativa no momento do aviso: quem a tira é
    // o tipo de conta, não o papel. Alerta aberto pelo caminho real, desfeito no fim.
    const recipients = (type: string, setup = '') => {
      const result = withOnlyFixtureAdmins(`
        UPDATE public.user_profiles SET role = 'administrativo' WHERE id = '${itauId}';
        ${setup}
        SET LOCAL request.jwt.claim.role = 'service_role';
        SELECT public.upsert_alert_item('${type}', 'itau_pix_receipt', 'E440ALERTA', 'Aviso de teste 440', 'teste_440',
          '{"fixture": "conta-integracao-440"}'::jsonb, '/alertas') IS NOT NULL;
        SELECT 'RECIPIENTS=' || coalesce(string_agg(DISTINCT n.recipient_id::text, ',' ORDER BY n.recipient_id::text), '')
          FROM public.internal_notifications n JOIN public.alert_items i ON i.id = n.alert_item_id
          WHERE i.metadata->>'fixture' = 'conta-integracao-440' AND n.recipient_id IN (${idList});`)
      expect(result.stderr).toBe('')
      return result.stdout.split('\n').find((line) => line.startsWith('RECIPIENTS='))?.slice('RECIPIENTS='.length)
    }
    // Audiência com Administrativo, Financeiro e Documentação: as duas pessoas, sem a integração.
    expect(recipients('pix_unreconciled')).toBe([personAdminId, documentacaoId].sort().join(','))
    // Crítico só de Documentação, sem ninguém dela ativo: cai no fallback Administrativo, só na pessoa.
    expect(recipients('billing_auto_issue_failed', `SET LOCAL session_replication_role = replica;
      UPDATE public.user_profiles SET active = false WHERE role IN ('documentacao', 'operator');
      SET LOCAL session_replication_role = origin;`)).toBe(personAdminId)
  })

  it('o Eco da dispensa não vai à conta de integração avisada antes da 440 (441)', () => {
    const result = withOnlyFixtureAdmins(`
      SET LOCAL request.jwt.claim.role = 'service_role';
      SELECT public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', 'E440ECO', 'Aviso de teste 440', 'teste_440',
        '{"fixture": "conta-integracao-440"}'::jsonb, '/alertas') IS NOT NULL;
      -- Como antes da 440: a ocorrência também foi entregue à conta de integração.
      INSERT INTO public.internal_notifications (alert_id, alert_item_id, event_id, recipient_id, recipient_department,
          is_fallback, item_type, severity, title, message)
        SELECT n.alert_id, n.alert_item_id, n.event_id, '${itauId}', 'administrativo', false, n.item_type, n.severity, n.title, n.message
        FROM public.internal_notifications n JOIN public.alert_items i ON i.id = n.alert_item_id
        WHERE i.metadata->>'fixture' = 'conta-integracao-440' AND n.recipient_id = '${personAdminId}';
      SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated';
      SELECT set_config('request.jwt.claim.sub', '${documentacaoId}', true);
      SELECT public.dismiss_alert_item(i.id, 'Teste do eco 440', now() + interval '2 days') IS NOT NULL
        FROM public.alert_items i WHERE i.metadata->>'fixture' = 'conta-integracao-440';
      RESET ROLE;
      SELECT 'ECHO=' || coalesce(string_agg(n.recipient_id::text, ',' ORDER BY n.recipient_id::text), '')
        FROM public.internal_notifications n JOIN public.alert_items i ON i.id = n.alert_item_id
        WHERE i.metadata->>'fixture' = 'conta-integracao-440' AND n.payload->>'is_echo' = 'true' AND n.recipient_id IN (${idList});`)
    expect(result.stderr).toBe('')
    expect(result.stdout.split('\n').find((line) => line.startsWith('ECHO='))).toBe(`ECHO=${personAdminId}`)
  })

  it('a baixa automática do Pix de centavos funciona com a conta de integração Financeiro', () => {
    expect(psql(`SELECT role || '|' || account_kind FROM public.user_profiles WHERE id = '${itauId}'`)).toBe('financeiro|integracao')
    psql(`UPDATE public.app_settings SET pix_provider = 'itau', itau_pix_settlement_actor = '${itauId}' WHERE id = 1`)
    const invoiceId = psql(`INSERT INTO public.invoices(invoice_number, customer_id, total_brl, balance_brl, invoice_type, status)
      VALUES ('ITAU440-AV', ${customerId}, 0.01, 0.01, 'manual', 'issued') RETURNING id`)
    const [chargeId, txid] = psql(`SELECT id || '|' || txid FROM public.itau_pix_charges WHERE invoice_id = ${invoiceId} AND status = 'pending_create'`).split('|')
    psql(`SELECT public.itau_pix_claim(100); SELECT public.itau_pix_record(${chargeId}, 'active', 0, '000201ITAU440', NULL, now())`)

    // Como a Edge Function itau-pix: papel service_role.
    expect(psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_settle('E440CENTAVOS', '${txid}', 0.01, now())`)).toBe('settled')
    expect(psql(`SELECT status || '|' || balance_brl FROM public.invoices WHERE id = ${invoiceId}`)).toBe('paid|0.00')
    // "Registrado por: API Itaú" segue o mesmo id.
    expect(psql(`SELECT count(*) || '|' || max(registered_by::text) || '|' || max(bank_reference) FROM public.payments WHERE invoice_id = ${invoiceId}`))
      .toBe(`1|${itauId}|E440CENTAVOS`)
    expect(psql(`SELECT count(*) FROM public.financial_payment_attempts WHERE created_by = '${itauId}'`)).toBe('1')
    expect(psql(`SELECT status FROM public.itau_pix_receipts WHERE end_to_end_id = 'E440CENTAVOS'`)).toBe('settled')
  })
})
