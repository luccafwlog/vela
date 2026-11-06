-- 599: textos do sino e do alerta de veículos (revisão da release
-- `staging` → `main` de 2026-11-06, pedido do dono). Só recria três funções;
-- regras, destinatários, gatilhos e chaves ficam como estão.
--
-- Mudanças:
--   1. `reconcile_voyage_vehicle_sheet_alerts` (corpo da 597): a frase "o CE
--      Mercante dos B/Ls de container fica travado" / "está travado" só entra
--      quando algum B/L ativo de container ou misto da viagem ainda está sem
--      CE. Antes saía também na viagem com todos os CEs vinculados (por
--      exemplo, antes da 597), onde nada estava travado. Abrir, fechar,
--      gravidade e prazos não mudam; o item aberto ganha o texto novo na
--      próxima reconciliação (detector de 15 minutos ou gatilhos).
--   2. `_notify_ce_unlock_submitted` (corpo da 595): o aviso "<Cliente>
--      enviou a solicitação" só sai quando quem enviou não é usuário interno
--      (`user_profiles`). Hoje só o Portal envia; o envio interno pelo
--      `ce_unlock_command` existe no banco e avisaria a equipe de uma ação
--      dela mesma, dizendo que foi o Cliente.
--   3. `_notify_demurrage_paid` (corpo da 595): o meio no texto vem de
--      `demurrage_invoices.payment_method` (519: pix_itau, extrato, manual),
--      com os rótulos da aba Pagas ("Pix Itaú", "Extrato", "Registro
--      manual"). Antes era "(Pix)" para qualquer TXID, inclusive o da
--      conciliação pelo extrato, e nada na baixa manual.
--
-- Plano de preservação: esta migration não reescreve nem apaga linha. Ela só
-- recria três funções (CREATE OR REPLACE, mesma assinatura, mesmos grants).
-- Avisos e alertas já gravados ficam com o texto antigo; o item de alerta
-- ainda aberto recebe o texto novo na próxima reconciliação, como qualquer
-- mudança de mensagem. Conferir: `SELECT count(*) FROM internal_notifications`
-- e `SELECT count(*) FROM alert_items` iguais antes e depois da migration.
-- Desfazer: o rollback abaixo.
--
-- Rollback: reaplicar `reconcile_voyage_vehicle_sheet_alerts` pela 597 e
-- `_notify_ce_unlock_submitted` e `_notify_demurrage_paid` pela 595.

-- 1 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_voyage_vehicle_sheet_alerts(p_voyage_id bigint, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_status text;
  v_first_eta date;
  v_container_bls integer := 0;
  v_has_vehicle boolean;
  v_answer boolean;  -- NULL sem resposta; true "terá"; false "não terá"
  v_answered boolean;
  v_decl_open boolean;
  v_sheet_open boolean;
  v_decl_due boolean := false;
  v_sheet_due boolean := false;
  v_ce_pending boolean := false;  -- 599: algum B/L de container ou misto ainda sem CE
BEGIN
  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id;
  IF NOT FOUND OR v_status = 'cancelled' THEN
    PERFORM public.resolve_alert_item('voyage_vehicle_declaration_pending', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    PERFORM public.resolve_alert_item('voyage_vehicle_sheet_pending', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  SELECT
    bool_or(i.item_type = 'voyage_vehicle_declaration_pending'),
    bool_or(i.item_type = 'voyage_vehicle_sheet_pending')
  INTO v_decl_open, v_sheet_open
  FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.item_type IN ('voyage_vehicle_declaration_pending', 'voyage_vehicle_sheet_pending')
    AND i.status = 'active' AND a.entity_type = 'voyage' AND a.entity_id = p_voyage_id::text;
  v_decl_open := COALESCE(v_decl_open, false);
  v_sheet_open := COALESCE(v_sheet_open, false);

  -- Viagem concluída não ganha tipo novo (346): só o aberto é reavaliado.
  IF v_status <> 'active' AND NOT v_decl_open AND NOT v_sheet_open THEN
    RETURN;
  END IF;

  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);

  -- A planilha de Veículos casa veículo com B/L e container: viagem só de carga
  -- solta não tem o que importar (468).
  SELECT count(*) INTO v_container_bls
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND b.cancelled_at IS NULL
    AND b.cargo_mode IN ('container', 'misto')
    AND COALESCE(public.normalize_port_code(b.pod), upper(btrim(b.pod))) IN (
      SELECT COALESCE(public.normalize_port_code(e.pod), e.pod) FROM public.get_voyage_eligible_pods(p_voyage_id) AS e);

  v_has_vehicle := EXISTS (SELECT 1 FROM public.vehicles v WHERE v.voyage_id = p_voyage_id);
  -- 599: a frase da trava só entra quando ainda há CE a vincular. A trava
  -- (`voyage_ce_mercante_vehicle_lock`) vale para todo B/L ativo de container
  -- ou misto da viagem ativa, sem filtro de POD; a frase segue a mesma régua.
  v_ce_pending := v_status = 'active' AND EXISTS (
    SELECT 1 FROM public.bls b
    WHERE b.voyage_id = p_voyage_id
      AND b.cancelled_at IS NULL
      AND b.cargo_mode IN ('container', 'misto')
      AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL);
  SELECT d.has_vehicles INTO v_answer FROM public.voyage_vehicle_declarations d WHERE d.voyage_id = p_voyage_id;
  v_answered := FOUND;

  IF v_first_eta IS NOT NULL AND v_container_bls > 0 AND NOT v_has_vehicle THEN
    -- D-7 até a véspera de D-5: falta a resposta.
    v_decl_due := NOT v_answered AND v_today >= (v_first_eta - 7) AND v_today < (v_first_eta - 5);
    -- D-5: sem resposta ou com "terá veículos", a planilha está ausente.
    v_sheet_due := v_today >= (v_first_eta - 5) AND (NOT v_answered OR v_answer);
  END IF;
  IF v_status <> 'active' THEN
    v_decl_due := v_decl_due AND v_decl_open;
    v_sheet_due := v_sheet_due AND v_sheet_open;
  END IF;

  IF v_decl_due THEN
    PERFORM public.upsert_alert_item(
      'voyage_vehicle_declaration_pending',
      'voyage',
      p_voyage_id::text,
      'Declare se a viagem terá veículos; ETA em ' || to_char(v_first_eta, 'DD/MM/YYYY')
        || CASE WHEN v_ce_pending
             THEN '. Sem a resposta, o CE Mercante dos B/Ls de container fica travado e o alerta passa a crítico em D-5.'
             ELSE '. Sem a resposta, o alerta passa a crítico em D-5.' END,
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'container_bl_count', v_container_bls, 'first_eta', v_first_eta),
      '/veiculos?voyage=' || p_voyage_id
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_vehicle_declaration_pending', 'voyage', p_voyage_id::text, p_source,
      CASE WHEN v_sheet_due THEN jsonb_build_object('reason', 'd5_sem_resposta') ELSE '{}'::jsonb END);
  END IF;

  IF v_sheet_due THEN
    PERFORM public.upsert_alert_item(
      'voyage_vehicle_sheet_pending',
      'voyage',
      p_voyage_id::text,
      CASE WHEN v_answered
        THEN 'Planilha de Veículos ausente: a viagem foi declarada com veículos e nenhum veículo foi importado; ETA em '
          || to_char(v_first_eta, 'DD/MM/YYYY') || ', prazo D-5 atingido.'
          || CASE WHEN v_ce_pending THEN ' O CE Mercante dos B/Ls de container está travado até a importação.' ELSE '' END
        ELSE 'Declare se a viagem terá veículos ou importe a planilha de Veículos; ETA em '
          || to_char(v_first_eta, 'DD/MM/YYYY') || ', prazo D-5 atingido.'
          || CASE WHEN v_ce_pending THEN ' O CE Mercante dos B/Ls de container está travado até a resposta.' ELSE '' END
      END,
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'container_bl_count', v_container_bls, 'first_eta', v_first_eta,
        'declared_with_vehicles', v_answered),
      '/veiculos?voyage=' || p_voyage_id
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_vehicle_sheet_pending', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_vehicle_sheet_alerts(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_vehicle_sheet_alerts(bigint, text) TO service_role;

-- 2 -------------------------------------------------------------------------
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
  -- 599: o aviso diz que o Cliente enviou. O envio pela equipe interna
  -- (`ce_unlock_command`, sem tela hoje) não avisa a própria equipe; a conta
  -- do Portal não tem linha em `user_profiles`.
  IF EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = NEW.actor_id) THEN RETURN NULL; END IF;

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

-- 3 -------------------------------------------------------------------------
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
      -- 599: o meio é o que o gatilho da 519 gravou (BEFORE, antes deste),
      -- com os rótulos da aba Pagas; o TXID sozinho não diz o meio.
      CASE NEW.payment_method
        WHEN 'pix_itau' THEN ' (Pix Itaú)'
        WHEN 'extrato' THEN ' (Extrato)'
        WHEN 'manual' THEN ' (Registro manual)'
        ELSE '' END),
    'demurrage_invoice',
    NEW.id::text,
    '/demurrage?fatura=' || NEW.id,
    jsonb_build_object('amount_brl', NEW.current_total_brl, 'total_usd', NEW.total_usd, 'bl_id', NEW.bl_id,
      'payment_method', NEW.payment_method)
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._notify_demurrage_paid() FROM PUBLIC, anon, authenticated;
