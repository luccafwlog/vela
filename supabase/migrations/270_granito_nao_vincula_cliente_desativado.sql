-- 270: B/L de Granito não se vincula a Cliente desativado (revisão da PR 954;
-- ADR 0073, item 6; item B17).
--
-- Problema: o B17 passou a carregar o Cliente desativado no mapa por documento
-- para a Revisão do B/L mostrar o motivo. No Granito, o mesmo mapa transformava
-- o CNPJ do Cliente desativado em "Sugestão por nome", e "Usar a sugestão"
-- gravava pela RPC sem trava: `granite_bls` nunca teve o gatilho que `bls` tem
-- desde a migration 092 (`guard_bl_link_to_deactivated_customer`). O B/L de
-- Granito podia ficar vinculado a Cliente desativado e ser faturado.
--
-- Mudança: o banco recusa vincular `granite_bls.client_id` a Cliente
-- desativado (reativar antes), na inserção e na troca do Cliente. O vínculo que
-- já existia antes da desativação não muda. Na tela, a importação do Granito
-- deixa o CNPJ de Cliente desativado sem vínculo e sem sugestão
-- (`withoutDeactivatedCustomer`).
--
-- Só cria função e gatilho; não reescreve nem apaga linhas.
-- Rollback: DROP TRIGGER trg_guard_granite_link_to_deactivated_customer ON
-- public.granite_bls; DROP FUNCTION public.guard_granite_link_to_deactivated_customer().

CREATE OR REPLACE FUNCTION public.guard_granite_link_to_deactivated_customer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.client_id IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.client_id IS NOT DISTINCT FROM NEW.client_id)
     OR NOT EXISTS (SELECT 1 FROM public.customers WHERE id = NEW.client_id AND deactivated_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Cliente % desativado: reative antes de vincular.', NEW.client_id USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_granite_link_to_deactivated_customer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_granite_link_to_deactivated_customer ON public.granite_bls;
CREATE TRIGGER trg_guard_granite_link_to_deactivated_customer
  BEFORE INSERT OR UPDATE OF client_id ON public.granite_bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_granite_link_to_deactivated_customer();
