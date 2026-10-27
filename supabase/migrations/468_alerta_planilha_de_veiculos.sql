-- 468: alerta "Planilha de Veículos pendente" para Equipamentos e declaração
-- "Esta viagem não terá veículos" (reunião de testes de 2026-10-26, decisões
-- do dono de 2026-10-27; docs/plans/2026-10-27-lote-da-reuniao-de-testes-de-26-10.md,
-- bloco 4).
--
-- Problema:
--   Viagem com veículos em que Equipamentos não importa a planilha de Veículos:
--   a Documentação vincula o CE Mercante, a fatura sai pelo CE e o B/L de
--   veículo em LCL, que seria isento de Taxas Locais, é cobrado cheio. Nada
--   avisava Equipamentos.
--
-- Mudança:
--   1. `voyage_vehicle_declarations`: no máximo uma declaração "sem veículos"
--      por viagem, com quem e quando. Só as funções abaixo escrevem; o
--      navegador lê pela `voyage_vehicle_declaration` (RLS sem policy e sem
--      grant a `authenticated`).
--   2. `declare_voyage_without_vehicles` e `undo_voyage_vehicle_declaration`
--      (desfazer pede motivo): usuário interno ativo, como quem importa
--      veículos. Viagem cancelada ou já com veículo recusa a declaração. Cada
--      uma grava `audit_logs` (`voyage`, campo `sem_veiculos`), lido pela Linha
--      do Tempo da Viagem.
--   3. Tipo `voyage_vehicle_sheet_pending` (Crítico, Equipamentos), um por
--      Viagem. `reconcile_voyage_vehicle_sheet_alerts` abre em D-5 do primeiro
--      ETA brasileiro, como o CE Mercante pendente (`324`), em viagem com B/L
--      ativo de container ou misto num POD elegível, sem veículo e sem
--      declaração; fecha quando um dos três deixa de valer. Viagem concluída
--      não ganha o alerta (346): só o aberto é reavaliado.
--   4. A reconciliação entra em `reconcile_voyage_operation_alerts` (detector de
--      15 minutos e gatilhos da escala, que cobrem a virada do dia e o ETA),
--      em `reconcile_inactive_voyage_alerts` e em `_reconcile_voyage_bl_alerts`
--      (B/L incluído, cancelado ou trocado de POD); os três são redefinidos
--      pelo corpo da 346 com a chamada nova.
--   5. Gatilho de instrução em `vehicles` (inserir, mover de viagem, excluir):
--      reconcilia as viagens tocadas, e veículo que entra numa viagem
--      declarada "sem veículos" desfaz a declaração, com o Histórico "Veículos
--      importados" (o fato vale mais que a declaração). A viagem é travada
--      (`FOR NO KEY UPDATE`) pelo gatilho e pela declaração, para as duas não
--      se cruzarem; a trava não conflita com as FKs que apontam para
--      `voyages` (`FOR KEY SHARE`).
--
-- Não reescreve nem apaga linhas existentes: a tabela nasce vazia, e os alertas
-- abrem na próxima reconciliação.
--
-- Rollback: dropar o gatilho, as funções novas e a tabela; recriar
-- `reconcile_voyage_operation_alerts`, `reconcile_inactive_voyage_alerts` e
-- `_reconcile_voyage_bl_alerts` pela 346; `UPDATE alert_type_catalog SET
-- active = false WHERE type = 'voyage_vehicle_sheet_pending'`.

-- 1 -------------------------------------------------------------------------
CREATE TABLE public.voyage_vehicle_declarations (
  voyage_id bigint PRIMARY KEY REFERENCES public.voyages(id) ON DELETE CASCADE,
  declared_at timestamptz NOT NULL DEFAULT now(),
  declared_by uuid NOT NULL
);

COMMENT ON TABLE public.voyage_vehicle_declarations IS
  'Viagem declarada sem veículos por Equipamentos (migration 468): fecha o alerta Planilha de Veículos pendente.';

ALTER TABLE public.voyage_vehicle_declarations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voyage_vehicle_declarations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voyage_vehicle_declarations TO service_role;

-- 3 -------------------------------------------------------------------------
INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES ('voyage_vehicle_sheet_pending', 'critical', 'equipamentos', ARRAY['equipamentos'], '/veiculos')
ON CONFLICT (type) DO NOTHING;

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
BEGIN
  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id;
  IF NOT FOUND OR v_status = 'cancelled' THEN
    PERFORM public.resolve_alert_item('voyage_vehicle_sheet_pending', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- Viagem concluída não ganha o alerta (346); o que já está aberto segue sendo
  -- reavaliado e fecha com o fato que chega depois.
  IF v_status <> 'active' AND NOT EXISTS (
    SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'voyage_vehicle_sheet_pending' AND i.status = 'active'
      AND a.entity_type = 'voyage' AND a.entity_id = p_voyage_id::text
  ) THEN
    RETURN;
  END IF;

  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);

  -- A planilha de Veículos casa veículo com B/L e container: viagem só de carga
  -- solta não tem o que importar. Porto normalizado dos dois lados, como no CE
  -- Mercante pendente (BRVIT × BRVIX).
  SELECT count(*) INTO v_container_bls
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND b.cancelled_at IS NULL
    AND b.cargo_mode IN ('container', 'misto')
    AND COALESCE(public.normalize_port_code(b.pod), upper(btrim(b.pod))) IN (
      SELECT COALESCE(public.normalize_port_code(e.pod), e.pod) FROM public.get_voyage_eligible_pods(p_voyage_id) AS e);

  IF v_first_eta IS NULL
     OR v_today < (v_first_eta - 5)
     OR v_container_bls = 0
     OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.voyage_id = p_voyage_id)
     OR EXISTS (SELECT 1 FROM public.voyage_vehicle_declarations d WHERE d.voyage_id = p_voyage_id) THEN
    PERFORM public.resolve_alert_item('voyage_vehicle_sheet_pending', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  PERFORM public.upsert_alert_item(
    'voyage_vehicle_sheet_pending',
    'voyage',
    p_voyage_id::text,
    'Importe a planilha de Veículos ou declare que a viagem não terá veículos; ETA em '
      || to_char(v_first_eta, 'DD/MM/YYYY') || ', prazo D-5 atingido.',
    p_source,
    jsonb_build_object('voyage_id', p_voyage_id, 'container_bl_count', v_container_bls, 'first_eta', v_first_eta),
    '/veiculos?voyage=' || p_voyage_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_vehicle_sheet_alerts(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_vehicle_sheet_alerts(bigint, text) TO service_role;

-- 2 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voyage_vehicle_declaration(p_voyage_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo consulta a declaração de veículos da viagem.' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'voyage_id', d.voyage_id,
    'declared_at', d.declared_at,
    'declared_by', d.declared_by,
    'declared_by_name', NULLIF(btrim(p.full_name), ''))
  INTO v_result
  FROM public.voyage_vehicle_declarations d
  LEFT JOIN public.user_profiles p ON p.id = d.declared_by
  WHERE d.voyage_id = p_voyage_id;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.voyage_vehicle_declaration(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voyage_vehicle_declaration(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declare_voyage_without_vehicles(p_voyage_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_vehicles integer;
  v_inserted bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo declara a viagem sem veículos.' USING ERRCODE = '42501';
  END IF;

  -- Mesma trava do gatilho de `vehicles`: a importação em curso termina antes
  -- da contagem abaixo, e a declaração não nasce ao lado de veículo novo.
  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % não encontrada.', p_voyage_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Viagem cancelada não recebe a declaração de veículos.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_vehicles FROM public.vehicles WHERE voyage_id = p_voyage_id;
  IF v_vehicles > 0 THEN
    RAISE EXCEPTION 'A viagem já tem % veículo(s) importado(s): ela não pode ser declarada sem veículos.', v_vehicles
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.voyage_vehicle_declarations (voyage_id, declared_by)
  VALUES (p_voyage_id, auth.uid())
  ON CONFLICT (voyage_id) DO NOTHING
  RETURNING voyage_id INTO v_inserted;

  -- Declarar de novo não repete o Histórico.
  IF v_inserted IS NOT NULL THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
    VALUES ('voyage', p_voyage_id::text, 'sem_veiculos', NULL, 'declarada', auth.uid());
  END IF;

  PERFORM public.reconcile_voyage_vehicle_sheet_alerts(p_voyage_id, 'vehicle_declaration');
  RETURN public.voyage_vehicle_declaration(p_voyage_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.declare_voyage_without_vehicles(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declare_voyage_without_vehicles(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.undo_voyage_vehicle_declaration(p_voyage_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_deleted bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo desfaz a declaração de veículos.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Desfazer a declaração exige motivo.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR NO KEY UPDATE;
  DELETE FROM public.voyage_vehicle_declarations WHERE voyage_id = p_voyage_id RETURNING voyage_id INTO v_deleted;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'A viagem % não está declarada sem veículos.', p_voyage_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage', p_voyage_id::text, 'sem_veiculos', 'declarada', 'desfeita', auth.uid(), v_reason);

  PERFORM public.reconcile_voyage_vehicle_sheet_alerts(p_voyage_id, 'vehicle_declaration');
END;
$function$;

REVOKE ALL ON FUNCTION public.undo_voyage_vehicle_declaration(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_voyage_vehicle_declaration(bigint, text) TO authenticated, service_role;

-- 5 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_vehicle_sheet_alerts_from_vehicles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_arrived bigint[];
  v_touched bigint[];
  v_voyage bigint;
BEGIN
  -- Viagens que ganharam veículo (inserido ou movido para ela) e todas as tocadas.
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.voyage_id) INTO v_arrived FROM new_rows n;
    v_touched := v_arrived;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.voyage_id) INTO v_touched FROM old_rows o;
  ELSE
    SELECT array_agg(DISTINCT n.voyage_id) INTO v_arrived
    FROM new_rows n JOIN old_rows o ON o.id = n.id
    WHERE n.voyage_id IS DISTINCT FROM o.voyage_id;
    SELECT array_agg(DISTINCT x.voyage_id) INTO v_touched
    FROM (
      SELECT n.voyage_id FROM new_rows n JOIN old_rows o ON o.id = n.id WHERE n.voyage_id IS DISTINCT FROM o.voyage_id
      UNION
      SELECT o.voyage_id FROM new_rows n JOIN old_rows o ON o.id = n.id WHERE n.voyage_id IS DISTINCT FROM o.voyage_id
    ) x;
  END IF;

  -- O veículo que chega desfaz a declaração "sem veículos": o fato vale mais.
  FOREACH v_voyage IN ARRAY COALESCE(v_arrived, ARRAY[]::bigint[]) LOOP
    PERFORM 1 FROM public.voyages WHERE id = v_voyage FOR NO KEY UPDATE;
    DELETE FROM public.voyage_vehicle_declarations WHERE voyage_id = v_voyage;
    IF FOUND THEN
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('voyage', v_voyage::text, 'sem_veiculos', 'declarada', 'desfeita', auth.uid(), 'Veículos importados na viagem');
    END IF;
  END LOOP;

  -- Falha do alerta não desfaz a gravação dos veículos: vira WARNING, como em
  -- `_reconcile_voyage_bl_alerts`, e o detector de 15 minutos refaz a conta.
  FOREACH v_voyage IN ARRAY COALESCE(v_touched, ARRAY[]::bigint[]) LOOP
    BEGIN
      PERFORM public.reconcile_voyage_vehicle_sheet_alerts(v_voyage, 'vehicle_change_trigger');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Reconciliação da planilha de Veículos ignorada para a viagem %: %', v_voyage, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_vehicle_sheet_alerts_from_vehicles() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER reconcile_vehicle_sheet_alerts_on_vehicles_insert
  AFTER INSERT ON public.vehicles
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_vehicle_sheet_alerts_from_vehicles();

CREATE TRIGGER reconcile_vehicle_sheet_alerts_on_vehicles_update
  AFTER UPDATE ON public.vehicles
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_vehicle_sheet_alerts_from_vehicles();

CREATE TRIGGER reconcile_vehicle_sheet_alerts_on_vehicles_delete
  AFTER DELETE ON public.vehicles
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.reconcile_vehicle_sheet_alerts_from_vehicles();

-- 4 -------------------------------------------------------------------------
-- Corpo da 346 com a reconciliação da planilha de Veículos no nível viagem.
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

  -- Nível viagem (documentação / BL / Baplie / CE / planilha de Veículos)
  PERFORM public.reconcile_voyage_bl_expected_alerts(p_voyage_id, p_source);
  PERFORM public.reconcile_voyage_baplie_missing_alerts(p_voyage_id, p_source);
  PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, p_source);
  PERFORM public.reconcile_voyage_ce_mercante_missing_alerts(p_voyage_id, p_source);
  PERFORM public.reconcile_voyage_vehicle_sheet_alerts(p_voyage_id, p_source);

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
      WHEN 'voyage_vehicle_sheet_pending' THEN
        PERFORM public.reconcile_voyage_vehicle_sheet_alerts(p_voyage_id, p_source);
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
      -- A própria função guarda a viagem concluída (só o aberto é reavaliado).
      PERFORM public.reconcile_voyage_vehicle_sheet_alerts(v_voyage.id, p_source);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Reconciliação de B/Ls esperados, CE pendente e planilha de Veículos ignorada para a viagem %: %', v_voyage.id, SQLERRM;
    END;
  END LOOP;
END;
$function$;
