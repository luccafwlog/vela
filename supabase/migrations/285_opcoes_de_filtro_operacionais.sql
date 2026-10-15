-- 232: opções dos filtros de B/Ls e Contêineres numa leitura só.
--
-- Problema (medição local com 12 mil B/Ls e 28 mil contêineres): para montar os
-- selects de POL, POD e tipo de contêiner, o navegador baixava todos os B/Ls e
-- todos os contêineres em páginas de 1.000, uma após a outra (13 + 29
-- requisições em série) para ficar com uma dúzia de valores distintos. O custo
-- crescia a cada viagem importada.
--
-- Mudança: `operational_list_filter_options()` devolve os valores distintos já
-- normalizados como o cliente fazia (POL/POD com `btrim`; tipo com
-- `upper(btrim())`). SECURITY INVOKER: vale a mesma RLS das leituras diretas
-- que ela substitui.
--
-- Só cria uma função de leitura; não reescreve nem apaga linhas.
-- Rollback: DROP FUNCTION public.operational_list_filter_options().

CREATE OR REPLACE FUNCTION public.operational_list_filter_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
SELECT jsonb_build_object(
  'pols', coalesce((SELECT jsonb_agg(value) FROM (SELECT DISTINCT btrim(pol) AS value FROM public.bls WHERE nullif(btrim(pol), '') IS NOT NULL) s), '[]'::jsonb),
  'pods', coalesce((SELECT jsonb_agg(value) FROM (SELECT DISTINCT btrim(pod) AS value FROM public.bls WHERE nullif(btrim(pod), '') IS NOT NULL) s), '[]'::jsonb),
  'containerTypes', coalesce((SELECT jsonb_agg(value) FROM (SELECT DISTINCT upper(btrim(type)) AS value FROM public.bl_containers WHERE nullif(btrim(type), '') IS NOT NULL) s), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.operational_list_filter_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_list_filter_options() TO authenticated, service_role;
