-- 424: a dispensa de alerta vale por até 30 dias (auditoria de segurança
-- run-3, decisão do dono em 2026-10-22).
--
-- `dismiss_alert_item` aceitava qualquer data futura: uma dispensa para 2099
-- tirava o item da fila ativa para sempre, sem passar pela revisão que a
-- ADR 0053 pede. Agora a data de revisão vai até o fim do 30º dia (UTC) a
-- partir de hoje, o mesmo limite que a tela oferece (`T23:59:59Z` do 30º
-- dia, `getMaxReviewDateString`). Data além disso: 22023.
--
-- Envelope com o mesmo nome (`dismiss_alert_item_core_424`, sem EXECUTE
-- para a API), como na 416. Só redefine funções; não reescreve nem apaga
-- linhas: dispensas já gravadas com data mais longa seguem até a data delas.
-- Rollback: remover o envelope e renomear o core de volta.

ALTER FUNCTION public.dismiss_alert_item(bigint, text, timestamp with time zone) RENAME TO dismiss_alert_item_core_424;
REVOKE ALL ON FUNCTION public.dismiss_alert_item_core_424(bigint, text, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.dismiss_alert_item(p_item_id bigint, p_reason text, p_review_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_review_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '31 days') AT TIME ZONE 'UTC' THEN
    RAISE EXCEPTION 'A dispensa vale por no máximo 30 dias.' USING ERRCODE = '22023';
  END IF;
  RETURN public.dismiss_alert_item_core_424(p_item_id, p_reason, p_review_at);
END $function$;

REVOKE ALL ON FUNCTION public.dismiss_alert_item(bigint, text, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_alert_item(bigint, text, timestamp with time zone) TO authenticated;
