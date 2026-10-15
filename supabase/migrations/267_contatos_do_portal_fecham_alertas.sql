-- 267: o Portal volta a salvar os contatos, e o salvamento fecha também o
-- alerta nob_sem_destinatario (revisão da PR 954; ADR 0053 e ADR 0064).
--
-- Problema (reproduzido no Postgres local em 2026-10-15): a migration 245 fez
-- `_apply_customer_contact_configuration` fechar `caixa_sem_destinatario` e
-- `cliente_sem_contato_principal` com `resolve_alert_item`, cuja guarda
-- (`alert_actor_is_authorized`, migration 052) aceita só usuário interno ativo,
-- service_role ou o contexto confiável do Portal. O usuário do Portal não tem
-- `user_profiles`: todo salvamento pelo Portal passou a falhar com
-- "Sem permissão.", mesmo sem alerta aberto. O `upsert_alert_item` de
-- `caixa_sem_destinatario` (caixa só com e-mail suprimido) já falhava assim
-- antes da 245.
--
-- Mudança:
-- 1. `portal_save_contact_configuration` abre o contexto confiável do Portal
--    (a tabela temporária criada dentro de SECURITY DEFINER que
--    `block521_upsert_alert` usa desde a migration 052) só durante o próprio
--    salvamento, que já está preso ao Cliente da sessão
--    (`current_portal_customer_id`). O chamador não consegue criar essa
--    tabela com o dono da função, então a guarda continua fechada para
--    qualquer outro uso.
-- 2. O salvamento (Portal e ficha do Cliente) fecha `nob_sem_destinatario`
--    quando a caixa Documentação/Operação tem destinatário elegível pela mesma
--    regra da produtora (migration 244). Antes, o alerta só fechava numa rodada
--    da produtora em que o Cliente ainda tivesse NOB pendente; enviado o NOB à
--    mão, ficava aberto.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar as definições da migration 008 das duas RPCs e apagar
-- `_customer_has_nob_recipient`.

CREATE OR REPLACE FUNCTION public._customer_has_nob_recipient(p_customer_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Espelha o destinatário elegível do NOB na produtora (migration 244).
  SELECT EXISTS (
    SELECT 1
    FROM public.customer_contacts cc
    JOIN public.customer_contact_box_links ccb
      ON ccb.contact_id = cc.id
     AND ccb.box_code = 'documentacao_operacao'
    WHERE cc.customer_id = p_customer_id
      AND cc.deactivated_at IS NULL
      AND NULLIF(btrim(cc.email), '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      AND NOT EXISTS (
        SELECT 1 FROM public.portal_suppressed_emails pse
        WHERE lower(btrim(pse.email)) = lower(btrim(cc.email)) AND pse.reason = 'bounce_permanente'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_communication_suppressions ccs
        WHERE lower(btrim(ccs.email)) = lower(btrim(cc.email))
      )
  );
$function$;

REVOKE ALL ON FUNCTION public._customer_has_nob_recipient(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._customer_has_nob_recipient(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.portal_save_contact_configuration(p_contacts jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_customer_id bigint := public.current_portal_customer_id();
  v_portal_account_id bigint;
  v_result jsonb;
  v_context_table text := format('vela_portal_contact_alert_%s', replace(gen_random_uuid()::text, '-', ''));
  v_previous_context_table text := current_setting('alerts.portal_dispute_context_table', true);
BEGIN
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Portal do Cliente.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_portal_account_id
  FROM public.customer_portal_accounts
  WHERE auth_user_id = auth.uid() AND active = true
  LIMIT 1;

  -- Contexto confiável do Portal (migration 052): os alertas de contato do
  -- próprio Cliente abrem e fecham pela origem durante este salvamento.
  EXECUTE format('CREATE TEMP TABLE pg_temp.%I (marker boolean NOT NULL) ON COMMIT DROP', v_context_table);
  EXECUTE format('INSERT INTO pg_temp.%I(marker) VALUES (true)', v_context_table);
  PERFORM set_config('alerts.portal_dispute_context_table', v_context_table, true);

  v_result := public._apply_customer_contact_configuration(
    v_customer_id,
    p_contacts,
    'portal',
    auth.uid(),
    v_portal_account_id
  );

  IF public._customer_has_nob_recipient(v_customer_id) THEN
    PERFORM public.resolve_alert_item('nob_sem_destinatario', 'customer', v_customer_id::text, 'portal',
      jsonb_build_object('customer_id', v_customer_id));
  END IF;

  EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
  PERFORM set_config('alerts.portal_dispute_context_table', COALESCE(v_previous_context_table, ''), true);
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    PERFORM set_config('alerts.portal_dispute_context_table', COALESCE(v_previous_context_table, ''), true);
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_save_customer_contact_configuration(
  p_customer_id bigint,
  p_contacts jsonb,
  p_justification text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Restaura a garantia anterior (can('customer_communications')): antes, as
  -- checkboxes de preferencia eram gated por essa permissao com fallback copy;
  -- o editor de caixas nao pode ser mais permissivo que o modelo que substitui.
  -- Espelha roleHasPermission(customer_communications): administrativo/admin,
  -- documentacao/operator, equipamentos.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND active = true
      AND role IN ('administrativo', 'admin', 'documentacao', 'operator', 'equipamentos')
  ) THEN
    RAISE EXCEPTION 'Permissão negada para editar contatos do cliente.' USING ERRCODE = '42501';
  END IF;

  v_result := public._apply_customer_contact_configuration(
    p_customer_id,
    p_contacts,
    'interno',
    auth.uid(),
    NULL,
    NULL,
    p_justification
  );

  IF public._customer_has_nob_recipient(p_customer_id) THEN
    PERFORM public.resolve_alert_item('nob_sem_destinatario', 'customer', p_customer_id::text, 'interno',
      jsonb_build_object('customer_id', p_customer_id));
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_save_contact_configuration(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_save_contact_configuration(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.internal_save_customer_contact_configuration(bigint, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.internal_save_customer_contact_configuration(bigint, jsonb, text) TO authenticated, service_role;
