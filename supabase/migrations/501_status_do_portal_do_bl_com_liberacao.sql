-- 501: a ficha do B/L passa a saber se o Cliente pode ser faturado pela
-- Liberação de faturamento sem Portal.
--
-- Antes: `get_bl_portal_status` (047) devolvia só `portal_access_ready`
-- (`customer_portal_access_ready`, a conta do Portal pronta). A ficha tratava
-- toda conta não ativa como pendência do Cliente: a etapa Cliente do trilho
-- Documental ficava vermelha com "Resolver na Revisão" e o bloco Portal dizia
-- "Pronto para faturar: Não", mesmo com Liberação vigente e o B/L fora da
-- Revisão (e até já faturado).
--
-- Agora a RPC devolve também `billing_access_ready`, a mesma condição do gate
-- de emissão e da pendência "Acesso ao portal nao provisionado" da Revisão
-- (`_compute_bl_review_pendencies`, 085): `customer_billing_access_ready`
-- (Portal pronto ou Liberação vigente com contato com e-mail, 084). O resto do
-- corpo é o da 047, sem mudança; `portal_access_ready` continua para o link de
-- Provisionamento do Portal.
--
-- Só redefine função; não reescreve nem apaga linhas.
-- Rollback: reaplicar `get_bl_portal_status` como está na 047.

CREATE OR REPLACE FUNCTION public.get_bl_portal_status(p_bl_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_customer_id BIGINT;
  v_ce_mercante TEXT;
  v_account_situation TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT b.customer_id, b.ce_mercante
  INTO v_customer_id, v_ce_mercante
  FROM public.bls b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT a.account_situation
  INTO v_account_situation
  FROM public.customer_portal_accounts a
  WHERE a.customer_id = v_customer_id;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'ce_mercante', v_ce_mercante,
    'account_situation', v_account_situation,
    'portal_access_ready', public.customer_portal_access_ready(v_customer_id),
    'billing_access_ready', public.customer_billing_access_ready(v_customer_id),
    'notifications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id,
        'type', n.type,
        'title', n.title,
        'created_at', n.created_at,
        'read_at', n.read_at
      ) ORDER BY n.created_at DESC)
      FROM (
        SELECT id, type, title, created_at, read_at
        FROM public.portal_notifications
        WHERE bl_id = p_bl_id
        ORDER BY created_at DESC
        LIMIT 10
      ) n
    ), '[]'::JSONB),
    'open_disputes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'doc_number', d.doc_number,
        'dispute_status', d.dispute_status
      ) ORDER BY d.id DESC)
      FROM public.demurrage_invoices d
      WHERE d.bl_id = p_bl_id
        AND d.dispute_open = true
    ), '[]'::JSONB)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_bl_portal_status(p_bl_id text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bl_portal_status(p_bl_id text) TO authenticated;
