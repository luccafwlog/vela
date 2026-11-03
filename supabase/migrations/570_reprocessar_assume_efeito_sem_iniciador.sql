-- 570: Reprocessar assume o efeito de importação gravado sem iniciador.
--
-- Achado na staging em 2026-11-03 (efeitos 338–344): uma integração gravou o
-- CE de sete B/Ls direto no banco, sem usuário (`auth.uid()` nulo). O gatilho
-- `trg_auto_bill_bl_after_ce_mercante` não fatura sem ator e deixa o efeito
-- `local_billing` na fila com `created_by` nulo, como rede (comportamento
-- testado em `ceMercanteAutoBilling.local-pg.test.ts`). O runner recusa efeito
-- sem iniciador ("Efeito sem iniciador validado.", 42501) e abre o Alerta
-- "Efeito de importação bloqueado", que pede "Corrija a causa e use
-- Reprocessar". Só que `retry_import_effect` devolvia o efeito à fila ainda
-- sem iniciador: o runner bloqueava de novo pelo mesmo motivo e o Alerta não
-- fechava por nenhum caminho da tela.
--
-- Agora, quando o efeito bloqueado não tem iniciador, quem reprocessa passa a
-- ser o iniciador (`created_by`), e isso fica no resultado do efeito
-- (`initiator_assigned_on_retry`) e na linha do histórico de ações. É a mesma
-- regra de quem roda o efeito nos outros casos: uma pessoa ativa, com setor,
-- que deu a justificativa. O efeito com iniciador não muda. Chamada do
-- service_role sem `auth.uid()` continua sem iniciador (nada a atribuir).
--
-- Resto igual à definição vigente (509, lida com pg_get_functiondef na staging
-- com a cadeia até a 568): assinatura, SECURITY DEFINER, search_path, recusas
-- e grants (CREATE OR REPLACE mantém os grants).
--
-- Só redefine a função. Ela grava `created_by` no efeito que a pessoa
-- reprocessa, quando ele está vazio; não reescreve linhas por conta própria.
-- Rollback: reaplicar a função pela migration 509.

CREATE OR REPLACE FUNCTION public.retry_import_effect(p_effect_id bigint, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.import_pending_effects%ROWTYPE;
  v_actor uuid := auth.uid();
  v_role text := public.current_actor_role();
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_assign_initiator boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR NOT public.is_active_user()
          OR v_role NOT IN ('administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos')) THEN
    RAISE EXCEPTION 'Usuário sem permissão para reabrir efeito.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL OR char_length(v_justification) > 500 THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para retry.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.import_pending_effects
  WHERE id = p_effect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % nao encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'Somente efeitos bloqueados podem ser reabertos.' USING ERRCODE = '22023';
  END IF;

  -- 570: o efeito gravado sem iniciador passa a ser de quem reprocessa.
  v_assign_initiator := v_row.created_by IS NULL AND v_actor IS NOT NULL;

  UPDATE public.import_pending_effects
     SET status = 'retry_wait',
         attempts = 0,
         next_attempt_at = now(),
         lease_until = NULL,
         leased_by = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         created_by = CASE WHEN v_assign_initiator THEN v_actor ELSE created_by END,
         result = COALESCE(result, '{}'::jsonb)
           || jsonb_build_object('manual_retry_justification', v_justification)
           || CASE WHEN v_assign_initiator
                THEN jsonb_build_object('initiator_assigned_on_retry', v_actor)
                ELSE '{}'::jsonb END,
         updated_at = now()
   WHERE id = v_row.id;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'import_effect', v_row.id::text, 'retry',
    jsonb_build_object('status', 'blocked', 'attempts', v_row.attempts)::text,
    (jsonb_build_object('status', 'retry_wait', 'attempts', 0)
      || CASE WHEN v_assign_initiator
           THEN jsonb_build_object('created_by', v_actor, 'initiator_assigned_on_retry', true)
           ELSE '{}'::jsonb END)::text,
    v_actor, v_justification, COALESCE(v_role, 'sistema'), COALESCE(v_role, 'sistema')
  );

  SELECT * INTO v_row FROM public.import_pending_effects WHERE id = p_effect_id;
  RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', false);
END;
$function$;
