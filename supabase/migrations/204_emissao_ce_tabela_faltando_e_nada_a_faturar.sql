-- 204 — Emissão pelo CE: tabela de cobrança faltando é espera, e B/L sem taxa
-- com valor é "Nada a faturar" (ADR 0079, decisão 4).
--
-- Até aqui (195), duas recusas de negócio abriam o Alerta crítico "A emissão
-- automática falhou", um por B/L, e apareciam como bloqueio no resultado:
-- - tabela de cobrança faltando para o POD e a modalidade: o cálculo fica em
--   revisão ("Nenhuma tabela de taxas ativa…") e a emissão dizia "Aguardando
--   Revisão"; ou a emissão recusava ("Tabela de cobrança incompleta ou
--   inativa") e cada B/L abria um Alerta crítico — vinte B/Ls de Pecém
--   esperando a mesma tabela, vinte Alertas iguais;
-- - "B/L sem linhas faturáveis" (cálculo feito, todas as taxas zeradas).
--
-- Agora:
-- - tabela faltando vira a espera "Aguardando tabela de cobrança", com um
--   Alerta normal por POD e modalidade (`billing_charge_table_missing`) que
--   lista os B/Ls. Cadastrada a tabela, a emissão refaz o cálculo que só
--   esperava por ela (revisão de pessoa fica). A fatura que sai, por qualquer
--   caminho, tira o B/L da lista, e o Alerta fecha quando a lista esvazia;
-- - B/L calculado sem nenhuma taxa com valor sai como "Nada a faturar", sem
--   Alerta. Sem cálculo, continua falha.
--
-- Redefine `emit_ce_mercante_billing` e `resolve_auto_issue_alert_on_invoiced`
-- a partir da 195. Não reescreve nem apaga linhas existentes. Rollback:
-- reaplicar as definições da 195, DROP das funções `_cargo_mode_label`,
-- `_write_charge_table_gap` e `_note_charge_table_gap` e desativar o tipo de
-- Alerta no catálogo.

INSERT INTO public.alert_type_catalog(type, severity, responsible_department, audience_departments, default_destination)
VALUES ('billing_charge_table_missing', 'normal', 'documentacao', ARRAY['documentacao'], '/taxas-locais/tabelas')
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public._cargo_mode_label(p_mode text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_mode WHEN 'carga_solta' THEN 'carga solta' WHEN 'misto' THEN 'misto' ELSE COALESCE(p_mode, 'container') END;
$function$;
REVOKE ALL ON FUNCTION public._cargo_mode_label(text) FROM PUBLIC, anon, authenticated;

-- Grava o Alerta da tabela faltando com a lista de B/Ls; lista vazia fecha.
CREATE OR REPLACE FUNCTION public._write_charge_table_gap(p_pod text, p_mode text, p_bl_ids text[], p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text := p_pod || ':' || COALESCE(p_mode, 'container');
  v_count integer := COALESCE(cardinality(p_bl_ids), 0);
BEGIN
  IF v_count = 0 THEN
    PERFORM public.resolve_alert_item('billing_charge_table_missing', 'charge_table_gap', v_key, p_source,
      jsonb_build_object('resolution', 'invoiced', 'pod', p_pod, 'cargo_mode', p_mode));
    RETURN;
  END IF;
  PERFORM public.upsert_alert_item(
    'billing_charge_table_missing', 'charge_table_gap', v_key,
    format('Tabela de cobrança faltando para o POD %s (%s): %s B/L(s) aguardando a fatura (%s%s). Cadastre a tabela em Taxas Locais › Tabelas e emita.',
      p_pod, public._cargo_mode_label(p_mode), v_count,
      array_to_string(p_bl_ids[1:10], ', '), CASE WHEN v_count > 10 THEN ', …' ELSE '' END),
    p_source,
    jsonb_build_object('pod', p_pod, 'cargo_mode', p_mode, 'bl_ids', to_jsonb(p_bl_ids)),
    '/taxas-locais/tabelas');
END;
$function$;
REVOKE ALL ON FUNCTION public._write_charge_table_gap(text, text, text[], text) FROM PUBLIC, anon, authenticated;

-- Acrescenta o B/L à lista do Alerta do POD e da modalidade.
CREATE OR REPLACE FUNCTION public._note_charge_table_gap(p_pod text, p_mode text, p_bl_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current jsonb;
BEGIN
  SELECT i.metadata->'bl_ids' INTO v_current
  FROM public.alert_items AS i
  JOIN public.alerts AS a ON a.id = i.alert_id
  WHERE i.item_type = 'billing_charge_table_missing' AND i.status = 'active'
    AND a.entity_type = 'charge_table_gap' AND a.entity_id = p_pod || ':' || COALESCE(p_mode, 'container')
  ORDER BY i.id DESC
  LIMIT 1;
  PERFORM public._write_charge_table_gap(p_pod, p_mode,
    ARRAY(SELECT DISTINCT x FROM (
      SELECT jsonb_array_elements_text(COALESCE(v_current, '[]'::jsonb)) AS x
      UNION SELECT p_bl_id
    ) AS ids ORDER BY 1),
    'ce_mercante_planilha');
END;
$function$;
REVOKE ALL ON FUNCTION public._note_charge_table_gap(text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.emit_ce_mercante_billing(p_bl_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_bl_id text;
  v_bl public.bls%ROWTYPE;
  v_one jsonb;
  v_wait jsonb;
  v_gate_refusal boolean;
  v_results jsonb := '[]'::jsonb;
  v_status text;
  v_state text;
  v_message text;
  v_pod text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(COALESCE(p_bl_ids, ARRAY[]::text[])) > 50 THEN
    RAISE EXCEPTION 'No máximo 50 B/Ls por lote de emissão.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_bl_id IN ARRAY COALESCE(p_bl_ids, ARRAY[]::text[]) LOOP
    BEGIN
      PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
      IF NOT FOUND THEN
        v_one := jsonb_build_object('status', 'blocked', 'reason', 'not_found', 'message', 'B/L não encontrado.');
      ELSIF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND (cancelled_at IS NOT NULL OR NULLIF(btrim(COALESCE(ce_mercante, '')), '') IS NULL)) THEN
        v_one := jsonb_build_object('status', 'skipped', 'reason', 'no_ce_or_cancelled');
      ELSIF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND COALESCE(financial_status, 'pending') <> 'pending')
            OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0 THEN
        v_one := jsonb_build_object('status', 'already_invoiced');
      ELSE
        -- Tabela cadastrada depois da espera (decisão 4): o cálculo cuja única
        -- revisão era "nenhuma tabela ativa" é refeito antes da emissão. Outra
        -- linha em revisão é revisão de pessoa e fica.
        IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND charge_status = 'review_required')
           AND EXISTS (
             SELECT 1 FROM public.charge_calculations AS c
             WHERE c.bl_id = v_bl_id AND c.status = 'review_required'
               AND COALESCE(c.review_reason, '') LIKE 'Nenhuma tabela de taxas ativa%')
           AND NOT EXISTS (
             SELECT 1 FROM public.charge_calculations AS c
             WHERE c.bl_id = v_bl_id AND c.status = 'review_required'
               AND COALESCE(c.review_reason, '') NOT LIKE 'Nenhuma tabela de taxas ativa%')
           AND EXISTS (SELECT 1 FROM public.resolve_bl_local_charge_table_ids(v_bl_id)) THEN
          PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
        END IF;
        v_one := public._auto_bill_bl_core(v_bl_id, v_actor, true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_one := jsonb_build_object('status', 'blocked', 'reason', 'auto_billing_failed',
        'message', public._ce_row_error_message(v_state, v_message), 'sqlstate', v_state);
    END;

    -- Esperas de negócio (K1): Cliente não conciliado e Revisão pendente não
    -- são falha. A recusa das travas de faturamento chega como 22023/P0003
    -- (`mark_bl_ready_for_billing`, `prevent_pending_review_invoice`); o
    -- estado do B/L diz qual espera é.
    v_wait := NULL;
    IF v_one->>'status' = 'blocked' THEN
      SELECT * INTO v_bl FROM public.bls WHERE id = v_bl_id;
      IF FOUND THEN
        v_gate_refusal := v_one->>'reason' = 'auto_billing_failed'
          AND COALESCE(v_one->>'sqlstate', '') IN ('22023', 'P0003');
        IF v_one->>'reason' = 'customer_reconciliation_pending'
           OR (v_gate_refusal AND (v_bl.customer_id IS NULL
             OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled'))) THEN
          v_wait := jsonb_build_object('reason', 'customer_reconciliation_pending', 'waiting', true,
            'message', 'Aguardando conciliação do Cliente: a fatura sai quando o Cliente do B/L for conciliado.');
        -- Tabela de cobrança faltando para o POD e a modalidade (ADR 0079,
        -- decisão 4): espera de cadastro, não falha técnica nem Revisão. Vem da
        -- recusa da emissão (P0004) ou do cálculo que ficou em revisão por não
        -- achar tabela ativa. Um Alerta por POD e modalidade lista os B/Ls e
        -- fecha quando as faturas saem.
        ELSIF (v_one->>'reason' = 'auto_billing_failed'
               AND COALESCE(v_one->>'sqlstate', '') = 'P0004'
               AND COALESCE(v_one->>'message', '') ~* 'tabela de cobran')
           OR (v_gate_refusal
               AND EXISTS (
                 SELECT 1 FROM public.charge_calculations AS c
                 WHERE c.bl_id = v_bl_id AND c.status = 'review_required'
                   AND COALESCE(c.review_reason, '') LIKE 'Nenhuma tabela de taxas ativa%')
               AND NOT EXISTS (SELECT 1 FROM public.resolve_bl_local_charge_table_ids(v_bl_id))) THEN
          v_pod := COALESCE(public.normalize_port_code(v_bl.pod), NULLIF(upper(btrim(COALESCE(v_bl.pod, ''))), ''), '—');
          v_wait := jsonb_build_object('reason', 'charge_table_missing', 'waiting', true,
            'message', format('Aguardando tabela de cobrança: cadastre a tabela do POD %s (%s) em Taxas Locais › Tabelas; a fatura sai na próxima emissão.',
              v_pod, public._cargo_mode_label(v_bl.cargo_mode)));
          PERFORM public._note_charge_table_gap(v_pod, v_bl.cargo_mode, v_bl_id);
        ELSIF v_gate_refusal AND (
          v_bl.review_status = 'pending_review'
          OR v_bl.charge_status = 'review_required'
          OR EXISTS (SELECT 1 FROM public.charge_calculations AS c WHERE c.bl_id = v_bl_id AND c.status = 'review_required')
          OR COALESCE(cardinality(public.compute_bl_review_pendencies(v_bl_id)), 0) > 0
          OR COALESCE(cardinality(public.check_bl_terminal_pendencies(v_bl_id)), 0) > 0
          OR COALESCE(v_one->>'message', '') ~* '(revis|terminal)'
        ) THEN
          v_wait := jsonb_build_object('reason', 'review_pending', 'waiting', true,
            'message', 'Aguardando Revisão do B/L: a fatura sai quando a Revisão terminar.');
        -- Cálculo feito e nenhuma taxa com valor (decisão 4): nada a faturar,
        -- sem Alerta. Sem cálculo, continua falha.
        ELSIF v_one->>'reason' = 'auto_billing_failed'
              AND COALESCE(v_one->>'message', '') ~* 'sem linhas fatur'
              AND EXISTS (
                SELECT 1 FROM public.charge_calculations AS c
                WHERE c.bl_id = v_bl_id AND COALESCE(c.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
              ) THEN
          v_one := jsonb_build_object('status', 'skipped', 'reason', 'nothing_to_bill',
            'message', 'Nada a faturar: o cálculo do B/L não tem taxa com valor.');
        END IF;
      END IF;
      IF v_wait IS NOT NULL THEN
        v_one := v_one || v_wait;
      END IF;
    END IF;

    v_status := CASE
      WHEN v_one->>'status' IN ('invoiced', 'already_invoiced') THEN 'invoiced'
      WHEN v_one->>'status' = 'held' THEN 'held'
      WHEN v_one->>'status' = 'skipped' THEN 'skipped'
      ELSE 'blocked'
    END;
    IF v_status = 'blocked' AND v_wait IS NULL THEN
      -- Alerta por B/L (ADR 0041): a falha técnica não fica escondida no lote.
      BEGIN
        PERFORM public.upsert_billing_alert('billing_auto_issue_failed', v_bl_id,
          format('A emissão automática do B/L %s pelo CE Mercante falhou: %s', v_bl_id,
            COALESCE(NULLIF(btrim(v_one->>'message'), ''), 'erro sem mensagem (' || COALESCE(v_one->>'reason', 'desconhecido') || ')')),
          jsonb_build_object('bl_id', v_bl_id, 'reason', v_one->>'reason', 'sqlstate', v_one->>'sqlstate', 'source', 'ce_mercante_planilha'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta de emissão do B/L % não registrado: %', v_bl_id, SQLERRM;
      END;
    ELSIF v_status = 'invoiced' THEN
      -- A fatura saiu: a falha anterior deixa de valer.
      BEGIN
        PERFORM public.resolve_alert_item('billing_auto_issue_failed', 'bl', v_bl_id, 'ce_mercante_planilha',
          jsonb_build_object('resolution', 'invoiced'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta de emissão do B/L % não resolvido: %', v_bl_id, SQLERRM;
      END;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'bl_id', v_bl_id,
      'status', v_status,
      'reason', COALESCE(v_one->>'reason', v_one->>'status'),
      'message', v_one->>'message',
      'waiting', v_wait IS NOT NULL,
      'invoice_number', (SELECT i.invoice_number FROM public.invoices AS i
        WHERE i.id = ANY(public._live_local_invoice_ids_for_bl(v_bl_id)) ORDER BY i.id DESC LIMIT 1)
    ));
  END LOOP;

  RETURN jsonb_build_object('results', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.emit_ce_mercante_billing(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emit_ce_mercante_billing(text[]) TO authenticated;

-- O Alerta de tabela faltando lista os B/Ls; a fatura que sai tira o B/L da
-- lista, e o Alerta fecha quando a lista esvazia (decisão 4).
CREATE OR REPLACE FUNCTION public.resolve_auto_issue_alert_on_invoiced()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gap record;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'billing_auto_issue_failed' AND i.status = 'active'
      AND a.entity_type = 'bl' AND a.entity_id = NEW.id
  ) THEN
    PERFORM public.resolve_alert_item('billing_auto_issue_failed', 'bl', NEW.id, 'bl_invoiced',
      jsonb_build_object('resolution', 'invoiced', 'financial_status', NEW.financial_status));
  END IF;
  FOR v_gap IN
    SELECT a.entity_id, i.metadata
    FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'billing_charge_table_missing' AND i.status = 'active'
      AND a.entity_type = 'charge_table_gap'
      AND COALESCE(i.metadata->'bl_ids', '[]'::jsonb) ? NEW.id
  LOOP
    PERFORM public._write_charge_table_gap(
      v_gap.metadata->>'pod', v_gap.metadata->>'cargo_mode',
      ARRAY(SELECT x FROM jsonb_array_elements_text(v_gap.metadata->'bl_ids') AS x WHERE x <> NEW.id ORDER BY 1),
      'bl_invoiced');
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_auto_issue_alert_on_invoiced() FROM PUBLIC, anon, authenticated;
