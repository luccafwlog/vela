-- 272: a fatura avulsa exige um motivo interno (decisão do dono de 2026-10-15
-- na revisão da PR 954; ADR 0083, item 9: "todo usuário interno ativo pode
-- gerar fatura avulsa, com motivo e rastro").
--
-- Problema: a migration 246 abriu a emissão da avulsa aos cinco Departamentos,
-- mas o "motivo" decidido não existia. O modal pede Cliente, item, quantidade
-- e valor; a Descrição é opcional e aparece para o Cliente no Portal, então
-- não serve de justificativa interna. O rastro registrava só quem emitiu.
--
-- Mudança: `create_manual_invoice` ganha `p_reason`, obrigatório. O corpo
-- vigente (migration 246) passa a `_create_manual_invoice_core_272`, sem
-- EXECUTE para `authenticated`; o novo invólucro confere o motivo antes de
-- qualquer gravação e o registra no evento `issued` da fatura
-- (`invoice_lifecycle_events.payload.reason`) e em `audit_logs`
-- (`manual_invoice_reason`, com o motivo na justificativa). O motivo não vai
-- para a fatura nem para o Portal. Chamada sem motivo é recusada (22023).
--
-- Só renomeia e cria funções; não reescreve nem apaga linhas.
-- Rollback: DROP FUNCTION public.create_manual_invoice(bigint, text, numeric,
-- numeric, text, text, bigint, uuid, bigint, text); renomear o núcleo de volta
-- para create_manual_invoice e devolver o EXECUTE a authenticated.

ALTER FUNCTION public.create_manual_invoice(bigint, text, numeric, numeric, text, text, bigint, uuid, bigint)
  RENAME TO _create_manual_invoice_core_272;
REVOKE ALL ON FUNCTION public._create_manual_invoice_core_272(bigint, text, numeric, numeric, text, text, bigint, uuid, bigint)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_manual_invoice(
  p_customer_id bigint,
  p_item_name text,
  p_quantity numeric,
  p_unit_value_brl numeric,
  p_description text DEFAULT NULL,
  p_bl_id text DEFAULT NULL,
  p_voyage_id bigint DEFAULT NULL,
  p_actor uuid DEFAULT NULL,
  p_charge_item_id bigint DEFAULT NULL,
  p_reason text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_result jsonb;
  v_invoice bigint;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da fatura avulsa.' USING ERRCODE = '22023';
  END IF;

  v_result := public._create_manual_invoice_core_272(p_customer_id, p_item_name, p_quantity, p_unit_value_brl,
    p_description, p_bl_id, p_voyage_id, p_actor, p_charge_item_id);
  v_invoice := (v_result->>'invoice_id')::bigint;

  UPDATE public.invoice_lifecycle_events
  SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('reason', v_reason)
  WHERE invoice_id = v_invoice AND event_type = 'issued';

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('invoice', v_invoice::text, 'manual_invoice_reason', NULL, v_reason, auth.uid(), v_reason);

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_manual_invoice(bigint, text, numeric, numeric, text, text, bigint, uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_invoice(bigint, text, numeric, numeric, text, text, bigint, uuid, bigint, text) TO authenticated;
