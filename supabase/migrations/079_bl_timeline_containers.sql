-- Migration 079: o Histórico do B/L passa a mostrar as mudanças de negócio
-- nos containers do B/L (decisão R11 de 2026-09-23, plano
-- docs/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md).
--
-- O gatilho audit_row_changes grava entity_type = nome da tabela
-- ('bl_containers'), mas bl_timeline só lia 'bl_container'. Resultado: datas
-- de descarga e devolução importadas em lote e as marcações IMO/OOG aplicadas
-- pelo Baplie ficavam em audit_logs sem aparecer no Histórico.
--
-- Mantém a assinatura e as colunas da função. Linhas da auditoria por coluna
-- entram só para os campos de negócio listados abaixo, normalizadas como
-- 'bl_container'.
-- ponytail: o número do container viaja em field_name como
-- '<campo>|<container_number>', porque a função não devolve entity_id e mudar
-- o RETURNS TABLE exigiria recriar a função e regenerar os tipos. A tela
-- separa pelo '|'. Evolução: devolver entity_id/container_number como colunas.
-- Não reescreve linhas existentes.

CREATE OR REPLACE FUNCTION public.bl_timeline(p_bl_id text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(id bigint, family text, entity_type text, field_name text, old_value text, new_value text, changed_by uuid, changed_at timestamp with time zone, justification text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH bl_container_ids AS (
    SELECT c.id::text AS id, c.container_number
    FROM public.bl_containers c
    WHERE c.bl_id = p_bl_id
  )
  SELECT
    a.id,
    CASE
      WHEN a.entity_type = 'invoice' THEN 'fatura'
      WHEN a.entity_type = 'charge_calculation' THEN 'taxas'
      WHEN a.entity_type IN ('bl_container', 'bl_containers') THEN 'container'
      WHEN a.entity_type = 'system_event' THEN 'sistema'
      WHEN a.entity_type = 'bl' AND a.field_name = 'charge_status' THEN 'taxas'
      WHEN a.entity_type = 'bl' AND a.field_name IN ('financial_status', 'billing_hold_reason', 'last_billing_run_id') THEN 'fatura'
      ELSE 'edicao'
    END AS family,
    CASE WHEN a.entity_type = 'bl_containers' THEN 'bl_container' ELSE a.entity_type END AS entity_type,
    CASE
      WHEN a.entity_type = 'bl_containers' THEN a.field_name || '|' || COALESCE(bc.container_number, '')
      ELSE a.field_name
    END AS field_name,
    a.old_value,
    a.new_value,
    a.changed_by,
    a.changed_at,
    a.justification
  FROM public.audit_logs a
  LEFT JOIN bl_container_ids bc
    ON a.entity_type = 'bl_containers' AND bc.id = a.entity_id
  WHERE public.is_active_read_user()
    AND (
         (a.entity_type = 'bl' AND a.entity_id = p_bl_id)
      OR (a.entity_type = 'bl_container' AND a.entity_id IN (SELECT id FROM bl_container_ids))
      OR (a.entity_type = 'bl_containers'
          AND bc.id IS NOT NULL
          AND a.field_name IN ('discharge_date', 'return_date', 'is_imo', 'imo_class', 'un_number', 'is_oog'))
      OR (a.entity_type = 'charge_calculation' AND a.entity_id IN (
            SELECT cc.id::text FROM public.charge_calculations cc WHERE cc.bl_id = p_bl_id))
      OR (a.entity_type = 'invoice' AND a.entity_id IN (
            SELECT ib.invoice_id::text FROM public.invoice_bls ib WHERE ib.bl_id = p_bl_id))
      OR (a.entity_type = 'system_event' AND a.entity_id = p_bl_id)
    )
  ORDER BY a.changed_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;
