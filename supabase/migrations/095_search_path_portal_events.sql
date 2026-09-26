-- Migration 095: portal_events_block_mutation ganha search_path fixo.
--
-- O advisor do Supabase (function_search_path_mutable) aponta a função: a
-- migration 094 a reescreveu para liberar a rotina de guarda e manteve o
-- search_path mutável que ela já tinha. Mesmo padrão das demais funções do
-- banco. Só altera o atributo da função; não reescreve nem apaga linhas.

ALTER FUNCTION public.portal_events_block_mutation() SET search_path = public, pg_temp;
