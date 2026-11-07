-- 614: aviso no sino quando o Cliente VIP envia um documento anual (decisão 4
-- do dono de 2026-11-07; ADR 0132, lote B do plano
-- 2026-11-07-brechas-restantes-da-revisao-dos-alertas).
--
-- O termo e a procuração anuais do VIP chegam pelo Portal e esperavam análise
-- sem ninguém saber (brecha B04). Agora, quando o envio do Cliente termina
-- (`ce_unlock_documents` de `source = 'vip_annual'` passa a `uploaded`), a
-- Documentação e o Administrativo recebem no sino "Novo documento anual VIP",
-- que abre a ficha do Cliente na aba Desbloqueio de CE e VIP. O envio feito
-- pela equipe interna, em nome do Cliente, não avisa a própria equipe (como na
-- solicitação, 599). Sem alerta de vencimento (decisão do dono).
--
-- Plano de preservação: a migration só acrescenta uma função e um gatilho; não
-- reescreve nem apaga linha existente. Conferir: `SELECT tgname FROM
-- pg_trigger WHERE tgname = 'trg_notify_ce_unlock_annual_uploaded'`.
-- Desfazer: o rollback abaixo.
--
-- Rollback: `DROP TRIGGER trg_notify_ce_unlock_annual_uploaded ON
-- ce_unlock_documents` e `DROP FUNCTION _notify_ce_unlock_annual_uploaded()`.

CREATE OR REPLACE FUNCTION public._notify_ce_unlock_annual_uploaded()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer record;
BEGIN
  IF NEW.source <> 'vip_annual' OR NEW.status <> 'uploaded'
     OR (TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status) THEN
    RETURN NULL;
  END IF;
  -- Enviado pela equipe interna: não avisa a própria equipe.
  IF EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = NEW.uploaded_by) THEN RETURN NULL; END IF;

  SELECT c.id, c.name, c.cnpj_cpf INTO v_customer FROM public.customers c WHERE c.id = NEW.customer_id;
  PERFORM public._notify_departments_of_event(
    'ce_unlock_annual:' || NEW.id,
    ARRAY['documentacao', 'administrativo'],
    'desbloqueio_ce_anual_vip',
    'Novo documento anual VIP',
    format('%s enviou %s anual para análise.',
      COALESCE(v_customer.name, 'Cliente'),
      CASE NEW.type WHEN 'termo' THEN 'o termo de devolução' ELSE 'a procuração' END),
    'customer',
    NEW.customer_id::text,
    CASE WHEN NULLIF(btrim(COALESCE(v_customer.cnpj_cpf, '')), '') IS NULL THEN '/clientes'
         ELSE '/clientes/' || regexp_replace(v_customer.cnpj_cpf, '\D', '', 'g') || '?tab=desbloqueio-ce' END,
    jsonb_build_object('customer_id', NEW.customer_id, 'document_id', NEW.id, 'document_type', NEW.type)
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Aviso do anual VIP ignorado: %', SQLERRM;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._notify_ce_unlock_annual_uploaded() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_ce_unlock_annual_uploaded ON public.ce_unlock_documents;
CREATE TRIGGER trg_notify_ce_unlock_annual_uploaded
  AFTER INSERT OR UPDATE OF status ON public.ce_unlock_documents
  FOR EACH ROW EXECUTE FUNCTION public._notify_ce_unlock_annual_uploaded();
