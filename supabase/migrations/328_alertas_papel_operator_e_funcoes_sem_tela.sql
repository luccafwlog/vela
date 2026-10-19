-- 328: alertas chegam ao papel legado "operator" como Documentação, e duas
-- funções sem uso na tela deixam de ser executáveis pelo navegador (lote 5b
-- da identidade visual, tela 7 Administração, achados P1 e P5 do mapeamento
-- da matriz de permissões, aprovados pelo responsável em 2026-10-19).
--
-- Problema:
--   P1. O sistema trata o papel legado `operator` como Documentação em tudo
--       (assinatura do ADR, contatos, Desbloqueio de CE, `current_actor_role`),
--       menos no envio de alertas. `fanout_alert_item` e
--       `fanout_alert_item_for_department` (definição vigente: migration
--       `002`) comparam `user_profiles.role` direto com a audiência do
--       catálogo, que só fala em `documentacao`. Quem ainda tiver o papel
--       `operator` não recebe os 37 tipos de Documentação, e um alerta crítico
--       de Documentação cai no Administrativo (ou em "Falhas de entrega de
--       alertas") mesmo com essa pessoa ativa. O fallback também testa o
--       literal `admin`, papel que não existe desde a migration `093` (a
--       `user_profiles_role_check` já o recusa).
--   P5. Duas funções restritas sem uso em nenhuma tela, Edge Function ou RPC
--       continuam executáveis por `authenticated`:
--       - `settle_invoice_refund(bigint, uuid)`: caminho antigo de confirmar
--         a Restituição, que sempre falha ("Use a confirmação de devolução
--         com referência bancária..."); a tela usa `confirm_invoice_refund`;
--       - `reopen_demurrage_invoice(uuid, bigint, text)`: reabre Invoice de
--         Demurrage paga; nenhuma tela chama (o wrapper `unmarkInvoicePaid`
--         do front, sem chamador, sai nesta mesma mudança).
--       A terceira função do achado, `reconcile_invoice_payment_by_txid`, NÃO
--       é revogada: `confirm_unified_pix_matches` (SECURITY INVOKER, chamada
--       pela Conciliação Pix) a executa com o papel de quem está logado, e
--       revogar quebraria a conciliação. Fica para decisão do responsável.
--
-- Mudança:
--   P1. As duas funções passam a entregar o item ao usuário `operator` ativo
--       quando a audiência inclui `documentacao`, gravando o destinatário com
--       o Departamento `documentacao` (como `current_actor_role`). O fallback
--       crítico procura só `administrativo`. O resto do corpo é o vigente.
--   P5. REVOKE EXECUTE das duas funções para PUBLIC, anon e authenticated;
--       `service_role` e o dono continuam podendo executar.
--
-- Não reescreve linhas existentes. Rollback: recriar as duas funções com o
-- corpo da migration `002` e devolver o GRANT EXECUTE a `authenticated`.

CREATE OR REPLACE FUNCTION public.fanout_alert_item(p_alert_id bigint, p_item_id bigint, p_event_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.alert_items%ROWTYPE;
  v_alert public.alerts%ROWTYPE;
  v_catalog public.alert_type_catalog%ROWTYPE;
  v_user RECORD;
  v_count INTEGER := 0;
  v_fallback BOOLEAN := false;
BEGIN
  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id;
  SELECT * INTO v_alert FROM public.alerts WHERE id = p_alert_id;
  SELECT * INTO v_catalog FROM public.alert_type_catalog WHERE type = v_item.item_type;

  -- O papel legado `operator` é Documentação, como no resto do sistema (328).
  FOR v_user IN
    SELECT up.id, CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END AS department
    FROM public.user_profiles up
    WHERE up.active = true
      AND (CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END) = ANY(v_catalog.audience_departments)
  LOOP
    INSERT INTO public.internal_notifications (
      alert_id, alert_item_id, event_id, recipient_id, recipient_department,
      is_fallback, item_type, severity, title, message, entity_type, entity_id,
      destination, payload
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_user.id, v_user.department,
      false, v_item.item_type, v_item.severity, 'Nova pendência operacional',
      v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
      v_item.metadata
    )
    ON CONFLICT (event_id, recipient_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 AND v_item.severity = 'critical' THEN
    v_fallback := true;
    FOR v_user IN
      SELECT up.id, up.role AS department
      FROM public.user_profiles up
      WHERE up.active = true AND up.role = 'administrativo'
    LOOP
      INSERT INTO public.internal_notifications (
        alert_id, alert_item_id, event_id, recipient_id, recipient_department,
        is_fallback, item_type, severity, title, message, entity_type, entity_id,
        destination, payload
      )
      VALUES (
        p_alert_id, p_item_id, p_event_id, v_user.id, v_user.department,
        true, v_item.item_type, v_item.severity, 'Nova pendência operacional',
        v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
        jsonb_build_object('fallback_for', v_item.department) || v_item.metadata
      )
      ON CONFLICT (event_id, recipient_id) DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  IF v_count = 0 THEN
    INSERT INTO public.alert_notification_failures (
      alert_id, alert_item_id, event_id, item_type, department, reason
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_item.item_type,
      COALESCE(v_item.department, v_catalog.responsible_department),
      CASE WHEN v_fallback THEN 'Nenhum destinatário ativo no fallback Administrativo.'
           ELSE 'Nenhum destinatário ativo na audiência do item.' END
    );
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fanout_alert_item_for_department(p_alert_id bigint, p_item_id bigint, p_event_id bigint, p_department text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.alert_items%ROWTYPE;
  v_alert public.alerts%ROWTYPE;
  v_catalog public.alert_type_catalog%ROWTYPE;
  v_user RECORD;
  v_audience TEXT[];
  v_count INTEGER := 0;
  v_fallback BOOLEAN := false;
BEGIN
  SELECT * INTO v_item FROM public.alert_items WHERE id = p_item_id;
  SELECT * INTO v_alert FROM public.alerts WHERE id = p_alert_id;
  SELECT * INTO v_catalog FROM public.alert_type_catalog WHERE type = v_item.item_type;

  SELECT COALESCE(array_agg(DISTINCT department ORDER BY department), '{}'::TEXT[])
  INTO v_audience
  FROM unnest(
    COALESCE(v_catalog.audience_departments, '{}'::TEXT[])
    || CASE WHEN NULLIF(btrim(p_department), '') IS NULL THEN '{}'::TEXT[]
            ELSE ARRAY[NULLIF(btrim(p_department), '')] END
  ) AS departments(department)
  WHERE department IS NOT NULL;

  -- O papel legado `operator` é Documentação, como no resto do sistema (328).
  FOR v_user IN
    SELECT up.id, CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END AS department
    FROM public.user_profiles up
    WHERE up.active = true
      AND (CASE up.role WHEN 'operator' THEN 'documentacao' ELSE up.role END) = ANY(v_audience)
  LOOP
    INSERT INTO public.internal_notifications (
      alert_id, alert_item_id, event_id, recipient_id, recipient_department,
      is_fallback, item_type, severity, title, message, entity_type, entity_id,
      destination, payload
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_user.id, v_user.department,
      false, v_item.item_type, v_item.severity, 'Nova pendência operacional',
      v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
      v_item.metadata
    )
    ON CONFLICT (event_id, recipient_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 AND v_item.severity = 'critical' THEN
    v_fallback := true;
    FOR v_user IN
      SELECT up.id, up.role AS department
      FROM public.user_profiles up
      WHERE up.active = true AND up.role = 'administrativo'
    LOOP
      INSERT INTO public.internal_notifications (
        alert_id, alert_item_id, event_id, recipient_id, recipient_department,
        is_fallback, item_type, severity, title, message, entity_type, entity_id,
        destination, payload
      )
      VALUES (
        p_alert_id, p_item_id, p_event_id, v_user.id, v_user.department,
        true, v_item.item_type, v_item.severity, 'Nova pendência operacional',
        v_item.message, v_alert.entity_type, v_alert.entity_id, v_item.destination,
        jsonb_build_object('fallback_for', COALESCE(NULLIF(btrim(p_department), ''), v_catalog.responsible_department)) || v_item.metadata
      )
      ON CONFLICT (event_id, recipient_id) DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  IF v_count = 0 THEN
    INSERT INTO public.alert_notification_failures (
      alert_id, alert_item_id, event_id, item_type, department, reason
    )
    VALUES (
      p_alert_id, p_item_id, p_event_id, v_item.item_type,
      COALESCE(NULLIF(btrim(p_department), ''), v_catalog.responsible_department, 'desconhecido'),
      CASE WHEN v_fallback THEN 'Nenhum destinatário ativo no fallback Administrativo.'
           ELSE 'Nenhum destinatário ativo na audiência do item.' END
    );
  END IF;

  RETURN v_count;
END;
$function$;

-- As duas seguem fora do alcance do navegador, como na 002.
REVOKE ALL ON FUNCTION public.fanout_alert_item(bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fanout_alert_item_for_department(bigint, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fanout_alert_item(bigint, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.fanout_alert_item_for_department(bigint, bigint, bigint, text) TO service_role;

-- P5: funções restritas sem uso em tela, Edge Function ou RPC.
REVOKE ALL ON FUNCTION public.settle_invoice_refund(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reopen_demurrage_invoice(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_demurrage_invoice(uuid, bigint, text) TO service_role;
