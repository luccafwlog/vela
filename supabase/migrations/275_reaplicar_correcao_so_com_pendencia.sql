-- 275: "Tentar aplicar correção" só reaplica a base de um B/L que tem
-- correção pendente registrada (revisão da PR 954; item P4, migration 246;
-- ADR 0077).
--
-- Problema: a 246 abriu `retry_invoice_basis_changes` a qualquer usuário
-- interno ativo, como decidido para o botão do painel de correção. Mas a
-- função aceitava qualquer B/L: sem pendência, `retry_invoice_basis_changes_legacy_134`
-- chamava `apply_invoice_basis_changes`, que compara a cotação atual com o
-- recebível e cancela e reemite a fatura sem pagamento (ou abate, ou abre
-- Restituição). Pela API, Operações reprecificava um B/L faturado sem motivo
-- depois de uma Condição de Cliente nova. O botão só aparece com pendência.
--
-- Mudança: a função exige a troca de Cliente em aberto
-- (`invoice_customer_changes`, caminho que já existia) ou a linha de
-- `invoice_basis_pending_changes` do B/L; sem nenhuma, não faz nada e devolve
-- `{"status": "nothing_pending"}` (a repetição depois de concluir continua
-- inofensiva, como antes para o Administrativo), sem tocar na fatura.
--
-- Só redefine uma função; não reescreve nem apaga linhas.
-- Rollback: reaplicar a definição da migration 246.

CREATE OR REPLACE FUNCTION public.retry_invoice_basis_changes(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE change_id bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE='42501'; END IF;
 SELECT id INTO change_id FROM public.invoice_customer_changes WHERE bl_id = p_bl_id AND status <> 'completed' ORDER BY id DESC LIMIT 1;
 IF change_id IS NOT NULL THEN RETURN public._finish_invoice_customer_change(change_id); END IF;
 IF NOT EXISTS (SELECT 1 FROM public.invoice_basis_pending_changes WHERE bl_id = p_bl_id) THEN
   RETURN jsonb_build_object('status', 'nothing_pending', 'bl_id', p_bl_id);
 END IF;
 RETURN public.retry_invoice_basis_changes_legacy_134(p_bl_id);
END $function$;
