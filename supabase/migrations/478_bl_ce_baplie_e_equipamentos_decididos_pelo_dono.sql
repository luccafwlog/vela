-- 478: B/L, Revisão, CE Mercante, Baplie e Equipamentos (decisões do dono de
-- 2026-10-27, lote 10 do plano de correções).
--
-- Problema e mudança, por seção:
--   1. 04-ce-baplie:CEB-D01 — Mover vinculava ao Manifesto Mercante um B/L sem
--      CE. `move_bls_to_manifesto_mercante` recusa (ADR 0095, decisão 19).
--   2. CEB-D04 — o alerta "Cobertura Baplie / B/L" contava containers e rotas
--      de B/L cancelado e não se recalculava ao cancelar. Ignora o B/L
--      cancelado e recalcula quando o B/L é cancelado ou reativado.
--   3. CEB-D13 (opção B) — container que o B/L declara cheio e o Baplie traz
--      vazio aparecia como "fora do Baplie". Vira divergência própria
--      "cheio no B/L, vazio no Baplie", no alerta (contagem à parte na
--      mensagem) e na tela Baplie EDI.
--   4. 05-equipamentos:EQU-D7 — a planilha de datas aceitava a linha de B/L
--      cancelado e levava a data aos outros B/Ls do container. Recusa com
--      "B/L … cancelado: somente leitura. Reative para corrigir.".
--   5. EQU-D11 — Viagem cancelada ainda aceitava a natureza do vazio (Cama,
--      Cover plate) e as linhas de serviço do Embarque. As duas gravações
--      ganham a trava da Viagem cancelada.
--
-- Rollback: reaplicar `move_bls_to_manifesto_mercante` da `209`,
-- `reconcile_voyage_baplie_coverage_alerts` da `324`,
-- `reconcile_baplie_coverage_from_updated_bls` da `002`,
-- `apply_container_dates_atomic` da `179`, e remover os gatilhos
-- `trg_guard_voyage_cancelled_vazios_importacao_containers` e
-- `trg_guard_voyage_cancelled_vazios_export_service_lines`.

-- 1. B/L sem CE não entra em Manifesto Mercante ---------------------------

CREATE OR REPLACE FUNCTION public.move_bls_to_manifesto_mercante(p_bl_ids text[], p_numero text, p_reason text, p_expected jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_numero text := public.canonical_manifesto_numero(p_numero);
  v_ids text[];
  v_route record;
  v_routes integer;
  v_target public.manifestos_mercante%ROWTYPE;
  v_created boolean := false;
  v_moved integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da mudança de Manifesto Mercante.' USING ERRCODE = '22023';
  END IF;
  IF v_numero IS NULL OR v_numero !~ '^[A-Z0-9]{13}$' THEN
    RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_numero
      USING ERRCODE = 'P0012';
  END IF;

  v_ids := public._lock_bls_for_manifesto(p_bl_ids);
  -- 478 (CEB-D01): o B/L fica no Manifesto Mercante só com CE (ADR 0095, decisão 19).
  IF EXISTS (SELECT 1 FROM public.bls AS b WHERE b.id = ANY(v_ids) AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'B/L sem CE Mercante não entra em Manifesto: %. O CE entra pela planilha de CE Mercante, que também vincula o Manifesto.',
      (SELECT string_agg(b.id, ', ' ORDER BY b.id) FROM public.bls AS b WHERE b.id = ANY(v_ids) AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL)
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._check_expected_manifestos(v_ids, p_expected);
  SELECT count(DISTINCT (b.voyage_id, public.normalize_port_code(b.pol), public.normalize_port_code(b.pod))) INTO v_routes
  FROM public.bls AS b WHERE b.id = ANY(v_ids);
  IF v_routes > 1 THEN
    RAISE EXCEPTION 'Os B/Ls selecionados são de mais de uma viagem ou rota (POL → POD); um Manifesto tem uma única rota.' USING ERRCODE = '22023';
  END IF;
  SELECT b.voyage_id, btrim(b.pol) AS pol, btrim(b.pod) AS pod INTO v_route FROM public.bls AS b WHERE b.id = ANY(v_ids) LIMIT 1;
  IF NULLIF(v_route.pol, '') IS NULL OR NULLIF(v_route.pod, '') IS NULL THEN
    RAISE EXCEPTION 'Os B/Ls selecionados não têm POL e POD cadastrados; sem rota não há Manifesto.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target FROM public.manifestos_mercante WHERE numero = v_numero;
  v_created := NOT FOUND;
  PERFORM public._upsert_route_manifesto(v_route.voyage_id, v_route.pol, v_route.pod, 'carga', v_numero);
  SELECT * INTO v_target FROM public.manifestos_mercante WHERE numero = v_numero;
  IF v_created THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', v_route.voyage_id::text, 'manifesto_mercante_created', NULL, v_numero, v_actor, v_reason);
  END IF;

  v_moved := public._link_bls_to_manifesto(v_ids, v_target.id, v_actor, v_reason);
  RETURN jsonb_build_object(
    'manifesto_mercante_id', v_target.id, 'numero', v_numero, 'created', v_created,
    'moved', v_moved, 'unchanged', cardinality(v_ids) - v_moved);
END;
$function$;

-- 2 e 3. Cobertura Baplie / B/L sem B/L cancelado, com "cheio no B/L, vazio no Baplie"

CREATE OR REPLACE FUNCTION public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id bigint, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_is_d7 BOOLEAN;
  v_has_baplie BOOLEAN;
  v_covered_route_count INTEGER := 0;
  v_pending_route_count INTEGER := 0;
  v_divergence_count INTEGER := 0;
  v_empty_count INTEGER := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.baplie_containers WHERE voyage_id = p_voyage_id
  ) INTO v_has_baplie;

  IF NOT v_has_baplie THEN
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);
  v_is_d7 := (v_first_eta IS NOT NULL AND v_today >= (v_first_eta - 7));

  WITH edi_routes AS (
    SELECT DISTINCT public.normalize_port_code(pol) AS pol, public.normalize_port_code(pod) AS pod
    FROM public.baplie_containers
    WHERE voyage_id = p_voyage_id
      AND pol IS NOT NULL AND pod IS NOT NULL
      AND COALESCE(status, '') <> 'empty'
  ),
  bl_routes AS (
    SELECT DISTINCT public.normalize_port_code(b.pol) AS pol, public.normalize_port_code(b.pod) AS pod
    FROM public.bls b
    WHERE b.voyage_id = p_voyage_id
      AND b.cancelled_at IS NULL
      AND b.pol IS NOT NULL AND b.pod IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.bl_containers bc
        WHERE bc.bl_id = b.id
          AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
      )
  ),
  valid_edi AS (
    SELECT pol, pod FROM edi_routes WHERE pol IS NOT NULL AND pod IS NOT NULL
  ),
  valid_bl AS (
    SELECT pol, pod FROM bl_routes WHERE pol IS NOT NULL AND pod IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM (SELECT pol, pod FROM valid_edi INTERSECT SELECT pol, pod FROM valid_bl) covered),
    (SELECT count(*) FROM (SELECT pol, pod FROM valid_edi EXCEPT SELECT pol, pod FROM valid_bl) pending)
  INTO v_covered_route_count, v_pending_route_count;

  IF v_covered_route_count = 0 AND v_pending_route_count > 0 AND NOT v_is_d7 THEN
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  WITH pending_routes AS (
    SELECT pol, pod FROM (
      SELECT DISTINCT public.normalize_port_code(pol) AS pol, public.normalize_port_code(pod) AS pod
      FROM public.baplie_containers
      WHERE voyage_id = p_voyage_id
        AND pol IS NOT NULL AND pod IS NOT NULL
        AND COALESCE(status, '') <> 'empty'
      EXCEPT
      SELECT DISTINCT public.normalize_port_code(b.pol) AS pol, public.normalize_port_code(b.pod) AS pod
      FROM public.bls b
      WHERE b.voyage_id = p_voyage_id
        AND b.cancelled_at IS NULL
        AND b.pol IS NOT NULL AND b.pod IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.bl_containers bc
          WHERE bc.bl_id = b.id
            AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
        )
    ) missing
    WHERE pol IS NOT NULL AND pod IS NOT NULL
      AND NOT v_is_d7
  ),
  baplie_full AS (
    SELECT
      regexp_replace(upper(btrim(container_number)), '\s+', '', 'g') AS container_number,
      public.normalize_port_code(pol) AS pol,
      public.normalize_port_code(pod) AS pod
    FROM public.baplie_containers
    WHERE voyage_id = p_voyage_id
      AND COALESCE(status, '') <> 'empty'
      AND NULLIF(btrim(container_number), '') IS NOT NULL
  ),
  baplie_all AS (
    SELECT DISTINCT container_number FROM baplie_full
  ),
  -- 478 (CEB-D13): a bordo, mas vazio no Baplie; divergência própria.
  baplie_empty AS (
    SELECT DISTINCT regexp_replace(upper(btrim(container_number)), '\s+', '', 'g') AS container_number
    FROM public.baplie_containers
    WHERE voyage_id = p_voyage_id
      AND COALESCE(status, '') = 'empty'
      AND NULLIF(btrim(container_number), '') IS NOT NULL
    EXCEPT SELECT container_number FROM baplie_all
  ),
  baplie_reconcilable AS (
    SELECT DISTINCT f.container_number
    FROM baplie_full f
    WHERE NOT EXISTS (
      SELECT 1 FROM pending_routes p
      WHERE p.pol IS NOT DISTINCT FROM f.pol AND p.pod IS NOT DISTINCT FROM f.pod
    )
  ),
  bl_cntrs AS (
    SELECT DISTINCT regexp_replace(upper(btrim(bc.container_number)), '\s+', '', 'g') AS container_number
    FROM public.bl_containers bc
    JOIN public.bls b ON b.id = bc.bl_id
    WHERE b.voyage_id = p_voyage_id
      AND b.cancelled_at IS NULL
      AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM (SELECT container_number FROM baplie_reconcilable EXCEPT SELECT container_number FROM bl_cntrs) d1) +
    (SELECT count(*) FROM (SELECT container_number FROM bl_cntrs EXCEPT SELECT container_number FROM baplie_all) d2),
    (SELECT count(*) FROM (SELECT container_number FROM bl_cntrs INTERSECT SELECT container_number FROM baplie_empty) d3)
  INTO v_divergence_count, v_empty_count;

  IF v_divergence_count > 0 THEN
    PERFORM public.upsert_alert_item(
      'voyage_baplie_documentary_coverage',
      'voyage',
      p_voyage_id::text,
      v_divergence_count || CASE WHEN v_divergence_count = 1 THEN ' container diverge entre o Baplie e os B/Ls' ELSE ' containers divergem entre o Baplie e os B/Ls' END
        || CASE WHEN v_empty_count = 0 THEN '.'
                WHEN v_empty_count = 1 THEN ' (1 cheio no B/L, vazio no Baplie).'
                ELSE ' (' || v_empty_count || ' cheios no B/L, vazios no Baplie).' END,
      p_source,
      jsonb_build_object(
        'voyage_id', p_voyage_id,
        'divergence_count', v_divergence_count,
        'empty_in_baplie_count', v_empty_count,
        'covered_route_count', v_covered_route_count,
        'pending_route_count', v_pending_route_count
      ),
      '/baplie?voyage=' || p_voyage_id
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_baplie_documentary_coverage', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_baplie_coverage_from_updated_bls()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_id BIGINT;
BEGIN
  IF current_setting('alerts.baplie_coverage_deferred', true) = 'on' THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  FOR v_voyage_id IN
    SELECT DISTINCT affected.voyage_id
    FROM (
      SELECT n.voyage_id
      FROM changed_rows n
      JOIN old_rows o ON o.id = n.id
      WHERE n.voyage_id IS DISTINCT FROM o.voyage_id
         OR n.pol IS DISTINCT FROM o.pol
         OR n.pod IS DISTINCT FROM o.pod
         OR n.cancelled_at IS DISTINCT FROM o.cancelled_at
      UNION ALL
      SELECT o.voyage_id
      FROM changed_rows n
      JOIN old_rows o ON o.id = n.id
      WHERE n.voyage_id IS DISTINCT FROM o.voyage_id
         OR n.pol IS DISTINCT FROM o.pol
         OR n.pod IS DISTINCT FROM o.pod
         OR n.cancelled_at IS DISTINCT FROM o.cancelled_at
    ) affected
    WHERE affected.voyage_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_trigger');
  END LOOP;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RAISE WARNING 'Reconciliação Baplie/BL ignorada (B/L atualizado): %', SQLERRM;
  RETURN NULL;
END;
$function$;

-- 4. Planilha de datas recusa B/L cancelado -----------------------------------

CREATE OR REPLACE FUNCTION public.apply_container_dates_atomic(p_request_id uuid, p_bl_id text, p_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- 478 (EQU-D7): B/L cancelado é somente leitura (ADR 0094, B4).
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'B/L % cancelado: somente leitura. Reative para corrigir.', p_bl_id USING ERRCODE = '42501';
  END IF;
  PERFORM public._set_import_context('datas de container', (SELECT voyage_id FROM public.bls WHERE id = p_bl_id), NULL);
  RETURN public.apply_container_dates_atomic_legacy_189(p_request_id, p_bl_id, p_rows, p_changed_by);
END $function$;

-- 5. Viagem cancelada trava a natureza do vazio e as linhas de serviço ----------

DROP TRIGGER IF EXISTS trg_guard_voyage_cancelled_vazios_importacao_containers ON public.vazios_importacao_containers;
CREATE TRIGGER trg_guard_voyage_cancelled_vazios_importacao_containers
  BEFORE INSERT OR UPDATE OR DELETE ON public.vazios_importacao_containers
  FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_cancelled_mutation();

CREATE OR REPLACE FUNCTION public.guard_service_line_voyage_cancelled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_id bigint;
BEGIN
  SELECT o.voyage_id INTO v_voyage_id
  FROM public.vazios_export_operations AS o
  WHERE o.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.operation_id ELSE NEW.operation_id END;
  IF v_voyage_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage_id AND status = 'cancelled') THEN
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', v_voyage_id USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_service_line_voyage_cancelled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_voyage_cancelled_vazios_export_service_lines ON public.vazios_export_service_lines;
CREATE TRIGGER trg_guard_voyage_cancelled_vazios_export_service_lines
  BEFORE INSERT OR UPDATE OR DELETE ON public.vazios_export_service_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_service_line_voyage_cancelled();
