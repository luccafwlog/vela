-- 286: helpers de RLS dentro de expressão composta também avaliados uma vez
-- por consulta.
--
-- Problema: a `283` só converteu policies cuja expressão inteira é a chamada
-- (`USING (is_active_user())`). Depois dela, 32 policies ainda chamavam o
-- helper nu dentro de expressão composta, executado a cada linha lida ou
-- gravada: `vehicles` e as tabelas de Vazios (`is_active_user() OR
-- is_active_user()`), `depots`/`depot_services` (`is_admin() OR
-- is_active_user()`), `internal_notifications` (`recipient_id = auth.uid() AND
-- is_active_read_user()`), `user_profiles`, `demurrage_rates`,
-- `customer_demurrage_agreements`, `demurrage_disputes`, caixas de
-- comunicação, `audit_logs` e outras.
--
-- Mudança: toda chamada sem argumentos de função não volátil e escalar de
-- `public`, e `auth.uid()`/`auth.jwt()`/`auth.role()`, vira `(SELECT f())`, um
-- InitPlan avaliado uma vez por consulta (recomendação da Supabase para RLS),
-- em qualquer posição da expressão. A função não recebe argumento da linha e é
-- STABLE/IMMUTABLE, então devolve o mesmo valor em todas as linhas da consulta;
-- o InitPlan só roda quando o ramo que o usa é avaliado (`CASE`, `OR`). Nenhuma
-- regra de acesso muda. Chamada já envolvida por `SELECT`, chamada qualificada
-- por outro esquema e função com argumento da linha ficam como estão.
--
-- Converte as policies que existem quando roda; policy nova escreve a forma
-- `(select ...)` direto (docs/operations/seguranca.md, "RLS-first"), e a suíte
-- local-pg `auditSecurityBoundaries` falha se alguma voltar à forma nua.
--
-- Só reescreve expressões de policy; não reescreve nem apaga linhas.
-- Rollback: `ALTER POLICY ... USING (<expressão anterior>)`; a expressão de
-- cada policy antes desta migration está na migration que a criou.

DO $$
DECLARE
  r record;
  helpers text;
  -- Chamada nua: não precedida por `SELECT ` (já é InitPlan) nem por `.`,
  -- letra ou `_` (parte de outro nome).
  bare constant text := '(?<![.[:alnum:]_])(?<!SELECT )';
  new_qual text;
  new_check text;
  changed integer := 0;
BEGIN
  SELECT string_agg(DISTINCT p.proname, '|')
    INTO helpers
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.pronargs = 0
    AND p.provolatile <> 'v'
    AND NOT p.proretset;

  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    new_qual := regexp_replace(
      regexp_replace(r.qual, bare || '(public\.)?(' || helpers || ')\(\)', '(SELECT public.\2())', 'g'),
      bare || 'auth\.(uid|jwt|role)\(\)', '(SELECT auth.\1())', 'g');
    new_check := regexp_replace(
      regexp_replace(r.with_check, bare || '(public\.)?(' || helpers || ')\(\)', '(SELECT public.\2())', 'g'),
      bare || 'auth\.(uid|jwt|role)\(\)', '(SELECT auth.\1())', 'g');

    IF new_qual IS DISTINCT FROM r.qual THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', r.policyname, r.schemaname, r.tablename, new_qual);
    END IF;
    IF new_check IS DISTINCT FROM r.with_check THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', r.policyname, r.schemaname, r.tablename, new_check);
    END IF;
    IF new_qual IS DISTINCT FROM r.qual OR new_check IS DISTINCT FROM r.with_check THEN
      changed := changed + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '286: % policies convertidas', changed;
END $$;
