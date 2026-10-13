-- Migration 221: o detalhe da fatura e a Ficha do Cliente mostram quem
-- registrou cada baixa.
--
-- Evidência (produção, 2026-10-13): a baixa Pix registrada na INV-2026-0014
-- aparecia em "Pagamentos registrados" sem autor. `payments.registered_by`
-- já guarda o usuário interno, mas o navegador não pode ler
-- `user_profiles` livremente.
--
-- Mesmo padrão de `get_agency_report_actor_names`: função SECURITY DEFINER que
-- devolve só o nome, com o gate de leitura da policy `payments_select_read`
-- (`is_active_read_user()`). Só resolve autores de baixas existentes nos ids
-- pedidos; não serve para listar usuários.
--
-- Quem cancelou uma baixa não entra aqui: `reverse_invoice_payment` apaga a
-- linha de `payments` e grava em `audit_logs` (field_name `payment_reversed`)
-- só a fatura, sem o id da baixa cancelada.
--
-- Rollback: DROP FUNCTION public.list_payment_registrar_names(bigint[]);
-- Somente leitura; não reescreve dados.

CREATE FUNCTION public.list_payment_registrar_names(p_payment_ids bigint[])
RETURNS TABLE(payment_id bigint, registered_by_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, up.full_name
  FROM public.payments AS p
  JOIN public.user_profiles AS up ON up.id = p.registered_by
  WHERE p.id = ANY(p_payment_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.list_payment_registrar_names(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_payment_registrar_names(bigint[]) TO authenticated;
