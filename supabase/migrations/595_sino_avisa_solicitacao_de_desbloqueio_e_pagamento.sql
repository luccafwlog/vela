-- 595: o sino avisa a nova solicitação de Desbloqueio de CE (Documentação) e
-- cada novo pagamento (Financeiro e Administrativo) — decisão do dono de
-- 2026-11-05, ADR 0126.
--
-- Até aqui toda Notificação Interna nascia de um evento de item de Alerta
-- (ADR 0034, 0107): `alert_id`, `alert_item_id` e `event_id` eram obrigatórios
-- e a notificação só aparecia enquanto o item estava ativo. Solicitação
-- recebida e pagamento recebido são acontecimentos, não pendências: entram como
-- **Aviso de acontecimento**, uma Notificação Interna sem Alerta, que fica no
-- sino até a pessoa ler (abrir ou "Marcar todas como lidas").
--
-- Mudanças:
--   1. `internal_notifications`: `alert_id`, `alert_item_id` e `event_id`
--      passam a aceitar nulo; coluna nova `event_key` (chave do acontecimento,
--      única por destinatário). Um CHECK exige um dos dois formatos: os três
--      ids do Alerta, ou a chave sem eles.
--   2. `_notify_departments_of_event`: entrega um aviso aos usuários ativos
--      dos setores informados (o papel legado `operator` conta como
--      Documentação; a conta de integração não recebe, como na 440). Sem
--      EXECUTE para `authenticated`: só os gatilhos abaixo chamam.
--   3. Gatilho em `ce_unlock_events` (ação `submit` de solicitação comum, não
--      VIP): "Nova solicitação de desbloqueio de CE" (ou "Solicitação de
--      desbloqueio de CE reenviada", no envio depois da correção) para a
--      Documentação, com destino `/desbloqueio-ce?pedido=<id>`.
--   4. Gatilho em `payments` (INSERT): "Novo pagamento" de fatura de Taxas
--      Locais ou avulsa, para Financeiro e Administrativo, com destino
--      `/taxas-locais?invoice=<id>`. Cobre o registro no detalhe, a baixa
--      automática do Itaú e a conciliação pelo extrato, que todos gravam em
--      `payments`.
--   5. Gatilho em `demurrage_invoices` (status passa a `paid` com valor em R$
--      positivo): "Novo pagamento de Demurrage", para Financeiro e
--      Administrativo, com destino `/demurrage?fatura=<id>`. A quitação pelo
--      desconto integral (isenção, 306) grava BRL zero e não avisa.
--   6. `list_internal_notifications` e `count_unread_internal_notifications`:
--      o aviso sem Alerta conta enquanto não lido; o de Alerta segue a regra
--      da 485 (só enquanto o item está ativo, na mesma ocorrência).
--
-- ponytail: o aviso de pagamento vai a cada usuário ativo dos dois setores, um
-- por pagamento; com volume alto, o caminho é agrupar ("N pagamentos novos")
-- por janela de tempo. O gatilho roda na transação do pagamento: falha da
-- entrega desfaz o pagamento, como o fan-out dos alertas; a função só insere
-- linhas e não chama nada externo.
--
-- Plano de preservação: não reescreve nem apaga linhas. Os ALTER só afrouxam o
-- NOT NULL das três colunas e acrescentam `event_key` (nula nas linhas
-- existentes, que passam no CHECK pelo formato de Alerta). Conferir com
-- `SELECT count(*) FROM internal_notifications WHERE alert_id IS NULL` (zero
-- logo depois da migration).
-- Rollback: DROP dos três gatilhos e das funções `_notify_departments_of_event`,
-- `_notify_ce_unlock_submitted`, `_notify_payment_registered` e
-- `_notify_demurrage_paid`; DELETE FROM internal_notifications WHERE alert_id
-- IS NULL (só os avisos de acontecimento); DROP CONSTRAINT
-- internal_notifications_origin_check e do índice único de `event_key`; DROP
-- COLUMN event_key; SET NOT NULL nas três colunas; reaplicar
-- `list_internal_notifications` e `count_unread_internal_notifications` da 485.

-- 1. Notificação Interna sem Alerta ------------------------------------------
ALTER TABLE public.internal_notifications
  ALTER COLUMN alert_id DROP NOT NULL,
  ALTER COLUMN alert_item_id DROP NOT NULL,
  ALTER COLUMN event_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS event_key text;

ALTER TABLE public.internal_notifications
  ADD CONSTRAINT internal_notifications_origin_check CHECK (
    (alert_id IS NOT NULL AND alert_item_id IS NOT NULL AND event_id IS NOT NULL AND event_key IS NULL)
    OR (alert_id IS NULL AND alert_item_id IS NULL AND event_id IS NULL AND event_key IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS internal_notifications_event_key_recipient_key
  ON public.internal_notifications (event_key, recipient_id)
  WHERE event_key IS NOT NULL;

COMMENT ON COLUMN public.internal_notifications.event_key IS
  'Aviso de acontecimento (595, ADR 0126): chave do acontecimento, sem Alerta. Nula na notificação de Alerta.';

-- 2. Entrega por setor --------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notify_departments_of_event(
  p_event_key text,
  p_departments text[],
  p_item_type text,
  p_title text,
  p_message text,
  p_entity_type text,
  p_entity_id text,
  p_destination text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- O papel legado `operator` é Documentação (328); a conta de integração não
  -- é pessoa e não recebe aviso (440). Sem destinatário, não há fallback: o
  -- aviso de acontecimento não é pendência.
  INSERT INTO public.internal_notifications (
    event_key, recipient_id, recipient_department, is_fallback, item_type,
    severity, title, message, entity_type, entity_id, destination, payload
  )
  SELECT p_event_key, up.id, d.department, false, p_item_type,
         'normal', p_title, p_message, p_entity_type, p_entity_id, p_destination,
         COALESCE(p_payload, '{}'::jsonb)
  FROM public.user_profiles up
  CROSS JOIN LATERAL (SELECT CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END AS department) d
  WHERE up.active = true
    AND up.account_kind <> 'integracao'
    AND d.department = ANY (p_departments)
  ON CONFLICT (event_key, recipient_id) WHERE event_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public._notify_departments_of_event(text, text[], text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- 3. Nova solicitação de Desbloqueio de CE -----------------------------------
CREATE OR REPLACE FUNCTION public._notify_ce_unlock_submitted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.ce_unlock_requests;
  v_customer text;
  v_bl_count integer;
  v_resubmit boolean;
BEGIN
  IF NEW.action <> 'submit' OR NEW.request_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_request FROM public.ce_unlock_requests WHERE id = NEW.request_id;
  -- A solicitação VIP usa os documentos anuais já aprovados: não há o que
  -- analisar e ela fica fora da fila Solicitações.
  IF NOT FOUND OR v_request.source <> 'request' THEN RETURN NULL; END IF;

  SELECT c.name INTO v_customer FROM public.customers c WHERE c.id = v_request.customer_id;
  SELECT count(*) INTO v_bl_count FROM public.ce_unlock_request_bls i WHERE i.request_id = v_request.id AND i.active;
  v_resubmit := EXISTS (
    SELECT 1 FROM public.ce_unlock_events e
    WHERE e.request_id = NEW.request_id AND e.action = 'submit' AND e.id < NEW.id);

  PERFORM public._notify_departments_of_event(
    'ce_unlock_submit:' || NEW.id,
    ARRAY['documentacao'],
    'desbloqueio_ce_solicitacao',
    CASE WHEN v_resubmit THEN 'Solicitação de desbloqueio de CE reenviada'
         ELSE 'Nova solicitação de desbloqueio de CE' END,
    format('%s enviou a solicitação %s (%s %s).',
      COALESCE(v_customer, 'Cliente'), v_request.protocol, v_bl_count,
      CASE WHEN v_bl_count = 1 THEN 'B/L' ELSE 'B/Ls' END),
    'ce_unlock_request',
    v_request.id::text,
    '/desbloqueio-ce?pedido=' || v_request.id,
    jsonb_build_object('protocol', v_request.protocol, 'customer_id', v_request.customer_id, 'resubmit', v_resubmit)
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._notify_ce_unlock_submitted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_ce_unlock_submitted ON public.ce_unlock_events;
CREATE TRIGGER trg_notify_ce_unlock_submitted
  AFTER INSERT ON public.ce_unlock_events
  FOR EACH ROW WHEN (NEW.action = 'submit')
  EXECUTE FUNCTION public._notify_ce_unlock_submitted();

-- 4. Novo pagamento de fatura de Taxas Locais ou avulsa -----------------------
CREATE OR REPLACE FUNCTION public._notify_payment_registered()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice_number text;
  v_customer text;
  v_method text;
BEGIN
  SELECT i.invoice_number, c.name INTO v_invoice_number, v_customer
  FROM public.invoices i
  LEFT JOIN public.customers c ON c.id = i.customer_id
  WHERE i.id = NEW.invoice_id;

  v_method := CASE NEW.payment_method
    WHEN 'pix' THEN 'Pix' WHEN 'ted' THEN 'TED' WHEN 'doc' THEN 'DOC'
    WHEN 'boleto' THEN 'Boleto' ELSE NULL END;

  PERFORM public._notify_departments_of_event(
    'payment:' || NEW.id,
    ARRAY['financeiro', 'administrativo'],
    'pagamento_recebido',
    'Novo pagamento',
    format('Fatura %s — %s: R$ %s%s.',
      COALESCE(v_invoice_number, NEW.invoice_id::text),
      COALESCE(v_customer, 'Cliente'),
      public._format_brl_amount(NEW.amount_brl),
      CASE WHEN v_method IS NULL THEN '' ELSE ' (' || v_method || ')' END),
    'invoice',
    NEW.invoice_id::text,
    '/taxas-locais?invoice=' || NEW.invoice_id,
    jsonb_build_object('payment_id', NEW.id, 'amount_brl', NEW.amount_brl, 'payment_method', NEW.payment_method)
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._notify_payment_registered() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_payment_registered ON public.payments;
CREATE TRIGGER trg_notify_payment_registered
  AFTER INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public._notify_payment_registered();

-- 5. Novo pagamento de Demurrage ---------------------------------------------
CREATE OR REPLACE FUNCTION public._notify_demurrage_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer text;
BEGIN
  SELECT c.name INTO v_customer FROM public.customers c WHERE c.id = NEW.customer_id;

  PERFORM public._notify_departments_of_event(
    -- A mesma Invoice paga de novo depois de Cancelar baixa é outro pagamento.
    format('demurrage_payment:%s:%s', NEW.id, txid_current()),
    ARRAY['financeiro', 'administrativo'],
    'pagamento_recebido',
    'Novo pagamento de Demurrage',
    format('Invoice %s — %s: R$ %s%s.',
      NEW.doc_number, COALESCE(v_customer, 'Cliente'),
      public._format_brl_amount(NEW.current_total_brl),
      CASE WHEN NEW.pix_txid IS NOT NULL THEN ' (Pix)' ELSE '' END),
    'demurrage_invoice',
    NEW.id::text,
    '/demurrage?fatura=' || NEW.id,
    jsonb_build_object('amount_brl', NEW.current_total_brl, 'total_usd', NEW.total_usd, 'bl_id', NEW.bl_id)
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._notify_demurrage_paid() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_demurrage_paid ON public.demurrage_invoices;
CREATE TRIGGER trg_notify_demurrage_paid
  AFTER UPDATE OF status ON public.demurrage_invoices
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND COALESCE(NEW.current_total_brl, 0) > 0)
  EXECUTE FUNCTION public._notify_demurrage_paid();

-- Valor em reais no texto do aviso: 1234.5 → "1.234,50".
CREATE OR REPLACE FUNCTION public._format_brl_amount(p_value numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT translate(to_char(COALESCE(p_value, 0), 'FM999,999,999,990.00'), ',.', '.,');
$function$;

REVOKE ALL ON FUNCTION public._format_brl_amount(numeric) FROM PUBLIC, anon, authenticated;

-- 6. Sino e número com o aviso sem Alerta ------------------------------------
CREATE OR REPLACE FUNCTION public.list_internal_notifications(p_include_read boolean DEFAULT false, p_limit integer DEFAULT 20, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id bigint DEFAULT NULL::bigint)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'id', n.id,
    'alert_id', n.alert_id,
    'alert_item_id', n.alert_item_id,
    'item_type', n.item_type,
    'severity', n.severity,
    'title', n.title,
    'message', n.message,
    'entity_type', n.entity_type,
    'entity_id', n.entity_id,
    'destination', n.destination,
    'is_fallback', n.is_fallback,
    'read_at', n.read_at,
    'created_at', n.created_at,
    'payload', n.payload
  )
  FROM public.internal_notifications n
  WHERE public.is_active_read_user()
    AND n.recipient_id = auth.uid()
    AND (p_include_read OR n.read_at IS NULL)
    AND (
      -- 595: o aviso de acontecimento (sem Alerta) vale até ser lido.
      n.alert_item_id IS NULL
      OR EXISTS (
        -- 485 (M7): leitura direta, sem função por linha; vale a notificação do
        -- alerta ainda aberto, na mesma ocorrência.
        SELECT 1 FROM public.alert_items i
        JOIN public.alert_item_events e ON e.id = n.event_id
        WHERE i.id = n.alert_item_id AND i.status = 'active' AND e.occurrence_id = i.occurrence_id))
    AND (
      p_before_created_at IS NULL
      OR n.created_at < p_before_created_at
      OR (n.created_at = p_before_created_at AND n.id < p_before_id)
    )
  ORDER BY n.created_at DESC, n.id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
$function$;

CREATE OR REPLACE FUNCTION public.count_unread_internal_notifications()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.internal_notifications n
  WHERE n.recipient_id = auth.uid()
    AND n.read_at IS NULL
    AND (
      -- 595: o aviso de acontecimento (sem Alerta) conta até ser lido.
      n.alert_item_id IS NULL
      OR EXISTS (
        -- 485 (M7): leitura direta, sem função por linha; vale a notificação do
        -- alerta ainda aberto, na mesma ocorrência.
        SELECT 1 FROM public.alert_items i
        JOIN public.alert_item_events e ON e.id = n.event_id
        WHERE i.id = n.alert_item_id AND i.status = 'active' AND e.occurrence_id = i.occurrence_id));

  RETURN v_count;
END;
$function$;
