-- 239: o sistema mantém ao menos um Administrativo ativo (item A2 do plano de
-- correções; ADR 0083, item 2).
--
-- Problema: nada impedia o único Administrativo de trocar o próprio setor nem
-- o último Administrativo de ser desativado (a Edge Function `admin-users` só
-- recusava desativar o próprio acesso). Sem Administrativo ativo, ninguém mais
-- administra usuários pelo sistema.
--
-- Mudança: o gatilho `guard_last_active_administrativo` (BEFORE UPDATE OF
-- role, active em `user_profiles`) recusa, com a explicação, rebaixar de
-- setor ou desativar o último Administrativo ativo. Um lock de transação
-- serializa as mudanças de setor e de ativo de Administrativos, para que duas
-- sessões não rebaixem os dois últimos ao mesmo tempo. Vale para a tela, a
-- Edge Function (que grava com o cliente do chamador) e a API.
--
-- Só cria função e gatilho; não reescreve nem apaga linhas.
-- Rollback: DROP TRIGGER guard_last_active_administrativo ON
-- public.user_profiles; DROP FUNCTION public.guard_last_active_administrativo().

CREATE OR REPLACE FUNCTION public.guard_last_active_administrativo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.role = 'administrativo' AND OLD.active
     AND (NEW.role IS DISTINCT FROM 'administrativo' OR NEW.active IS NOT TRUE) THEN
    -- ponytail: lock global de transação para mudanças em Administrativos;
    -- são raras, então serializar todas é barato e evita a corrida entre duas
    -- sessões que rebaixam os dois últimos ao mesmo tempo.
    PERFORM pg_advisory_xact_lock(hashtext('vela.last_active_administrativo'));
    IF NOT EXISTS (
      SELECT 1 FROM public.user_profiles AS p
      WHERE p.id <> OLD.id AND p.role = 'administrativo' AND p.active
    ) THEN
      RAISE EXCEPTION '% é o último usuário Administrativo ativo. Antes de mudar o setor ou desativar, ative ou cadastre outro usuário Administrativo.',
        COALESCE(NULLIF(btrim(OLD.full_name), ''), 'Este usuário')
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_last_active_administrativo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_last_active_administrativo ON public.user_profiles;
CREATE TRIGGER guard_last_active_administrativo
  BEFORE UPDATE OF role, active ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_active_administrativo();
