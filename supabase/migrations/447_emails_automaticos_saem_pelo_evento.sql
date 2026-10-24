-- 447: os e-mails automáticos saem pelo evento, não pelo próximo cron.
--
-- O provedor entrega em ~5 s; a demora vinha de esperar o job do pg_cron
-- (produção, 2026-10-24, `cron.job`): avisos do Desbloqueio de CE a cada
-- 5 min (`ce-unlock-notify-email`, jobid 35, agendado à mão), CE e Taxas e
-- NOA/NOR/NOB a cada 15 min (`customer-communication-auto-runner`), Régua de
-- Cobrança de hora em hora (`demurrage-dunning`) e eventos do provedor a cada
-- minuto (`portal-email-events-runner`).
--
-- Mudanças:
--   1. `ops.dispatch_edge_job` ganha a forma com corpo (5 argumentos); a de 4
--      argumentos, usada pelos jobs, passa a chamá-la com `{}`. Mesmo Vault,
--      timeout de 30 s (165), SECURITY INVOKER e ACL.
--   2. `ops.kick_edge_job(função, segredo, cabeçalho, prefixo, intervalo)`
--      dispara a Edge Function com `{"source":"trigger"}` uma vez por
--      transação, com o segredo dedicado da rotina (nunca o compartilhado de
--      transição) e no máximo uma vez por `intervalo` (`ops.edge_job_kicks`).
--      O pg_net só envia depois do COMMIT: rollback não dispara nada. Sem o
--      par no Vault (Preview, staging sem provisionar), pula em silêncio;
--      falha no disparo vira WARNING. Nunca derruba a gravação de quem usa a
--      tela. A Edge não manda heartbeat ao Better Stack quando a origem é
--      `trigger`, para não esconder um cron parado.
--   3. Desbloqueio de CE: `ce_unlock_email_pending` reserva as linhas com
--      FOR UPDATE SKIP LOCKED e prazo (`claimed_until`, 10 min); com o
--      gatilho e o cron juntos, duas rodadas não pegam a mesma linha.
--      `ce_unlock_email_finish` solta a reserva; a linha que volta para nova
--      tentativa fica reservada por 4 min, para o reenvio seguir o passo do
--      cron e não o de cada disparo. As chaves de idempotência
--      (`ce-unlock:{id}:{dest}` e o Idempotency-Key no provedor) não mudam.
--      Gatilho AFTER INSERT ... FOR EACH STATEMENT na fila, sem intervalo.
--   4. Eventos do provedor (entregue, bounce, reclamação): gatilho AFTER
--      INSERT em `portal_email_events`, sem intervalo. O claim com lease
--      (`claim_portal_email_events`) já separa rodadas simultâneas.
--   5. CE e Taxas e NOA/NOR/NOB: gatilhos no que deixa um alvo pronto (B/L:
--      Cliente, Viagem, porto, terminal, faturamento, CE, revisão, peso,
--      cancelamento, cálculo das taxas; ETA/ATA/omissão/exclusão da Escala em
--      `audit_logs`; ATB da Atracação; contato ligado a uma caixa ou
--      reativado), com intervalo mínimo de 90 s: o comunicado sai uma vez
--      por Cliente e Viagem, e a sequência de efeitos de uma importação não
--      vira uma rodada por transação. O NOA, que vence pelo relógio (ETA-5
--      dias), segue só com o cron.
--   6. Custo da produtora medido antes de baixar o cron (Postgres 16 local,
--      dados sintéticos; produção tem 450 B/Ls e roda em ~31 ms):
--      `customer_communication_automation_targets` com 3.000 pares
--      Cliente × Viagem levava 75 s; 5.000, 127 s. No plano genérico da
--      função, o filtro de destinatários pendentes do NOA/NOR descia para o
--      scan de `bls` e rodava por B/L × Escala na janela (441 mil chamadas
--      para 3.300 alvos). A função é redefinida com a mesma regra: os grupos
--      do NOA/NOR e do NOB são materializados (como o de CE e Taxas desde a
--      339), os pendentes são calculados uma vez por alvo (OFFSET 0) e, no CE
--      e Taxas, a prontidão só roda para o alvo ainda pendente. Medido:
--      3.000 pares 1,2–1,5 s e 10.000 pares 4,4–5,0 s (~0,45 ms por par).
--   7. Jobs (`cron.alter_job`, preserva jobid, comando e ativo/pausado):
--      customer-communication-auto-runner de `4-59/15` para `1-59/2`;
--      demurrage-dunning de `7 * * * *` para `3-59/5`, com o gatilho na
--      emissão da Invoice só dentro da janela (dia útil, a partir das 9h de
--      Brasília). A janela, a régua de dias e os recuos após recusa ficam na
--      seleção do banco e não mudam. ce-unlock-notify-email (5 min) e
--      portal-email-events-runner (1 min) seguem como rede de segurança.
--
-- ponytail: o intervalo mínimo é um corte na borda de entrada: o primeiro
-- evento dispara na hora e os seguintes, dentro do intervalo, esperam o cron.
-- Teto: até ~2 min de espera para o evento que cai logo depois de um disparo.
-- Caminho de upgrade: um "pedido pendente" na mesma tabela, consumido pelo
-- job de minuto quando o intervalo vence.
-- ponytail: a produtora dos Comunicados lê todo par Cliente × Viagem a cada
-- rodada (custo linear, ~0,45 ms por par). Teto: com ~10 mil pares, ~5 s por
-- rodada, até ~1,2 rodada por minuto. Caminho de upgrade: restringir o CE e
-- Taxas a Viagens sem Comunicado concluído ou manter um conjunto de alvos
-- "sujos" alimentado pelos mesmos gatilhos.
--
-- Não reescreve nem apaga linhas de negócio: cria tabela e coluna, redefine
-- funções, cria gatilhos e muda o horário de dois jobs.
--
-- Rollback:
--   DROP TRIGGER trg_kick_ce_unlock_notify_email ON public.ce_unlock_email_outbox;
--   DROP TRIGGER trg_kick_portal_email_events_runner ON public.portal_email_events;
--   DROP TRIGGER trg_kick_customer_communications_on_bl_insert ON public.bls;
--   DROP TRIGGER trg_kick_customer_communications_on_bl_update ON public.bls;
--   DROP TRIGGER trg_kick_customer_communications_on_schedule ON public.audit_logs;
--   DROP TRIGGER trg_kick_customer_communications_on_berth ON public.voyage_escala_terminal_state;
--   DROP TRIGGER trg_kick_customer_communications_on_box_link ON public.customer_contact_box_links;
--   DROP TRIGGER trg_kick_customer_communications_on_contact ON public.customer_contacts;
--   DROP TRIGGER trg_kick_demurrage_dunning_on_issue ON public.demurrage_invoices;
--   DROP TRIGGER trg_kick_demurrage_dunning_on_first_billing ON public.demurrage_invoices;
--   DROP FUNCTION public._kick_edge_job_trigger();
--   DROP FUNCTION public._kick_demurrage_dunning_trigger();
--   DROP FUNCTION ops.kick_edge_job(text, text, text, text, interval);
--   DROP TABLE ops.edge_job_kicks;
--   reaplicar ce_unlock_email_pending (427), ce_unlock_email_finish (314),
--   customer_communication_automation_targets (339) e ops.dispatch_edge_job
--   de 4 argumentos (165); DROP FUNCTION ops.dispatch_edge_job(text, text, text, text, jsonb);
--   SELECT cron.alter_job(jobid, schedule := '4-59/15 * * * *') FROM cron.job WHERE jobname = 'customer-communication-auto-runner';
--   SELECT cron.alter_job(jobid, schedule := '7 * * * *') FROM cron.job WHERE jobname = 'demurrage-dunning';
--   A coluna claimed_until pode ficar (nula, sem leitor).

-- ===========================================================================
-- 1. Dispatcher com corpo
-- ===========================================================================

CREATE OR REPLACE FUNCTION ops.dispatch_edge_job(
  p_function      text,
  p_secret_name   text,
  p_header_name   text,
  p_header_prefix text,
  p_body          jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $dispatch_edge_job$
DECLARE
  v_base   text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_base
    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = p_secret_name;

  -- Banco novo / branch de Preview nasce com o Vault vazio. Avisar e nao
  -- disparar e melhor do que um POST para host invalido a cada ciclo.
  IF NULLIF(v_base, '') IS NULL OR NULLIF(v_secret, '') IS NULL THEN
    RAISE WARNING 'ops.dispatch_edge_job: Vault sem SUPABASE_URL e/ou %; job % nao disparado.',
      p_secret_name, p_function;
    RETURN NULL;
  END IF;

  -- 30 s: o padrão do pg_net (5 s) inclui DNS e acabava antes da segunda
  -- tentativa do resolvedor nos minutos de rajada (migration 165).
  RETURN net.http_post(
    url                  := v_base || '/functions/v1/' || p_function,
    headers              := jsonb_build_object(
                              p_header_name, p_header_prefix || v_secret,
                              'Content-Type', 'application/json'
                            ),
    body                 := COALESCE(p_body, '{}'::jsonb),
    timeout_milliseconds := 30000
  );
END;
$dispatch_edge_job$;

COMMENT ON FUNCTION ops.dispatch_edge_job(text, text, text, text, jsonb) IS
  'Dispara uma Edge Function pelo pg_net (timeout de 30 s) com o corpo dado, lendo base e segredo do Vault. SECURITY INVOKER: nao concede alcance ao Vault a quem nao tem. Migrations 007, 165 e 447.';

REVOKE ALL ON FUNCTION ops.dispatch_edge_job(text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.dispatch_edge_job(text, text, text, text, jsonb) FROM anon, authenticated;

-- A forma dos jobs (2 ou 4 argumentos) manda `{}`, como sempre: a Edge lê o
-- corpo vazio como execução do cron.
CREATE OR REPLACE FUNCTION ops.dispatch_edge_job(
  p_function      text,
  p_secret_name   text,
  p_header_name   text DEFAULT 'Authorization',
  p_header_prefix text DEFAULT 'Bearer '
)
RETURNS bigint
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $dispatch_edge_job_cron$
  SELECT ops.dispatch_edge_job(p_function, p_secret_name, p_header_name, p_header_prefix, '{}'::jsonb);
$dispatch_edge_job_cron$;

COMMENT ON FUNCTION ops.dispatch_edge_job(text, text, text, text) IS
  'Forma dos jobs pg_cron: dispara a Edge Function com corpo {} (execucao do cron) pela forma de 5 argumentos (timeout de 30 s). SECURITY INVOKER. Migrations 007, 165 e 447.';

REVOKE ALL ON FUNCTION ops.dispatch_edge_job(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.dispatch_edge_job(text, text, text, text) FROM anon, authenticated;

-- ===========================================================================
-- 2. Disparo pelo evento, com intervalo mínimo por rotina
-- ===========================================================================

CREATE TABLE IF NOT EXISTS ops.edge_job_kicks (
  function        text PRIMARY KEY CHECK (function ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  last_kicked_at  timestamptz,
  -- Id do pedido no pg_net: `net._http_response` com este id mostra o status.
  last_request_id bigint
);
INSERT INTO ops.edge_job_kicks (function) VALUES
  ('ce-unlock-notify-email'),
  ('portal-email-events-runner'),
  ('customer-communication-auto-runner'),
  ('demurrage-dunning')
ON CONFLICT (function) DO NOTHING;
REVOKE ALL ON TABLE ops.edge_job_kicks FROM PUBLIC, anon, authenticated, service_role;
-- RLS sem policy: só ops.kick_edge_job (SECURITY DEFINER, dona da tabela) lê
-- e grava.
ALTER TABLE ops.edge_job_kicks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ops.edge_job_kicks IS
  'Último disparo de cada Edge Function pelo evento (ops.kick_edge_job, migration 447): intervalo mínimo e id do pedido no pg_net.';

-- ponytail: o intervalo é por rotina, global. Teto: um Cliente que gera muitos
-- eventos atrasa o disparo dos demais até o cron. Upgrade: chave por rotina e
-- Cliente, se a medição mostrar espera.
CREATE OR REPLACE FUNCTION ops.kick_edge_job(
  p_function     text,
  p_secret_name  text,
  p_header       text DEFAULT 'Authorization',
  p_prefix       text DEFAULT 'Bearer ',
  p_min_interval interval DEFAULT interval '0'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $kick_edge_job$
DECLARE
  v_guard   text;
  v_now     timestamptz := clock_timestamp();
  v_last    timestamptz;
  v_locked  boolean;
  v_request bigint;
BEGIN
  -- O nome vai para a URL e para o nome da trava da transação.
  IF p_function IS NULL OR p_function !~ '^[a-z0-9][a-z0-9-]{0,62}$' THEN
    RAISE EXCEPTION 'Função inválida para o disparo: %.', p_function USING ERRCODE = '22023';
  END IF;

  -- Uma tentativa por transação e rotina, antes do bloco de exceção: uma
  -- importação de centenas de B/Ls não abre uma subtransação por linha.
  v_guard := 'vela.kick_' || translate(p_function, '-', '_');
  IF current_setting(v_guard, true) = 'on' THEN
    RETURN false;
  END IF;
  PERFORM set_config(v_guard, 'on', true);

  BEGIN
    -- Sem o par no Vault (banco novo, Preview, staging sem provisionar): pula
    -- em silêncio. O cron, que passa pelo dispatcher, é quem avisa.
    IF (SELECT count(*) FROM vault.decrypted_secrets
         WHERE name IN ('SUPABASE_URL', p_secret_name)
           AND NULLIF(decrypted_secret, '') IS NOT NULL) < 2 THEN
      RETURN false;
    END IF;

    -- SKIP LOCKED: a linha travada é de outra transação que está disparando
    -- esta rotina; esperar por ela seguraria a gravação de quem usa a tela.
    SELECT k.last_kicked_at INTO v_last
      FROM ops.edge_job_kicks k WHERE k.function = p_function
       FOR UPDATE SKIP LOCKED;
    v_locked := FOUND;
    IF NOT v_locked AND NOT EXISTS (SELECT 1 FROM ops.edge_job_kicks k WHERE k.function = p_function) THEN
      INSERT INTO ops.edge_job_kicks (function) VALUES (p_function) ON CONFLICT (function) DO NOTHING;
      SELECT k.last_kicked_at INTO v_last
        FROM ops.edge_job_kicks k WHERE k.function = p_function
         FOR UPDATE SKIP LOCKED;
      v_locked := FOUND;
    END IF;

    IF COALESCE(p_min_interval, interval '0') > interval '0' THEN
      -- Dentro do intervalo, ou outra transação disparando agora: o disparo
      -- dela (depois do COMMIT) ou o cron cobre este evento.
      IF NOT v_locked OR v_last > v_now - p_min_interval THEN
        RETURN false;
      END IF;
    END IF;

    v_request := ops.dispatch_edge_job(p_function, p_secret_name, p_header, p_prefix,
                                       '{"source":"trigger"}'::jsonb);
    -- Sem intervalo e com a linha de outra transação, dispara sem registrar.
    IF v_locked THEN
      UPDATE ops.edge_job_kicks
         SET last_kicked_at = v_now, last_request_id = v_request
       WHERE function = p_function;
    END IF;
    RETURN v_request IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ops.kick_edge_job(%): disparo falhou (%); o cron processa.', p_function, SQLERRM;
    RETURN false;
  END;
END;
$kick_edge_job$;

COMMENT ON FUNCTION ops.kick_edge_job(text, text, text, text, interval) IS
  'Dispara a Edge Function com {"source":"trigger"} uma vez por transação e no máximo uma vez por intervalo (ops.edge_job_kicks); pg_net envia após o COMMIT. Sem o par no Vault, pula; falha vira WARNING. Migration 447.';

REVOKE ALL ON FUNCTION ops.kick_edge_job(text, text, text, text, interval) FROM PUBLIC, anon, authenticated;

-- Função única dos gatilhos: TG_ARGV = função, segredo, cabeçalho, prefixo e
-- intervalo. Roda com o papel de quem grava; é dona `postgres` e a única ponte
-- dele até o disparo. A trava da transação é lida aqui antes de chamar o
-- disparo, para o gatilho por linha custar só uma leitura de configuração.
CREATE OR REPLACE FUNCTION public._kick_edge_job_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $kick_edge_job_trigger$
BEGIN
  IF current_setting('vela.kick_' || translate(TG_ARGV[0], '-', '_'), true) = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM ops.kick_edge_job(TG_ARGV[0], TG_ARGV[1], TG_ARGV[2], TG_ARGV[3], TG_ARGV[4]::interval);
  RETURN NULL;
END;
$kick_edge_job_trigger$;

REVOKE ALL ON FUNCTION public._kick_edge_job_trigger() FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 3. Desbloqueio de CE: reserva da fila e disparo na inserção
-- ===========================================================================

ALTER TABLE public.ce_unlock_email_outbox ADD COLUMN IF NOT EXISTS claimed_until timestamptz;

COMMENT ON COLUMN public.ce_unlock_email_outbox.claimed_until IS
  'Reserva da linha pela rodada de ce-unlock-notify-email (migration 447): outra rodada só a pega depois deste prazo.';

-- Definição da 427 com a reserva. ponytail: prazo fixo de 10 min, acima do
-- teto de uma invocação da Edge. Teto: a rodada que morre segura as linhas
-- até o prazo vencer; o cron de 5 min as pega na rodada seguinte a ele.
CREATE OR REPLACE FUNCTION public.ce_unlock_email_pending(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH candidates AS (
   SELECT o.id FROM public.ce_unlock_email_outbox o
   WHERE o.status='pending' AND o.attempts<5
     AND (o.claimed_until IS NULL OR o.claimed_until<=now())
     -- Cliente desativado não recebe aviso operacional (como o Comunicado e o resumo).
     AND NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.id=o.customer_id AND c.deactivated_at IS NOT NULL)
   ORDER BY o.id LIMIT greatest(1,least(p_limit,100))
   FOR UPDATE OF o SKIP LOCKED
 ), claimed AS (
   UPDATE public.ce_unlock_email_outbox o SET claimed_until=now()+interval '10 minutes'
   FROM candidates c WHERE o.id=c.id
   RETURNING o.id,o.customer_id,o.request_id,o.kind,o.subject,o.body,o.done_recipients,o.attempts
 )
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM claimed c $function$;

REVOKE ALL ON FUNCTION public.ce_unlock_email_pending(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ce_unlock_email_pending(integer) TO service_role;

-- Definição da 314 com a reserva solta: estado final sem reserva; nova
-- tentativa reservada por 4 min, para o reenvio seguir o cron de 5 min e não
-- cada disparo do gatilho.
CREATE OR REPLACE FUNCTION public.ce_unlock_email_finish(p_id bigint, p_status text, p_done text[], p_error text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint;
  v_customer_name text;
  v_customer_cnpj text;
  v_kind text;
BEGIN
  IF p_status NOT IN ('pending', 'sent', 'partial', 'simulated', 'skipped', 'failed') THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  UPDATE public.ce_unlock_email_outbox
  SET status = p_status,
      done_recipients = coalesce(p_done, done_recipients),
      last_error = left(p_error, 300),
      attempts = attempts + 1,
      processed_at = CASE WHEN p_status = 'pending' THEN processed_at ELSE now() END,
      claimed_until = CASE WHEN p_status = 'pending' THEN now() + interval '4 minutes' END
  WHERE id = p_id
  RETURNING customer_id, kind INTO v_customer_id, v_kind;

  IF v_customer_id IS NULL OR p_status = 'pending' THEN
    RETURN;
  END IF;

  BEGIN
    IF p_status IN ('skipped', 'failed') THEN
      SELECT c.name, c.cnpj_cpf INTO v_customer_name, v_customer_cnpj FROM public.customers c WHERE c.id = v_customer_id;
      PERFORM public.upsert_alert_item(
        'desbloqueio_ce_aviso_nao_enviado',
        'customer',
        v_customer_id::text,
        'Cliente ' || coalesce(v_customer_name, v_customer_id::text) || ': aviso do Desbloqueio de CE não enviado. '
          || CASE WHEN p_status = 'skipped' THEN 'Nenhum destinatário: ' ELSE 'Falha de envio: ' END
          || coalesce(left(p_error, 300), 'sem motivo informado'),
        'ce_unlock_email',
        -- 314: customer_cnpj leva "Abrir Cliente" à ficha do Cliente, não à lista.
        jsonb_build_object('customer_id', v_customer_id, 'customer_cnpj', v_customer_cnpj, 'outbox_id', p_id, 'kind', v_kind, 'status', p_status, 'reason', left(p_error, 300)),
        '/clientes'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'desbloqueio_ce_aviso_nao_enviado',
        'customer',
        v_customer_id::text,
        'ce_unlock_email',
        jsonb_build_object('outbox_id', p_id, 'status', p_status)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta desbloqueio_ce_aviso_nao_enviado da linha % nao gravado: %', p_id, SQLERRM;
  END;
END
$function$;

REVOKE ALL ON FUNCTION public.ce_unlock_email_finish(bigint, text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ce_unlock_email_finish(bigint, text, text[], text) TO service_role;

-- Segredo dedicado da rotina, sem o compartilhado de transição da 438: sem
-- CE_UNLOCK_NOTIFY_SECRET no Vault o disparo não acontece e o cron segue.
DROP TRIGGER IF EXISTS trg_kick_ce_unlock_notify_email ON public.ce_unlock_email_outbox;
CREATE TRIGGER trg_kick_ce_unlock_notify_email
  AFTER INSERT ON public.ce_unlock_email_outbox
  FOR EACH STATEMENT
  EXECUTE FUNCTION public._kick_edge_job_trigger('ce-unlock-notify-email', 'CE_UNLOCK_NOTIFY_SECRET', 'Authorization', 'Bearer ', '0');

-- ===========================================================================
-- 4. Eventos do provedor de e-mail
-- ===========================================================================

DROP TRIGGER IF EXISTS trg_kick_portal_email_events_runner ON public.portal_email_events;
CREATE TRIGGER trg_kick_portal_email_events_runner
  AFTER INSERT ON public.portal_email_events
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public._kick_edge_job_trigger('portal-email-events-runner', 'PORTAL_EMAIL_EVENTS_CRON_SECRET', 'Authorization', 'Bearer ', '0');

-- ===========================================================================
-- 5. Comunicados automáticos: produtora sem o plano degenerado
-- ===========================================================================

-- Definição da 339. Mesma regra e mesmo retorno; muda só a forma de avaliar
-- (item 6 do cabeçalho).
CREATE OR REPLACE FUNCTION public.customer_communication_automation_targets(p_as_of timestamptz DEFAULT now())
RETURNS TABLE (
  kind text,
  nature text,
  claim_key text,
  customer_id bigint,
  customer_name text,
  customer_cnpj text,
  voyage_id bigint,
  vessel_name text,
  voyage_number text,
  port text,
  milestone_at timestamptz,
  milestone_text text,
  anchor_atracacao_id uuid,
  terminal_id uuid,
  terminal_code text,
  bl_ids text[],
  emails text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_as_of timestamptz := COALESCE(p_as_of, now());
BEGIN
  -- NOA: de D-5 até antes do ETA. NOR: até 30 dias depois da ATA.
  RETURN QUERY
  WITH sched AS (
    SELECT s.voyage_id, s.port, v.voyage_number, vs.name AS vessel_name,
      CASE WHEN s.ata IS NOT NULL THEN 'aviso_prontidao_nor' ELSE 'aviso_chegada_noa' END AS kind,
      CASE WHEN s.ata IS NOT NULL THEN s.ata ELSE s.eta END AS milestone_at,
      CASE WHEN s.ata IS NOT NULL THEN s.ata_text ELSE s.eta_text END AS milestone_text
    FROM public.customer_communication_scale_schedules() s
    JOIN public.voyages v ON v.id = s.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE NOT s.deleted AND NOT s.omitted
      AND v.status IS DISTINCT FROM 'cancelled'
      AND ((s.ata IS NULL AND s.eta IS NOT NULL AND v_as_of >= s.eta - interval '5 days' AND v_as_of < s.eta)
        OR (s.ata IS NOT NULL AND s.ata BETWEEN v_as_of - interval '30 days' AND v_as_of))
  -- 447: MATERIALIZED, como o CE e Taxas. Sem a barreira, no plano genérico
  -- da função o filtro de pendentes descia para o scan de `bls` e rodava
  -- por B/L × Escala na janela, antes de juntar a Viagem.
  ), grouped AS MATERIALIZED (
    SELECT sched.kind, sched.voyage_id, sched.port, sched.vessel_name, sched.voyage_number,
      sched.milestone_at, sched.milestone_text, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids
    FROM sched
    JOIN public.bls b ON b.voyage_id = sched.voyage_id AND public.normalize_port_code(b.pod) = sched.port
    JOIN public.customers c ON c.id = b.customer_id AND c.deactivated_at IS NULL
    WHERE COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND b.cancelled_at IS NULL
    GROUP BY sched.kind, sched.voyage_id, sched.port, sched.vessel_name, sched.voyage_number,
      sched.milestone_at, sched.milestone_text, b.customer_id, c.name, c.cnpj_cpf
  ), addressed AS (
    SELECT g.*, public.customer_communication_automatic_recipients(g.customer_id, ARRAY['documentacao_operacao']) AS recipients
    FROM grouped g
  )
  SELECT a.kind, 'avisos_operacionais'::text,
    a.kind || ':' || a.customer_id || ':' || a.voyage_id || ':' || a.port,
    a.customer_id, a.customer_name, a.cnpj_cpf, a.voyage_id, a.vessel_name, a.voyage_number, a.port,
    a.milestone_at, a.milestone_text, NULL::uuid, NULL::uuid, NULL::text, a.bl_ids, pr.pending
  FROM addressed a
  CROSS JOIN LATERAL (
    SELECT public.customer_communication_target_pending_recipients(a.kind, a.customer_id, a.voyage_id, a.port, NULL, a.recipients) AS pending
    -- 447: OFFSET 0 avalia os pendentes uma vez por alvo (sem ele, o WHERE e o
    -- SELECT chamavam a função duas vezes).
    OFFSET 0
  ) pr
  WHERE pr.pending IS NOT NULL;

  -- CE e Taxas: um por Cliente × Viagem pronta (D3).
  -- MATERIALIZED: a prontidão roda só sobre os grupos já formados, com
  -- Viagem e Cliente presentes. Sem a barreira, o planner podia avaliar o
  -- filtro de prontidão no scan de `bls`, antes do JOIN com `customers`, e
  -- chamar a prontidão para o B/L sem Cliente.
  RETURN QUERY
  WITH grouped AS MATERIALIZED (
    SELECT b.voyage_id, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      v.voyage_number, vs.name AS vessel_name, v.eta AS milestone_at,
      array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids
    FROM public.bls b
    JOIN public.customers c ON c.id = b.customer_id AND c.deactivated_at IS NULL
    JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE b.customer_id IS NOT NULL
      AND b.voyage_id IS NOT NULL
      AND v.status IS DISTINCT FROM 'cancelled'
      AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND b.cancelled_at IS NULL
    GROUP BY b.voyage_id, b.customer_id, c.name, c.cnpj_cpf, v.voyage_number, vs.name, v.eta
  -- 447: pendentes antes da prontidão; o alvo já comunicado (pendentes nulo)
  -- não recalcula a prontidão a cada rodada.
  ), pending AS MATERIALIZED (
    SELECT g.*, public.customer_communication_target_pending_recipients('ce_mercante_taxas', g.customer_id, g.voyage_id, NULL, NULL,
      public.customer_communication_automatic_recipients(g.customer_id, ARRAY['documentacao_operacao', 'financeiro'])) AS pending
    FROM grouped g
    WHERE g.customer_id IS NOT NULL
      AND g.voyage_id IS NOT NULL
  )
  SELECT 'ce_mercante_taxas'::text, 'documentacao'::text,
    'ce_mercante_taxas:' || a.customer_id || ':' || a.voyage_id,
    a.customer_id, a.customer_name, a.cnpj_cpf, a.voyage_id, a.vessel_name, a.voyage_number,
    public.customer_local_charges_communication_port(a.voyage_id, a.customer_id),
    a.milestone_at, to_char(a.milestone_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    NULL::uuid, NULL::uuid, NULL::text, a.bl_ids, a.pending
  FROM pending a
  WHERE a.pending IS NOT NULL
    AND (public.customer_local_charges_communication_readiness(a.voyage_id, a.customer_id)->>'ready')::boolean;

  -- NOB: Cliente × Atracação com ATB nos últimos 30 dias, pela regra única
  -- (ADR 0068, item 7; migration 243).
  RETURN QUERY
  WITH berths AS (
    SELECT ts.id AS state_id, ts.voyage_id, upper(btrim(ts.port)) AS port, ts.terminal_id, ts.terminal_atb,
      public.voyage_terminal_code(ts.terminal_id) AS terminal_code, v.voyage_number, vs.name AS vessel_name
    FROM public.voyage_escala_terminal_state ts
    JOIN public.voyages v ON v.id = ts.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE ts.terminal_id IS NOT NULL
      AND v.status IS DISTINCT FROM 'cancelled'
      AND ts.terminal_atb IS NOT NULL
      AND ts.terminal_atb <= v_as_of
      AND ts.terminal_atb >= v_as_of - interval '30 days'
      AND public.voyage_terminal_code(ts.terminal_id) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communication_scale_schedules(ts.voyage_id, ts.port) s
        WHERE s.deleted OR s.omitted)
  -- 447: MATERIALIZED pelo mesmo motivo do NOA/NOR.
  ), grouped AS MATERIALIZED (
    SELECT br.state_id, br.voyage_id, br.port, br.terminal_id, br.terminal_atb, br.terminal_code,
      br.voyage_number, br.vessel_name, b.customer_id, c.name AS customer_name, c.cnpj_cpf,
      array_agg(DISTINCT b.id ORDER BY b.id) AS bl_ids
    FROM berths br
    JOIN public.bls b ON b.voyage_id = br.voyage_id AND public.normalize_port_code(b.pod) = public.normalize_port_code(br.port)
    JOIN public.customers c ON c.id = b.customer_id AND c.deactivated_at IS NULL
    WHERE COALESCE(b.financial_status, 'pending') <> 'cancelled'
      AND b.cancelled_at IS NULL
      AND public.bl_belongs_to_atracacao(b.id, br.state_id)
    GROUP BY br.state_id, br.voyage_id, br.port, br.terminal_id, br.terminal_atb, br.terminal_code,
      br.voyage_number, br.vessel_name, b.customer_id, c.name, c.cnpj_cpf
  ), addressed AS (
    SELECT g.*, public.customer_communication_automatic_recipients(g.customer_id, ARRAY['documentacao_operacao']) AS recipients
    FROM grouped g
  )
  SELECT 'aviso_atracacao_nob'::text, 'avisos_operacionais'::text,
    'aviso_atracacao_nob:' || a.customer_id || ':' || a.state_id,
    a.customer_id, a.customer_name, a.cnpj_cpf, a.voyage_id, a.vessel_name, a.voyage_number, a.port,
    a.terminal_atb, to_char(a.terminal_atb AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    a.state_id, a.terminal_id, a.terminal_code, a.bl_ids, pr.pending
  FROM addressed a
  CROSS JOIN LATERAL (
    SELECT public.customer_communication_target_pending_recipients('aviso_atracacao_nob', a.customer_id, a.voyage_id, a.port, a.state_id, a.recipients) AS pending
    -- 447: OFFSET 0 avalia os pendentes uma vez por alvo (sem ele, o WHERE e o
    -- SELECT chamavam a função duas vezes).
    OFFSET 0
  ) pr
  WHERE pr.pending IS NOT NULL;
END;
$function$;

-- Gatilhos no que deixa um alvo pronto. Intervalo de 90 s (cabeçalho, item 5).
DROP TRIGGER IF EXISTS trg_kick_customer_communications_on_bl_insert ON public.bls;
CREATE TRIGGER trg_kick_customer_communications_on_bl_insert
  AFTER INSERT ON public.bls
  FOR EACH ROW
  WHEN (NEW.customer_id IS NOT NULL)
  EXECUTE FUNCTION public._kick_edge_job_trigger('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET', 'X-Communication-Automation-Secret', '', '90 seconds');

DROP TRIGGER IF EXISTS trg_kick_customer_communications_on_bl_update ON public.bls;
CREATE TRIGGER trg_kick_customer_communications_on_bl_update
  AFTER UPDATE OF customer_id, voyage_id, pod, terminal_id, financial_status, cancelled_at, ce_mercante,
    review_status, cargo_mode, bb_weight_ton, charges_calculated_at ON public.bls
  FOR EACH ROW
  WHEN (NEW.customer_id IS NOT NULL AND (
    OLD.customer_id IS DISTINCT FROM NEW.customer_id
    OR OLD.voyage_id IS DISTINCT FROM NEW.voyage_id
    OR OLD.pod IS DISTINCT FROM NEW.pod
    OR OLD.terminal_id IS DISTINCT FROM NEW.terminal_id
    OR OLD.financial_status IS DISTINCT FROM NEW.financial_status
    OR OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at
    OR OLD.ce_mercante IS DISTINCT FROM NEW.ce_mercante
    OR OLD.review_status IS DISTINCT FROM NEW.review_status
    OR OLD.cargo_mode IS DISTINCT FROM NEW.cargo_mode
    OR OLD.bb_weight_ton IS DISTINCT FROM NEW.bb_weight_ton
    OR OLD.charges_calculated_at IS DISTINCT FROM NEW.charges_calculated_at))
  EXECUTE FUNCTION public._kick_edge_job_trigger('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET', 'X-Communication-Automation-Secret', '', '90 seconds');

-- ETA, ATA, omissão e exclusão da Escala moram em audit_logs
-- (customer_communication_scale_schedules).
DROP TRIGGER IF EXISTS trg_kick_customer_communications_on_schedule ON public.audit_logs;
CREATE TRIGGER trg_kick_customer_communications_on_schedule
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW
  WHEN (NEW.entity_type = 'voyage_pod_schedule' AND NEW.field_name IN ('eta', 'ata', 'omitted', 'deleted'))
  EXECUTE FUNCTION public._kick_edge_job_trigger('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET', 'X-Communication-Automation-Secret', '', '90 seconds');

DROP TRIGGER IF EXISTS trg_kick_customer_communications_on_berth ON public.voyage_escala_terminal_state;
CREATE TRIGGER trg_kick_customer_communications_on_berth
  AFTER INSERT OR UPDATE OF terminal_atb, terminal_id ON public.voyage_escala_terminal_state
  FOR EACH ROW
  WHEN (NEW.terminal_atb IS NOT NULL AND NEW.terminal_id IS NOT NULL)
  EXECUTE FUNCTION public._kick_edge_job_trigger('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET', 'X-Communication-Automation-Secret', '', '90 seconds');

DROP TRIGGER IF EXISTS trg_kick_customer_communications_on_box_link ON public.customer_contact_box_links;
CREATE TRIGGER trg_kick_customer_communications_on_box_link
  AFTER INSERT ON public.customer_contact_box_links
  FOR EACH ROW
  EXECUTE FUNCTION public._kick_edge_job_trigger('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET', 'X-Communication-Automation-Secret', '', '90 seconds');

DROP TRIGGER IF EXISTS trg_kick_customer_communications_on_contact ON public.customer_contacts;
CREATE TRIGGER trg_kick_customer_communications_on_contact
  AFTER UPDATE OF email, deactivated_at ON public.customer_contacts
  FOR EACH ROW
  WHEN (NEW.deactivated_at IS NULL AND (
    OLD.email IS DISTINCT FROM NEW.email OR OLD.deactivated_at IS DISTINCT FROM NEW.deactivated_at))
  EXECUTE FUNCTION public._kick_edge_job_trigger('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET', 'X-Communication-Automation-Secret', '', '90 seconds');

-- ===========================================================================
-- 6. Régua de Cobrança: disparo na emissão, só com a janela aberta
-- ===========================================================================

-- Fora da janela (fim de semana, feriado, antes das 9h de Brasília) a seleção
-- não devolve nada; o disparo seria uma invocação vazia. A primeira rodada do
-- cron dentro da janela cobra o que venceu fora dela.
CREATE OR REPLACE FUNCTION public._kick_demurrage_dunning_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $kick_demurrage_dunning_trigger$
BEGIN
  IF current_setting('vela.kick_demurrage_dunning', true) = 'on'
     OR NOT public._demurrage_dunning_window_open(now()) THEN
    RETURN NULL;
  END IF;
  PERFORM ops.kick_edge_job('demurrage-dunning', 'DEMURRAGE_DUNNING_SECRET', 'Authorization', 'Bearer ', interval '60 seconds');
  RETURN NULL;
END;
$kick_demurrage_dunning_trigger$;

REVOKE ALL ON FUNCTION public._kick_demurrage_dunning_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_kick_demurrage_dunning_on_issue ON public.demurrage_invoices;
CREATE TRIGGER trg_kick_demurrage_dunning_on_issue
  AFTER INSERT ON public.demurrage_invoices
  FOR EACH ROW
  WHEN (NEW.first_billed_at IS NOT NULL)
  EXECUTE FUNCTION public._kick_demurrage_dunning_trigger();

DROP TRIGGER IF EXISTS trg_kick_demurrage_dunning_on_first_billing ON public.demurrage_invoices;
CREATE TRIGGER trg_kick_demurrage_dunning_on_first_billing
  AFTER UPDATE OF first_billed_at ON public.demurrage_invoices
  FOR EACH ROW
  WHEN (OLD.first_billed_at IS NULL AND NEW.first_billed_at IS NOT NULL)
  EXECUTE FUNCTION public._kick_demurrage_dunning_trigger();

-- ===========================================================================
-- 7. Jobs de rede de segurança
-- ===========================================================================

DO $schedule_447$
DECLARE
  r       RECORD;
  v_jobid bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE WARNING '447: pg_cron ausente; horários dos jobs não alterados.';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('customer-communication-auto-runner', '1-59/2 * * * *'),
      ('demurrage-dunning',                  '3-59/5 * * * *')
    ) AS t(jobname, schedule)
  LOOP
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = r.jobname;
    IF v_jobid IS NULL THEN
      RAISE WARNING '447: job % ausente; nada a reagendar.', r.jobname;
      CONTINUE;
    END IF;
    -- Só o horário: jobid, comando e ativo/pausado ficam como estão.
    PERFORM cron.alter_job(v_jobid, schedule := r.schedule);
  END LOOP;
END;
$schedule_447$;
