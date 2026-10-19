-- 329: importação de B/L de container grava o arquivo inteiro numa transação
-- (ADR 0091, lote 6a da identidade visual).
--
-- Problema:
--   1. A tela gravava o arquivo em lotes de 20 B/Ls / 300 contêineres, cada
--      lote uma chamada de `import_bl_freight_with_metadata` e uma transação,
--      para caber nos 8 s de `statement_timeout` do papel `authenticated`
--      (~8 ms por contêiner, medido em 08/10/2026). Uma falha no meio deixava
--      os lotes anteriores gravados ("X de Y B/L(s) foram importados; os
--      demais falharam"). A ADR 0091 exige que a importação com erro não
--      grave nada.
--   2. Linha da aba VIN que o banco recusava (chassi já em outro B/L,
--      container fora do B/L) saía em `vehicles_discarded` e o resto do
--      arquivo entrava. Pela ADR 0091 a recusa que só o banco detecta também
--      desfaz tudo.
--
-- Mudança:
--   `import_bl_freight_file_atomic(p_bls, p_changed_by, p_batch)` recebe o
--   arquivo inteiro e chama, na mesma transação, o mesmo núcleo de antes:
--   `import_bl_freight_with_metadata` quando há viagem (batch, flags do
--   Baplie e cálculo das Taxas Locais) e `import_bl_freight_transactional`
--   sem viagem. Se o núcleo devolver qualquer `vehicles_discarded`, a função
--   levanta 23514 com HINT `vehicles_discarded` e a lista em DETAIL (JSON): a
--   transação inteira é desfeita e a tela lista os veículos recusados.
--   A falha no cálculo das Taxas Locais continua sem desfazer a importação
--   (ADR 0091, D2): o núcleo já a devolve em `calculation_errors`.
--
--   A função declara `statement_timeout = 60s`. O PostgREST (v12+) aplica a
--   configuração `statement_timeout` da função à transação da chamada
--   (`db-hoisted-tx-settings`), o que tira o arquivo inteiro do teto de 8 s.
--   Num `psql` comum a configuração não estende o comando que já começou;
--   só vale pela API.
--   ponytail: teto de ~7.000 contêineres por arquivo (60 s a ~8 ms cada; uns
--   1.000 se o PostgREST não aplicar o tempo da função). Acima disso a
--   chamada é cancelada (57014) e nada é gravado. Upgrade: preparo em etapas
--   numa tabela de staging com publicação numa RPC final, ou o cálculo das
--   taxas e as flags do Baplie fora da transação.
--
-- Não reescreve nem apaga linhas existentes; só cria a função. As RPCs
-- anteriores continuam existindo (suítes e o rastro da migration 189 as usam).

CREATE OR REPLACE FUNCTION public.import_bl_freight_file_atomic(
  p_bls jsonb,
  p_changed_by uuid,
  p_batch jsonb DEFAULT NULL::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_core jsonb;
  v_discarded jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  IF p_batch IS NULL THEN
    v_result := public.import_bl_freight_transactional(p_bls, p_changed_by);
    v_core := v_result;
  ELSE
    v_result := public.import_bl_freight_with_metadata(p_bls, p_changed_by, p_batch);
    v_core := v_result->'result';
  END IF;

  v_discarded := COALESCE(v_core->'vehicles_discarded', '[]'::jsonb);
  IF jsonb_typeof(v_discarded) = 'array' AND jsonb_array_length(v_discarded) > 0 THEN
    RAISE EXCEPTION 'Nada foi gravado: o banco recusou veiculos da aba VIN (%).', jsonb_array_length(v_discarded)
      USING ERRCODE = '23514', HINT = 'vehicles_discarded', DETAIL = v_discarded::text;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_bl_freight_file_atomic(jsonb, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_file_atomic(jsonb, uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.import_bl_freight_file_atomic(jsonb, uuid, jsonb) IS
  'Importação de B/L de container: o arquivo inteiro numa transação (ADR 0091, migration 329).';
