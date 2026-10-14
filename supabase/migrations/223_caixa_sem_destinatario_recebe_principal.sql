-- 223: caixa sem destinatário recebe o contato principal, gravado pelo sistema.
--
-- Problema (lote 1 da identidade, decisão de 2026-10-14): ao abrir a aba
-- Cadastro e contatos, a ficha do Cliente punha o contato principal nas caixas
-- de Comunicado que ficaram sem outro destinatário elegível e pedia ao
-- operador que salvasse, com um aviso âmbar. O responsável decidiu que o
-- sistema grava sozinho e o Histórico registra como feito pelo sistema.
--
-- Mudança: `internal_fill_empty_contact_boxes(p_customer_id)` calcula no
-- servidor as caixas a completar, com a mesma regra da tela
-- (`normalizePrimaryContactBoxes`, src/lib/customerContactDrafts.ts): o
-- principal ativo com e-mail entra em toda caixa ativa sem outro contato
-- ativo, com e-mail e sem supressão; principal sem caixa nenhuma entra em
-- todas. Grava pelo núcleo `_apply_customer_contact_configuration` com origem
-- `sistema`, sem autor e com a justificativa "Caixa sem destinatário", de
-- modo que o evento de contatos e o Histórico saem iguais aos de um
-- salvamento. O navegador só pede; não manda a alteração, para ninguém gravar
-- outra mudança com a assinatura do sistema.
--
-- Só cria função; não reescreve nem apaga linhas fora dela.
-- Rollback: DROP FUNCTION public.internal_fill_empty_contact_boxes(bigint).

CREATE OR REPLACE FUNCTION public.internal_fill_empty_contact_boxes(p_customer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_config jsonb;
  v_primary jsonb;
  v_primary_boxes text[];
  v_added text[] := ARRAY[]::text[];
  v_box record;
  v_contacts jsonb;
BEGIN
  -- Mesmo gate de internal_save_customer_contact_configuration (migration 008).
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND active = true
      AND role IN ('administrativo', 'admin', 'documentacao', 'operator', 'equipamentos')
  ) THEN
    RAISE EXCEPTION 'Permissão negada para editar contatos do cliente.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente % não encontrado.', p_customer_id USING ERRCODE = '02000';
  END IF;

  v_config := public._build_customer_contact_configuration(p_customer_id);
  SELECT contact INTO v_primary
  FROM jsonb_array_elements(v_config->'contacts') AS contact
  WHERE (contact->>'is_primary')::boolean
    AND (contact->>'active')::boolean
    AND position('@' IN coalesce(contact->>'email', '')) > 0
  LIMIT 1;
  IF v_primary IS NULL THEN
    RETURN jsonb_build_object('filled', '[]'::jsonb);
  END IF;

  SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO v_primary_boxes
  FROM jsonb_array_elements_text(v_primary->'box_codes');

  FOR v_box IN SELECT code FROM public.customer_communication_boxes WHERE active ORDER BY sort_order LOOP
    CONTINUE WHEN v_box.code = ANY(v_primary_boxes);
    IF cardinality(v_primary_boxes) = 0 OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_config->'contacts') AS other
      WHERE (other->>'id')::bigint <> (v_primary->>'id')::bigint
        AND (other->>'active')::boolean
        AND coalesce((other->>'sendable')::boolean, false)
        AND other->>'suppression_reason' IS NULL
        AND position('@' IN coalesce(other->>'email', '')) > 0
        AND other->'box_codes' ? v_box.code
    ) THEN
      v_added := v_added || v_box.code;
    END IF;
  END LOOP;

  IF cardinality(v_added) = 0 THEN
    RETURN jsonb_build_object('filled', '[]'::jsonb);
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', (contact->>'id')::bigint,
      'name', contact->>'name',
      'email', contact->>'email',
      'phone', contact->>'phone',
      'is_primary', (contact->>'is_primary')::boolean,
      'active', (contact->>'active')::boolean,
      'box_codes', CASE
        WHEN (contact->>'id')::bigint = (v_primary->>'id')::bigint
          THEN to_jsonb(v_primary_boxes || v_added)
        ELSE contact->'box_codes'
      END
    )
  ) INTO v_contacts
  FROM jsonb_array_elements(v_config->'contacts') AS contact;

  PERFORM public._apply_customer_contact_configuration(
    p_customer_id, v_contacts, 'sistema', NULL, NULL, NULL, 'Caixa sem destinatário'
  );

  RETURN jsonb_build_object('filled', to_jsonb(v_added), 'contact_id', (v_primary->>'id')::bigint);
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_fill_empty_contact_boxes(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.internal_fill_empty_contact_boxes(bigint) TO authenticated, service_role;
