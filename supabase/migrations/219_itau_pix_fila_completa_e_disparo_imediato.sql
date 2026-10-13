-- Migration 219: a fila de cobranças Pix do Itaú processa todos os estados
-- pendentes e anda em segundos, não no minuto seguinte.
--
-- Evidência (produção, 2026-10-13): `itau_pix_claim` (151) só reserva
-- `pending_create` e `pending_cancel`. Os estados que a 153 criou nunca são
-- reservados:
--   - `pending_update`: PTAX nova da Demurrage e renovação das Taxas Locais
--     7 dias antes do vencimento nunca chegam ao Itaú; a cobrança fica com o
--     valor e a validade antigos (pagamento do valor antigo vira Alerta
--     `pix_unreconciled`, sem baixa);
--   - `pending_expire_check`: cobrança vencida nunca é conferida nem
--     substituída; a fatura fica sem QR ("QR em preparação") para sempre. A
--     Demurrage vence no corte diário.
-- Tempo até o QR medido nas 11 cobranças de 07–08/10: mediana 25 s, máximo
-- 56 s (só o job de 1 minuto, 20 cobranças por chamada).
--
-- Mudanças (o orçamento de tempo e a parada no 429 estão na Edge Function):
--   1. `itau_pix_claim` reserva os quatro estados pendentes.
--   2. Vez única do runner Pix (`ops.itau_pix_runner_lease`), no mesmo
--      desenho da 218: renovada antes de cada bloco; a chamada sem a vez não
--      processa cobranças. Duas execuções simultâneas poderiam repetir uma
--      escrita no Itaú cuja reserva venceu (a reserva da cobrança é de 1 min).
--   3. `ops.kick_itau_pix_runner()` chama a função `itau-pix` com
--      `{"action":"process_charges"}` uma vez por transação que deixa
--      cobrança pendente e vencida para processar (emissão, cancelamento,
--      PTAX, prazos). Só a fila: recebimentos e prazos seguem no job de 1 min.
--      Sem o par no Vault, não dispara nem avisa; falha do pg_net vira WARNING
--      e nunca derruba a emissão.
--   4. `itau_pix_maintain` renova as Taxas Locais com folga de 7 dias ou
--      metade da validade configurada, o que for menor: validade abaixo de
--      7 dias pedia uma alteração ao Itaú por minuto, agora que a renovação
--      chega à fila.
--
-- Não reescreve nem apaga linhas de negócio.
--
-- Rollback:
--   DROP TRIGGER trg_kick_itau_pix_runner_insert ON public.itau_pix_charges;
--   DROP TRIGGER trg_kick_itau_pix_runner_update ON public.itau_pix_charges;
--   DROP FUNCTION public._kick_itau_pix_runner_trigger();
--   DROP FUNCTION ops.kick_itau_pix_runner();
--   DROP FUNCTION public.acquire_itau_pix_runner(text, integer);
--   DROP FUNCTION public.release_itau_pix_runner(text);
--   DROP TABLE ops.itau_pix_runner_lease;
--   e reaplicar `itau_pix_claim` da 151 e `itau_pix_maintain` da 153.

-- ===========================================================================
-- 1. Reserva dos quatro estados pendentes
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.itau_pix_claim(p_limit integer DEFAULT 20)
RETURNS SETOF public.itau_pix_charges LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  UPDATE public.itau_pix_charges c SET attempts = c.attempts + 1, updated_at = now(),
    -- 1, 2, 4… minutos, até 60.
    next_attempt_at = now() + least(power(2, c.attempts), 60) * interval '1 minute'
  WHERE c.id IN (
    SELECT id FROM public.itau_pix_charges
    -- Os quatro estados de trabalho (índice itau_pix_charges_work, 153).
    WHERE status IN ('pending_create', 'pending_update', 'pending_expire_check', 'pending_cancel')
      AND next_attempt_at <= now()
    ORDER BY next_attempt_at LIMIT greatest(least(p_limit, 100), 1)
    FOR UPDATE SKIP LOCKED)
  RETURNING c.*;
END;
$$;

-- ===========================================================================
-- 2. Vez única do runner Pix
-- ===========================================================================

CREATE TABLE IF NOT EXISTS ops.itau_pix_runner_lease (
  singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  holder      text,
  lease_until timestamptz
);
INSERT INTO ops.itau_pix_runner_lease (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;
REVOKE ALL ON TABLE ops.itau_pix_runner_lease FROM PUBLIC, anon, authenticated, service_role;
-- RLS sem policy: só as funções abaixo (SECURITY DEFINER, donas da tabela)
-- leem e escrevem a vez.
ALTER TABLE ops.itau_pix_runner_lease ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ops.itau_pix_runner_lease IS
  'Vez única do runner da fila Pix Itaú (migration 219): um runner por vez, renovada antes de cada bloco.';

-- Obtém ou renova a vez. Verdadeiro quando quem chama fica com ela.
CREATE OR REPLACE FUNCTION public.acquire_itau_pix_runner(p_worker_id text, p_lease_seconds integer DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $acquire$
DECLARE
  v_worker text := NULLIF(btrim(COALESCE(p_worker_id, '')), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF v_worker IS NULL OR char_length(v_worker) > 128 THEN
    RAISE EXCEPTION 'Worker invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'Lease invalido.' USING ERRCODE = '22023';
  END IF;

  UPDATE ops.itau_pix_runner_lease
     SET holder = v_worker,
         lease_until = now() + make_interval(secs => p_lease_seconds)
   WHERE singleton
     AND (holder = v_worker OR lease_until IS NULL OR lease_until <= now());
  RETURN FOUND;
END;
$acquire$;

-- Devolve a vez; só quem a tem pode devolver.
CREATE OR REPLACE FUNCTION public.release_itau_pix_runner(p_worker_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $release$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  UPDATE ops.itau_pix_runner_lease
     SET holder = NULL, lease_until = NULL
   WHERE singleton AND holder = p_worker_id;
END;
$release$;

REVOKE ALL ON FUNCTION public.acquire_itau_pix_runner(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_itau_pix_runner(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_itau_pix_runner(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_itau_pix_runner(text) TO service_role;

-- ===========================================================================
-- 3. Disparo pela transação que deixa cobrança pendente
-- ===========================================================================

-- Não usa `ops.dispatch_edge_job`: aquele manda corpo vazio, que a função
-- trata como o ciclo completo (prazos, fila e recebimentos). O disparo só
-- precisa da fila.
CREATE OR REPLACE FUNCTION ops.kick_itau_pix_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $kick$
DECLARE
  v_base   text;
  v_secret text;
BEGIN
  -- Uma chamada por transação: uma emissão em lote mexe em várias cobranças.
  IF current_setting('vela.itau_pix_kicked', true) = 'on' THEN
    RETURN;
  END IF;
  PERFORM set_config('vela.itau_pix_kicked', 'on', true);

  SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'ITAU_PIX_ADMIN_SECRET';
  -- Sem o par no Vault (banco novo, Preview): pula em silêncio.
  IF NULLIF(v_base, '') IS NULL OR NULLIF(v_secret, '') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    -- 30 s, como o dispatcher da 165. O pg_net envia após o COMMIT.
    PERFORM net.http_post(
      url                  := v_base || '/functions/v1/itau-pix',
      headers              := jsonb_build_object('Authorization', 'Bearer ' || v_secret,
                                                 'Content-Type', 'application/json'),
      body                 := '{"action":"process_charges"}'::jsonb,
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ops.kick_itau_pix_runner: disparo falhou (%); o job de 1 min processa.', SQLERRM;
  END;
END;
$kick$;

COMMENT ON FUNCTION ops.kick_itau_pix_runner() IS
  'Dispara a fila da função itau-pix uma vez por transação (pg_net envia após o COMMIT). Falha vira WARNING. Migration 219.';

REVOKE ALL ON FUNCTION ops.kick_itau_pix_runner() FROM PUBLIC, anon, authenticated;

-- Só dispara quando a instrução deixou cobrança pendente e já vencida: a
-- própria reserva (`itau_pix_claim`) adia `next_attempt_at` e não dispara.
CREATE OR REPLACE FUNCTION public._kick_itau_pix_runner_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $kick_trg$
BEGIN
  IF EXISTS (
    SELECT 1 FROM changed_charges
    WHERE status IN ('pending_create', 'pending_update', 'pending_expire_check', 'pending_cancel')
      AND next_attempt_at <= now()
  ) THEN
    PERFORM ops.kick_itau_pix_runner();
  END IF;
  RETURN NULL;
END;
$kick_trg$;

REVOKE ALL ON FUNCTION public._kick_itau_pix_runner_trigger() FROM PUBLIC, anon, authenticated;

-- Tabela de transição exige um gatilho por evento.
DROP TRIGGER IF EXISTS trg_kick_itau_pix_runner_insert ON public.itau_pix_charges;
CREATE TRIGGER trg_kick_itau_pix_runner_insert
  AFTER INSERT ON public.itau_pix_charges
  REFERENCING NEW TABLE AS changed_charges
  FOR EACH STATEMENT
  EXECUTE FUNCTION public._kick_itau_pix_runner_trigger();

DROP TRIGGER IF EXISTS trg_kick_itau_pix_runner_update ON public.itau_pix_charges;
CREATE TRIGGER trg_kick_itau_pix_runner_update
  AFTER UPDATE ON public.itau_pix_charges
  REFERENCING NEW TABLE AS changed_charges
  FOR EACH STATEMENT
  EXECUTE FUNCTION public._kick_itau_pix_runner_trigger();

-- ===========================================================================
-- 4. Renovação das Taxas Locais sem laço com validade curta
-- ===========================================================================

-- Corpo da 153 com uma mudança (passo 2). Com a reserva corrigida acima, a
-- renovação passa a chegar ao Itaú; a validade configurável aceita de 1 h a
-- 365 dias (151).
CREATE OR REPLACE FUNCTION public.itau_pix_maintain(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_expired integer; v_renewed integer; v_extended integer; v_pending integer;
  v_local_day date := (p_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ref public.exchange_rate_reference%ROWTYPE;
  v_cutoff timestamptz;
BEGIN
  IF (SELECT pix_provider FROM public.app_settings WHERE id = 1) IS DISTINCT FROM 'itau' THEN
    RETURN jsonb_build_object('skipped', 'provider_static');
  END IF;
  -- 1. Passou da validade: confirmar no banco antes de substituir.
  UPDATE public.itau_pix_charges SET status = 'pending_expire_check', next_attempt_at = p_now, updated_at = p_now
  WHERE status = 'active' AND expires_at <= p_now;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- 2. Taxas Locais abertas: renovar a mesma cobrança com 7 dias de folga, ou
  -- metade da validade configurada quando ela for menor que 14 dias (219: com
  -- validade abaixo de 7 dias, a cobrança recém-renovada voltava a pedir
  -- renovação no minuto seguinte, e o Itaú recebia uma alteração por minuto).
  -- ponytail: folga fixa; ajustar se o Itaú limitar a validade máxima.
  UPDATE public.itau_pix_charges c SET status = 'pending_update', next_attempt_at = p_now, updated_at = p_now,
    expiration_seconds = ceil(extract(epoch FROM p_now + make_interval(secs => s.itau_pix_expiration_seconds) - c.bank_created_at))::integer
  FROM public.app_settings s, public.invoices i
  WHERE s.id = 1 AND i.id = c.invoice_id AND c.status = 'active'
    AND c.expires_at < p_now + least(interval '7 days', make_interval(secs => s.itau_pix_expiration_seconds) / 2)
    AND i.status IN ('issued', 'partially_paid', 'overdue');
  GET DIAGNOSTICS v_renewed = ROW_COUNT;

  -- 3. Demurrage que já reflete a PTAX de hoje e não mudou de valor (ROE
  -- igual ao de ontem não dispara o gatilho): estender até o próximo corte.
  SELECT * INTO v_ref FROM public.exchange_rate_reference WHERE id = 1;
  IF v_ref.quote_date = v_local_day THEN
    v_cutoff := public.itau_pix_cutoff(p_now);
    UPDATE public.itau_pix_charges c SET status = 'pending_update', next_attempt_at = p_now, updated_at = p_now,
      expiration_seconds = ceil(extract(epoch FROM v_cutoff - c.bank_created_at))::integer
    FROM public.demurrage_invoices d
    WHERE d.id = c.demurrage_invoice_id AND c.status = 'active' AND c.expires_at < v_cutoff
      AND d.status IN ('issued', 'overdue') AND d.current_roe = v_ref.roe;
    GET DIAGNOSTICS v_extended = ROW_COUNT;
  END IF;

  -- 4. Às 14h de dia útil, Demurrage aberta sem a PTAX do dia confirmada na cobrança.
  IF public.itau_pix_business_day(v_local_day) AND (p_now AT TIME ZONE 'America/Sao_Paulo')::time >= time '14:00' THEN
    SELECT count(*) INTO v_pending FROM public.demurrage_invoices d
    LEFT JOIN public.itau_pix_charges c ON c.demurrage_invoice_id = d.id AND c.status = 'active'
    WHERE d.status IN ('issued', 'overdue') AND coalesce(d.current_total_brl, 0) > 0
      AND (v_ref.quote_date IS DISTINCT FROM v_local_day OR d.current_roe IS DISTINCT FROM v_ref.roe
        OR c.id IS NULL OR c.amount_brl <> d.current_total_brl OR c.expires_at < public.itau_pix_cutoff(p_now));
    IF v_pending > 0 THEN
      PERFORM public.upsert_alert_item('demurrage_ptax_recalc_failed', 'exchange_rate_reference', 'itau-pix-14h',
        v_pending || ' fatura(s) de Demurrage sem a PTAX de hoje refletida na cobrança Pix às 14h. Confira a atualização da PTAX; '
          || 'o corte das 14h30 encerra as cobranças atuais e as novas saem com o último valor disponível.',
        'itau_pix', 'documentacao', jsonb_build_object('pending', v_pending, 'day', v_local_day), '/demurrage');
    ELSE
      PERFORM public.resolve_alert_item('demurrage_ptax_recalc_failed', 'exchange_rate_reference', 'itau-pix-14h',
        'itau_pix', jsonb_build_object('day', v_local_day));
    END IF;
  END IF;

  -- 5. Calendário do ano seguinte, 60 dias antes da virada.
  IF v_local_day >= make_date(extract(year FROM v_local_day)::int, 11, 1)
     AND NOT EXISTS (SELECT 1 FROM public.business_holidays WHERE extract(year FROM day) = extract(year FROM v_local_day) + 1) THEN
    PERFORM public.upsert_alert_item('calendario_feriados_pendente', 'business_holidays', 'itau-pix-calendar',
      'Cadastre os feriados de Vitória/ES de ' || (extract(year FROM v_local_day) + 1) || ' em business_holidays: '
        || 'sem eles o prazo das cobranças Pix da Demurrage conta só fins de semana e vence às 14h30 de feriados.',
      'itau_pix', 'documentacao', jsonb_build_object('year', extract(year FROM v_local_day) + 1), '/demurrage');
  ELSIF EXISTS (SELECT 1 FROM public.business_holidays WHERE extract(year FROM day) = extract(year FROM v_local_day) + 1) THEN
    PERFORM public.resolve_alert_item('calendario_feriados_pendente', 'business_holidays', 'itau-pix-calendar',
      'itau_pix', jsonb_build_object('year', extract(year FROM v_local_day) + 1));
  END IF;

  RETURN jsonb_build_object('expired', v_expired, 'renewed', v_renewed, 'extended', coalesce(v_extended, 0), 'ptax_pending', v_pending);
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_maintain(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_maintain(timestamptz) TO service_role;
