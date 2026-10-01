-- 119: O alerta "CE Mercante pendente" (voyage_ce_mercante_missing) passa a
-- contar também as rotas de Vazios de Importação sem Nº de manifesto Mercante.
-- Vazios vindos do Baplie não pedem o número na importação (decisão de
-- 2026-10-01), mas o número continua obrigatório: a pendência aparece neste
-- alerta, com a mesma janela D-5 do primeiro ETA brasileiro dos B/Ls.
-- Uma rota de vazios está coberta quando há manifesto Mercante natureza
-- 'vazio' na rota, ou CE master legado (voyage_route_ce_master, cargo_mode
-- 'vazios'), o mesmo critério da linha VAZIOS da aba Rotas e Manifestos.
-- Mesma assinatura: CREATE OR REPLACE mantém os grants (só service_role).
-- Não reescreve nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.reconcile_voyage_ce_mercante_missing_alerts(
  p_voyage_id bigint,
  p_source text DEFAULT 'voyage_operation_detector'::text
) RETURNS void
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

  SELECT
    count(*),
    count(*) FILTER (WHERE ce_mercante IS NULL OR btrim(ce_mercante) = '')
  INTO v_total_bls, v_missing_ce_count
  FROM public.bls
  WHERE voyage_id = p_voyage_id
    AND upper(btrim(pod)) IN (SELECT pod FROM public.get_voyage_eligible_pods(p_voyage_id));

  IF v_total_bls = 0 THEN
    v_missing_ce_count := 0;
  END IF;

  SELECT count(*)
  INTO v_missing_vazios_count
  FROM (
    SELECT DISTINCT upper(btrim(c.pol)) AS pol, upper(btrim(c.pod)) AS pod
    FROM public.vazios_importacao_containers c
    JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
    WHERE m.voyage_id = p_voyage_id
      AND NULLIF(btrim(c.pol), '') IS NOT NULL
      AND NULLIF(btrim(c.pod), '') IS NOT NULL
      AND upper(btrim(c.pod)) IN (SELECT pod FROM public.get_voyage_eligible_pods(p_voyage_id))
  ) rota
  WHERE NOT EXISTS (
      SELECT 1 FROM public.manifestos_mercante mm
      WHERE mm.voyage_id = p_voyage_id
        AND mm.natureza = 'vazio'
        AND upper(btrim(mm.pol)) = rota.pol
        AND upper(btrim(mm.pod)) = rota.pod
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.voyage_route_ce_master ce
      WHERE ce.voyage_id = p_voyage_id
        AND lower(ce.cargo_mode) = 'vazios'
        AND NULLIF(btrim(ce.ce_master), '') IS NOT NULL
        AND upper(btrim(ce.pol)) = rota.pol
        AND upper(btrim(ce.pod)) = rota.pod
    );

  IF v_missing_ce_count = 0 AND v_missing_vazios_count = 0 THEN
    PERFORM public.resolve_alert_item('voyage_ce_mercante_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  IF v_missing_ce_count > 0 THEN
    v_parts := v_parts || (v_missing_ce_count || ' B/L(s)');
  END IF;
  IF v_missing_vazios_count > 0 THEN
    v_parts := v_parts || (v_missing_vazios_count || ' rota(s) de vazios sem Nº de manifesto Mercante');
  END IF;

  PERFORM public.upsert_alert_item(
    'voyage_ce_mercante_missing',
    'voyage',
    p_voyage_id::text,
    'CE Mercante pendente para ' || array_to_string(v_parts, ' e ') || ' da viagem ' || p_voyage_id || ' (D-5 atingido)',
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
