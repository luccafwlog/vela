-- 337: a programação de navios exige sessão interna ativa ou do Portal
-- (auditoria defensiva de 2026-10-19, ADR 0090).
--
-- Problema:
--   A migration `320` tirou `anon` de `portal_ship_schedule()`, mas a função
--   seguiu sem guarda de chamador: qualquer conta `authenticated` lia a
--   programação dos navios com `show_on_portal`. O Auth de produção estava
--   com o cadastro aberto (`disable_signup = false`), então qualquer pessoa
--   podia criar uma conta sem perfil interno nem conta do Portal e chamar a
--   função. A ADR 0090 diz que ela só atende sessão do Portal ou interna.
--
-- Mudança:
--   A função passa de `LANGUAGE sql` para `plpgsql` para checar o chamador
--   antes da consulta:
--     - usuário interno ativo (`is_active_read_user()`) lê;
--     - `service_role` lê (o grant da `320` continua valendo; nenhuma Edge
--       Function a chama hoje);
--     - fora disso, `current_portal_customer_id()` exige conta ativa do
--       Portal com credencial não revogada e, se não houver, recusa com
--       "Sessao do portal invalida ou expirada." (28000), o mesmo erro das
--       outras leituras do Portal.
--   A consulta é a vigente (lida do banco recriado com todas as migrations,
--   igual à da `002`); assinatura, retorno e grants não mudam. Numerada 337
--   depois da `336` da `staging` (a 333 dela é outra migration).
--
-- Não reescreve nem apaga linhas.
--
-- Rollback: recriar a função com o corpo `LANGUAGE sql` da migration `002`
-- (volta a atender qualquer conta `authenticated`; exige revisar a ADR 0090).

CREATE OR REPLACE FUNCTION public.portal_ship_schedule()
 RETURNS TABLE(voyage_id bigint, vessel_name text, voyage text, imo_number text, port_code text, kind text, date_value text, actual_value text, omitted boolean)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.is_active_read_user() AND auth.role() IS DISTINCT FROM 'service_role' THEN
    -- Recusa com 28000 quem não tem conta ativa do Portal.
    PERFORM public.current_portal_customer_id();
  END IF;

  RETURN QUERY
  WITH visible AS (
    SELECT v.id, ve.name AS vessel_name, v.voyage_number, ve.imo
    FROM public.voyages v
    JOIN public.vessels ve ON ve.id = v.vessel_id
    WHERE v.show_on_portal AND v.status = 'active'
  ),
  latest AS (
    SELECT DISTINCT ON (a.entity_type, a.entity_id, a.field_name)
      a.entity_type, a.entity_id, a.field_name, a.new_value
    FROM public.audit_logs a
    WHERE a.entity_type IN ('voyage_pol_schedule', 'voyage_pod_schedule')
    ORDER BY a.entity_type, a.entity_id, a.field_name, a.changed_at DESC
  ),
  deleted_pods AS (
    SELECT entity_id FROM latest
    WHERE entity_type = 'voyage_pod_schedule'
      AND field_name = 'deleted' AND new_value = 'true'
  ),
  omitted_pods AS (
    SELECT entity_id FROM latest
    WHERE entity_type = 'voyage_pod_schedule'
      AND field_name = 'omitted' AND new_value = 'true'
  ),
  pol AS (
    SELECT split_part(entity_id, '::', 1)::bigint AS vid,
           split_part(entity_id, '::', 2) AS port_code,
           new_value AS etd
    FROM latest
    WHERE entity_type = 'voyage_pol_schedule'
      AND field_name = 'etd' AND new_value IS NOT NULL
  ),
  pol_atd AS (
    SELECT split_part(entity_id, '::', 1)::bigint AS vid,
           split_part(entity_id, '::', 2) AS port_code,
           new_value AS atd
    FROM latest
    WHERE entity_type = 'voyage_pol_schedule'
      AND field_name = 'atd' AND new_value IS NOT NULL
  ),
  pod AS (
    SELECT split_part(l.entity_id, '::', 1)::bigint AS vid,
           split_part(l.entity_id, '::', 2) AS port_code,
           MAX(l.new_value) FILTER (WHERE l.field_name = 'eta') AS eta,
           (o.entity_id IS NOT NULL) AS omitted
    FROM latest l
    LEFT JOIN deleted_pods d ON d.entity_id = l.entity_id
    LEFT JOIN omitted_pods o ON o.entity_id = l.entity_id
    WHERE l.entity_type = 'voyage_pod_schedule'
      AND d.entity_id IS NULL
      AND (
        (l.field_name = 'eta' AND l.new_value IS NOT NULL)
        OR o.entity_id IS NOT NULL
      )
    GROUP BY l.entity_id, o.entity_id
  ),
  pod_ata AS (
    SELECT split_part(l.entity_id, '::', 1)::bigint AS vid,
           split_part(l.entity_id, '::', 2) AS port_code,
           l.new_value AS ata
    FROM latest l
    LEFT JOIN deleted_pods d ON d.entity_id = l.entity_id
    WHERE l.entity_type = 'voyage_pod_schedule'
      AND l.field_name = 'ata'
      AND l.new_value IS NOT NULL
      AND d.entity_id IS NULL
  )
  SELECT visible.id, visible.vessel_name, visible.voyage_number, visible.imo,
         pol.port_code, 'pol'::text, pol.etd, pol_atd.atd, false
  FROM visible
  JOIN pol ON pol.vid = visible.id
  LEFT JOIN pol_atd ON pol_atd.vid = pol.vid AND pol_atd.port_code = pol.port_code
  UNION ALL
  SELECT visible.id, visible.vessel_name, visible.voyage_number, visible.imo,
         pod.port_code, 'pod'::text, pod.eta, pod_ata.ata, pod.omitted
  FROM visible
  JOIN pod ON pod.vid = visible.id
  LEFT JOIN pod_ata ON pod_ata.vid = pod.vid AND pod_ata.port_code = pod.port_code;
END;
$function$;

-- CREATE OR REPLACE mantém os grants da `320`; reafirmados para a migration
-- valer sozinha contra um catálogo com drift.
REVOKE EXECUTE ON FUNCTION public.portal_ship_schedule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_ship_schedule() TO authenticated, service_role;
