-- 048: a importacao da base cadastral deve respeitar o contato principal.
--
-- O contrato de contatos exige exatamente um contato principal ativo com
-- e-mail. A migration 016 inseria todos os e-mails importados com
-- is_primary=false; isso deixava a ficha sem principal apesar de a importacao
-- terminar com sucesso. A primeira linha nova torna-se principal somente
-- quando ainda nao existe um principal ativo; as seguintes permanecem
-- adicionais.

CREATE OR REPLACE FUNCTION public.apply_customer_base_row_atomic(
  p_cnpj text,
  p_name text,
  p_trade_name text,
  p_address text,
  p_city text,
  p_state text,
  p_zip text,
  p_emails jsonb,
  p_changed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cnpj text := NULLIF(btrim(COALESCE(p_cnpj, '')), '');
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_customer_id bigint;
  v_created boolean := false;
  v_email text;
  v_norm text;
  v_seen text[] := ARRAY[]::text[];
  v_contacts_created integer := 0;
  v_bls_linked integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_cnpj IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'CNPJ e razao social obrigatorios.' USING ERRCODE = '22023';
  END IF;
  IF p_emails IS NULL OR jsonb_typeof(p_emails) <> 'array' OR jsonb_array_length(p_emails) = 0 THEN
    RAISE EXCEPTION 'Ao menos um e-mail obrigatorio.' USING ERRCODE = '22023';
  END IF;

  -- Lock por cliente: serializa concorrentes do mesmo CNPJ.
  SELECT id INTO v_customer_id FROM public.customers WHERE cnpj_cpf = v_cnpj FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.customers(
      cnpj_cpf, name, trade_name, address, city, state, zip, notes, pending_balance
    ) VALUES (
      v_cnpj, v_name,
      NULLIF(btrim(COALESCE(p_trade_name, '')), ''),
      NULLIF(btrim(COALESCE(p_address, '')), ''),
      NULLIF(btrim(COALESCE(p_city, '')), ''),
      NULLIF(upper(btrim(COALESCE(p_state, ''))), ''),
      NULLIF(btrim(COALESCE(p_zip, '')), ''),
      NULL, 0
    ) RETURNING id INTO v_customer_id;
    v_created := true;
  ELSE
    UPDATE public.customers
      SET name = v_name,
          trade_name = COALESCE(NULLIF(btrim(COALESCE(p_trade_name, '')), ''), trade_name),
          address = COALESCE(NULLIF(btrim(COALESCE(p_address, '')), ''), address),
          city = COALESCE(NULLIF(btrim(COALESCE(p_city, '')), ''), city),
          state = COALESCE(NULLIF(upper(btrim(COALESCE(p_state, ''))), ''), state),
          zip = COALESCE(NULLIF(btrim(COALESCE(p_zip, '')), ''), zip),
          updated_at = now()
      WHERE id = v_customer_id;
  END IF;

  -- Bases anteriores podiam ter um principal sem e-mail. Ele não satisfaz o
  -- contrato atual; a transação só termina depois que algum e-mail elegível
  -- assume a principalidade.
  UPDATE public.customer_contacts AS cc
  SET is_primary = false,
      updated_at = now()
  WHERE cc.customer_id = v_customer_id
    AND cc.is_primary = true
    AND cc.deactivated_at IS NULL
    AND cc.email_normalized IS NULL;

  -- Contatos: valida formato e duplicata no envio; existente e no-op.
  -- O primeiro e-mail elegível assume a principalidade se ainda não houver
  -- um principal ativo com e-mail; a decisão é reavaliada a cada iteração.
  FOR v_email IN SELECT value #>> '{}' FROM jsonb_array_elements(p_emails)
  LOOP
    v_norm := lower(NULLIF(btrim(COALESCE(v_email, '')), ''));
    IF v_norm IS NULL OR v_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'E-mail invalido para o cliente %: %', v_cnpj, COALESCE(v_email, '') USING ERRCODE = '22023';
    END IF;
    IF v_norm = ANY (v_seen) THEN
      RAISE EXCEPTION 'E-mail duplicado no envio: %', v_norm USING ERRCODE = '23505';
    END IF;
    v_seen := array_append(v_seen, v_norm);

    -- Se o endereço já existia como adicional, promovê-lo também corrige
    -- clientes antigos que chegaram sem principal na base cadastral. Um
    -- contato desativado com o mesmo e-mail deve ser reativado; deixá-lo
    -- fora do INSERT abaixo faria o índice único tratar a linha histórica
    -- como duplicata sem criar um principal ativo.
    UPDATE public.customer_contacts AS cc
    SET deactivated_at = NULL,
        is_primary = NOT EXISTS (
          SELECT 1
          FROM public.customer_contacts AS primary_contact
          WHERE primary_contact.customer_id = v_customer_id
            AND primary_contact.is_primary = true
            AND primary_contact.deactivated_at IS NULL
            AND primary_contact.email_normalized IS NOT NULL
        ),
        updated_at = now()
    WHERE cc.customer_id = v_customer_id
      AND cc.email_normalized = v_norm;

    INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
    SELECT
      v_customer_id,
      v_name,
      v_norm,
      'financeiro',
      NOT EXISTS (
        SELECT 1
        FROM public.customer_contacts AS cc
        WHERE cc.customer_id = v_customer_id
          AND cc.is_primary = true
          AND cc.deactivated_at IS NULL
          AND cc.email_normalized IS NOT NULL
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.customer_contacts AS cc
      WHERE cc.customer_id = v_customer_id
        AND cc.deactivated_at IS NULL
        AND lower(btrim(COALESCE(cc.email, ''))) = v_norm
    );
    IF FOUND THEN
      v_contacts_created := v_contacts_created + 1;
    END IF;
  END LOOP;

  -- Vinculo retroativo: so B/Ls ainda sem cliente, mesmo CNPJ.
  UPDATE public.bls AS b
    SET customer_id = v_customer_id
    WHERE b.manifest_customer_cnpj_cpf = v_cnpj
      AND b.customer_id IS NULL;
  GET DIAGNOSTICS v_bls_linked = ROW_COUNT;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'created', v_created,
    'contacts_created', v_contacts_created,
    'bls_linked', v_bls_linked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_customer_base_row_atomic(text, text, text, text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_customer_base_row_atomic(text, text, text, text, text, text, text, jsonb, uuid) TO authenticated;

-- Repara clientes criados pela migration 016 (ou por importadores anteriores)
-- que possuem e-mail ativo mas nenhum principal ativo. DISTINCT ON torna a
-- escolha deterministica e a clausula NOT EXISTS evita tocar clientes que ja
-- foram corrigidos por outra transacao.
UPDATE public.customer_contacts AS cc
SET is_primary = false,
    updated_at = now()
WHERE cc.is_primary = true
  AND cc.deactivated_at IS NULL
  AND cc.email_normalized IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.customer_contacts AS candidate
    WHERE candidate.customer_id = cc.customer_id
      AND candidate.deactivated_at IS NULL
      AND candidate.email_normalized IS NOT NULL
  );

WITH missing_primary AS (
  SELECT DISTINCT ON (cc.customer_id) cc.id
  FROM public.customer_contacts AS cc
  WHERE cc.customer_id IS NOT NULL
    AND cc.deactivated_at IS NULL
    AND cc.email_normalized IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.customer_contacts AS p
      WHERE p.customer_id = cc.customer_id
        AND p.is_primary = true
        AND p.deactivated_at IS NULL
        AND p.email_normalized IS NOT NULL
    )
  ORDER BY cc.customer_id, cc.id ASC
), promoted AS (
  UPDATE public.customer_contacts AS cc
  SET is_primary = true,
      updated_at = now()
  FROM missing_primary
  WHERE cc.id = missing_primary.id
  RETURNING cc.id
)

-- O trigger de INSERT nao roda no backfill; garanta as tres caixas do novo
-- principal sem remover vinculos adicionais existentes.
INSERT INTO public.customer_contact_box_links (contact_id, box_code)
SELECT promoted.id, box.code
FROM promoted
CROSS JOIN public.customer_communication_boxes AS box
WHERE box.active = true
ON CONFLICT DO NOTHING;
