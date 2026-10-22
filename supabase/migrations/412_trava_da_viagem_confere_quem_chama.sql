-- 412: a trava de importação da Viagem confere quem chama antes de entrar na
-- fila (auditoria de segurança run-3, pendência P5).
--
-- Problema: a 387 criou a trava `import_voyage:<id>` e a 389 pôs a guarda
-- antes dela em duas funções, mas as importações de CE Mercante, Manifesto BB,
-- Granito, Vazios e as que a 405 envolveu (`*_core_405`) ainda pegam a trava
-- primeiro e só recusam no corpo delegado. Uma sessão sem permissão (Portal ou
-- usuário interno inativo) entrava na fila da Viagem escolhida, à frente de uma
-- importação da equipe, e com carga grande segurava a trava por segundos antes
-- da recusa (em produção, `lock_timeout` de 8 s no papel `authenticator`).
--
-- Mudança: `_lock_import_voyages` e `_lock_import_voyages_of_bls` começam por
-- `_assert_import_caller()`, que recusa com 42501 quem não é usuário interno
-- ativo. Passam o `service_role` (Edge Functions e rotinas que agem em nome do
-- usuário) e o contexto sem requisição (cron, migration, manutenção). Vale para
-- todas as funções que usam a trava, inclusive as futuras.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `_lock_import_voyages` e `_lock_import_voyages_of_bls`
-- da 387.

CREATE OR REPLACE FUNCTION public._assert_import_caller()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Sem JWT na transação não há requisição do PostgREST: é o próprio banco.
  IF NULLIF(current_setting('request.jwt.claims', true), '') IS NULL
     AND NULLIF(current_setting('request.jwt.claim.sub', true), '') IS NULL THEN
    RETURN;
  END IF;
  IF auth.role() = 'service_role' THEN
    RETURN;
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public._assert_import_caller() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._lock_import_voyages(p_voyage_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id bigint;
BEGIN
  PERFORM public._assert_import_caller();
  FOR v_id IN
    SELECT DISTINCT x FROM unnest(COALESCE(p_voyage_ids, ARRAY[]::bigint[])) AS x
    WHERE x IS NOT NULL ORDER BY x
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('import_voyage:' || v_id::text, 0));
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public._lock_import_voyages_of_bls(p_voyage_ids bigint[], p_bl_ids text[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_import_caller();
  PERFORM public._lock_import_voyages(
    COALESCE(p_voyage_ids, ARRAY[]::bigint[])
    || ARRAY(SELECT b.voyage_id FROM public.bls AS b
             WHERE b.id = ANY(COALESCE(p_bl_ids, ARRAY[]::text[])) AND b.voyage_id IS NOT NULL));
END $function$;
