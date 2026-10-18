-- Migration 299: recusa não definitiva da régua automática volta com intervalo
-- crescente e abre o alerta comunicado_recusado (plano dos e-mails, item 1D; D18).
--
-- Até aqui só a recusa definitiva (permanent: true, migration 297) parava a
-- claim. Prontidão bloqueada, contato desativado, escala indisponível, dados
-- incompletos e falha do provedor liberavam a claim e voltavam a cada 15 min,
-- sem prazo e sem alerta.
--
-- 1. customer_communication_automation_claims ganha attempts, last_error,
--    next_attempt_at e provider_failures (falhas seguidas do provedor).
-- 2. defer_customer_communication_automation_claim: o runner adia a claim.
--    Intervalo: 15 min na 1ª recusa, 1 h na 2ª, 6 h da 3ª em diante. A
--    produtora (migration 300) só retoma a claim depois de next_attempt_at.
-- 3. Alerta comunicado_recusado (um por Cliente, lista as claims):
--    - recusa por dado (p_provider_failure = false): na 1ª recusa;
--    - falha do provedor (p_provider_failure = true): na 3ª seguida;
--    - recusa definitiva (reject): na hora, como na 297.
-- 4. complete_customer_communication_automation_claim: o envio saiu; zera a
--    contagem e fecha o alerta quando o Cliente não tem outra claim pendente.
-- 5. refresh_customer_communication_refusal_alert: reescreve ou fecha o
--    alerta a partir das claims; a produtora o chama a cada rodada para tirar
--    claims cujo alvo deixou de existir (janela vencida, envio manual).
-- Só acrescenta colunas com default; não altera nem apaga linhas existentes.

ALTER TABLE public.customer_communication_automation_claims
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

COMMENT ON COLUMN public.customer_communication_automation_claims.attempts IS
  'Recusas não definitivas seguidas desde o último envio. Define o intervalo (15 min, 1 h, 6 h).';
COMMENT ON COLUMN public.customer_communication_automation_claims.provider_failures IS
  'Falhas seguidas do provedor (rede, tempo esgotado, 5xx, 429). O alerta abre na 3ª.';
COMMENT ON COLUMN public.customer_communication_automation_claims.next_attempt_at IS
  'A produtora só retoma a claim a partir deste instante.';

-- Intervalo da próxima tentativa depois de n recusas seguidas (D18).
CREATE OR REPLACE FUNCTION public.customer_communication_retry_interval(p_attempts integer)
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN COALESCE(p_attempts, 0) <= 1 THEN interval '15 minutes'
    WHEN p_attempts = 2 THEN interval '1 hour'
    ELSE interval '6 hours'
  END;
$function$;

-- O alerta é um por Cliente e lista toda claim dele que pede uma pessoa:
-- recusada em definitivo nas últimas 24 h, recusada por dado, ou com 3 falhas
-- seguidas do provedor. Uma claim adiada cujo alvo sumiu deixa de ser retomada;
-- passada 1 h do horário previsto ela sai do alerta.
CREATE OR REPLACE FUNCTION public.refresh_customer_communication_refusal_alert(p_customer_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_name text;
  v_claims jsonb;
  v_summary text;
  v_count integer;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'claim_key', cl.claim_key,
      'kind', split_part(cl.claim_key, ':', 1),
      'reason', COALESCE(cl.rejection_reason, cl.last_error),
      'permanent', cl.rejected_at IS NOT NULL,
      'attempts', cl.attempts,
      'next_attempt_at', cl.next_attempt_at
    ) ORDER BY cl.claim_key),
    string_agg(cl.claim_key || ' (' || COALESCE(cl.rejection_reason, cl.last_error, 'sem motivo')
      || CASE WHEN cl.rejected_at IS NULL AND cl.attempts > 0 THEN '; ' || cl.attempts || 'ª tentativa' ELSE '' END
      || ')', '; ' ORDER BY cl.claim_key),
    count(*)
  INTO v_claims, v_summary, v_count
  FROM public.customer_communication_automation_claims cl
  WHERE split_part(cl.claim_key, ':', 2) = p_customer_id::text
    AND (
      cl.rejected_at >= now() - interval '24 hours'
      OR (cl.rejected_at IS NULL
        AND cl.attempts > 0
        AND (cl.provider_failures = 0 OR cl.provider_failures >= 3)
        AND COALESCE(cl.next_attempt_at, now()) > now() - interval '1 hour')
    );

  BEGIN
    IF COALESCE(v_count, 0) = 0 THEN
      PERFORM public.resolve_alert_item('comunicado_recusado', 'customer', p_customer_id::text, 'comunicado_automacao', '{}'::jsonb);
      RETURN false;
    END IF;

    SELECT c.name INTO v_customer_name FROM public.customers c WHERE c.id = p_customer_id;
    PERFORM public.upsert_alert_item(
      'comunicado_recusado',
      'customer',
      p_customer_id::text,
      'Cliente ' || COALESCE(v_customer_name, p_customer_id::text) || ': ' || v_count
        || ' Comunicado(s) automático(s) sem envio: ' || v_summary,
      'comunicado_automacao',
      jsonb_build_object('customer_id', p_customer_id, 'claims', v_claims),
      '/clientes/comunicacao'
    );
  EXCEPTION WHEN OTHERS THEN
    -- Falha no alerta não desfaz o estado da claim: parar de ciclar vem antes.
    RAISE WARNING 'Alerta comunicado_recusado do Cliente % nao atualizado: %', p_customer_id, SQLERRM;
  END;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.customer_communication_claim_customer_id(p_claim_key text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Toda chave da produtora começa por kind:customer_id:...
  SELECT CASE WHEN split_part(p_claim_key, ':', 2) ~ '^[0-9]+$' THEN split_part(p_claim_key, ':', 2)::bigint END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_customer_communication_automation_claim(p_claim_key text, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := left(COALESCE(NULLIF(btrim(p_reason), ''), 'Recusa sem motivo informado.'), 500);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_claim_key IS NULL OR btrim(p_claim_key) = '' THEN
    RAISE EXCEPTION 'Chave da claim e obrigatoria.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_communication_automation_claims
  SET rejected_at = now(), rejection_reason = v_reason, last_error = v_reason
  WHERE claim_key = p_claim_key;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM public.refresh_customer_communication_refusal_alert(public.customer_communication_claim_customer_id(p_claim_key));
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.defer_customer_communication_automation_claim(
  p_claim_key text,
  p_reason text,
  p_provider_failure boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := left(COALESCE(NULLIF(btrim(p_reason), ''), 'Recusa sem motivo informado.'), 500);
  v_row public.customer_communication_automation_claims%ROWTYPE;
  v_alerted boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_claim_key IS NULL OR btrim(p_claim_key) = '' THEN
    RAISE EXCEPTION 'Chave da claim e obrigatoria.' USING ERRCODE = '22023';
  END IF;

  -- A liberação (released_at preenchido) passa pelo trigger de prontidão do CE
  -- sem revalidar; a retomada só acontece pela produtora, depois do intervalo.
  UPDATE public.customer_communication_automation_claims
  SET attempts = attempts + 1,
      provider_failures = CASE WHEN COALESCE(p_provider_failure, false) THEN provider_failures + 1 ELSE 0 END,
      last_error = v_reason,
      next_attempt_at = now() + public.customer_communication_retry_interval(attempts + 1),
      released_at = COALESCE(released_at, now())
  WHERE claim_key = p_claim_key
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_alerted := public.refresh_customer_communication_refusal_alert(public.customer_communication_claim_customer_id(p_claim_key));
  RETURN jsonb_build_object(
    'attempts', v_row.attempts,
    'provider_failures', v_row.provider_failures,
    'next_attempt_at', v_row.next_attempt_at,
    'alerted', v_alerted
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_customer_communication_automation_claim(p_claim_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_claim_key IS NULL OR btrim(p_claim_key) = '' THEN
    RAISE EXCEPTION 'Chave da claim e obrigatoria.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_communication_automation_claims
  SET attempts = 0, provider_failures = 0, last_error = NULL, next_attempt_at = NULL,
      rejected_at = NULL, rejection_reason = NULL
  WHERE claim_key = p_claim_key;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM public.refresh_customer_communication_refusal_alert(public.customer_communication_claim_customer_id(p_claim_key));
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_communication_retry_interval(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_communication_claim_customer_id(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_customer_communication_refusal_alert(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_customer_communication_automation_claim(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.defer_customer_communication_automation_claim(text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_customer_communication_automation_claim(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_customer_communication_refusal_alert(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_customer_communication_automation_claim(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_customer_communication_automation_claim(text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_customer_communication_automation_claim(text) TO service_role;
