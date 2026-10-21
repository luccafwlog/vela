-- 347: os alertas acompanham o B/L cancelado, faturado ou excluído (revisão
-- dos alertas de 2026-10-21,
-- docs/revisao-alertas-2026-10.md; L5 do estudo
-- docs/archive/audits/2026-10-20-auto-resolucao-de-alertas.md).
--
-- Problemas:
--   1. Pendência do Portal com B/L cancelado. `reconcile_client_portal_alerts`
--      (e o "processo ativo" do console de Provisionamento) contava como
--      processo ativo todo B/L com `financial_status` diferente de
--      'cancelled'. Nenhum gravador põe esse valor: `cancel_bl` grava
--      `cancelled_at` e não mexe no status financeiro. O Cliente cujo único
--      B/L foi cancelado ficava com "Pendência geral do Portal" (e convite
--      expirado, falha de envio ou e-mail suprimido) aberta para sempre.
--   2. "Bloqueio no cálculo de taxas" (`billing_calculation_blocked`) só
--      fechava pelo navegador, depois de um faturamento bem-sucedido feito na
--      tela. A emissão pelo CE no servidor faturava o B/L e o alerta ficava;
--      `resolve_auto_issue_alert_on_invoiced` fechava só a falha de emissão,
--      embora `_billing_alert_origin_resolved` (238) diga que faturado resolve
--      os dois.
--   3. B/L cancelado deixava abertos os dois alertas de faturamento, também
--      resolvidos pela regra da 238.
--   4. Excluir B/L (`delete_records`) deixava os alertas dele (entidade `bl`,
--      chave em texto, sem FK), como a viagem antes da 341.
--
-- Mudança:
--   1. `reconcile_client_portal_alerts` e `portal_list_provisioning_console`:
--      processo ativo exige `cancelled_at IS NULL` (o filtro antigo fica).
--   2. `resolve_auto_issue_alert_on_invoiced` fecha também o bloqueio de
--      cálculo do B/L faturado.
--   3. Gatilho `resolve_billing_alerts_on_bl_cancel` (B/L passa a cancelado):
--      fecha os dois alertas de faturamento.
--   4. Gatilho `delete_bl_alerts_on_delete` apaga os alertas do B/L excluído
--      (itens, eventos, dispensas e Notificações Internas saem pelo ON DELETE
--      CASCADE), como a 341 faz com a viagem. O Cliente não entra: com CNPJ
--      obrigatório, `delete_records('customer')` sempre recusa ("desative em
--      vez de excluir").
--
--   5. Acerto dos alertas já abertos: os de faturamento de B/L já faturado,
--      pago ou cancelado são resolvidos, e os de B/L que não existe mais são
--      apagados. Sem isso eles ficariam abertos para sempre, porque o fato que
--      os fecharia já aconteceu. A pendência do Portal fecha sozinha na
--      próxima rodada do detector.
--
-- Reescreve e apaga linhas existentes (item 5: `alert_items` resolvidos e
-- `alerts` de B/L inexistente). Depende da afirmação "Data status" do
-- AGENTS.md (seção Gotchas): o banco de produção só tem dados de teste.
-- Conferência antes e depois: supabase/scripts/consistencia_alertas.sql
-- (verificações 02, 11 e 12).
-- Rollback: reaplicar as definições das migrations 324
-- (reconcile_client_portal_alerts, portal_list_provisioning_console) e 208
-- (resolve_auto_issue_alert_on_invoiced); DROP dos gatilhos
-- resolve_billing_alerts_on_bl_cancel e delete_bl_alerts_on_delete e das
-- funções resolve_billing_alerts_on_bl_cancel() e delete_bl_alerts_on_delete().
-- O acerto do item 5 não tem volta automática; os eventos `resolved` com
-- origem `migration_347` dizem o que foi fechado.

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_client_portal_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer RECORD;
  v_account public.customer_portal_accounts%ROWTYPE;
  v_active_process BOOLEAN;
  v_gate_ok BOOLEAN;
  v_email_ok BOOLEAN;
  v_result JSONB := '{}'::jsonb;
  v_count INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  FOR v_customer IN
    SELECT c.id, c.name,
           -- B/L cancelado não é processo ativo: `cancel_bl` grava `cancelled_at`
           -- e não muda o status financeiro (347).
           EXISTS (SELECT 1 FROM public.bls b WHERE b.customer_id = c.id AND b.cancelled_at IS NULL AND b.financial_status IS DISTINCT FROM 'cancelled') AS active_process,
           a.id AS account_id, a.active, a.account_situation, a.auth_user_id, a.recovery_email, a.recovery_email_status
    FROM public.customers c
    LEFT JOIN public.customer_portal_accounts a ON a.customer_id = c.id
    ORDER BY c.id
  LOOP
    v_active_process := v_customer.active_process;
    v_account.id := v_customer.account_id;
    v_account.active := v_customer.active;
    v_account.account_situation := v_customer.account_situation;
    v_account.auth_user_id := v_customer.auth_user_id;
    v_account.recovery_email := v_customer.recovery_email;
    v_account.recovery_email_status := v_customer.recovery_email_status;
    v_gate_ok := false;
    v_email_ok := false;
    IF v_account.id IS NOT NULL THEN
      v_email_ok := lower(COALESCE(v_account.recovery_email, '')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
        AND COALESCE(v_account.recovery_email_status, 'ok') = 'ok'
        AND NOT EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE lower(s.email) = lower(v_account.recovery_email));
      v_gate_ok := v_account.active
        AND v_account.account_situation = 'ativo'
        AND v_account.auth_user_id IS NOT NULL
        AND v_email_ok;
    END IF;

    IF v_active_process AND NOT v_gate_ok THEN
      PERFORM public.block521_upsert_alert(
        'portal_pendencia_geral', 'customer', v_customer.id::text,
        CASE
          WHEN v_account.account_situation = 'suspenso' THEN 'Conta do Portal suspensa.'
          WHEN v_account.id IS NULL OR v_account.account_situation IS DISTINCT FROM 'ativo' THEN
            CASE WHEN NULLIF(btrim(COALESCE(v_account.recovery_email, '')), '') IS NULL
              THEN 'Sem conta no Portal e sem e-mail de recuperação.'
              ELSE 'Conta do Portal ainda não ativa.' END
          WHEN v_email_ok THEN 'Conta ativa sem usuário de acesso ao Portal.'
          ELSE 'Conta ativa sem e-mail de recuperação utilizável.'
        END,
        'portal_reconciliation',
        'documentacao',
        jsonb_build_object('customer_id', v_customer.id, 'active_process', true),
        '/clientes/portal?cliente=' || v_customer.id
      );
    ELSE
      PERFORM public.block521_resolve_alert('portal_pendencia_geral', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;

    IF v_active_process AND v_account.id IS NOT NULL AND v_account.account_situation = 'convite_expirado' THEN
      PERFORM public.block521_upsert_alert('portal_convite_expirado', 'customer', v_customer.id::text, 'Convite do Portal expirado; reenvie o convite.', 'portal_reconciliation', 'documentacao', jsonb_build_object('customer_id', v_customer.id), '/clientes/portal?cliente=' || v_customer.id);
    ELSE
      PERFORM public.block521_resolve_alert('portal_convite_expirado', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;

    IF v_active_process AND v_account.id IS NOT NULL AND v_account.account_situation = 'falha_no_envio' THEN
      PERFORM public.block521_upsert_alert('portal_falha_envio', 'customer', v_customer.id::text, 'Falha no envio do convite do Portal; revise o email e reenvie.', 'portal_reconciliation', 'documentacao', jsonb_build_object('customer_id', v_customer.id), '/clientes/portal?cliente=' || v_customer.id);
    ELSE
      PERFORM public.block521_resolve_alert('portal_falha_envio', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;

    IF v_active_process AND v_account.id IS NOT NULL AND (COALESCE(v_account.recovery_email_status, 'ok') <> 'ok' OR EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE lower(s.email) = lower(v_account.recovery_email))) THEN
      PERFORM public.block521_upsert_alert('portal_email_suprimido', 'customer', v_customer.id::text, 'Email de recuperação suprimido; escolha e confirme um endereço utilizável.', 'portal_reconciliation', 'documentacao', jsonb_build_object('customer_id', v_customer.id, 'email', v_account.recovery_email), '/clientes/portal?cliente=' || v_customer.id);
    ELSE
      PERFORM public.block521_resolve_alert('portal_email_suprimido', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;
    v_count := v_count + 1;
  END LOOP;
  v_result := jsonb_build_object('customers_scanned', v_count, 'reconciled_at', now());
  RETURN v_result;
END;
$function$;

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_provisioning_console(p_customer_id bigint DEFAULT NULL::bigint)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_full_access BOOLEAN := v_role IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos');
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  PERFORM public.portal_repair_missing_accounts();

  RETURN QUERY
  SELECT jsonb_build_object(
    'account_id', a.id,
    'customer_id', c.id,
    'customer_name', c.name,
    'cnpj_cpf', c.cnpj_cpf,
    'provisioning_decision', a.provisioning_decision,
    'account_situation', CASE
      WHEN a.account_situation = 'convite_pendente' AND pi.expires_at < now()
        THEN 'convite_expirado'
      ELSE a.account_situation
    END,
    'recovery_email', CASE WHEN v_full_access THEN a.recovery_email ELSE NULL END,
    'recovery_email_source', CASE WHEN v_full_access THEN a.recovery_email_source ELSE NULL END,
    'pending_invite_expires_at', pi.expires_at,
    'latest_delivery_status', CASE WHEN v_full_access THEN CASE WHEN ea.status = 'aceito' AND ea.provider_message_id IS NULL THEN 'nao_confirmado' ELSE ea.status END ELSE NULL END,
    'exception_reason', NULL,
    'last_event_at', ev.created_at,
    'has_critical_alert', EXISTS (
      SELECT 1
      FROM public.alerts al
      LEFT JOIN public.alert_items ai ON ai.alert_id = al.id AND ai.status = 'active'
      WHERE al.status <> 'closed'
        AND (
          (al.entity_type = 'customer' AND al.entity_id = c.id::text)
          OR (al.entity_type = 'bl' AND EXISTS (
            SELECT 1
            FROM public.bls cb
            WHERE cb.id = al.entity_id AND cb.customer_id = c.id
          ))
        )
        AND (
          ai.severity = 'critical'
          OR (al.type <> 'aggregate' AND EXISTS (
            SELECT 1 FROM public.alert_type_catalog ct
            WHERE ct.type = al.type AND ct.severity = 'critical'
          ))
          OR al.type = 'portal_abuso_login'
        )
    ),
    'has_open_invoice', EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.customer_id = c.id
        AND i.status IN ('issued', 'overdue', 'partially_paid')
    ),
    'has_active_process', EXISTS (
      SELECT 1
      FROM public.bls b
      WHERE b.customer_id = c.id
        AND b.cancelled_at IS NULL
        AND b.financial_status IS DISTINCT FROM 'cancelled'
    ),
    -- A fila precisa expor qualquer contato ativo com e-mail. Para contatos
    -- do modelo novo sem purpose, `geral` é somente o rótulo de compatibilidade
    -- da API; elegibilidade e roteamento continuam nas caixas canônicas.
    'candidates', CASE WHEN v_full_access THEN COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'email', cc.email,
          'purpose', COALESCE(cc.purpose, 'geral'),
          'origin', 'Contato do Cliente'
        ) ORDER BY cc.id
      )
      FROM public.customer_contacts cc
      WHERE cc.customer_id = c.id
        AND cc.deactivated_at IS NULL
        AND cc.email_normalized IS NOT NULL
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'recovery_email_status', CASE WHEN v_full_access THEN a.recovery_email_status ELSE NULL END,
    'recovery_email_suppressed', CASE
      WHEN v_full_access AND a.recovery_email IS NOT NULL THEN EXISTS (
        SELECT 1
        FROM public.portal_suppressed_emails s
        WHERE s.email = lower(a.recovery_email)
      )
      ELSE false
    END,
    'shared_email_count', CASE
      WHEN v_full_access AND a.recovery_email IS NOT NULL THEN (
        SELECT count(*)
        FROM public.customer_portal_accounts other
        WHERE lower(other.recovery_email) = lower(a.recovery_email)
          AND other.id <> a.id
      )
      ELSE 0
    END
  )
  FROM public.customer_portal_accounts a
  JOIN public.customers c ON c.id = a.customer_id
  LEFT JOIN LATERAL (
    SELECT expires_at
    FROM public.portal_invites
    WHERE account_id = a.id
      AND purpose = 'convite'
      AND status = 'pendente'
    ORDER BY created_at DESC
    LIMIT 1
  ) pi ON true
  LEFT JOIN LATERAL (
    SELECT status, provider_message_id
    FROM public.portal_email_attempts
    WHERE account_id = a.id
    ORDER BY created_at DESC
    LIMIT 1
  ) ea ON true
  LEFT JOIN LATERAL (
    SELECT created_at
    FROM public.portal_provisioning_events
    WHERE customer_id = c.id
    ORDER BY created_at DESC
    LIMIT 1
  ) ev ON true
  WHERE p_customer_id IS NULL OR c.id = p_customer_id
  ORDER BY c.name;
END;
$function$;

-- 3 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_auto_issue_alert_on_invoiced()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RETURN NULL;
  END IF;
  -- B/L faturado resolve a origem dos dois tipos de faturamento
  -- (`_billing_alert_origin_resolved`, 238); o bloqueio de cálculo só fechava
  -- pelo navegador, e a emissão pelo CE no servidor o deixava aberto (348).
  IF EXISTS (
    SELECT 1 FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type IN ('billing_auto_issue_failed', 'billing_calculation_blocked') AND i.status = 'active'
      AND a.entity_type = 'bl' AND a.entity_id = NEW.id
  ) THEN
    PERFORM public.resolve_alert_item('billing_auto_issue_failed', 'bl', NEW.id, 'bl_invoiced',
      jsonb_build_object('resolution', 'invoiced', 'financial_status', NEW.financial_status));
    PERFORM public.resolve_alert_item('billing_calculation_blocked', 'bl', NEW.id, 'bl_invoiced',
      jsonb_build_object('resolution', 'invoiced', 'financial_status', NEW.financial_status));
  END IF;
  PERFORM public._drop_bls_from_charge_table_gaps(ARRAY[NEW.id], 'bl_invoiced');
  RETURN NULL;
END;
$function$;

-- 4 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_billing_alerts_on_bl_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- B/L cancelado resolve a origem dos alertas de faturamento
  -- (`_billing_alert_origin_resolved`, 238).
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.resolve_alert_item('billing_calculation_blocked', 'bl', NEW.id, 'bl_cancelled',
    jsonb_build_object('resolution', 'bl_cancelled'));
  PERFORM public.resolve_alert_item('billing_auto_issue_failed', 'bl', NEW.id, 'bl_cancelled',
    jsonb_build_object('resolution', 'bl_cancelled'));
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_billing_alerts_on_bl_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_billing_alerts_on_bl_cancel ON public.bls;
CREATE TRIGGER resolve_billing_alerts_on_bl_cancel
  AFTER UPDATE OF cancelled_at ON public.bls
  FOR EACH ROW
  WHEN (OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL)
  EXECUTE FUNCTION public.resolve_billing_alerts_on_bl_cancel();

-- 5 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_bl_alerts_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- `alerts` não tem FK para o B/L (chave em texto): a exclusão leva os
  -- alertas dele, como a da viagem (341).
  DELETE FROM public.alerts
  WHERE entity_type = 'bl'
    AND entity_id = OLD.id;
  -- O B/L excluído sai também da lista de "tabela de taxa faltando", como o
  -- cancelado (208).
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public._drop_bls_from_charge_table_gaps(ARRAY[OLD.id], 'bl_deleted');
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_bl_alerts_on_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS delete_bl_alerts_on_delete ON public.bls;
CREATE TRIGGER delete_bl_alerts_on_delete
  AFTER DELETE ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.delete_bl_alerts_on_delete();

-- 6 -------------------------------------------------------------------------
-- Acerto dos alertas já abertos (item 5; depende do "Data status").
DO $$
DECLARE
  v_item record;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  FOR v_item IN
    SELECT DISTINCT i.item_type, a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    JOIN public.bls b ON b.id = a.entity_id
    WHERE a.entity_type = 'bl'
      AND i.status = 'active'
      AND i.item_type IN ('billing_calculation_blocked', 'billing_auto_issue_failed')
      AND (b.cancelled_at IS NOT NULL OR b.financial_status IN ('invoiced', 'paid'))
  LOOP
    PERFORM public.resolve_alert_item(v_item.item_type, 'bl', v_item.entity_id, 'migration_347',
      jsonb_build_object('resolution', 'bl_invoiced_or_cancelled_before_347'));
  END LOOP;

  DELETE FROM public.alerts a
  WHERE a.entity_type = 'bl'
    AND NOT EXISTS (SELECT 1 FROM public.bls b WHERE b.id = a.entity_id);
  PERFORM set_config('request.jwt.claim.role', '', true);
END
$$;
