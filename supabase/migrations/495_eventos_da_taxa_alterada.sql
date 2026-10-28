-- 495: Eventos sobre a taxa alterada à mão (lote 5 do plano
-- `2026-10-28-alterar-taxa-calculada-do-bl`; ADR 0111, D6 e D7).
--
-- 1. `preview_bl_charge_adjustment_impact(p_changes)`: simula, numa
--    subtransação desfeita, uma mudança de base de um ou mais B/Ls (POD,
--    modalidade, peso, containers e marcas, veículos) e devolve, por alteração
--    à mão dos B/Ls afetados (inclusive os irmãos de container), o que acontece:
--    mantida, quantidade muda, total mantido com quantidade nova, passa para a
--    tabela nova ou descartada. Alimenta as prévias e o diálogo **Taxas
--    alteradas à mão serão afetadas** (**Gravar mesmo assim**).
-- 2. `bl_charge_adjustment_acks` e `ack_bl_charge_adjustment_impact(p_bl_ids)`:
--    o aceite curto que o **Gravar mesmo assim** grava antes da gravação.
-- 3. Alerta **Taxa alterada à mão mudou** (`taxa_alterada_mudou`): o registro
--    do evento do Sistema que descarta a alteração ou muda a quantidade de taxa
--    com total alterado, sem aceite para o B/L, abre um item por B/L para o
--    Administrativo, com o Financeiro na audiência; fecha com **Resolver com
--    justificativa**.
--
-- Não reescreve nem apaga dado existente: só acrescenta tabela, funções e a
-- linha do catálogo de alertas.
--
-- Rollback: renomear `_record_bl_charge_event_493` de volta para
-- `_record_bl_charge_event` (depois de apagar o invólucro), recriar
-- `_alert_types_resolved_with_justification()` da 476, apagar a linha
-- `taxa_alterada_mudou` do catálogo, as duas RPCs e a tabela de aceites.

-- 1. Aceite curto ---------------------------------------------------------------

CREATE TABLE public.bl_charge_adjustment_acks (
  id bigserial PRIMARY KEY,
  bl_id text NOT NULL REFERENCES public.bls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX bl_charge_adjustment_acks_bl_idx ON public.bl_charge_adjustment_acks (bl_id, expires_at);
ALTER TABLE public.bl_charge_adjustment_acks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bl_charge_adjustment_acks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.bl_charge_adjustment_acks_id_seq FROM PUBLIC, anon, authenticated;

-- ponytail: 30 minutos cobrem a fila de efeitos de uma importação confirmada;
-- se a fila atrasar mais que isso, o alerta abre mesmo com o aceite dado.
CREATE OR REPLACE FUNCTION public.ack_bl_charge_adjustment_impact(p_bl_ids text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo altera as taxas do B/L.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.bl_charge_adjustment_acks WHERE expires_at < now();
  INSERT INTO public.bl_charge_adjustment_acks (bl_id, user_id, expires_at)
  SELECT DISTINCT b.id, auth.uid(), now() + interval '30 minutes'
    FROM public.bls b
   WHERE b.id = ANY(COALESCE(p_bl_ids, '{}'::text[]));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.ack_bl_charge_adjustment_impact(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_bl_charge_adjustment_impact(text[]) TO authenticated;

-- Aceite em vigor: o do usuário da sessão; sem sessão (fila de efeitos,
-- rotina), o de qualquer pessoa.
CREATE OR REPLACE FUNCTION public._bl_charge_adjustment_acked(p_bl_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.bl_charge_adjustment_acks k
     WHERE k.bl_id = p_bl_id AND k.expires_at > now()
       AND (auth.uid() IS NULL OR k.user_id = auth.uid()));
$function$;
REVOKE ALL ON FUNCTION public._bl_charge_adjustment_acked(text) FROM PUBLIC, anon, authenticated;

-- 2. Alerta ---------------------------------------------------------------------

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination, active)
VALUES ('taxa_alterada_mudou', 'normal', 'administrativo', ARRAY['administrativo', 'financeiro'], '/bls', true)
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public._alert_types_resolved_with_justification()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['portal_abuso_login', 'bl_vehicles_changed_on_reimport', 'ce_trocado_com_desbloqueio',
    'cobranca_demurrage_recusada', 'desbloqueio_ce_aviso_nao_enviado',
    'demurrage_invoice_dates_changed', 'comunicado_recusado',
    -- 495 (ADR 0111, D6): conferência da taxa alterada à mão.
    'taxa_alterada_mudou']::text[]
    || public._alert_types_held_after_justification();
$function$;

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

-- O evento do Sistema que descarta a alteração ou muda a quantidade de taxa
-- com total alterado abre o alerta, salvo na simulação, na prévia do efeito
-- e com aceite em vigor. A ação da própria pessoa (autor informado) não abre.
ALTER FUNCTION public._record_bl_charge_event(text, bigint, text, text, text, jsonb, jsonb, text, uuid, jsonb)
  RENAME TO _record_bl_charge_event_493;
REVOKE ALL ON FUNCTION public._record_bl_charge_event_493(text, bigint, text, text, text, jsonb, jsonb, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._record_bl_charge_event(
  p_bl_id text, p_adjustment_id bigint, p_event text, p_line_key text, p_charge_name text,
  p_before jsonb, p_after jsonb, p_justification text, p_actor uuid, p_invoice_effect jsonb DEFAULT NULL)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id bigint;
BEGIN
  v_id := public._record_bl_charge_event_493(p_bl_id, p_adjustment_id, p_event, p_line_key, p_charge_name,
    p_before, p_after, p_justification, p_actor, p_invoice_effect);
  IF p_actor IS NULL AND p_event IN ('discarded', 'quantity_changed')
     AND current_setting('vela.bl_charge_simulation', true) IS DISTINCT FROM 'on'
     AND current_setting('vela.bl_charge_preview', true) IS DISTINCT FROM 'on'
     AND NOT public._bl_charge_adjustment_acked(p_bl_id) THEN
    PERFORM public._open_bl_charge_adjustment_alert(p_bl_id, p_event, p_charge_name, p_before, p_after);
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public._record_bl_charge_event(text, bigint, text, text, text, jsonb, jsonb, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 3. Simulação ------------------------------------------------------------------

-- Retrato das alterações em vigor de um B/L: chave, taxa, tipo, valor e a
-- quantidade cobrada hoje.
CREATE OR REPLACE FUNCTION public._bl_charge_adjustment_snapshot(p_bl_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id, 'line_key', a.line_key, 'source', a.source, 'charge_name', a.charge_name,
      'kind', a.kind, 'value', a.value, 'currency', a.currency, 'basis', a.application_basis,
      'quantity', COALESCE(cc.quantity, a.reference_quantity),
      'total', CASE WHEN a.currency = 'USD' THEN cc.total_value_usd ELSE cc.total_value_brl END)
    ORDER BY a.charge_name, a.id), '[]'::jsonb)
    FROM public.bl_charge_adjustments a
    LEFT JOIN public.charge_calculations cc
      ON cc.bl_id = a.bl_id AND cc.calculation_key = a.line_key AND cc.adjustment_id = a.id
   WHERE a.bl_id = p_bl_id AND a.ended_at IS NULL;
$function$;
REVOKE ALL ON FUNCTION public._bl_charge_adjustment_snapshot(text) FROM PUBLIC, anon, authenticated;

-- Aplica a mudança descrita num B/L. Só os campos de base que mudam a
-- cobrança; o resto é ignorado.
CREATE OR REPLACE FUNCTION public._apply_bl_charge_simulation_change(p_change jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl text := NULLIF(btrim(p_change->>'bl_id'), '');
  v_fields jsonb := COALESCE(p_change->'bls', '{}'::jsonb);
  v_item jsonb;
BEGIN
  IF v_bl IS NULL THEN RETURN; END IF;
  IF v_fields <> '{}'::jsonb THEN
    PERFORM set_config('vela.bl_terminal_override', 'on', true);
    UPDATE public.bls b SET
      pod = CASE WHEN v_fields ? 'pod' THEN NULLIF(btrim(v_fields->>'pod'), '') ELSE b.pod END,
      terminal_id = CASE WHEN v_fields ? 'pod' AND NULLIF(btrim(v_fields->>'pod'), '') IS DISTINCT FROM b.pod THEN NULL ELSE b.terminal_id END,
      cargo_mode = CASE WHEN v_fields ? 'cargo_mode' THEN NULLIF(btrim(v_fields->>'cargo_mode'), '') ELSE b.cargo_mode END,
      bb_weight_ton = CASE WHEN v_fields ? 'bb_weight_ton' THEN NULLIF(v_fields->>'bb_weight_ton', '')::numeric ELSE b.bb_weight_ton END,
      bb_cbm = CASE WHEN v_fields ? 'bb_cbm' THEN NULLIF(v_fields->>'bb_cbm', '')::numeric ELSE b.bb_cbm END,
      bb_packages_qty = CASE WHEN v_fields ? 'bb_packages_qty' THEN NULLIF(v_fields->>'bb_packages_qty', '')::numeric ELSE b.bb_packages_qty END,
      bb_machine_qty = CASE WHEN v_fields ? 'bb_machine_qty' THEN NULLIF(v_fields->>'bb_machine_qty', '')::numeric ELSE b.bb_machine_qty END,
      total_weight_kg = CASE WHEN v_fields ? 'total_weight_kg' THEN NULLIF(v_fields->>'total_weight_kg', '')::numeric ELSE b.total_weight_kg END
    WHERE b.id = v_bl;
  END IF;

  DELETE FROM public.bl_containers c
   WHERE c.bl_id = v_bl
     AND (c.id IN (SELECT (x)::bigint FROM jsonb_array_elements_text(COALESCE(p_change->'remove_container_ids', '[]'::jsonb)) x)
       OR upper(c.container_number) IN (SELECT upper(btrim(x)) FROM jsonb_array_elements_text(COALESCE(p_change->'remove_container_numbers', '[]'::jsonb)) x));
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_change->'add_containers', '[]'::jsonb)) LOOP
    INSERT INTO public.bl_containers (bl_id, container_number, type, is_imo, is_oog)
    VALUES (v_bl, upper(btrim(v_item->>'container_number')), NULLIF(btrim(v_item->>'type'), ''),
      COALESCE((v_item->>'is_imo')::boolean, false), COALESCE((v_item->>'is_oog')::boolean, false));
  END LOOP;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_change->'container_flags', '[]'::jsonb)) LOOP
    UPDATE public.bl_containers c SET
      is_imo = COALESCE((v_item->>'is_imo')::boolean, c.is_imo),
      is_oog = COALESCE((v_item->>'is_oog')::boolean, c.is_oog),
      type = COALESCE(NULLIF(btrim(v_item->>'type'), ''), c.type)
     WHERE c.bl_id = v_bl AND upper(c.container_number) = upper(btrim(v_item->>'container_number'));
  END LOOP;

  DELETE FROM public.vehicles v
   WHERE v.bl_id = v_bl
     AND v.id IN (SELECT (x)::bigint FROM jsonb_array_elements_text(COALESCE(p_change->'remove_vehicle_ids', '[]'::jsonb)) x);
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_change->'move_vehicles', '[]'::jsonb)) LOOP
    UPDATE public.vehicles v SET bl_id = btrim(v_item->>'to_bl_id')
     WHERE v.id = (v_item->>'id')::bigint AND v.bl_id = v_bl;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public._apply_bl_charge_simulation_change(jsonb) FROM PUBLIC, anon, authenticated;

-- ponytail: a simulação roda o vínculo das tabelas, a reconciliação e o
-- resolvedor de cada B/L (o mesmo caminho do cálculo), não o cálculo inteiro;
-- B/L faturado não passa pela reconciliação, como no cálculo de verdade, e
-- mostra só a quantidade nova.
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
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
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
          WHEN v_outcome = 'discarded' THEN NULL
          ELSE (v_adj->>'total')::numeric END,
        'reason', v_event->'after'->>'reason',
        'table_name', v_event->'after'->>'table_name',
        'pod', v_event->'after'->>'pod',
        'needs_confirmation', v_outcome IN ('discarded', 'total_kept')));
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
