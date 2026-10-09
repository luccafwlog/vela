-- Migration 168: o vencimento da Liberação de faturamento sem Portal devolve
-- à Revisão os B/Ls não faturados do Cliente, por um job diário.
--
-- Antes: a 167 pôs em `customer_billing_portal_releases` o gatilho que reavalia
-- a Revisão na concessão e na revogação. O vencimento (`review_at` no passado)
-- não é evento do banco: o gate de emissão lê `now()` e trava na hora, mas os
-- B/Ls continuavam `reviewed`, sem "Pendencias de importacao: Acesso ao portal
-- nao provisionado", até alguém salvar a revisão ou mexer no Portal, nos
-- contatos ou em outra Liberação.
--
-- Agora `reevaluate_expired_billing_releases(p_lookback)` procura os Clientes
-- com Liberação não revogada cujo `review_at` caiu em (now() - p_lookback,
-- now()] e que não têm acesso pronto (`customer_billing_access_ready`: nem outra
-- Liberação vigente nem Portal pronto). Para cada B/L não faturado desses
-- Clientes, em `pending_review` ou `reviewed`, chama `recompute_bl_review_status`,
-- e reconcilia o Alerta do Cliente uma vez no fim (`reconcile_customer_bl_review_alerts`).
--
-- ponytail: quando o status de um B/L muda, o gatilho de linha
-- `trg_reconcile_bl_review_alerts` (002) já reconcilia o Alerta do Cliente; o
-- primeiro B/L do lote abre o Alerta e a notificação sai com a contagem
-- parcial. O Alerta termina com a contagem certa. É o mesmo comportamento da
-- revogação (167) e da suspensão do Portal (002). Caminho de upgrade: um GUC
-- que suspenda o gatilho de linha durante lotes, reconciliando no fim. O pg_cron roda a
-- função uma vez por dia, às 03:13 UTC (00:13 de Brasília), fora dos minutos
-- cheios (ver 165): o B/L de uma Liberação vencida volta à fila até a
-- madrugada seguinte ao vencimento.
--
-- ponytail: sem registro da última execução. A janela padrão é de 7 dias, e a
-- reavaliação é idempotente (`recompute_bl_review_status` só escreve quando o
-- status ou a nota mudam), então cada Cliente é reavaliado por até 7 rodadas e
-- um job parado por até 6 dias não perde vencimentos. Teto: parado por mais de
-- 7 dias, os vencimentos mais antigos esperam a próxima reavaliação do B/L, ou
-- uma chamada manual com janela maior. Caminho de upgrade: guardar a última
-- execução numa tabela de estado e usar (última execução, now()].
--
-- B/L cancelado: `recompute_bl_review_status` (002) passa a devolver o status
-- sem escrever quando `cancelled_at` está preenchido. Antes, o B/L cancelado
-- de um Cliente (somente leitura desde a 089) fazia `guard_bl_state_and_ce`
-- recusar a escrita e abortar a transação inteira: o job, o bloco final, e
-- também os gatilhos de Portal, contatos e Liberação (002/167). O resto da
-- função é o da 002, sem mudança. A varredura deste job já não seleciona
-- B/L cancelado.
--
-- Casos já parados: o bloco final roda a função uma vez com janela de 10 anos.
-- Reescreve linhas existentes de `bls` e depende da afirmação "Data status" do
-- AGENTS.md (produção sem dados de negócio).
--
-- Rollback: SELECT cron.unschedule('billing-release-expiry-review');
--   DROP FUNCTION public.reevaluate_expired_billing_releases(interval);
--   e reaplicar `recompute_bl_review_status` da 002.

BEGIN;

CREATE OR REPLACE FUNCTION public.recompute_bl_review_status(p_bl_id text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_reasons TEXT[];
  v_status TEXT;
  v_human_notes TEXT;
  v_notes TEXT;
BEGIN
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- B/L cancelado é somente leitura (089): `guard_bl_state_and_ce` recusa a
  -- escrita e abortaria a transação do chamador inteiro.
  IF v_bl.cancelled_at IS NOT NULL THEN
    RETURN v_bl.review_status;
  END IF;

  -- O gate trava a emissão; não desfaz o que já foi emitido.
  IF COALESCE(v_bl.financial_status, '') IN ('invoiced', 'partially_paid', 'paid') THEN
    RETURN v_bl.review_status;
  END IF;

  -- Só os dois estados que o gate governa; qualquer outro fica fora do alcance.
  IF COALESCE(v_bl.review_status, '') NOT IN ('pending_review', 'reviewed') THEN
    RETURN v_bl.review_status;
  END IF;

  v_reasons := public.compute_bl_review_pendencies(p_bl_id);
  v_status := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed'
    ELSE 'pending_review'
  END;

  v_human_notes := btrim(
    regexp_replace(
      COALESCE(v_bl.notes, ''),
      E'(^|\\n)Pendencias de importacao:[^\\n]*$',
      '',
      'i'
    )
  );

  v_notes := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(
      E'\n',
      NULLIF(v_human_notes, ''),
      'Pendencias de importacao: ' || array_to_string(v_reasons, ', ')
    )
    ELSE NULLIF(v_human_notes, '')
  END;

  -- Sem mudança não se escreve: evita `updated_at` novo (e o conflito de edição
  -- concorrente na Revisão) a cada passagem do trigger.
  IF v_bl.review_status IS DISTINCT FROM v_status OR v_bl.notes IS DISTINCT FROM v_notes THEN
    UPDATE public.bls SET review_status = v_status, notes = v_notes WHERE id = p_bl_id;
  END IF;

  RETURN v_status;
END;
$_$;

CREATE OR REPLACE FUNCTION public.reevaluate_expired_billing_releases(
  p_lookback interval DEFAULT interval '7 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn_168$
DECLARE
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_customer_id bigint;
  v_bl_id text;
  v_customers integer := 0;
  v_bls integer := 0;
BEGIN
  IF p_lookback IS NULL OR p_lookback <= interval '0' THEN
    RAISE EXCEPTION 'Janela de vencimento inválida.' USING ERRCODE = '22023';
  END IF;

  -- Chamada pelo pg_cron, sem JWT. A reconciliação de Alertas exige um ator
  -- autorizado; o papel de serviço vale só até o fim desta função.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('alerts.foundation_trigger', 'on', true);

  FOR v_customer_id IN
    SELECT DISTINCT r.customer_id
    FROM public.customer_billing_portal_releases AS r
    WHERE r.revoked_at IS NULL
      AND r.review_at <= now()
      AND r.review_at > now() - p_lookback
      AND NOT public.customer_billing_access_ready(r.customer_id)
  LOOP
    v_customers := v_customers + 1;
    FOR v_bl_id IN
      SELECT b.id
      FROM public.bls AS b
      WHERE b.customer_id = v_customer_id
        AND b.review_status IN ('pending_review', 'reviewed')
        AND b.cancelled_at IS NULL
        AND COALESCE(b.financial_status, '') NOT IN ('invoiced', 'partially_paid', 'paid')
    LOOP
      PERFORM public.recompute_bl_review_status(v_bl_id);
      v_bls := v_bls + 1;
    END LOOP;
    -- Um Alerta por Cliente, depois do lote: `reconcile_bl_review_alerts` por
    -- B/L reconta todos os B/Ls do Cliente a cada chamada (quadrático) e, com
    -- Cliente vinculado, o consignatário não entra na conta.
    PERFORM public.reconcile_customer_bl_review_alerts(v_customer_id, NULL, 'billing_release_expired');
  END LOOP;

  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_role, ''), true);

  RETURN jsonb_build_object('customers', v_customers, 'bls', v_bls);
END;
$fn_168$;

REVOKE ALL ON FUNCTION public.reevaluate_expired_billing_releases(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reevaluate_expired_billing_releases(interval) TO service_role;

-- Casos já parados: Liberações vencidas antes desta migration.
SELECT public.reevaluate_expired_billing_releases(interval '10 years');

DO $job_168$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing-release-expiry-review') THEN
      PERFORM cron.unschedule('billing-release-expiry-review');
    END IF;
    PERFORM cron.schedule(
      'billing-release-expiry-review',
      '13 3 * * *',
      $cmd_168$SELECT public.reevaluate_expired_billing_releases();$cmd_168$
    );
  ELSE
    RAISE WARNING '168: pg_cron ausente; agende public.reevaluate_expired_billing_releases() diariamente neste ambiente.';
  END IF;
END;
$job_168$;

COMMIT;
