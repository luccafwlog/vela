-- 133: o Histórico do B/L deixa de mostrar como "alteração" o que a
-- importação grava ao criar o B/L.
--
-- A importação cria o B/L e, na mesma transação, grava em audit_logs
-- "Status de revisão: OK → Pendente" (gate canônico) e "NCM: - → <código>"
-- (NCM do documento). Nenhum dos dois é uma alteração: o B/L nunca esteve OK
-- nem sem NCM. Como todo B/L importado recebe essas linhas, o Histórico de
-- todos os B/Ls abria com mudanças que ninguém fez.
--
-- Regra: linha de auditoria do próprio B/L com changed_at = bls.created_at
-- pertence à transação de criação (now() é o instante da transação) e sai da
-- lista. No lugar delas entra um único evento de sistema "B/L criado", no
-- instante da criação. Edições posteriores, inclusive a mesma reimportação em
-- outra transação, continuam aparecendo.
-- ponytail: o filtro é na leitura; as linhas continuam sendo gravadas pela
-- importação. Parar de gravá-las exige mexer em cada caminho de importação,
-- sem ganho visível enquanto a leitura filtra.
--
-- Mantém assinatura, colunas, SECURITY DEFINER e grants. Não reescreve linhas.

CREATE OR REPLACE FUNCTION public.bl_timeline(p_bl_id text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(id bigint, family text, entity_type text, field_name text, old_value text, new_value text, changed_by uuid, changed_at timestamp with time zone, justification text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH bl_container_ids AS (
    SELECT c.id::text AS id, c.container_number
    FROM public.bl_containers c
    WHERE c.bl_id = p_bl_id
  ),
  bl_row AS (
    SELECT b.id, b.created_at FROM public.bls b WHERE b.id = p_bl_id
  ),
  events AS (
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
    WHERE (
           (a.entity_type = 'bl' AND a.entity_id = p_bl_id
            AND a.changed_at IS DISTINCT FROM (SELECT created_at FROM bl_row))
        OR (a.entity_type = 'bl_container' AND a.entity_id IN (SELECT id FROM bl_container_ids))
        OR (a.entity_type = 'bl_containers'
            AND bc.id IS NOT NULL
            AND a.field_name IN ('discharge_date', 'return_date', 'is_imo', 'imo_class', 'un_number', 'is_oog')
            AND NOT EXISTS (
              SELECT 1
              FROM public.audit_logs AS semantic
              WHERE semantic.entity_type = 'bl_container'
                AND semantic.entity_id = a.entity_id
                AND semantic.field_name = a.field_name
                AND semantic.changed_at = a.changed_at
            ))
        OR (a.entity_type = 'charge_calculation' AND a.entity_id IN (
              SELECT cc.id::text FROM public.charge_calculations cc WHERE cc.bl_id = p_bl_id))
        OR (a.entity_type = 'invoice' AND a.entity_id IN (
              SELECT ib.invoice_id::text FROM public.invoice_bls ib WHERE ib.bl_id = p_bl_id))
        OR (a.entity_type = 'system_event' AND a.entity_id = p_bl_id)
      )
    UNION ALL
    -- id 0 não colide: audit_logs.id é identity a partir de 1.
    SELECT 0::bigint, 'sistema', 'system_event', 'bl_created', NULL, 'B/L criado', NULL::uuid, r.created_at, NULL
    FROM bl_row r
    WHERE r.created_at IS NOT NULL
  )
  SELECT e.*
  FROM events e
  WHERE public.is_active_read_user()
  ORDER BY e.changed_at DESC, e.id DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;
