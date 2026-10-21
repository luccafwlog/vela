-- 392: arquivo de B/L com as regras no servidor (ADR 0095, decisões 5, 8, 9,
-- 10, 26 e 27; revisão das importações de 2026-10-21, achados F-05, F-15,
-- F-27 e F-50; Lote 2 do plano docs/plans/2026-10-21-frente-das-importacoes.md).
--
-- Problema:
--   - A importação movia B/L de uma Viagem para outra (voyage_id do arquivo).
--   - B/L cancelado no arquivo não tinha tratamento próprio no servidor.
--   - Refixar o preço (ADR 0094, A2) só existia para `service_role`.
--   - A confirmação de faturamento era decidida no navegador
--     (`override_billing = !impacto`): pela corrida ou pelo teto de 1.000
--     linhas da prévia, containers entravam em B/L faturado sem aceite (F-05).
--     B/L só calculado também pedia a confirmação.
--   - Sem a confirmação, containers ficavam e peso, cubagem e Place of
--     Delivery mudavam (F-27).
--   - O servidor confiava no `customer_id` do payload (F-15).
--   - A aba VIN gravava veículos, com a exceção `vela.vin_reissue` no B/L
--     cancelado (385) e o alerta `bl_vehicles_changed_on_reimport`.
--   - `container_load_type` nunca era gravado; "FCL não se divide entre
--     Clientes" valia também para B/L LCL (F-50).
--
-- Mudança:
--   1. `_bl_has_emitted_local_invoice`: fatura local viva ou status faturado.
--      É o único "faturado" do arquivo de B/L (prévia e gravação).
--   2. `import_bl_freight_transactional_legacy_205` (núcleo): trava de
--      faturamento só com fatura emitida; nunca muda `voyage_id`; sem a
--      confirmação, peso, cubagem e Place of Delivery ficam com os
--      containers e o POD; sem leitura de veículos (a recusa de container com
--      veículo fica, com mensagem nova); grava `container_load_type`.
--   3. `guard_cancelled_bl_cargo` sem a exceção `vela.vin_reissue`.
--   4. `import_bl_freight_file_atomic` confere cada B/L antes da gravação:
--      outra Viagem recusa o arquivo; cancelado é aviso e fica fora; Cliente
--      pelo CNPJ normalizado (o `customer_id` que não bate recusa);
--      confirmação de faturamento só com fatura emitida e impacto mostrado;
--      aba VIN descartada; refixar o preço (`refix_prices`) só para B/L
--      gravado e não faturado, chamando `refix_bl_local_charge_prices` aqui
--      dentro (a função continua sem EXECUTE para `authenticated`).
--   5. `bl_file_import_preview`: estado de cada B/L para a prévia (Viagem,
--      cancelado, faturado) e o preço de hoje calculado numa subtransação
--      desfeita (nada fica gravado).
--
-- Dados: nenhuma linha existente é reescrita ou apagada (só funções).
-- Veículos já gravados pela aba VIN ficam. Alertas
-- `bl_vehicles_changed_on_reimport` abertos continuam resolvíveis com
-- justificativa; nada novo os produz.

CREATE OR REPLACE FUNCTION public._bl_has_emitted_local_invoice(p_bl_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.bls b
    WHERE b.id = p_bl_id AND COALESCE(b.financial_status, 'pending') IN ('invoiced', 'paid')
  ) OR cardinality(public._live_local_invoice_ids_for_bl(p_bl_id)) > 0;
$function$;

REVOKE ALL ON FUNCTION public._bl_has_emitted_local_invoice(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bl_has_emitted_local_invoice(text) TO service_role;

-- 2. Núcleo do arquivo de B/L (definição vigente da 335/385, com as mudanças do cabeçalho).
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
    'container_load_type',
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
    container_load_type TEXT,
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
    container_load_type,
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
    CASE WHEN upper(btrim(bl->>'container_load_type')) IN ('FCL', 'LCL') THEN upper(btrim(bl->>'container_load_type')) END,
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

  -- 392 (ADR 0095, decisão 10): a confirmação de faturamento só existe com
  -- fatura emitida. B/L calculado e não faturado recebe a base nova e é
  -- recalculado com o preço fixo (ADR 0094).
  UPDATE pg_temp.tmp_bl_freight_import AS t
  SET billing_locked = public._bl_has_emitted_local_invoice(t.id)
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
    container_load_type,
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
    container_load_type,
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
    -- 392 (ADR 0095, decisão 5): a importação não move B/L entre Viagens.
    voyage_id = bls.voyage_id,
    batch_id = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'batch_id') THEN EXCLUDED.batch_id ELSE bls.batch_id END,
    cargo_mode = CASE WHEN EXCLUDED.id = ANY(v_unlocked_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'cargo_mode') THEN EXCLUDED.cargo_mode ELSE bls.cargo_mode END,
    -- 392 (ADR 0095, decisão 27): FCL/LCL lido do Type of Movement; o arquivo
    -- sem a modalidade mantém a gravada.
    container_load_type = COALESCE(EXCLUDED.container_load_type, bls.container_load_type),
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
    -- 392 (F-27): sem a confirmação, o Place of Delivery fica com o POD.
    place_of_delivery = CASE WHEN EXCLUDED.id = ANY(v_billing_hold_bls) THEN bls.place_of_delivery WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'place_of_delivery') THEN EXCLUDED.place_of_delivery ELSE bls.place_of_delivery END,
    place_of_receipt = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'place_of_receipt') THEN EXCLUDED.place_of_receipt ELSE bls.place_of_receipt END,
    movement_from = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'movement_from') THEN EXCLUDED.movement_from ELSE bls.movement_from END,
    movement_to = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'movement_to') THEN EXCLUDED.movement_to ELSE bls.movement_to END,
    issue_place = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'issue_place') THEN EXCLUDED.issue_place ELSE bls.issue_place END,
    cargo_description = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'cargo_description') THEN EXCLUDED.cargo_description ELSE bls.cargo_description END,
    total_packages = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_packages') THEN EXCLUDED.total_packages ELSE bls.total_packages END,
    packages_unit = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'packages_unit') THEN EXCLUDED.packages_unit ELSE bls.packages_unit END,
    consignee_phone = CASE WHEN EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'consignee_phone') THEN EXCLUDED.consignee_phone ELSE bls.consignee_phone END,
    -- 392 (F-27): sem a confirmação, os containers não mudam e os totais que
    -- vêm deles (peso e cubagem) também não.
    total_weight_kg = CASE WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_weight_kg') THEN EXCLUDED.total_weight_kg ELSE bls.total_weight_kg END,
    total_cbm = CASE WHEN EXCLUDED.id <> ALL(v_billing_hold_bls) AND EXISTS (SELECT 1 FROM pg_temp.tmp_bl_freight_import t WHERE t.id = EXCLUDED.id AND t.payload ? 'total_cbm') THEN EXCLUDED.total_cbm ELSE bls.total_cbm END,
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
    WHERE id = ANY(v_container_bls)
  );


  -- 392 (ADR 0095, decisão 26): a aba VIN não é lida; veículos entram e saem
  -- só pela planilha de Veículos. Container com veículo não sai pelo arquivo.
  SELECT r.container_number, r.bl_id, ev.chassis INTO v_blocked_container, v_blocked_bl, v_blocked_chassis
  FROM pg_temp.tmp_removed_containers AS r
  JOIN public.vehicles AS ev ON ev.container_id = r.id
  ORDER BY r.bl_id, r.container_number, ev.chassis
  LIMIT 1;
  IF v_blocked_container IS NOT NULL THEN
    RAISE EXCEPTION
      'O container % do B/L % sai pelo arquivo, mas tem o veículo %: mova ou exclua os veículos dele (planilha de Veículos ou ficha) antes de tirar o container.',
      v_blocked_container, v_blocked_bl, v_blocked_chassis
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
    'customer_changes_ignored', v_customer_ignored
  );
END;
$function$;


-- 3. B/L cancelado somente leitura sem a exceção da aba VIN (ADR 0095,
-- decisão 26): o ponytail da 385 sai junto com a leitura da aba.
CREATE OR REPLACE FUNCTION public.guard_cancelled_bl_cargo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_bl text;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('vela.deleting_records', true) = 'on' THEN
    RETURN OLD;
  END IF;
  SELECT b.id INTO v_bl FROM public.bls b
  WHERE b.cancelled_at IS NOT NULL
    AND b.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.bl_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.bl_id END)
  LIMIT 1;
  IF v_bl IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  -- O status de Demurrage é derivado e recalculado pelo sistema (197, 200).
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'bl_containers'
     AND public._voyage_cancelled_financial_only('bl_containers', to_jsonb(OLD), to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'B/L % cancelado é somente leitura: reative o B/L pela ficha para alterar containers ou veículos.', v_bl
    USING ERRCODE = '22023';
END;
$function$;

-- Rótulo da Viagem nas mensagens: navio e número.
CREATE OR REPLACE FUNCTION public._voyage_label(p_voyage_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(NULLIF(btrim(concat_ws(' ', vs.name, v.voyage_number)), ''), p_voyage_id::text)
  FROM (SELECT p_voyage_id AS id) AS one
  LEFT JOIN public.voyages v ON v.id = one.id
  LEFT JOIN public.vessels vs ON vs.id = v.vessel_id;
$function$;

REVOKE ALL ON FUNCTION public._voyage_label(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._voyage_label(bigint) TO service_role;

-- 4. Arquivo de B/L: regras de entrada conferidas no servidor.
CREATE OR REPLACE FUNCTION public.import_bl_freight_file_atomic(p_bls jsonb, p_changed_by uuid, p_batch jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_id text;
  v_bl record;
  v_exists boolean;
  v_invoiced boolean;
  v_file_voyage bigint;
  v_doc text;
  v_given bigint;
  v_resolved bigint;
  v_customer_doc text;
  v_texts text;
  v_skipped jsonb := '[]'::jsonb;
  v_refix text[] := ARRAY[]::text[];
  v_refixed jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  -- 387: trava das Viagens antes da primeira escrita (ADR 0095, decisão 6).
  PERFORM public._lock_import_voyages_of_bls(
    public._import_payload_voyage_ids(p_bls, 'voyage_id')
      || public._import_payload_voyage_ids(jsonb_build_array(COALESCE(p_batch, '{}'::jsonb)), 'voyage_id'),
    public._import_payload_texts(p_bls, 'id'));

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_bls) LOOP
    v_id := NULLIF(btrim(COALESCE(v_item->>'id', '')), '');
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'B/L sem número no arquivo.' USING ERRCODE = '22023';
    END IF;
    v_file_voyage := NULLIF(v_item->>'voyage_id', '')::bigint;

    SELECT b.voyage_id, b.cancelled_at INTO v_bl FROM public.bls b WHERE b.id = v_id;
    v_exists := FOUND;
    v_invoiced := false;
    IF v_exists THEN
      -- Decisão 5: a importação não move B/L entre Viagens.
      IF v_bl.voyage_id IS DISTINCT FROM v_file_voyage THEN
        IF v_bl.cancelled_at IS NOT NULL THEN
          RAISE EXCEPTION 'O B/L % está cancelado na Viagem %: o número continua lá. Exclua o B/L na Viagem % e importe de novo.',
            v_id, public._voyage_label(v_bl.voyage_id), public._voyage_label(v_bl.voyage_id) USING ERRCODE = '22023';
        END IF;
        RAISE EXCEPTION 'O B/L % já está na Viagem %: cancele ou exclua o B/L lá e importe de novo.',
          v_id, public._voyage_label(v_bl.voyage_id) USING ERRCODE = '22023';
      END IF;
      -- Decisão 8 (ADR 0092): B/L cancelado é aviso e não é tocado.
      IF v_bl.cancelled_at IS NOT NULL THEN
        v_skipped := v_skipped || jsonb_build_object('bl_id', v_id, 'message',
          format('B/L %s está cancelado e não foi alterado: para importar, reative o B/L pela ficha (Administrativo) e importe de novo.', v_id));
        CONTINUE;
      END IF;
      v_invoiced := public._bl_has_emitted_local_invoice(v_id);
    END IF;

    -- Decisão 26: a aba VIN não é fonte de veículos.
    v_item := v_item - 'vehicles' - 'confirm_vehicle_changes';

    -- Decisão 10 (F-05): a confirmação de faturamento só vale para B/L com
    -- fatura emitida e com o impacto que a prévia mostrou.
    IF COALESCE(NULLIF(v_item->>'override_billing', '')::boolean, false) THEN
      IF NOT v_invoiced THEN
        RAISE EXCEPTION 'B/L %: a confirmação de faturamento só vale para B/L com fatura emitida. Refaça a prévia e importe de novo.', v_id
          USING ERRCODE = '22023';
      END IF;
      IF NOT COALESCE(NULLIF(v_item->>'billing_impact', '')::boolean, false) THEN
        RAISE EXCEPTION 'B/L %: a confirmação de faturamento chegou sem o impacto mostrado na prévia. Refaça a prévia e importe de novo.', v_id
          USING ERRCODE = '22023';
      END IF;
    END IF;
    IF NOT v_invoiced THEN
      v_item := v_item || jsonb_build_object('override_billing', false, 'billing_impact', false);
    END IF;

    -- F-15: o Cliente sai do CNPJ normalizado do consignatário.
    v_doc := public.normalize_document_text(v_item->>'manifest_customer_cnpj_cpf');
    v_given := NULLIF(v_item->>'customer_id', '')::bigint;
    v_resolved := NULL;
    IF v_doc IS NOT NULL THEN
      SELECT min(c.id) INTO v_resolved FROM public.customers c
      WHERE c.deactivated_at IS NULL AND public.normalize_document_text(c.cnpj_cpf) = v_doc
      HAVING count(*) = 1;
    END IF;
    IF v_given IS NOT NULL AND v_resolved IS DISTINCT FROM v_given THEN
      -- Sem CNPJ do consignatário, a prévia aceita o único CNPJ lido no bloco
      -- do consignatário ou na descrição da carga (customerReconciliation.ts).
      -- ponytail: confere por substring do texto normalizado; um CNPJ colado
      -- a outros dígitos também casa. Upgrade: extrair os CNPJs do texto.
      SELECT public.normalize_document_text(c.cnpj_cpf) INTO v_customer_doc
      FROM public.customers c WHERE c.id = v_given AND c.deactivated_at IS NULL;
      v_texts := COALESCE(public.normalize_document_text(concat_ws(' ', v_item->>'consignee_block', v_item->>'cargo_description')), '');
      IF v_resolved IS NOT NULL OR v_doc IS NOT NULL OR v_customer_doc IS NULL OR position(v_customer_doc IN v_texts) = 0 THEN
        RAISE EXCEPTION 'B/L %: o Cliente enviado não é o do CNPJ do consignatário no arquivo. Refaça a prévia e importe de novo.', v_id
          USING ERRCODE = '22023';
      END IF;
      v_resolved := v_given;
    END IF;
    IF v_resolved IS NOT NULL THEN
      v_item := v_item || jsonb_build_object(
        'customer_id', v_resolved, 'suggested_customer_id', NULL,
        'customer_reconciliation_status', 'matched_document',
        'customer_reconciliation_notes', 'Cliente reconciliado automaticamente por CNPJ.',
        'billing_hold_reason', NULL);
    ELSIF COALESCE(v_item->>'customer_reconciliation_status', '') = 'matched_name' THEN
      v_item := v_item || jsonb_build_object('customer_id', NULL);
    ELSE
      v_item := v_item || jsonb_build_object(
        'customer_id', NULL, 'customer_reconciliation_status', 'missing_customer',
        'customer_reconciliation_notes', 'Cliente nao encontrado na base cadastral.',
        'billing_hold_reason', 'Aguardando reconciliacao de cliente antes do faturamento.');
    END IF;

    -- Decisão 9 (ADR 0094, A2): refixar só com o aceite, em B/L gravado e
    -- não faturado.
    IF COALESCE(NULLIF(v_item->>'refix_prices', '')::boolean, false) THEN
      IF NOT v_exists THEN
        RAISE EXCEPTION 'B/L %: B/L novo não tem preço a refixar. Refaça a prévia e importe de novo.', v_id USING ERRCODE = '22023';
      END IF;
      IF v_invoiced THEN
        RAISE EXCEPTION 'B/L % já faturado: o preço é o da fatura e não é refixado.', v_id USING ERRCODE = '22023';
      END IF;
      v_refix := v_refix || v_id;
    END IF;
    v_item := v_item - 'refix_prices';

    v_items := v_items || jsonb_build_array(v_item);
  END LOOP;

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('result', jsonb_build_object('container_changes', '[]'::jsonb),
      'batch_id', NULL, 'calculation_errors', '[]'::jsonb,
      'cancelled_skipped', v_skipped, 'prices_refixed', '[]'::jsonb);
  END IF;

  IF p_batch IS NULL THEN
    v_result := public.import_bl_freight_transactional(v_items, p_changed_by);
  ELSE
    v_result := public.import_bl_freight_with_metadata(v_items, p_changed_by, p_batch);
  END IF;

  IF cardinality(v_refix) > 0 THEN
    v_refixed := COALESCE(public.refix_bl_local_charge_prices(v_refix,
      'Reimportação do arquivo de B/L: o operador aceitou o preço de hoje na prévia')->'refixed', '[]'::jsonb);
  END IF;

  RETURN v_result || jsonb_build_object('cancelled_skipped', v_skipped, 'prices_refixed', v_refixed);
END;
$function$;

-- Retrato do preço de um B/L: tabelas, Condição (itens com valor do Cliente)
-- e câmbio, com os totais calculados.
CREATE OR REPLACE FUNCTION public._bl_price_snapshot(p_bl_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'reference_date', (SELECT f.reference_date FROM public.bl_price_freezes f WHERE f.bl_id = p_bl_id),
    'roe', (SELECT f.roe FROM public.bl_price_freezes f WHERE f.bl_id = p_bl_id),
    'tables', COALESCE((SELECT jsonb_agg(DISTINCT t.name ORDER BY t.name) FROM public.bl_charge_table_links l
      JOIN public.charge_tables t ON t.id = l.charge_table_id WHERE l.bl_id = p_bl_id), '[]'::jsonb),
    'condition_items', (SELECT count(*) FROM public.bl_price_freeze_items i WHERE i.bl_id = p_bl_id AND i.override_value IS NOT NULL),
    'total_brl', (SELECT sum(c.total_value_brl) FROM public.charge_calculations c WHERE c.bl_id = p_bl_id),
    'total_usd', (SELECT sum(c.total_value_usd) FROM public.charge_calculations c WHERE c.bl_id = p_bl_id)
  );
$function$;

REVOKE ALL ON FUNCTION public._bl_price_snapshot(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bl_price_snapshot(text) TO service_role;

-- 5. Prévia do arquivo de B/L: o que a gravação vai conferir, pela mesma régua.
-- O preço de hoje é o cálculo de `refix_bl_local_charge_prices` dentro de uma
-- subtransação desfeita: nada fica gravado.
CREATE OR REPLACE FUNCTION public.bl_file_import_preview(p_voyage_id bigint, p_bl_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_bl record;
  v_rows jsonb := '[]'::jsonb;
  v_invoiced boolean;
  v_before jsonb;
  v_after jsonb;
  v_refix jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  FOR v_bl IN
    SELECT b.id, b.voyage_id, b.cancelled_at FROM public.bls b
    WHERE b.id = ANY(COALESCE(p_bl_ids, ARRAY[]::text[])) ORDER BY b.id
  LOOP
    v_invoiced := public._bl_has_emitted_local_invoice(v_bl.id);
    v_refix := NULL;
    IF v_bl.voyage_id = p_voyage_id AND v_bl.cancelled_at IS NULL AND NOT v_invoiced
       AND EXISTS (SELECT 1 FROM public.bl_price_freezes f WHERE f.bl_id = v_bl.id) THEN
      v_before := public._bl_price_snapshot(v_bl.id);
      v_after := NULL;
      BEGIN
        DELETE FROM public.bl_price_freeze_items WHERE bl_id = v_bl.id;
        DELETE FROM public.bl_price_freezes WHERE bl_id = v_bl.id;
        DELETE FROM public.bl_charge_table_links WHERE bl_id = v_bl.id;
        PERFORM public._calculate_bl_local_charges_impl_106(v_bl.id, auth.uid(), true);
        v_after := public._bl_price_snapshot(v_bl.id);
        RAISE EXCEPTION 'probe' USING ERRCODE = 'VL392';
      EXCEPTION
        WHEN SQLSTATE 'VL392' THEN NULL;
        WHEN OTHERS THEN v_after := jsonb_build_object('error', SQLERRM);
      END;
      IF v_after ? 'error' THEN
        v_refix := jsonb_build_object('before', v_before, 'after', v_after, 'differs', false);
      ELSE
        v_refix := jsonb_build_object('before', v_before, 'after', v_after,
          'differs', (v_before->'tables') IS DISTINCT FROM (v_after->'tables')
            OR (v_before->'condition_items') IS DISTINCT FROM (v_after->'condition_items')
            OR (v_before->'roe') IS DISTINCT FROM (v_after->'roe')
            OR (v_before->'total_brl') IS DISTINCT FROM (v_after->'total_brl'));
      END IF;
    END IF;
    v_rows := v_rows || jsonb_build_object(
      'bl_id', v_bl.id,
      'voyage_id', v_bl.voyage_id,
      'voyage_label', public._voyage_label(v_bl.voyage_id),
      'cancelled', v_bl.cancelled_at IS NOT NULL,
      'invoiced', v_invoiced,
      'refix', v_refix);
  END LOOP;
  RETURN v_rows;
END;
$function$;

REVOKE ALL ON FUNCTION public.bl_file_import_preview(bigint, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bl_file_import_preview(bigint, text[]) TO authenticated, service_role;
