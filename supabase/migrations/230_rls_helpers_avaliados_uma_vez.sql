-- 230: helpers de RLS avaliados uma vez por consulta, não uma vez por linha.
--
-- Problema (medição local com volume de ~2 anos: 12 mil B/Ls, 28 mil
-- contêineres): 187 policies chamam um helper sem argumentos direto no USING
-- ou WITH CHECK (`is_active_read_user()`, `is_admin()`...). Nessa forma o
-- Postgres executa a função SECURITY DEFINER a cada linha lida. Um
-- `count(*)` em `bls` levava 95 ms; a página 1 de `operational_list_bls`
-- levava 72 s, porque o planner subestima o filtro, escolhe laço aninhado e
-- relê `customers` (com a função de novo em cada linha) para cada B/L: 4,9
-- milhões de chamadas. A lista ficava mais lenta a cada viagem importada.
--
-- Mudança: `(select helper())` vira InitPlan, avaliado uma vez por consulta
-- (recomendação da Supabase para RLS). O helper não recebe argumento da linha
-- e é STABLE, então o resultado é o mesmo; nenhuma regra de acesso muda.
-- Medido depois: `count(*)` em `bls` 7,5 ms; página 1 da lista de B/Ls 0,27 s.
--
-- Só altera a expressão de policies cujo USING/WITH CHECK é exatamente uma
-- chamada sem argumentos; expressões compostas ficam como estão. Não reescreve
-- nem apaga linhas.
-- Rollback: `alter policy ... using (helper())` com o mesmo nome do helper.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    IF r.qual ~ '^(public\.)?[a-z_]+\(\)$' THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING ((SELECT public.%s))',
        r.policyname, r.schemaname, r.tablename, regexp_replace(r.qual, '^public\.', ''));
    END IF;
    IF r.with_check ~ '^(public\.)?[a-z_]+\(\)$' THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK ((SELECT public.%s))',
        r.policyname, r.schemaname, r.tablename, regexp_replace(r.with_check, '^public\.', ''));
    END IF;
  END LOOP;
END $$;
