-- 606: ATA e ATD esquecidos viram Críticos 16 horas depois do ETA e do ETD
-- (decisão D3 do dono de 2026-11-06; ADR 0131, lote 3 do plano
-- 2026-11-06-decisoes-da-revisao-dos-alertas).
--
-- "Data da escala pendente" (ATA) e "Data de terminal pendente" (ATD) eram
-- Normais e avisavam uma vez. O ATD esquecido desliga o ADR de Saída e a
-- exportação (brecha B08). Agora, 16 horas depois do ETA sem ATA, ou do ETD
-- sem ATD, o mesmo alerta muda de marco (`ata_atrasado`, `atd_atrasado`), passa
-- a Crítico pelo marco (`metadata.severity`, migration 604) e avisa de novo no
-- sino; a mensagem diz "há mais de 16 horas". ETA gravado só com o dia vale
-- 00:00 de Brasília. A conferência de 15 minutos faz a passagem; as outras
-- etapas (ETB, ATB, ETD) não mudam.
--
-- Plano de preservação: a migration não reescreve nem apaga linha; troca só
-- a definição de `reconcile_voyage_schedule_date_alerts`. Os alertas abertos
-- mudam na próxima conferência, como em qualquer gravação. Conferir:
-- `SELECT metadata->>'milestone', severity, count(*) FROM alert_items WHERE
-- item_type IN ('voyage_schedule_date_pending', 'voyage_terminal_date_pending')
-- AND status = 'active' GROUP BY 1, 2`. Desfazer: reaplicar a definição da 584.
--
-- Rollback: reaplicar `reconcile_voyage_schedule_date_alerts` da 584.

CREATE OR REPLACE FUNCTION public.reconcile_voyage_schedule_date_alerts(p_voyage_id bigint, p_port text, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_port_norm TEXT := upper(btrim(p_port));
  v_scale_entity_id TEXT := p_voyage_id || '::' || v_port_norm;
  v_term_rec RECORD;
  v_term_entity_id TEXT;
  v_is_deleted BOOLEAN := false;
  v_is_omitted BOOLEAN := false;
  v_eta DATE;
  -- 606 (ADR 0131, D3): o instante do ETA, para as 16 horas.
  v_eta_raw TEXT;
  v_eta_at TIMESTAMPTZ;
  v_ata DATE;
  v_has_terminal BOOLEAN := false;
BEGIN
  WITH latest_state AS (
    SELECT DISTINCT ON (field_name) field_name, new_value
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule'
      AND entity_id = v_scale_entity_id
      AND field_name IN ('deleted', 'omitted', 'eta', 'ata')
    ORDER BY field_name, changed_at DESC, id DESC
  )
  SELECT
    COALESCE(bool_or(field_name = 'deleted' AND new_value = 'true'), false),
    COALESCE(bool_or(field_name = 'omitted' AND new_value = 'true'), false),
    MAX(CASE WHEN field_name = 'eta' THEN NULLIF(btrim(new_value), '')::date END),
    MAX(CASE WHEN field_name = 'ata' THEN NULLIF(btrim(new_value), '')::date END),
    MAX(CASE WHEN field_name = 'eta' THEN NULLIF(btrim(new_value), '') END)
  INTO v_is_deleted, v_is_omitted, v_eta, v_ata, v_eta_raw
  FROM latest_state;

  -- ETA só com o dia vale 00:00 de Brasília.
  v_eta_at := COALESCE(public.customer_communication_safe_timestamptz(v_eta_raw),
    (v_eta::timestamp AT TIME ZONE 'America/Sao_Paulo'));

  IF v_is_deleted OR v_is_omitted THEN
    PERFORM public.resolve_alert_item('voyage_schedule_date_pending', 'voyage_pod_schedule', v_scale_entity_id, p_source, jsonb_build_object('reason', 'scale_deleted_or_omitted'));
    FOR v_term_rec IN
      SELECT terminal_id FROM public.voyage_escala_terminal_state
      WHERE voyage_id = p_voyage_id AND port = v_port_norm
    LOOP
      IF v_term_rec.terminal_id IS NULL THEN CONTINUE; END IF;
      v_term_entity_id := p_voyage_id || '::' || v_port_norm || '::' || public.voyage_terminal_code(v_term_rec.terminal_id);
      PERFORM public.resolve_alert_item('voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id, p_source, '{}'::jsonb);
    END LOOP;
    -- A exportação é item da escala (`voyage_pod_schedule`), não do terminal:
    -- a função da exportação fecha a escala excluída ou omitida (346).
    PERFORM public.reconcile_voyage_export_after_atd_alerts(p_voyage_id, v_port_norm, p_source);
    PERFORM public.reconcile_voyage_escala_terminal_alerts(p_voyage_id, v_port_norm, p_source);
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.voyage_escala_terminal_state
    WHERE voyage_id = p_voyage_id AND port = v_port_norm AND terminal_id IS NOT NULL
  ) INTO v_has_terminal;

  -- Predicado da escala. Depois do ATA, o item da escala só cobra o ETB
  -- quando ela não tem terminal nenhum nem frente a atribuir; com frente sem
  -- terminal, quem cobra é "Escala sem terminal" (584), e cada terminal cobra
  -- o próprio ETB abaixo. A Atracação TBC não tem ETB desde a 490.
  IF v_eta IS NOT NULL AND v_eta <= v_today AND v_ata IS NULL THEN
    PERFORM public.upsert_alert_item(
      'voyage_schedule_date_pending', 'voyage_pod_schedule', v_scale_entity_id,
      'ETA de ' || to_char(v_eta, 'DD/MM/YYYY') || ' passou'
        || CASE WHEN now() >= v_eta_at + interval '16 hours' THEN ' há mais de 16 horas' ELSE '' END
        || ' sem ATA registrada.',
      -- 606 (ADR 0131, D3): 16 horas depois do ETA sem ATA, o alerta muda de
      -- marco e vira Crítico, com novo aviso no sino.
      p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'eta', v_eta)
        || CASE WHEN now() >= v_eta_at + interval '16 hours'
                THEN jsonb_build_object('milestone', 'ata_atrasado', 'severity', 'critical')
                ELSE jsonb_build_object('milestone', 'ata') END,
      '/viagens/' || p_voyage_id || '?escala=' || v_port_norm
    );
  ELSIF v_ata IS NOT NULL AND NOT v_has_terminal
        AND cardinality(public._escala_terminal_pending_fronts(p_voyage_id, v_port_norm)) = 0 THEN
    PERFORM public.upsert_alert_item(
      'voyage_schedule_date_pending', 'voyage_pod_schedule', v_scale_entity_id,
      'ATA registrada; falta o ETB.',
      p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'milestone', 'etb'),
      '/viagens/' || p_voyage_id || '?escala=' || v_port_norm
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_schedule_date_pending', 'voyage_pod_schedule', v_scale_entity_id, p_source, '{}'::jsonb);
  END IF;

  -- Predicado da Atracação: cada terminal recebe apenas a sua própria cadeia.
  -- As datas do terminal são timestamptz: o dia é o de Brasília, como v_today
  -- (o fuso da sessão é UTC; 21/10 22:00 em Brasília não é 22/10) (346).
  FOR v_term_rec IN
    SELECT terminal_id,
      (terminal_etb AT TIME ZONE 'America/Sao_Paulo')::date AS terminal_etb,
      (terminal_atb AT TIME ZONE 'America/Sao_Paulo')::date AS terminal_atb,
      (terminal_etd AT TIME ZONE 'America/Sao_Paulo')::date AS terminal_etd,
      (terminal_atd AT TIME ZONE 'America/Sao_Paulo')::date AS terminal_atd,
      terminal_etd AS terminal_etd_at
    FROM public.voyage_escala_terminal_state s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port_norm AND s.terminal_id IS NOT NULL
  LOOP
    v_term_entity_id := p_voyage_id || '::' || v_port_norm || '::' || public.voyage_terminal_code(v_term_rec.terminal_id);
    -- 584: com o ATA, o terminal sem ETB (e ainda sem ATB) é cobrado; antes
    -- só o primeiro terminal com ETB era conferido pela escala.
    IF v_ata IS NOT NULL AND v_term_rec.terminal_etb IS NULL AND v_term_rec.terminal_atb IS NULL THEN
      PERFORM public.upsert_alert_item(
        'voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id,
        'Terminal ' || public.voyage_terminal_code(v_term_rec.terminal_id) || ': ATA registrada; falta o ETB.',
        p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'terminal', public.voyage_terminal_code(v_term_rec.terminal_id), 'milestone', 'etb'),
        '/viagens/' || p_voyage_id || '?escala=' || v_port_norm || '&terminal=' || public.voyage_terminal_code(v_term_rec.terminal_id)
      );
    ELSIF v_term_rec.terminal_etb IS NOT NULL AND v_term_rec.terminal_etb <= v_today AND v_term_rec.terminal_atb IS NULL THEN
      PERFORM public.upsert_alert_item(
        'voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id,
        'Terminal ' || public.voyage_terminal_code(v_term_rec.terminal_id) || ': ETB de ' || to_char(v_term_rec.terminal_etb, 'DD/MM/YYYY') || ' passou sem ATB registrada.',
        p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'terminal', public.voyage_terminal_code(v_term_rec.terminal_id), 'milestone', 'atb', 'etb', v_term_rec.terminal_etb),
        '/viagens/' || p_voyage_id || '?escala=' || v_port_norm || '&terminal=' || public.voyage_terminal_code(v_term_rec.terminal_id)
      );
    ELSIF v_term_rec.terminal_atb IS NOT NULL AND v_term_rec.terminal_etd IS NULL THEN
      PERFORM public.upsert_alert_item(
        'voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id,
        'Terminal ' || public.voyage_terminal_code(v_term_rec.terminal_id) || ': ATB registrada; falta o ETD.',
        p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'terminal', public.voyage_terminal_code(v_term_rec.terminal_id), 'milestone', 'etd'),
        '/viagens/' || p_voyage_id || '?escala=' || v_port_norm || '&terminal=' || public.voyage_terminal_code(v_term_rec.terminal_id)
      );
    ELSIF v_term_rec.terminal_etd IS NOT NULL AND v_term_rec.terminal_etd <= v_today AND v_term_rec.terminal_atd IS NULL THEN
      PERFORM public.upsert_alert_item(
        'voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id,
        'Terminal ' || public.voyage_terminal_code(v_term_rec.terminal_id) || ': ETD de ' || to_char(v_term_rec.terminal_etd, 'DD/MM/YYYY') || ' passou'
          || CASE WHEN now() >= v_term_rec.terminal_etd_at + interval '16 hours' THEN ' há mais de 16 horas' ELSE '' END
          || ' sem ATD registrada.',
        -- 606 (ADR 0131, D3): 16 horas depois do ETD sem ATD, Crítico.
        p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'terminal', public.voyage_terminal_code(v_term_rec.terminal_id), 'etd', v_term_rec.terminal_etd)
          || CASE WHEN now() >= v_term_rec.terminal_etd_at + interval '16 hours'
                  THEN jsonb_build_object('milestone', 'atd_atrasado', 'severity', 'critical')
                  ELSE jsonb_build_object('milestone', 'atd') END,
        '/viagens/' || p_voyage_id || '?escala=' || v_port_norm || '&terminal=' || public.voyage_terminal_code(v_term_rec.terminal_id)
      );
    ELSE
      PERFORM public.resolve_alert_item('voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id, p_source, '{}'::jsonb);
    END IF;
  END LOOP;

  PERFORM public.reconcile_voyage_escala_terminal_alerts(p_voyage_id, v_port_norm, p_source);
END;
$function$;
