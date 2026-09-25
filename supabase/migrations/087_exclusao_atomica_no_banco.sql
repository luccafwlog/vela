-- Migration 087: exclusão de B/L, container, veículo e cliente acontece por
-- inteiro no banco, com prévia; código de exclusão sem tela sai (ADR 0071;
-- plano docs/plans/2026-09-24-politica-de-exclusao.md, Fase 2; achados A1, A2
-- e A9 da revisão de 2026-09-24).
--
-- - delete_records(kind, ids, dry_run, reason) substitui as cadeias de DELETE
--   que o navegador fazia (veículos, contatos e overrides antes do principal).
--   Cada item é excluído numa sub-transação: se o banco recusar por qualquer
--   motivo (FK, trigger), o item volta inteiro, com os filhos, e o motivo sai
--   no relatório. Em dry_run toda sub-transação é desfeita, e o relatório é a
--   prévia exata do que a execução fará. Itens independentes de um lote seguem
--   (ADR 0009); cada item é tudo ou nada.
-- - Só o Administrativo (is_admin) executa; os demais recebem 42501 em vez de
--   uma exclusão silenciosa de 0 linhas.
-- - A linha "deleted" com o autor é gravada na mesma transação da exclusão
--   (antes era logDeletions no navegador, best-effort).
-- - Cliente com CNPJ não se exclui: volta bloqueado com "desative em vez de
--   excluir" (ADR 0073, item 5). Ids repetidos no lote contam uma vez.
-- - Linha de serviço de vazios: DELETE passa a is_active_user(), como a
--   inclusão e a edição (ADR 0071, item 4); a tela mostrava sucesso falso.
-- - Saem as funções sem tela archive_vessel_schedule (Encerrar navio) e
--   delete_baplie_manifest_for_voyage. As tabelas vessel_schedules e
--   ended_vessels ficam como histórico.
--
-- Não reescreve nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.delete_record_block_reason(p_state text, p_message text, p_constraint text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN p_state = '23503' THEN
      'vinculado a ' || COALESCE((
        SELECT CASE c.conrelid::regclass::text
          WHEN 'invoices' THEN 'fatura'
          WHEN 'invoice_items' THEN 'item de fatura'
          WHEN 'invoice_bls' THEN 'fatura consolidada'
          WHEN 'invoice_receivable_links' THEN 'recebível de fatura'
          WHEN 'bl_receivables' THEN 'recebível'
          WHEN 'billing_batches' THEN 'lote de faturamento'
          WHEN 'demurrage_invoices' THEN 'fatura de Demurrage'
          WHEN 'demurrage_invoice_items' THEN 'item de fatura de Demurrage'
          WHEN 'demurrage_disputes' THEN 'disputa de Demurrage'
          WHEN 'demurrage_dispute_attachments' THEN 'anexo de disputa de Demurrage'
          WHEN 'cod_adjustments' THEN 'ajuste de COD'
          WHEN 'customer_communications' THEN 'comunicado ao cliente'
          WHEN 'customer_communication_bls' THEN 'comunicado ao cliente'
          WHEN 'customer_communication_dunning_groups' THEN 'grupo de cobrança'
          WHEN 'customer_communication_dunning_invoices' THEN 'cobrança ao cliente'
          WHEN 'charge_calculations' THEN 'cálculo de taxa'
          WHEN 'bls' THEN 'B/L'
          ELSE c.conrelid::regclass::text
        END
        FROM pg_constraint c
        WHERE c.conname = p_constraint AND c.contype = 'f'
        LIMIT 1
      ), 'outro registro')
    ELSE p_message
  END;
$function$;

REVOKE ALL ON FUNCTION public.delete_record_block_reason(text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_records(
  p_kind text,
  p_ids text[],
  p_dry_run boolean DEFAULT false,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id text;
  v_count integer;
  v_deleted jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_state text;
  v_message text;
  v_constraint text;
  v_entity text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;

  v_entity := CASE p_kind
    WHEN 'bl' THEN 'bl'
    WHEN 'container' THEN 'container'
    WHEN 'vehicle' THEN 'vehicle'
    WHEN 'customer' THEN 'customer'
  END;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'Tipo de exclusão desconhecido: %.', p_kind USING ERRCODE = '22023';
  END IF;

  -- Um id repetido no lote conta uma vez: sem isto a prévia mostrava o item
  -- duas vezes como excluído e a execução, uma vez "não encontrado".
  FOREACH v_id IN ARRAY ARRAY(
    SELECT u.id FROM unnest(COALESCE(p_ids, ARRAY[]::text[])) WITH ORDINALITY AS u(id, ord)
    GROUP BY u.id ORDER BY min(u.ord)
  ) LOOP
    BEGIN
      IF p_kind = 'customer' AND EXISTS (
        SELECT 1 FROM public.customers c WHERE c.id = v_id::bigint AND NULLIF(btrim(c.cnpj_cpf), '') IS NOT NULL
      ) THEN
        -- Cliente com CNPJ conta como usado (ADR 0073, item 5): só se desativa.
        -- A regra é explícita; antes dependia do trigger somente-inclusão dos
        -- eventos do Portal, que a retenção de 1 ano apaga.
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', jsonb_build_array('cliente com CNPJ: desative em vez de excluir'));
        CONTINUE;
      END IF;

      IF p_kind = 'bl' THEN
        DELETE FROM public.vehicles WHERE bl_id = v_id;
        DELETE FROM public.bls WHERE id = v_id;
      ELSIF p_kind = 'container' THEN
        DELETE FROM public.vehicles WHERE container_id = v_id::bigint;
        DELETE FROM public.bl_containers WHERE id = v_id::bigint;
      ELSIF p_kind = 'vehicle' THEN
        DELETE FROM public.vehicles WHERE id = v_id::bigint;
      ELSE
        DELETE FROM public.customer_contacts WHERE customer_id = v_id::bigint;
        DELETE FROM public.customer_rate_overrides WHERE customer_id = v_id::bigint;
        DELETE FROM public.customers WHERE id = v_id::bigint;
      END IF;
      GET DIAGNOSTICS v_count = ROW_COUNT;

      IF v_count = 0 THEN
        v_blocked := v_blocked || jsonb_build_object('id', v_id, 'reasons', jsonb_build_array('não encontrado'));
      ELSIF p_dry_run THEN
        -- Desfaz a sub-transação: a prévia não apaga nada.
        RAISE EXCEPTION USING ERRCODE = 'VL001';
      ELSE
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES (v_entity, v_id, 'deleted', v_id, NULL, auth.uid(), COALESCE(NULLIF(btrim(p_reason), ''), 'exclusao manual'));
        v_deleted := v_deleted || to_jsonb(v_id);
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'VL001' THEN
        v_deleted := v_deleted || to_jsonb(v_id);
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_state = RETURNED_SQLSTATE,
          v_message = MESSAGE_TEXT,
          v_constraint = CONSTRAINT_NAME;
        v_blocked := v_blocked || jsonb_build_object(
          'id', v_id,
          'reasons', jsonb_build_array(public.delete_record_block_reason(v_state, v_message, v_constraint))
        );
    END;
  END LOOP;

  RETURN jsonb_build_object('deleted', v_deleted, 'blocked', v_blocked, 'dry_run', p_dry_run);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_records(text, text[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_records(text, text[], boolean, text) TO authenticated;

DROP POLICY IF EXISTS vazios_export_service_lines_write_global_delete ON public.vazios_export_service_lines;
CREATE POLICY vazios_export_service_lines_write_global_delete
  ON public.vazios_export_service_lines
  FOR DELETE TO authenticated
  USING (public.is_active_user());

DROP FUNCTION IF EXISTS public.archive_vessel_schedule(uuid);
DROP FUNCTION IF EXISTS public.delete_baplie_manifest_for_voyage(bigint);
