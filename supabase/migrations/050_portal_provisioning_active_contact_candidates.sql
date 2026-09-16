-- 050: candidatos de recuperação do Portal vêm do cadastro canônico de contatos.
--
-- A tela Cadastro & Contatos passou a usar customer_contact_box_links como
-- fonte das caixas de comunicação. Contatos criados por ela podem ter
-- purpose NULL, mas a fila de provisionamento ainda filtrava exclusivamente
-- pelo campo legado e ocultava esses endereços. O campo purpose continua
-- apenas como rótulo compatível com a resposta da fila; ele não governa o
-- roteamento das comunicações.
--
-- Afetados: public.portal_list_provisioning_console e seus consumidores
-- internos (src/services/portalProvisioning.ts e ClientesPortal). A alteração
-- substitui somente a definição da RPC; não cria tabela, índice ou grant novo.
-- É aditiva para o comportamento de leitura: contatos ativos com e-mail
-- passam a aparecer como candidatos, e contatos desativados deixam de aparecer.
-- Rollback: restaurar a definição anterior de portal_list_provisioning_console
-- em banco descartável, preservando a migration aplicada no histórico.

CREATE OR REPLACE FUNCTION public.portal_list_provisioning_console(
  p_customer_id BIGINT DEFAULT NULL
)
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT := public._portal_actor_role();
  v_full_access BOOLEAN := v_role IN ('administrativo', 'documentacao', 'financeiro', 'equipamentos');
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  PERFORM public.portal_repair_missing_accounts();

  RETURN QUERY
  SELECT jsonb_build_object(
    'account_id', a.id,
    'customer_id', c.id,
    'customer_name', c.name,
    'cnpj_cpf', c.cnpj_cpf,
    'provisioning_decision', a.provisioning_decision,
    'account_situation', CASE
      WHEN a.account_situation = 'convite_pendente' AND pi.expires_at < now()
        THEN 'convite_expirado'
      ELSE a.account_situation
    END,
    'recovery_email', CASE WHEN v_full_access THEN a.recovery_email ELSE NULL END,
    'recovery_email_source', CASE WHEN v_full_access THEN a.recovery_email_source ELSE NULL END,
    'pending_invite_expires_at', pi.expires_at,
    'latest_delivery_status', CASE WHEN v_full_access THEN ea.status ELSE NULL END,
    'exception_reason', NULL,
    'last_event_at', ev.created_at,
    'has_critical_alert', EXISTS (
      SELECT 1
      FROM public.alerts al
      LEFT JOIN public.alert_items ai ON ai.alert_id = al.id
      WHERE al.status <> 'closed'
        AND (
          (al.entity_type = 'customer' AND al.entity_id = c.id::text)
          OR (al.entity_type = 'bl' AND EXISTS (
            SELECT 1
            FROM public.bls cb
            WHERE cb.id = al.entity_id AND cb.customer_id = c.id
          ))
        )
        AND (al.type = 'aggregate' OR ai.severity = 'critical' OR al.type = 'portal_abuso_login')
    ),
    'has_open_invoice', EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.customer_id = c.id
        AND i.status IN ('issued', 'overdue', 'partially_paid')
    ),
    'has_active_process', EXISTS (
      SELECT 1
      FROM public.bls b
      WHERE b.customer_id = c.id
        AND b.financial_status IS DISTINCT FROM 'cancelled'
    ),
    -- A fila precisa expor qualquer contato ativo com e-mail. Para contatos
    -- do modelo novo sem purpose, `geral` é somente o rótulo de compatibilidade
    -- da API; elegibilidade e roteamento continuam nas caixas canônicas.
    'candidates', CASE WHEN v_full_access THEN COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'email', cc.email,
          'purpose', COALESCE(cc.purpose, 'geral'),
          'origin', 'Contato do Cliente'
        ) ORDER BY cc.id
      )
      FROM public.customer_contacts cc
      WHERE cc.customer_id = c.id
        AND cc.deactivated_at IS NULL
        AND cc.email_normalized IS NOT NULL
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'recovery_email_status', CASE WHEN v_full_access THEN a.recovery_email_status ELSE NULL END,
    'recovery_email_suppressed', CASE
      WHEN v_full_access AND a.recovery_email IS NOT NULL THEN EXISTS (
        SELECT 1
        FROM public.portal_suppressed_emails s
        WHERE s.email = lower(a.recovery_email)
      )
      ELSE false
    END,
    'shared_email_count', CASE
      WHEN v_full_access AND a.recovery_email IS NOT NULL THEN (
        SELECT count(*)
        FROM public.customer_portal_accounts other
        WHERE lower(other.recovery_email) = lower(a.recovery_email)
          AND other.id <> a.id
      )
      ELSE 0
    END
  )
  FROM public.customer_portal_accounts a
  JOIN public.customers c ON c.id = a.customer_id
  LEFT JOIN LATERAL (
    SELECT expires_at
    FROM public.portal_invites
    WHERE account_id = a.id
      AND purpose = 'convite'
      AND status = 'pendente'
    ORDER BY created_at DESC
    LIMIT 1
  ) pi ON true
  LEFT JOIN LATERAL (
    SELECT status
    FROM public.portal_email_attempts
    WHERE account_id = a.id
    ORDER BY created_at DESC
    LIMIT 1
  ) ea ON true
  LEFT JOIN LATERAL (
    SELECT created_at
    FROM public.portal_provisioning_events
    WHERE customer_id = c.id
    ORDER BY created_at DESC
    LIMIT 1
  ) ev ON true
  WHERE p_customer_id IS NULL OR c.id = p_customer_id
  ORDER BY c.name;
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_list_provisioning_console(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) TO authenticated;
