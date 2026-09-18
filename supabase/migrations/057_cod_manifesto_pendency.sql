-- 057: Tratamento de COD (Change of Destination) e desvinculo do Manifesto Mercante
--
-- Conforme spec docs/spec/2026-09-17-manifesto-mercante-design.md:
--   Fato 8: O CE do B/L nunca muda; o manifesto do B/L muda.
--   Em COD o B/L deixa de constar no manifesto do porto omitido e passa a constar no do novo destino.
--   Ao alterar o POD do B/L: bls.ce_mercante permanece inalterado.
--   bls.manifesto_mercante_id é limpo (NULL), gerando pendência operacional de vinculação ao manifesto do novo destino.

CREATE OR REPLACE FUNCTION public.set_bl_cod(
  p_bl_id text,
  p_omission_id bigint,
  p_justification text,
  p_changed_by uuid
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_discharge TEXT;
  v_omitted TEXT;
  v_old_pod TEXT;
  v_customer BIGINT;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'Marcar COD exige justificativa.' USING ERRCODE = '22023';
  END IF;

  SELECT o.discharge_pod, o.omitted_pod INTO v_discharge, v_omitted
  FROM public.bl_transshipments AS t
  JOIN public.voyage_omissions AS o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id
  FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id INTO v_old_pod, v_customer
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bl_transshipments
  SET disposition = 'cod', updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  -- Atualiza POD, limpa manifesto_mercante_id (gerando pendencia) e mantem ce_mercante inalterado
  UPDATE public.bls 
  SET pod = v_discharge, 
      manifesto_mercante_id = NULL, 
      updated_at = now() 
  WHERE id = p_bl_id;

  IF to_regprocedure('public.apply_cod_financial_effect(text,bigint,text)') IS NOT NULL THEN
    PERFORM public.apply_cod_financial_effect(p_bl_id, p_omission_id, v_old_pod);
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_discharge, p_changed_by,
    'COD apos omissao da escala de ' || v_omitted || ': ' || v_justification);
  IF v_customer IS NOT NULL THEN
    INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
    VALUES (v_customer, p_bl_id, 'transshipment', 'Destino alterado (COD)',
      'A pedido, o destino final do B/L ' || p_bl_id || ' foi alterado para ' || v_discharge ||
        ' (COD), apos a omissao da escala de ' || v_omitted || '.', NULL);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_bl_cod(text, bigint, text, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_bl_cod(text, bigint, text, uuid) TO authenticated;
