-- 358: a baixa automática do Itaú não para em silêncio (plano da frente
-- financeira, F-09).
--
-- Problema: um Pix em formato inesperado, um erro passageiro que se repetia
-- (SQLSTATE 08/40/53/55/57/XX relançado por `itau_pix_settle`, 153) ou mais
-- de 50 páginas no período faziam a Edge Function `itau-pix` lançar antes de
-- salvar o checkpoint: a consulta ficava parada para sempre. A Edge
-- respondia 200 mesmo assim, e `rotina_http_falhou` (310) só lê o status. O
-- aviso de consulta parada só aparecia na tela de Conciliação. Os jobs
-- `itau-pix-queue` e `recalc-demurrage-ptax` existiam só em produção,
-- agendados à mão; um banco recriado ficava sem eles.
--
-- Mudança:
--   1. `itau_pix_receipt_failures` guarda o recebimento que não pôde ser
--      baixado. `itau_pix_receipt_failed` conta as tentativas: formato
--      inválido (permanente) ou a terceira falha passageira manda o
--      recebimento para análise, abre `pix_unreconciled` e deixa a consulta
--      avançar; antes disso, a Edge para sem avançar e tenta no minuto
--      seguinte.
--   2. Alerta crítico `itau_pix_consulta_parada` (Administrativo e
--      Financeiro): com a cobrança Itaú ligada, o checkpoint parado há mais de
--      15 minutos abre o Alerta; quando anda, fecha. Job SQL puro
--      `itau-pix-checkpoint-health` a cada 5 minutos: não depende da Edge.
--   3. Os jobs `itau-pix-queue` (a cada minuto) e `recalc-demurrage-ptax`
--      (17:00 UTC, segunda a sexta) passam a ser criados por migration, pelo
--      dispatcher (`ops.dispatch_edge_job`), como os demais.
--   4. A Edge Function responde fora de 2xx quando a fila ou a consulta falha
--      (código em supabase/functions/itau-pix).
--
-- Não altera nem apaga linhas existentes.

CREATE TABLE public.itau_pix_receipt_failures (
  failure_key text PRIMARY KEY,
  end_to_end_id text,
  txid text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'retrying' CHECK (status IN ('retrying', 'review', 'handled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.itau_pix_receipt_failures IS
  'Recebimento Itaú que a consulta não conseguiu baixar (F-09): conta tentativas e vai para análise sem travar o checkpoint.';
ALTER TABLE public.itau_pix_receipt_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.itau_pix_receipt_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.itau_pix_receipt_failures TO authenticated;
GRANT ALL ON public.itau_pix_receipt_failures TO service_role;
CREATE POLICY itau_pix_receipt_failures_select_read ON public.itau_pix_receipt_failures
  FOR SELECT TO authenticated USING ((SELECT public.is_active_read_user()));

CREATE OR REPLACE FUNCTION public.itau_pix_receipt_failed(
  p_end_to_end_id text, p_txid text, p_raw jsonb, p_error text, p_permanent boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text := coalesce(nullif(btrim(p_end_to_end_id), ''), 'raw:' || md5(coalesce(p_raw, '{}'::jsonb)::text));
  v_row public.itau_pix_receipt_failures%ROWTYPE;
  v_previous_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  INSERT INTO public.itau_pix_receipt_failures (failure_key, end_to_end_id, txid, raw, last_error)
  VALUES (v_key, nullif(btrim(p_end_to_end_id), ''), nullif(btrim(p_txid), ''), coalesce(p_raw, '{}'::jsonb), left(coalesce(p_error, 'sem motivo'), 500))
  ON CONFLICT (failure_key) DO UPDATE
    SET attempts = itau_pix_receipt_failures.attempts + 1,
        last_error = EXCLUDED.last_error,
        raw = EXCLUDED.raw,
        updated_at = now()
  RETURNING * INTO v_row;

  IF v_row.status <> 'retrying' THEN RETURN 'review'; END IF;
  IF NOT coalesce(p_permanent, false) AND v_row.attempts < 3 THEN RETURN 'retry'; END IF;

  UPDATE public.itau_pix_receipt_failures SET status = 'review', updated_at = now() WHERE failure_key = v_key;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt_failure', v_key,
    'Recebimento Itaú (TXID ' || coalesce(nullif(btrim(p_txid), ''), 'desconhecido')
      || ') não foi baixado depois de ' || v_row.attempts || ' tentativa(s): ' || v_row.last_error
      || '. Confira no extrato e dê a baixa manual; a consulta seguiu para os próximos.',
    'itau_pix', 'administrativo',
    jsonb_build_object('end_to_end_id', p_end_to_end_id, 'txid', p_txid, 'raw', p_raw, 'error', v_row.last_error),
    '/reconciliacao');
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  RETURN 'review';
END;
$$;
REVOKE ALL ON FUNCTION public.itau_pix_receipt_failed(text, text, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itau_pix_receipt_failed(text, text, jsonb, text, boolean) TO service_role;

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES ('itau_pix_consulta_parada', 'critical', 'administrativo', ARRAY['administrativo', 'financeiro'], '/reconciliacao')
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reconcile_itau_pix_checkpoint_alert(p_threshold interval DEFAULT interval '15 minutes')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_provider text;
  v_until timestamptz;
  v_minutes integer;
  v_state jsonb;
BEGIN
  SELECT pix_provider, itau_pix_polled_until INTO v_provider, v_until FROM public.app_settings WHERE id = 1;
  v_minutes := CASE WHEN v_until IS NULL THEN NULL ELSE floor(extract(epoch FROM now() - v_until) / 60)::integer END;
  v_state := jsonb_build_object('provider', v_provider, 'polled_until', v_until, 'minutes', v_minutes);
  -- Chamada pelo pg_cron, sem JWT: o Alerta exige executor autorizado.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  IF v_provider = 'itau' AND (v_until IS NULL OR now() - v_until > coalesce(p_threshold, interval '15 minutes')) THEN
    PERFORM public.upsert_alert_item('itau_pix_consulta_parada', 'itau_pix_checkpoint', 'itau_pix_polled_until',
      CASE WHEN v_until IS NULL THEN 'A consulta de recebimentos do Itaú nunca rodou com a cobrança Itaú ligada.'
        ELSE format('A consulta de recebimentos do Itaú não avança há %s minutos: Pix pagos depois de %s não são baixados.',
          v_minutes, to_char(v_until AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')) END
        || ' Use o plano B (Conciliar extrato) e avise o suporte.',
      'itau-pix-checkpoint-health', 'administrativo', v_state, '/reconciliacao');
  ELSE
    PERFORM public.resolve_alert_item('itau_pix_consulta_parada', 'itau_pix_checkpoint', 'itau_pix_polled_until',
      'itau-pix-checkpoint-health', v_state);
  END IF;
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  RETURN v_state;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_itau_pix_checkpoint_alert(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_itau_pix_checkpoint_alert(interval) TO service_role;

DO $schedule_358$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE WARNING '358: pg_cron ausente; agende itau-pix-checkpoint-health, itau-pix-queue e recalc-demurrage-ptax no ambiente de produção.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'itau-pix-checkpoint-health') THEN
    PERFORM cron.unschedule('itau-pix-checkpoint-health');
  END IF;
  PERFORM cron.schedule('itau-pix-checkpoint-health', '1-59/5 * * * *',
    $job_358a$SELECT public.reconcile_itau_pix_checkpoint_alert();$job_358a$);

  IF to_regprocedure('ops.dispatch_edge_job(text,text,text,text)') IS NULL THEN
    RAISE WARNING '358: ops.dispatch_edge_job ausente; agende itau-pix-queue e recalc-demurrage-ptax no ambiente de produção.';
    RETURN;
  END IF;
  -- Mesmo nome e corpo dos jobs criados à mão em 07/10 (jobids 25 e 26): a
  -- migration os recria, e um banco novo passa a tê-los.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'itau-pix-queue') THEN
    PERFORM cron.unschedule('itau-pix-queue');
  END IF;
  PERFORM cron.schedule('itau-pix-queue', '* * * * *',
    $job_358b$SELECT ops.dispatch_edge_job('itau-pix', 'ITAU_PIX_ADMIN_SECRET');$job_358b$);
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recalc-demurrage-ptax') THEN
    PERFORM cron.unschedule('recalc-demurrage-ptax');
  END IF;
  PERFORM cron.schedule('recalc-demurrage-ptax', '0 17 * * 1-5',
    $job_358c$SELECT ops.dispatch_edge_job('recalc-demurrage-ptax', 'RECALC_CRON_SECRET');$job_358c$);
END;
$schedule_358$;
