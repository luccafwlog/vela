-- 586: a conta da baixa automática Itaú não sai do Financeiro.
--
-- Desde a migration 583 (decisão do dono de 2026-11-04), a baixa de Taxas
-- Locais e da avulsa aceita só o Financeiro e a conta Dev. A baixa automática
-- Itaú grava como a conta de `app_settings.itau_pix_settlement_actor` (a conta
-- de integração "API ITAÚ", migration 440). Se alguém trocar o setor dessa conta
-- em Usuários, todo Pix pago passa a ir para Pix em análise com "Sem permissão
-- de faturamento.", sem erro na troca: antes da 583, o Administrativo ainda
-- passava. A 583 só avisava no deploy (RAISE WARNING); em produção, em
-- 2026-11-04, a conta é do Financeiro, de integração e ativa (conferido por
-- leitura na revisão da release staging → main).
--
-- Mudança: gatilho em `user_profiles` que recusa mudar o setor da conta da
-- baixa automática para outro que não o Financeiro. Pôr no Financeiro e
-- desativar a conta (desligar a baixa de propósito) continuam liberados.
--
-- ponytail: só a troca de setor da conta é barrada; apontar
-- `itau_pix_settlement_actor` para outra conta é passo de migration ou de
-- `service_role`, e a 583 já mostra o aviso quando isso acontece por migration.
--
-- Plano de preservação: a migration não reescreve nem apaga linha existente;
-- cria uma função e um gatilho. Conferir: `UPDATE public.user_profiles SET
-- role = 'administrativo' WHERE id = (SELECT itau_pix_settlement_actor FROM
-- public.app_settings WHERE id = 1)` dentro de BEGIN/ROLLBACK é recusado.
-- Desfazer: `DROP TRIGGER guard_itau_settlement_actor_role ON
-- public.user_profiles; DROP FUNCTION public.guard_itau_settlement_actor_role();`.
BEGIN;

CREATE FUNCTION public.guard_itau_settlement_actor_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NEW.role IS DISTINCT FROM 'financeiro'
     AND EXISTS (SELECT 1 FROM public.app_settings s WHERE s.id = 1 AND s.itau_pix_settlement_actor = OLD.id) THEN
    RAISE EXCEPTION 'A conta da baixa automática do Pix Itaú precisa ser do Financeiro: em outro setor, todo Pix pago fica em análise em vez de dar baixa.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_itau_settlement_actor_role() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_itau_settlement_actor_role
  BEFORE UPDATE OF role ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_itau_settlement_actor_role();

COMMIT;
