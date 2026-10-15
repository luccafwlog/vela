-- 240: perfil interno não se exclui, nem pela API (item A3 do plano de
-- correções; ADR 0083, item 3; ADR 0074).
--
-- Problema: a policy `user_profiles_admin_delete` (migration 002), com o
-- grant de DELETE a `authenticated`, deixava o Administrativo apagar perfil
-- interno pela API. O usuário só se desativa: o perfil guarda o autor do
-- histórico (`audit_logs`, baixas, sign-offs) e a retenção da ADR 0074.
--
-- Mudança: sai a policy e `authenticated` (e `anon`) perde DELETE em
-- `user_profiles`, como a migration 086 fez com documento fiscal. A tela não
-- exclui perfil; a Edge Function `admin-users` só desativa.
--
-- Só muda privilégio e policy; não reescreve nem apaga linhas.
-- Rollback: GRANT DELETE ON public.user_profiles TO authenticated e recriar
-- a policy `user_profiles_admin_delete` (DELETE USING is_admin()).

DROP POLICY IF EXISTS user_profiles_admin_delete ON public.user_profiles;
REVOKE DELETE, TRUNCATE ON public.user_profiles FROM PUBLIC, anon, authenticated;
