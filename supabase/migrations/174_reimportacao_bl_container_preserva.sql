-- 174: reimportação de B/L de container preserva o que continua no arquivo
-- (M02 e M14 da revisão de 2026-10-09; ADR 0078, itens 16 e 17).
--
-- 1. Núcleo `import_bl_freight_transactional_legacy_205`: containers são
--    reconciliados por número em vez de DELETE + INSERT. O container que
--    continua no arquivo mantém id, created_at, descarga, devolução, status de
--    Demurrage, local de desova, perfil IMO/OOG e SOC/COC manual; só lacre,
--    tipo, tara, peso bruto e cubagem mudam, e só quando mudam. Container
--    ausente do arquivo sai apenas quando a prévia mostrou a remoção
--    (`remove_containers`; sem a chave, vale a semântica anterior) e nunca se
--    estiver numa Invoice de Demurrage ou tiver veículos (SQLSTATE P0006, com
--    mensagem de negócio).
-- 2. Veículos (ADR 0078, item 16): a chave `vehicles` só vem com a aba VIN;
--    sem ela, nada muda. Com ela, a lista vale por chassi; B/L que já existia
--    só aplica entradas, saídas e mudanças com `confirm_vehicle_changes`, e o
--    alerta `bl_vehicles_changed_on_reimport` registra o B/L e as mudanças.
--    Chassi que já está em outro B/L ativo recusa só a linha
--    (`vehicles_discarded`).
-- 3. O retorno traz, por B/L, containers inseridos, atualizados e removidos e
--    veículos inseridos, atualizados, removidos, descartados e pendentes.
-- 4. `guard_shared_container_mutation` olha só a mudança de participação.
-- 5. `import_bl_freight_with_metadata` não recalcula B/L faturado: a fatura
--    segue a ADR 0077 pela base capturada; reimportação idêntica deixa de
--    devolver "recalculo bloqueado" e de enfileirar provisional_charges.
-- 6. M14: o e-mail do arquivo vira contato só do Cliente cujo CNPJ é o do
--    arquivo (`legacy_322` e `apply_bl_review_gate_after_import`), o e-mail é
--    protegido junto com o CNPJ em B/L faturado sem confirmação e acompanha o
--    documento na Troca de Consignatário aceita (`legacy_357`).
-- 7. D-11: Laden on Board ilegível ou vazio não altera a data (`legacy_070`).
--
-- Cada função é redefinida a partir da definição efetiva no banco replicado.
-- Não reescreve nem apaga linhas existentes na migration.
--
-- Rollback: reaplicar as definições anteriores destas funções (dump do banco
-- antes desta migration) e remover o tipo de alerta
-- `bl_vehicles_changed_on_reimport` do catálogo.

INSERT INTO public.alert_type_catalog(type, severity, responsible_department, audience_departments, default_destination)
VALUES ('bl_vehicles_changed_on_reimport', 'normal', 'documentacao', ARRAY['documentacao'], '/bls')
ON CONFLICT (type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.guard_shared_container_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id text := COALESCE(NEW.bl_id, OLD.bl_id);
  v_voyage_id bigint;
  v_number text;
BEGIN
  -- Só a participação no container muda o rateio do irmão faturado: datas,
  -- desova, lacre ou status de Demurrage passam (migration 174).
  IF TG_OP = 'UPDATE'
     AND NEW.bl_id IS NOT DISTINCT FROM OLD.bl_id
     AND upper(btrim(NEW.container_number)) IS NOT DISTINCT FROM upper(btrim(OLD.container_number)) THEN
    RETURN NEW;
  END IF;
  SELECT voyage_id INTO v_voyage_id FROM public.bls WHERE id = v_bl_id;
  SELECT upper(btrim(COALESCE(NEW.container_number, OLD.container_number))) INTO v_number;
  IF v_voyage_id IS NULL OR v_number IS NULL OR v_number = '' THEN IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.bl_containers bc JOIN public.bls b ON b.id = bc.bl_id
    WHERE b.voyage_id = v_voyage_id AND upper(btrim(bc.container_number)) = v_number
      AND b.id <> v_bl_id AND b.financial_status IN ('invoiced', 'paid')
  ) THEN
    RAISE EXCEPTION 'Container compartilhado % já está faturado em outra B/L; cancele/reemita antes de alterar o conjunto.', v_number USING ERRCODE = 'P0003';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

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

  -- Containers: reconciliação por número (migration 174, M02). O id, a data de
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
    RAISE EXCEPTION
      'O container % do B/L % esta na Invoice de Demurrage % e o arquivo nao o traz. Mantenha o container no arquivo ou cancele a invoice antes de retira-lo do B/L.',
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
    INSERT INTO public.bl_containers (
      bl_id, container_number, seal_number, type, tare_weight_kg, gross_weight_kg,
      cbm, is_oog, is_imo, imo_class, un_number
    )
    SELECT
      i.bl_id, i.container_number, i.seal_number, i.type, i.tare_weight_kg, i.gross_weight_kg,
      i.cbm, i.is_oog, i.is_imo, i.imo_class, i.un_number
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
    COALESCE(
      NULLIF(v.item->>'container_id', '')::BIGINT,
      (SELECT c.id FROM pg_temp.tmp_new_containers AS c
        WHERE c.bl_id = t.id AND c.container_number = upper(btrim(NULLIF(v.item->>'container_number', '')))
        ORDER BY c.id LIMIT 1)
    ) AS container_id,
    upper(btrim(NULLIF(v.item->>'container_number', ''))) AS container_number,
    (
      SELECT ov.bl_id FROM public.vehicles AS ov
      JOIN public.bls AS ob ON ob.id = ov.bl_id
      WHERE upper(btrim(ov.chassis)) = upper(btrim(v.item->>'chassis'))
        AND ov.bl_id <> t.id
        AND ob.cancelled_at IS NULL
      ORDER BY ov.bl_id LIMIT 1
    ) AS other_bl_id,
    v.ord
  FROM pg_temp.tmp_bl_freight_import AS t
  JOIN public.bls AS b ON b.id = t.id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.payload->'vehicles') = 'array' THEN t.payload->'vehicles' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS v(item, ord)
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
  SELECT r.container_number, r.bl_id INTO v_blocked_container, v_blocked_bl
  FROM pg_temp.tmp_removed_containers AS r
  JOIN public.vehicles AS ev ON ev.container_id = r.id
  ORDER BY r.bl_id, r.container_number
  LIMIT 1;
  IF v_blocked_container IS NOT NULL THEN
    RAISE EXCEPTION
      'O container % do B/L % tem veiculos e o arquivo nao o traz. Reimporte com a aba VIN ou mova os veiculos antes de retirar o container.',
      v_blocked_container, v_blocked_bl
      USING ERRCODE = 'P0006';
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

CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional_legacy_070(p_bls jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_item jsonb;
  v_bl_id text;
  v_next text[];
  v_current text[];
  v_voyage_ids bigint[] := ARRAY[]::bigint[];
  v_voyage_id bigint;
  v_pol text;
  v_canonical_atd date;
  v_current_atd text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar frete do BL.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::bigint[])
    INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE item->>'id' IS NOT NULL
  ) AND b.voyage_id IS NOT NULL;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'on', true);
  v_result := public.import_bl_freight_transactional_legacy_357(p_bls, p_changed_by);

  FOR v_item IN SELECT item FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item LOOP
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL;

    -- Preserva o fato já cadastrado quando um payload antigo não possui a chave
    -- e quando o Laden on Board do arquivo é ilegível ou vazio (ADR 0078, item 17).
    IF v_item ? 'laden_on_board' AND NULLIF(btrim(v_item->>'laden_on_board'), '') IS NOT NULL THEN
      UPDATE public.bls
      SET laden_on_board = NULLIF(v_item->>'laden_on_board', '')::date,
          updated_at = now()
      WHERE id = v_bl_id;
    END IF;

    v_next := public.normalize_ncm_codes(v_item->'ncm_codes');
    CONTINUE WHEN cardinality(v_next) = 0;
    SELECT ncm_codes INTO v_current FROM public.bls WHERE id = v_bl_id;
    CONTINUE WHEN NOT FOUND OR v_current = v_next;
    UPDATE public.bls SET ncm_codes = v_next WHERE id = v_bl_id;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', v_bl_id, 'ncm_codes', array_to_string(COALESCE(v_current, ARRAY[]::text[]), ', '), array_to_string(v_next, ', '), p_changed_by, 'NCM declarado no documento reimportado');
  END LOOP;

  PERFORM set_config('alerts.baplie_coverage_deferred', 'off', true);

  SELECT v_voyage_ids || COALESCE(array_agg(DISTINCT b.voyage_id ORDER BY b.voyage_id), ARRAY[]::bigint[])
    INTO v_voyage_ids
  FROM public.bls AS b
  WHERE b.id IN (
    SELECT item->>'id'
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS item
    WHERE item->>'id' IS NOT NULL
  ) AND b.voyage_id IS NOT NULL;

  FOR v_voyage_id IN
    SELECT DISTINCT ids.voyage_id FROM unnest(v_voyage_ids) AS ids(voyage_id)
    WHERE ids.voyage_id IS NOT NULL ORDER BY ids.voyage_id
  LOOP
    PERFORM public.reconcile_voyage_baplie_coverage_alerts(v_voyage_id, 'baplie_coverage_import');

    FOR v_pol IN
      SELECT DISTINCT upper(btrim(b.pol))
      FROM public.bls AS b
      WHERE b.voyage_id = v_voyage_id AND NULLIF(btrim(b.pol), '') IS NOT NULL
    LOOP
      SELECT min(b.laden_on_board) INTO v_canonical_atd
      FROM public.bls AS b
      WHERE b.voyage_id = v_voyage_id AND upper(btrim(b.pol)) = v_pol;

      SELECT al.new_value INTO v_current_atd
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pol_schedule'
        AND al.entity_id = v_voyage_id::text || '::' || v_pol
        AND al.field_name = 'atd'
      ORDER BY al.changed_at DESC, al.id DESC
      LIMIT 1;

      IF v_current_atd IS DISTINCT FROM v_canonical_atd::text THEN
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES (
          'voyage_pol_schedule', v_voyage_id::text || '::' || v_pol, 'atd',
          v_current_atd, v_canonical_atd::text, p_changed_by,
          'ATD derivado do menor Laden on Board persistido na mesma transação do import (ADR 0025)'
        );
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_result;
END;
$function$;

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
      NULLIF(regexp_replace(COALESCE(item->>'manifest_customer_cnpj_cpf', ''), '\D', '', 'g'), '')
    FROM jsonb_array_elements(COALESCE(p_bls, '[]'::JSONB)) AS item
    WHERE item->>'id' IS NOT NULL
  LOOP
    IF v_email IS NOT NULL THEN
      -- M14 (migration 174): o e-mail do arquivo só vira contato do Cliente
      -- cujo CNPJ é o do arquivo; na Troca de Consignatário ele entra depois
      -- do relink, pelo gate, no Cliente novo.
      SELECT b.customer_id INTO v_customer_id
      FROM public.bls AS b
      JOIN public.customers AS c ON c.id = b.customer_id
      WHERE b.id = v_bl_id
        AND regexp_replace(COALESCE(c.cnpj_cpf, ''), '\D', '', 'g') = v_file_document;
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
      UPDATE public.bls
      SET
        voyage_id  = CASE WHEN v_item ? 'voyage_id'  THEN NULLIF(v_item->>'voyage_id', '')::BIGINT ELSE voyage_id END,
        pol        = CASE WHEN v_item ? 'pol'        THEN NULLIF(v_item->>'pol', '') ELSE pol END,
        pod        = CASE WHEN v_item ? 'pod'        THEN NULLIF(v_item->>'pod', '') ELSE pod END,
        cargo_mode = CASE WHEN v_item ? 'cargo_mode' THEN COALESCE(NULLIF(v_item->>'cargo_mode', ''), cargo_mode) ELSE cargo_mode END
      WHERE id = v_bl_id;

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
        UPDATE public.bls
        SET
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
          -- M14 (migration 174): o e-mail anda com o documento do novo dono.
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

CREATE OR REPLACE FUNCTION public.import_bl_freight_with_metadata(p_bls jsonb, p_changed_by uuid, p_batch jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_batch_id bigint := NULL;
  v_filename text;
  v_voyage_id bigint;
  v_cargo_mode text := 'container';
  v_total_bls integer;
  v_bl_id text;
  v_mismatch integer := 0;
  v_updated integer := 0;
  v_action_id uuid := gen_random_uuid();
  v_item jsonb;
  v_physical_effect jsonb;
  v_physical_effect_id bigint;
  v_calc_errors jsonb := '[]'::jsonb;
  v_batch_containers jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  v_result := public.import_bl_freight_transactional(p_bls, p_changed_by);

  -- O batch e opcional (ADR 0017): mesmo no B/L avulso o calculo inicial
  -- deve acontecer nesta mesma operacao, sem depender de worker offline.
  IF p_batch IS NOT NULL THEN
    v_filename := NULLIF(btrim(COALESCE(p_batch->>'filename', '')), '');
    v_voyage_id := NULLIF(btrim(COALESCE(p_batch->>'voyage_id', '')), '')::bigint;
    v_cargo_mode := COALESCE(NULLIF(btrim(COALESCE(p_batch->>'cargo_mode', '')), ''), 'container');
    IF v_filename IS NULL OR v_voyage_id IS NULL THEN
      RAISE EXCEPTION 'Batch invalido: filename e voyage_id obrigatorios.' USING ERRCODE = '22023';
    END IF;
    IF v_cargo_mode NOT IN ('container', 'carga_solta') THEN
      RAISE EXCEPTION 'cargo_mode de batch invalido.' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.voyages WHERE id = v_voyage_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem % nao encontrada', v_voyage_id USING ERRCODE = 'P0002';
    END IF;

    SELECT count(*) INTO v_mismatch
    FROM jsonb_array_elements(p_bls) AS item
    WHERE (item->>'voyage_id')::bigint IS DISTINCT FROM v_voyage_id;
    IF v_mismatch > 0 THEN
      RAISE EXCEPTION 'Batch da viagem % com B/L de outra viagem.', v_voyage_id USING ERRCODE = '22023';
    END IF;

    v_total_bls := jsonb_array_length(p_bls);

    INSERT INTO public.import_batches(
      filename, voyage_id, cargo_mode, uploaded_by, status, total_bls, total_containers
    ) VALUES (
      v_filename, v_voyage_id, v_cargo_mode, v_actor, 'completed', v_total_bls, NULL
    ) RETURNING id INTO v_batch_id;

    UPDATE public.bls AS b
      SET batch_id = v_batch_id
      FROM jsonb_array_elements(p_bls) AS item
      WHERE b.id = item->>'id' AND b.voyage_id = v_voyage_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> v_total_bls THEN
      RAISE EXCEPTION 'Vinculo de batch falhou: % de % B/Ls vinculados.', v_updated, v_total_bls USING ERRCODE = 'P0002';
    END IF;

    v_physical_effect := public.enqueue_import_effect(
      v_action_id,
      'physical_flags',
      v_voyage_id::text,
      v_actor,
      1,
      NULL,
      jsonb_build_object(
        'filename', v_filename,
        'voyage_id', v_voyage_id,
        'cargo_mode', v_cargo_mode,
        'bl_count', v_total_bls
      )
    );
    v_physical_effect_id := NULLIF(v_physical_effect->'effect'->>'id', '')::bigint;

    -- Baplie soberano em qualquer ordem (migration 118): se o Baplie da
    -- viagem ja existe, as flags fisicas valem antes do calculo inicial
    -- abaixo; o runner do efeito acima nao e pre-requisito.
    -- Migration 150: só os contêineres deste lote (sem filtro a função varre
    -- a viagem inteira, ~3 s numa viagem de ~500 B/Ls).
    SELECT jsonb_agg(DISTINCT upper(btrim(container->>'container_number')))
      INTO v_batch_containers
      FROM jsonb_array_elements(p_bls) AS item,
           jsonb_array_elements(COALESCE(item->'containers', '[]'::jsonb)) AS container
      WHERE NULLIF(btrim(COALESCE(container->>'container_number', '')), '') IS NOT NULL;
    IF v_batch_containers IS NOT NULL THEN
      PERFORM public.apply_baplie_physical_flags_atomic(v_voyage_id, v_batch_containers, v_actor);
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bls)
  LOOP
    -- Preserva o ID exato que foi persistido em public.bls
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL OR btrim(v_bl_id) = '';
    -- B/L faturado não é recalculado aqui (migration 174, M02): a fatura
    -- emitida segue a ADR 0077 pela base capturada na própria importação.
    -- Recalcular só devolvia "recalculo bloqueado" e enfileirava
    -- provisional_charges em toda reimportação idêntica.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.bls
      WHERE id = v_bl_id AND COALESCE(financial_status, 'pending') IN ('invoiced', 'paid')
    ) OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0;

    -- Disparo imediato do calculo inicial das taxas locais com base nas tabelas cadastradas
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      -- Registra rastro detalhado do erro em audit_logs e acumula no retorno do batch.
      v_calc_errors := v_calc_errors || jsonb_build_array(jsonb_build_object(
        'bl_id', v_bl_id,
        'message', SQLERRM
      ));
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
      ) VALUES (
        'bl', v_bl_id, 'local_charges_auto_calc_error', NULL, SQLERRM, v_actor, now(),
        'Falha no calculo automatico de taxas locais na importacao do B/L'
      );
      -- A fila e somente recuperacao: um calculo bem-sucedido nao e repetido pelo worker.
      IF p_batch IS NOT NULL THEN
        PERFORM public.enqueue_import_effect(
          v_action_id,
          'provisional_charges',
          v_bl_id,
          v_actor,
          1,
          v_physical_effect_id,
          jsonb_build_object(
            'filename', v_filename,
            'voyage_id', v_voyage_id,
            'cargo_mode', v_cargo_mode
          )
        );
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('result', v_result, 'batch_id', v_batch_id, 'calculation_errors', v_calc_errors);
END;
$function$;

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
      -- M14 (migration 174): só quando o CNPJ do documento é o do Cliente.
      AND NULLIF(regexp_replace(COALESCE(b.manifest_customer_cnpj_cpf, ''), '\D', '', 'g'), '')
        = regexp_replace(COALESCE(c.cnpj_cpf, ''), '\D', '', 'g')
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
