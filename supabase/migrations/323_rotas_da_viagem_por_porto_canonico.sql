-- 323: rotas do resumo de viagens agrupam pelo porto, não pela grafia.
--
-- Problema: `operational_list_voyage_summaries` (corpo da 058) agrupava as
-- rotas de cada viagem por `b.pol, b.pod` crus. Uma viagem com B/Ls gravados
-- como `BRVIT` e outros como `BRVIX` devolvia duas rotas para Vitória, com a
-- contagem de B/Ls e a cobertura de CE divididas entre elas. As telas de hoje
-- normalizam o porto no navegador antes de exibir, mas o payload contradizia
-- o filtro da lista de BLs, que desde a migration 322 trata as duas grafias
-- como o mesmo porto.
--
-- Mudança: a rota passa a ser `normalize_port_code(b.pol)` →
-- `normalize_port_code(b.pod)`, a mesma régua da 322. POL/POD vazio e nulo
-- caem juntos em NULL (antes eram rotas distintas). Os totais da viagem não
-- mudam: são a soma das rotas.
-- O corpo é lido do catálogo e o trecho trocado com verificação, como na
-- migration 113: se não for encontrado, a migration falha.
--
-- Só redefine uma função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da migration 058.

DO $migration$
DECLARE
  v_def text := pg_get_functiondef('public.operational_list_voyage_summaries(integer, integer)'::regprocedure);
  v_select_old CONSTANT text := $o$        b.pol,
        b.pod,
        COUNT(*)::integer AS bl_count,$o$;
  v_select_new CONSTANT text := $n$        public.normalize_port_code(b.pol) AS pol,
        public.normalize_port_code(b.pod) AS pod,
        COUNT(*)::integer AS bl_count,$n$;
  v_group_old CONSTANT text := $o$GROUP BY b.pol, b.pod$o$;
  v_group_new CONSTANT text := $n$GROUP BY public.normalize_port_code(b.pol), public.normalize_port_code(b.pod)$n$;
BEGIN
  IF position(v_select_old IN v_def) = 0 OR position(v_group_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 323: agrupamento de rotas por b.pol, b.pod não encontrado em operational_list_voyage_summaries.';
  END IF;
  EXECUTE replace(replace(v_def, v_select_old, v_select_new), v_group_old, v_group_new);
END
$migration$;
