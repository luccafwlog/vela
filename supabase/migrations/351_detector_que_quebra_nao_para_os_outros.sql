-- 351: um detector que quebra não para os outros (revisão dos alertas de
-- 2026-10-21, docs/revisao-alertas-2026-10.md; achado A1, decisão P5 e
-- sugestão S12).
--
-- Problema: `run_alert_detectors` (309) chama os oito detectores na mesma
-- transação, sem isolamento. A exceção de um deles desfaz o trabalho de todos e
-- a chamada devolve erro: nenhum alerta abre nem fecha naquela rodada, e as
-- rodadas seguintes repetem a falha até alguém corrigir o dado ou o código. Foi
-- o que aconteceu em VELA-24/25 (a 339 tirou a causa, não o acoplamento).
--
-- Mudança: cada detector roda no próprio bloco com EXCEPTION (subtransação). O
-- que falha é desfeito sozinho, vira WARNING no log do banco e entra no retorno:
-- `failed` (quantos falharam) e `failures` (detector, SQLSTATE e mensagem). As
-- chaves de resultado da 309 continuam; a do detector que falhou vem `null`. A
-- Edge `alerts-detector` responde 2xx com esse retorno, o heartbeat do Better
-- Stack recebe `/fail` quando `failed > 0` (regra de
-- `supabase/functions/_shared/betterStackHeartbeat.ts`) e o Sentry recebe um
-- evento por detector, com o nome e o SQLSTATE.
--
-- ponytail: `EXCEPTION WHEN OTHERS` não pega `query_canceled`: um detector que
-- estoura o `statement_timeout` ainda derruba a rodada inteira, como antes.
-- Caminho de melhoria: a Edge chamar cada detector numa requisição própria.
--
-- Só troca a função; não altera nem apaga linhas.
-- Rollback: reaplicar a definição de `run_alert_detectors` da migration 309.

CREATE OR REPLACE FUNCTION public.run_alert_detectors() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor UUID;
  v_detector RECORD;
  v_value JSONB;
  v_sqlstate TEXT;
  v_message TEXT;
  v_result JSONB := '{}'::jsonb;
  v_failures JSONB := '[]'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_actor
  FROM public.user_profiles
  WHERE active = true AND role <> 'equipamentos'
  ORDER BY CASE WHEN role IN ('admin', 'administrativo') THEN 0 ELSE 1 END, created_at, id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Não há usuário interno ativo para executar os detectores.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::TEXT, true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('alerts.detector_runner', 'on', true);

  -- Faturas vencidas saíram do runner: taxa local não tem vencimento praticado
  -- (issue #605). O Demurrage nunca teve (ADR 0014).

  -- Ordem e chaves da 309. Cada detector roda numa subtransação: a falha de um
  -- desfaz só o trabalho dele (351).
  FOR v_detector IN
    SELECT d.result_key, d.function_name
    FROM (VALUES
      -- ADR - Relatório de Saída da Agência (Bloco 5)
      (1, 'agency_report_pending', 'detect_agency_report_pending'),
      (2, 'agency_report_deadline_missed', 'detect_agency_report_deadline_missed'),
      -- Revisão Manual de B/L e Granito (Bloco 1)
      (3, 'bl_review_pendencies', 'detect_bl_review_pendencies'),
      (4, 'granite_bl_review_pendencies', 'detect_granite_bl_review_pendencies'),
      -- Operação e Viagens (Bloco 4)
      (5, 'voyage_operation_alerts', 'detect_voyage_operation_alerts'),
      -- Portal do Cliente e Disputas (Bloco 2)
      (6, 'client_portal', 'reconcile_client_portal_alerts'),
      -- Comunicados ao Cliente: NOA/NOR/NOB e falha de contato alternativo.
      (7, 'customer_communications', 'detect_customer_communication_alerts'),
      -- E-mails: provedor sem retorno e usuário interno com e-mail devolvido (309).
      (8, 'email_monitoring', 'detect_email_monitoring_alerts')
    ) AS d(ord, result_key, function_name)
    ORDER BY d.ord
  LOOP
    BEGIN
      EXECUTE format('SELECT to_jsonb(public.%I())', v_detector.function_name) INTO v_value;
      v_result := v_result || jsonb_build_object(v_detector.result_key, v_value);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      RAISE WARNING 'Detector de alertas % falhou (%): %', v_detector.function_name, v_sqlstate, v_message;
      v_result := v_result || jsonb_build_object(v_detector.result_key, NULL);
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'detector', v_detector.function_name,
        'sqlstate', v_sqlstate,
        'message', v_message
      ));
    END;
  END LOOP;

  RETURN v_result || jsonb_build_object(
    'failed', jsonb_array_length(v_failures),
    'failures', v_failures
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_alert_detectors() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_alert_detectors() TO service_role;
