-- 213 — Importação de B/L e Programação: revisão final da PR 929.
--
-- Achados confirmados pela revisão da PR 929 (reproduções em SQL), corrigidos
-- no servidor, que é a autoridade:
--
-- 1. Troca de Consignatário sem aceite no B/L de container. A
--    `import_bl_freight_transactional_legacy_205` gravava o Consignee, o bloco
--    do consignatário, o CNPJ, a razão social e o e-mail do arquivo mesmo com
--    `relink_customer=false`: o B/L ficava com o Cliente antigo e o
--    consignatário novo. Agora, B/L que já tem Cliente e cujo arquivo aponta
--    outro Cliente (ou um CNPJ diferente do gravado e do Cliente vinculado)
--    mantém esses campos, a retenção de faturamento e a nota de
--    reconciliação; com o aceite eles entram depois da troca aplicada
--    (`legacy_357`), como na carga solta (192, B5); sem o aceite a troca volta
--    em `customer_changes_ignored`.
-- 2. Carga solta (Manifesto BB e B/L avulso) com CNPJ de consignatário não
--    cadastrado. A `import_breakbulk_manifest_transactional_legacy_189` tratava
--    o arquivo sem Cliente como "mantém" e gravava o Consignee novo. Agora o
--    CNPJ diferente do gravado e do Cliente vinculado é Troca de Consignatário:
--    sem aceite, fica em `customer_changes_ignored`; com aceite, o B/L volta
--    para a Reconciliação de Cliente (`relink_bl_customer` sem Cliente, como no
--    B/L de container), recusada quando há financeiro.
-- 3. (No cliente: o Manifesto BB do armador sem CBM manda cubagem null, não
--    zero; a gravação já preservava NULL.)
-- 4. Reimportação de carga solta com um item: o valor que o documento não traz
--    (null ou vazio) fica o gravado, em vez de virar zero ou vazio.
-- 5. B/L de container que muda de POD limpa a exceção de terminal do POD
--    anterior, como na carga solta (174/192) e no COD, com a mesma chave de
--    sessão `vela.bl_terminal_override` e o Histórico do gatilho de auditoria.
-- 6. Carga solta: a correção de POD não zera mais `manifesto_mercante_id` por
--    conta própria; o gatilho `unlink_manifesto_on_route_change` (207) desvincula
--    comparando os portos normalizados e grava o Histórico legível.
-- 7. Programação por planilha: as Viagens já cadastradas do arquivo são
--    travadas em ordem de id antes do laço (deadlock entre dois arquivos com as
--    mesmas Viagens em ordens diferentes).
--
-- Redefine, a partir das definições efetivas, `import_bl_freight_transactional_legacy_205`
-- (194), `import_bl_freight_transactional_legacy_357` (175), `import_breakbulk_manifest_transactional_legacy_189`
-- (192) e `apply_schedule_sheet_atomic_legacy_189` (209). Grants mantidos
-- (funções internas, só o dono executa). Não reescreve nem apaga linhas
-- existentes. Rollback: reaplicar as definições anteriores dessas quatro funções.

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional_legacy_205(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total_bls INTEGER := COALESCE(jsonb_array_length(p_bls), 0);
  v_inserted_freight_lines INTEGER := 0;
  v_locked_bls TEXT[] := ARRAY[]::TEXT[];
  v_unlocked_bls TEXT[] := ARRAY[]::TEXT[];
  v_container_bls TEXT[] := ARRAY[]::TEXT[];
  v_vehicle_bls TEXT[] := ARRAY[]::TEXT[];
  v_weight_locked_bls TEXT[] := ARRAY[]::TEXT[];
  v_billing_hold_bls TEXT[] := ARRAY[]::TEXT[];
  v_imported_bl_ids TEXT[] := ARRAY[]::TEXT[];
  v_bl_id TEXT;
  v_inserted_vehicles INTEGER := 0;
    v_vehicles_skipped INTEGER := 0;
  v_blocked_container TEXT;
  v_blocked_bl TEXT;
  v_blocked_doc TEXT;
  v_blocked_chassis TEXT;
  v_vehicles_discarded JSONB := '[]'::JSONB;
  v_vehicle_pending_bls TEXT[] := ARRAY[]::TEXT[];
  v_vehicle_summary JSONB;
  v_previous_delete_reason TEXT := current_setting('vela.delete_reason', true);
  -- 213: Troca de Consignatário sem aceite e exceção de terminal do POD antigo.
  v_customer_protected TEXT[] := ARRAY[]::TEXT[];
  v_customer_ignored JSONB := '[]'::JSONB;
  v_terminal_cleared TEXT[] := ARRAY[]::TEXT[];
  v_previous_terminal TEXT := current_setting('vela.bl_terminal_override', true);
  v_audited_fields TEXT[] := ARRAY[
    'voyage_id',
    'cargo_mode',
    'shipper',
    'consignee',
    'notify_party',
    'customer_id',
    'customer_reconciliation_status',
    'customer_reconciliation_notes',
    'billing_hold_reason',
    'pol',
    'pod',
    'place_of_delivery',
    'place_of_receipt',
    'movement_from',
    'movement_to',
    'issue_place',
    'cargo_description',
    'total_packages',
    'packages_unit',
    'consignee_phone',
    'total_weight_kg',
    'total_cbm',
    'incoterm',
    'payment_type',
    'bl_emission_date',
    'manifest_customer_cnpj_cpf',
    'manifest_customer_name',
    'manifest_customer_email',
    'notes'
  ];
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar frete do BL.'
      USING ERRCODE = '42501';
  END IF;

  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' THEN
    RAISE EXCEPTION 'Payload de B/Ls invalido.'
      USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE pg_temp.tmp_bl_freight_import (
    id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    voyage_id BIGINT,
    batch_id BIGINT,
    cargo_mode TEXT,
    shipper TEXT,
    consignee TEXT,
    notify_party TEXT,
    consignee_block TEXT,
    shipper_block TEXT,
    notify_block TEXT,
    notify2_block TEXT,
    notify_cnpj_cpf TEXT,
    customer_id BIGINT,
    customer_reconciliation_status TEXT,
    customer_reconciliation_notes TEXT,
    billing_hold_reason TEXT,
    pol TEXT,
    pod TEXT,
    place_of_delivery TEXT,
    place_of_receipt TEXT,
    movement_from TEXT,
    movement_to TEXT,
    issue_place TEXT,
    cargo_description TEXT,
    total_packages INTEGER,
    packages_unit TEXT,
    consignee_phone TEXT,
    total_weight_kg NUMERIC,
    total_cbm NUMERIC,
    incoterm TEXT,
    payment_type TEXT,
    bl_emission_date DATE,
    manifest_customer_cnpj_cpf TEXT,
    manifest_customer_name TEXT,
    manifest_customer_email TEXT,
    notes TEXT,
    billing_locked BOOLEAN NOT NULL DEFAULT false,
    override_billing BOOLEAN NOT NULL DEFAULT false,
    billing_impact BOOLEAN NOT NULL DEFAULT false,
    relink_customer BOOLEAN NOT NULL DEFAULT false
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.tmp_bl_freight_import (
    id,
    payload,
    voyage_id,
    batch_id,
    cargo_mode,
    shipper,
    consignee,
    notify_party,
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    manifest_customer_name,
    manifest_customer_email,
    notes,
    override_billing,
    billing_impact,
    relink_customer
  )
  SELECT
    NULLIF(bl->>'id', ''),
    bl,
    NULLIF(bl->>'voyage_id', '')::BIGINT,
    NULLIF(bl->>'batch_id', '')::BIGINT,
    NULLIF(bl->>'cargo_mode', ''),
    NULLIF(bl->>'shipper', ''),
    NULLIF(bl->>'consignee', ''),
    NULLIF(bl->>'notify_party', ''),
    NULLIF(bl->>'consignee_block', ''),
    NULLIF(bl->>'shipper_block', ''),
    NULLIF(bl->>'notify_block', ''),
    NULLIF(bl->>'notify2_block', ''),
    NULLIF(bl->>'notify_cnpj_cpf', ''),
    NULLIF(bl->>'customer_id', '')::BIGINT,
    reconciliation.status,
    COALESCE(
      NULLIF(bl->>'customer_reconciliation_notes', ''),
      CASE
        WHEN reconciliation.status = 'matched_document' THEN 'Cliente reconciliado automaticamente por CNPJ/CPF.'
        WHEN reconciliation.status = 'matched_name' THEN 'Cliente sugerido por nome; validar documento.'
        ELSE 'Cliente nao encontrado na base cadastral.'
      END
    ),
    COALESCE(
      NULLIF(bl->>'billing_hold_reason', ''),
      CASE
        WHEN reconciliation.status = 'matched_document' THEN NULL
        ELSE 'Aguardando reconciliacao de cliente antes do faturamento.'
      END
    ),
    NULLIF(bl->>'pol', ''),
    NULLIF(bl->>'pod', ''),
    NULLIF(bl->>'place_of_delivery', ''),
    NULLIF(bl->>'place_of_receipt', ''),
    NULLIF(bl->>'movement_from', ''),
    NULLIF(bl->>'movement_to', ''),
    NULLIF(bl->>'issue_place', ''),
    NULLIF(bl->>'cargo_description', ''),
    NULLIF(bl->>'total_packages', '')::INTEGER,
    NULLIF(bl->>'packages_unit', ''),
    NULLIF(bl->>'consignee_phone', ''),
    NULLIF(bl->>'total_weight_kg', '')::NUMERIC,
    NULLIF(bl->>'total_cbm', '')::NUMERIC,
    NULLIF(bl->>'incoterm', ''),
    NULLIF(bl->>'payment_type', ''),
    NULLIF(bl->>'bl_emission_date', '')::DATE,
    public.normalize_document_text(bl->>'manifest_customer_cnpj_cpf'),
    NULLIF(bl->>'manifest_customer_name', ''),
    NULLIF(bl->>'manifest_customer_email', ''),
    NULLIF(bl->>'notes', ''),
    COALESCE(NULLIF(bl->>'override_billing', '')::BOOLEAN, false),
    COALESCE(NULLIF(bl->>'billing_impact', '')::BOOLEAN, false),
    COALESCE(NULLIF(bl->>'relink_customer', '')::BOOLEAN, false)
  FROM jsonb_array_elements(p_bls) AS bl
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      NULLIF(bl->>'customer_reconciliation_status', ''),
      CASE
        WHEN NULLIF(bl->>'customer_id', '') IS NOT NULL THEN 'matched_document'
        ELSE 'missing_customer'
      END
    ) AS status
  ) AS reconciliation;

  IF EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import WHERE id IS NULL) THEN
    RAISE EXCEPTION 'B/L sem identificador no payload de frete.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.tmp_bl_freight_import
    WHERE customer_reconciliation_status NOT IN ('matched_document', 'matched_name', 'missing_customer', 'reconciled')
  ) THEN
    RAISE EXCEPTION 'Status de reconciliacao de cliente invalido no payload de frete.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE pg_temp.tmp_bl_freight_import AS t
  SET billing_locked = EXISTS (
    SELECT 1
    FROM public.charge_calculations AS cc
    WHERE cc.bl_id = t.id
  ) OR EXISTS (
    SELECT 1
    FROM public.invoice_bls AS ib
    WHERE ib.bl_id = t.id
  )
  WHERE EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = t.id
  );

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_locked_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE billing_locked;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_unlocked_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE NOT billing_locked;

  SELECT COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::TEXT[])
  INTO v_weight_locked_bls
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  WHERE t.billing_locked
    AND NOT t.override_billing
    AND b.cargo_mode = 'carga_solta';

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_billing_hold_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE billing_locked
    AND NOT override_billing;

  -- 213 (fix 1): Troca de Consignatário. B/L que já tem Cliente e cujo arquivo
  -- aponta outro Cliente, ou um CNPJ diferente do gravado e do Cliente
  -- vinculado (consignatário não cadastrado), mantém Consignee, bloco do
  -- consignatário, CNPJ, razão social e e-mail. Com o aceite
  -- (`relink_customer`), eles entram só depois de `relink_bl_customer` aplicar
  -- a troca (legacy_357), como na carga solta (192, B5); sem o aceite a troca
  -- ignorada volta em `customer_changes_ignored`.
  SELECT
    COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::TEXT[]),
    COALESCE(jsonb_agg(jsonb_build_object(
      'bl_id', t.id,
      'customer_id', b.customer_id,
      'file_customer_id', t.customer_id,
      'file_document', t.manifest_customer_cnpj_cpf,
      'file_consignee', t.consignee
    ) ORDER BY t.id) FILTER (WHERE NOT t.relink_customer), '[]'::JSONB)
  INTO v_customer_protected, v_customer_ignored
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  WHERE b.customer_id IS NOT NULL
    AND (
      (t.customer_id IS NOT NULL AND t.customer_id <> b.customer_id)
      OR (
        t.customer_id IS NULL
        AND t.manifest_customer_cnpj_cpf IS NOT NULL
        AND t.manifest_customer_cnpj_cpf IS DISTINCT FROM public.normalize_document_text(b.manifest_customer_cnpj_cpf)
        AND t.manifest_customer_cnpj_cpf IS DISTINCT FROM (
          SELECT public.normalize_document_text(c.cnpj_cpf) FROM public.customers AS c WHERE c.id = b.customer_id
        )
      )
    );

  -- 213 (fix 5): a exceção de terminal é do POD anterior. O POD corrigido pelo
  -- arquivo limpa terminal e porto da exceção, como na carga solta (174/192) e
  -- no COD. B/L em COD mantém o POD e a exceção (`_guard_cod_pod_on_reimport`).
  SELECT COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::TEXT[])
  INTO v_terminal_cleared
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  WHERE t.id = ANY(v_unlocked_bls)
    AND t.payload ? 'pod'
    AND public.normalize_port_code(t.pod) IS DISTINCT FROM public.normalize_port_code(b.pod)
    AND (b.terminal_id IS NOT NULL OR b.pod_port_id IS NOT NULL);
  IF cardinality(v_terminal_cleared) > 0 THEN
    PERFORM set_config('vela.bl_terminal_override', 'on', true);
  END IF;

  CREATE TEMP TABLE pg_temp.tmp_old_bl_values ON COMMIT DROP AS
  SELECT
    b.id,
    to_jsonb(b) AS old_row,
    to_jsonb(t) AS new_row,
    t.billing_locked
  FROM public.bls AS b
  JOIN pg_temp.tmp_bl_freight_import AS t ON t.id = b.id;

  INSERT INTO public.bls (
    id,
    voyage_id,
    batch_id,
    cargo_mode,
    shipper,
    consignee,
    notify_party,
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    manifest_customer_name,
    manifest_customer_email,
    notes
  )
  SELECT
    id,
    voyage_id,
    batch_id,
    COALESCE(cargo_mode, 'container'),
    shipper,
    consignee,
    notify_party,
    consignee_block,
    shipper_block,
    notify_block,
    notify2_block,
    notify_cnpj_cpf,
    customer_id,
    customer_reconciliation_status,
    customer_reconciliation_notes,
    billing_hold_reason,
    pol,
    pod,
    place_of_delivery,
    place_of_receipt,
    movement_from,
    movement_to,
    issue_place,
    cargo_description,
    total_packages,
    packages_unit,
    consignee_phone,
    total_weight_kg,
    total_cbm,
    incoterm,
    payment_type,
    bl_emission_date,
    manifest_customer_cnpj_cpf,
    COALESCE(manifest_customer_name, consignee),
    manifest_customer_email,
    notes
  FROM pg_temp.tmp_bl_freight_import
  ON CONFLICT (id) DO UPDATE SET
    voyage_id = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'voyage_id') THEN EXCLUDED.voyage_id ELSE bls.voyage_id END,
    batch_id = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'batch_id') THEN EXCLUDED.batch_id ELSE bls.batch_id END,
    cargo_mode = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'cargo_mode') THEN EXCLUDED.cargo_mode ELSE bls.cargo_mode END,
    shipper = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'shipper') THEN EXCLUDED.shipper ELSE bls.shipper END,
    consignee = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.consignee WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee') THEN EXCLUDED.consignee ELSE bls.consignee END,
    notify_party = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_party') THEN EXCLUDED.notify_party ELSE bls.notify_party END,
    consignee_block = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.consignee_block WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee_block') THEN EXCLUDED.consignee_block ELSE bls.consignee_block END,
    shipper_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'shipper_block') THEN EXCLUDED.shipper_block ELSE bls.shipper_block END,
    notify_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_block') THEN EXCLUDED.notify_block ELSE bls.notify_block END,
    notify2_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify2_block') THEN EXCLUDED.notify2_block ELSE bls.notify2_block END,
    notify_cnpj_cpf = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_cnpj_cpf') THEN EXCLUDED.notify_cnpj_cpf ELSE bls.notify_cnpj_cpf END,
    customer_id = CASE
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_id
      ELSE bls.customer_id
    END,
    customer_reconciliation_status = CASE
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_status
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_status
      WHEN COALESCE(bls.customer_reconciliation_status, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'customer_reconciliation_status')
        THEN EXCLUDED.customer_reconciliation_status
      ELSE bls.customer_reconciliation_status
    END,
    customer_reconciliation_notes = CASE
      -- 213: a Troca de Consignatário sem aplicar não traz a retenção nem a
      -- nota de reconciliação do consignatário do arquivo.
      WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.customer_reconciliation_notes
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_notes
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.customer_reconciliation_notes
      WHEN COALESCE(bls.customer_reconciliation_notes, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'customer_reconciliation_notes')
        THEN EXCLUDED.customer_reconciliation_notes
      ELSE bls.customer_reconciliation_notes
    END,
    billing_hold_reason = CASE
      -- 213: a Troca de Consignatário sem aplicar não traz a retenção nem a
      -- nota de reconciliação do consignatário do arquivo.
      WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.billing_hold_reason
      WHEN bls.customer_id IS NULL
        AND EXCLUDED.customer_id IS NOT NULL
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.billing_hold_reason
      WHEN bls.customer_id = EXCLUDED.customer_id
        AND EXCLUDED.customer_id IS NOT NULL
        AND COALESCE(bls.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
        AND EXCLUDED.customer_reconciliation_status IN ('matched_document', 'matched_name')
        AND EXCLUDED.id <> ALL(v_billing_hold_bls)
        THEN EXCLUDED.billing_hold_reason
      WHEN COALESCE(bls.billing_hold_reason, '') = ''
        AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'billing_hold_reason')
        THEN EXCLUDED.billing_hold_reason
      ELSE bls.billing_hold_reason
    END,
    pol = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'pol') THEN EXCLUDED.pol ELSE bls.pol END,
    pod = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'pod') THEN EXCLUDED.pod ELSE bls.pod END,
    terminal_id = CASE WHEN EXCLUDED.id = ANY(v_terminal_cleared) THEN NULL ELSE bls.terminal_id END,
    pod_port_id = CASE WHEN EXCLUDED.id = ANY(v_terminal_cleared) THEN NULL ELSE bls.pod_port_id END,
    place_of_delivery = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'place_of_delivery') THEN EXCLUDED.place_of_delivery ELSE bls.place_of_delivery END,
    place_of_receipt = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'place_of_receipt') THEN EXCLUDED.place_of_receipt ELSE bls.place_of_receipt END,
    movement_from = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'movement_from') THEN EXCLUDED.movement_from ELSE bls.movement_from END,
    movement_to = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'movement_to') THEN EXCLUDED.movement_to ELSE bls.movement_to END,
    issue_place = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'issue_place') THEN EXCLUDED.issue_place ELSE bls.issue_place END,
    cargo_description = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'cargo_description') THEN EXCLUDED.cargo_description ELSE bls.cargo_description END,
    total_packages = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_packages') THEN EXCLUDED.total_packages ELSE bls.total_packages END,
    packages_unit = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'packages_unit') THEN EXCLUDED.packages_unit ELSE bls.packages_unit END,
    consignee_phone = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee_phone') THEN EXCLUDED.consignee_phone ELSE bls.consignee_phone END,
    total_weight_kg = CASE WHEN EXCLUDED.id <> ALL(v_weight_locked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_weight_kg') THEN EXCLUDED.total_weight_kg ELSE bls.total_weight_kg END,
    total_cbm = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_cbm') THEN EXCLUDED.total_cbm ELSE bls.total_cbm END,
    incoterm = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'incoterm') THEN EXCLUDED.incoterm ELSE bls.incoterm END,
    payment_type = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'payment_type') THEN EXCLUDED.payment_type ELSE bls.payment_type END,
    bl_emission_date = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'bl_emission_date') THEN EXCLUDED.bl_emission_date ELSE bls.bl_emission_date END,
    manifest_customer_cnpj_cpf = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.manifest_customer_cnpj_cpf WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_cnpj_cpf') THEN EXCLUDED.manifest_customer_cnpj_cpf ELSE bls.manifest_customer_cnpj_cpf END,
    manifest_customer_name = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.manifest_customer_name WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_name') THEN EXCLUDED.manifest_customer_name ELSE bls.manifest_customer_name END,
    -- M14: o e-mail anda com o documento do consignatário; protegido junto
    -- com o CNPJ, ele não vira contato do Cliente antigo.
    manifest_customer_email = CASE WHEN EXCLUDED.id = ANY(v_customer_protected) THEN bls.manifest_customer_email WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_email') THEN EXCLUDED.manifest_customer_email ELSE bls.manifest_customer_email END,
    notes = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notes') THEN EXCLUDED.notes ELSE bls.notes END,
    updated_at = now();

  IF cardinality(v_terminal_cleared) > 0 THEN
    PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_terminal, 'off'), true);
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_imported_bl_ids
  FROM pg_temp.tmp_bl_freight_import;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  SELECT
    'bl',
    old_values.id,
    field_name,
    old_values.old_row->>field_name,
    to_jsonb(b)->>field_name,
    p_changed_by,
    CASE
      WHEN old_values.billing_locked THEN 'Importacao automatica de frete do BL; campos operacionais protegidos por faturamento existente'
      ELSE 'Importacao automatica de frete do BL'
    END
  FROM pg_temp.tmp_old_bl_values AS old_values
  JOIN public.bls AS b ON b.id = old_values.id
  CROSS JOIN unnest(v_audited_fields) AS audited(field_name)
  WHERE COALESCE(old_values.old_row->>field_name, '') IS DISTINCT FROM COALESCE(to_jsonb(b)->>field_name, '');

  DELETE FROM public.bl_freight_lines
  WHERE bl_id IN (
    SELECT id
    FROM pg_temp.tmp_bl_freight_import
    WHERE payload ? 'freight_lines'
       OR payload ? 'freightLines'
  );

  INSERT INTO public.bl_freight_lines (
    bl_id,
    seq,
    description,
    category,
    mercante_code,
    currency,
    amount,
    payment
  )
  SELECT
    t.id,
    COALESCE(NULLIF(line.item->>'seq', '')::INTEGER, line.ordinality::INTEGER),
    NULLIF(line.item->>'description', ''),
    NULLIF(line.item->>'category', ''),
    NULLIF(line.item->>'mercante_code', ''),
    NULLIF(line.item->>'currency', ''),
    NULLIF(line.item->>'amount', '')::NUMERIC,
    NULLIF(line.item->>'payment', '')
  FROM pg_temp.tmp_bl_freight_import AS t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(COALESCE(t.payload->'freight_lines', t.payload->'freightLines')) = 'array'
        THEN COALESCE(t.payload->'freight_lines', t.payload->'freightLines')
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS line(item, ordinality);

  GET DIAGNOSTICS v_inserted_freight_lines = ROW_COUNT;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_container_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE (NOT billing_locked OR override_billing)
    AND payload ? 'containers';

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO v_vehicle_bls
  FROM pg_temp.tmp_bl_freight_import
  WHERE (NOT billing_locked OR override_billing)
    AND payload ? 'vehicles';

  -- Containers: reconciliação por número (migration 175, M02). O id, a data de
  -- descarga, a devolução, o status de Demurrage, o local de desova e o perfil
  -- IMO/OOG do container que continua no arquivo ficam; só as colunas do
  -- documento mudam, e só quando mudam. Container ausente do arquivo sai apenas
  -- quando a prévia mostrou a remoção (`remove_containers`); payload sem a
  -- chave mantém a semântica anterior (sai todo ausente).
  CREATE TEMP TABLE pg_temp.tmp_new_containers (
    id BIGINT,
    bl_id TEXT,
    container_number TEXT
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_container_changes (
    bl_id TEXT,
    container_number TEXT,
    change TEXT
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_incoming_containers ON COMMIT DROP AS
  SELECT DISTINCT ON (t.id, upper(btrim(c.item->>'container_number')))
    t.id AS bl_id,
    upper(btrim(c.item->>'container_number')) AS container_number,
    NULLIF(c.item->>'seal_number', '') AS seal_number,
    NULLIF(c.item->>'type', '') AS type,
    NULLIF(c.item->>'tare_weight_kg', '')::NUMERIC AS tare_weight_kg,
    NULLIF(c.item->>'gross_weight_kg', '')::NUMERIC AS gross_weight_kg,
    NULLIF(c.item->>'cbm', '')::NUMERIC AS cbm,
    COALESCE(NULLIF(c.item->>'is_oog', '')::BOOLEAN, false) AS is_oog,
    COALESCE(NULLIF(c.item->>'is_imo', '')::BOOLEAN, false) AS is_imo,
    NULLIF(c.item->>'imo_class', '') AS imo_class,
    NULLIF(c.item->>'un_number', '') AS un_number,
    CASE WHEN upper(btrim(c.item->>'ownership')) IN ('SOC', 'COC') THEN upper(btrim(c.item->>'ownership')) END AS ownership,
    c.ord
  FROM pg_temp.tmp_bl_freight_import AS t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.payload->'containers') = 'array' THEN t.payload->'containers' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS c(item, ord)
  WHERE t.id = ANY(v_container_bls)
    AND NULLIF(btrim(c.item->>'container_number'), '') IS NOT NULL
  ORDER BY t.id, upper(btrim(c.item->>'container_number')), c.ord;

  CREATE TEMP TABLE pg_temp.tmp_removed_containers ON COMMIT DROP AS
  SELECT bc.id, bc.bl_id, upper(btrim(bc.container_number)) AS container_number
  FROM public.bl_containers AS bc
  JOIN pg_temp.tmp_bl_freight_import AS t ON t.id = bc.bl_id
  WHERE t.id = ANY(v_container_bls)
    AND NOT EXISTS (
      SELECT 1 FROM pg_temp.tmp_incoming_containers AS i
      WHERE i.bl_id = bc.bl_id AND i.container_number = upper(btrim(bc.container_number))
    )
    AND (
      NOT (t.payload ? 'remove_containers')
      OR upper(btrim(bc.container_number)) IN (
        SELECT upper(btrim(listed.value))
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(t.payload->'remove_containers') = 'array' THEN t.payload->'remove_containers' ELSE '[]'::jsonb END
        ) AS listed(value)
      )
    );

  SELECT r.container_number, r.bl_id, d.doc_number
    INTO v_blocked_container, v_blocked_bl, v_blocked_doc
  FROM pg_temp.tmp_removed_containers AS r
  JOIN public.demurrage_invoice_items AS di ON di.container_id = r.id
  JOIN public.demurrage_invoices AS d ON d.id = di.invoice_id
  ORDER BY r.bl_id, r.container_number
  LIMIT 1;
  IF v_blocked_container IS NOT NULL THEN
    -- Migration 194 (A2): o item da Invoice de Demurrage trava o container
    -- (ADR 0071, item 3) com a invoice em qualquer situação: cancelar não
    -- destrava (os itens ficam), então a mensagem não manda cancelar.
    RAISE EXCEPTION
      'O container % do B/L % tem a Invoice de Demurrage % e não sai por reimportação.',
      v_blocked_container, v_blocked_bl, v_blocked_doc
      USING ERRCODE = 'P0006';
  END IF;

  WITH updated AS (
    UPDATE public.bl_containers AS bc
    SET
      seal_number = i.seal_number,
      type = i.type,
      tare_weight_kg = i.tare_weight_kg,
      gross_weight_kg = i.gross_weight_kg,
      cbm = i.cbm,
      ownership = CASE
        WHEN i.ownership IS NOT NULL AND bc.ownership_source IS DISTINCT FROM 'manual' THEN i.ownership
        ELSE bc.ownership
      END,
      ownership_source = CASE
        WHEN i.ownership IS NOT NULL AND bc.ownership_source IS DISTINCT FROM 'manual' THEN 'bl'
        ELSE bc.ownership_source
      END
    FROM pg_temp.tmp_incoming_containers AS i
    WHERE i.bl_id = bc.bl_id
      AND i.container_number = upper(btrim(bc.container_number))
      AND (
        bc.seal_number IS DISTINCT FROM i.seal_number
        OR bc.type IS DISTINCT FROM i.type
        OR bc.tare_weight_kg IS DISTINCT FROM i.tare_weight_kg
        OR bc.gross_weight_kg IS DISTINCT FROM i.gross_weight_kg
        OR bc.cbm IS DISTINCT FROM i.cbm
        OR (i.ownership IS NOT NULL AND bc.ownership_source IS DISTINCT FROM 'manual' AND bc.ownership IS DISTINCT FROM i.ownership)
      )
    RETURNING bc.bl_id, upper(btrim(bc.container_number)) AS container_number
  )
  INSERT INTO pg_temp.tmp_container_changes (bl_id, container_number, change)
  SELECT bl_id, container_number, 'updated' FROM updated;

  WITH inserted AS (
    -- Migration 194 (E9-07): IMO/OOG declarado no B/L nasce com origem `bl`,
    -- protegido do Baplie completo (ADR 0078, item 21).
    INSERT INTO public.bl_containers (
      bl_id, container_number, seal_number, type, tare_weight_kg, gross_weight_kg,
      cbm, is_oog, is_imo, imo_class, un_number, profile_source
    )
    SELECT
      i.bl_id, i.container_number, i.seal_number, i.type, i.tare_weight_kg, i.gross_weight_kg,
      i.cbm, i.is_oog, i.is_imo, i.imo_class, i.un_number,
      CASE WHEN i.is_imo OR i.is_oog THEN 'bl' END
    FROM pg_temp.tmp_incoming_containers AS i
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bl_containers AS bc
      WHERE bc.bl_id = i.bl_id AND upper(btrim(bc.container_number)) = i.container_number
    )
    ORDER BY i.bl_id, i.ord
    RETURNING bl_id, upper(btrim(container_number)) AS container_number
  )
  INSERT INTO pg_temp.tmp_container_changes (bl_id, container_number, change)
  SELECT bl_id, container_number, 'inserted' FROM inserted;

  INSERT INTO pg_temp.tmp_new_containers (id, bl_id, container_number)
  SELECT bc.id, bc.bl_id, upper(btrim(bc.container_number))
  FROM public.bl_containers AS bc
  WHERE bc.bl_id IN (
    SELECT id FROM pg_temp.tmp_bl_freight_import
    WHERE id = ANY(v_container_bls) OR id = ANY(v_vehicle_bls)
  );

  -- Veículos (ADR 0078, item 16): a chave `vehicles` só vem quando o arquivo
  -- tem a aba VIN; sem ela nada muda. Com ela, a lista vale por chassi, mas um
  -- B/L que já existia só aplica entradas, saídas e mudanças com
  -- `confirm_vehicle_changes` (a prévia mostrou e o operador confirmou). Chassi
  -- que já está em outro B/L ativo recusa só a linha.
  CREATE TEMP TABLE pg_temp.tmp_incoming_vehicles ON COMMIT DROP AS
  SELECT DISTINCT ON (t.id, upper(btrim(v.item->>'chassis')))
    t.id AS bl_id,
    upper(btrim(v.item->>'chassis')) AS chassis_key,
    btrim(v.item->>'chassis') AS chassis,
    v.item->>'brand' AS brand,
    v.item->>'model' AS model,
    NULLIF(v.item->>'weight_kg', '')::NUMERIC AS weight_kg,
    NULLIF(v.item->>'cbm', '')::NUMERIC AS cbm,
    COALESCE(NULLIF(v.item->>'voyage_id', '')::BIGINT, b.voyage_id) AS voyage_id,
    -- Migration 194 (A2): container que sai pelo arquivo não recebe veículo; a
    -- linha da aba VIN que aponta para ele é recusada como "não está no B/L".
    COALESCE(
      (SELECT given.id FROM (SELECT NULLIF(v.item->>'container_id', '')::BIGINT AS id) AS given
        WHERE NOT EXISTS (SELECT 1 FROM pg_temp.tmp_removed_containers AS r WHERE r.id = given.id)),
      (SELECT c.id FROM pg_temp.tmp_new_containers AS c
        WHERE c.bl_id = t.id AND c.container_number = upper(btrim(NULLIF(v.item->>'container_number', '')))
          AND NOT EXISTS (SELECT 1 FROM pg_temp.tmp_removed_containers AS r WHERE r.id = c.id)
        ORDER BY c.id LIMIT 1)
    ) AS container_id,
    upper(btrim(NULLIF(v.item->>'container_number', ''))) AS container_number,
    -- Migration 194 (A3; ADR 0078, itens 16 e 23, como a 184): chassi em B/L
    -- ou Viagem cancelados não recusa a linha.
    (
      SELECT ov.bl_id FROM public.vehicles AS ov
      JOIN public.bls AS ob ON ob.id = ov.bl_id
      LEFT JOIN public.voyages AS ovy ON ovy.id = ov.voyage_id
      WHERE upper(btrim(ov.chassis)) = upper(btrim(v.item->>'chassis'))
        AND ov.bl_id <> t.id
        AND ob.cancelled_at IS NULL
        AND ovy.status IS DISTINCT FROM 'cancelled'
      ORDER BY ov.bl_id LIMIT 1
    ) AS other_bl_id,
    -- Na mesma Viagem o índice único (voyage_id, chassis) não admite outra
    -- linha: o veículo do B/L cancelado (B/L reemitido) passa para este.
    cancelled_holder.vehicle_id AS cancelled_vehicle_id,
    cancelled_holder.bl_id AS cancelled_bl_id,
    v.ord
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.payload->'vehicles') = 'array' THEN t.payload->'vehicles' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS v(item, ord)
  LEFT JOIN LATERAL (
    SELECT ov.id AS vehicle_id, ov.bl_id
    FROM public.vehicles AS ov
    JOIN public.bls AS ob ON ob.id = ov.bl_id
    WHERE ov.voyage_id = COALESCE(NULLIF(v.item->>'voyage_id', '')::BIGINT, b.voyage_id)
      AND upper(btrim(ov.chassis)) = upper(btrim(v.item->>'chassis'))
      AND ov.bl_id <> t.id
      AND ob.cancelled_at IS NOT NULL
    ORDER BY ov.id LIMIT 1
  ) AS cancelled_holder ON true
  WHERE t.id = ANY(v_vehicle_bls)
    AND NULLIF(btrim(v.item->>'chassis'), '') IS NOT NULL
  ORDER BY t.id, upper(btrim(v.item->>'chassis')), v.ord;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'bl_id', i.bl_id,
      'chassis', i.chassis,
      'reason', CASE
        WHEN i.other_bl_id IS NOT NULL THEN 'Chassi ja esta no B/L ' || i.other_bl_id
        ELSE 'Container ' || COALESCE(i.container_number, '(vazio)') || ' nao esta no B/L'
      END
    ) ORDER BY i.bl_id, i.ord), '[]'::jsonb)
  INTO v_vehicles_discarded
  FROM pg_temp.tmp_incoming_vehicles AS i
  WHERE i.other_bl_id IS NOT NULL OR i.container_id IS NULL;

  DELETE FROM pg_temp.tmp_incoming_vehicles WHERE other_bl_id IS NOT NULL OR container_id IS NULL;

  -- B/L que já existia com mudança de veículos sem confirmação: nada muda.
  SELECT COALESCE(array_agg(DISTINCT pending.bl_id ORDER BY pending.bl_id), ARRAY[]::TEXT[])
  INTO v_vehicle_pending_bls
  FROM (
    SELECT t.id AS bl_id
    FROM pg_temp.tmp_bl_freight_import AS t
    WHERE t.id = ANY(v_vehicle_bls)
      AND t.id IN (SELECT id FROM pg_temp.tmp_old_bl_values)
      AND NOT COALESCE(NULLIF(t.payload->>'confirm_vehicle_changes', '')::BOOLEAN, false)
      AND (
        EXISTS (
          SELECT 1 FROM public.vehicles AS ev
          WHERE ev.bl_id = t.id
            AND NOT EXISTS (SELECT 1 FROM pg_temp.tmp_incoming_vehicles AS i WHERE i.bl_id = t.id AND i.chassis_key = upper(btrim(ev.chassis)))
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(t.payload->'vehicles') AS raw(item)
              WHERE upper(btrim(raw.item->>'chassis')) = upper(btrim(ev.chassis))
            )
        )
        OR EXISTS (
          SELECT 1 FROM pg_temp.tmp_incoming_vehicles AS i
          LEFT JOIN public.vehicles AS ev ON ev.bl_id = i.bl_id AND upper(btrim(ev.chassis)) = i.chassis_key
          WHERE i.bl_id = t.id
            AND (
              ev.id IS NULL
              OR ev.brand IS DISTINCT FROM i.brand
              OR ev.model IS DISTINCT FROM i.model
              OR ev.weight_kg IS DISTINCT FROM i.weight_kg
              OR ev.cbm IS DISTINCT FROM i.cbm
              OR ev.container_id IS DISTINCT FROM i.container_id
            )
        )
      )
  ) AS pending;

  DELETE FROM pg_temp.tmp_incoming_vehicles WHERE bl_id = ANY(v_vehicle_pending_bls);

  CREATE TEMP TABLE pg_temp.tmp_vehicle_changes (
    bl_id TEXT,
    chassis TEXT,
    change TEXT
  ) ON COMMIT DROP;

  WITH updated AS (
    UPDATE public.vehicles AS ev
    SET brand = i.brand, model = i.model, weight_kg = i.weight_kg, cbm = i.cbm,
        container_id = i.container_id, voyage_id = i.voyage_id
    FROM pg_temp.tmp_incoming_vehicles AS i
    WHERE ev.bl_id = i.bl_id
      AND upper(btrim(ev.chassis)) = i.chassis_key
      AND (
        ev.brand IS DISTINCT FROM i.brand
        OR ev.model IS DISTINCT FROM i.model
        OR ev.weight_kg IS DISTINCT FROM i.weight_kg
        OR ev.cbm IS DISTINCT FROM i.cbm
        OR ev.container_id IS DISTINCT FROM i.container_id
        OR ev.voyage_id IS DISTINCT FROM i.voyage_id
      )
    RETURNING ev.bl_id, ev.chassis
  )
  INSERT INTO pg_temp.tmp_vehicle_changes SELECT bl_id, chassis, 'updated' FROM updated;

  WITH removed AS (
    DELETE FROM public.vehicles AS ev
    USING pg_temp.tmp_bl_freight_import AS t
    WHERE ev.bl_id = t.id
      AND t.id = ANY(v_vehicle_bls)
      AND NOT (t.id = ANY(v_vehicle_pending_bls))
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(t.payload->'vehicles') AS raw(item)
        WHERE upper(btrim(raw.item->>'chassis')) = upper(btrim(ev.chassis))
      )
    RETURNING ev.bl_id, ev.chassis
  )
  INSERT INTO pg_temp.tmp_vehicle_changes SELECT bl_id, chassis, 'removed' FROM removed;

  -- Migration 194 (A3): o chassi que estava no B/L cancelado da mesma Viagem
  -- passa para este B/L, com Histórico nos dois B/Ls (e o gatilho de
  -- auditoria do veículo registra B/L, container e Viagem anteriores).
  WITH moved AS (
    UPDATE public.vehicles AS ev
    SET bl_id = i.bl_id, container_id = i.container_id, voyage_id = i.voyage_id,
        brand = i.brand, model = i.model, weight_kg = i.weight_kg, cbm = i.cbm
    FROM pg_temp.tmp_incoming_vehicles AS i
    WHERE ev.id = i.cancelled_vehicle_id
      AND NOT EXISTS (
        SELECT 1 FROM public.vehicles AS cur
        WHERE cur.bl_id = i.bl_id AND upper(btrim(cur.chassis)) = i.chassis_key
      )
    RETURNING ev.bl_id, ev.chassis, i.cancelled_bl_id
  ), moved_log AS (
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    SELECT 'bl', moved.bl_id, 'vehicle_from_cancelled_bl', moved.cancelled_bl_id, moved.chassis, p_changed_by,
      'Reimportacao de B/L: o chassi ' || moved.chassis || ' estava no B/L cancelado ' || moved.cancelled_bl_id || ' e passou para este B/L'
    FROM moved
    UNION ALL
    SELECT 'bl', moved.cancelled_bl_id, 'vehicle_to_reissued_bl', moved.chassis, moved.bl_id, p_changed_by,
      'Reimportacao de B/L: o chassi ' || moved.chassis || ' passou deste B/L cancelado para o B/L ' || moved.bl_id
    FROM moved
  )
  INSERT INTO pg_temp.tmp_vehicle_changes SELECT bl_id, chassis, 'inserted' FROM moved;

  WITH inserted AS (
    INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
    SELECT i.voyage_id, i.container_id, i.bl_id, i.chassis, i.brand, i.model, i.weight_kg, i.cbm
    FROM pg_temp.tmp_incoming_vehicles AS i
    WHERE NOT EXISTS (
      SELECT 1 FROM public.vehicles AS ev
      WHERE ev.bl_id = i.bl_id AND upper(btrim(ev.chassis)) = i.chassis_key
    )
    ORDER BY i.bl_id, i.ord
    RETURNING bl_id, chassis
  )
  INSERT INTO pg_temp.tmp_vehicle_changes SELECT bl_id, chassis, 'inserted' FROM inserted;

  SELECT count(*) INTO v_inserted_vehicles FROM pg_temp.tmp_vehicle_changes WHERE change = 'inserted';
  v_vehicles_skipped := jsonb_array_length(v_vehicles_discarded);

  -- Um alerta registra o B/L que já existia e o que mudou nos veículos.
  FOR v_bl_id, v_vehicle_summary IN
    SELECT vc.bl_id, jsonb_build_object(
      'inserted', COALESCE(jsonb_agg(vc.chassis ORDER BY vc.chassis) FILTER (WHERE vc.change = 'inserted'), '[]'::jsonb),
      'removed', COALESCE(jsonb_agg(vc.chassis ORDER BY vc.chassis) FILTER (WHERE vc.change = 'removed'), '[]'::jsonb),
      'updated', COALESCE(jsonb_agg(vc.chassis ORDER BY vc.chassis) FILTER (WHERE vc.change = 'updated'), '[]'::jsonb)
    )
    FROM pg_temp.tmp_vehicle_changes AS vc
    WHERE vc.bl_id IN (SELECT id FROM pg_temp.tmp_old_bl_values)
    GROUP BY vc.bl_id
    ORDER BY vc.bl_id
  LOOP
    PERFORM public.upsert_alert_item(
      'bl_vehicles_changed_on_reimport',
      'bl',
      v_bl_id,
      format(
        'Veiculos do B/L %s alterados pela reimportacao: %s entraram, %s sairam, %s mudaram.',
        v_bl_id,
        jsonb_array_length(v_vehicle_summary->'inserted'),
        jsonb_array_length(v_vehicle_summary->'removed'),
        jsonb_array_length(v_vehicle_summary->'updated')
      ),
      'bl_import',
      v_vehicle_summary || jsonb_build_object('bl_id', v_bl_id),
      '/bls/' || v_bl_id
    );
  END LOOP;

  -- Remoção do container por último: o veículo que mudou de container já saiu
  -- dele. Veículo que ainda está nele (arquivo sem aba VIN) impede a remoção.
  SELECT r.container_number, r.bl_id, ev.chassis INTO v_blocked_container, v_blocked_bl, v_blocked_chassis
  FROM pg_temp.tmp_removed_containers AS r
  JOIN public.vehicles AS ev ON ev.container_id = r.id
  ORDER BY r.bl_id, r.container_number, ev.chassis
  LIMIT 1;
  IF v_blocked_container IS NOT NULL THEN
    -- Migration 194 (A2): a recusa diz o que prende o veículo; "reimporte com
    -- a aba VIN" só vale quando o arquivo não tem a aba.
    IF NOT EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import AS t WHERE t.id = v_blocked_bl AND t.payload ? 'vehicles') THEN
      RAISE EXCEPTION
        'O container % do B/L % tem veiculos e o arquivo nao o traz. Reimporte com a aba VIN ou mova os veiculos antes de retirar o container.',
        v_blocked_container, v_blocked_bl
        USING ERRCODE = 'P0006';
    ELSIF v_blocked_bl = ANY(v_vehicle_pending_bls) THEN
      RAISE EXCEPTION
        'O container % do B/L % sai pelo arquivo e ainda tem o veículo %: confirme as mudanças de veículos da aba VIN ou mova os veículos antes de retirar o container.',
        v_blocked_container, v_blocked_bl, v_blocked_chassis
        USING ERRCODE = 'P0006';
    ELSE
      RAISE EXCEPTION
        'O container % do B/L % sai pelo arquivo, mas o veículo % continua nele: a aba VIN não o põe em outro container do B/L. Corrija a aba VIN ou mova os veículos antes de retirar o container.',
        v_blocked_container, v_blocked_bl, v_blocked_chassis
        USING ERRCODE = 'P0006';
    END IF;
  END IF;

  PERFORM set_config('vela.delete_reason', 'Reimportacao de B/L: container ausente do arquivo, remocao mostrada na previa', true);
  WITH removed AS (
    DELETE FROM public.bl_containers AS bc
    USING pg_temp.tmp_removed_containers AS r
    WHERE bc.id = r.id
    RETURNING bc.bl_id, upper(btrim(bc.container_number)) AS container_number
  )
  INSERT INTO pg_temp.tmp_container_changes (bl_id, container_number, change)
  SELECT bl_id, container_number, 'removed' FROM removed;
  PERFORM set_config('vela.delete_reason', COALESCE(v_previous_delete_reason, ''), true);

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  SELECT
    'bl',
    t.id,
    'ALTERACAO_OPERACIONAL_BLOQUEADA',
    NULL,
    'billing_locked',
    p_changed_by,
    'Importacao de frete do BL: alteracao com impacto em faturamento bloqueada (sem override do operador)'
  FROM pg_temp.tmp_bl_freight_import AS t
  WHERE t.billing_locked
    AND t.billing_impact
    AND NOT t.override_billing;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    justification
  )
  SELECT
    'bl',
    t.id,
    'FATURAMENTO_SOBRESCRITO',
    NULL,
    'override_billing',
    p_changed_by,
    'Importacao de frete do BL: alteracao com impacto em faturamento aplicada por override do operador'
  FROM pg_temp.tmp_bl_freight_import AS t
  WHERE t.billing_locked
    AND t.billing_impact
    AND t.override_billing;

  PERFORM public.apply_bl_review_gate_after_import(v_imported_bl_ids, p_changed_by);

  UPDATE public.bls AS b
  SET
    review_status = 'pending_review',
    billing_hold_reason = COALESCE(NULLIF(b.billing_hold_reason, ''), 'Aguardando reconciliacao de cliente antes do faturamento.'),
    notes = CASE
      WHEN COALESCE(b.notes, '') ILIKE '%Cliente vinculado por nome; validar CNPJ%' THEN b.notes
      WHEN COALESCE(b.notes, '') ILIKE '%Pendencias de importacao:%'
        THEN b.notes || ', Cliente vinculado por nome; validar CNPJ'
      ELSE CONCAT_WS(E'\n', NULLIF(BTRIM(COALESCE(b.notes, '')), ''), 'Pendencias de importacao: Cliente vinculado por nome; validar CNPJ')
    END
  WHERE b.id = ANY(v_imported_bl_ids)
    AND b.customer_reconciliation_status = 'matched_name'
    AND COALESCE(b.financial_status, 'pending') <> 'invoiced';

  FOREACH v_bl_id IN ARRAY v_imported_bl_ids LOOP
    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

  RETURN jsonb_build_object(
    'bls_received', v_total_bls,
    'freight_lines_inserted', v_inserted_freight_lines,
    'billing_locked', v_locked_bls,
    'operational_updated', v_unlocked_bls,
    'vehicles_inserted', v_inserted_vehicles,
    'vehicles_skipped', v_vehicles_skipped,
    'container_changes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'bl_id', grouped.bl_id,
        'inserted', grouped.inserted,
        'updated', grouped.updated,
        'removed', grouped.removed
      ) ORDER BY grouped.bl_id), '[]'::jsonb)
      FROM (
        SELECT bl_id,
          COALESCE(jsonb_agg(container_number ORDER BY container_number) FILTER (WHERE change = 'inserted'), '[]'::jsonb) AS inserted,
          COALESCE(jsonb_agg(container_number ORDER BY container_number) FILTER (WHERE change = 'updated'), '[]'::jsonb) AS updated,
          COALESCE(jsonb_agg(container_number ORDER BY container_number) FILTER (WHERE change = 'removed'), '[]'::jsonb) AS removed
        FROM pg_temp.tmp_container_changes
        GROUP BY bl_id
      ) AS grouped
    ),
    'vehicle_changes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'bl_id', grouped.bl_id,
        'inserted', grouped.inserted,
        'updated', grouped.updated,
        'removed', grouped.removed
      ) ORDER BY grouped.bl_id), '[]'::jsonb)
      FROM (
        SELECT bl_id,
          COALESCE(jsonb_agg(chassis ORDER BY chassis) FILTER (WHERE change = 'inserted'), '[]'::jsonb) AS inserted,
          COALESCE(jsonb_agg(chassis ORDER BY chassis) FILTER (WHERE change = 'updated'), '[]'::jsonb) AS updated,
          COALESCE(jsonb_agg(chassis ORDER BY chassis) FILTER (WHERE change = 'removed'), '[]'::jsonb) AS removed
        FROM pg_temp.tmp_vehicle_changes
        GROUP BY bl_id
      ) AS grouped
    ),
    'vehicles_discarded', v_vehicles_discarded,
    'vehicle_changes_pending', to_jsonb(v_vehicle_pending_bls),
    'customer_changes_ignored', v_customer_ignored
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional_legacy_357(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_item JSONB;
  v_bl_id TEXT;
  v_billed BOOLEAN;
  v_before public.bls%ROWTYPE;
  v_relinks JSONB := '[]'::JSONB;
  v_relink JSONB;
  v_route_fields TEXT[] := ARRAY['voyage_id', 'pol', 'pod', 'cargo_mode'];
  v_clear_terminal BOOLEAN;
  v_previous_terminal TEXT := current_setting('vela.bl_terminal_override', true);
BEGIN
  v_result := public.import_bl_freight_transactional_legacy_322(p_bls, p_changed_by);

  FOR v_item IN SELECT item FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
  LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;

    SELECT * INTO v_before FROM public.bls WHERE id = v_bl_id;
    CONTINUE WHEN NOT FOUND;

    v_billed :=
      EXISTS (SELECT 1 FROM public.charge_calculations WHERE bl_id = v_bl_id)
      OR EXISTS (SELECT 1 FROM public.invoice_bls WHERE bl_id = v_bl_id);

    -- Rota e viagem de B/L faturado: a 205 as descartava mesmo com override.
    IF v_billed AND COALESCE((v_item->>'override_billing')::BOOLEAN, false) THEN
      -- 213 (fix 5): o POD corrigido limpa a exceção de terminal do POD antigo.
      v_clear_terminal := v_item ? 'pod'
        AND public.normalize_port_code(NULLIF(v_item->>'pod', '')) IS DISTINCT FROM public.normalize_port_code(v_before.pod)
        AND (v_before.terminal_id IS NOT NULL OR v_before.pod_port_id IS NOT NULL);
      IF v_clear_terminal THEN
        PERFORM set_config('vela.bl_terminal_override', 'on', true);
      END IF;
      UPDATE public.bls
      SET
        voyage_id  = CASE WHEN v_item ? 'voyage_id'  THEN NULLIF(v_item->>'voyage_id', '')::BIGINT ELSE voyage_id END,
        pol        = CASE WHEN v_item ? 'pol'        THEN NULLIF(v_item->>'pol', '') ELSE pol END,
        pod        = CASE WHEN v_item ? 'pod'        THEN NULLIF(v_item->>'pod', '') ELSE pod END,
        cargo_mode = CASE WHEN v_item ? 'cargo_mode' THEN COALESCE(NULLIF(v_item->>'cargo_mode', ''), cargo_mode) ELSE cargo_mode END,
        terminal_id = CASE WHEN v_clear_terminal THEN NULL ELSE terminal_id END,
        pod_port_id = CASE WHEN v_clear_terminal THEN NULL ELSE pod_port_id END
      WHERE id = v_bl_id;
      IF v_clear_terminal THEN
        PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_terminal, 'off'), true);
      END IF;

      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      SELECT
        'bl',
        v_bl_id,
        audited.field_name,
        to_jsonb(v_before)->>audited.field_name,
        to_jsonb(b)->>audited.field_name,
        p_changed_by,
        'Reimportacao de B/L faturado com override: rota/viagem sobrescritas'
      FROM public.bls AS b
      CROSS JOIN unnest(v_route_fields) AS audited(field_name)
      WHERE b.id = v_bl_id
        AND COALESCE(to_jsonb(v_before)->>audited.field_name, '')
            IS DISTINCT FROM COALESCE(to_jsonb(b)->>audited.field_name, '');
    END IF;

    -- Troca de consignatário aceita pelo operador no preview.
    IF COALESCE((v_item->>'relink_customer')::BOOLEAN, false) THEN
      v_relink := public.relink_bl_customer(
        v_bl_id,
        NULLIF(v_item->>'customer_id', '')::BIGINT,
        p_changed_by
      );
      v_relinks := v_relinks || jsonb_build_array(v_relink);

      -- Aceitar a troca autoriza também o documento do consignatário: a `205`
      -- protege `manifest_customer_cnpj_cpf`/`_name` em B/L faturado sem
      -- `override_billing`, e sem isto o B/L ficaria com o cliente novo e o
      -- CNPJ antigo. `unchanged` entra junto: o documento pode mudar apontando
      -- para o mesmo cliente já vinculado, e a correção de CNPJ prometida no
      -- preview era descartada.
      IF COALESCE((v_relink->>'applied')::BOOLEAN, false)
         OR COALESCE((v_relink->>'unchanged')::BOOLEAN, false) THEN
        -- 213 (fix 1): a `205` mantém o Consignee e o bloco do consignatário
        -- na Troca de Consignatário; eles entram aqui, com a troca aplicada.
        UPDATE public.bls
        SET
          consignee = CASE
            WHEN v_item ? 'consignee'
              THEN COALESCE(NULLIF(v_item->>'consignee', ''), consignee)
            ELSE consignee
          END,
          consignee_block = CASE
            WHEN v_item ? 'consignee_block'
              THEN COALESCE(NULLIF(v_item->>'consignee_block', ''), consignee_block)
            ELSE consignee_block
          END,
          manifest_customer_cnpj_cpf = CASE
            WHEN v_item ? 'manifest_customer_cnpj_cpf'
              THEN public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf')
            ELSE manifest_customer_cnpj_cpf
          END,
          manifest_customer_name = CASE
            WHEN v_item ? 'manifest_customer_name'
              THEN COALESCE(NULLIF(v_item->>'manifest_customer_name', ''), manifest_customer_name)
            ELSE manifest_customer_name
          END,
          -- M14 (migration 175): o e-mail anda com o documento do novo dono.
          manifest_customer_email = CASE
            WHEN v_item ? 'manifest_customer_email'
              THEN NULLIF(btrim(v_item->>'manifest_customer_email'), '')
            ELSE manifest_customer_email
          END
        WHERE id = v_bl_id;

        -- A fila de reconciliação copia CNPJ e nome do B/L: sincronizada dentro
        -- do relink ela guardava o documento anterior. Idempotente, roda de novo.
        PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_relinks) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(
      ARRAY(SELECT entry->>'bl_id' FROM jsonb_array_elements(v_relinks) AS entry),
      p_changed_by
    );
  END IF;

  RETURN COALESCE(v_result, '{}'::JSONB) || jsonb_build_object('customer_relinks', v_relinks);
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional_legacy_189(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_total_bls integer, p_bls jsonb, p_items jsonb, p_errors jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bls jsonb := COALESCE(p_bls, '[]'::jsonb);
  v_items jsonb := COALESCE(p_items, '[]'::jsonb);
  v_row record;
  v_item jsonb;
  v_before public.bls%ROWTYPE;
  v_after public.bls%ROWTYPE;
  v_bl_id text;
  v_bl_ids text[];
  v_existing_ids text[] := ARRAY[]::text[];
  v_inserted_ids text[] := ARRAY[]::text[];
  v_updated_ids text[] := ARRAY[]::text[];
  v_effect_ids text[];
  v_existing_bb boolean;
  v_incoming_bb boolean;
  v_batch_id bigint;
  v_action_id uuid := gen_random_uuid();
  v_previous_replacement text := current_setting('vela.breakbulk_import_replacement', true);
  v_previous_basis_source text := current_setting('vela.invoice_basis_source', true);
  v_previous_terminal text := current_setting('vela.bl_terminal_override', true);
  v_voyage_label text;
  v_other_label text;
  v_billed boolean;
  v_override boolean;
  v_cod boolean;
  v_in_customer bigint;
  v_customer_mode text;
  v_new_pol text;
  v_new_pod text;
  v_route_locked text[];
  v_relink jsonb;
  v_relinks jsonb := '[]'::jsonb;
  v_customer_ignored jsonb := '[]'::jsonb;
  v_billing_locked jsonb := '[]'::jsonb;
  v_cod_kept jsonb := '[]'::jsonb;
  v_ce_ignored text[];
  v_items_changed boolean;
  v_changed_fields text[];
  v_reasons text[];
  v_human_notes text;
  v_notes text;
  v_review text;
  v_has_live_invoice boolean;
  v_reissues jsonb;
  v_file_document text;
  v_bl_items jsonb;
  v_tracked_fields text[] := ARRAY[
    'shipper', 'consignee', 'notify_party', 'cargo_description', 'pol', 'pod',
    'customer_id', 'manifest_customer_cnpj_cpf', 'manifest_customer_name',
    'bb_machine_qty', 'bb_packages_qty', 'bb_packages_total', 'bb_weight_ton',
    'bb_cbm', 'ncm_codes', 'manifesto_mercante_id'
  ];
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar carga solta.'
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_bls) IS DISTINCT FROM 'array' OR jsonb_typeof(v_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Payload de carga solta invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
    INTO v_bl_ids
  FROM jsonb_array_elements(v_bls) AS source(row);

  SELECT concat_ws(' / ', NULLIF(btrim(ve.name), ''), NULLIF(btrim(v.voyage_number), ''))
    INTO v_voyage_label
  FROM public.voyages AS v
  LEFT JOIN public.vessels AS ve ON ve.id = v.vessel_id
  WHERE v.id = p_voyage_id;

  -- 1. Trava os B/Ls existentes e recusa o lote antes de gravar qualquer coisa.
  FOR v_row IN
    SELECT b.id, b.voyage_id, b.financial_status, b.bb_weight_ton, b.bb_packages_qty,
      source.row AS incoming
    FROM public.bls AS b
    JOIN jsonb_array_elements(v_bls) AS source(row) ON b.id = source.row->>'id'
    ORDER BY b.id
    FOR UPDATE OF b
  LOOP
    v_existing_ids := v_existing_ids || v_row.id;

    IF v_row.voyage_id IS DISTINCT FROM p_voyage_id THEN
      SELECT concat_ws(' / ', NULLIF(btrim(ve.name), ''), NULLIF(btrim(v.voyage_number), ''))
        INTO v_other_label
      FROM public.voyages AS v
      LEFT JOIN public.vessels AS ve ON ve.id = v.vessel_id
      WHERE v.id = v_row.voyage_id;
      RAISE EXCEPTION
        'O B/L % ja esta na Viagem % e o arquivo foi importado na Viagem %. Nenhum B/L do lote foi gravado: confira a Viagem de destino ou corrija a Viagem do B/L pela ficha.',
        v_row.id, COALESCE(v_other_label, v_row.voyage_id::text), COALESCE(v_voyage_label, p_voyage_id::text)
        USING ERRCODE = 'P0005';
    END IF;

    v_existing_bb := COALESCE(v_row.bb_weight_ton, 0) > 0
      OR COALESCE(v_row.bb_packages_qty, 0) > 0
      OR EXISTS (SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = v_row.id);
    v_incoming_bb := COALESCE(NULLIF(v_row.incoming->>'bb_weight_ton', '')::numeric, 0) > 0
      OR COALESCE(NULLIF(v_row.incoming->>'bb_packages_qty', '')::numeric, 0) > 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_items) AS item(row)
        WHERE item.row->>'bl_id' = v_row.id
      );

    IF v_row.financial_status IN ('invoiced', 'paid') AND v_existing_bb AND NOT v_incoming_bb THEN
      RAISE EXCEPTION
        'B/L % ja foi faturado (status financeiro=%); a importacao removeria carga solta. Estorne/refature antes de substituir o manifesto.',
        v_row.id, v_row.financial_status
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
    INTO v_ce_ignored
  FROM jsonb_array_elements(v_bls) AS source(row)
  WHERE NULLIF(btrim(source.row->>'ce_mercante'), '') IS NOT NULL;

  PERFORM set_config('vela.breakbulk_import_replacement', 'on', true);
  PERFORM set_config('vela.invoice_basis_source', 'bl_reimport_correction', true);
  v_batch_id := public.import_manifest_transactional_legacy_165(
    p_filename, p_voyage_id, p_uploaded_by, 'carga_solta', NULL, p_total_bls, 0,
    '[]'::jsonb, '[]'::jsonb, COALESCE(p_errors, '[]'::jsonb)
  );

  -- 2. B/Ls novos: o que o arquivo traz, sem CE.
  WITH inserted AS (
    INSERT INTO public.bls (
      id, voyage_id, batch_id, cargo_mode, shipper, consignee, cargo_description,
      customer_id, suggested_customer_id, pol, pod, total_weight_kg, review_status,
      financial_status, notes, manifest_customer_cnpj_cpf, manifest_customer_name,
      manifest_customer_email, customer_reconciliation_status,
      customer_reconciliation_notes, billing_hold_reason, notify_party,
      bb_machine_qty, bb_packages_qty, bb_packages_total, bb_weight_ton, bb_cbm, ncm_codes
    )
    SELECT
      source.row->>'id',
      p_voyage_id,
      v_batch_id,
      'carga_solta',
      NULLIF(source.row->>'shipper', ''),
      source.row->>'consignee',
      NULLIF(source.row->>'cargo_description', ''),
      NULLIF(source.row->>'customer_id', '')::bigint,
      CASE WHEN NULLIF(source.row->>'customer_id', '') IS NULL
        THEN NULLIF(source.row->>'suggested_customer_id', '')::bigint END,
      NULLIF(source.row->>'pol', ''),
      NULLIF(source.row->>'pod', ''),
      NULLIF(source.row->>'total_weight_kg', '')::numeric,
      COALESCE(NULLIF(source.row->>'review_status', ''), 'ok'),
      'pending',
      NULLIF(source.row->>'notes', ''),
      public.normalize_document_text(source.row->>'manifest_customer_cnpj_cpf'),
      COALESCE(NULLIF(source.row->>'manifest_customer_name', ''), source.row->>'consignee'),
      NULLIF(source.row->>'manifest_customer_email', ''),
      COALESCE(NULLIF(source.row->>'customer_reconciliation_status', ''), 'missing_customer'),
      NULLIF(source.row->>'customer_reconciliation_notes', ''),
      NULLIF(source.row->>'billing_hold_reason', ''),
      NULLIF(source.row->>'notify_party', ''),
      NULLIF(source.row->>'bb_machine_qty', '')::numeric,
      NULLIF(source.row->>'bb_packages_qty', '')::numeric,
      NULLIF(source.row->>'bb_packages_total', '')::numeric,
      NULLIF(source.row->>'bb_weight_ton', '')::numeric,
      NULLIF(source.row->>'bb_cbm', '')::numeric,
      COALESCE(public.normalize_ncm_codes(source.row->'ncm_codes'), '{}'::text[])
    FROM jsonb_array_elements(v_bls) AS source(row)
    WHERE NOT (source.row->>'id' = ANY(v_existing_ids))
    RETURNING id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::text[]) INTO v_inserted_ids FROM inserted;

  -- 3. B/Ls existentes: só o que o arquivo traz, B/L a B/L.
  FOR v_item IN
    SELECT source.row FROM jsonb_array_elements(v_bls) AS source(row)
    WHERE source.row->>'id' = ANY(v_existing_ids)
    ORDER BY source.row->>'id'
  LOOP
    v_bl_id := v_item->>'id';
    SELECT * INTO v_before FROM public.bls WHERE id = v_bl_id;

    -- Faturado = fatura viva ou status financeiro faturado/pago. Cálculo sem
    -- fatura não trava a rota: a tela recalcula o B/L alterado.
    v_billed := COALESCE(v_before.financial_status, 'pending') IN ('invoiced', 'paid')
      OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0;
    v_override := COALESCE(NULLIF(v_item->>'override_billing', '')::boolean, false);
    v_cod := EXISTS (
      SELECT 1 FROM public.bl_transshipments AS t
      JOIN public.voyage_omissions AS o ON o.id = t.omission_id
      WHERE t.bl_id = v_bl_id AND t.disposition = 'cod' AND o.reverted_at IS NULL
    );
    v_in_customer := NULLIF(v_item->>'customer_id', '')::bigint;
    v_file_document := public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf');
    v_customer_mode := CASE
      -- 213 (fix 2): CNPJ do arquivo diferente do gravado e do Cliente
      -- vinculado, sem Cliente cadastrado (consignatário não cadastrado), é
      -- Troca de Consignatário: só com o aceite; sem ele, o consignatário fica.
      WHEN v_in_customer IS NULL
        AND v_before.customer_id IS NOT NULL
        AND v_file_document IS NOT NULL
        AND v_file_document IS DISTINCT FROM public.normalize_document_text(v_before.manifest_customer_cnpj_cpf)
        AND v_file_document IS DISTINCT FROM (
          SELECT public.normalize_document_text(c.cnpj_cpf) FROM public.customers AS c WHERE c.id = v_before.customer_id
        )
        THEN CASE WHEN COALESCE(NULLIF(v_item->>'relink_customer', '')::boolean, false) THEN 'relink' ELSE 'ignored' END
      WHEN v_in_customer IS NULL THEN 'keep'
      WHEN v_before.customer_id IS NULL THEN 'link'
      WHEN v_before.customer_id = v_in_customer THEN 'same'
      WHEN COALESCE(NULLIF(v_item->>'relink_customer', '')::boolean, false) THEN 'relink'
      ELSE 'ignored'
    END;

    v_route_locked := ARRAY[]::text[];
    v_new_pol := COALESCE(NULLIF(btrim(v_item->>'pol'), ''), v_before.pol);
    v_new_pod := COALESCE(NULLIF(btrim(v_item->>'pod'), ''), v_before.pod);
    IF v_new_pod IS DISTINCT FROM v_before.pod AND v_cod THEN
      v_cod_kept := v_cod_kept || jsonb_build_object('bl_id', v_bl_id, 'pod', v_before.pod, 'file_pod', v_new_pod);
      v_new_pod := v_before.pod;
    END IF;
    IF v_billed AND NOT v_override THEN
      IF v_new_pol IS DISTINCT FROM v_before.pol THEN
        v_route_locked := v_route_locked || 'pol'::text;
        v_new_pol := v_before.pol;
      END IF;
      IF v_new_pod IS DISTINCT FROM v_before.pod THEN
        v_route_locked := v_route_locked || 'pod'::text;
        v_new_pod := v_before.pod;
      END IF;
      IF cardinality(v_route_locked) > 0 THEN
        v_billing_locked := v_billing_locked || jsonb_build_object('bl_id', v_bl_id, 'fields', to_jsonb(v_route_locked));
      END IF;
    END IF;

    IF v_customer_mode = 'ignored' THEN
      v_customer_ignored := v_customer_ignored || jsonb_build_object(
        'bl_id', v_bl_id,
        'customer_id', v_before.customer_id,
        'file_customer_id', v_in_customer,
        'file_document', v_file_document,
        'file_consignee', NULLIF(v_item->>'consignee', '')
      );
    END IF;

    IF v_new_pod IS DISTINCT FROM v_before.pod
       AND (v_before.terminal_id IS NOT NULL OR v_before.pod_port_id IS NOT NULL) THEN
      PERFORM set_config('vela.bl_terminal_override', 'on', true);
    END IF;

    UPDATE public.bls AS b
    SET
      batch_id = v_batch_id,
      shipper = COALESCE(NULLIF(v_item->>'shipper', ''), b.shipper),
      -- B5 (192): na Troca de Consignatário o Consignee novo só entra se a troca
      -- for aplicada (UPDATE depois de `relink_bl_customer`).
      consignee = CASE WHEN v_customer_mode IN ('ignored', 'relink') THEN b.consignee
        ELSE COALESCE(NULLIF(v_item->>'consignee', ''), b.consignee) END,
      notify_party = COALESCE(NULLIF(v_item->>'notify_party', ''), b.notify_party),
      cargo_description = COALESCE(NULLIF(v_item->>'cargo_description', ''), b.cargo_description),
      pol = v_new_pol,
      pod = v_new_pod,
      -- 213 (fix 6): o desvínculo do Manifesto Mercante é do gatilho
      -- `unlink_manifesto_on_route_change` (207), que compara os portos
      -- normalizados e grava o Histórico legível.
      terminal_id = CASE WHEN v_new_pod IS DISTINCT FROM b.pod THEN NULL ELSE b.terminal_id END,
      pod_port_id = CASE WHEN v_new_pod IS DISTINCT FROM b.pod THEN NULL ELSE b.pod_port_id END,
      customer_id = CASE WHEN v_customer_mode = 'link' THEN v_in_customer ELSE b.customer_id END,
      suggested_customer_id = CASE
        WHEN v_customer_mode = 'link' THEN NULL
        WHEN b.customer_id IS NULL AND v_in_customer IS NULL AND v_item ? 'suggested_customer_id'
          THEN NULLIF(v_item->>'suggested_customer_id', '')::bigint
        ELSE b.suggested_customer_id
      END,
      customer_reconciliation_status = CASE
        WHEN v_customer_mode = 'link' THEN COALESCE(NULLIF(v_item->>'customer_reconciliation_status', ''), 'matched_document')
        WHEN v_customer_mode = 'same'
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' = 'matched_document'
          THEN 'matched_document'
        WHEN b.customer_id IS NULL AND v_in_customer IS NULL
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' IN ('missing_customer', 'matched_name')
          THEN v_item->>'customer_reconciliation_status'
        ELSE b.customer_reconciliation_status
      END,
      customer_reconciliation_notes = CASE
        WHEN v_customer_mode = 'link'
          OR (v_customer_mode = 'same'
            AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
            AND v_item->>'customer_reconciliation_status' = 'matched_document')
          OR (b.customer_id IS NULL AND v_in_customer IS NULL
            AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
            AND v_item->>'customer_reconciliation_status' IN ('missing_customer', 'matched_name'))
          THEN COALESCE(NULLIF(v_item->>'customer_reconciliation_notes', ''), b.customer_reconciliation_notes)
        ELSE b.customer_reconciliation_notes
      END,
      -- B6 (192): com o mesmo Cliente a retenção gravada (ex.: "Acesso ao portal
      -- nao provisionado") fica; só a reconciliação que sobe para documento
      -- troca a retenção pela do arquivo, como no B/L de container (175).
      billing_hold_reason = CASE
        WHEN v_customer_mode = 'link' THEN NULLIF(v_item->>'billing_hold_reason', '')
        WHEN v_customer_mode = 'same'
          AND COALESCE(b.customer_reconciliation_status, 'missing_customer') IN ('missing_customer', 'matched_name')
          AND v_item->>'customer_reconciliation_status' = 'matched_document'
          THEN NULLIF(v_item->>'billing_hold_reason', '')
        ELSE b.billing_hold_reason
      END,
      manifest_customer_cnpj_cpf = CASE
        WHEN v_customer_mode IN ('link', 'same') OR (b.customer_id IS NULL AND v_in_customer IS NULL)
          THEN COALESCE(public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf'), b.manifest_customer_cnpj_cpf)
        ELSE b.manifest_customer_cnpj_cpf
      END,
      manifest_customer_name = CASE
        WHEN v_customer_mode IN ('link', 'same') OR (b.customer_id IS NULL AND v_in_customer IS NULL)
          THEN COALESCE(NULLIF(v_item->>'manifest_customer_name', ''), b.manifest_customer_name)
        ELSE b.manifest_customer_name
      END,
      manifest_customer_email = CASE WHEN v_customer_mode IN ('ignored', 'relink') THEN b.manifest_customer_email
        ELSE COALESCE(NULLIF(v_item->>'manifest_customer_email', ''), b.manifest_customer_email) END,
      bb_machine_qty = COALESCE(NULLIF(v_item->>'bb_machine_qty', '')::numeric, b.bb_machine_qty),
      bb_packages_qty = COALESCE(NULLIF(v_item->>'bb_packages_qty', '')::numeric, b.bb_packages_qty),
      bb_packages_total = COALESCE(NULLIF(v_item->>'bb_packages_total', '')::numeric, b.bb_packages_total),
      bb_weight_ton = COALESCE(NULLIF(v_item->>'bb_weight_ton', '')::numeric, b.bb_weight_ton),
      bb_cbm = COALESCE(NULLIF(v_item->>'bb_cbm', '')::numeric, b.bb_cbm),
      ncm_codes = CASE
        WHEN cardinality(public.normalize_ncm_codes(v_item->'ncm_codes')) > 0
          THEN public.normalize_ncm_codes(v_item->'ncm_codes')
        ELSE b.ncm_codes
      END
    WHERE b.id = v_bl_id;

    PERFORM set_config('vela.bl_terminal_override', COALESCE(v_previous_terminal, 'off'), true);

    IF v_customer_mode = 'relink' THEN
      v_relink := public.relink_bl_customer(v_bl_id, v_in_customer, p_uploaded_by,
        'Troca de Consignatario aceita na reimportacao de carga solta');
      v_relinks := v_relinks || jsonb_build_array(v_relink || jsonb_build_object('bl_id', v_bl_id));
      IF COALESCE((v_relink->>'applied')::boolean, false) THEN
        UPDATE public.bls
        SET consignee = COALESCE(NULLIF(v_item->>'consignee', ''), consignee),
            manifest_customer_cnpj_cpf = COALESCE(public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf'), manifest_customer_cnpj_cpf),
            manifest_customer_name = COALESCE(NULLIF(v_item->>'manifest_customer_name', ''), manifest_customer_name),
            manifest_customer_email = COALESCE(NULLIF(v_item->>'manifest_customer_email', ''), manifest_customer_email)
        WHERE id = v_bl_id;
      END IF;
    END IF;

    -- Itens só são substituídos quando o arquivo os traz e eles mudaram.
    -- 213 (fix 4): com um item gravado e um no arquivo (B/L avulso PDF/DOCX e
    -- Manifesto BB do armador), o valor que o documento não traz (null ou
    -- vazio) fica o gravado: "Valor vazio no arquivo não apaga o valor gravado".
    -- ponytail: com mais de um item não há como parear as linhas; null vira 0
    -- como antes. Só o layout legado traz vários itens, sempre com os números.
    v_items_changed := false;
    SELECT jsonb_agg(item.row) INTO v_bl_items
    FROM jsonb_array_elements(v_items) AS item(row)
    WHERE item.row->>'bl_id' = v_bl_id;
    IF jsonb_array_length(COALESCE(v_bl_items, '[]'::jsonb)) = 1
       AND (SELECT count(*) FROM public.bl_breakbulk_items WHERE bl_id = v_bl_id) = 1 THEN
      SELECT jsonb_build_array(jsonb_build_object(
          'bl_id', v_bl_id,
          'item_description', COALESCE(NULLIF(v_bl_items->0->>'item_description', ''), i.item_description),
          'package_qty', COALESCE(NULLIF(v_bl_items->0->>'package_qty', '')::numeric, i.package_qty),
          'package_unit', COALESCE(NULLIF(v_bl_items->0->>'package_unit', ''), i.package_unit),
          'gross_weight_kg', COALESCE(NULLIF(v_bl_items->0->>'gross_weight_kg', '')::numeric, i.gross_weight_kg),
          'cbm', COALESCE(NULLIF(v_bl_items->0->>'cbm', '')::numeric, i.cbm),
          'marks', COALESCE(NULLIF(v_bl_items->0->>'marks', ''), i.marks)
        ))
        INTO v_bl_items
      FROM public.bl_breakbulk_items AS i
      WHERE i.bl_id = v_bl_id;
    END IF;
    IF v_bl_items IS NOT NULL THEN
      SELECT
        COALESCE((
          SELECT jsonb_agg(jsonb_build_array(i.item_description, i.package_qty, i.package_unit, i.gross_weight_kg, i.cbm, i.marks)
            ORDER BY i.item_description, i.package_qty, i.gross_weight_kg, i.cbm, i.package_unit, i.marks)
          FROM public.bl_breakbulk_items AS i WHERE i.bl_id = v_bl_id
        ), '[]'::jsonb)
        IS DISTINCT FROM
        COALESCE((
          SELECT jsonb_agg(jsonb_build_array(n.item_description, n.package_qty, n.package_unit, n.gross_weight_kg, n.cbm, n.marks)
            ORDER BY n.item_description, n.package_qty, n.gross_weight_kg, n.cbm, n.package_unit, n.marks)
          FROM (
            SELECT
              item.row->>'item_description' AS item_description,
              COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0) AS package_qty,
              NULLIF(item.row->>'package_unit', '') AS package_unit,
              COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0) AS gross_weight_kg,
              COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0) AS cbm,
              NULLIF(item.row->>'marks', '') AS marks
            FROM jsonb_array_elements(v_bl_items) AS item(row)
          ) AS n
        ), '[]'::jsonb)
      INTO v_items_changed;

      IF v_items_changed THEN
        DELETE FROM public.bl_breakbulk_items WHERE bl_id = v_bl_id;
        INSERT INTO public.bl_breakbulk_items (bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks)
        SELECT v_bl_id, item.row->>'item_description',
          COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0),
          NULLIF(item.row->>'package_unit', ''),
          COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0),
          COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0),
          NULLIF(item.row->>'marks', '')
        FROM jsonb_array_elements(v_bl_items) AS item(row);
      END IF;
    END IF;

    SELECT * INTO v_after FROM public.bls WHERE id = v_bl_id;
    SELECT COALESCE(array_agg(f ORDER BY f), ARRAY[]::text[]) INTO v_changed_fields
    FROM unnest(v_tracked_fields) AS f
    WHERE to_jsonb(v_before)->f IS DISTINCT FROM to_jsonb(v_after)->f;
    IF v_items_changed THEN v_changed_fields := v_changed_fields || 'itens_carga_solta'::text; END IF;

    -- Revisão: a pendência de importação é refeita; sem pendência, o status
    -- humano fica e só a pendência antiga sai.
    v_has_live_invoice := EXISTS (
      SELECT 1 FROM public.invoice_bls AS ib JOIN public.invoices AS i ON i.id = ib.invoice_id
      WHERE ib.bl_id = v_bl_id AND i.status NOT IN ('cancelled', 'obsolete')
    );
    IF COALESCE(v_after.financial_status, 'pending') NOT IN ('invoiced', 'paid') AND NOT v_has_live_invoice THEN
      v_reasons := public.compute_bl_review_pendencies(v_bl_id);
      v_human_notes := btrim(regexp_replace(COALESCE(v_after.notes, ''), E'(^|\\n)Pendencias de importacao:[^\\n]*', '', 'gi'));
      v_notes := CASE
        WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(E'\n', NULLIF(v_human_notes, ''),
          'Pendencias de importacao: ' || array_to_string(v_reasons, ', '))
        ELSE NULLIF(v_human_notes, '')
      END;
      v_review := CASE
        WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN 'pending_review'
        WHEN v_after.review_status = 'pending_review' THEN 'ok'
        ELSE v_after.review_status
      END;
      IF v_review IS DISTINCT FROM v_after.review_status OR v_notes IS DISTINCT FROM v_after.notes THEN
        UPDATE public.bls SET review_status = v_review, notes = v_notes WHERE id = v_bl_id;
      END IF;
    END IF;

    IF cardinality(v_changed_fields) > 0 THEN
      v_updated_ids := v_updated_ids || v_bl_id;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES (
        'bl', v_bl_id, 'reimportacao_carga_solta', NULL,
        jsonb_build_object(
          'tipo', 'reimportacao_carga_solta',
          'viagem', COALESCE(v_voyage_label, p_voyage_id::text),
          'rota', concat_ws(' -> ', v_after.pol, v_after.pod),
          'campos', to_jsonb(v_changed_fields)
        )::text,
        p_uploaded_by,
        'Reimportacao de carga solta na Viagem ' || COALESCE(v_voyage_label, p_voyage_id::text)
          || ' (rota ' || concat_ws(' -> ', COALESCE(v_after.pol, '?'), COALESCE(v_after.pod, '?')) || ')'
      );
    END IF;
  END LOOP;

  -- 4. Itens dos B/Ls novos.
  INSERT INTO public.bl_breakbulk_items (bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks)
  SELECT item.row->>'bl_id', item.row->>'item_description',
    COALESCE(NULLIF(item.row->>'package_qty', '')::numeric, 0),
    NULLIF(item.row->>'package_unit', ''),
    COALESCE(NULLIF(item.row->>'gross_weight_kg', '')::numeric, 0),
    COALESCE(NULLIF(item.row->>'cbm', '')::numeric, 0),
    NULLIF(item.row->>'marks', '')
  FROM jsonb_array_elements(v_items) AS item(row)
  WHERE item.row->>'bl_id' = ANY(v_inserted_ids);

  IF cardinality(v_bl_ids) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);
  END IF;
  -- B3 (192): a fila de Reconciliação de Cliente acompanha todo B/L do arquivo
  -- (inseridos e atualizados, inclusive os da Troca de Consignatário), como no
  -- B/L de container (175). O B/L que passa a ter Cliente por CNPJ não deixa
  -- item `pending` velho na fila.
  FOREACH v_bl_id IN ARRAY v_bl_ids LOOP
    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

  -- Efeito de taxas locais só para o que entrou ou mudou: reimportar o mesmo
  -- arquivo não enfileira trabalho.
  v_effect_ids := v_inserted_ids || v_updated_ids;
  FOREACH v_bl_id IN ARRAY v_effect_ids LOOP
    INSERT INTO public.import_pending_effects(
      source_action_id, effect_kind, entity_id, created_by, source_snapshot
    ) VALUES (
      v_action_id, 'local_billing', v_bl_id, p_uploaded_by,
      jsonb_build_object('filename', p_filename, 'voyage_id', p_voyage_id, 'cargo_mode', 'carga_solta')
    )
    ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
  END LOOP;

  v_reissues := COALESCE(public.process_invoice_basis_changes(), '[]'::jsonb);
  PERFORM set_config('vela.invoice_basis_source', COALESCE(v_previous_basis_source, ''), true);
  PERFORM set_config('vela.breakbulk_import_replacement', COALESCE(v_previous_replacement, 'off'), true);

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'breakbulk_bl_ids', to_jsonb(v_bl_ids),
    'inserted_bl_ids', to_jsonb(v_inserted_ids),
    'updated_bl_ids', to_jsonb(v_updated_ids),
    'unchanged_bl_ids', to_jsonb(ARRAY(
      SELECT existing.id FROM unnest(v_existing_ids) AS existing(id)
      WHERE NOT (existing.id = ANY(v_updated_ids)) ORDER BY existing.id
    )),
    'customer_changes_ignored', v_customer_ignored,
    'customer_relinks', v_relinks,
    'billing_locked', v_billing_locked,
    'cod_pod_kept', v_cod_kept,
    'ce_ignored', to_jsonb(v_ce_ignored),
    'invoice_reissues', v_reissues
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_schedule_sheet_atomic_legacy_189(p_rows jsonb, p_carrier_name text, p_carrier_scac text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_row jsonb;
  v_voyage bigint;
  v_vessel bigint;
  v_carrier bigint;
  v_imo text;
  v_vessel_imo text;
  v_name text;
  v_number text;
  v_matches bigint[];
  v_status text;
  v_label text;
  v_created integer := 0;
  v_updated integer := 0;
  v_changes integer := 0;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_count integer;
  v_lock bigint;
  v_checked text[] := ARRAY[]::text[];
  v_stale record;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para atualizar a programação.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Planilha sem linhas.' USING ERRCODE = '22023';
  END IF;

  -- Todas as travas de Viagem nova antes da primeira linha, em ordem fixa
  -- (201): dois arquivos com as mesmas Viagens em ordens diferentes esperam um
  -- pelo outro em vez de se travarem mutuamente (deadlock). Mesmas chaves da
  -- 199: o nome sempre e, com IMO de 7 dígitos, também o IMO.
  FOR v_lock IN
    SELECT DISTINCT hashtextextended(k.lock_key, 0)
    FROM jsonb_array_elements(p_rows) AS r(value)
    CROSS JOIN LATERAL (
      SELECT upper(btrim(COALESCE(r.value->>'voyage_number', ''))) AS number,
             NULLIF(btrim(COALESCE(r.value->>'vessel_name', '')), '') AS name,
             substring(upper(btrim(COALESCE(r.value->>'vessel_imo', ''))) FROM '^(?:IMO[\s:./-]*)?(\d{7})$') AS imo
    ) AS f
    CROSS JOIN LATERAL unnest(ARRAY[
      'schedule_voyage:name:' || upper(f.name) || ':' || f.number,
      'schedule_voyage:imo:' || f.imo || ':' || f.number
    ]) AS k(lock_key)
    WHERE NULLIF(r.value->>'voyage_id', '') IS NULL
      AND f.name IS NOT NULL AND f.number <> '' AND k.lock_key IS NOT NULL
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_lock);
  END LOOP;

  -- 213 (fix 7): as Viagens já cadastradas do arquivo (pelo id ou pelo navio e
  -- número) são travadas antes do laço, em ordem de id. Travadas na ordem do
  -- arquivo (publicação no Portal, conferência da prévia e o snapshot da
  -- agenda), dois arquivos com as mesmas Viagens em ordens diferentes se
  -- travavam mutuamente (deadlock).
  PERFORM 1
  FROM public.voyages AS v
  WHERE v.id IN (
      SELECT NULLIF(r.value->>'voyage_id', '')::bigint
      FROM jsonb_array_elements(p_rows) AS r(value)
      WHERE NULLIF(r.value->>'voyage_id', '') IS NOT NULL
    )
    OR v.id IN (
      SELECT ev.id
      FROM jsonb_array_elements(p_rows) AS r(value)
      CROSS JOIN LATERAL (
        SELECT upper(btrim(COALESCE(r.value->>'voyage_number', ''))) AS number,
               NULLIF(btrim(COALESCE(r.value->>'vessel_name', '')), '') AS name,
               substring(upper(btrim(COALESCE(r.value->>'vessel_imo', ''))) FROM '^(?:IMO[\s:./-]*)?(\d{7})$') AS imo
      ) AS f
      JOIN public.vessels AS s
        ON s.name = f.name
        OR (f.imo IS NOT NULL AND NULLIF(regexp_replace(upper(btrim(COALESCE(s.imo, ''))), '^IMO[\s:./-]*', ''), '') = f.imo)
      JOIN public.voyages AS ev ON ev.vessel_id = s.id AND upper(btrim(ev.voyage_number)) = f.number
      WHERE NULLIF(r.value->>'voyage_id', '') IS NULL AND f.number <> ''
    )
  ORDER BY v.id
  FOR UPDATE OF v;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_voyage := NULLIF(v_row->>'voyage_id', '')::bigint;
    v_number := upper(btrim(COALESCE(v_row->>'voyage_number', '')));
    IF v_voyage IS NULL THEN
      -- IMO só identifica com 7 dígitos (V7), na forma de `normalizeVesselImo`.
      v_imo := substring(upper(btrim(COALESCE(v_row->>'vessel_imo', ''))) FROM '^(?:IMO[\s:./-]*)?(\d{7})$');
      v_name := NULLIF(btrim(COALESCE(v_row->>'vessel_name', '')), '');
      IF v_name IS NULL OR v_number = '' THEN
        RAISE EXCEPTION 'Linha sem navio ou viagem.' USING ERRCODE = '22023';
      END IF;
      -- Duas linhas da mesma Viagem nova, ou um reenvio concorrente, não
      -- duplicam: as travas por nome e IMO desta Viagem já foram pegas antes do
      -- laço, em ordem (199 e 201).

      v_vessel := NULL;
      IF v_imo IS NOT NULL THEN
        SELECT array_agg(id ORDER BY id) INTO v_matches FROM public.vessels
        WHERE NULLIF(regexp_replace(upper(btrim(COALESCE(imo, ''))), '^IMO[\s:./-]*', ''), '') = v_imo;
        IF cardinality(v_matches) > 1 THEN
          RAISE EXCEPTION 'Navio com IMO % ambíguo: mais de um cadastro. Corrija antes de importar.', v_imo USING ERRCODE = '22023';
        END IF;
        v_vessel := v_matches[1];
      END IF;
      IF v_vessel IS NULL THEN
        SELECT array_agg(id ORDER BY id) INTO v_matches FROM public.vessels WHERE name = v_name;
        IF cardinality(v_matches) > 1 THEN
          RAISE EXCEPTION 'Navio % ambíguo: mais de um cadastro. Corrija antes de importar.', v_name USING ERRCODE = '22023';
        END IF;
        v_vessel := v_matches[1];
        -- IMO distinto nunca funde: nome igual com outro IMO cadastrado é conflito.
        IF v_vessel IS NOT NULL AND v_imo IS NOT NULL THEN
          SELECT NULLIF(regexp_replace(upper(btrim(COALESCE(imo, ''))), '^IMO[\s:./-]*', ''), '')
            INTO v_vessel_imo FROM public.vessels WHERE id = v_vessel;
          IF v_vessel_imo IS NOT NULL AND v_vessel_imo <> v_imo THEN
            RAISE EXCEPTION 'Navio % com IMO conflitante (% vs %). Corrija antes de importar.', v_name, v_vessel_imo, v_imo
              USING ERRCODE = '22023';
          END IF;
          -- Navio sem IMO achado pelo nome recebe o IMO do arquivo (202), como
          -- no cadastro pela tela (`getOrCreateVessel`): a linha seguinte com
          -- outra grafia e o mesmo IMO acha este navio, em vez de criar outro.
          IF v_vessel_imo IS NULL THEN
            UPDATE public.vessels SET imo = v_imo WHERE id = v_vessel;
          END IF;
        END IF;
      END IF;

      -- A mesma Viagem pode ter sido criada por outra linha deste arquivo.
      IF v_vessel IS NOT NULL THEN
        SELECT id INTO v_voyage FROM public.voyages
        WHERE vessel_id = v_vessel AND upper(btrim(voyage_number)) = v_number ORDER BY id LIMIT 1;
      END IF;

      IF v_voyage IS NULL THEN
        IF v_vessel IS NULL THEN
          SELECT id INTO v_carrier FROM public.carriers
          WHERE (NULLIF(btrim(COALESCE(p_carrier_scac, '')), '') IS NOT NULL AND scac = btrim(p_carrier_scac))
             OR (NULLIF(btrim(COALESCE(p_carrier_scac, '')), '') IS NULL AND name = btrim(p_carrier_name))
          ORDER BY id LIMIT 1;
          IF v_carrier IS NULL THEN
            INSERT INTO public.carriers(name, scac) VALUES (btrim(p_carrier_name), NULLIF(btrim(COALESCE(p_carrier_scac, '')), ''))
            RETURNING id INTO v_carrier;
          END IF;
          INSERT INTO public.vessels(name, imo, carrier_id) VALUES (v_name, v_imo, v_carrier) RETURNING id INTO v_vessel;
        END IF;
        INSERT INTO public.voyages(vessel_id, voyage_number, pol_id, pod_id, status)
        VALUES (v_vessel, btrim(v_row->>'voyage_number'), NULL, NULL, 'active')
        RETURNING id INTO v_voyage;
        INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES ('voyages', v_voyage::text, 'created', NULL, btrim(v_row->>'voyage_number'), v_actor, 'Atualizacao de dados da viagem');
        v_created := v_created + 1;
      ELSE
        v_updated := v_updated + 1;
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage) THEN
        RAISE EXCEPTION 'Viagem % não encontrada.', v_voyage USING ERRCODE = 'P0002';
      END IF;
      v_updated := v_updated + 1;
    END IF;

    -- Viagem cancelada é somente leitura (V8): recusa com o nome dela, antes
    -- de a trava da Viagem selada responder com mensagem técnica.
    SELECT v.status, btrim(concat_ws(' ', s.name, v.voyage_number)) INTO v_status, v_label
    FROM public.voyages v LEFT JOIN public.vessels s ON s.id = v.vessel_id WHERE v.id = v_voyage;
    IF v_status = 'cancelled' THEN
      RAISE EXCEPTION 'Viagem % cancelada: a programação dela não muda. Retire a linha da planilha.', v_label
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.voyages SET show_on_portal = true WHERE id = v_voyage AND show_on_portal IS DISTINCT FROM true;

    -- Prévia obsoleta (209): a data que a prévia viu (`old_value`) tem de ser
    -- a vigente, ou já a do arquivo (mandar a mesma data de novo não muda
    -- nada). A Viagem é travada antes; a gravação de agenda pela tela também
    -- escreve nela (snapshot), então espera. Cada data é conferida na primeira
    -- linha do arquivo que a traz: as seguintes da mesma Viagem e porto partem
    -- do que a própria planilha gravou.
    PERFORM 1 FROM public.voyages WHERE id = v_voyage FOR UPDATE;
    SELECT x.field, x.port, x.cur INTO v_stale
    FROM (
      SELECT c->>'field_name' AS field, upper(btrim(c->>'port')) AS port,
             NULLIF(btrim(COALESCE(c->>'old_value', '')), '') AS old_v,
             NULLIF(btrim(COALESCE(c->>'new_value', '')), '') AS new_v,
             (SELECT NULLIF(btrim(COALESCE(a.new_value, '')), '') FROM public.audit_logs AS a
               WHERE a.entity_type = c->>'entity_type'
                 AND a.entity_id = v_voyage::text || '::' || upper(btrim(c->>'port'))
                 AND a.field_name = c->>'field_name'
               ORDER BY a.changed_at DESC, a.id DESC LIMIT 1) AS cur,
             v_voyage::text || '::' || (c->>'entity_type') || '::' || upper(btrim(c->>'port')) || '::' || (c->>'field_name') AS key
      FROM jsonb_array_elements(COALESCE(v_row->'changes', '[]'::jsonb)) AS c
      WHERE c->>'entity_type' IN ('voyage_pol_schedule', 'voyage_pod_schedule')
    ) AS x
    WHERE NOT (x.key = ANY(v_checked))
      AND x.cur IS DISTINCT FROM x.old_v AND x.cur IS DISTINCT FROM x.new_v
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'A programação da Viagem % mudou depois da prévia: % em % agora é %. Confira a prévia de novo antes de gravar.',
        v_label, upper(v_stale.field), v_stale.port, COALESCE(v_stale.cur, 'vazia')
        USING ERRCODE = '22023';
    END IF;
    v_checked := v_checked || ARRAY(
      SELECT v_voyage::text || '::' || (c->>'entity_type') || '::' || upper(btrim(c->>'port')) || '::' || (c->>'field_name')
      FROM jsonb_array_elements(COALESCE(v_row->'changes', '[]'::jsonb)) AS c);

    -- Horário próprio por evento (V12): com a mesma Viagem e porto em duas
    -- linhas, a última do arquivo é a vigente para quem lê por horário.
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, changed_at)
    SELECT c->>'entity_type', v_voyage::text || '::' || upper(btrim(c->>'port')), c->>'field_name',
           c->>'old_value', c->>'new_value', v_actor, COALESCE(c->>'justification', ''), clock_timestamp()
    FROM jsonb_array_elements(COALESCE(v_row->'changes', '[]'::jsonb)) WITH ORDINALITY AS e(c, ord)
    WHERE c->>'entity_type' IN ('voyage_pol_schedule', 'voyage_pod_schedule')
    ORDER BY ord;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_changes := v_changes + v_count;
    v_ids := array_append(v_ids, v_voyage);
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'updated', v_updated, 'changes', v_changes, 'voyage_ids', to_jsonb(v_ids));
END $function$;

REVOKE ALL ON FUNCTION public.import_bl_freight_transactional_legacy_205(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.import_bl_freight_transactional_legacy_357(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.import_breakbulk_manifest_transactional_legacy_189(text, bigint, uuid, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_schedule_sheet_atomic_legacy_189(jsonb, text, text) FROM PUBLIC, anon, authenticated;
