-- 350: os alertas do Portal seguem o "processo ativo" decidido pelo Lucca e
-- abrem e fecham na hora do fato (revisão dos alertas de 2026-10-21,
-- docs/revisao-alertas-2026-10.md, decisão P3 e pedido de "fechar junto com o
-- fato").
--
-- Depende da 347 (#1008): parte das definições de
-- `reconcile_client_portal_alerts` e `portal_list_provisioning_console` dela
-- (B/L cancelado não é processo ativo). Mergear depois da #1008.
--
-- Problemas:
--   1. Processo ativo. Os quatro alertas do Portal (`portal_pendencia_geral`,
--      `portal_convite_expirado`, `portal_falha_envio`,
--      `portal_email_suprimido`) abrem para Cliente com "processo ativo", que
--      era qualquer B/L não cancelado, mesmo já pago. Caso aprovado pelo Lucca:
--      Cliente com um único B/L, pago em abril, sem conta no Portal, ficava com
--      "Sem conta no Portal" aberto para sempre.
--   2. Fechamento. Os quatro só abriam e fechavam no detector de 15 minutos
--      (`reconcile_client_portal_alerts` em `run_alert_detectors`): pagar ou
--      cancelar o B/L, ativar a conta, corrigir o e-mail de recuperação ou
--      liberar a supressão deixavam o alerta aberto até a rodada seguinte.
--   3. `portal_mark_expired_invites` (job de 15 minutos) ainda gravava uma
--      linha antiga em `alerts` (convertida em item por
--      `route_catalog_alert_insert` e fechada), que abria o convite expirado
--      sem olhar o processo ativo e acumulava uma linha fechada por convite.
--
-- Decisão (Lucca, 2026-10-21): processo ativo é B/L vivo ainda não pago, ou
-- Invoice de Demurrage em aberto do Cliente. Sem nada em aberto, os alertas do
-- Portal fecham; B/L novo reabre.
--
-- Mudança:
--   1. `customer_has_active_portal_process(customer)`: B/L com `cancelled_at`
--      nulo e `financial_status` fora de 'paid' e 'cancelled', ou
--      `demurrage_invoices` do Cliente em 'issued' ou 'overdue'. Os alertas e a
--      coluna "Processo ativo" do console de Provisionamento usam a mesma
--      função.
--   2. `reconcile_client_portal_alerts_for_customer(customer, origem)`: o
--      corpo por Cliente do reconciliador. A versão global (detector e
--      ativação) passa a chamá-la no laço; o resultado é o da 347 com o
--      processo ativo novo.
--   3. Gatilhos chamam a função por Cliente quando o fato muda:
--      `customer_portal_accounts` (situação, ativa, usuário, e-mail e status do
--      e-mail de recuperação), `portal_suppressed_emails` (entrada e saída do
--      endereço), `bls` (inclusão, exclusão, Cliente, cancelamento, status
--      financeiro; gatilhos de instrução) e `demurrage_invoices` (inclusão,
--      status, Cliente). Falha no alerta vira WARNING e não desfaz a gravação
--      de origem. O detector continua como rede de segurança.
--   4. `portal_mark_expired_invites` sem a linha antiga: o convite expirado
--      abre pelo gatilho da conta, com a regra do processo ativo.
--   5. Sai o gatilho `resolve_portal_alert_items_on_account_change` (002): ele
--      fechava três dos alertas na mudança da conta sem olhar a lista de
--      bloqueio (fechava "e-mail suprimido" com o status 'ok' e o endereço
--      ainda bloqueado) e rodava depois do gatilho novo, desfazendo o
--      resultado dele até a rodada do detector. O gatilho novo cobre os
--      mesmos casos com a regra completa. A função fica sem gatilho.
--
-- Só troca funções e cria gatilhos; não reescreve nem apaga linhas. Os alertas
-- abertos de Cliente que já não tem processo ativo fecham na próxima rodada do
-- detector, ou no primeiro fato do Cliente.
-- Rollback: reaplicar as definições da 347 (`reconcile_client_portal_alerts`,
-- `portal_list_provisioning_console`) e do dump 002
-- (`portal_mark_expired_invites`); DROP dos gatilhos
-- `reconcile_portal_alerts_on_account_insert_delete`,
-- `reconcile_portal_alerts_on_account_update`,
-- `reconcile_portal_alerts_on_suppressed_email`,
-- `reconcile_portal_alerts_on_bls_insert`, `..._on_bls_delete`,
-- `..._on_bls_update`, `reconcile_portal_alerts_on_demurrage_invoice_insert`,
-- `..._on_demurrage_invoice_update` e das funções criadas aqui; recriar o
-- gatilho `resolve_portal_alert_items_on_account_change` do dump 002 (AFTER
-- UPDATE OF account_situation, recovery_email_status).

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_has_active_portal_process(p_customer_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- B/L cancelado não é processo ativo (`cancel_bl` grava `cancelled_at` e não
  -- muda o status financeiro, 347); B/L pago também não (decisão P3), a menos
  -- que o Cliente ainda tenha Invoice de Demurrage em aberto.
  SELECT EXISTS (
      SELECT 1 FROM public.bls b
      WHERE b.customer_id = p_customer_id
        AND b.cancelled_at IS NULL
        AND b.financial_status IS DISTINCT FROM 'cancelled'
        AND b.financial_status IS DISTINCT FROM 'paid'
    )
    OR EXISTS (
      SELECT 1 FROM public.demurrage_invoices di
      WHERE di.customer_id = p_customer_id
        AND di.status IN ('issued', 'overdue')
    );
$function$;

REVOKE ALL ON FUNCTION public.customer_has_active_portal_process(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_has_active_portal_process(bigint) TO service_role;

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_client_portal_alerts_for_customer(
  p_customer_id bigint,
  p_source text DEFAULT 'portal_reconciliation'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_account public.customer_portal_accounts%ROWTYPE;
  v_active_process boolean;
  v_gate_ok boolean := false;
  v_email_ok boolean := false;
  v_entity text := p_customer_id::text;
  v_destination text := '/clientes/portal?cliente=' || p_customer_id;
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'portal_reconciliation');
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RETURN false;
  END IF;

  v_active_process := public.customer_has_active_portal_process(p_customer_id);
  SELECT * INTO v_account FROM public.customer_portal_accounts WHERE customer_id = p_customer_id;

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
    PERFORM public.upsert_alert_item(
      'portal_pendencia_geral', 'customer', v_entity,
      CASE
        WHEN v_account.account_situation = 'suspenso' THEN 'Conta do Portal suspensa.'
        WHEN v_account.id IS NULL OR v_account.account_situation IS DISTINCT FROM 'ativo' THEN
          CASE WHEN NULLIF(btrim(COALESCE(v_account.recovery_email, '')), '') IS NULL
            THEN 'Sem conta no Portal e sem e-mail de recuperação.'
            ELSE 'Conta do Portal ainda não ativa.' END
        WHEN v_email_ok THEN 'Conta ativa sem usuário de acesso ao Portal.'
        ELSE 'Conta ativa sem e-mail de recuperação utilizável.'
      END,
      v_source, 'documentacao',
      jsonb_build_object('customer_id', p_customer_id, 'active_process', true),
      v_destination
    );
  ELSE
    PERFORM public.resolve_alert_item_for_department('portal_pendencia_geral', 'customer', v_entity, 'documentacao', v_source, '{}'::jsonb);
  END IF;

  IF v_active_process AND v_account.id IS NOT NULL AND v_account.account_situation = 'convite_expirado' THEN
    PERFORM public.upsert_alert_item('portal_convite_expirado', 'customer', v_entity, 'Convite do Portal expirado; reenvie o convite.', v_source, 'documentacao', jsonb_build_object('customer_id', p_customer_id), v_destination);
  ELSE
    PERFORM public.resolve_alert_item_for_department('portal_convite_expirado', 'customer', v_entity, 'documentacao', v_source, '{}'::jsonb);
  END IF;

  IF v_active_process AND v_account.id IS NOT NULL AND v_account.account_situation = 'falha_no_envio' THEN
    PERFORM public.upsert_alert_item('portal_falha_envio', 'customer', v_entity, 'Falha no envio do convite do Portal; revise o email e reenvie.', v_source, 'documentacao', jsonb_build_object('customer_id', p_customer_id), v_destination);
  ELSE
    PERFORM public.resolve_alert_item_for_department('portal_falha_envio', 'customer', v_entity, 'documentacao', v_source, '{}'::jsonb);
  END IF;

  IF v_active_process AND v_account.id IS NOT NULL AND (COALESCE(v_account.recovery_email_status, 'ok') <> 'ok' OR EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE lower(s.email) = lower(v_account.recovery_email))) THEN
    PERFORM public.upsert_alert_item('portal_email_suprimido', 'customer', v_entity, 'Email de recuperação suprimido; escolha e confirme um endereço utilizável.', v_source, 'documentacao', jsonb_build_object('customer_id', p_customer_id, 'email', v_account.recovery_email), v_destination);
  ELSE
    PERFORM public.resolve_alert_item_for_department('portal_email_suprimido', 'customer', v_entity, 'documentacao', v_source, '{}'::jsonb);
  END IF;

  RETURN v_active_process;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_client_portal_alerts_for_customer(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_client_portal_alerts_for_customer(bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_client_portal_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint;
  v_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  -- Rede de segurança dos gatilhos (350): mesma regra, Cliente a Cliente.
  FOR v_customer_id IN SELECT c.id FROM public.customers c ORDER BY c.id LOOP
    PERFORM public.reconcile_client_portal_alerts_for_customer(v_customer_id, 'portal_reconciliation');
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('customers_scanned', v_count, 'reconciled_at', now());
END;
$function$;

-- 3 -------------------------------------------------------------------------
-- Definição da 347 com a coluna "Processo ativo" pela função da seção 1.
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
    -- Mesma definição dos alertas do Portal (350).
    'has_active_process', public.customer_has_active_portal_process(c.id),
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

-- 4 -------------------------------------------------------------------------
-- Definição do dump 002 sem a linha antiga em `alerts`: a mudança da conta
-- para 'convite_expirado' dispara o gatilho da conta (seção 5), que abre o
-- alerta só com processo ativo.
CREATE OR REPLACE FUNCTION public.portal_mark_expired_invites()
 RETURNS TABLE(expired_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_count BIGINT:=0; r RECORD;
BEGIN
  FOR r IN SELECT i.id invite_id,i.account_id,a.customer_id,a.provisioning_decision,a.account_situation
    FROM public.portal_invites i JOIN public.customer_portal_accounts a ON a.id=i.account_id
    WHERE i.status='pendente' AND i.purpose='convite' AND i.expires_at<now() FOR UPDATE OF i
  LOOP
    UPDATE public.portal_invites SET status='expirado' WHERE id=r.invite_id;
    UPDATE public.customer_portal_accounts SET account_situation='convite_expirado' WHERE id=r.account_id AND account_situation='convite_pendente';
    PERFORM public._portal_log_event(r.customer_id,r.account_id,r.invite_id,r.provisioning_decision,r.provisioning_decision,r.account_situation,'convite_expirado','sistema','Convite expirado após 48 horas',NULL);
    v_count:=v_count+1;
  END LOOP;
  RETURN QUERY SELECT v_count;
END; $function$;

-- 5 -------------------------------------------------------------------------
-- Reconciliação por gatilho. Roda com o papel de quem gravou (usuário interno,
-- Portal, service role ou job): `alerts.foundation_trigger` autoriza o alerta
-- e é devolvido ao valor anterior. Falha no alerta não desfaz a gravação.
CREATE OR REPLACE FUNCTION public._reconcile_client_portal_alerts_for_customers(p_customer_ids bigint[], p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_previous text := current_setting('alerts.foundation_trigger', true);
  v_customer_id bigint;
BEGIN
  IF cardinality(COALESCE(p_customer_ids, ARRAY[]::bigint[])) = 0 THEN
    RETURN;
  END IF;
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_customer_id IN
    SELECT DISTINCT id FROM unnest(p_customer_ids) AS ids(id) WHERE id IS NOT NULL ORDER BY id
  LOOP
    BEGIN
      PERFORM public.reconcile_client_portal_alerts_for_customer(v_customer_id, p_source);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alertas do Portal do Cliente % nao reconciliados (%): %', v_customer_id, p_source, SQLERRM;
    END;
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
END;
$function$;

REVOKE ALL ON FUNCTION public._reconcile_client_portal_alerts_for_customers(bigint[], text) FROM PUBLIC, anon, authenticated;

-- Conta do Portal: criação, exclusão e mudança do que decide os alertas.
CREATE OR REPLACE FUNCTION public.reconcile_portal_alerts_on_account_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._reconcile_client_portal_alerts_for_customers(ARRAY[NEW.customer_id], 'portal_account_change');
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public._reconcile_client_portal_alerts_for_customers(ARRAY[OLD.customer_id], 'portal_account_change');
  ELSE
    PERFORM public._reconcile_client_portal_alerts_for_customers(ARRAY[OLD.customer_id, NEW.customer_id], 'portal_account_change');
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_portal_alerts_on_account_change() FROM PUBLIC, anon, authenticated;

-- Substituído pelos gatilhos abaixo (item 5 do cabeçalho).
DROP TRIGGER IF EXISTS resolve_portal_alert_items_on_account_change ON public.customer_portal_accounts;

DROP TRIGGER IF EXISTS reconcile_portal_alerts_on_account_insert_delete ON public.customer_portal_accounts;
CREATE TRIGGER reconcile_portal_alerts_on_account_insert_delete
  AFTER INSERT OR DELETE ON public.customer_portal_accounts
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_portal_alerts_on_account_change();

DROP TRIGGER IF EXISTS reconcile_portal_alerts_on_account_update ON public.customer_portal_accounts;
CREATE TRIGGER reconcile_portal_alerts_on_account_update
  AFTER UPDATE OF customer_id, active, account_situation, auth_user_id, recovery_email, recovery_email_status
  ON public.customer_portal_accounts
  FOR EACH ROW
  WHEN (OLD.customer_id IS DISTINCT FROM NEW.customer_id
    OR OLD.active IS DISTINCT FROM NEW.active
    OR OLD.account_situation IS DISTINCT FROM NEW.account_situation
    OR OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id
    OR OLD.recovery_email IS DISTINCT FROM NEW.recovery_email
    OR OLD.recovery_email_status IS DISTINCT FROM NEW.recovery_email_status)
  EXECUTE FUNCTION public.reconcile_portal_alerts_on_account_change();

-- Lista de bloqueio: o endereço entra (bounce, complaint) ou é liberado.
CREATE OR REPLACE FUNCTION public.reconcile_portal_alerts_on_suppressed_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_emails text[];
  v_customer_ids bigint[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_emails := ARRAY[lower(NEW.email)];
  ELSIF TG_OP = 'DELETE' THEN
    v_emails := ARRAY[lower(OLD.email)];
  ELSE
    v_emails := ARRAY[lower(OLD.email), lower(NEW.email)];
  END IF;
  SELECT array_agg(a.customer_id) INTO v_customer_ids
  FROM public.customer_portal_accounts a
  WHERE a.recovery_email IS NOT NULL AND lower(a.recovery_email) = ANY(v_emails);
  PERFORM public._reconcile_client_portal_alerts_for_customers(v_customer_ids, 'portal_suppressed_email');
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_portal_alerts_on_suppressed_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reconcile_portal_alerts_on_suppressed_email ON public.portal_suppressed_emails;
CREATE TRIGGER reconcile_portal_alerts_on_suppressed_email
  AFTER INSERT OR DELETE OR UPDATE OF email ON public.portal_suppressed_emails
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_portal_alerts_on_suppressed_email();

-- B/L: entra, sai, troca de Cliente, é cancelado ou muda de status financeiro
-- (faturado, pago, baixa desfeita). Gatilhos de instrução: a importação e as
-- baixas gravam em lote, e a atualização só reconcilia se essas colunas
-- mudaram.
CREATE OR REPLACE FUNCTION public.reconcile_portal_alerts_from_bls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_ids bigint[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.customer_id) INTO v_customer_ids
    FROM new_rows n WHERE n.customer_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.customer_id) INTO v_customer_ids
    FROM old_rows o WHERE o.customer_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT affected.customer_id) INTO v_customer_ids
    FROM (
      SELECT n.customer_id, o.customer_id AS old_customer_id
      FROM new_rows n
      JOIN old_rows o ON o.id = n.id
      WHERE n.customer_id IS DISTINCT FROM o.customer_id
         OR n.cancelled_at IS DISTINCT FROM o.cancelled_at
         OR n.financial_status IS DISTINCT FROM o.financial_status
    ) changed
    CROSS JOIN LATERAL (VALUES (changed.customer_id), (changed.old_customer_id)) AS affected(customer_id)
    WHERE affected.customer_id IS NOT NULL;
  END IF;
  PERFORM public._reconcile_client_portal_alerts_for_customers(v_customer_ids, 'bl_change');
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_portal_alerts_from_bls() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reconcile_portal_alerts_on_bls_insert ON public.bls;
CREATE TRIGGER reconcile_portal_alerts_on_bls_insert
  AFTER INSERT ON public.bls
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_portal_alerts_from_bls();

DROP TRIGGER IF EXISTS reconcile_portal_alerts_on_bls_delete ON public.bls;
CREATE TRIGGER reconcile_portal_alerts_on_bls_delete
  AFTER DELETE ON public.bls
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_portal_alerts_from_bls();

DROP TRIGGER IF EXISTS reconcile_portal_alerts_on_bls_update ON public.bls;
CREATE TRIGGER reconcile_portal_alerts_on_bls_update
  AFTER UPDATE ON public.bls
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_portal_alerts_from_bls();

-- Invoice de Demurrage: emitida, vencida, paga, cancelada ou trocada de
-- Cliente. Em aberto, mantém o processo ativo do Cliente.
CREATE OR REPLACE FUNCTION public.reconcile_portal_alerts_on_demurrage_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._reconcile_client_portal_alerts_for_customers(ARRAY[NEW.customer_id], 'demurrage_invoice_change');
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public._reconcile_client_portal_alerts_for_customers(ARRAY[OLD.customer_id], 'demurrage_invoice_change');
  ELSE
    PERFORM public._reconcile_client_portal_alerts_for_customers(ARRAY[OLD.customer_id, NEW.customer_id], 'demurrage_invoice_change');
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_portal_alerts_on_demurrage_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reconcile_portal_alerts_on_demurrage_invoice_insert ON public.demurrage_invoices;
CREATE TRIGGER reconcile_portal_alerts_on_demurrage_invoice_insert
  AFTER INSERT OR DELETE ON public.demurrage_invoices
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_portal_alerts_on_demurrage_invoice();

DROP TRIGGER IF EXISTS reconcile_portal_alerts_on_demurrage_invoice_update ON public.demurrage_invoices;
CREATE TRIGGER reconcile_portal_alerts_on_demurrage_invoice_update
  AFTER UPDATE OF status, customer_id ON public.demurrage_invoices
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.customer_id IS DISTINCT FROM NEW.customer_id)
  EXECUTE FUNCTION public.reconcile_portal_alerts_on_demurrage_invoice();
