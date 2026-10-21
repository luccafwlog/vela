-- 346: os alertas de viagem e escala acompanham a escala, o B/L, os manifestos
-- de exportação e o status da viagem (revisão dos alertas de 2026-10-21,
-- docs/revisao-alertas-2026-10.md; L2, L6, L7 e L10 do estudo
-- docs/archive/audits/2026-10-20-auto-resolucao-de-alertas.md).
--
-- Problemas:
--   1. "Exportação pendente pós-ATD" (`voyage_export_after_atd`) piscava. O
--      item é da escala (`voyage_pod_schedule` = `<viagem>::<porto>`), mas
--      `reconcile_voyage_operation_alerts` chamava o reconciliador uma vez por
--      terminal, e cada chamada lia só o ATD daquele terminal. Com dois
--      terminais no porto, um com ATD e outro sem, a mesma rodada abria e
--      fechava o item (a ordem das linhas decidia o final). Cada rodada do
--      detector (15 min) e cada gatilho da viagem gravavam um evento "aberto"
--      e uma Notificação Interna para cada usuário de Operações, e o alerta
--      não ficava aberto na fila.
--   2. Escala excluída ou omitida tentava fechar a exportação com a entidade
--      `voyage_escala_terminal`, que esse tipo não usa (L6): não fechava nada,
--      e a reconciliação seguinte a reabria.
--   3. Vincular o manifesto de Granito ou de Embarque de Vazios, ou mudar o
--      planejamento de exportação, não reconciliava a exportação (L7).
--   4. Importar, cancelar, mover ou excluir B/L não reconciliava "B/Ls
--      esperados" nem "CE Mercante pendente" (L2); só o detector, e só na
--      viagem ativa.
--   5. "B/Ls esperados" comparava o porto do B/L sem `normalize_port_code`
--      (BRVIT × BRVIX) e contava B/L cancelado; o "CE Mercante pendente" da
--      mesma viagem normaliza e exclui o cancelado.
--   6. Viagem cancelada ou concluída congelava os alertas de viagem (L10): o
--      detector só varre `status = 'active'`, e nada fechava os itens abertos
--      no cancelamento.
--   7. ETB/ATB/ETD/ATD do terminal (timestamptz) viravam data no fuso da
--      sessão (UTC): a mensagem dizia "ETB de 22/10" para um ETB digitado
--      21/10 22:00 em Brasília, e o "passou" comparava dia UTC com o dia de
--      Brasília.
--
-- Mudança:
--   1. `reconcile_voyage_export_after_atd_alerts(viagem, porto, origem)`
--      decide pela escala: há ATD se algum terminal do porto tem ATD; escala
--      excluída ou omitida fecha. A assinatura antiga, com o terminal, sai
--      (só `reconcile_voyage_operation_alerts` a chamava). O item continua
--      `voyage_pod_schedule` = `<viagem>::<porto>`.
--   2. `reconcile_voyage_schedule_date_alerts`: escala excluída ou omitida
--      fecha a exportação pela função acima (entidade certa); datas do
--      terminal em dia de Brasília.
--   3. `reconcile_voyage_export_alerts(viagem, origem)` reconcilia a
--      exportação de todos os portos de exportação (e dos itens abertos), e
--      roda nos gatilhos novos de `granite_manifests`, `vazios_manifests` e
--      `voyage_export_schedules`.
--   4. `reconcile_voyage_bl_expected_alerts`: portos normalizados dos dois
--      lados e B/L cancelado fora da conta, como no CE Mercante pendente.
--   5. Gatilhos de instrução em `bls` (inclusão, exclusão e mudança de
--      viagem, POL, POD ou cancelamento) reconciliam "B/Ls esperados" e "CE
--      Mercante pendente" das viagens afetadas. Respeitam o adiamento da
--      importação de B/L (`alerts.baplie_coverage_deferred`), que passa a
--      reconciliar os dois no fim (`import_bl_freight_transactional_legacy_070`).
--   6. `reconcile_voyage_operation_alerts`: viagem cancelada fecha todos os
--      itens ativos dos alertas da viagem (`voyage_alert_scope`, 341, só os
--      alertas cuja entidade é a viagem, a escala ou o terminal) e para.
--      `detect_voyage_operation_alerts` varre também a viagem não ativa que
--      ainda tem alerta aberto: a cancelada fecha; a concluída reavalia só os
--      tipos já abertos (não abre tipo novo em viagem encerrada).
--
-- Só redefine funções e cria gatilhos; não reescreve nem apaga linhas. Os
-- itens que hoje estão abertos (ou piscando) se acertam na próxima rodada do
-- detector.
-- Rollback: reaplicar as definições das migrations 324
-- (reconcile_voyage_export_after_atd_alerts de 4 argumentos,
-- reconcile_voyage_schedule_date_alerts, reconcile_voyage_bl_expected_alerts),
-- 002 (reconcile_voyage_operation_alerts, detect_voyage_operation_alerts) e
-- 175 (import_bl_freight_transactional_legacy_070); DROP dos gatilhos
-- reconcile_voyage_bl_alerts_on_bls_*, reconcile_voyage_export_alerts_on_* e
-- das funções reconcile_voyage_bl_alerts_from_*, reconcile_voyage_export_alerts,
-- reconcile_voyage_export_alerts_on_change, reconcile_inactive_voyage_alerts e
-- reconcile_voyage_export_after_atd_alerts(bigint,text,text).

-- 1 -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reconcile_voyage_export_after_atd_alerts(bigint, text, text, text);

CREATE OR REPLACE FUNCTION public.reconcile_voyage_export_after_atd_alerts(
  p_voyage_id bigint,
  p_port text,
  p_source text DEFAULT 'voyage_operation_detector'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port_norm TEXT := upper(btrim(p_port));
  v_entity_id TEXT := p_voyage_id || '::' || upper(btrim(p_port));
  v_export_rec RECORD;
  v_has_export BOOLEAN;
  v_scale_removed BOOLEAN;
  v_atd RECORD;
  v_has_granite_link BOOLEAN := true;
  v_has_empty_link BOOLEAN := true;
BEGIN
  SELECT tem_exportacao, has_granite, has_empty
  INTO v_export_rec
  FROM public.voyage_export_schedules
  WHERE voyage_id = p_voyage_id AND upper(btrim(pol)) = v_port_norm;
  v_has_export := FOUND AND COALESCE(v_export_rec.tem_exportacao, false);

  -- Escala excluída ou omitida não embarca exportação: o item fecha.
  SELECT COALESCE(bool_or(l.new_value = 'true'), false)
  INTO v_scale_removed
  FROM (
    SELECT DISTINCT ON (a.field_name) a.new_value
    FROM public.audit_logs a
    WHERE a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id = v_entity_id
      AND a.field_name IN ('deleted', 'omitted')
    ORDER BY a.field_name, a.changed_at DESC, a.id DESC
  ) l;

  IF NOT v_has_export OR v_scale_removed THEN
    PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_pod_schedule', v_entity_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- O item é da escala: há saída quando algum terminal do porto tem ATD (o
  -- mais recente identifica o terminal na mensagem). Ler um terminal por
  -- chamada fazia a ordem das linhas decidir o resultado (346).
  SELECT s.terminal_id, s.terminal_atd, public.voyage_terminal_code(s.terminal_id) AS terminal_code
  INTO v_atd
  FROM public.voyage_escala_terminal_state s
  WHERE s.voyage_id = p_voyage_id
    AND s.port = v_port_norm
    AND s.terminal_atd IS NOT NULL
  ORDER BY s.terminal_atd DESC, s.terminal_id
  LIMIT 1;

  IF v_atd.terminal_atd IS NULL THEN
    PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_pod_schedule', v_entity_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- ponytail: Granito e Vazios contam por viagem, não por porto
  -- (`vazios_manifests` não guarda o porto). Numa viagem com exportação em
  -- dois portos, o manifesto de um fecha o alerta do outro; o upgrade é
  -- comparar `granite_manifests.loading_port` e o porto de `vazios_bookings`.
  IF COALESCE(v_export_rec.has_granite, false) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.granite_manifests WHERE voyage_id = p_voyage_id
    ) INTO v_has_granite_link;
  END IF;

  IF COALESCE(v_export_rec.has_empty, false) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.vazios_manifests WHERE voyage_id = p_voyage_id
    ) INTO v_has_empty_link;
  END IF;

  IF NOT v_has_granite_link OR NOT v_has_empty_link THEN
    PERFORM public.upsert_alert_item(
      'voyage_export_after_atd',
      'voyage_pod_schedule',
      v_entity_id,
      'Saída (ATD) registrada no terminal sem a exportação vinculada.',
      p_source,
      jsonb_build_object(
        'voyage_id', p_voyage_id,
        'port', v_port_norm,
        'terminal_id', v_atd.terminal_id::text,
        'terminal_code', v_atd.terminal_code,
        'has_granite', v_export_rec.has_granite,
        'has_empty', v_export_rec.has_empty,
        'granite_linked', v_has_granite_link,
        'empty_linked', v_has_empty_link
      ),
      '/viagens/' || p_voyage_id || '?escala=' || v_port_norm
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_pod_schedule', v_entity_id, p_source, '{}'::jsonb);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_export_after_atd_alerts(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_export_after_atd_alerts(bigint, text, text) TO service_role;

-- 2 -------------------------------------------------------------------------
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
  v_has_terminal_etb BOOLEAN := false;
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
    RETURN;
  END IF;

  SELECT COALESCE(bool_or(terminal_etb IS NOT NULL), false)
  INTO v_has_terminal_etb
  FROM public.voyage_escala_terminal_state
  WHERE voyage_id = p_voyage_id AND port = v_port_norm;

  -- Predicado da escala: depois da chegada, cobrar somente a existência de
  -- uma Atracação com previsão de ETB. TBC conta para este conjunto.
  IF v_eta IS NOT NULL AND v_eta <= v_today AND v_ata IS NULL THEN
    PERFORM public.upsert_alert_item(
      'voyage_schedule_date_pending', 'voyage_pod_schedule', v_scale_entity_id,
      'ETA de ' || to_char(v_eta, 'DD/MM/YYYY') || ' passou sem ATA registrada.',
      p_source, jsonb_build_object('voyage_id', p_voyage_id, 'port', v_port_norm, 'milestone', 'ata', 'eta', v_eta),
      '/viagens/' || p_voyage_id || '?escala=' || v_port_norm
    );
  ELSIF v_ata IS NOT NULL AND NOT v_has_terminal_etb THEN
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
    IF v_term_rec.terminal_etb IS NOT NULL AND v_term_rec.terminal_etb <= v_today AND v_term_rec.terminal_atb IS NULL THEN
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
END;
$function$;

-- 3 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_voyage_export_alerts(
  p_voyage_id bigint,
  p_source text DEFAULT 'voyage_operation_detector'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port TEXT;
BEGIN
  -- Portos com planejamento de exportação e portos com item aberto (o
  -- planejamento removido também fecha o item).
  FOR v_port IN
    SELECT upper(btrim(e.pol))
    FROM public.voyage_export_schedules e
    WHERE e.voyage_id = p_voyage_id AND NULLIF(btrim(e.pol), '') IS NOT NULL
    UNION
    SELECT split_part(a.entity_id, '::', 2)
    FROM public.alerts a
    JOIN public.alert_items i ON i.alert_id = a.id
    WHERE i.item_type = 'voyage_export_after_atd'
      AND i.status = 'active'
      AND a.entity_type = 'voyage_pod_schedule'
      AND a.entity_id LIKE p_voyage_id::text || '::%'
  LOOP
    IF NULLIF(v_port, '') IS NOT NULL THEN
      PERFORM public.reconcile_voyage_export_after_atd_alerts(p_voyage_id, v_port, p_source);
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_export_alerts(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_export_alerts(bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_voyage_export_alerts_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_ids bigint[] := ARRAY[]::bigint[];
  v_voyage_id bigint;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_voyage_ids := v_voyage_ids || NEW.voyage_id::bigint;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_voyage_ids := v_voyage_ids || OLD.voyage_id::bigint;
  END IF;
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN
    SELECT DISTINCT x.voyage_id FROM unnest(v_voyage_ids) AS x(voyage_id) WHERE x.voyage_id IS NOT NULL
  LOOP
    IF EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id) THEN
      PERFORM public.reconcile_voyage_export_alerts(v_voyage_id, 'voyage_export_trigger');
    END IF;
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação da exportação ignorada (%): %', TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_export_alerts_on_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reconcile_voyage_export_alerts_on_granite ON public.granite_manifests;
CREATE TRIGGER reconcile_voyage_export_alerts_on_granite
  AFTER INSERT OR DELETE OR UPDATE OF voyage_id ON public.granite_manifests
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_voyage_export_alerts_on_change();

DROP TRIGGER IF EXISTS reconcile_voyage_export_alerts_on_vazios ON public.vazios_manifests;
CREATE TRIGGER reconcile_voyage_export_alerts_on_vazios
  AFTER INSERT OR DELETE OR UPDATE OF voyage_id ON public.vazios_manifests
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_voyage_export_alerts_on_change();

DROP TRIGGER IF EXISTS reconcile_voyage_export_alerts_on_schedule ON public.voyage_export_schedules;
CREATE TRIGGER reconcile_voyage_export_alerts_on_schedule
  AFTER INSERT OR DELETE OR UPDATE OF voyage_id, pol, tem_exportacao, has_granite, has_empty ON public.voyage_export_schedules
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_voyage_export_alerts_on_change();

-- 4 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_voyage_bl_expected_alerts(p_voyage_id bigint, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_expected_pol_count INTEGER := 0;
  v_missing_pol_count INTEGER := 0;
  v_missing_pod_count INTEGER := 0;
  v_bl_count INTEGER := 0;
  v_covered BOOLEAN := false;
BEGIN
  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);

  IF v_first_eta IS NULL OR v_today < (v_first_eta - 7) THEN
    PERFORM public.resolve_alert_item('voyage_bl_expected', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- B/L, escala e programação podem guardar o mesmo porto com nomes
  -- diferentes (BRVIT × BRVIX): os dois lados comparam a forma normalizada,
  -- e B/L cancelado não cobre porto, como no CE Mercante pendente (346).
  WITH planned_pol AS (
    SELECT DISTINCT ON (entity_id)
      COALESCE(public.normalize_port_code(split_part(entity_id, '::', 2)), upper(btrim(split_part(entity_id, '::', 2)))) AS port,
      NULLIF(btrim(new_value), '') AS etd
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pol_schedule'
      AND entity_id LIKE p_voyage_id || '::%'
      AND field_name = 'etd'
    ORDER BY entity_id, changed_at DESC, id DESC
  ),
  live_bls AS (
    SELECT
      COALESCE(public.normalize_port_code(b.pol), upper(btrim(b.pol))) AS pol,
      COALESCE(public.normalize_port_code(b.pod), upper(btrim(b.pod))) AS pod
    FROM public.bls b
    WHERE b.voyage_id = p_voyage_id
      AND b.cancelled_at IS NULL
  )
  SELECT
    (SELECT count(*) FROM live_bls),
    (SELECT count(*) FROM planned_pol WHERE etd IS NOT NULL),
    (SELECT count(*) FROM planned_pol p
      WHERE p.etd IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM live_bls l WHERE l.pol = p.port)),
    (SELECT count(*) FROM public.get_voyage_eligible_pods(p_voyage_id) e
      WHERE NOT EXISTS (
        SELECT 1 FROM live_bls l WHERE l.pod = COALESCE(public.normalize_port_code(e.pod), e.pod)))
  INTO v_bl_count, v_expected_pol_count, v_missing_pol_count, v_missing_pod_count;

  -- Sem POL planejado, basta um B/L para cada POD elegível.
  v_covered := v_bl_count > 0
    AND v_missing_pod_count = 0
    AND (v_expected_pol_count = 0 OR v_missing_pol_count = 0);

  IF v_covered THEN
    PERFORM public.resolve_alert_item('voyage_bl_expected', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  ELSE
    PERFORM public.upsert_alert_item(
      'voyage_bl_expected',
      'voyage',
      p_voyage_id::text,
      'Prazo D-7 atingido sem os B/Ls esperados.',
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'first_eta', v_first_eta),
      '/viagens/' || p_voyage_id
    );
  END IF;
END;
$function$;

-- 5 -------------------------------------------------------------------------
-- Reconcilia os alertas de viagem que contam B/Ls. Falha não desfaz a escrita
-- do B/L: vira WARNING, como nas reconciliações da cobertura do Baplie, e o
-- detector de 15 minutos refaz a conta.
CREATE OR REPLACE FUNCTION public._reconcile_voyage_bl_alerts(p_voyage_ids bigint[], p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage record;
BEGIN
  FOR v_voyage IN
    SELECT v.id, v.status
    FROM public.voyages v
    WHERE v.id = ANY (COALESCE(p_voyage_ids, ARRAY[]::bigint[]))
      AND v.status <> 'cancelled'
    ORDER BY v.id
  LOOP
    BEGIN
      -- Viagem concluída: só reavalia o tipo que já está aberto, como a
      -- varredura do detector (reconcile_inactive_voyage_alerts).
      IF v_voyage.status = 'active' OR EXISTS (
        SELECT 1 FROM public.voyage_alert_scope(v_voyage.id) s
        JOIN public.alert_items i ON i.alert_id = s.alert_id
        WHERE i.item_type = 'voyage_bl_expected' AND i.status = 'active'
      ) THEN
        PERFORM public.reconcile_voyage_bl_expected_alerts(v_voyage.id, p_source);
      END IF;
      IF v_voyage.status = 'active' OR EXISTS (
        SELECT 1 FROM public.voyage_alert_scope(v_voyage.id) s
        JOIN public.alert_items i ON i.alert_id = s.alert_id
        WHERE i.item_type = 'voyage_ce_mercante_missing' AND i.status = 'active'
      ) THEN
        PERFORM public.reconcile_voyage_ce_mercante_missing_alerts(v_voyage.id, p_source);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Reconciliação de B/Ls esperados e CE pendente ignorada para a viagem %: %', v_voyage.id, SQLERRM;
    END;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public._reconcile_voyage_bl_alerts(bigint[], text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_voyage_bl_alerts_from_bls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_ids bigint[];
BEGIN
  -- A importação de B/L adia e reconcilia no fim, uma vez por viagem
  -- (`import_bl_freight_transactional_legacy_070`).
  IF current_setting('alerts.baplie_coverage_deferred', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.voyage_id) INTO v_voyage_ids
    FROM new_rows n WHERE n.voyage_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.voyage_id) INTO v_voyage_ids
    FROM old_rows o WHERE o.voyage_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT affected.voyage_id) INTO v_voyage_ids
    FROM (
      SELECT n.voyage_id, o.voyage_id AS old_voyage_id
      FROM new_rows n
      JOIN old_rows o ON o.id = n.id
      WHERE n.voyage_id IS DISTINCT FROM o.voyage_id
         OR n.pol IS DISTINCT FROM o.pol
         OR n.pod IS DISTINCT FROM o.pod
         OR n.cancelled_at IS DISTINCT FROM o.cancelled_at
    ) changed
    CROSS JOIN LATERAL (VALUES (changed.voyage_id), (changed.old_voyage_id)) AS affected(voyage_id)
    WHERE affected.voyage_id IS NOT NULL;
  END IF;

  IF cardinality(COALESCE(v_voyage_ids, ARRAY[]::bigint[])) > 0 THEN
    PERFORM set_config('alerts.foundation_trigger', 'on', true);
    PERFORM public._reconcile_voyage_bl_alerts(v_voyage_ids, 'bl_change_trigger');
    PERFORM set_config('alerts.foundation_trigger', 'off', true);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_bl_alerts_from_bls() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reconcile_voyage_bl_alerts_on_bls_insert ON public.bls;
CREATE TRIGGER reconcile_voyage_bl_alerts_on_bls_insert
  AFTER INSERT ON public.bls
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_voyage_bl_alerts_from_bls();

DROP TRIGGER IF EXISTS reconcile_voyage_bl_alerts_on_bls_delete ON public.bls;
CREATE TRIGGER reconcile_voyage_bl_alerts_on_bls_delete
  AFTER DELETE ON public.bls
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_voyage_bl_alerts_from_bls();

DROP TRIGGER IF EXISTS reconcile_voyage_bl_alerts_on_bls_update ON public.bls;
CREATE TRIGGER reconcile_voyage_bl_alerts_on_bls_update
  AFTER UPDATE ON public.bls
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_voyage_bl_alerts_from_bls();

-- 6 -------------------------------------------------------------------------
-- Definição da migration 175 com a reconciliação de B/Ls esperados e CE
-- pendente no laço final por viagem.
CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional_legacy_070(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_item jsonb;
  v_bl_id text;
  v_next text[];
  v_current text[];
  v_voyage_ids bigint[] := ARRAY[]::bigint[];
  v_voyage_id bigint;
  v_pol text;
  v_canonical_atd date;
  v_current_atd text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar frete do BL.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::bigint[])
    INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE item->>'id' IS NOT NULL
  ) AND b.voyage_id IS NOT NULL;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);
  v_result := public.import_bl_freight_transactional_legacy_357(p_bls, p_changed_by);

  FOR v_item IN SELECT item FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;

    -- Preserva o fato já cadastrado quando um payload antigo não possui a chave
    -- e quando o Laden on Board do arquivo é ilegível ou vazio (ADR 0078, item 17).
    IF v_item ? 'laden_on_board' AND NULLIF(btrim(v_item->>'laden_on_board'), '') IS NOT NULL THEN
      UPDATE public.bls
      SET laden_on_board = NULLIF(v_item->>'laden_on_board', '')::date,
          updated_at = now()
      WHERE id = v_bl_id;
    END IF;

    v_next := public.normalize_ncm_codes(v_item->'ncm_codes');
    CONTINUE WHEN cardinality(v_next) = 0;
    SELECT ncm_codes INTO v_current FROM public.bls WHERE id = v_bl_id;
    CONTINUE WHEN NOT FOUND OR v_current = v_next;
    UPDATE public.bls SET ncm_codes = v_next WHERE id = v_bl_id;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', v_bl_id, 'ncm_codes', array_to_string(COALESCE(v_current, ARRAY[]::text[]), ', '), array_to_string(v_next, ', '), p_changed_by, 'NCM declarado no documento reimportado');
  END LOOP;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);

  SELECT v_voyage_ids || COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::bigint[])
    INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE item->>'id' IS NOT NULL
  ) AND b.voyage_id IS NOT NULL;

  FOR v_voyage_id IN
    SELECT DISTINCT ids.voyage_id FROM unnest(v_voyage_ids) AS ids(voyage_id)
    WHERE ids.voyage_id IS NOT NULL ORDER BY ids.voyage_id
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_import');
    -- O adiamento também segura os gatilhos de B/Ls esperados e CE pendente
    -- (346): reconcilia os dois aqui, uma vez por viagem.
    PERFORM public._reconcile_voyage_bl_alerts(ARRAY[v_voyage_id], 'bl_import');

    FOR v_pol IN
      SELECT DISTINCT upper(btrim(b.pol))
      FROM public.bls AS b
      WHERE b.voyage_id = v_voyage_id AND NULLIF(btrim(b.pol), '') IS NOT NULL
    LOOP
      SELECT min(b.laden_on_board) INTO v_canonical_atd
      FROM public.bls AS b
      WHERE b.voyage_id = v_voyage_id AND upper(btrim(b.pol)) = v_pol;

      SELECT al.new_value INTO v_current_atd
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pol_schedule'
        AND al.entity_id = v_voyage_id::text || '::' || v_pol
        AND al.field_name = 'atd'
      ORDER BY al.changed_at DESC, al.id DESC
      LIMIT 1;

      IF v_current_atd IS DISTINCT FROM v_canonical_atd::text THEN
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES (
          'voyage_pol_schedule', v_voyage_id::text || '::' || v_pol, 'atd',
          v_current_atd, v_canonical_atd::text, p_changed_by,
          'ATD derivado do menor Laden on Board persistido na mesma transação do import (ADR 0025)'
        );
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional_legacy_070(jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- 7 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_voyage_operation_alerts(p_voyage_id bigint, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status TEXT;
  v_port_rec RECORD;
  v_item RECORD;
BEGIN
  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Viagem cancelada não tem prazo, escala nem exportação a cobrar: fecha os
  -- itens ativos dos alertas da viagem, da escala e do terminal (346). A
  -- viagem cancelada é somente leitura; reativá-la reconcilia de novo.
  IF v_status = 'cancelled' THEN
    FOR v_item IN
      SELECT DISTINCT i.item_type, a.entity_type, a.entity_id
      FROM public.voyage_alert_scope(p_voyage_id) s
      JOIN public.alerts a ON a.id = s.alert_id
      JOIN public.alert_items i ON i.alert_id = a.id
      WHERE s.alert_id IS NOT NULL AND i.status = 'active'
    LOOP
      PERFORM public.resolve_alert_item(v_item.item_type, v_item.entity_type, v_item.entity_id, p_source,
        jsonb_build_object('reason', 'voyage_cancelled'));
    END LOOP;
    RETURN;
  END IF;

  -- Nível viagem (documentação / BL / Baplie / CE)
  PERFORM public.reconcile_voyage_bl_expected_alerts(p_voyage_id, p_source);
  PERFORM public.reconcile_voyage_baplie_missing_alerts(p_voyage_id, p_source);
  PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, p_source);
  PERFORM public.reconcile_voyage_ce_mercante_missing_alerts(p_voyage_id, p_source);

  -- Nível escala (datas compartilhadas e por terminal)
  FOR v_port_rec IN
    SELECT DISTINCT upper(btrim(split_part(entity_id, '::', 2))) AS port
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule' AND entity_id LIKE p_voyage_id || '::%'
    UNION
    SELECT DISTINCT upper(btrim(port)) AS port
    FROM public.voyage_escala_terminal_state
    WHERE voyage_id = p_voyage_id
    UNION
    SELECT DISTINCT upper(btrim(pol)) AS port
    FROM public.voyage_export_schedules
    WHERE voyage_id = p_voyage_id
  LOOP
    IF v_port_rec.port IS NOT NULL AND v_port_rec.port <> '' THEN
      PERFORM public.reconcile_voyage_schedule_date_alerts(p_voyage_id, v_port_rec.port, p_source);
    END IF;
  END LOOP;

  -- Exportação: uma decisão por escala, não por terminal (346).
  PERFORM public.reconcile_voyage_export_alerts(p_voyage_id, p_source);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_inactive_voyage_alerts(
  p_voyage_id bigint,
  p_source text DEFAULT 'voyage_operation_detector'::text
)
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
      WHEN 'voyage_schedule_date_pending', 'voyage_terminal_date_pending' THEN
        PERFORM public.reconcile_voyage_schedule_date_alerts(p_voyage_id, split_part(v_item.entity_id, '::', 2), p_source);
      WHEN 'voyage_export_after_atd' THEN
        PERFORM public.reconcile_voyage_export_after_atd_alerts(p_voyage_id, split_part(v_item.entity_id, '::', 2), p_source);
      ELSE
        -- Comunicados (NOA/NOR/NOB) têm detector próprio.
        NULL;
    END CASE;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_inactive_voyage_alerts(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_inactive_voyage_alerts(bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.detect_voyage_operation_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_voyage IN
    SELECT id
    FROM public.voyages
    WHERE status = 'active'
    ORDER BY id
  LOOP
    PERFORM public.reconcile_voyage_operation_alerts(v_voyage.id, 'voyage_operation_detector');
    v_count := v_count + 1;
  END LOOP;

  -- Viagem concluída ou cancelada com alerta ainda aberto: sem esta volta, o
  -- alerta ficava congelado (346). A comparação é por texto: a chave do
  -- alerta não é convertida para número.
  FOR v_voyage IN
    SELECT v.id
    FROM public.voyages v
    WHERE v.status <> 'active'
      AND EXISTS (
        SELECT 1 FROM public.alerts a
        WHERE a.status <> 'closed'
          AND a.entity_type LIKE 'voyage%'
          AND split_part(a.entity_id, '::', 1) = v.id::text
      )
    ORDER BY v.id
  LOOP
    PERFORM public.reconcile_inactive_voyage_alerts(v_voyage.id, 'voyage_operation_detector');
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;
