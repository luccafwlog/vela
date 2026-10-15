-- 287: indicadores de veículos por viagem agregados no banco.
--
-- Problema (medição local com 14 mil veículos em 200 viagens): a faixa de
-- viagens de Viagens e Veículos baixava todo veículo do histórico, com o
-- contêiner e o POD do B/L embutidos (~1,8 MB em páginas de 1.000), só para
-- contar veículos por viagem, POD, marca e tipo de contêiner e listar os
-- contêineres com veículo. O custo crescia a cada viagem importada.
--
-- Mudança: `operational_voyage_vehicle_stats(p_voyage_ids)` devolve as
-- contagens já agrupadas por viagem, POD, marca e tipo de contêiner, e os
-- contêineres distintos por viagem e POD. Os valores saem como gravados; o
-- navegador normaliza (trim, caixa) e soma como fazia com as linhas, então os
-- indicadores não mudam. Os ids vão no corpo da chamada, sem limite de URL.
-- SECURITY INVOKER: vale a mesma RLS das leituras diretas que ela substitui
-- (o B/L é obrigatório, como no `bls!inner` anterior; o contêiner é opcional).
--
-- Só cria uma função de leitura; não reescreve nem apaga linhas.
-- Rollback: DROP FUNCTION public.operational_voyage_vehicle_stats(bigint[]).

CREATE OR REPLACE FUNCTION public.operational_voyage_vehicle_stats(p_voyage_ids bigint[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH vehicle_rows AS (
  SELECT vh.voyage_id, b.pod, vh.brand, bc.type AS container_type, bc.container_number
  FROM public.vehicles vh
  JOIN public.bls b ON b.id = vh.bl_id
  LEFT JOIN public.bl_containers bc ON bc.id = vh.container_id
  WHERE vh.voyage_id = ANY(coalesce(p_voyage_ids, '{}'::bigint[]))
)
SELECT jsonb_build_object(
  'groups', coalesce((
    SELECT jsonb_agg(jsonb_build_array(voyage_id, pod, brand, container_type, vehicles))
    FROM (
      SELECT voyage_id, pod, brand, container_type, count(*) AS vehicles
      FROM vehicle_rows
      GROUP BY voyage_id, pod, brand, container_type
    ) grouped
  ), '[]'::jsonb),
  'containers', coalesce((
    SELECT jsonb_agg(jsonb_build_array(voyage_id, pod, container_number))
    FROM (
      SELECT DISTINCT voyage_id, pod, container_number
      FROM vehicle_rows
      WHERE container_number IS NOT NULL
    ) distinct_containers
  ), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.operational_voyage_vehicle_stats(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_voyage_vehicle_stats(bigint[]) TO authenticated, service_role;
