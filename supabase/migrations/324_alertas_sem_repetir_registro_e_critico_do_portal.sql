-- 324: mensagens dos alertas sem repetir o registro e "Crítico" do
-- Provisionamento só para alerta crítico (lote 5a da identidade visual,
-- achados A2 e A3, decididos pelo responsável em 2026-10-19).
--
-- Problema:
--   A2. A fila de Alertas mostra, lado a lado, o Alerta (o que é), o Registro
--       (onde: Cliente, B/L, navio e viagem, container) e a Mensagem. Os
--       detectores escreviam na mensagem o próprio registro, às vezes com a
--       chave interna: "Cliente sem_cliente: 2 B/Ls pendentes de vínculo com
--       cliente", "Baplie ausente para a viagem 10 (D-7 atingido)", "ADR
--       BRVIX: departamento ...". E a pendência geral do Portal dizia a mesma
--       frase genérica para todo Cliente, sem dizer o que falta.
--   A3. `portal_list_provisioning_console` marcava `has_critical_alert` para
--       todo alerta do tipo agrupado (`al.type = 'aggregate'`). Os detectores
--       de hoje abrem todos os alertas nesse tipo, os normais inclusive: na
--       base de teste, 7 Clientes apareciam como "Crítico" no
--       Provisionamento e só 1 tinha alerta crítico.
--
-- Mudança:
--   A2. Os detectores abaixo passam a escrever só o detalhe que o Alerta e o
--       Registro não dizem (o prazo, a contagem, o que falta, o terminal),
--       sem o nome do Cliente, o número da viagem ou o porto. A pendência
--       geral do Portal diz o que falta àquele Cliente: sem conta e sem
--       e-mail, conta ainda não ativa, conta suspensa (decisão do responsável
--       em 2026-10-19), conta ativa sem usuário de acesso ou conta ativa sem
--       e-mail utilizável. Contagens no singular ou no plural, sem "(s)".
--       Numerada 324 depois das 321 a 323 da main. Os corpos são os
--       vigentes (lidos do banco recriado com todas as migrations); só as
--       mensagens mudam, e a assinatura e os grants ficam como estão.
--       Os alertas ativos têm o texto reescrito aqui mesmo, para a fila não
--       misturar os dois formatos até a próxima rodada dos detectores.
--   A3. O alerta conta como crítico só pelo item ativo crítico (ou, no alerta
--       antigo sem item, pela gravidade do catálogo) e pelo abuso de login.
--
-- Reescreve linhas existentes (`alert_items.message` e `alerts.message` dos
-- alertas abertos). Depende da afirmação "Data status" do AGENTS.md (seção
-- Gotchas): o banco de produção só tem dados de teste.

CREATE OR REPLACE FUNCTION public.reconcile_voyage_baplie_missing_alerts(p_voyage_id bigint, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_has_baplie BOOLEAN;
BEGIN
  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);

  IF v_first_eta IS NULL OR v_today < (v_first_eta - 7) THEN
    PERFORM public.resolve_alert_item('voyage_baplie_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.baplie_containers WHERE voyage_id = p_voyage_id
  ) INTO v_has_baplie;

  IF v_has_baplie THEN
    PERFORM public.resolve_alert_item('voyage_baplie_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  ELSE
    PERFORM public.upsert_alert_item(
      'voyage_baplie_missing',
      'voyage',
      p_voyage_id::text,
      'Prazo D-7 atingido sem Baplie importado.',
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'first_eta', v_first_eta),
      '/baplie?voyage=' || p_voyage_id
    );
  END IF;
END;
$function$;

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
      AND NULLIF(btrim(bc.container_number), '') IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM (SELECT container_number FROM baplie_reconcilable EXCEPT SELECT container_number FROM bl_cntrs) d1) +
    (SELECT count(*) FROM (SELECT container_number FROM bl_cntrs EXCEPT SELECT container_number FROM baplie_all) d2)
  INTO v_divergence_count;

  IF v_divergence_count > 0 THEN
    PERFORM public.upsert_alert_item(
      'voyage_baplie_documentary_coverage',
      'voyage',
      p_voyage_id::text,
      v_divergence_count || CASE WHEN v_divergence_count = 1 THEN ' container diverge entre o Baplie e os B/Ls.' ELSE ' containers divergem entre o Baplie e os B/Ls.' END,
      p_source,
      jsonb_build_object(
        'voyage_id', p_voyage_id,
        'divergence_count', v_divergence_count,
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
  v_expected_pod_count INTEGER := 0;
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

  -- Contagem de PODs esperados
  SELECT count(*) INTO v_expected_pod_count
  FROM public.get_voyage_eligible_pods(p_voyage_id);

  -- POLs esperados a partir de audit_logs de pol_schedule
  WITH latest_pol_etd AS (
    SELECT DISTINCT ON (entity_id)
      upper(btrim(split_part(entity_id, '::', 2))) AS pol_code,
      NULLIF(btrim(new_value), '') AS etd
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pol_schedule'
      AND entity_id LIKE p_voyage_id || '::%'
      AND field_name = 'etd'
    ORDER BY entity_id, changed_at DESC
  )
  SELECT count(*) INTO v_expected_pol_count
  FROM latest_pol_etd
  WHERE etd IS NOT NULL;

  -- B/Ls atuais da viagem
  SELECT count(*) INTO v_bl_count
  FROM public.bls
  WHERE voyage_id = p_voyage_id;

  IF v_bl_count > 0 THEN
    IF v_expected_pol_count > 0 THEN
      -- POLs ausentes nos B/Ls
      WITH latest_pol_etd AS (
        SELECT DISTINCT ON (entity_id)
          upper(btrim(split_part(entity_id, '::', 2))) AS pol_code,
          NULLIF(btrim(new_value), '') AS etd
        FROM public.audit_logs
        WHERE entity_type = 'voyage_pol_schedule'
          AND entity_id LIKE p_voyage_id || '::%'
          AND field_name = 'etd'
        ORDER BY entity_id, changed_at DESC
      )
      SELECT count(*) INTO v_missing_pol_count
      FROM latest_pol_etd lp
      WHERE lp.etd IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.bls b
          WHERE b.voyage_id = p_voyage_id AND upper(btrim(b.pol)) = lp.pol_code
        );

      -- PODs ausentes nos B/Ls
      SELECT count(*) INTO v_missing_pod_count
      FROM public.get_voyage_eligible_pods(p_voyage_id) ep
      WHERE NOT EXISTS (
        SELECT 1 FROM public.bls b
        WHERE b.voyage_id = p_voyage_id AND upper(btrim(b.pod)) = ep.pod
      );

      v_covered := (v_missing_pol_count = 0 AND v_missing_pod_count = 0);
    ELSE
      -- Sem POLs planejados, cobriu se houver ao menos 1 B/L para cada POD elegível
      SELECT count(*) INTO v_missing_pod_count
      FROM public.get_voyage_eligible_pods(p_voyage_id) ep
      WHERE NOT EXISTS (
        SELECT 1 FROM public.bls b
        WHERE b.voyage_id = p_voyage_id AND upper(btrim(b.pod)) = ep.pod
      );

      v_covered := (v_missing_pod_count = 0);
    END IF;
  ELSE
    v_covered := false;
  END IF;

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

CREATE OR REPLACE FUNCTION public.reconcile_voyage_ce_mercante_missing_alerts(p_voyage_id bigint, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_total_bls INTEGER := 0;
  v_missing_ce_count INTEGER := 0;
  v_missing_vazios_count INTEGER := 0;
  v_parts text[] := ARRAY[]::text[];
BEGIN
  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);

  IF v_first_eta IS NULL OR v_today < (v_first_eta - 5) THEN
    PERFORM public.resolve_alert_item('voyage_ce_mercante_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- B/L, escala, rota de vazios e Manifesto podem guardar o mesmo porto com
  -- nomes diferentes (BRVIT/VITORIA → BRVIX); a 181 grava o Manifesto
  -- normalizado. A comparação usa a forma normalizada dos dois lados.
  SELECT
    count(*),
    count(*) FILTER (WHERE ce_mercante IS NULL OR btrim(ce_mercante) = '')
  INTO v_total_bls, v_missing_ce_count
  FROM public.bls
  WHERE voyage_id = p_voyage_id
    AND cancelled_at IS NULL
    AND COALESCE(public.normalize_port_code(pod), upper(btrim(pod))) IN (
      SELECT COALESCE(public.normalize_port_code(e.pod), e.pod) FROM public.get_voyage_eligible_pods(p_voyage_id) AS e);

  IF v_total_bls = 0 THEN
    v_missing_ce_count := 0;
  END IF;

  SELECT count(*)
  INTO v_missing_vazios_count
  FROM (
    SELECT DISTINCT
      COALESCE(public.normalize_port_code(c.pol), upper(btrim(c.pol))) AS pol,
      COALESCE(public.normalize_port_code(c.pod), upper(btrim(c.pod))) AS pod
    FROM public.vazios_importacao_containers c
    JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
    WHERE m.voyage_id = p_voyage_id
      AND NULLIF(btrim(c.pol), '') IS NOT NULL
      AND NULLIF(btrim(c.pod), '') IS NOT NULL
      AND COALESCE(public.normalize_port_code(c.pod), upper(btrim(c.pod))) IN (
        SELECT COALESCE(public.normalize_port_code(e.pod), e.pod) FROM public.get_voyage_eligible_pods(p_voyage_id) AS e)
  ) rota
  WHERE NOT EXISTS (
      SELECT 1 FROM public.manifestos_mercante mm
      WHERE mm.voyage_id = p_voyage_id
        AND mm.natureza = 'vazio'
        AND COALESCE(public.normalize_port_code(mm.pol), upper(btrim(mm.pol))) = rota.pol
        AND COALESCE(public.normalize_port_code(mm.pod), upper(btrim(mm.pod))) = rota.pod
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.voyage_route_ce_master ce
      WHERE ce.voyage_id = p_voyage_id
        AND lower(ce.cargo_mode) = 'vazios'
        AND NULLIF(btrim(ce.ce_master), '') IS NOT NULL
        AND COALESCE(public.normalize_port_code(ce.pol), upper(btrim(ce.pol))) = rota.pol
        AND COALESCE(public.normalize_port_code(ce.pod), upper(btrim(ce.pod))) = rota.pod
    );

  IF v_missing_ce_count = 0 AND v_missing_vazios_count = 0 THEN
    PERFORM public.resolve_alert_item('voyage_ce_mercante_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  IF v_missing_ce_count > 0 THEN
    v_parts := v_parts || (v_missing_ce_count || CASE WHEN v_missing_ce_count = 1 THEN ' B/L' ELSE ' B/Ls' END);
  END IF;
  IF v_missing_vazios_count > 0 THEN
    v_parts := v_parts || (v_missing_vazios_count || CASE WHEN v_missing_vazios_count = 1 THEN ' rota' ELSE ' rotas' END || ' de vazios sem Nº de manifesto Mercante');
  END IF;

  PERFORM public.upsert_alert_item(
    'voyage_ce_mercante_missing',
    'voyage',
    p_voyage_id::text,
    'Falta para ' || array_to_string(v_parts, ' e ') || '; prazo D-5 atingido.',
    p_source,
    jsonb_build_object(
      'voyage_id', p_voyage_id,
      'missing_ce_count', v_missing_ce_count,
      'missing_vazios_manifest_count', v_missing_vazios_count
    ),
    '/viagens/' || p_voyage_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_voyage_export_after_atd_alerts(p_voyage_id bigint, p_port text, p_terminal_id text, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port_norm TEXT := upper(btrim(p_port));
  v_entity_id TEXT := p_voyage_id || '::' || v_port_norm;
  v_export_rec RECORD;
  v_terminal_atd TIMESTAMPTZ;
  v_terminal_code TEXT;
  v_has_granite_link BOOLEAN := true;
  v_has_empty_link BOOLEAN := true;
BEGIN
  SELECT tem_exportacao, has_granite, has_empty
  INTO v_export_rec
  FROM public.voyage_export_schedules
  WHERE voyage_id = p_voyage_id AND upper(btrim(pol)) = v_port_norm;

  IF NOT FOUND OR NOT COALESCE(v_export_rec.tem_exportacao, false) THEN
    PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_pod_schedule', v_entity_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  SELECT s.terminal_atd, public.voyage_terminal_code(s.terminal_id)
  INTO v_terminal_atd, v_terminal_code
  FROM public.voyage_escala_terminal_state s
  WHERE s.voyage_id = p_voyage_id
    AND s.port = v_port_norm
    AND s.terminal_id::text = p_terminal_id;

  IF v_terminal_atd IS NULL THEN
    PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_pod_schedule', v_entity_id, p_source, '{}'::jsonb);
    RETURN;
  END IF;

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
        'terminal_id', p_terminal_id,
        'terminal_code', v_terminal_code,
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
      PERFORM public.resolve_alert_item('voyage_export_after_atd', 'voyage_escala_terminal', v_term_entity_id, p_source, '{}'::jsonb);
    END LOOP;
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
  FOR v_term_rec IN
    SELECT terminal_id, terminal_etb::date AS terminal_etb,
      terminal_atb::date AS terminal_atb, terminal_etd::date AS terminal_etd,
      terminal_atd::date AS terminal_atd
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

CREATE OR REPLACE FUNCTION public.reconcile_customer_bl_review_alerts(p_customer_id bigint, p_consignee text, p_source text DEFAULT 'bl_review_gate'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'bl_review_gate');
  v_customer_name text;
  v_customer_label text;
  v_entity_id text;
  v_consignee_key text;
  v_portal_ready boolean := false;
  v_portal_held integer := 0;
  v_total_pending integer := 0;
  v_bb_pending integer := 0;
  v_msg text;
BEGIN
  IF p_customer_id IS NOT NULL THEN
    SELECT name INTO v_customer_name FROM public.customers WHERE id = p_customer_id;
    v_customer_label := COALESCE(v_customer_name, 'Cliente #' || p_customer_id::text);
    v_entity_id := p_customer_id::text;

    -- A Liberação de faturamento sem Portal satisfaz o mesmo gate da emissão.
    v_portal_ready := public.customer_billing_access_ready(p_customer_id);
    -- B/Ls cuja fatura o CE reteve por falta de Portal (ADR 0070) contam junto
    -- com os pendentes de revisão: é o que o Portal está segurando.
    SELECT count(*) INTO v_portal_held
    FROM public.bls
    WHERE customer_id = p_customer_id
      AND COALESCE(financial_status, 'pending') = 'pending'
      AND review_status IS DISTINCT FROM 'pending_review'
      AND billing_hold_reason = 'Acesso ao portal nao provisionado'
      AND cancelled_at IS NULL;

    SELECT count(*), count(*) FILTER (
      WHERE cargo_mode IN ('carga_solta', 'misto')
        AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0)
    ) INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id = p_customer_id AND review_status = 'pending_review'
      AND cancelled_at IS NULL;

    -- Desde a 085 o e-mail de contato não é condição de faturamento: a fatura
    -- não é enviada por e-mail. O tipo foi aposentado; só fecha item antigo.
    PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);

    IF v_total_pending + v_portal_held > 0 AND NOT v_portal_ready THEN
      v_msg := (v_total_pending + v_portal_held) ||
        CASE WHEN v_total_pending + v_portal_held = 1 THEN ' B/L parado na Revisão: Portal sem conta.'
             ELSE ' B/Ls parados na Revisão: Portal sem conta.' END;
      PERFORM public.upsert_alert_item(
        'review_portal_not_ready', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_total_pending, 'held_count', v_portal_held),
        '/clientes/portal?cliente=' || p_customer_id::text
      );
    ELSE
      PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    IF v_bb_pending > 0 THEN
      v_msg := v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L parado na Revisão: falta o peso BB.'
             ELSE ' B/Ls parados na Revisão: falta o peso BB.' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('customer_id', p_customer_id, 'pending_count', v_bb_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;
    PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);
  ELSE
    v_consignee_key := COALESCE(NULLIF(btrim(p_consignee), ''), 'sem_cliente');
    v_entity_id := v_consignee_key;

    SELECT count(*), count(*) FILTER (
      WHERE cargo_mode IN ('carga_solta', 'misto')
        AND (bb_weight_ton IS NULL OR bb_weight_ton <= 0)
    ) INTO v_total_pending, v_bb_pending
    FROM public.bls
    WHERE customer_id IS NULL
      AND review_status = 'pending_review'
      AND COALESCE(NULLIF(btrim(consignee), ''), 'sem_cliente') = v_consignee_key
      AND cancelled_at IS NULL;

    IF v_total_pending > 0 THEN
      v_msg := v_total_pending ||
        CASE WHEN v_total_pending = 1 THEN ' B/L aguarda vínculo com Cliente.'
             ELSE ' B/Ls aguardam vínculo com Cliente.' END;
      PERFORM public.upsert_alert_item(
        'review_customer_unlinked', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_total_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_customer_unlinked', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;

    IF v_bb_pending > 0 THEN
      v_msg := v_bb_pending ||
        CASE WHEN v_bb_pending = 1 THEN ' B/L parado na Revisão: falta o peso BB.'
             ELSE ' B/Ls parados na Revisão: falta o peso BB.' END;
      PERFORM public.upsert_alert_item(
        'review_breakbulk_weight_missing', 'customer', v_entity_id, v_msg, v_source,
        jsonb_build_object('consignee', v_consignee_key, 'pending_count', v_bb_pending), '/revisao'
      );
    ELSE
      PERFORM public.resolve_alert_item('review_breakbulk_weight_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    END IF;
    PERFORM public.resolve_alert_item('review_customer_email_missing', 'customer', v_entity_id, v_source, '{}'::jsonb);
    PERFORM public.resolve_alert_item('review_portal_not_ready', 'customer', v_entity_id, v_source, '{}'::jsonb);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_granite_bl_review_alerts(p_granite_bl_id bigint, p_source text DEFAULT 'granite_review_gate'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gbl public.granite_bls%ROWTYPE;
  v_source TEXT := COALESCE(NULLIF(btrim(p_source), ''), 'granite_review_gate');
BEGIN
  SELECT * INTO v_gbl FROM public.granite_bls WHERE id = p_granite_bl_id;
  IF NOT FOUND THEN
    PERFORM public.resolve_alert_item('review_granite_customer_unlinked', 'granite_bl', p_granite_bl_id::TEXT, 'granite_bl_deleted', '{}'::jsonb);
    RETURN;
  END IF;

  IF v_gbl.client_id IS NULL THEN
    PERFORM public.upsert_alert_item(
      'review_granite_customer_unlinked', 'granite_bl', v_gbl.id::TEXT,
      'Vincule o Cliente na Revisão.',
      v_source,
      jsonb_build_object('granite_bl_id', v_gbl.id, 'bl_number', v_gbl.bl_number),
      '/revisao'
    );
  ELSE
    PERFORM public.resolve_alert_item('review_granite_customer_unlinked', 'granite_bl', v_gbl.id::TEXT, 'granite_review_resolved', '{}'::jsonb);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_granite_bl_review_alerts(p_granite_bl_id uuid, p_source text DEFAULT 'granite_review_gate'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gbl public.granite_bls%ROWTYPE;
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'granite_review_gate');
BEGIN
  SELECT * INTO v_gbl
  FROM public.granite_bls
  WHERE id = p_granite_bl_id;

  IF NOT FOUND THEN
    PERFORM public.resolve_alert_item(
      'review_granite_customer_unlinked', 'granite_bl', p_granite_bl_id::text,
      'granite_bl_deleted', '{}'::jsonb
    );
    RETURN;
  END IF;

  IF v_gbl.client_id IS NULL THEN
    PERFORM public.upsert_alert_item(
      'review_granite_customer_unlinked', 'granite_bl', v_gbl.id::text,
      'Vincule o Cliente na Revisão.',
      v_source,
      jsonb_build_object('granite_bl_id', v_gbl.id, 'bl_number', v_gbl.bl_number),
      '/revisao'
    );
  ELSE
    PERFORM public.resolve_alert_item(
      'review_granite_customer_unlinked', 'granite_bl', v_gbl.id::text,
      'granite_review_resolved', '{}'::jsonb
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_client_portal_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer RECORD;
  v_account public.customer_portal_accounts%ROWTYPE;
  v_active_process BOOLEAN;
  v_gate_ok BOOLEAN;
  v_email_ok BOOLEAN;
  v_result JSONB := '{}'::jsonb;
  v_count INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  FOR v_customer IN
    SELECT c.id, c.name,
           EXISTS (SELECT 1 FROM public.bls b WHERE b.customer_id = c.id AND b.financial_status IS DISTINCT FROM 'cancelled') AS active_process,
           a.id AS account_id, a.active, a.account_situation, a.auth_user_id, a.recovery_email, a.recovery_email_status
    FROM public.customers c
    LEFT JOIN public.customer_portal_accounts a ON a.customer_id = c.id
    ORDER BY c.id
  LOOP
    v_active_process := v_customer.active_process;
    v_account.id := v_customer.account_id;
    v_account.active := v_customer.active;
    v_account.account_situation := v_customer.account_situation;
    v_account.auth_user_id := v_customer.auth_user_id;
    v_account.recovery_email := v_customer.recovery_email;
    v_account.recovery_email_status := v_customer.recovery_email_status;
    v_gate_ok := false;
    v_email_ok := false;
    IF v_account.id IS NOT NULL THEN
      v_email_ok := lower(COALESCE(v_account.recovery_email, '')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
        AND COALESCE(v_account.recovery_email_status, 'ok') = 'ok'
        AND NOT EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE lower(s.email) = lower(v_account.recovery_email));
      v_gate_ok := v_account.active
        AND v_account.account_situation = 'ativo'
        AND v_account.auth_user_id IS NOT NULL
        AND v_email_ok;
    END IF;

    IF v_active_process AND NOT v_gate_ok THEN
      PERFORM public.block521_upsert_alert(
        'portal_pendencia_geral', 'customer', v_customer.id::text,
        CASE
          WHEN v_account.account_situation = 'suspenso' THEN 'Conta do Portal suspensa.'
          WHEN v_account.id IS NULL OR v_account.account_situation IS DISTINCT FROM 'ativo' THEN
            CASE WHEN NULLIF(btrim(COALESCE(v_account.recovery_email, '')), '') IS NULL
              THEN 'Sem conta no Portal e sem e-mail de recuperação.'
              ELSE 'Conta do Portal ainda não ativa.' END
          WHEN v_email_ok THEN 'Conta ativa sem usuário de acesso ao Portal.'
          ELSE 'Conta ativa sem e-mail de recuperação utilizável.'
        END,
        'portal_reconciliation',
        'documentacao',
        jsonb_build_object('customer_id', v_customer.id, 'active_process', true),
        '/clientes/portal?cliente=' || v_customer.id
      );
    ELSE
      PERFORM public.block521_resolve_alert('portal_pendencia_geral', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;

    IF v_active_process AND v_account.id IS NOT NULL AND v_account.account_situation = 'convite_expirado' THEN
      PERFORM public.block521_upsert_alert('portal_convite_expirado', 'customer', v_customer.id::text, 'Convite do Portal expirado; reenvie o convite.', 'portal_reconciliation', 'documentacao', jsonb_build_object('customer_id', v_customer.id), '/clientes/portal?cliente=' || v_customer.id);
    ELSE
      PERFORM public.block521_resolve_alert('portal_convite_expirado', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;

    IF v_active_process AND v_account.id IS NOT NULL AND v_account.account_situation = 'falha_no_envio' THEN
      PERFORM public.block521_upsert_alert('portal_falha_envio', 'customer', v_customer.id::text, 'Falha no envio do convite do Portal; revise o email e reenvie.', 'portal_reconciliation', 'documentacao', jsonb_build_object('customer_id', v_customer.id), '/clientes/portal?cliente=' || v_customer.id);
    ELSE
      PERFORM public.block521_resolve_alert('portal_falha_envio', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;

    IF v_active_process AND v_account.id IS NOT NULL AND (COALESCE(v_account.recovery_email_status, 'ok') <> 'ok' OR EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE lower(s.email) = lower(v_account.recovery_email))) THEN
      PERFORM public.block521_upsert_alert('portal_email_suprimido', 'customer', v_customer.id::text, 'Email de recuperação suprimido; escolha e confirme um endereço utilizável.', 'portal_reconciliation', 'documentacao', jsonb_build_object('customer_id', v_customer.id, 'email', v_account.recovery_email), '/clientes/portal?cliente=' || v_customer.id);
    ELSE
      PERFORM public.block521_resolve_alert('portal_email_suprimido', 'customer', v_customer.id::text, 'documentacao', 'portal_reconciliation');
    END IF;
    v_count := v_count + 1;
  END LOOP;
  v_result := jsonb_build_object('customers_scanned', v_count, 'reconciled_at', now());
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_agency_report_alerts_for_scale(p_voyage_id bigint, p_port text, p_atd date, p_pending_eligible boolean, p_deadline_eligible boolean, p_omitted boolean DEFAULT false, p_deleted boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_department TEXT;
  v_pending BOOLEAN;
  v_deadline_missed BOOLEAN;
  -- Caminho legado: o ATD é uma data, que vale 00:00 de Brasília.
  v_deadline_at TIMESTAMPTZ := (p_atd::timestamp AT TIME ZONE 'America/Sao_Paulo') + interval '72 hours';
  v_deadline DATE := (v_deadline_at AT TIME ZONE 'America/Sao_Paulo')::date;
  v_entity_id TEXT := public.agency_report_alert_entity_key(p_voyage_id, p_port);
  v_metadata JSONB;
  v_message TEXT;
  v_upsert_result JSONB;
  v_changed INTEGER := 0;
  v_created INTEGER := 0;
BEGIN
  IF NOT public.alert_actor_is_authorized() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF upper(btrim(p_port)) NOT LIKE 'BR%' THEN
    RETURN jsonb_build_object('entity_id', v_entity_id, 'created', 0, 'changed', 0);
  END IF;

  FOR v_department IN SELECT unnest(ARRAY['operacoes', 'documentacao', 'equipamentos'])
  LOOP
    v_metadata := jsonb_build_object(
      'report_id', NULL,
      'voyage_id', p_voyage_id,
      'port', upper(btrim(p_port)),
      'terminal_code', NULL,
      'department', v_department,
      'deadline_date', v_deadline,
      'deadline_at', v_deadline_at
    );
    v_message := 'Departamento ' || public.agency_report_department_label(v_department) || ' pendente.';
    v_pending := p_pending_eligible AND NOT p_omitted AND NOT p_deleted;
    IF v_pending THEN
      v_upsert_result := public.upsert_alert_item(
        'agency_report_department_pending', 'agency_departure_report', v_entity_id,
        v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens'
      );
      IF COALESCE((v_upsert_result->>'created')::BOOLEAN, false)
         OR COALESCE((v_upsert_result->>'reopened')::BOOLEAN, false) THEN
        v_changed := v_changed + 1;
        v_created := v_created + 1;
      END IF;
    ELSE
      IF public.resolve_alert_item_for_department(
        'agency_report_department_pending', 'agency_departure_report', v_entity_id,
        v_department, 'agency_report_reconcile', v_metadata
      ) THEN
        v_changed := v_changed + 1;
      END IF;
    END IF;

    v_deadline_missed := p_deadline_eligible AND NOT p_omitted AND NOT p_deleted
      AND v_deadline_at < now();
    v_message := 'Prazo de conclusão vencido para o departamento ' || public.agency_report_department_label(v_department) || '.';
    IF v_deadline_missed THEN
      v_upsert_result := public.upsert_alert_item(
        'agency_report_deadline_missed', 'agency_departure_report', v_entity_id,
        v_message, 'agency_report_reconcile', v_department, v_metadata, '/viagens'
      );
      IF COALESCE((v_upsert_result->>'created')::BOOLEAN, false)
         OR COALESCE((v_upsert_result->>'reopened')::BOOLEAN, false) THEN
        v_changed := v_changed + 1;
        v_created := v_created + 1;
      END IF;
    ELSE
      IF public.resolve_alert_item_for_department(
        'agency_report_deadline_missed', 'agency_departure_report', v_entity_id,
        v_department, 'agency_report_reconcile', v_metadata
      ) THEN
        v_changed := v_changed + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('entity_id', v_entity_id, 'created', v_created, 'changed', v_changed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_list_provisioning_console(p_customer_id bigint DEFAULT NULL::bigint)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_full_access BOOLEAN := v_role IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos');
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  PERFORM public.portal_repair_missing_accounts();

  RETURN QUERY
  SELECT jsonb_build_object(
    'account_id', a.id,
    'customer_id', c.id,
    'customer_name', c.name,
    'cnpj_cpf', c.cnpj_cpf,
    'provisioning_decision', a.provisioning_decision,
    'account_situation', CASE
      WHEN a.account_situation = 'convite_pendente' AND pi.expires_at < now()
        THEN 'convite_expirado'
      ELSE a.account_situation
    END,
    'recovery_email', CASE WHEN v_full_access THEN a.recovery_email ELSE NULL END,
    'recovery_email_source', CASE WHEN v_full_access THEN a.recovery_email_source ELSE NULL END,
    'pending_invite_expires_at', pi.expires_at,
    'latest_delivery_status', CASE WHEN v_full_access THEN CASE WHEN ea.status = 'aceito' AND ea.provider_message_id IS NULL THEN 'nao_confirmado' ELSE ea.status END ELSE NULL END,
    'exception_reason', NULL,
    'last_event_at', ev.created_at,
    'has_critical_alert', EXISTS (
      SELECT 1
      FROM public.alerts al
      LEFT JOIN public.alert_items ai ON ai.alert_id = al.id AND ai.status = 'active'
      WHERE al.status <> 'closed'
        AND (
          (al.entity_type = 'customer' AND al.entity_id = c.id::text)
          OR (al.entity_type = 'bl' AND EXISTS (
            SELECT 1
            FROM public.bls cb
            WHERE cb.id = al.entity_id AND cb.customer_id = c.id
          ))
        )
        AND (
          ai.severity = 'critical'
          OR (al.type <> 'aggregate' AND EXISTS (
            SELECT 1 FROM public.alert_type_catalog ct
            WHERE ct.type = al.type AND ct.severity = 'critical'
          ))
          OR al.type = 'portal_abuso_login'
        )
    ),
    'has_open_invoice', EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.customer_id = c.id
        AND i.status IN ('issued', 'overdue', 'partially_paid')
    ),
    'has_active_process', EXISTS (
      SELECT 1
      FROM public.bls b
      WHERE b.customer_id = c.id
        AND b.financial_status IS DISTINCT FROM 'cancelled'
    ),
    -- A fila precisa expor qualquer contato ativo com e-mail. Para contatos
    -- do modelo novo sem purpose, `geral` é somente o rótulo de compatibilidade
    -- da API; elegibilidade e roteamento continuam nas caixas canônicas.
    'candidates', CASE WHEN v_full_access THEN COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'email', cc.email,
          'purpose', COALESCE(cc.purpose, 'geral'),
          'origin', 'Contato do Cliente'
        ) ORDER BY cc.id
      )
      FROM public.customer_contacts cc
      WHERE cc.customer_id = c.id
        AND cc.deactivated_at IS NULL
        AND cc.email_normalized IS NOT NULL
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'recovery_email_status', CASE WHEN v_full_access THEN a.recovery_email_status ELSE NULL END,
    'recovery_email_suppressed', CASE
      WHEN v_full_access AND a.recovery_email IS NOT NULL THEN EXISTS (
        SELECT 1
        FROM public.portal_suppressed_emails s
        WHERE s.email = lower(a.recovery_email)
      )
      ELSE false
    END,
    'shared_email_count', CASE
      WHEN v_full_access AND a.recovery_email IS NOT NULL THEN (
        SELECT count(*)
        FROM public.customer_portal_accounts other
        WHERE lower(other.recovery_email) = lower(a.recovery_email)
          AND other.id <> a.id
      )
      ELSE 0
    END
  )
  FROM public.customer_portal_accounts a
  JOIN public.customers c ON c.id = a.customer_id
  LEFT JOIN LATERAL (
    SELECT expires_at
    FROM public.portal_invites
    WHERE account_id = a.id
      AND purpose = 'convite'
      AND status = 'pendente'
    ORDER BY created_at DESC
    LIMIT 1
  ) pi ON true
  LEFT JOIN LATERAL (
    SELECT status, provider_message_id
    FROM public.portal_email_attempts
    WHERE account_id = a.id
    ORDER BY created_at DESC
    LIMIT 1
  ) ea ON true
  LEFT JOIN LATERAL (
    SELECT created_at
    FROM public.portal_provisioning_events
    WHERE customer_id = c.id
    ORDER BY created_at DESC
    LIMIT 1
  ) ev ON true
  WHERE p_customer_id IS NULL OR c.id = p_customer_id
  ORDER BY c.name;
END;
$function$;

-- Reescreve os alertas abertos no formato novo. A ordem importa: o singular
-- vem antes do plural, e cada padrão só casa com o texto antigo.
DO $$
DECLARE
  v_rule RECORD;
BEGIN
  FOR v_rule IN
    SELECT * FROM (VALUES
      (1, '^Baplie ausente para a viagem [0-9]+ \(D-7 atingido\)$', 'Prazo D-7 atingido sem Baplie importado.'),
      (2, '^Divergência Baplie/BL: 1 container\(s\) divergente\(s\) na viagem [0-9]+$', '1 container diverge entre o Baplie e os B/Ls.'),
      (3, '^Divergência Baplie/BL: ([0-9]+) container\(s\) divergente\(s\) na viagem [0-9]+$', '\1 containers divergem entre o Baplie e os B/Ls.'),
      (4, '^B/Ls esperados pendentes para a viagem [0-9]+ \(D-7 atingido\)$', 'Prazo D-7 atingido sem os B/Ls esperados.'),
      (5, '^CE Mercante pendente para (.+) da viagem [0-9]+ \(D-5 atingido\)$', 'Falta para \1; prazo D-5 atingido.'),
      -- O texto antigo contava com "(s)"; o novo diz o singular ou o plural.
      (6, '^Falta para 1 B/L\(s\)', 'Falta para 1 B/L'),
      (7, '^Falta para ([0-9]+) B/L\(s\)', 'Falta para \1 B/Ls'),
      (8, '^(Falta para |.* e )1 rota\(s\) de vazios', '\11 rota de vazios'),
      (9, '^(Falta para |.* e )([0-9]+) rota\(s\) de vazios', '\1\2 rotas de vazios'),
      (10, '^Exportação pendente de vínculo após saída/ATD no terminal para a escala .+$', 'Saída (ATD) registrada no terminal sem a exportação vinculada.'),
      (11, '^ATA pendente para escala [^ ]+ \(ETA ([0-9/]+) atingido\)$', 'ETA de \1 passou sem ATA registrada.'),
      (12, '^ETB pendente para escala [^ ]+ \(ATA informada\)$', 'ATA registrada; falta o ETB.'),
      (13, '^Cliente .+: 1 B/L pendente \(Conta de Portal não provisionada\)$', '1 B/L parado na Revisão: Portal sem conta.'),
      (14, '^Cliente .+: ([0-9]+) B/Ls pendentes \(Conta de Portal não provisionada\)$', '\1 B/Ls parados na Revisão: Portal sem conta.'),
      (15, '^Cliente .+: 1 B/L pendente de revisão \(peso BB ausente\)$', '1 B/L parado na Revisão: falta o peso BB.'),
      (16, '^Cliente .+: ([0-9]+) B/Ls pendentes de revisão \(peso BB ausente\)$', '\1 B/Ls parados na Revisão: falta o peso BB.'),
      (17, '^Cliente .+: 1 B/L pendente de vínculo com cliente$', '1 B/L aguarda vínculo com Cliente.'),
      (18, '^Cliente .+: ([0-9]+) B/Ls pendentes de vínculo com cliente$', '\1 B/Ls aguardam vínculo com Cliente.'),
      (19, '^Cliente não vinculado ao Granito B/L .+$', 'Vincule o Cliente na Revisão.'),
      (20, '^ADR [^:]+: departamento "(.+)" pendente\.$', 'Departamento \1 pendente.'),
      (21, '^ADR [^:]+: prazo de conclusão vencido para "(.+)"\.$', 'Prazo de conclusão vencido para o departamento \1.')
    ) AS r(position, pattern, replacement)
    ORDER BY position
  LOOP
    UPDATE public.alert_items
    SET message = regexp_replace(message, v_rule.pattern, v_rule.replacement), updated_at = now()
    WHERE status = 'active' AND message ~ v_rule.pattern;

    UPDATE public.alerts
    SET message = regexp_replace(message, v_rule.pattern, v_rule.replacement)
    WHERE status <> 'closed' AND message ~ v_rule.pattern;
  END LOOP;
END;
$$;

-- As três datas de terminal levam o código do terminal, que o texto antigo
-- não tinha: vem do terceiro segmento da chave da atracação.
UPDATE public.alert_items i
SET message = 'Terminal ' || split_part(a.entity_id, '::', 3) || ': ETB de '
      || substring(i.message from '\(ETB ([0-9/]+) atingido\)') || ' passou sem ATB registrada.',
    updated_at = now()
FROM public.alerts a
WHERE a.id = i.alert_id AND i.status = 'active'
  AND i.message ~ '^ATB pendente no terminal para a escala [^ ]+ \(ETB [0-9/]+ atingido\)$';

UPDATE public.alert_items i
SET message = 'Terminal ' || split_part(a.entity_id, '::', 3) || ': ATB registrada; falta o ETD.',
    updated_at = now()
FROM public.alerts a
WHERE a.id = i.alert_id AND i.status = 'active'
  AND i.message ~ '^ETD pendente no terminal para a escala [^ ]+ \(ATB informada\)$';

UPDATE public.alert_items i
SET message = 'Terminal ' || split_part(a.entity_id, '::', 3) || ': ETD de '
      || substring(i.message from '\(ETD ([0-9/]+) atingido\)') || ' passou sem ATD registrada.',
    updated_at = now()
FROM public.alerts a
WHERE a.id = i.alert_id AND i.status = 'active'
  AND i.message ~ '^ATD pendente no terminal para a escala [^ ]+ \(ETD [0-9/]+ atingido\)$';

-- Pendência geral do Portal: o que falta àquele Cliente, pela conta de hoje.
-- Mesma escolha de texto de reconcile_client_portal_alerts acima.
UPDATE public.alert_items i
SET message = CASE
      WHEN pa.account_situation = 'suspenso' THEN 'Conta do Portal suspensa.'
      WHEN pa.id IS NULL OR pa.account_situation IS DISTINCT FROM 'ativo' THEN
        CASE WHEN NULLIF(btrim(COALESCE(pa.recovery_email, '')), '') IS NULL
          THEN 'Sem conta no Portal e sem e-mail de recuperação.'
          ELSE 'Conta do Portal ainda não ativa.' END
      WHEN lower(COALESCE(pa.recovery_email, '')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
        AND COALESCE(pa.recovery_email_status, 'ok') = 'ok'
        AND NOT EXISTS (SELECT 1 FROM public.portal_suppressed_emails s WHERE lower(s.email) = lower(pa.recovery_email))
        THEN 'Conta ativa sem usuário de acesso ao Portal.'
      ELSE 'Conta ativa sem e-mail de recuperação utilizável.'
    END,
    updated_at = now()
FROM public.alerts a
LEFT JOIN public.customer_portal_accounts pa ON a.entity_id ~ '^[0-9]+$' AND pa.customer_id = a.entity_id::bigint
WHERE a.id = i.alert_id AND i.status = 'active'
  AND i.item_type = 'portal_pendencia_geral'
  AND i.message = 'Cliente com processo ativo sem Portal ativo ou sem email de recuperação utilizável.';
