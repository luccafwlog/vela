-- 498: Taxa alterada à mão cuja quantidade vai a zero (decisão do dono de
-- 2026-10-28, opção 1, na revisão da PR luccafwlog/vela#1080; ADR 0111, D6 e
-- D7).
--
-- Exemplo: THD de 1 container alterado pelo total para R$ 800; o Baplie marca
-- o container como IMO. A quantidade do THD padrão vai a zero e a linha some do
-- cálculo; o B/L cobra o THD IMO da tabela. Antes, a prévia dizia "mantida
-- (R$ 800,00)" e nada ficava registrado. Agora a taxa "sai da cobrança": a
-- alteração fica guardada e volta se a taxa voltar ao B/L; a prévia pede o
-- **Gravar mesmo assim** (desfecho `removed`); sem o aceite, o evento
-- `quantity_changed` (com `removed`) entra no Histórico das taxas e abre o
-- alerta **Taxa alterada à mão mudou**. A alteração por unidade mostra
-- "quantidade muda de 1 para 0" na prévia, sem confirmação.
--
-- Só conta como "saiu" a taxa cujo item segue ativo na tabela vinculada ao
-- B/L e no mesmo POD, num B/L sem linha em revisão: item desativado, linha em
-- revisão e troca de tabela seguem como antes (guardada ou descartada).
--
-- Não muda dado.
--
-- Rollback: recriar `_track_bl_charge_adjustment_quantities` (491),
-- `_open_bl_charge_adjustment_alert` (495) e
-- `preview_bl_charge_adjustment_impact` (497); apagar
-- `_bl_charge_adjustments_out_of_charge`.

-- Alterações em vigor cuja taxa saiu da cobrança: item ativo da tabela vinculada,
-- mesmo POD, sem a linha entre as chaves do cálculo e sem linha em revisão.
CREATE OR REPLACE FUNCTION public._bl_charge_adjustments_out_of_charge(p_bl_id text, p_keys text[])
 RETURNS SETOF bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.id
    FROM public.bl_charge_adjustments a
    JOIN public.bls b ON b.id = a.bl_id
    JOIN public.bl_charge_table_links l ON l.bl_id = a.bl_id AND l.charge_table_id = a.charge_table_id
    JOIN public.charge_table_items cti ON cti.id = a.charge_item_id AND cti.charge_table_id = a.charge_table_id
   WHERE a.bl_id = p_bl_id AND a.ended_at IS NULL AND a.source = 'auto' AND a.kind IN ('unit', 'total')
     AND COALESCE(cti.active, true) AND NOT COALESCE(cti.manual_only, false)
     AND a.pod_key IS NOT DISTINCT FROM public.normalize_port_code(b.pod)
     AND NOT (a.line_key = ANY(COALESCE(p_keys, '{}'::text[])))
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p_keys, '{}'::text[])) k WHERE k LIKE 'review:%');
$function$;
REVOKE ALL ON FUNCTION public._bl_charge_adjustments_out_of_charge(text, text[]) FROM PUBLIC, anon, authenticated;

-- Corpo da 491 com a taxa que saiu da cobrança.
CREATE OR REPLACE FUNCTION public._track_bl_charge_adjustment_quantities(p_bl_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  g record;
BEGIN
  FOR r IN
    SELECT a.id, a.kind, a.value, a.currency, a.line_key, a.charge_name, a.reference_quantity, cc.quantity
      FROM public.bl_charge_adjustments a
      JOIN public.charge_calculations cc
        ON cc.bl_id = a.bl_id AND cc.calculation_key = a.line_key AND cc.adjustment_id = a.id
     WHERE a.bl_id = p_bl_id AND a.ended_at IS NULL AND a.kind IN ('unit', 'total')
       AND a.reference_quantity IS DISTINCT FROM cc.quantity
     ORDER BY a.id
  LOOP
    IF r.kind = 'total' AND r.reference_quantity IS NOT NULL THEN
      PERFORM public._record_bl_charge_event(p_bl_id, r.id, 'quantity_changed', r.line_key, r.charge_name,
        jsonb_build_object('quantity', r.reference_quantity),
        jsonb_build_object('quantity', r.quantity, 'total', r.value, 'currency', r.currency),
        NULL, NULL);
    END IF;
    UPDATE public.bl_charge_adjustments SET reference_quantity = r.quantity WHERE id = r.id;
  END LOOP;

  -- 498 (decisão do dono, 2026-10-28): a taxa cuja quantidade foi a zero sai da
  -- cobrança; a alteração fica guardada e volta com a taxa. Com total alterado,
  -- o evento entra no Histórico das taxas (e abre o alerta sem aceite).
  FOR g IN
    SELECT a.id, a.kind, a.value, a.currency, a.line_key, a.charge_name, a.reference_quantity
      FROM public.bl_charge_adjustments a
     WHERE a.id IN (SELECT public._bl_charge_adjustments_out_of_charge(p_bl_id,
             ARRAY(SELECT cc.calculation_key FROM public.charge_calculations cc
                    WHERE cc.bl_id = p_bl_id AND cc.calculation_key IS NOT NULL)))
       AND COALESCE(a.reference_quantity, 0) > 0
     ORDER BY a.id
  LOOP
    IF g.kind = 'total' THEN
      PERFORM public._record_bl_charge_event(p_bl_id, g.id, 'quantity_changed', g.line_key, g.charge_name,
        jsonb_build_object('quantity', g.reference_quantity),
        jsonb_build_object('quantity', 0, 'total', g.value, 'currency', g.currency, 'removed', true),
        NULL, NULL);
    END IF;
    UPDATE public.bl_charge_adjustments SET reference_quantity = 0 WHERE id = g.id;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public._track_bl_charge_adjustment_quantities(text) FROM PUBLIC, anon, authenticated;

-- Corpo da 495 com a frase da taxa que saiu da cobrança.
CREATE OR REPLACE FUNCTION public._open_bl_charge_adjustment_alert(
  p_bl_id text, p_event text, p_charge_name text, p_before jsonb, p_after jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_message text;
  v_name text := COALESCE(NULLIF(btrim(p_charge_name), ''), 'sem nome');
  v_previous text;
BEGIN
  IF p_event = 'discarded' THEN
    v_message := format('A alteração à mão da taxa %s do B/L %s foi descartada: o B/L passou para a tabela %s.',
      v_name, p_bl_id, COALESCE(p_after->>'table_name', 'nenhuma'));
  ELSIF COALESCE((p_after->>'removed')::boolean, false) THEN
    v_message := format('A taxa %s do B/L %s saiu da cobrança: a quantidade passou de %s para 0. A alteração do total para %s ficou guardada e volta se a taxa voltar ao B/L. Confira se ainda vale.',
      v_name, p_bl_id,
      trim_scale(COALESCE((p_before->>'quantity')::numeric, 0))::text,
      CASE WHEN upper(COALESCE(p_after->>'currency', 'BRL')) = 'USD'
           THEN replace(public._brl_text((p_after->>'total')::numeric), 'R$', 'US$')
           ELSE public._brl_text((p_after->>'total')::numeric) END);
  ELSE
    v_message := format('A quantidade da taxa %s do B/L %s mudou de %s para %s; o valor total alterado foi mantido em %s. Confira se ainda vale.',
      v_name, p_bl_id,
      trim_scale(COALESCE((p_before->>'quantity')::numeric, 0))::text,
      trim_scale(COALESCE((p_after->>'quantity')::numeric, 0))::text,
      CASE WHEN upper(COALESCE(p_after->>'currency', 'BRL')) = 'USD'
           THEN replace(public._brl_text((p_after->>'total')::numeric), 'R$', 'US$')
           ELSE public._brl_text((p_after->>'total')::numeric) END);
  END IF;
  -- O recálculo da mudança de base roda no gatilho de fim de transação
  -- (`refresh_unbilled_calculations_at_commit`): abre como os alertas de
  -- gatilho. A falha do alerta não desfaz a gravação do B/L; o evento já está no
  -- Histórico das taxas.
  v_previous := current_setting('alerts.foundation_trigger', true);
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  BEGIN
    PERFORM public.upsert_alert_item('taxa_alterada_mudou', 'bl', p_bl_id, v_message, 'bl_charge_adjustment',
      'administrativo',
      jsonb_build_object('bl_id', p_bl_id, 'event', p_event, 'charge_name', p_charge_name),
      '/bls/' || p_bl_id || '?tab=faturamento');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Alerta da taxa alterada à mão do B/L % não aberto: %', p_bl_id, SQLERRM;
  END;
  PERFORM set_config('alerts.foundation_trigger', COALESCE(v_previous, ''), true);
END;
$function$;
REVOKE ALL ON FUNCTION public._open_bl_charge_adjustment_alert(text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Corpo da 497 com o desfecho `removed`.
CREATE OR REPLACE FUNCTION public.preview_bl_charge_adjustment_impact(p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_changes jsonb := CASE WHEN jsonb_typeof(p_changes) = 'array' THEN p_changes ELSE '[]'::jsonb END;
  v_targets text[];
  v_candidates text[];
  v_before jsonb := '{}'::jsonb;
  v_after_lines jsonb := '{}'::jsonb;
  v_gone jsonb := '{}'::jsonb;
  v_events jsonb := '[]'::jsonb;
  v_max_event bigint;
  v_change jsonb;
  v_bl text;
  v_bl_row record;
  v_out jsonb := '[]'::jsonb;
  v_items jsonb;
  v_adj jsonb;
  v_event jsonb;
  v_after_qty numeric;
  v_outcome text;
  v_error text;
BEGIN
  -- A simulação trava linhas até o rollback: só quem grava pode rodá-la.
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(DISTINCT btrim(c->>'bl_id')) INTO v_targets
    FROM jsonb_array_elements(v_changes) c WHERE NULLIF(btrim(c->>'bl_id'), '') IS NOT NULL;
  IF v_targets IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- Irmãos de container: o rateio muda a quantidade deles também.
  SELECT array_agg(DISTINCT x.id) INTO v_candidates FROM (
    SELECT unnest(v_targets) AS id
    UNION
    SELECT c2.bl_id FROM public.bl_containers c1
      JOIN public.bls b1 ON b1.id = c1.bl_id
      JOIN public.bl_containers c2 ON upper(c2.container_number) = upper(c1.container_number) AND c2.bl_id <> c1.bl_id
      JOIN public.bls b2 ON b2.id = c2.bl_id AND b2.voyage_id = b1.voyage_id
     WHERE c1.bl_id = ANY(v_targets)
    UNION
    -- 497: o container acrescentado que já está em outro B/L da Viagem passa a
    -- ser dividido, e o rateio desse B/L muda na gravação.
    SELECT c2.bl_id FROM jsonb_array_elements(v_changes) c
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c->'add_containers', '[]'::jsonb)) n
      JOIN public.bls b1 ON b1.id = btrim(c->>'bl_id')
      JOIN public.bl_containers c2 ON upper(c2.container_number) = upper(btrim(n->>'container_number')) AND c2.bl_id <> b1.id
      JOIN public.bls b2 ON b2.id = c2.bl_id AND b2.voyage_id = b1.voyage_id
    UNION
    SELECT btrim(m->>'to_bl_id') FROM jsonb_array_elements(v_changes) c,
      jsonb_array_elements(COALESCE(c->'move_vehicles', '[]'::jsonb)) m
  ) x
  JOIN public.bls b ON b.id = x.id AND b.cancelled_at IS NULL
  WHERE EXISTS (SELECT 1 FROM public.bl_charge_adjustments a WHERE a.bl_id = x.id AND a.ended_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.bl_local_charge_exemptions e WHERE e.bl_id = x.id);
  IF v_candidates IS NULL THEN RETURN '[]'::jsonb; END IF;

  FOREACH v_bl IN ARRAY v_candidates LOOP
    v_before := v_before || jsonb_build_object(v_bl, public._bl_charge_adjustment_snapshot(v_bl));
  END LOOP;
  SELECT COALESCE(max(id), 0) INTO v_max_event FROM public.bl_charge_adjustment_events;

  BEGIN
    PERFORM set_config('vela.bl_charge_simulation', 'on', true);
    FOR v_change IN SELECT * FROM jsonb_array_elements(v_changes) LOOP
      PERFORM public._apply_bl_charge_simulation_change(v_change);
    END LOOP;
    FOREACH v_bl IN ARRAY v_candidates LOOP
      SELECT b.id, b.pod, COALESCE(b.financial_status, 'pending') AS financial_status INTO v_bl_row
        FROM public.bls b WHERE b.id = v_bl;
      IF v_bl_row.financial_status NOT IN ('invoiced', 'partially_paid', 'paid') THEN
        PERFORM public.bind_bl_local_charge_tables(v_bl);
        PERFORM public._reconcile_bl_charge_adjustments(v_bl);
      END IF;
      v_after_lines := v_after_lines || jsonb_build_object(v_bl, (
        SELECT COALESCE(jsonb_object_agg(r.calculation_key, r.quantity), '{}'::jsonb)
          FROM public._resolve_bl_local_charge_items_charged(v_bl, v_bl_row.pod) r
         WHERE r.calculation_key IS NOT NULL));
      -- 498: alteração cuja taxa sai da cobrança (quantidade a zero).
      v_gone := v_gone || jsonb_build_object(v_bl, COALESCE((
        SELECT jsonb_agg(g) FROM public._bl_charge_adjustments_out_of_charge(v_bl,
          ARRAY(SELECT jsonb_object_keys(v_after_lines->v_bl))) g), '[]'::jsonb));
    END LOOP;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('bl_id', e.bl_id, 'event', e.event, 'line_key', e.line_key,
             'after', e.after) ORDER BY e.id), '[]'::jsonb)
      INTO v_events
      FROM public.bl_charge_adjustment_events e
     WHERE e.id > v_max_event AND e.bl_id = ANY(v_candidates) AND e.event IN ('discarded', 'remapped');
    PERFORM set_config('vela.bl_charge_simulation', 'off', true);
    RAISE EXCEPTION 'simulação desfeita' USING ERRCODE = 'VB495';
  EXCEPTION
    WHEN SQLSTATE 'VB495' THEN NULL;
    WHEN OTHERS THEN
      v_error := SQLERRM;
  END;
  PERFORM set_config('vela.bl_charge_simulation', 'off', true);

  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_array(jsonb_build_object('error', v_error));
  END IF;

  FOREACH v_bl IN ARRAY v_candidates LOOP
    v_items := '[]'::jsonb;
    FOR v_adj IN SELECT * FROM jsonb_array_elements(v_before->v_bl) LOOP
      SELECT ev INTO v_event FROM jsonb_array_elements(v_events) ev
       WHERE ev->>'bl_id' = v_bl AND ev->>'line_key' = v_adj->>'line_key' LIMIT 1;
      v_after_qty := NULLIF(v_after_lines->v_bl->>(v_adj->>'line_key'), '')::numeric;
      IF v_event->>'event' = 'discarded' THEN
        v_outcome := 'discarded';
      ELSIF v_event->>'event' = 'remapped' THEN
        v_outcome := 'remapped';
      ELSIF (v_gone->v_bl) @> to_jsonb((v_adj->>'id')::bigint) AND COALESCE((v_adj->>'quantity')::numeric, 0) > 0 THEN
        v_outcome := CASE WHEN v_adj->>'kind' = 'total' THEN 'removed' ELSE 'quantity' END;
        v_after_qty := 0;
      ELSIF v_adj->>'kind' IN ('unit', 'total') AND v_adj->>'source' = 'auto' AND v_after_qty IS NOT NULL
            AND v_after_qty IS DISTINCT FROM (v_adj->>'quantity')::numeric THEN
        v_outcome := CASE WHEN v_adj->>'kind' = 'total' THEN 'total_kept' ELSE 'quantity' END;
      ELSE
        v_outcome := 'kept';
      END IF;
      v_items := v_items || jsonb_build_array(v_adj || jsonb_build_object(
        'outcome', v_outcome,
        'after_quantity', COALESCE(v_after_qty, (v_adj->>'quantity')::numeric),
        'after_total', CASE
          WHEN v_outcome = 'quantity' THEN round((v_adj->>'value')::numeric * v_after_qty, 2)
          WHEN v_outcome IN ('discarded', 'removed') THEN NULL
          ELSE (v_adj->>'total')::numeric END,
        'reason', v_event->'after'->>'reason',
        'table_name', v_event->'after'->>'table_name',
        'pod', v_event->'after'->>'pod',
        'needs_confirmation', v_outcome IN ('discarded', 'total_kept', 'removed')));
      v_event := NULL;
    END LOOP;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'bl_id', v_bl,
      'manual_exempt', EXISTS (SELECT 1 FROM public.bl_local_charge_exemptions e WHERE e.bl_id = v_bl),
      'items', v_items));
  END LOOP;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.preview_bl_charge_adjustment_impact(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_bl_charge_adjustment_impact(jsonb) TO authenticated;
