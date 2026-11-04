-- 584: o terminal da escala é cobrado antes da chegada; o NOB que não sai por
-- falta de terminal fica no alerta; o ATB não pode ser anterior ao ATA
-- (decisões do dono de 2026-11-04, ADR 0121, sobre a revisão do vínculo de
-- terminal: docs/archive/audits/2026-11-04-revisao-vinculo-terminal-escala.md).
--
-- Problema (lacunas T1 a T11 da revisão):
--   * Nenhum alerta cobrava a frente de operação sem terminal antes do Fechar
--     ADR. Uma escala com B/Ls, CEs e Clientes chegava ao ETA sem terminal, e
--     o ATA confirmado em Chegadas e Saídas ou em Adicionar escala passava sem
--     a trava da ADR 0109.
--   * "Data da escala pendente" só pedia o ETB quando nenhum terminal o tinha:
--     o segundo terminal sem datas nunca era cobrado, e o pedido continuava
--     aberto depois do ATB.
--   * O B/L sem terminal resolvido (frente em TBC, frente só derivada na tela,
--     B/L misto com as frentes em terminais diferentes) não virava alvo do NOB,
--     e por isso também ficava fora de "Comunicado NOB pendente", ao contrário
--     da ADR 0067.
--   * Nada impedia gravar ATB anterior ao ATA da escala.
--
-- Mudança:
--   1. Tipo novo `voyage_escala_terminal_missing` ("Escala sem terminal"),
--      crítico, de Operações, por escala (`voyage_pod_schedule`). Abre no D-5
--      do ETA da escala (ou com o ATA) quando há frente sem terminal — as
--      gravadas em TBC e as que o banco deriva dos dados, a mesma conta que
--      trava o Fechar ADR (`_escala_fronts_without_terminal`) — ou Atracação
--      com ATB e nenhuma frente. O ATA muda o marco (nova ocorrência). Fecha
--      quando toda frente tem terminal, com a escala excluída ou omitida, ou
--      com a Viagem cancelada.
--   2. `reconcile_voyage_schedule_date_alerts`: depois do ATA, cada terminal
--      sem ETB (e ainda sem ATB) abre "Data de terminal pendente"; o item da
--      escala ("ATA registrada; falta o ETB.") fica para a escala sem terminal
--      nenhum e sem frente a atribuir. Chama o item 1.
--   3. `reconcile_customer_communication_nob_sem_terminal`: com ATB nos últimos
--      30 dias em algum terminal da escala, "Comunicado NOB pendente" da escala
--      (entidade `voyage_pod_schedule`, `metadata.scope = 'sem_terminal'`)
--      lista os Clientes cujos B/Ls não pertencem a nenhuma Atracação. A
--      rodada de Comunicados chama a função, e as duas contas de "fecha o que
--      não é mais alvo" (rodada e 353) deixam esse item com ela.
--   4. Gatilhos adiados em `voyage_escala_operation_fronts` e
--      `voyage_escala_terminal_state` refazem os itens 1 e 3 no fim da
--      transação que grava Editar escala. Os dois gatilhos que já refaziam os
--      alertas de data (Atracação e audit da escala) passam também para o fim
--      da transação, para a gravação não abrir e fechar alerta no meio.
--   5. Gatilhos adiados em `voyage_escala_terminal_state` (ATB) e em
--      `audit_logs` (ATA da escala) recusam ATB anterior ao ATA. São adiados
--      porque Editar escala grava a Atracação antes do ATA na mesma transação.
--   6. RPC `escala_frentes_sem_terminal(bigint[])`, de leitura, para o Painel
--      e a Visão geral mostrarem a mesma conta.
--
-- Plano de preservação: a migration não reescreve nem apaga linha existente.
-- Insere uma linha em `alert_type_catalog` (ON CONFLICT DO NOTHING), cria e
-- redefine funções e cria gatilhos. As recusas do item 5 valem só para as
-- gravações novas; Atracações já gravadas com ATB anterior ao ATA continuam
-- como estão até a próxima gravação da escala (na produção de 2026-11-04 há
-- uma Atracação, sem ATB). Conferir: `SELECT * FROM alert_items WHERE
-- item_type = 'voyage_escala_terminal_missing'` depois da rodada de 15 minutos
-- e `SELECT * FROM escala_frentes_sem_terminal(ARRAY[...])`. Desfazer:
-- remover os gatilhos e funções novos, recriar
-- `reconcile_voyage_operation_alerts_on_terminal_change` e
-- `reconcile_voyage_operation_alerts_on_audit` como gatilhos comuns (346 e
-- 341), reaplicar
-- `reconcile_voyage_schedule_date_alerts` e `reconcile_inactive_voyage_alerts`
-- pela 346, `detect_customer_communication_alerts` pela 315 (com o laço de
-- bounce da 474) e `resolve_customer_communication_pending_alerts` pela 353, e
-- desativar o tipo no catálogo (`active = false`).

-- 1. Catálogo -----------------------------------------------------------------

INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination, active)
VALUES ('voyage_escala_terminal_missing', 'critical', 'operacoes', ARRAY['operacoes'], '/viagens', true)
ON CONFLICT (type) DO NOTHING;

-- Frentes da escala sem terminal: as derivadas dos dados (a conta do Fechar
-- ADR) e as gravadas em TBC, inclusive a declarada sem carga ainda.
CREATE OR REPLACE FUNCTION public._escala_terminal_pending_fronts(p_voyage_id bigint, p_port text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT x.front ORDER BY x.front), ARRAY[]::text[])
  FROM (
    SELECT unnest(public._escala_fronts_without_terminal(
      p_voyage_id, COALESCE(public.normalize_port_code(p_port), upper(btrim(p_port))))) AS front
    UNION
    SELECT f.sentido || ':' || f.modalidade
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id
      AND COALESCE(public.normalize_port_code(f.port), upper(btrim(f.port)))
        = COALESCE(public.normalize_port_code(p_port), upper(btrim(p_port)))
      AND f.terminal_id IS NULL
  ) AS x;
$function$;

-- Os nomes da recusa do Fechar ADR (`assert_voyage_escala_ready_for_report_close`).
CREATE OR REPLACE FUNCTION public._escala_front_labels(p_fronts text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT string_agg(label, ', ' ORDER BY ord)
  FROM (
    SELECT DISTINCT
      CASE f
        WHEN 'importacao:carga_cheia' THEN 'carga cheia'
        WHEN 'importacao:carga_solta' THEN 'carga solta'
        WHEN 'importacao:vazio' THEN 'vazios de importação'
        WHEN 'importacao:veiculo' THEN 'veículos'
        WHEN 'exportacao:granito' THEN 'granito'
        WHEN 'exportacao:vazio' THEN 'embarque de vazios'
        ELSE f
      END AS label,
      CASE f
        WHEN 'importacao:carga_cheia' THEN 1
        WHEN 'importacao:carga_solta' THEN 2
        WHEN 'importacao:vazio' THEN 3
        WHEN 'importacao:veiculo' THEN 4
        WHEN 'exportacao:granito' THEN 5
        WHEN 'exportacao:vazio' THEN 6
        ELSE 7
      END AS ord
    FROM unnest(p_fronts) AS f
  ) AS labels;
$function$;

-- Item 1: Escala sem terminal --------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_voyage_escala_terminal_alerts(
  p_voyage_id bigint,
  p_port text,
  p_source text DEFAULT 'voyage_operation_detector'
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := COALESCE(public.normalize_port_code(p_port), NULLIF(upper(btrim(p_port)), ''));
  v_entity text;
  v_status text;
  v_sched record;
  v_found boolean;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_eta_day date;
  v_fronts text[];
  v_orphans text[];
  v_parts text[] := ARRAY[]::text[];
  v_message text;
BEGIN
  IF v_port IS NULL OR p_voyage_id IS NULL THEN
    RETURN;
  END IF;
  v_entity := p_voyage_id || '::' || v_port;

  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A leitura canônica da escala (as duas grafias do porto são uma escala).
  SELECT s.* INTO v_sched
  FROM public.customer_communication_scale_schedules(p_voyage_id, v_port) AS s
  LIMIT 1;
  v_found := FOUND;

  IF v_status = 'cancelled' OR NOT v_found OR v_sched.deleted OR COALESCE(v_sched.omitted, false) THEN
    PERFORM public.resolve_alert_item('voyage_escala_terminal_missing', 'voyage_pod_schedule', v_entity, p_source,
      jsonb_build_object('reason', CASE WHEN v_status = 'cancelled' THEN 'voyage_cancelled' ELSE 'scale_deleted_or_omitted' END));
    RETURN;
  END IF;

  v_fronts := public._escala_terminal_pending_fronts(p_voyage_id, v_port);

  -- Atracação com ATB e nenhuma frente: o NOB dela não tem para quem sair.
  SELECT COALESCE(array_agg(DISTINCT public.voyage_terminal_code(s.terminal_id)
           ORDER BY public.voyage_terminal_code(s.terminal_id)), ARRAY[]::text[])
  INTO v_orphans
  FROM public.voyage_escala_terminal_state AS s
  WHERE s.voyage_id = p_voyage_id
    AND COALESCE(public.normalize_port_code(s.port), upper(btrim(s.port))) = v_port
    AND s.terminal_id IS NOT NULL
    AND s.terminal_atb IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.voyage_escala_operation_fronts AS f
      WHERE f.voyage_id = s.voyage_id
        AND COALESCE(public.normalize_port_code(f.port), upper(btrim(f.port))) = v_port
        AND f.terminal_id = s.terminal_id
    );

  v_eta_day := (v_sched.eta AT TIME ZONE 'America/Sao_Paulo')::date;

  -- Fora da janela (sem ETA, ou antes do D-5 e sem ATA) ou nada a cobrar.
  IF (cardinality(v_fronts) = 0 AND cardinality(v_orphans) = 0)
     OR (v_sched.ata IS NULL AND (v_eta_day IS NULL OR v_today < v_eta_day - 5)) THEN
    PERFORM public.resolve_alert_item('voyage_escala_terminal_missing', 'voyage_pod_schedule', v_entity, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- Viagem concluída não ganha alerta novo; o aberto continua sendo refeito
  -- (mesma regra de `reconcile_inactive_voyage_alerts`, 346).
  IF v_status <> 'active' AND NOT EXISTS (
    SELECT 1
    FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'voyage_escala_terminal_missing'
      AND a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id = v_entity
      AND i.status = 'active'
  ) THEN
    RETURN;
  END IF;

  IF cardinality(v_fronts) > 0 THEN
    v_parts := v_parts || (CASE WHEN cardinality(v_fronts) > 1 THEN 'Frentes sem terminal: ' ELSE 'Frente sem terminal: ' END
      || public._escala_front_labels(v_fronts) || '.');
  END IF;
  IF cardinality(v_orphans) > 0 THEN
    v_parts := v_parts || ('Atracação com ATB e nenhuma frente de operação: ' || array_to_string(v_orphans, ', ') || '.');
  END IF;

  v_message := CASE
      WHEN v_sched.ata IS NOT NULL THEN 'ATA registrada. '
      ELSE 'ETA em ' || to_char(v_eta_day, 'DD/MM/YYYY') || '. '
    END
    || array_to_string(v_parts, ' ')
    || ' Escolha o terminal em Editar escala: sem ele, a carga fica fora do NOB, do ADR de Saída e do EDI Mercante.';

  PERFORM public.upsert_alert_item(
    'voyage_escala_terminal_missing', 'voyage_pod_schedule', v_entity,
    v_message, p_source,
    jsonb_build_object(
      'voyage_id', p_voyage_id,
      'port', v_port,
      -- O ATA abre nova ocorrência e notifica de novo.
      'milestone', CASE WHEN v_sched.ata IS NOT NULL THEN 'ata' ELSE 'eta_d5' END,
      'eta', v_eta_day,
      'fronts', to_jsonb(v_fronts),
      'orphan_terminals', to_jsonb(v_orphans)
    ),
    '/viagens/' || p_voyage_id || '?escala=' || v_port
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._escala_terminal_pending_fronts(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._escala_front_labels(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_voyage_escala_terminal_alerts(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_escala_terminal_alerts(bigint, text, text) TO service_role;

-- Item 2: datas da escala e do terminal ----------------------------------------

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
    MAX(CASE WHEN field_name = 'ata' THEN NULLIF(btrim(new_value), '')::date END)
  INTO v_is_deleted, v_is_omitted, v_eta, v_ata
  FROM latest_state;

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
      'ETA de ' || to_char(v_eta, 'DD/MM/YYYY') || ' passou sem ATA registrada.',
      p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'milestone', 'ata', 'eta', v_eta),
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
      (terminal_atd AT TIME ZONE 'America/Sao_Paulo')::date AS terminal_atd
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
        'Terminal ' || public.voyage_terminal_code(v_term_rec.terminal_id) || ': ETD de ' || to_char(v_term_rec.terminal_etd, 'DD/MM/YYYY') || ' passou sem ATD registrada.',
        p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'terminal', public.voyage_terminal_code(v_term_rec.terminal_id), 'milestone', 'atd', 'etd', v_term_rec.terminal_etd),
        '/viagens/' || p_voyage_id || '?escala=' || v_port_norm || '&terminal=' || public.voyage_terminal_code(v_term_rec.terminal_id)
      );
    ELSE
      PERFORM public.resolve_alert_item('voyage_terminal_date_pending', 'voyage_escala_terminal', v_term_entity_id, p_source, '{}'::jsonb);
    END IF;
  END LOOP;

  PERFORM public.reconcile_voyage_escala_terminal_alerts(p_voyage_id, v_port_norm, p_source);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_inactive_voyage_alerts(p_voyage_id bigint, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status TEXT;
  v_item RECORD;
BEGIN
  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id;
  IF NOT FOUND OR v_status = 'active' THEN
    RETURN;
  END IF;
  IF v_status = 'cancelled' THEN
    PERFORM public.reconcile_voyage_operation_alerts(p_voyage_id, p_source);
    RETURN;
  END IF;

  -- Viagem concluída: reavalia só os tipos que já estão abertos. O fato que
  -- chega depois (manifesto de exportação, CE, B/L) fecha o alerta; a viagem
  -- encerrada não ganha tipo novo pela varredura (346).
  FOR v_item IN
    SELECT DISTINCT i.item_type, a.entity_id
    FROM public.voyage_alert_scope(p_voyage_id) s
    JOIN public.alerts a ON a.id = s.alert_id
    JOIN public.alert_items i ON i.alert_id = a.id
    WHERE s.alert_id IS NOT NULL AND i.status = 'active'
  LOOP
    CASE v_item.item_type
      WHEN 'voyage_bl_expected' THEN
        PERFORM public.reconcile_voyage_bl_expected_alerts(p_voyage_id, p_source);
      WHEN 'voyage_baplie_missing' THEN
        PERFORM public.reconcile_voyage_baplie_missing_alerts(p_voyage_id, p_source);
      WHEN 'voyage_baplie_documentary_coverage' THEN
        PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, p_source);
      WHEN 'voyage_ce_mercante_missing' THEN
        PERFORM public.reconcile_voyage_ce_mercante_missing_alerts(p_voyage_id, p_source);
      WHEN 'voyage_vehicle_sheet_pending' THEN
        PERFORM public.reconcile_voyage_vehicle_sheet_alerts(p_voyage_id, p_source);
      WHEN 'voyage_schedule_date_pending', 'voyage_terminal_date_pending' THEN
        PERFORM public.reconcile_voyage_schedule_date_alerts(p_voyage_id, split_part(v_item.entity_id, '::', 2), p_source);
      WHEN 'voyage_escala_terminal_missing' THEN
        PERFORM public.reconcile_voyage_escala_terminal_alerts(p_voyage_id, split_part(v_item.entity_id, '::', 2), p_source);
      WHEN 'voyage_export_after_atd' THEN
        PERFORM public.reconcile_voyage_export_after_atd_alerts(p_voyage_id, split_part(v_item.entity_id, '::', 2), p_source);
      ELSE
        -- Comunicados (NOA/NOR/NOB) têm detector próprio.
        NULL;
    END CASE;
  END LOOP;
END;
$function$;

-- Item 3: NOB sem terminal -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_customer_communication_nob_sem_terminal(
  p_voyage_id bigint,
  p_port text,
  p_source text DEFAULT 'customer_communication_detector'
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := COALESCE(public.normalize_port_code(p_port), NULLIF(upper(btrim(p_port)), ''));
  v_entity text;
  v_status text;
  v_sched record;
  v_found boolean;
  v_atb record;
  v_sem_terminal text;
  v_misto text;
  v_customer_ids jsonb;
  v_bl_ids jsonb;
  v_parts text[] := ARRAY[]::text[];
BEGIN
  IF v_port IS NULL OR p_voyage_id IS NULL THEN
    RETURN false;
  END IF;
  v_entity := p_voyage_id || '::' || v_port;

  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id;
  SELECT s.* INTO v_sched
  FROM public.customer_communication_scale_schedules(p_voyage_id, v_port) AS s
  LIMIT 1;
  v_found := FOUND;

  -- A janela do NOB: ATB nos últimos 30 dias em algum terminal da escala.
  SELECT s.terminal_id, public.voyage_terminal_code(s.terminal_id) AS code, s.terminal_atb
  INTO v_atb
  FROM public.voyage_escala_terminal_state AS s
  WHERE s.voyage_id = p_voyage_id
    AND COALESCE(public.normalize_port_code(s.port), upper(btrim(s.port))) = v_port
    AND s.terminal_id IS NOT NULL
    AND s.terminal_atb IS NOT NULL
    AND s.terminal_atb <= now()
    AND s.terminal_atb >= now() - interval '30 days'
  ORDER BY s.terminal_atb, public.voyage_terminal_code(s.terminal_id)
  LIMIT 1;

  IF v_status IS DISTINCT FROM 'active' AND v_status IS DISTINCT FROM 'completed'
     OR NOT v_found OR v_sched.deleted OR COALESCE(v_sched.omitted, false) OR v_atb.terminal_id IS NULL THEN
    PERFORM public.resolve_alert_item('comunicado_nob_pendente', 'voyage_pod_schedule', v_entity, p_source,
      jsonb_build_object('reason', 'no_pending_target'));
    RETURN false;
  END IF;

  -- B/L ativo, com Cliente ativo, que não pertence a nenhuma Atracação: a
  -- mesma regra da régua (`resolve_bl_terminal_id`, ADR 0068). O B/L misto com
  -- as duas frentes em terminais diferentes e sem exceção é dito à parte.
  WITH fora AS (
    SELECT b.id, b.customer_id, c.name,
      lower(btrim(COALESCE(b.cargo_mode, ''))) = 'misto'
        AND EXISTS (
          SELECT 1 FROM public.voyage_escala_operation_fronts f
          WHERE f.voyage_id = b.voyage_id AND public.normalize_port_code(f.port) = v_port
            AND f.sentido = 'importacao' AND f.modalidade = 'carga_cheia' AND f.terminal_id IS NOT NULL)
        AND EXISTS (
          SELECT 1 FROM public.voyage_escala_operation_fronts f
          WHERE f.voyage_id = b.voyage_id AND public.normalize_port_code(f.port) = v_port
            AND f.sentido = 'importacao' AND f.modalidade = 'carga_solta' AND f.terminal_id IS NOT NULL) AS misto
    FROM public.bls AS b
    JOIN public.customers AS c ON c.id = b.customer_id
    WHERE b.voyage_id = p_voyage_id
      AND b.cancelled_at IS NULL
      AND c.deactivated_at IS NULL
      AND public.normalize_port_code(b.pod) = v_port
      AND public.resolve_bl_terminal_id(b.id) IS NULL
  )
  SELECT
    string_agg(DISTINCT name, ', ' ORDER BY name) FILTER (WHERE NOT misto),
    string_agg(DISTINCT name, ', ' ORDER BY name) FILTER (WHERE misto),
    jsonb_agg(DISTINCT customer_id),
    jsonb_agg(DISTINCT id)
  INTO v_sem_terminal, v_misto, v_customer_ids, v_bl_ids
  FROM fora;

  IF v_sem_terminal IS NULL AND v_misto IS NULL THEN
    PERFORM public.resolve_alert_item('comunicado_nob_pendente', 'voyage_pod_schedule', v_entity, p_source,
      jsonb_build_object('reason', 'no_pending_target'));
    RETURN false;
  END IF;

  IF v_sem_terminal IS NOT NULL THEN
    v_parts := v_parts || ('Sem terminal: ' || v_sem_terminal || '. Atribua o terminal da frente em Editar escala.');
  END IF;
  IF v_misto IS NOT NULL THEN
    v_parts := v_parts || ('B/L misto com carga cheia e carga solta em terminais diferentes: ' || v_misto
      || '. Defina a exceção de terminal do B/L.');
  END IF;

  PERFORM public.upsert_alert_item(
    'comunicado_nob_pendente', 'voyage_pod_schedule', v_entity,
    'NOB sem terminal na escala ' || v_port || ' (ATB ' || v_atb.code || ' '
      || to_char(v_atb.terminal_atb AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '). '
      || array_to_string(v_parts, ' '),
    p_source, 'documentacao',
    jsonb_build_object(
      'voyage_id', p_voyage_id,
      'port', v_port,
      'scope', 'sem_terminal',
      'milestone', 'atb',
      'milestone_at', v_atb.terminal_atb,
      'terminal_code', v_atb.code,
      'customer_ids', v_customer_ids,
      'bl_ids', v_bl_ids,
      'window_days', 30
    ),
    '/viagens/' || p_voyage_id || '?escala=' || v_port
  );
  RETURN true;
END;
$function$;

-- A rodada: escalas com ATB na janela e os itens ainda abertos.
CREATE OR REPLACE FUNCTION public.detect_customer_communication_nob_sem_terminal(p_source text DEFAULT 'customer_communication_detector')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_open integer := 0;
BEGIN
  -- ponytail: uma conta por escala e B/L (`resolve_bl_terminal_id` por B/L);
  -- só escalas com ATB nos últimos 30 dias entram. Agrupar a resolução de
  -- terminal por escala é o upgrade se a conta pesar.
  FOR v_row IN
    SELECT DISTINCT s.voyage_id, COALESCE(public.normalize_port_code(s.port), upper(btrim(s.port))) AS port
    FROM public.voyage_escala_terminal_state AS s
    WHERE s.terminal_id IS NOT NULL
      AND s.terminal_atb IS NOT NULL
      AND s.terminal_atb >= now() - interval '30 days'
    UNION
    SELECT DISTINCT (i.metadata->>'voyage_id')::bigint, i.metadata->>'port'
    FROM public.alert_items AS i
    WHERE i.item_type = 'comunicado_nob_pendente'
      AND i.status = 'active'
      AND i.metadata->>'scope' = 'sem_terminal'
      AND i.metadata->>'voyage_id' ~ '^[0-9]+$'
  LOOP
    IF public.reconcile_customer_communication_nob_sem_terminal(v_row.voyage_id, v_row.port, p_source) THEN
      v_open := v_open + 1;
    END IF;
  END LOOP;
  RETURN v_open;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_customer_communication_nob_sem_terminal(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_customer_communication_nob_sem_terminal(bigint, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.detect_customer_communication_nob_sem_terminal(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_customer_communication_nob_sem_terminal(text) TO service_role;

-- A rodada de Comunicados (definição da 474) chama a conta acima e deixa o
-- item "sem terminal" com ela.
CREATE OR REPLACE FUNCTION public.detect_customer_communication_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_source TEXT := 'customer_communication_detector';
  v_pending RECORD;
  v_stale RECORD;
  v_customer RECORD;
  v_keys text[] := '{}'::text[];
  v_has_bounced_contact BOOLEAN;
  v_valid_contacts INTEGER;
  v_noa_pending INTEGER := 0;
  v_nor_pending INTEGER := 0;
  v_nob_pending INTEGER := 0;
  v_nob_sem_terminal INTEGER := 0;
  v_bounce_pending INTEGER := 0;
  v_stale_pending_settled INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  -- 315: Comunicado "Em envio" sem dono vira falha. Falha aqui não derruba os
  -- alertas abaixo.
  BEGIN
    v_stale_pending_settled := public.settle_stale_pending_customer_communications();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Comunicados pendentes nao reconciliados: %', SQLERRM;
  END;

  -- Um item por escala (NOA/NOR) ou Atracação (NOB) que ainda tem Cliente sem
  -- Comunicado entregue a todos os destinatários (migration 315; simulado
  -- conta, D4). Escala sem alvo não abre item.
  FOR v_pending IN
    SELECT t.kind, t.voyage_id, t.port, t.milestone_at, t.milestone_text,
      t.anchor_atracacao_id, t.terminal_id, t.terminal_code,
      CASE WHEN t.kind = 'aviso_chegada_noa' THEN 'comunicado_noa_pendente'
           WHEN t.kind = 'aviso_prontidao_nor' THEN 'comunicado_nor_pendente'
           ELSE 'comunicado_nob_pendente' END AS item_type,
      CASE WHEN t.kind = 'aviso_atracacao_nob' THEN 'voyage_escala_terminal' ELSE 'voyage_pod_schedule' END AS entity_type,
      t.voyage_id || '::' || t.port || CASE WHEN t.kind = 'aviso_atracacao_nob' THEN '::' || t.terminal_code ELSE '' END AS entity_id,
      string_agg(t.customer_name, ', ' ORDER BY t.customer_name) AS customers,
      jsonb_agg(t.customer_id ORDER BY t.customer_id) AS customer_ids
    FROM public.customer_communication_automation_targets(v_now) t
    WHERE t.kind IN ('aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob')
    GROUP BY t.kind, t.voyage_id, t.port, t.milestone_at, t.milestone_text,
      t.anchor_atracacao_id, t.terminal_id, t.terminal_code
  LOOP
    v_keys := v_keys || (v_pending.item_type || '|' || v_pending.entity_id);
    IF v_pending.kind = 'aviso_chegada_noa' THEN v_noa_pending := v_noa_pending + 1;
    ELSIF v_pending.kind = 'aviso_prontidao_nor' THEN v_nor_pending := v_nor_pending + 1;
    ELSE v_nob_pending := v_nob_pending + 1;
    END IF;
    PERFORM public.upsert_alert_item(
      v_pending.item_type, v_pending.entity_type, v_pending.entity_id,
      CASE v_pending.kind
        WHEN 'aviso_chegada_noa' THEN 'NOA pendente para a escala ' || v_pending.port
          || ' (ETA ' || public.customer_communication_milestone_label(v_pending.milestone_text) || ')'
        WHEN 'aviso_prontidao_nor' THEN 'NOR pendente para a escala ' || v_pending.port
          || ' (ATA ' || public.customer_communication_milestone_label(v_pending.milestone_text) || ')'
        ELSE 'NOB pendente no terminal ' || v_pending.terminal_code || ' para a escala ' || v_pending.port
          || ' (ATB ' || public.customer_communication_milestone_label(v_pending.milestone_text) || ')'
      END || ': ' || v_pending.customers,
      v_source, 'documentacao',
      jsonb_strip_nulls(jsonb_build_object(
        'voyage_id', v_pending.voyage_id,
        'port', v_pending.port,
        'milestone', CASE v_pending.kind WHEN 'aviso_chegada_noa' THEN 'eta' WHEN 'aviso_prontidao_nor' THEN 'ata' ELSE 'atb' END,
        'milestone_at', v_pending.milestone_at,
        'terminal_id', v_pending.terminal_id,
        'terminal_code', v_pending.terminal_code,
        'state_id', v_pending.anchor_atracacao_id,
        'customer_ids', v_pending.customer_ids,
        'window_days', CASE WHEN v_pending.kind = 'aviso_chegada_noa' THEN 5 ELSE 30 END
      )),
      '/clientes/comunicacao'
    );
  END LOOP;

  -- Fecha o que não é mais alvo: entregue a todos, janela vencida, escala
  -- excluída ou omitida, terminal removido, sem B/L elegível. O NOB "sem
  -- terminal" da escala (584) tem conta própria, abaixo.
  FOR v_stale IN
    SELECT DISTINCT i.item_type, a.entity_type, a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type IN ('comunicado_noa_pendente', 'comunicado_nor_pendente', 'comunicado_nob_pendente')
      AND i.status = 'active'
      AND COALESCE(i.metadata->>'scope', '') <> 'sem_terminal'
  LOOP
    IF NOT (v_stale.item_type || '|' || v_stale.entity_id) = ANY(v_keys) THEN
      PERFORM public.resolve_alert_item(
        v_stale.item_type, v_stale.entity_type, v_stale.entity_id,
        v_source, jsonb_build_object('reason', 'no_pending_target')
      );
    END IF;
  END LOOP;

  -- 584: o B/L que não pertence a nenhuma Atracação não vira alvo; o item da
  -- escala o lista enquanto houver ATB na janela de 30 dias (ADR 0067).
  BEGIN
    v_nob_sem_terminal := public.detect_customer_communication_nob_sem_terminal(v_source);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'NOB sem terminal nao reconciliado: %', SQLERRM;
  END;

  -- A cascata de bounce é o produtor imediato, mas a varredura também fecha
  -- a pendência quando um novo contato válido é cadastrado na Ficha.
  FOR v_customer IN
    SELECT c.id, c.cnpj_cpf
    FROM public.customers c
  LOOP
    SELECT
      EXISTS (
        SELECT 1
        FROM public.customer_contacts cc
        JOIN public.portal_suppressed_emails pse
          ON lower(btrim(pse.email)) = lower(btrim(cc.email))
         AND pse.reason = 'bounce_permanente'
        WHERE cc.customer_id = v_customer.id
          AND cc.deactivated_at IS NULL
          AND NULLIF(btrim(cc.email), '') IS NOT NULL
      ),
      -- 474 (D18): só contato ativo conta como alternativa, como no bounce.
      COUNT(*) FILTER (
        WHERE cc.deactivated_at IS NULL
          AND NULLIF(btrim(cc.email), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.portal_suppressed_emails pse
            WHERE lower(btrim(pse.email)) = lower(btrim(cc.email))
          )
      )::INTEGER
    INTO v_has_bounced_contact, v_valid_contacts
    FROM public.customer_contacts cc
    WHERE cc.customer_id = v_customer.id;

    IF v_has_bounced_contact AND v_valid_contacts = 0 THEN
      v_bounce_pending := v_bounce_pending + 1;
      UPDATE public.alerts
      SET status = 'closed', closed_at = COALESCE(closed_at, now())
      WHERE type = 'cliente_contato_bounced_sem_alternativa'
        AND entity_type = 'customer'
        AND entity_id = v_customer.id::TEXT
        AND NOT EXISTS (
          SELECT 1
          FROM public.alert_items i
          WHERE i.alert_id = public.alerts.id
            AND i.item_type = 'cliente_contato_bounced_sem_alternativa'
        )
        AND status <> 'closed';

      PERFORM public.upsert_alert_item(
        'cliente_contato_bounced_sem_alternativa', 'customer', v_customer.id::TEXT,
        'Cliente sem contato alternativo válido após bounce permanente; atualize o cadastro.',
        v_source, 'documentacao',
        jsonb_build_object(
          'customer_id', v_customer.id,
          'customer_cnpj', v_customer.cnpj_cpf,
          'reason', 'all_contacts_bounced_or_suppressed'
        ),
        '/clientes'
      );
    ELSE
      PERFORM public.resolve_alert_item(
        'cliente_contato_bounced_sem_alternativa', 'customer', v_customer.id::TEXT,
        v_source, jsonb_build_object('reason', 'valid_contact_available')
      );
      UPDATE public.alerts
      SET status = 'closed', closed_at = COALESCE(closed_at, now())
      WHERE type = 'cliente_contato_bounced_sem_alternativa'
        AND entity_type = 'customer'
        AND entity_id = v_customer.id::TEXT
        AND NOT EXISTS (
          SELECT 1
          FROM public.alert_items i
          WHERE i.alert_id = public.alerts.id
            AND i.item_type = 'cliente_contato_bounced_sem_alternativa'
        )
        AND status <> 'closed';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'noa_pending', v_noa_pending,
    'nor_pending', v_nor_pending,
    'nob_pending', v_nob_pending,
    'nob_sem_terminal', v_nob_sem_terminal,
    'bounced_without_alternative', v_bounce_pending,
    'stale_pending_settled', v_stale_pending_settled
  );
END;
$function$;

-- O fechamento na hora do fato (353) não fecha o item "sem terminal": ele não
-- é alvo da régua e tem conta própria.
CREATE OR REPLACE FUNCTION public.resolve_customer_communication_pending_alerts(p_voyage_id bigint, p_port text, p_atracacao_id uuid, p_source text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := COALESCE(public.normalize_port_code(p_port), NULLIF(upper(btrim(p_port)), ''));
  v_item record;
  v_keys text[];
  v_closed integer := 0;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  -- A Atracação identifica o NOB; a viagem e o porto, a escala (NOA, NOR e os
  -- NOB dela). O porto do item NOB é o do terminal, sem normalizar.
  FOR v_item IN
    SELECT DISTINCT i.item_type, a.entity_type, a.entity_id
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type IN ('comunicado_noa_pendente', 'comunicado_nor_pendente', 'comunicado_nob_pendente')
      AND i.status = 'active'
      AND COALESCE(i.metadata->>'scope', '') <> 'sem_terminal'
      AND CASE
        WHEN p_atracacao_id IS NOT NULL THEN i.metadata->>'state_id' = p_atracacao_id::text
        ELSE i.metadata->>'voyage_id' = p_voyage_id::text
          AND COALESCE(public.normalize_port_code(i.metadata->>'port'), upper(btrim(i.metadata->>'port'))) = v_port
      END
  LOOP
    -- Os alvos de agora, uma vez por chamada e só com item aberto. Mesma chave
    -- do detector (`detect_customer_communication_alerts`, 315).
    -- ponytail: a conta é a de todos os alvos, como no detector; filtrar por
    -- escala dentro de `customer_communication_automation_targets` é o upgrade
    -- se a conta pesar nos gatilhos.
    IF v_keys IS NULL THEN
      SELECT COALESCE(array_agg(
          CASE WHEN t.kind = 'aviso_chegada_noa' THEN 'comunicado_noa_pendente'
               WHEN t.kind = 'aviso_prontidao_nor' THEN 'comunicado_nor_pendente'
               ELSE 'comunicado_nob_pendente' END
          || '|' || t.voyage_id || '::' || t.port
          || CASE WHEN t.kind = 'aviso_atracacao_nob' THEN '::' || t.terminal_code ELSE '' END), '{}'::text[])
        INTO v_keys
      FROM public.customer_communication_automation_targets(now()) t
      WHERE t.kind IN ('aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob');
    END IF;
    IF NOT (v_item.item_type || '|' || v_item.entity_id) = ANY (v_keys) THEN
      PERFORM public.resolve_alert_item(
        v_item.item_type, v_item.entity_type, v_item.entity_id,
        p_source, jsonb_build_object('reason', 'no_pending_target')
      );
      v_closed := v_closed + 1;
    END IF;
  END LOOP;

  RETURN v_closed;
END;
$function$;

-- Item 4: gravar Editar escala refaz os dois itens no fim da transação -------

CREATE OR REPLACE FUNCTION public.reconcile_escala_terminal_alerts_on_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_id bigint;
  v_port text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_voyage_id := OLD.voyage_id;
    v_port := OLD.port;
  ELSE
    v_voyage_id := NEW.voyage_id;
    v_port := NEW.port;
  END IF;
  -- ponytail: uma conta por linha gravada; Editar escala grava poucas frentes
  -- e Atracações por vez. Um gatilho por comando com tabela de transição é o
  -- upgrade se a gravação crescer.
  PERFORM public.reconcile_voyage_escala_terminal_alerts(v_voyage_id, v_port, 'voyage_operation_trigger');
  PERFORM public.reconcile_customer_communication_nob_sem_terminal(v_voyage_id, v_port, 'customer_communication_trigger');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Alertas de terminal da escala ignorados para voyage_id=%: %', v_voyage_id, SQLERRM;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_escala_terminal_alerts_on_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reconcile_escala_terminal_alerts_on_front ON public.voyage_escala_operation_fronts;
CREATE CONSTRAINT TRIGGER reconcile_escala_terminal_alerts_on_front
  AFTER INSERT OR UPDATE OR DELETE ON public.voyage_escala_operation_fronts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.reconcile_escala_terminal_alerts_on_change();

DROP TRIGGER IF EXISTS reconcile_escala_terminal_alerts_on_atracacao ON public.voyage_escala_terminal_state;
CREATE CONSTRAINT TRIGGER reconcile_escala_terminal_alerts_on_atracacao
  AFTER INSERT OR UPDATE OR DELETE ON public.voyage_escala_terminal_state
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.reconcile_escala_terminal_alerts_on_change();

-- Os dois gatilhos que já reconciliavam os alertas de data da escala passam a
-- rodar no fim da transação. Editar escala grava a Atracação antes das frentes
-- e insere a Atracação antes de pôr o ETB: no meio da gravação, a regra do ETB
-- por terminal e a "Escala sem terminal" abririam e fechariam um alerta na
-- mesma transação, com Notificação Interna. A função de cada um não muda; o
-- gatilho de audit ganha o filtro que a função já fazia por dentro.
DROP TRIGGER IF EXISTS reconcile_voyage_operation_alerts_on_terminal_change ON public.voyage_escala_terminal_state;
CREATE CONSTRAINT TRIGGER reconcile_voyage_operation_alerts_on_terminal_change
  AFTER INSERT OR UPDATE OF port, terminal_id, terminal_etb, terminal_atb, terminal_etd, terminal_atd, terminal_rtw
  ON public.voyage_escala_terminal_state
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.reconcile_voyage_operation_alerts_on_terminal_change();

DROP TRIGGER IF EXISTS reconcile_voyage_operation_alerts_on_audit ON public.audit_logs;
CREATE CONSTRAINT TRIGGER reconcile_voyage_operation_alerts_on_audit
  AFTER INSERT ON public.audit_logs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.entity_type IN ('voyage_pod_schedule', 'voyage_pol_schedule', 'voyages', 'voyage')
        OR (NEW.entity_type = 'bl' AND NEW.field_name = 'ce_mercante'))
  EXECUTE FUNCTION public.reconcile_voyage_operation_alerts_on_audit();

-- Item 5: ATB não é anterior ao ATA --------------------------------------------

CREATE OR REPLACE FUNCTION public._assert_escala_atb_not_before_ata(p_voyage_id bigint, p_port text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := COALESCE(public.normalize_port_code(p_port), NULLIF(upper(btrim(p_port)), ''));
  v_sched record;
  v_code text;
BEGIN
  IF v_port IS NULL OR p_voyage_id IS NULL THEN
    RETURN;
  END IF;
  SELECT s.* INTO v_sched
  FROM public.customer_communication_scale_schedules(p_voyage_id, v_port) AS s
  LIMIT 1;
  IF NOT FOUND OR v_sched.ata IS NULL OR v_sched.deleted THEN
    RETURN;
  END IF;

  SELECT public.voyage_terminal_code(s.terminal_id) INTO v_code
  FROM public.voyage_escala_terminal_state AS s
  WHERE s.voyage_id = p_voyage_id
    AND COALESCE(public.normalize_port_code(s.port), upper(btrim(s.port))) = v_port
    AND s.terminal_id IS NOT NULL
    AND s.terminal_atb < v_sched.ata
  ORDER BY s.terminal_atb
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'ATB anterior ao ATA da escala: o navio atraca depois de chegar ao porto. Corrija o ATA ou o ATB do terminal %.', v_code
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_escala_atb_not_before_ata_on_atracacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_escala_atb_not_before_ata(NEW.voyage_id, NEW.port);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_escala_atb_not_before_ata_on_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.entity_id ~ '^[0-9]+::[^:]+$' THEN
    PERFORM public._assert_escala_atb_not_before_ata(split_part(NEW.entity_id, '::', 1)::bigint, split_part(NEW.entity_id, '::', 2));
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._assert_escala_atb_not_before_ata(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_escala_atb_not_before_ata_on_atracacao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_escala_atb_not_before_ata_on_audit() FROM PUBLIC, anon, authenticated;

-- Adiados: Editar escala grava a Atracação antes do ATA na mesma transação, e
-- corrigir os dois juntos precisa ver os valores finais.
DROP TRIGGER IF EXISTS assert_escala_atb_not_before_ata_on_atracacao ON public.voyage_escala_terminal_state;
CREATE CONSTRAINT TRIGGER assert_escala_atb_not_before_ata_on_atracacao
  AFTER INSERT OR UPDATE OF terminal_atb, port ON public.voyage_escala_terminal_state
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.terminal_atb IS NOT NULL AND NEW.terminal_id IS NOT NULL)
  EXECUTE FUNCTION public.assert_escala_atb_not_before_ata_on_atracacao();

DROP TRIGGER IF EXISTS assert_escala_atb_not_before_ata_on_audit ON public.audit_logs;
CREATE CONSTRAINT TRIGGER assert_escala_atb_not_before_ata_on_audit
  AFTER INSERT ON public.audit_logs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.entity_type = 'voyage_pod_schedule' AND NEW.field_name = 'ata' AND NULLIF(btrim(NEW.new_value), '') IS NOT NULL)
  EXECUTE FUNCTION public.assert_escala_atb_not_before_ata_on_audit();

-- Item 6: leitura para o Painel e a Visão geral ------------------------------

CREATE OR REPLACE FUNCTION public.escala_frentes_sem_terminal(p_voyage_ids bigint[])
 RETURNS TABLE(voyage_id bigint, port text, fronts text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(COALESCE(p_voyage_ids, ARRAY[]::bigint[])) > 500 THEN
    RAISE EXCEPTION 'Consulte no máximo 500 Viagens por vez.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT s.voyage_id, s.port, f.fronts
  FROM (SELECT DISTINCT v.id FROM unnest(COALESCE(p_voyage_ids, ARRAY[]::bigint[])) AS v(id)) AS ids
  CROSS JOIN LATERAL public.customer_communication_scale_schedules(ids.id, NULL) AS s
  CROSS JOIN LATERAL (SELECT public._escala_terminal_pending_fronts(s.voyage_id, s.port) AS fronts) AS f
  WHERE NOT s.deleted
    AND NOT COALESCE(s.omitted, false)
    AND cardinality(f.fronts) > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.escala_frentes_sem_terminal(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escala_frentes_sem_terminal(bigint[]) TO authenticated;
