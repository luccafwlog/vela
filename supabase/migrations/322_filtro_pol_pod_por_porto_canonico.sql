-- 322: filtros POL/POD de B/Ls e Contêineres comparam o porto, não a grafia.
--
-- Problema: no Painel, o link "BB" da escala ZHONG YUAN HAI YUN KAI TUO / 42
-- abria /bls com `pod=BRVIX` (o código canônico da escala) e a lista vinha
-- vazia: os B/Ls daquela viagem foram gravados com a grafia legada `BRVIT`.
-- As três funções da lista filtravam com `b.pod ILIKE '%' || p_pod || '%'`,
-- e 'BRVIT' não contém 'BRVIX'. O select de POD, montado por
-- `operational_list_filter_options` (migration 285) com `DISTINCT btrim(pod)`,
-- mostrava as duas grafias, ambas exibidas como "VITORIA"; só a opção BRVIT
-- trazia os B/Ls. O mesmo valia para POL e para os links de /containers.
--
-- Mudança:
--   1. `operational_list_bls`, `operational_list_bl_summary` (corpos da 229) e
--      `operational_list_containers` (corpo da 295) passam a comparar
--      `normalize_port_code(b.pol|pod) = normalize_port_code(p_pol|p_pod)`,
--      a mesma régua que as taxas locais já usam (BRVIT, VIT, VIX, VITORIA →
--      BRVIX). Valor fora da tabela de sinônimos cai no `upper(btrim())` de
--      `normalize_port_code`: igualdade sem caixa, sem o casamento por
--      substring de antes. Os filtros são selects e links com o código
--      inteiro, então a substring não tinha uso.
--      O corpo é lido do catálogo e o trecho trocado com verificação, como na
--      migration 113: se o trecho não for encontrado, a migration falha.
--   2. `operational_list_filter_options` devolve POL/POD já canônicos, uma
--      opção por porto.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar as definições das migrations 229, 295 e 285.

DO $migration$
DECLARE
  v_fn regprocedure;
  v_def text;
  v_pol_old CONSTANT text := $o$b.pol ILIKE '%' || btrim(p_pol) || '%'$o$;
  v_pol_new CONSTANT text := $n$public.normalize_port_code(b.pol) = public.normalize_port_code(p_pol)$n$;
  v_pod_old CONSTANT text := $o$b.pod ILIKE '%' || btrim(p_pod) || '%'$o$;
  v_pod_new CONSTANT text := $n$public.normalize_port_code(b.pod) = public.normalize_port_code(p_pod)$n$;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.operational_list_bls(integer, integer, text, bigint, text, text, text, text, text, text, text)'::regprocedure,
    'public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text)'::regprocedure,
    'public.operational_list_containers(integer, integer, text, bigint, text, text, text, text, text, text, text, text, boolean)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_fn);
    IF position(v_pol_old IN v_def) = 0 OR position(v_pod_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 322: filtro POL/POD por ILIKE não encontrado em %.', v_fn;
    END IF;
    EXECUTE replace(replace(v_def, v_pol_old, v_pol_new), v_pod_old, v_pod_new);
  END LOOP;
END
$migration$;

CREATE OR REPLACE FUNCTION public.operational_list_filter_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
SELECT jsonb_build_object(
  'pols', coalesce((SELECT jsonb_agg(value) FROM (SELECT DISTINCT public.normalize_port_code(pol) AS value FROM public.bls WHERE nullif(btrim(pol), '') IS NOT NULL) s), '[]'::jsonb),
  'pods', coalesce((SELECT jsonb_agg(value) FROM (SELECT DISTINCT public.normalize_port_code(pod) AS value FROM public.bls WHERE nullif(btrim(pod), '') IS NOT NULL) s), '[]'::jsonb),
  'containerTypes', coalesce((SELECT jsonb_agg(value) FROM (SELECT DISTINCT upper(btrim(type)) AS value FROM public.bl_containers WHERE nullif(btrim(type), '') IS NOT NULL) s), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.operational_list_filter_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_list_filter_options() TO authenticated, service_role;
