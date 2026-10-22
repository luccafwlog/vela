-- 414: suspensão, reativação e convite do Portal registram quem os fez
-- (auditoria de segurança run-3, achado C6).
--
-- Problema: `portal-account-suspend` e `portal-invite-send` gravam o evento de
-- provisionamento pelo cliente `service_role`. `_portal_log_event` (002) usava
-- `auth.uid()`, nulo nesse contexto: suspender, reativar (que desfaz o vínculo e
-- bane o usuário técnico) e convidar ficavam no histórico sem a pessoa, só com
-- o Departamento.
--
-- Mudança: `_portal_log_event` ganha `p_actor_id` (último, opcional) e grava
-- `COALESCE(auth.uid(), p_actor_id)`, aceitando `p_actor_id` só quando quem
-- chama é o `service_role`; sessão de usuário continua sendo o autor e não
-- consegue informar outro. As Edge Functions passam o id que o `getUser()` da
-- sessão de quem chamou confirmou. Continua executável só por `service_role`.
--
-- Publicação: aplicar esta migration antes das Edge Functions, que passam
-- `p_actor_id` por nome. As chamadas sem ele (as demais Edges) seguem valendo.
-- Só redefine função; não reescreve nem apaga linhas.
-- Rollback: recriar a assinatura de 10 argumentos da 002 e voltar as Edges.

DROP FUNCTION public._portal_log_event(bigint, bigint, bigint, text, text, text, text, text, text, text);

CREATE FUNCTION public._portal_log_event(
  p_customer_id bigint, p_account_id bigint, p_invite_id bigint,
  p_prev_decision text, p_new_decision text, p_prev_situation text, p_new_situation text,
  p_actor_type text, p_reason text, p_request_id text, p_actor_id uuid DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.portal_provisioning_events
    (customer_id, account_id, invite_id, previous_decision, new_decision,
     previous_situation, new_situation, actor_type, actor_id, reason, request_id)
  VALUES (p_customer_id, p_account_id, p_invite_id, p_prev_decision, p_new_decision,
          p_prev_situation, p_new_situation, p_actor_type,
          COALESCE(auth.uid(), CASE WHEN auth.role() = 'service_role' THEN p_actor_id END),
          p_reason, p_request_id);
END;
$function$;
REVOKE ALL ON FUNCTION public._portal_log_event(bigint, bigint, bigint, text, text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_log_event(bigint, bigint, bigint, text, text, text, text, text, text, text, uuid) TO service_role;
