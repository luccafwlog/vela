-- 194 — B/L de container e Baplie: correções da revisão da PR 929 (ADR 0078,
-- itens 16, 21 e 23; ADR 0071, item 3; ADR 0077).
--
-- Importação de B/L de container (núcleo `import_bl_freight_transactional_legacy_205`):
-- A2. Container com Invoice de Demurrage não sai por reimportação, e a recusa
--     diz isso: antes mandava "cancelar a invoice", mas os itens ficam e o
--     container continua travado. Linha da aba VIN que aponta para container
--     que sai pelo arquivo é recusada sozinha ("não está no B/L"), em vez de
--     derrubar o lote com "Reimporte com a aba VIN" num arquivo que tem a aba.
-- A3. Chassi em B/L ou Viagem cancelados não recusa a linha (como a 184 já faz
--     na planilha de Veículos). Na mesma Viagem (B/L reemitido pelo armador) o
--     veículo do B/L cancelado passa para o B/L novo, com Histórico; antes o
--     índice único dava erro cru e o lote inteiro caía.
-- A4. O e-mail do arquivo só vira contato do Cliente com o mesmo CNPJ, agora
--     com as letras do CNPJ alfanumérico (`legacy_322` e
--     `apply_bl_review_gate_after_import`): dois titulares com os mesmos
--     dígitos deixam de se confundir.
-- E9-07. IMO/OOG declarado no B/L grava `profile_source = 'bl'`; o Baplie que
--     o confirma não troca a origem e o Baplie seguinte sem o container não o
--     apaga ("marcas do B/L continuam protegidas").
--
-- Baplie:
-- E9-06. Container Divergente (perfil manual) que troca SOC/COC pelo Baplie
--     entra no recálculo das Taxas Locais, na auditoria e no resultado.
-- E9-14. A aplicação relê cada container travado e não sobrescreve correção
--     manual feita enquanto ela roda.
-- E9-10. "Vale o B/L" de SOC/COC registra só a resolução; a origem continua do
--     B/L e a reimportação ainda corrige o SOC/COC do armador.
-- E9-11. Correção manual de perfil e de SOC/COC e "Vale o B/L" valem para o
--     container em todos os B/Ls ativos da Viagem (Part Lot), com Histórico e
--     recálculo em cada um; B/L faturado em qualquer deles recusa a correção
--     (como já recusava para um B/L só) e B/L cancelado não é ponto de partida.
-- S5. "Vale o B/L" recusa B/L cancelado e divergência que não existe.
--
-- Cada função é redefinida a partir da definição efetiva no banco com as
-- migrations até a 189 (assinatura, SECURITY DEFINER, search_path, guardas e
-- ACL preservados por CREATE OR REPLACE). Não reescreve nem apaga linhas
-- existentes na migration.
--
-- Rollback: reaplicar as definições anteriores destas funções (dump do banco
-- antes desta migration): `import_bl_freight_transactional_legacy_205` e
-- `_legacy_322` e `apply_bl_review_gate_after_import` (175),
-- `_baplie_flag_plan`, `_apply_baplie_physical_flags_before_reissue_126`,
-- `resolve_baplie_divergence` e `set_bl_container_profile` (182) e
-- `set_bl_container_ownership` (121).

-- 1. Núcleo da importação de B/L de container (`_legacy_205`, sob a cadeia
-- with_metadata → … → legacy_284 → legacy_205).
-- A2: container com Invoice de Demurrage "não sai por reimportação" (cancelar a
-- invoice não destrava); linha da aba VIN que aponta para container que sai é
-- recusada sozinha, e a recusa por veículo no container diz o que corrigir.
-- A3: chassi em B/L ou Viagem cancelados não recusa a linha; na mesma Viagem o
-- veículo do B/L cancelado passa para o B/L reemitido (antes: erro 23505 cru
-- que derrubava o lote inteiro).
-- E9-07: container novo com IMO/OOG declarado no B/L grava `profile_source = 'bl'`.
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
    billing_impact BOOLEAN NOT NULL DEFAULT false
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
    billing_impact
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
    COALESCE(NULLIF(bl->>'billing_impact', '')::BOOLEAN, false)
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
    consignee = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee') THEN EXCLUDED.consignee ELSE bls.consignee END,
    notify_party = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notify_party') THEN EXCLUDED.notify_party ELSE bls.notify_party END,
    consignee_block = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee_block') THEN EXCLUDED.consignee_block ELSE bls.consignee_block END,
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
    manifest_customer_cnpj_cpf = CASE WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_cnpj_cpf') THEN EXCLUDED.manifest_customer_cnpj_cpf ELSE bls.manifest_customer_cnpj_cpf END,
    manifest_customer_name = CASE WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_name') THEN EXCLUDED.manifest_customer_name ELSE bls.manifest_customer_name END,
    -- M14: o e-mail anda com o documento do consignatário; protegido junto
    -- com o CNPJ, ele não vira contato do Cliente antigo.
    manifest_customer_email = CASE WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'manifest_customer_email') THEN EXCLUDED.manifest_customer_email ELSE bls.manifest_customer_email END,
    notes = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'notes') THEN EXCLUDED.notes ELSE bls.notes END,
    updated_at = now();

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
    'vehicle_changes_pending', to_jsonb(v_vehicle_pending_bls)
  );
END;
$function$;

-- 2. E-mail do arquivo vira contato do Cliente (`_legacy_322`).
-- A4: o CNPJ era comparado só pelos dígitos (`\D` apagava as letras), e dois
-- CNPJs alfanuméricos de titulares diferentes com os mesmos dígitos se
-- confundiam: o e-mail de outro titular entrava no Cliente do B/L. Agora a
-- comparação usa `normalize_document_text` (o normalizador de `customers`).
CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional_legacy_322(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_bl_id TEXT;
  v_email TEXT;
  v_file_document TEXT;
  v_customer_id BIGINT;
  v_reasons TEXT[];
  v_human_notes TEXT;
  v_notes TEXT;
  v_review_status TEXT;
  v_financial_status TEXT;
  v_new_review_status TEXT;
  v_has_active_invoice BOOLEAN;
BEGIN
  v_result := public.import_bl_freight_transactional_legacy_284(p_bls, p_changed_by);

  FOR v_bl_id, v_email, v_file_document IN
    SELECT item->>'id', NULLIF(btrim(item->>'manifest_customer_email'), ''),
      public.normalize_document_text(item->>'manifest_customer_cnpj_cpf')
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
    WHERE item->>'id' IS NOT NULL
  LOOP
    IF v_email IS NOT NULL THEN
      -- M14 (migration 175): o e-mail do arquivo só vira contato do Cliente
      -- cujo CNPJ é o do arquivo; na Troca de Consignatário ele entra depois
      -- do relink, pelo gate, no Cliente novo. Migration 194 (A4): a
      -- comparação mantém as letras do CNPJ alfanumérico.
      SELECT b.customer_id INTO v_customer_id
      FROM public.bls AS b
      JOIN public.customers AS c ON c.id = b.customer_id
      WHERE b.id = v_bl_id
        AND public.normalize_document_text(c.cnpj_cpf) = v_file_document;
      IF v_customer_id IS NOT NULL THEN
        PERFORM public.ensure_customer_contact_email(v_customer_id, v_email);
      END IF;
    END IF;

    SELECT
      b.notes,
      b.review_status,
      b.financial_status,
      EXISTS (
        SELECT 1
        FROM public.invoice_bls AS ib
        JOIN public.invoices AS i ON i.id = ib.invoice_id
        WHERE ib.bl_id = b.id
          AND i.status NOT IN ('cancelled', 'obsolete')
      )
    INTO v_notes, v_review_status, v_financial_status, v_has_active_invoice
    FROM public.bls AS b
    WHERE b.id = v_bl_id;

    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_financial_status = 'invoiced' OR v_has_active_invoice THEN CONTINUE; END IF;

    v_reasons := public.compute_bl_review_pendencies(v_bl_id);
    v_human_notes := btrim(
      regexp_replace(
        COALESCE(v_notes, ''),
        E'(^|\\n)Pendencias de importacao:[^\\n]*$',
        '',
        'i'
      )
    );
    v_notes := CASE
      WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(
        E'\n',
        NULLIF(v_human_notes, ''),
        'Pendencias de importacao: ' || array_to_string(v_reasons, ', ')
      )
      ELSE NULLIF(v_human_notes, '')
    END;

    v_new_review_status := CASE WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed' ELSE 'pending_review' END;

    UPDATE public.bls
    SET review_status = v_new_review_status,
        notes = v_notes
    WHERE id = v_bl_id;

    IF v_review_status IS DISTINCT FROM v_new_review_status THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
      )
      VALUES (
        'bl', v_bl_id, 'review_status', v_review_status, v_new_review_status, p_changed_by,
        'Gate canonico reaplicado apos e-mail importado'
      );
    END IF;

    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id);
  END LOOP;

  RETURN v_result;
END;
$function$;

-- 3. Gate da Revisão após a importação: a captura do contato do manifesto
-- compara o CNPJ como o `_legacy_322` (A4).
CREATE OR REPLACE FUNCTION public.apply_bl_review_gate_after_import(p_bl_ids text[], p_changed_by uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl RECORD;
  v_reason TEXT;
  v_reasons TEXT[];
  v_notes TEXT;
  v_changed INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para aplicar gate de importacao.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(cardinality(p_bl_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  -- Captura do contato do manifesto na importacao. A regra e a mesma funcao
  -- unica da 370, chamada tambem pela Revisao e pelo Aprovar da Validacao.
  --
  -- Roda ANTES do laco de pendencias, e nao dentro dele, porque o laco faz
  -- CONTINUE quando o B/L nao tem pendencia nenhuma — que e exatamente o caso
  -- do B/L auto-vinculado por CNPJ (`matched_document`), o que mais precisa
  -- desta captura: ninguem abre a Revisao para ele, entao esta e a unica
  -- oportunidade de registrar o contato.
  --
  -- DISTINCT porque um manifesto traz varios B/Ls do mesmo cliente com o mesmo
  -- e-mail: sem ele, as chamadas da mesma instrucao nao enxergam a linha que a
  -- anterior acabou de inserir e o NOT EXISTS interno deixaria passar duplicata.
  PERFORM public.capture_manifest_financial_contact(alvo.customer_id, alvo.email)
  FROM (
    SELECT DISTINCT b.customer_id, lower(btrim(b.manifest_customer_email)) AS email
    FROM public.bls AS b
    JOIN public.customers AS c ON c.id = b.customer_id
    WHERE b.id = ANY(p_bl_ids)
      AND b.customer_id IS NOT NULL
      AND NULLIF(btrim(COALESCE(b.manifest_customer_email, '')), '') IS NOT NULL
      -- M14 (migration 175): só quando o CNPJ do documento é o do Cliente.
      -- Migration 194 (A4): com as letras do CNPJ alfanumérico.
      AND public.normalize_document_text(b.manifest_customer_cnpj_cpf)
        = public.normalize_document_text(c.cnpj_cpf)
  ) AS alvo;

  FOR v_bl IN
    SELECT b.id, b.review_status, b.notes, b.financial_status
    FROM public.bls b
    WHERE b.id = ANY(p_bl_ids)
    ORDER BY b.id
  LOOP
    IF v_bl.financial_status = 'invoiced'
       OR EXISTS (
         SELECT 1
         FROM public.invoice_bls ib
         JOIN public.invoices i ON i.id = ib.invoice_id
         WHERE ib.bl_id = v_bl.id
           AND i.status NOT IN ('cancelled', 'obsolete')
       ) THEN
      CONTINUE;
    END IF;

    v_reasons := public.compute_bl_review_pendencies(v_bl.id);
    IF COALESCE(cardinality(v_reasons), 0) = 0 THEN
      CONTINUE;
    END IF;

    v_notes := v_bl.notes;
    FOREACH v_reason IN ARRAY v_reasons
    LOOP
      IF COALESCE(v_notes, '') NOT ILIKE '%' || v_reason || '%' THEN
        IF COALESCE(v_notes, '') ILIKE '%Pendencias de importacao:%' THEN
          v_notes := v_notes || ', ' || v_reason;
        ELSE
          v_notes := concat_ws(
            E'\n',
            NULLIF(btrim(COALESCE(v_notes, '')), ''),
            'Pendencias de importacao: ' || v_reason
          );
        END IF;
      END IF;
    END LOOP;

    UPDATE public.bls
    SET
      review_status = 'pending_review',
      notes = v_notes
    WHERE id = v_bl.id;

    IF v_bl.review_status IS DISTINCT FROM 'pending_review' THEN
      INSERT INTO public.audit_logs (
        entity_type,
        entity_id,
        field_name,
        old_value,
        new_value,
        changed_by,
        justification
      )
      VALUES (
        'bl',
        v_bl.id,
        'review_status',
        v_bl.review_status,
        'pending_review',
        p_changed_by,
        'Gate canonico aplicado apos importacao'
      );
    END IF;

    PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl.id);
    v_changed := v_changed + 1;
  END LOOP;

  RETURN v_changed;
END;
$function$;

-- 4. Plano do Baplie (E9-07): IMO/OOG declarado no B/L e confirmado pelo
-- Baplie continua com origem `bl`; o Baplie seguinte sem o container não o
-- apaga (só cai o que veio do Baplie).
-- ponytail: a origem é uma só por container (`profile_source`), não por marca.
-- Quando o Baplie muda um perfil vindo do B/L (refina IMO ou acrescenta OOG), a
-- origem passa a `baplie` e um Baplie posterior sem o container zera tudo, sem
-- voltar à declaração do B/L. Saída: origem por marca (IMO e OOG separados).
CREATE OR REPLACE FUNCTION public._baplie_flag_plan(p_voyage_id bigint, p_staged jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(bl_container_id bigint, bl_id text, container_number text, action text, old_is_imo boolean, old_imo_class text, old_un_number text, old_is_oog boolean, old_ownership text, new_is_imo boolean, new_imo_class text, new_un_number text, new_is_oog boolean, new_ownership text, new_ownership_source text, new_profile_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH staged AS (
    SELECT upper(btrim(s.container_number)) AS container_number, s.status, s.is_imo, s.imo_class, s.un_number, s.is_oog, s.ownership
    FROM public.baplie_containers AS s
    WHERE p_staged IS NULL AND s.voyage_id = p_voyage_id
    UNION ALL
    SELECT upper(btrim(r.container_number)), r.status, r.is_imo, r.imo_class, r.un_number, r.is_oog,
      CASE WHEN upper(btrim(r.ownership)) IN ('SOC', 'COC') THEN upper(btrim(r.ownership)) END
    FROM jsonb_to_recordset(COALESCE(p_staged, '[]'::jsonb)) AS r(
      container_number text, status text, is_imo boolean, imo_class text, un_number text, is_oog boolean, ownership text)
    WHERE p_staged IS NOT NULL
  ), desired AS (
    SELECT container_number,
      bool_or(COALESCE(is_imo, false)) AS is_imo,
      max(imo_class) FILTER (WHERE imo_class IS NOT NULL) AS imo_class,
      max(un_number) FILTER (WHERE un_number IS NOT NULL) AS un_number,
      bool_or(COALESCE(is_oog, false)) AS is_oog,
      max(ownership) FILTER (WHERE ownership IS NOT NULL) AS ownership
    FROM staged
    WHERE status = 'full' AND container_number ~ '^[A-Z]{4}[0-9]{7}$'
    GROUP BY container_number
  ), targets AS (
    SELECT c.*, d.container_number AS desired_number, d.is_imo AS d_imo,
      CASE WHEN d.is_imo THEN d.imo_class END AS d_class, CASE WHEN d.is_imo THEN d.un_number END AS d_un,
      d.is_oog AS d_oog, d.ownership AS d_ownership
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    LEFT JOIN desired AS d ON d.container_number = upper(btrim(c.container_number))
    WHERE b.voyage_id = p_voyage_id AND b.cancelled_at IS NULL
  ), planned AS (
    SELECT t.id, t.bl_id, t.container_number,
      t.is_imo AS o_imo, t.imo_class AS o_class, t.un_number AS o_un, t.is_oog AS o_oog, t.ownership AS o_own,
      t.profile_source, t.ownership_source,
      t.desired_number IS NOT NULL AS in_baplie,
      -- Perfil: manual fica; no Baplie, vale o Baplie; fora dele, cai só o que veio do Baplie.
      CASE
        WHEN t.profile_source = 'manual' THEN COALESCE(t.is_imo, false)
        WHEN t.desired_number IS NOT NULL THEN t.d_imo
        WHEN t.profile_source = 'baplie' THEN false
        ELSE COALESCE(t.is_imo, false)
      END AS n_imo,
      CASE
        WHEN t.profile_source = 'manual' THEN t.imo_class
        WHEN t.desired_number IS NOT NULL THEN t.d_class
        WHEN t.profile_source = 'baplie' THEN NULL
        ELSE t.imo_class
      END AS n_class,
      CASE
        WHEN t.profile_source = 'manual' THEN t.un_number
        WHEN t.desired_number IS NOT NULL THEN t.d_un
        WHEN t.profile_source = 'baplie' THEN NULL
        ELSE t.un_number
      END AS n_un,
      CASE
        WHEN t.profile_source = 'manual' THEN COALESCE(t.is_oog, false)
        WHEN t.desired_number IS NOT NULL THEN t.d_oog
        WHEN t.profile_source = 'baplie' THEN false
        ELSE COALESCE(t.is_oog, false)
      END AS n_oog,
      CASE
        WHEN t.profile_source = 'manual' THEN 'manual'
        -- Migration 194 (E9-07): o Baplie que confirma IMO/OOG do B/L não troca
        -- a origem; marca do B/L continua protegida do Baplie completo.
        WHEN t.desired_number IS NOT NULL AND t.profile_source = 'bl'
             AND t.d_imo = COALESCE(t.is_imo, false) AND t.d_oog = COALESCE(t.is_oog, false) THEN 'bl'
        WHEN t.desired_number IS NOT NULL THEN 'baplie'
        WHEN t.profile_source = 'baplie' THEN NULL
        ELSE t.profile_source
      END AS n_profile_source,
      -- SOC/COC: B/L e correção manual são soberanos; fora do Baplie, cai o que veio dele.
      CASE
        WHEN t.ownership_source IN ('bl', 'manual') THEN t.ownership
        WHEN t.desired_number IS NOT NULL THEN t.d_ownership
        ELSE NULL
      END AS n_own,
      CASE
        WHEN t.ownership_source IN ('bl', 'manual') THEN t.ownership_source
        WHEN t.desired_number IS NOT NULL AND t.d_ownership IS NOT NULL THEN 'baplie'
        ELSE NULL
      END AS n_own_source,
      t.d_imo, t.d_oog
    FROM targets AS t
  )
  SELECT p.id, p.bl_id, p.container_number,
    CASE
      WHEN p.profile_source = 'manual' AND p.in_baplie
           AND (p.d_imo IS DISTINCT FROM COALESCE(p.o_imo, false) OR p.d_oog IS DISTINCT FROM COALESCE(p.o_oog, false))
        THEN 'divergent_manual'
      WHEN COALESCE(p.o_imo, false) IS NOT DISTINCT FROM p.n_imo
           AND COALESCE(p.o_oog, false) IS NOT DISTINCT FROM p.n_oog
           AND upper(COALESCE(p.o_class, '')) = upper(COALESCE(p.n_class, ''))
           AND upper(COALESCE(p.o_un, '')) = upper(COALESCE(p.n_un, ''))
           AND p.o_own IS NOT DISTINCT FROM p.n_own
        THEN CASE WHEN p.in_baplie AND p.profile_source IS DISTINCT FROM p.n_profile_source THEN 'source_only' ELSE 'unchanged' END
      WHEN NOT p.in_baplie THEN 'clear'
      ELSE 'apply'
    END,
    COALESCE(p.o_imo, false), p.o_class, p.o_un, COALESCE(p.o_oog, false), p.o_own,
    p.n_imo, p.n_class, p.n_un, p.n_oog, p.n_own, p.n_own_source, p.n_profile_source
  FROM planned AS p;
$function$;

-- 5. Aplicação das marcas do Baplie (núcleo sob o invólucro ADR 0077 da 128 e
-- o do Histórico da 189).
-- E9-06: entra no recálculo, na auditoria e no resultado toda linha cuja marca
-- de cobrança mudou (IMO, classe, ONU, OOG ou SOC/COC), inclusive a Divergente
-- que trocou SOC/COC; antes só `apply`/`clear` entravam e o container que virava
-- SOC continuava pagando Drop Off e Damage Protection.
-- E9-14: o plano é a foto do início do laço; cada linha é relida travada e a
-- correção manual feita durante a aplicação (perfil ou SOC/COC) não é
-- sobrescrita nem volta a `baplie`.
CREATE OR REPLACE FUNCTION public._apply_baplie_physical_flags_before_reissue_126(p_voyage_id bigint, p_changes jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_filter text[] := NULL;
  v_item jsonb;
  v_num text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_cleared jsonb := '[]'::jsonb;
  v_applied_to jsonb := '[]'::jsonb;
  v_divergent jsonb := '[]'::jsonb;
  v_plan record;
  v_row public.bl_containers%ROWTYPE;
  v_profile_ok boolean;
  v_own_ok boolean;
  v_is_imo boolean;
  v_imo_class text;
  v_un_number text;
  v_is_oog boolean;
  v_profile_source text;
  v_ownership text;
  v_ownership_source text;
  v_bl_id text;
  v_action_id uuid := gen_random_uuid();
  v_recalculated integer := 0;
  v_calc_errors jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_voyage_id IS NULL THEN
    RAISE EXCEPTION 'Viagem obrigatoria.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  IF p_changes IS NOT NULL THEN
    IF jsonb_typeof(p_changes) <> 'array' THEN
      RAISE EXCEPTION 'Filtro de flags invalido.' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
      v_num := CASE WHEN jsonb_typeof(v_item) = 'string' THEN upper(btrim(v_item #>> '{}'))
                    ELSE upper(btrim(COALESCE(v_item->>'container_number', ''))) END;
      IF NULLIF(v_num, '') IS NOT NULL THEN v_filter := array_append(v_filter, v_num); END IF;
    END LOOP;
  END IF;

  FOR v_plan IN
    SELECT * FROM public._baplie_flag_plan(p_voyage_id, NULL) AS p
    WHERE p.action IN ('apply', 'clear', 'divergent_manual', 'source_only')
      AND (v_filter IS NULL OR upper(btrim(p.container_number)) = ANY(v_filter))
    ORDER BY p.bl_container_id
  LOOP
    IF v_plan.action = 'divergent_manual' THEN
      v_divergent := v_divergent || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id));
    END IF;

    SELECT * INTO v_row FROM public.bl_containers WHERE id = v_plan.bl_container_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    v_profile_ok := v_row.profile_source IS DISTINCT FROM 'manual';
    v_own_ok := v_row.ownership_source IS DISTINCT FROM 'manual'
      AND v_row.ownership IS NOT DISTINCT FROM v_plan.old_ownership;

    IF v_profile_ok THEN
      v_is_imo := v_plan.new_is_imo;
      v_imo_class := v_plan.new_imo_class;
      v_un_number := v_plan.new_un_number;
      v_is_oog := v_plan.new_is_oog;
      v_profile_source := v_plan.new_profile_source;
    ELSE
      v_is_imo := v_row.is_imo;
      v_imo_class := v_row.imo_class;
      v_un_number := v_row.un_number;
      v_is_oog := v_row.is_oog;
      v_profile_source := v_row.profile_source;
    END IF;
    IF v_own_ok THEN
      v_ownership := v_plan.new_ownership;
      v_ownership_source := v_plan.new_ownership_source;
    ELSE
      v_ownership := v_row.ownership;
      v_ownership_source := v_row.ownership_source;
    END IF;

    UPDATE public.bl_containers AS c
       SET is_imo = v_is_imo,
           imo_class = v_imo_class,
           un_number = v_un_number,
           is_oog = v_is_oog,
           ownership = v_ownership,
           ownership_source = v_ownership_source,
           profile_source = v_profile_source
     WHERE c.id = v_row.id
       AND (c.is_imo IS DISTINCT FROM v_is_imo OR c.imo_class IS DISTINCT FROM v_imo_class
            OR c.un_number IS DISTINCT FROM v_un_number OR c.is_oog IS DISTINCT FROM v_is_oog
            OR c.ownership IS DISTINCT FROM v_ownership OR c.ownership_source IS DISTINCT FROM v_ownership_source
            OR c.profile_source IS DISTINCT FROM v_profile_source);

    IF COALESCE(v_row.is_imo, false) IS DISTINCT FROM COALESCE(v_is_imo, false)
       OR COALESCE(v_row.is_oog, false) IS DISTINCT FROM COALESCE(v_is_oog, false)
       OR v_row.imo_class IS DISTINCT FROM v_imo_class
       OR v_row.un_number IS DISTINCT FROM v_un_number
       OR v_row.ownership IS DISTINCT FROM v_ownership THEN
      v_updated := array_append(v_updated, v_row.id);
      IF v_plan.action = 'clear' THEN
        v_cleared := v_cleared || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id));
      ELSE
        v_applied_to := v_applied_to || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id,
          'flags', public._baplie_flags_label(COALESCE(v_is_imo, false), COALESCE(v_is_oog, false), v_ownership)));
      END IF;
    END IF;
  END LOOP;

  IF cardinality(v_updated) = 0 THEN
    RETURN jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', ARRAY[]::bigint[], 'applied', 0,
      'applied_to', v_applied_to, 'cleared', v_cleared, 'divergent_manual', v_divergent,
      'recalculated', 0, 'calculation_errors', '[]'::jsonb);
  END IF;

  v_role := public.current_actor_role();
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, actor_role, actor_department)
  VALUES ('voyage', p_voyage_id::text, 'baplie_physical_flags',
    jsonb_build_object('voyage_id', p_voyage_id)::text,
    jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', v_updated, 'applied', cardinality(v_updated),
      'cleared', jsonb_array_length(v_cleared))::text,
    v_actor, 'Baplie: marcas físicas aplicadas a todos os B/Ls ativos do container (conjunto atômico)', v_role, v_role);

  FOR v_bl_id IN
    SELECT DISTINCT c.bl_id FROM public.bl_containers AS c JOIN public.bls AS b ON b.id = c.bl_id
    WHERE c.id = ANY (v_updated) AND COALESCE(b.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid')
    ORDER BY 1
  LOOP
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
      v_recalculated := v_recalculated + 1;
    EXCEPTION WHEN OTHERS THEN
      v_calc_errors := v_calc_errors || jsonb_build_array(jsonb_build_object('bl_id', v_bl_id, 'message', SQLERRM));
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('bl', v_bl_id, 'local_charges_auto_calc_error', NULL, SQLERRM, v_actor, now(),
        'Falha no recalculo de taxas locais apos aplicar flags fisicas do Baplie');
      PERFORM public.enqueue_import_effect(v_action_id, 'provisional_charges', v_bl_id, v_actor, 1, NULL,
        jsonb_build_object('voyage_id', p_voyage_id, 'source', 'baplie_physical_flags'));
    END;
  END LOOP;

  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', v_updated, 'applied', cardinality(v_updated),
    'applied_to', v_applied_to, 'cleared', v_cleared, 'divergent_manual', v_divergent,
    'recalculated', v_recalculated, 'calculation_errors', v_calc_errors);
END;
$function$;

-- 6. "Vale o B/L".
-- E9-10: na divergência de SOC/COC a origem do valor fica como estava (`bl`);
-- só a resolução é registrada, com o valor do Baplie (como o perfil já fazia).
-- Antes virava `manual` e a reimportação do B/L deixava de corrigir SOC/COC.
-- E9-11: vale para o container em todos os B/Ls ativos da Viagem que têm o
-- mesmo valor (Part Lot), com resolução e Histórico em cada um.
-- S5: recusa B/L cancelado e divergência que não existe.
CREATE OR REPLACE FUNCTION public.resolve_baplie_divergence(p_bl_container_id bigint, p_field text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_container public.bl_containers%ROWTYPE;
  v_voyage bigint;
  v_cancelled_at timestamptz;
  v_number text;
  v_baplie text;
  v_bl_value text;
  v_target record;
  v_resolved jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_field IS NULL OR p_field NOT IN ('ownership', 'profile') THEN
    RAISE EXCEPTION 'Divergência inválida: %.', p_field USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo de valer o B/L.' USING ERRCODE = '22023';
  END IF;

  SELECT b.voyage_id, b.cancelled_at, upper(btrim(c.container_number))
    INTO v_voyage, v_cancelled_at, v_number
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = p_bl_container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_bl_container_id USING ERRCODE = 'P0002';
  END IF;
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'O B/L do container % está cancelado: não há divergência a resolver.', v_number USING ERRCODE = '22023';
  END IF;

  -- Trava o container em todos os B/Ls ativos da Viagem, na ordem do id (a
  -- mesma da aplicação do Baplie).
  PERFORM 1
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE b.voyage_id = v_voyage AND b.cancelled_at IS NULL AND upper(btrim(c.container_number)) = v_number
  ORDER BY c.id
  FOR UPDATE OF c;
  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_bl_container_id;

  IF p_field = 'ownership' THEN
    SELECT max(s.ownership) INTO v_baplie
    FROM public.baplie_containers AS s
    WHERE s.voyage_id = v_voyage AND s.status = 'full' AND upper(btrim(s.container_number)) = v_number;
    v_bl_value := v_container.ownership;
  ELSE
    SELECT public._baplie_flags_label(bool_or(COALESCE(s.is_imo, false)), bool_or(COALESCE(s.is_oog, false)), NULL)
      INTO v_baplie
    FROM public.baplie_containers AS s
    WHERE s.voyage_id = v_voyage AND s.status = 'full' AND upper(btrim(s.container_number)) = v_number
    HAVING count(*) > 0;
    v_bl_value := public._baplie_flags_label(COALESCE(v_container.is_imo, false), COALESCE(v_container.is_oog, false), NULL);
  END IF;

  IF v_baplie IS NULL OR v_bl_value IS NULL OR v_baplie = v_bl_value THEN
    RAISE EXCEPTION 'Não há divergência de % entre o B/L e o Baplie no container %.',
      CASE WHEN p_field = 'ownership' THEN 'SOC/COC' ELSE 'perfil IMO/OOG' END, v_number
      USING ERRCODE = '22023';
  END IF;

  FOR v_target IN
    SELECT c.id, c.bl_id, c.container_number
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    WHERE b.voyage_id = v_voyage AND b.cancelled_at IS NULL AND upper(btrim(c.container_number)) = v_number
      AND (
        c.id = v_container.id
        OR CASE WHEN p_field = 'ownership' THEN c.ownership IS NOT DISTINCT FROM v_bl_value
                ELSE public._baplie_flags_label(COALESCE(c.is_imo, false), COALESCE(c.is_oog, false), NULL) = v_bl_value END
      )
    ORDER BY c.id
  LOOP
    -- O perfil que vale o B/L passa a correção manual (o Baplie não o troca);
    -- SOC/COC não muda de origem.
    IF p_field = 'profile' THEN
      UPDATE public.bl_containers SET profile_source = 'manual'
      WHERE id = v_target.id AND profile_source IS DISTINCT FROM 'manual';
    END IF;

    INSERT INTO public.baplie_reconciliation_resolutions
      (voyage_id, bl_container_id, field_name, baplie_value, manifest_value, resolution, resolved_by, justification)
    VALUES (v_voyage, v_target.id, p_field, v_baplie, v_bl_value, 'vale_o_bl', auth.uid(), v_reason)
    ON CONFLICT (voyage_id, bl_container_id, field_name, baplie_value, manifest_value, resolution)
    DO UPDATE SET resolved_by = EXCLUDED.resolved_by, resolved_at = now(), justification = EXCLUDED.justification;

    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', v_target.bl_id, 'baplie_divergence_' || p_field,
      jsonb_build_object('container', v_target.container_number, 'baplie', v_baplie)::text,
      jsonb_build_object('container', v_target.container_number, 'vale', v_bl_value)::text,
      auth.uid(), 'Vale o B/L: ' || v_reason);

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object('bl_container_id', v_target.id, 'bl_id', v_target.bl_id));
  END LOOP;

  RETURN jsonb_build_object('bl_container_id', v_container.id, 'field', p_field, 'baplie_value', v_baplie,
    'bl_value', v_bl_value, 'resolved', v_resolved);
END;
$function$;

-- 7. Correção manual do perfil IMO/OOG (E9-11; ADR 0078, item 21: Part Lot tem
-- sempre as mesmas características). A correção vale para o container em todos
-- os B/Ls ativos da Viagem que o dividem, com Histórico e recálculo em cada um.
-- B/L faturado em qualquer deles recusa a correção inteira, como já recusava
-- para um B/L só; correção a partir de B/L cancelado é recusada (somente
-- leitura).
CREATE OR REPLACE FUNCTION public.set_bl_container_profile(p_container_id bigint, p_profile text, p_justification text, p_changed_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_container public.bl_containers%ROWTYPE;
  v_voyage bigint;
  v_cancelled_at timestamptz;
  v_number text;
  v_ids bigint[];
  v_target public.bl_containers%ROWTYPE;
  v_blocked text;
  v_actor uuid := COALESCE(p_changed_by, auth.uid());
  v_is_imo boolean := p_profile IN ('imo', 'imo_oog');
  v_is_oog boolean := p_profile IN ('oog', 'imo_oog');
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_recalc text[] := ARRAY[]::text[];
  v_bl_id text;
  v_charges jsonb;
  v_propagated jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF p_changed_by IS NOT NULL AND p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O autor da alteração deve ser o usuário autenticado.' USING ERRCODE = '42501';
  END IF;
  IF p_profile IS NULL OR p_profile NOT IN ('standard', 'oog', 'imo', 'imo_oog') THEN
    RAISE EXCEPTION 'Perfil de container inválido: %.', p_profile USING ERRCODE = '22023';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'A justificativa da alteração de perfil é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;
  SELECT voyage_id, cancelled_at INTO v_voyage, v_cancelled_at FROM public.bls WHERE id = v_container.bl_id;
  v_number := upper(btrim(v_container.container_number));
  -- B/L cancelado é somente leitura (ADR 0071, item 9): a correção não parte
  -- dele para os B/Ls ativos do container.
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado: somente leitura. Reative para corrigir.', v_container.bl_id USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(c.id ORDER BY c.id) INTO v_ids
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = v_container.id
     OR (b.voyage_id = v_voyage AND b.cancelled_at IS NULL AND upper(btrim(c.container_number)) = v_number);

  -- Containers e B/Ls travados na ordem do id (a mesma da aplicação do Baplie).
  PERFORM 1 FROM public.bl_containers WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.bls
  WHERE id IN (SELECT bl_id FROM public.bl_containers WHERE id = ANY(v_ids))
  ORDER BY id FOR UPDATE;

  SELECT c.bl_id INTO v_blocked
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = ANY(v_ids) AND b.financial_status IN ('invoiced', 'partially_paid', 'paid')
  ORDER BY (c.bl_id <> v_container.bl_id), c.bl_id
  LIMIT 1;
  IF v_blocked = v_container.bl_id THEN
    RAISE EXCEPTION 'B/L % já foi faturado; o perfil não pode mudar porque as taxas não podem ser recalculadas.', v_blocked
      USING ERRCODE = '55000';
  ELSIF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'O container % também está no B/L %, já faturado; o perfil não pode mudar porque as taxas não podem ser recalculadas.', v_number, v_blocked
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bl_containers
    WHERE id = ANY(v_ids) AND (COALESCE(is_imo, false) <> v_is_imo OR COALESCE(is_oog, false) <> v_is_oog)
  ) THEN
    RAISE EXCEPTION 'O container já está com este perfil.' USING ERRCODE = '22023';
  END IF;

  -- Correção manual (o armador confirma fora do Baplie): o Baplie não a
  -- sobrescreve; Baplie diferente vira Divergente (migration 182).
  FOR v_target IN SELECT * FROM public.bl_containers WHERE id = ANY(v_ids) ORDER BY id LOOP
    UPDATE public.bl_containers
    SET is_imo = v_is_imo,
        is_oog = v_is_oog,
        imo_class = CASE WHEN v_is_imo THEN imo_class END,
        un_number = CASE WHEN v_is_imo THEN un_number END,
        profile_source = 'manual'
    WHERE id = v_target.id;

    IF COALESCE(v_target.is_imo, false) <> v_is_imo OR COALESCE(v_target.is_oog, false) <> v_is_oog THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification
      ) VALUES (
        'bl', v_target.bl_id, 'container_profile',
        jsonb_build_object('container', v_target.container_number, 'is_imo', COALESCE(v_target.is_imo, false), 'is_oog', COALESCE(v_target.is_oog, false))::text,
        jsonb_build_object('container', v_target.container_number, 'is_imo', v_is_imo, 'is_oog', v_is_oog)::text,
        v_actor, now(),
        CASE WHEN v_target.bl_id = v_container.bl_id THEN v_justification
             ELSE v_justification || ' (mesmo container do B/L ' || v_container.bl_id || ', Part Lot)' END
      );
      v_recalc := array_append(v_recalc, v_target.bl_id);
    END IF;
    IF v_target.id <> v_container.id THEN
      v_propagated := v_propagated || jsonb_build_array(jsonb_build_object('bl_id', v_target.bl_id, 'container_id', v_target.id));
    END IF;
  END LOOP;

  v_charges := public.calculate_bl_local_charges(v_container.bl_id, v_actor, true);
  FOR v_bl_id IN
    SELECT DISTINCT bl FROM unnest(v_recalc) AS bl WHERE bl <> v_container.bl_id ORDER BY 1
  LOOP
    PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
  END LOOP;

  RETURN jsonb_build_object(
    'bl_id', v_container.bl_id,
    'container_id', v_container.id,
    'profile', p_profile,
    'charges', v_charges,
    'propagated_to', v_propagated
  );
END;
$function$;

-- 8. Correção manual de SOC/COC (E9-11): mesma regra de Part Lot do perfil.
CREATE OR REPLACE FUNCTION public.set_bl_container_ownership(p_container_id bigint, p_ownership text, p_justification text, p_changed_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_container public.bl_containers%ROWTYPE;
  v_voyage bigint;
  v_cancelled_at timestamptz;
  v_number text;
  v_ids bigint[];
  v_target public.bl_containers%ROWTYPE;
  v_blocked text;
  v_actor uuid := COALESCE(p_changed_by, auth.uid());
  v_ownership text := upper(btrim(COALESCE(p_ownership, '')));
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_recalc text[] := ARRAY[]::text[];
  v_bl_id text;
  v_charges jsonb;
  v_propagated jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF p_changed_by IS NOT NULL AND p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O autor da alteração deve ser o usuário autenticado.' USING ERRCODE = '42501';
  END IF;
  IF v_ownership NOT IN ('SOC', 'COC') THEN
    RAISE EXCEPTION 'Propriedade do container inválida: %.', p_ownership USING ERRCODE = '22023';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'A justificativa da alteração de SOC/COC é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_container FROM public.bl_containers WHERE id = p_container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;
  SELECT voyage_id, cancelled_at INTO v_voyage, v_cancelled_at FROM public.bls WHERE id = v_container.bl_id;
  v_number := upper(btrim(v_container.container_number));
  -- B/L cancelado é somente leitura (ADR 0071, item 9): a correção não parte
  -- dele para os B/Ls ativos do container.
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado: somente leitura. Reative para corrigir.', v_container.bl_id USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(c.id ORDER BY c.id) INTO v_ids
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = v_container.id
     OR (b.voyage_id = v_voyage AND b.cancelled_at IS NULL AND upper(btrim(c.container_number)) = v_number);

  PERFORM 1 FROM public.bl_containers WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.bls
  WHERE id IN (SELECT bl_id FROM public.bl_containers WHERE id = ANY(v_ids))
  ORDER BY id FOR UPDATE;

  SELECT c.bl_id INTO v_blocked
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = ANY(v_ids) AND b.financial_status IN ('invoiced', 'partially_paid', 'paid')
  ORDER BY (c.bl_id <> v_container.bl_id), c.bl_id
  LIMIT 1;
  IF v_blocked = v_container.bl_id THEN
    RAISE EXCEPTION 'B/L % já foi faturado; SOC/COC não pode mudar porque as taxas não podem ser recalculadas.', v_blocked
      USING ERRCODE = '55000';
  ELSIF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'O container % também está no B/L %, já faturado; SOC/COC não pode mudar porque as taxas não podem ser recalculadas.', v_number, v_blocked
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.bl_containers WHERE id = ANY(v_ids) AND ownership IS DISTINCT FROM v_ownership) THEN
    RAISE EXCEPTION 'O container já está como %.', v_ownership USING ERRCODE = '22023';
  END IF;

  FOR v_target IN SELECT * FROM public.bl_containers WHERE id = ANY(v_ids) ORDER BY id LOOP
    UPDATE public.bl_containers
    SET ownership = v_ownership,
        ownership_source = 'manual'
    WHERE id = v_target.id;

    IF v_target.ownership IS DISTINCT FROM v_ownership THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification
      ) VALUES (
        'bl', v_target.bl_id, 'container_ownership',
        jsonb_build_object('container', v_target.container_number, 'ownership', v_target.ownership, 'source', v_target.ownership_source)::text,
        jsonb_build_object('container', v_target.container_number, 'ownership', v_ownership, 'source', 'manual')::text,
        v_actor, now(),
        CASE WHEN v_target.bl_id = v_container.bl_id THEN v_justification
             ELSE v_justification || ' (mesmo container do B/L ' || v_container.bl_id || ', Part Lot)' END
      );
      v_recalc := array_append(v_recalc, v_target.bl_id);
    END IF;
    IF v_target.id <> v_container.id THEN
      v_propagated := v_propagated || jsonb_build_array(jsonb_build_object('bl_id', v_target.bl_id, 'container_id', v_target.id));
    END IF;
  END LOOP;

  v_charges := public.calculate_bl_local_charges(v_container.bl_id, v_actor, true);
  FOR v_bl_id IN
    SELECT DISTINCT bl FROM unnest(v_recalc) AS bl WHERE bl <> v_container.bl_id ORDER BY 1
  LOOP
    PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
  END LOOP;

  RETURN jsonb_build_object(
    'bl_id', v_container.bl_id,
    'container_id', v_container.id,
    'ownership', v_ownership,
    'charges', v_charges,
    'propagated_to', v_propagated
  );
END;
$function$;
