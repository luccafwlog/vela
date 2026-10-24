import { spawn } from 'node:child_process'
import { execPsql, spawnPsql } from './localPsql'
import { expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 447: os e-mails automáticos saem pelo evento. O banco dispara a
// Edge Function da rotina (`ops.kick_edge_job`) com o segredo dedicado e
// `{"source":"trigger"}`, uma vez por transação e no máximo uma vez por
// intervalo; a fila do Desbloqueio de CE reserva as linhas para o gatilho e o
// cron não pegarem a mesma; a produtora dos Comunicados avalia os pendentes
// uma vez por alvo. Tudo roda em transação desfeita, salvo a reserva
// concorrente, que precisa de duas sessões e limpa o que gravou.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CUSTOMER = 447001
const CARRIER = 447001
const VESSEL = 447001
const VOYAGE = 447001
const PORTAL_USER = '44700000-0000-4000-8000-000000000001'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl], {
    input: sql,
    encoding: 'utf8',
  }).trim()
}

function lines(out: string): string[] {
  return out.split('\n').filter((line) => line !== '')
}

function migrationApplied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('ops.kick_edge_job(text,text,text,text,interval)') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_kick_ce_unlock_notify_email');`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migrationApplied (447: disparo pelo evento)')

// net.http_post de captura, só nesta transação: guarda URL, cabeçalhos e corpo.
const captureHttpPost = `
  CREATE TEMP TABLE captured_post (url text, headers jsonb, body jsonb) ON COMMIT DROP;
  CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE plpgsql AS $f$
  BEGIN
    INSERT INTO pg_temp.captured_post VALUES (url, headers, body);
    RETURN 4470 + (SELECT count(*) FROM pg_temp.captured_post);
  END $f$;
`

function vault(...names: string[]): string {
  return `
    DELETE FROM vault.secrets WHERE name IN ('SUPABASE_URL', ${names.map((name) => `'${name}'`).join(', ')});
    DO $v$ BEGIN
      PERFORM vault.create_secret('https://exemplo.supabase.co', 'SUPABASE_URL', '');
      ${names.map((name) => `PERFORM vault.create_secret('segredo-${name.toLowerCase()}', '${name}', '');`).join('\n')}
    END $v$;
  `
}

const posts = `SELECT count(*) || '|' || coalesce(string_agg(url || ' ' || body::text, ',' ORDER BY url), '') FROM pg_temp.captured_post;`

// Cliente, Viagem e B/L da suíte, gravados com os gatilhos desligados (só os
// gatilhos da 447 interessam aqui) e desfeitos com a transação.
const baseFixture = `
  SET LOCAL session_replication_role = replica;
  INSERT INTO auth.users (id, email) VALUES ('${PORTAL_USER}', 'c447@example.test');
  INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '${syntheticCnpj(447001)}', 'Cliente C447');
  INSERT INTO public.carriers (id, name) VALUES (${CARRIER}, 'Carrier C447');
  INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL}, 'Vessel C447', ${CARRIER});
  INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, ${VESSEL}, 'V447', 'active');
  INSERT INTO public.bls (id, voyage_id, customer_id, pod, ce_mercante) VALUES ('C447-BL-1', ${VOYAGE}, ${CUSTOMER}, 'BRSSZ', 'CE447');
  INSERT INTO public.ce_unlock_requests (id, customer_id, state, source, created_by)
    VALUES ('44700000-0000-4000-8000-0000000000a1', ${CUSTOMER}, 'submitted', 'request', '${PORTAL_USER}');
  SET LOCAL session_replication_role = origin;
`

describeLocal('447 — e-mails automáticos disparados pelo evento', () => {
  it('o disparo usa o segredo e o cabeçalho da rotina, manda {"source":"trigger"} e sai uma vez por transação', () => {
    const out = psql(`
      BEGIN;
      ${captureHttpPost}
      ${vault('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET')}
      SELECT ops.kick_edge_job('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET',
        'X-Communication-Automation-Secret', '', interval '0');
      SELECT ops.kick_edge_job('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET',
        'X-Communication-Automation-Secret', '', interval '0');
      SELECT count(*) || '|' || min(url) || '|' || min(headers->>'X-Communication-Automation-Secret') || '|' || min(body::text)
        FROM pg_temp.captured_post;
      ROLLBACK;
    `)
    expect(lines(out)).toEqual([
      't',
      'f',
      '1|https://exemplo.supabase.co/functions/v1/customer-communication-auto-runner|segredo-customer_communication_automation_secret|{"source": "trigger"}',
    ])
  })

  it('o cron segue mandando corpo vazio pela forma de 4 argumentos', () => {
    const out = psql(`
      BEGIN;
      ${captureHttpPost}
      ${vault('DEMURRAGE_DUNNING_SECRET')}
      SELECT ops.dispatch_edge_job('demurrage-dunning', 'DEMURRAGE_DUNNING_SECRET') IS NOT NULL;
      SELECT min(headers->>'Authorization') || '|' || min(body::text) FROM pg_temp.captured_post;
      ROLLBACK;
    `)
    expect(lines(out)).toEqual(['t', 'Bearer segredo-demurrage_dunning_secret|{}'])
  })

  it('intervalo mínimo: dentro dele não dispara; vencido, dispara e registra o pedido', () => {
    const out = psql(`
      BEGIN;
      ${captureHttpPost}
      ${vault('DEMURRAGE_DUNNING_SECRET')}
      UPDATE ops.edge_job_kicks SET last_kicked_at = clock_timestamp() - interval '30 seconds', last_request_id = NULL
       WHERE function = 'demurrage-dunning';
      SELECT ops.kick_edge_job('demurrage-dunning', 'DEMURRAGE_DUNNING_SECRET', 'Authorization', 'Bearer ', interval '60 seconds');
      -- Outra transação: a trava de "uma vez por transação" volta a valer zero.
      SELECT set_config('vela.kick_demurrage_dunning', '', true);
      UPDATE ops.edge_job_kicks SET last_kicked_at = clock_timestamp() - interval '61 seconds' WHERE function = 'demurrage-dunning';
      SELECT ops.kick_edge_job('demurrage-dunning', 'DEMURRAGE_DUNNING_SECRET', 'Authorization', 'Bearer ', interval '60 seconds');
      SELECT (last_kicked_at > clock_timestamp() - interval '5 seconds') || '|' || last_request_id
        FROM ops.edge_job_kicks WHERE function = 'demurrage-dunning';
      SELECT count(*) FROM pg_temp.captured_post;
      ROLLBACK;
    `)
    expect(lines(out)).toEqual(['f', 't', 'true|4471', '1'])
  })

  it('outra transação disparando a mesma rotina não segura quem grava', async () => {
    // Sessão de apoio segura a linha da rotina, como uma transação longa que
    // acabou de disparar e ainda não terminou.
    const holder = spawn('psql', ['-X', '-q', '-d', databaseUrl, '-c',
      `BEGIN; SELECT 1 FROM ops.edge_job_kicks WHERE function = 'demurrage-dunning' FOR UPDATE; SELECT pg_sleep(4); COMMIT;`],
    { stdio: 'ignore', env: { ...process.env, PGAPPNAME: 'c447-holder' } })
    const done = new Promise<void>((resolve) => holder.on('close', () => resolve()))
    for (let attempt = 0; attempt < 50; attempt++) {
      if (psql(`SELECT count(*) FROM pg_stat_activity WHERE application_name = 'c447-holder' AND query LIKE '%pg_sleep%' AND wait_event = 'PgSleep';`) === '1') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const started = Date.now()
    const out = psql(`
      BEGIN;
      SET LOCAL lock_timeout = '2s';
      ${captureHttpPost}
      ${vault('DEMURRAGE_DUNNING_SECRET')}
      SELECT ops.kick_edge_job('demurrage-dunning', 'DEMURRAGE_DUNNING_SECRET', 'Authorization', 'Bearer ', interval '60 seconds');
      SELECT set_config('vela.kick_demurrage_dunning', '', true);
      SELECT ops.kick_edge_job('demurrage-dunning', 'DEMURRAGE_DUNNING_SECRET', 'Authorization', 'Bearer ', interval '0');
      SELECT count(*) FROM pg_temp.captured_post;
      ROLLBACK;
    `)
    const elapsed = Date.now() - started
    await done
    // Com intervalo, a linha travada vale como "disparando agora"; sem intervalo,
    // dispara sem registrar. Nenhum dos dois espera a outra sessão.
    expect(lines(out)).toEqual(['f', 't', '1'])
    expect(elapsed).toBeLessThan(2000)
  }, 20_000)

  it('sem o segredo dedicado no Vault não dispara nem avisa (o compartilhado de transição não serve)', () => {
    const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl], {
      input: `
        BEGIN;
        ${captureHttpPost}
        ${vault('CE_UNLOCK_CLEANUP_SECRET')}
        DELETE FROM vault.secrets WHERE name = 'CE_UNLOCK_NOTIFY_SECRET';
        ${baseFixture}
        INSERT INTO public.ce_unlock_email_outbox (customer_id, request_id, kind, subject, body)
          VALUES (${CUSTOMER}, '44700000-0000-4000-8000-0000000000a1', 'changes_requested', 'Assunto', 'Corpo');
        ${posts}
        ROLLBACK;
      `,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(lines(String(result.stdout)).at(-1)).toBe('0|')
    expect(String(result.stderr)).not.toContain('WARNING')
  })

  it('falha no disparo vira aviso e a gravação continua', () => {
    const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl], {
      input: `
        BEGIN;
        CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
        RETURNS bigint LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'pg_net fora do ar'; END $f$;
        ${vault('CE_UNLOCK_NOTIFY_SECRET')}
        ${baseFixture}
        INSERT INTO public.ce_unlock_email_outbox (customer_id, request_id, kind, subject, body)
          VALUES (${CUSTOMER}, '44700000-0000-4000-8000-0000000000a1', 'changes_requested', 'Assunto', 'Corpo');
        SELECT count(*) FROM public.ce_unlock_email_outbox WHERE customer_id = ${CUSTOMER} AND status = 'pending';
        ROLLBACK;
      `,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(lines(String(result.stdout)).at(-1)).toBe('1')
    expect(String(result.stderr)).toContain('ops.kick_edge_job(ce-unlock-notify-email): disparo falhou')
  })

  it('Desbloqueio de CE: o aviso gravado na fila chama a rotina com o segredo próprio', () => {
    const out = psql(`
      BEGIN;
      ${captureHttpPost}
      ${vault('CE_UNLOCK_NOTIFY_SECRET', 'CE_UNLOCK_CLEANUP_SECRET')}
      ${baseFixture}
      INSERT INTO public.ce_unlock_email_outbox (customer_id, request_id, kind, subject, body)
        VALUES (${CUSTOMER}, '44700000-0000-4000-8000-0000000000a1', 'changes_requested', 'Assunto', 'Corpo');
      SELECT count(*) || '|' || min(url) || '|' || min(headers->>'Authorization') || '|' || min(body::text) FROM pg_temp.captured_post;
      ROLLBACK;
    `)
    expect(lines(out).at(-1)).toBe(
      '1|https://exemplo.supabase.co/functions/v1/ce-unlock-notify-email|Bearer segredo-ce_unlock_notify_secret|{"source": "trigger"}',
    )
  })

  it('evento do provedor gravado pelo webhook chama o runner de eventos', () => {
    const out = psql(`
      BEGIN;
      ${captureHttpPost}
      ${vault('PORTAL_EMAIL_EVENTS_CRON_SECRET')}
      INSERT INTO public.portal_email_events (provider_event_id, event_type, payload, status)
        VALUES ('c447-evento-1', 'email.delivered', '{"type":"email.delivered","data":{}}'::jsonb, 'pending');
      SELECT count(*) || '|' || min(url) || '|' || min(headers->>'Authorization') FROM pg_temp.captured_post;
      ROLLBACK;
    `)
    expect(lines(out).at(-1)).toBe('1|https://exemplo.supabase.co/functions/v1/portal-email-events-runner|Bearer segredo-portal_email_events_cron_secret')
  })

  it('Comunicados: B/L, Escala, Atracação e contato disparam o runner; mudança que não forma alvo não dispara', () => {
    const runner = 'https://exemplo.supabase.co/functions/v1/customer-communication-auto-runner {"source": "trigger"}'
    // Cada caso numa transação nova (a trava é de uma por transação) e com o
    // intervalo zerado, para o caso anterior não segurar o seguinte.
    const scenario = (change: string) => psql(`
      BEGIN;
      ${captureHttpPost}
      ${vault('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET')}
      ${baseFixture}
      UPDATE ops.edge_job_kicks SET last_kicked_at = NULL WHERE function = 'customer-communication-auto-runner';
      SELECT set_config('vela.kick_customer_communication_auto_runner', '', true);
      ${change}
      ${posts}
      ROLLBACK;
    `).split('\n').at(-1)
    expect(scenario(`INSERT INTO public.bls (id, voyage_id, customer_id, pod) VALUES ('C447-BL-2', ${VOYAGE}, ${CUSTOMER}, 'BRSSZ');`))
      .toBe(`1|${runner}`)
    expect(scenario(`INSERT INTO public.bls (id, voyage_id, customer_id, pod) VALUES ('C447-BL-3', ${VOYAGE}, NULL, 'BRSSZ');`))
      .toBe('0|')
    expect(scenario(`UPDATE public.bls SET charges_calculated_at = now() WHERE id = 'C447-BL-1';`)).toBe(`1|${runner}`)
    expect(scenario(`UPDATE public.bls SET review_status = 'reviewed' WHERE id = 'C447-BL-1';`)).toBe(`1|${runner}`)
    expect(scenario(`UPDATE public.bls SET notes = 'só observação' WHERE id = 'C447-BL-1';`)).toBe('0|')
    expect(scenario(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value)
      VALUES ('voyage_pod_schedule', '${VOYAGE}::BRSSZ', 'ata', '2026-10-24T12:00:00Z');`)).toBe(`1|${runner}`)
    expect(scenario(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value)
      VALUES ('voyage', '${VOYAGE}', 'notes', 'x');`)).toBe('0|')
    expect(scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.depots (id, code, name, tipo, port_id)
        VALUES ('44700000-0000-4000-8000-0000000000d1', 'C447T', 'Terminal C447', 'terminal_portuario', (SELECT id FROM public.ports WHERE locode = 'BRSSZ'));
      SET LOCAL session_replication_role = origin;
      INSERT INTO public.voyage_escala_terminal_state (voyage_id, port, port_id, terminal_id, terminal_atb)
        VALUES (${VOYAGE}, 'BRSSZ', (SELECT id FROM public.ports WHERE locode = 'BRSSZ'), '44700000-0000-4000-8000-0000000000d1', now());`))
      .toBe(`1|${runner}`)
    expect(scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.customer_contacts (id, customer_id, name, email) VALUES (4470001, ${CUSTOMER}, 'Contato C447', 'c447@example.test');
      SET LOCAL session_replication_role = origin;
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES (4470001, 'documentacao_operacao');`))
      .toBe(`1|${runner}`)
  })

  it('Régua de Cobrança: a emissão dispara dentro da janela e não fora dela', () => {
    const issue = (windowOpen: boolean) => psql(`
      BEGIN;
      ${captureHttpPost}
      ${vault('DEMURRAGE_DUNNING_SECRET')}
      ${baseFixture}
      CREATE OR REPLACE FUNCTION public._demurrage_dunning_window_open(p_at timestamptz) RETURNS boolean
        LANGUAGE sql STABLE AS $w$ SELECT ${windowOpen} $w$;
      UPDATE ops.edge_job_kicks SET last_kicked_at = NULL WHERE function = 'demurrage-dunning';
      INSERT INTO public.demurrage_invoices
        (id, doc_number, bl_id, customer_id, doc_date, first_billed_at, total_usd, current_roe, current_total_brl, roe_source, status)
        VALUES (4470001, 'C447-1', 'C447-BL-1', ${CUSTOMER}, current_date, current_date, 100, 5.5, 550, 'manual', 'issued');
      ${posts}
      ROLLBACK;
    `).split('\n').at(-1)
    expect(issue(true)).toBe('1|https://exemplo.supabase.co/functions/v1/demurrage-dunning {"source": "trigger"}')
    expect(issue(false)).toBe('0|')
  })

  it('reserva da fila: o prazo vencido devolve a linha, a nova tentativa espera o cron e o estado final solta a reserva', () => {
    const out = psql(`
      BEGIN;
      ${baseFixture}
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.ce_unlock_email_outbox (id, customer_id, request_id, kind, subject, body)
        OVERRIDING SYSTEM VALUE VALUES
        (44700001, ${CUSTOMER}, '44700000-0000-4000-8000-0000000000a1', 'changes_requested', 'A', 'A'),
        (44700002, ${CUSTOMER}, '44700000-0000-4000-8000-0000000000a1', 'changes_requested', 'B', 'B');
      SET LOCAL session_replication_role = origin;
      CREATE TEMP TABLE mine ON COMMIT DROP AS SELECT 0 AS id;
      -- Só as linhas da suíte: outra fila pendente no banco não muda a conta.
      CREATE OR REPLACE FUNCTION pg_temp.claim() RETURNS text LANGUAGE sql AS $c$
        SELECT coalesce(string_agg(o->>'id', ',' ORDER BY (o->>'id')::bigint), '-')
          FROM jsonb_array_elements(public.ce_unlock_email_pending(100)) o
         WHERE (o->>'customer_id')::bigint = ${CUSTOMER} $c$;
      SELECT pg_temp.claim();
      SELECT pg_temp.claim();
      UPDATE public.ce_unlock_email_outbox SET claimed_until = now() - interval '1 second' WHERE id = 44700002;
      SELECT pg_temp.claim();
      SELECT public.ce_unlock_email_finish(44700001, 'pending', ARRAY[]::text[], 'Falha de envio');
      SELECT public.ce_unlock_email_finish(44700002, 'sent', ARRAY['k:a'], NULL);
      SELECT id || ':' || status || ':' || CASE WHEN claimed_until IS NULL THEN 'livre'
        WHEN claimed_until BETWEEN now() + interval '3 minutes' AND now() + interval '5 minutes' THEN '4min' ELSE 'outro' END
        FROM public.ce_unlock_email_outbox WHERE id IN (44700001, 44700002) ORDER BY id;
      SELECT pg_temp.claim();
      ROLLBACK;
    `)
    expect(lines(out)).toEqual([
      '44700001,44700002', // primeira rodada reserva as duas
      '-', // a segunda não pega nada enquanto a reserva vale
      '44700002', // prazo vencido: a linha volta
      '44700001:pending:4min', // nova tentativa espera ~o cron
      '44700002:sent:livre',
      '-',
    ])
  })

  it('reserva da fila: duas rodadas simultâneas não pegam a mesma linha nem esperam uma pela outra', async () => {
    // Ids negativos: a fila sai por ordem de id, e as linhas da suíte vêm antes
    // de qualquer pendente que outra suíte tenha deixado no banco.
    const ids = [-447003, -447002, -447001]
    const ours = (sql: string) => `SELECT coalesce(string_agg(o->>'id', ',' ORDER BY (o->>'id')::bigint), '-')
      FROM jsonb_array_elements(${sql}) o WHERE (o->>'customer_id')::bigint = ${CUSTOMER}`
    const cleanup = () => psql(`
      SET session_replication_role = replica;
      DELETE FROM public.ce_unlock_email_outbox WHERE customer_id = ${CUSTOMER};
      DELETE FROM public.ce_unlock_requests WHERE customer_id = ${CUSTOMER};
      DELETE FROM public.customers WHERE id = ${CUSTOMER};
      DELETE FROM auth.users WHERE id = '${PORTAL_USER}';
    `)
    cleanup()
    try {
      psql(`
        SET session_replication_role = replica;
        INSERT INTO auth.users (id, email) VALUES ('${PORTAL_USER}', 'c447@example.test');
        INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '${syntheticCnpj(447001)}', 'Cliente C447');
        INSERT INTO public.ce_unlock_requests (id, customer_id, state, source, created_by)
          VALUES ('44700000-0000-4000-8000-0000000000a1', ${CUSTOMER}, 'submitted', 'request', '${PORTAL_USER}');
        INSERT INTO public.ce_unlock_email_outbox (id, customer_id, request_id, kind, subject, body)
          OVERRIDING SYSTEM VALUE
          SELECT id, ${CUSTOMER}, '44700000-0000-4000-8000-0000000000a1', 'changes_requested', 'S' || id, 'S' || id
            FROM unnest(ARRAY[${ids.join(', ')}]::bigint[]) id;
      `)
      // Rodada A reserva duas linhas e segura a transação aberta.
      const holder = spawn('psql', ['-X', '-At', '-q', '-d', databaseUrl, '-c',
        `BEGIN; ${ours('public.ce_unlock_email_pending(2)')}; SELECT pg_sleep(3); COMMIT;`],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PGAPPNAME: 'c447-claim-a' } })
      let holderOut = ''
      holder.stdout.on('data', (chunk) => { holderOut += String(chunk) })
      const holderDone = new Promise<void>((resolve) => holder.on('close', () => resolve()))
      for (let attempt = 0; attempt < 50; attempt++) {
        if (psql(`SELECT count(*) FROM pg_stat_activity WHERE application_name = 'c447-claim-a' AND backend_xid IS NOT NULL AND wait_event = 'PgSleep';`) === '1') break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      // Rodada B, com A ainda aberta: pula as linhas travadas, sem esperar.
      const started = Date.now()
      const b = psql(`SET lock_timeout = '2s'; ${ours('public.ce_unlock_email_pending(1)')};`)
      const elapsed = Date.now() - started
      await holderDone
      // Depois de A terminar, a reserva das três continua valendo.
      const reserved = psql(`SELECT count(*) FROM public.ce_unlock_email_outbox
        WHERE customer_id = ${CUSTOMER} AND claimed_until > now() + interval '9 minutes';`)
      expect(holderOut.trim().split('\n')[0]).toBe('-447003,-447002')
      expect(b).toBe('-447001')
      expect(elapsed).toBeLessThan(2000)
      expect(reserved).toBe('3')
    } finally {
      cleanup()
    }
  }, 30_000)

  it('produtora dos Comunicados: os pendentes rodam uma vez por alvo, não por B/L × Escala', () => {
    // 30 Viagens com ATA nos últimos 30 dias (NOR), 3 Clientes cada e 4 B/Ls
    // por Cliente. Antes da 447 o filtro de pendentes do NOR descia para o
    // scan de `bls` (B/L × Escala na janela): 615 chamadas para 180 alvos.
    const out = psql(`
      BEGIN;
      SET LOCAL session_replication_role = replica;
      SET LOCAL track_functions = 'all';
      SET LOCAL request.jwt.claim.role = 'service_role';
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER}, 'Carrier C447');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL}, 'Vessel C447', ${CARRIER});
      INSERT INTO public.customers (id, cnpj_cpf, name)
        SELECT 447100 + c, lpad((44710000000000 + c)::text, 14, '0'), 'Cliente C447 ' || c FROM generate_series(1, 6) c;
      INSERT INTO public.customer_contacts (id, customer_id, name, email)
        SELECT 4471000 + c, 447100 + c, 'Contato', 'c447-' || c || '@example.test' FROM generate_series(1, 6) c;
      INSERT INTO public.customer_contact_box_links (contact_id, box_code)
        SELECT 4471000 + c, box FROM generate_series(1, 6) c, unnest(ARRAY['documentacao_operacao', 'financeiro']) box;
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
        SELECT 447100 + v, ${VESSEL}, 'V447-' || v, 'active' FROM generate_series(1, 30) v;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, new_value, changed_at)
        SELECT 'voyage_pod_schedule', (447100 + v) || '::BRSSZ', f,
          to_char((now() - make_interval(days => v - CASE f WHEN 'eta' THEN 1 ELSE 0 END)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          now() - make_interval(days => v)
        FROM generate_series(1, 29) v, unnest(ARRAY['eta', 'ata']) f;
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, ce_mercante, financial_status)
        SELECT 'C447-N-' || v || '-' || c || '-' || b, 447100 + v, 447100 + 1 + ((v + c) % 6), 'BRSSZ',
          lpad((v * 1000 + c * 10 + b)::text, 15, '0'), 'invoiced'
        FROM generate_series(1, 30) v, generate_series(1, 3) c, generate_series(1, 4) b;
      SELECT count(*) FROM public.customer_communication_automation_targets(now()) WHERE customer_id BETWEEN 447101 AND 447106;
      -- Teto: um alvo NOA/NOR por Viagem × Cliente × porto, um CE e Taxas por
      -- Viagem × Cliente e um NOB por Atracação × Cliente.
      SELECT (SELECT calls FROM pg_stat_xact_user_functions WHERE funcname = 'customer_communication_target_pending_recipients')
        || '|' || (
          (SELECT count(*) FROM (SELECT DISTINCT voyage_id, customer_id, public.normalize_port_code(pod) FROM public.bls WHERE customer_id IS NOT NULL) t)
          + (SELECT count(*) FROM (SELECT DISTINCT voyage_id, customer_id FROM public.bls WHERE customer_id IS NOT NULL AND voyage_id IS NOT NULL) t)
          + (SELECT count(*) FROM public.voyage_escala_terminal_state) * (SELECT count(*) FROM public.customers));
      ROLLBACK;
    `)
    const [targets, counts] = lines(out)
    const [calls, ceiling] = counts.split('|').map(Number)
    // 29 Viagens com NOR × 3 Clientes + 90 CE e Taxas (ninguém comunicado
    // ainda). As chamadas contam também os grupos que outra suíte deixou no
    // banco; o teto é calculado sobre os mesmos dados.
    expect(Number(targets)).toBe(177)
    expect(calls).toBeGreaterThanOrEqual(177)
    expect(calls).toBeLessThanOrEqual(ceiling)
  })

  it('jobs: comunicados a cada 2 min e cobrança a cada 5, mesmo comando; avisos de CE e eventos como estavam', () => {
    const out = psql(`
      SELECT jobname || '|' || schedule || '|' || command FROM cron.job
       WHERE jobname IN ('customer-communication-auto-runner', 'demurrage-dunning', 'portal-email-events-runner')
       ORDER BY jobname;
    `)
    expect(lines(out)).toEqual([
      "customer-communication-auto-runner|1-59/2 * * * *|SELECT ops.dispatch_edge_job('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET', 'X-Communication-Automation-Secret', '');",
      "demurrage-dunning|3-59/5 * * * *|SELECT ops.dispatch_edge_job('demurrage-dunning', 'DEMURRAGE_DUNNING_SECRET');",
      "portal-email-events-runner|* * * * *|SELECT ops.dispatch_edge_job('portal-email-events-runner', 'PORTAL_EMAIL_EVENTS_CRON_SECRET');",
    ])
  })

  it('disparo, dispatcher com corpo, tabela do intervalo e funções dos gatilhos ficam fechados para o cliente', () => {
    const out = psql(`
      SELECT bool_or(has_function_privilege(r, f, 'EXECUTE'))
        FROM unnest(ARRAY['anon', 'authenticated']) r,
             unnest(ARRAY['ops.kick_edge_job(text,text,text,text,interval)', 'ops.dispatch_edge_job(text,text,text,text,jsonb)',
                          'public._kick_edge_job_trigger()', 'public._kick_demurrage_dunning_trigger()']) f;
      SELECT bool_or(has_table_privilege(r, 'ops.edge_job_kicks', 'SELECT'))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
      SELECT prosecdef FROM pg_proc WHERE oid = 'ops.dispatch_edge_job(text,text,text,text,jsonb)'::regprocedure;
    `)
    expect(lines(out)).toEqual(['f', 'f', 'f'])
  })
})
