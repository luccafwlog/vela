-- 436: CNPJ do Cliente só muda por função, com justificativa (auditoria de
-- segurança run-3, decisão do dono em 2026-10-22).
--
-- `customers.cnpj_cpf` tinha UPDATE de coluna para `authenticated`: qualquer
-- usuário interno trocava o CNPJ de um Cliente sem Conta de Portal direto pela
-- API, sem justificativa. O CNPJ é a chave da Ficha do Cliente
-- (`/clientes/:cnpj`), do login do Portal e do vínculo do B/L pelo manifesto.
--
-- 1. O UPDATE de `customers` por `authenticated` passa a ser por coluna,
--    sem `cnpj_cpf` (o GRANT era da tabela inteira; tirar só a coluna não
--    fechava nada), como a 366 fez em `bls`. O INSERT segue: cadastrar o
--    Cliente informa o CNPJ. Coluna nova de `customers` nasce sem UPDATE
--    direto até alguém concedê-la.
-- 2. `update_customer_with_audit` passa a aceitar `cnpj_cpf`, com a mesma
--    regra dos outros campos: qualquer usuário interno ativo, justificativa
--    obrigatória e histórico em `audit_logs`. Cliente com convite ou Conta de
--    Portal continua só pela troca administrativa (`portal_admin_change_cnpj`,
--    Administrativo).
--
-- Só redefine função e permissão; não reescreve nem apaga linhas.
-- Rollback: `GRANT UPDATE ON public.customers TO authenticated` e
-- reaplicar a definição anterior de `update_customer_with_audit` (002, SECURITY
-- DEFINER desde a 404).

DO $columns_427$
DECLARE v_columns text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'customers' AND column_name <> 'cnpj_cpf';
  EXECUTE 'REVOKE UPDATE ON public.customers FROM authenticated';
  EXECUTE format('GRANT UPDATE (%s) ON public.customers TO authenticated', v_columns);
END;
$columns_427$;

CREATE OR REPLACE FUNCTION public.update_customer_with_audit(p_customer_id bigint, p_updates jsonb, p_changed_by uuid, p_justification text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before public.customers%ROWTYPE;
  v_after public.customers%ROWTYPE;
  v_invalid_key TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para editar cliente.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao para editar cliente.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_justification, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para editar cliente.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_updates) <> 'object' OR p_updates = '{}'::JSONB THEN
    RETURN FALSE;
  END IF;

  SELECT key INTO v_invalid_key
  FROM jsonb_object_keys(p_updates) AS key
  WHERE key NOT IN ('name', 'trade_name', 'address', 'city', 'state', 'zip', 'notes', 'cnpj_cpf')
  LIMIT 1;

  IF v_invalid_key IS NOT NULL THEN
    RAISE EXCEPTION 'Campo de cliente nao editavel: %.', v_invalid_key USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente % nao encontrado.', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  -- 436: o CNPJ só muda por aqui, com justificativa. O gatilho
  -- `portal_protect_customer_cnpj` segue recusando o Cliente com convite ou
  -- Conta de Portal (esse vai por `portal_admin_change_cnpj`), e
  -- `canonicalize_customer_cnpj` normaliza e valida o documento.
  UPDATE public.customers SET
    cnpj_cpf = CASE WHEN p_updates ? 'cnpj_cpf' THEN p_updates->>'cnpj_cpf' ELSE cnpj_cpf END,
    name = CASE WHEN p_updates ? 'name' THEN p_updates->>'name' ELSE name END,
    trade_name = CASE WHEN p_updates ? 'trade_name' THEN NULLIF(p_updates->>'trade_name', '') ELSE trade_name END,
    address = CASE WHEN p_updates ? 'address' THEN NULLIF(p_updates->>'address', '') ELSE address END,
    city = CASE WHEN p_updates ? 'city' THEN NULLIF(p_updates->>'city', '') ELSE city END,
    state = CASE WHEN p_updates ? 'state' THEN NULLIF(p_updates->>'state', '') ELSE state END,
    zip = CASE WHEN p_updates ? 'zip' THEN NULLIF(p_updates->>'zip', '') ELSE zip END,
    notes = CASE WHEN p_updates ? 'notes' THEN NULLIF(p_updates->>'notes', '') ELSE notes END
  WHERE id = p_customer_id
  RETURNING * INTO v_after;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  SELECT 'customer', p_customer_id::TEXT, changed.field_name, changed.old_value, changed.new_value,
    p_changed_by, BTRIM(p_justification)
  FROM (VALUES
    ('cnpj_cpf', v_before.cnpj_cpf, v_after.cnpj_cpf),
    ('name', v_before.name, v_after.name),
    ('trade_name', v_before.trade_name, v_after.trade_name),
    ('address', v_before.address, v_after.address),
    ('city', v_before.city, v_after.city),
    ('state', v_before.state, v_after.state),
    ('zip', v_before.zip, v_after.zip),
    ('notes', v_before.notes, v_after.notes)
  ) AS changed(field_name, old_value, new_value)
  WHERE p_updates ? changed.field_name
    AND changed.old_value IS DISTINCT FROM changed.new_value;

  RETURN TRUE;
END;
$function$;
