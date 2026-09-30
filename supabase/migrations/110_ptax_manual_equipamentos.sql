-- Migration 110: Equipamentos volta a poder informar a PTAX manual.
--
-- A 109 restringiu recalculate_demurrage_invoices_manual a Financeiro e
-- Administrativo (reforço da auditoria run-2). Decisão do dono em 2026-09-29:
-- Equipamentos opera a tela de Demurrage e precisa do botão Informar PTAX.
-- Operações e Documentação continuam de fora. Não reescreve nem apaga linhas.
CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices_manual(p_ptax numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR public.current_actor_role() NOT IN ('financeiro', 'administrativo', 'equipamentos') THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  RETURN public.recalculate_demurrage_invoices(
    p_ptax,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'manual'
  );
END;
$function$;
