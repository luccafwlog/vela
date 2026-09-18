-- 064: cubagem do B/L com semantica unica, e o sinal de carga solta completo
--
-- Achados A3, A4 e A8 da auditoria de 2026-09-18
-- (docs/archive/audits/2026-09-18-auditoria-unificacao-bls-eixos-1-4.md).
--
-- A4. A migration 061 deu significado unico ao peso -- `total_weight_kg` so
-- conteiner, `bb_weight_ton` so carga solta -- porque "nenhuma formula resolve
-- isso enquanto a coluna tiver dois significados". `bls.total_cbm` ficou de
-- fora e continuou com os mesmos dois donos:
--
--   breakbulkImport.ts  grava a cubagem da CARGA SOLTA
--   blFreightImport.ts  grava sum(bl_containers.cbm), a cubagem do CONTEINER
--
-- Num B/L misto, importar o B/L de armador depois do manifesto substitui uma
-- pela outra, e a ficha exibe o resultado sob o titulo "Resumo da carga solta".
-- E o mesmo defeito que a 061 diagnosticou, com o mesmo mecanismo. A correcao e
-- a mesma cirurgia:
--
--   bls.total_cbm -> SOMENTE carga conteinerizada
--   bls.bb_cbm    -> SOMENTE carga solta  (coluna nova)
--
-- A3. Como efeito, a cubagem de carga solta passa a ter dono unico e entra no
-- ON CONFLICT do importador -- ate aqui `total_cbm` era a unica metrica BB que
-- uma reimportacao nao atualizava, ao lado de bb_machine_qty, bb_packages_qty,
-- bb_packages_total e bb_weight_ton, que sempre foram atualizadas.
--
-- A8. `v_has_bb` considerava apenas itens, bb_weight_ton e bb_packages_qty. Um
-- B/L de carga solta declarado so com maquinas e cubagem sobrevivia ao INSERT
-- (ramo que preserva a modalidade declarada), mas qualquer UPDATE de
-- bb_weight_ton/bb_packages_qty saia desse ramo, recalculava e o reclassificava
-- como 'container' em silencio. bb_machine_qty e bb_cbm entram no sinal.
--
-- ATENCAO -- esta migration REESCREVE dados existentes (secao 1). Ela depende
-- da afirmacao "Data status" da secao Gotchas do CLAUDE.md: o projeto de
-- producao nao tem dados de negocio, toda linha e fixture e pode ser
-- descartada. Sem essa afirmacao o backfill abaixo NAO seria aceitavel: ele
-- move o valor de uma coluna para outra a partir de uma heuristica
-- (`cargo_mode`), sem plano de reversao. Se a afirmacao ja tiver sido revogada
-- quando voce ler isto, trate a secao 1 como perda de dados e revise antes de
-- aplicar em qualquer banco.

-- ---------------------------------------------------------------------------
-- 1. Coluna nova e backfill
-- ---------------------------------------------------------------------------

ALTER TABLE public.bls ADD COLUMN IF NOT EXISTS bb_cbm numeric(10,3);

ALTER TABLE public.bls DROP CONSTRAINT IF EXISTS bls_bb_cbm_nonneg;
ALTER TABLE public.bls ADD CONSTRAINT bls_bb_cbm_nonneg
  CHECK (bb_cbm IS NULL OR bb_cbm >= 0);

-- Autorizado pela afirmacao "Data status" do CLAUDE.md (ver cabecalho).
--
-- O criterio e o mesmo da 061: quem escreveu o valor. Num B/L sem conteiner, a
-- unica origem possivel de total_cbm e o importador de carga solta, entao o
-- valor migra inteiro. Num B/L misto nao da para saber qual dos dois donos
-- escreveu por ultimo -- a coluna e literalmente ambigua, e e por isso que esta
-- migration existe. Nesse caso a cubagem de conteiner e recomputada a partir
-- dos proprios conteineres (fonte de verdade que nao depende da coluna) e o
-- resto, se sobrar, fica com a carga solta.
UPDATE public.bls AS b
SET bb_cbm = b.total_cbm,
    total_cbm = NULL,
    updated_at = now()
WHERE b.cargo_mode = 'carga_solta'
  AND b.total_cbm IS NOT NULL;

UPDATE public.bls AS b
SET bb_cbm = GREATEST(COALESCE(b.total_cbm, 0) - COALESCE(cntr.cbm, 0), 0),
    total_cbm = cntr.cbm,
    updated_at = now()
FROM (
  SELECT bl_id, COALESCE(sum(cbm), 0) AS cbm
  FROM public.bl_containers
  GROUP BY bl_id
) AS cntr
WHERE cntr.bl_id = b.id
  AND b.cargo_mode = 'misto';

COMMENT ON COLUMN public.bls.total_cbm IS
  'Cubagem da carga CONTEINERIZADA, em m3. Nao inclui carga solta: esta fica em '
  'bb_cbm. As duas colunas sao disjuntas e somam para a cubagem total do B/L '
  '(ver operational_list_bl_summary e blTotalCbm no TypeScript).';

COMMENT ON COLUMN public.bls.bb_cbm IS
  'Cubagem da CARGA SOLTA, em m3. Nao inclui carga conteinerizada: esta fica em '
  'total_cbm.';

-- ---------------------------------------------------------------------------
-- 2. A8: bb_machine_qty e bb_cbm passam a contar como sinal de carga solta
-- ---------------------------------------------------------------------------

-- As duas funcoes abaixo sao a definicao VIVA da migration 062 (secao 2,
-- "Guardas pos-faturamento de conteudo") com uma unica alteracao: o calculo de
-- v_has_bb. Foram copiadas na integra de proposito -- reescrever a partir da
-- 060 apagaria as guardas que a 062 acrescentou para B/L faturado cujo conteudo
-- muda sem mudar de modalidade.

CREATE OR REPLACE FUNCTION public._recalculate_bl_cargo_mode(
  p_bl_id text,
  p_transition text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_curr_mode text;
  v_new_mode text;
  v_has_cntr boolean;
  v_has_bb boolean;
  v_financial_status text;
  v_old_rank integer;
  v_new_rank integer;
  v_locked boolean;
  v_locked_addition boolean;
  v_replacement boolean := COALESCE(current_setting('vela.breakbulk_import_replacement', true), 'off') = 'on';
BEGIN
  IF p_bl_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(cargo_mode, 'container'), COALESCE(financial_status, 'pending')
    INTO v_curr_mode, v_financial_status
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = p_bl_id
  ) INTO v_has_cntr;

  -- A8: maquinas e cubagem sao carga solta declarada tanto quanto peso e
  -- volumes. Um manifesto parcial pode trazer so esses dois, e sem eles no
  -- sinal qualquer UPDATE reclassificava o B/L como 'container' em silencio.
  SELECT EXISTS (
    SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = p_bl_id
  ) OR EXISTS (
    SELECT 1 FROM public.bls
    WHERE id = p_bl_id
      AND (
        COALESCE(bb_weight_ton, 0) > 0
        OR COALESCE(bb_packages_qty, 0) > 0
        OR COALESCE(bb_machine_qty, 0) > 0
        OR COALESCE(bb_cbm, 0) > 0
      )
  ) INTO v_has_bb;

  v_new_mode := CASE
    WHEN v_has_cntr AND v_has_bb THEN 'misto'
    WHEN v_has_bb THEN 'carga_solta'
    ELSE 'container'
  END;

  v_old_rank := CASE v_curr_mode
    WHEN 'misto' THEN 2
    WHEN 'carga_solta' THEN 1
    ELSE 0
  END;
  v_new_rank := CASE v_new_mode
    WHEN 'misto' THEN 2
    WHEN 'carga_solta' THEN 1
    ELSE 0
  END;
  v_locked := v_financial_status IN ('invoiced', 'paid');

  -- Se a modalidade não mudou, mas o B/L está faturado e houve mutação de itens filhos:
  IF v_curr_mode IS NOT DISTINCT FROM v_new_mode THEN
    IF v_locked AND NOT v_replacement THEN
      IF p_transition = 'delete' THEN
        UPDATE public.bls
        SET charge_status = 'not_calculated',
            review_status = 'pending_review',
            billing_hold_reason = 'Carga removida após faturamento; estorno/refaturamento necessário.',
            updated_at = now()
        WHERE id = p_bl_id;
        IF EXISTS (
          SELECT 1 FROM public.bl_receivables
          WHERE bl_id = p_bl_id AND source = 'local_charges'
        ) THEN
          PERFORM public.sync_local_charge_receivable(p_bl_id);
        END IF;
      ELSIF p_transition = 'insert' THEN
        UPDATE public.bls
        SET charge_status = 'not_calculated',
            review_status = 'pending_review',
            billing_hold_reason = 'Carga adicionada após faturamento; revisar e refaturar.',
            updated_at = now()
        WHERE id = p_bl_id;
        IF EXISTS (
          SELECT 1 FROM public.bl_receivables
          WHERE bl_id = p_bl_id AND source = 'local_charges'
        ) THEN
          PERFORM public.sync_local_charge_receivable(p_bl_id);
        END IF;
      ELSIF p_transition = 'update' THEN
        UPDATE public.bls
        SET charge_status = 'not_calculated',
            review_status = 'pending_review',
            billing_hold_reason = 'Carga alterada após faturamento; estorno/refaturamento necessário.',
            updated_at = now()
        WHERE id = p_bl_id;
        IF EXISTS (
          SELECT 1 FROM public.bl_receivables
          WHERE bl_id = p_bl_id AND source = 'local_charges'
        ) THEN
          PERFORM public.sync_local_charge_receivable(p_bl_id);
        END IF;
      END IF;
    END IF;
    RETURN;
  END IF;

  -- Remover conteúdo de um B/L faturado é uma perda material e precisa de
  -- estorno/refaturamento. Adicionar conteúdo é permitido, mas reabre revisão
  -- e billing hold. O importador usa o GUC transacional abaixo para atravessar
  -- a remoção intermediária da substituição atômica, após o preflight validar
  -- que o resultado final não remove carga BB faturada.
  IF v_locked AND v_old_rank > v_new_rank AND NOT v_replacement THEN
    RAISE EXCEPTION
      'B/L % ja foi faturado (status financeiro=%); remover conteudo exige estorno/refaturamento (transicao=%).',
      p_bl_id, v_financial_status, COALESCE(p_transition, 'recalculo')
      USING ERRCODE = 'P0003';
  END IF;

  v_locked_addition := v_locked AND v_new_rank > v_old_rank;

  UPDATE public.bls
  SET cargo_mode = v_new_mode,
      charge_status = 'not_calculated',
      review_status = CASE WHEN v_locked_addition THEN 'pending_review' ELSE review_status END,
      billing_hold_reason = CASE
        WHEN v_locked_addition THEN 'Carga adicionada após faturamento; revisar e refaturar.'
        ELSE billing_hold_reason
      END,
      updated_at = now()
  WHERE id = p_bl_id;

  IF v_new_mode <> 'container' OR v_has_cntr THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND source = 'auto'
      AND calculation_key IN ('review:no_container', 'review:no_containers');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE bl_id = p_bl_id AND source = 'local_charges'
  ) THEN
    PERFORM public.sync_local_charge_receivable(p_bl_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sync_bl_weight_cargo_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_has_cntr boolean;
  v_has_bb boolean;
  v_new_mode text;
  v_old_mode text := COALESCE(OLD.cargo_mode, 'container');
  v_old_rank integer;
  v_new_rank integer;
  v_financial_status text := COALESCE(OLD.financial_status, 'pending');
  v_replacement boolean := COALESCE(current_setting('vela.breakbulk_import_replacement', true), 'off') = 'on';
  v_weight_decreased boolean := false;
  v_weight_increased boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.voyage_id IS DISTINCT FROM OLD.voyage_id OR
    NEW.customer_id IS DISTINCT FROM OLD.customer_id
  ) THEN
    NEW.charge_status := 'not_calculated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bl_containers WHERE bl_id = NEW.id
  ) INTO v_has_cntr;

  -- A8: ver comentario em _recalculate_bl_cargo_mode.
  v_has_bb := (
    COALESCE(NEW.bb_weight_ton, 0) > 0 OR
    COALESCE(NEW.bb_packages_qty, 0) > 0 OR
    COALESCE(NEW.bb_machine_qty, 0) > 0 OR
    COALESCE(NEW.bb_cbm, 0) > 0 OR
    EXISTS (SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = NEW.id)
  );

  IF TG_OP = 'INSERT' AND NOT v_has_cntr AND NOT v_has_bb THEN
    NEW.cargo_mode := COALESCE(NULLIF(btrim(NEW.cargo_mode), ''), 'container');
    NEW.charge_status := COALESCE(NEW.charge_status, 'not_calculated');
    RETURN NEW;
  END IF;

  v_new_mode := CASE
    WHEN v_has_cntr AND v_has_bb THEN 'misto'
    WHEN v_has_bb THEN 'carga_solta'
    ELSE 'container'
  END;
  v_old_rank := CASE v_old_mode WHEN 'misto' THEN 2 WHEN 'carga_solta' THEN 1 ELSE 0 END;
  v_new_rank := CASE v_new_mode WHEN 'misto' THEN 2 WHEN 'carga_solta' THEN 1 ELSE 0 END;

  IF TG_OP = 'UPDATE'
     AND v_financial_status IN ('invoiced', 'paid')
     AND v_old_rank > v_new_rank
     AND NOT v_replacement THEN
    RAISE EXCEPTION
      'B/L % ja foi faturado (status financeiro=%); remover conteudo exige estorno/refaturamento.',
      NEW.id, v_financial_status
      USING ERRCODE = 'P0003';
  END IF;

  IF TG_OP = 'UPDATE' AND v_financial_status IN ('invoiced', 'paid')
     AND COALESCE(NEW.financial_status, 'pending') = 'pending' THEN
    NEW.financial_status := OLD.financial_status;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.cargo_mode IS DISTINCT FROM v_new_mode THEN
    NEW.charge_status := 'not_calculated';
  ELSE
    NEW.charge_status := COALESCE(NEW.charge_status, 'not_calculated');
  END IF;

  IF TG_OP = 'UPDATE' AND v_financial_status IN ('invoiced', 'paid') THEN
    IF v_new_rank > v_old_rank THEN
      NEW.review_status := 'pending_review';
      NEW.billing_hold_reason := 'Carga adicionada após faturamento; revisar e refaturar.';
    ELSIF (OLD.bb_weight_ton IS DISTINCT FROM NEW.bb_weight_ton)
       OR (OLD.total_weight_kg IS DISTINCT FROM NEW.total_weight_kg)
       OR (OLD.bb_packages_qty IS DISTINCT FROM NEW.bb_packages_qty) THEN
      v_weight_decreased := (
        COALESCE(NEW.bb_weight_ton, 0) < COALESCE(OLD.bb_weight_ton, 0) OR
        COALESCE(NEW.total_weight_kg, 0) < COALESCE(OLD.total_weight_kg, 0) OR
        COALESCE(NEW.bb_packages_qty, 0) < COALESCE(OLD.bb_packages_qty, 0)
      );
      v_weight_increased := (
        COALESCE(NEW.bb_weight_ton, 0) > COALESCE(OLD.bb_weight_ton, 0) OR
        COALESCE(NEW.total_weight_kg, 0) > COALESCE(OLD.total_weight_kg, 0) OR
        COALESCE(NEW.bb_packages_qty, 0) > COALESCE(OLD.bb_packages_qty, 0)
      );
      IF v_weight_decreased THEN
        NEW.review_status := 'pending_review';
        NEW.billing_hold_reason := 'Carga reduzida após faturamento; estorno/refaturamento necessário.';
        NEW.charge_status := 'not_calculated';
      ELSIF v_weight_increased THEN
        NEW.review_status := 'pending_review';
        NEW.billing_hold_reason := 'Carga adicionada após faturamento; revisar e refaturar.';
        NEW.charge_status := 'not_calculated';
      END IF;
    END IF;
  END IF;

  NEW.cargo_mode := v_new_mode;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_sync_bl_weight_cargo_mode() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._recalculate_bl_cargo_mode(text, text) FROM PUBLIC, anon, authenticated;

-- O trigger precisa observar bb_machine_qty e bb_cbm: sem isso o sinal novo
-- nunca seria reavaliado quando so essas duas colunas mudassem.
DROP TRIGGER IF EXISTS trg_bl_weight_cargo_mode ON public.bls;
CREATE TRIGGER trg_bl_weight_cargo_mode
BEFORE INSERT OR UPDATE OF cargo_mode, bb_weight_ton, bb_packages_qty, bb_machine_qty, bb_cbm ON public.bls
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_bl_weight_cargo_mode();

-- ---------------------------------------------------------------------------
-- 3. A3: a cubagem de carga solta entra no upsert do importador
-- ---------------------------------------------------------------------------

-- Reescreve import_breakbulk_manifest_transactional da 060 mudando duas coisas:
-- o payload passa a trazer bb_cbm (nao total_cbm), e bb_cbm entra tanto no
-- INSERT quanto no ON CONFLICT DO UPDATE. As demais colunas comerciais
-- (pol, pod, shipper, consignee, cargo_description) continuam preservadas na
-- reimportacao, como no legado `p_apply_overwrites = false` -- isso e
-- deliberado e nao muda aqui.
CREATE OR REPLACE FUNCTION public.import_breakbulk_manifest_transactional(
  p_filename text,
  p_voyage_id bigint,
  p_uploaded_by uuid,
  p_total_bls integer,
  p_bls jsonb,
  p_items jsonb,
  p_errors jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_bl_id text;
  v_bl_ids text[];
  v_existing_bb boolean;
  v_incoming_bb boolean;
  v_preserved_bls jsonb;
  v_batch_id bigint;
  v_action_id uuid := gen_random_uuid();
  v_previous_replacement text := current_setting('vela.breakbulk_import_replacement', true);
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Credenciais invalidas para importar carga solta.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(source.row->>'id'), ARRAY[]::text[])
    INTO v_bl_ids
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row);

  FOR v_row IN
    SELECT b.id, b.financial_status, b.bb_weight_ton, b.bb_packages_qty,
      source.row AS incoming
    FROM public.bls AS b
    JOIN jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row)
      ON b.id = source.row->>'id'
    FOR UPDATE OF b
  LOOP
    v_existing_bb := COALESCE(v_row.bb_weight_ton, 0) > 0
      OR COALESCE(v_row.bb_packages_qty, 0) > 0
      OR EXISTS (SELECT 1 FROM public.bl_breakbulk_items WHERE bl_id = v_row.id);
    v_incoming_bb := COALESCE(NULLIF(v_row.incoming->>'bb_weight_ton', '')::numeric, 0) > 0
      OR COALESCE(NULLIF(v_row.incoming->>'bb_packages_qty', '')::numeric, 0) > 0
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item(row)
        WHERE item.row->>'bl_id' = v_row.id
      );

    IF v_row.financial_status IN ('invoiced', 'paid') AND v_existing_bb AND NOT v_incoming_bb THEN
      RAISE EXCEPTION
        'B/L % ja foi faturado (status financeiro=%); a importacao removeria carga solta. Estorne/refature antes de substituir o manifesto.',
        v_row.id, v_row.financial_status
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN b.financial_status IN ('invoiced', 'paid')
        THEN source.row || jsonb_build_object('financial_status', b.financial_status)
      ELSE source.row
    END
  ), '[]'::jsonb)
  INTO v_preserved_bls
  FROM jsonb_array_elements(COALESCE(p_bls, '[]'::jsonb)) AS source(row)
  LEFT JOIN public.bls AS b ON b.id = source.row->>'id';

  PERFORM set_config('vela.breakbulk_import_replacement', 'on', true);
  v_batch_id := public.import_manifest_transactional_legacy_165(
    p_filename,
    p_voyage_id,
    p_uploaded_by,
    'carga_solta',
    NULL,
    p_total_bls,
    0,
    '[]'::jsonb,
    '[]'::jsonb,
    COALESCE(p_errors, '[]'::jsonb)
  );

  INSERT INTO public.bls (
    id, voyage_id, batch_id, cargo_mode, shipper, consignee, cargo_description,
    customer_id, pol, pod, total_weight_kg, review_status,
    financial_status, notes, manifest_customer_cnpj_cpf, manifest_customer_name,
    manifest_customer_email, customer_reconciliation_status,
    customer_reconciliation_notes, billing_hold_reason, ce_mercante, notify_party,
    bb_machine_qty, bb_packages_qty, bb_packages_total, bb_weight_ton, bb_cbm, ncm_codes
  )
  SELECT
    source.row->>'id',
    p_voyage_id,
    v_batch_id,
    'carga_solta',
    source.row->>'shipper',
    source.row->>'consignee',
    source.row->>'cargo_description',
    NULLIF(source.row->>'customer_id', '')::bigint,
    source.row->>'pol',
    source.row->>'pod',
    NULLIF(source.row->>'total_weight_kg', '')::numeric,
    COALESCE(NULLIF(source.row->>'review_status', ''), 'ok'),
    COALESCE(NULLIF(source.row->>'financial_status', ''), 'pending'),
    source.row->>'notes',
    public.normalize_document_text(source.row->>'manifest_customer_cnpj_cpf'),
    COALESCE(NULLIF(source.row->>'manifest_customer_name', ''), source.row->>'consignee'),
    NULLIF(source.row->>'manifest_customer_email', ''),
    COALESCE(NULLIF(source.row->>'customer_reconciliation_status', ''), 'missing_customer'),
    NULLIF(source.row->>'customer_reconciliation_notes', ''),
    NULLIF(source.row->>'billing_hold_reason', ''),
    NULLIF(source.row->>'ce_mercante', ''),
    NULLIF(source.row->>'notify_party', ''),
    NULLIF(source.row->>'bb_machine_qty', '')::numeric,
    NULLIF(source.row->>'bb_packages_qty', '')::numeric,
    NULLIF(source.row->>'bb_packages_total', '')::numeric,
    NULLIF(source.row->>'bb_weight_ton', '')::numeric,
    NULLIF(source.row->>'bb_cbm', '')::numeric,
    COALESCE(public.normalize_ncm_codes(source.row->'ncm_codes'), '{}'::text[])
  FROM jsonb_array_elements(v_preserved_bls) AS source(row)
  ON CONFLICT (id) DO UPDATE SET
    voyage_id = EXCLUDED.voyage_id,
    batch_id = EXCLUDED.batch_id,
    cargo_mode = EXCLUDED.cargo_mode,
    customer_id = EXCLUDED.customer_id,
    review_status = EXCLUDED.review_status,
    financial_status = EXCLUDED.financial_status,
    notes = EXCLUDED.notes,
    manifest_customer_cnpj_cpf = EXCLUDED.manifest_customer_cnpj_cpf,
    manifest_customer_name = EXCLUDED.manifest_customer_name,
    manifest_customer_email = EXCLUDED.manifest_customer_email,
    customer_reconciliation_status = EXCLUDED.customer_reconciliation_status,
    customer_reconciliation_notes = EXCLUDED.customer_reconciliation_notes,
    billing_hold_reason = EXCLUDED.billing_hold_reason,
    ce_mercante = EXCLUDED.ce_mercante,
    notify_party = EXCLUDED.notify_party,
    bb_machine_qty = EXCLUDED.bb_machine_qty,
    bb_packages_qty = EXCLUDED.bb_packages_qty,
    bb_packages_total = EXCLUDED.bb_packages_total,
    bb_weight_ton = EXCLUDED.bb_weight_ton,
    -- A3: a cubagem de carga solta e metrica do manifesto, irma das quatro
    -- acima. Ficava de fora e so era gravada no INSERT, entao reimportar um
    -- manifesto com CBM corrigido atualizava tudo menos a cubagem.
    bb_cbm = EXCLUDED.bb_cbm,
    ncm_codes = CASE WHEN cardinality(EXCLUDED.ncm_codes) > 0 THEN EXCLUDED.ncm_codes ELSE public.bls.ncm_codes END;

  UPDATE public.bls AS target
  SET
    ce_mercante = CASE
      WHEN source.row ? 'ce_mercante' THEN NULLIF(source.row->>'ce_mercante', '')
      ELSE target.ce_mercante
    END,
    notify_party = NULLIF(source.row->>'notify_party', ''),
    bb_machine_qty = NULLIF(source.row->>'bb_machine_qty', '')::numeric,
    bb_packages_qty = NULLIF(source.row->>'bb_packages_qty', '')::numeric,
    bb_packages_total = NULLIF(source.row->>'bb_packages_total', '')::numeric,
    bb_weight_ton = NULLIF(source.row->>'bb_weight_ton', '')::numeric,
    bb_cbm = NULLIF(source.row->>'bb_cbm', '')::numeric,
    ncm_codes = CASE
      WHEN cardinality(public.normalize_ncm_codes(source.row->'ncm_codes')) > 0
        THEN public.normalize_ncm_codes(source.row->'ncm_codes')
      ELSE target.ncm_codes
    END
  FROM jsonb_array_elements(v_preserved_bls) AS source(row)
  WHERE target.id = source.row->>'id';

  DELETE FROM public.bl_breakbulk_items
  WHERE bl_id = ANY(v_bl_ids);

  INSERT INTO public.bl_breakbulk_items (
    bl_id, item_description, package_qty, package_unit,
    gross_weight_kg, cbm, marks
  )
  SELECT
    source.row->>'bl_id',
    source.row->>'item_description',
    COALESCE(NULLIF(source.row->>'package_qty', '')::numeric, 0),
    NULLIF(source.row->>'package_unit', ''),
    COALESCE(NULLIF(source.row->>'gross_weight_kg', '')::numeric, 0),
    COALESCE(NULLIF(source.row->>'cbm', '')::numeric, 0),
    NULLIF(source.row->>'marks', '')
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS source(row);

  IF cardinality(v_bl_ids) > 0 THEN
    PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by);
    FOREACH v_bl_id IN ARRAY v_bl_ids LOOP
      INSERT INTO public.import_pending_effects(
        source_action_id, effect_kind, entity_id, created_by, source_snapshot
      ) VALUES (
        v_action_id, 'local_billing', v_bl_id, p_uploaded_by,
        jsonb_build_object('filename', p_filename, 'voyage_id', p_voyage_id, 'cargo_mode', 'carga_solta')
      )
      ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
    END LOOP;
  END IF;

  PERFORM set_config('vela.breakbulk_import_replacement', COALESCE(v_previous_replacement, 'off'), true);
  RETURN jsonb_build_object('batch_id', v_batch_id, 'breakbulk_bl_ids', to_jsonb(v_bl_ids));
END;
$function$;

REVOKE ALL ON FUNCTION public.import_breakbulk_manifest_transactional(text,bigint,uuid,integer,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.import_breakbulk_manifest_transactional(text,bigint,uuid,integer,jsonb,jsonb,jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Resumo operacional: cubagem some os dois componentes disjuntos
-- ---------------------------------------------------------------------------

-- Mesmo raciocinio da 063 para o peso: com as colunas disjuntas, `totalCbm`
-- passa a ser a soma aditiva, e `breakbulkCbm` expoe estritamente a carga
-- solta para o card da tela nao misturar as duas lentes.
CREATE OR REPLACE FUNCTION public.operational_list_bl_summary(
  p_search text DEFAULT NULL::text,
  p_voyage_id bigint DEFAULT NULL::bigint,
  p_cargo_mode text DEFAULT NULL::text,
  p_pol text DEFAULT NULL::text,
  p_pod text DEFAULT NULL::text,
  p_review_status text DEFAULT NULL::text,
  p_financial_status text DEFAULT NULL::text,
  p_charge_status text DEFAULT NULL::text,
  p_cargo_profile text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
WITH filtered AS (
  SELECT b.*
  FROM public.bls b
  LEFT JOIN public.customers c ON c.id = b.customer_id
  WHERE (p_voyage_id IS NULL OR b.voyage_id = p_voyage_id)
    AND public.bl_cargo_mode_matches_filter(b.cargo_mode, p_cargo_mode)
    AND (NULLIF(btrim(coalesce(p_pol, '')), '') IS NULL OR b.pol ILIKE '%' || btrim(p_pol) || '%')
    AND (NULLIF(btrim(coalesce(p_pod, '')), '') IS NULL OR b.pod ILIKE '%' || btrim(p_pod) || '%')
    AND (NULLIF(btrim(coalesce(p_review_status, '')), '') IS NULL OR b.review_status = p_review_status)
    AND (NULLIF(btrim(coalesce(p_financial_status, '')), '') IS NULL OR b.financial_status = p_financial_status)
    AND (NULLIF(btrim(coalesce(p_charge_status, '')), '') IS NULL OR lower(btrim(coalesce(b.charge_status, ''))) = lower(btrim(p_charge_status)))
    AND (NULLIF(btrim(coalesce(p_search, '')), '') IS NULL OR b.id ILIKE '%' || btrim(p_search) || '%' OR b.consignee ILIKE '%' || btrim(p_search) || '%' OR c.name ILIKE '%' || btrim(p_search) || '%' OR c.cnpj_cpf ILIKE '%' || btrim(p_search) || '%')
    AND (
      NULLIF(btrim(coalesce(p_cargo_profile, '')), '') IS NULL
      OR (p_cargo_profile = 'standard' AND NOT EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND (coalesce(bc.is_imo, false) OR coalesce(bc.is_oog, false))))
      OR (p_cargo_profile = 'imo' AND EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_imo, false)))
      OR (p_cargo_profile = 'oog' AND EXISTS (SELECT 1 FROM public.bl_containers bc WHERE bc.bl_id = b.id AND coalesce(bc.is_oog, false)))
    )
)
SELECT jsonb_build_object(
  'totalBls', count(*)::integer,
  'totalDistinctContainers', (SELECT count(DISTINCT upper(btrim(bc.container_number))) FROM public.bl_containers bc JOIN filtered f ON f.id = bc.bl_id WHERE nullif(btrim(bc.container_number), '') IS NOT NULL),
  'pendingReview', count(*) FILTER (WHERE review_status = 'pending_review')::integer,
  'pendingFinancial', count(*) FILTER (WHERE financial_status = 'pending')::integer,
  'chargePending', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) IN ('review_required', 'not_calculated'))::integer,
  'chargeReady', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) = 'ready_for_billing')::integer,
  'chargeExempt', count(*) FILTER (WHERE lower(btrim(coalesce(charge_status, ''))) = 'exempt')::integer,
  'totalMachines', coalesce(sum(bb_machine_qty), 0),
  'totalPackages', coalesce(sum(coalesce(bb_packages_total, bb_packages_qty)), 0),
  'breakbulkWeightTon', coalesce(sum(bb_weight_ton), 0),
  'totalWeightTon', coalesce(sum(coalesce(total_weight_kg, 0) / 1000 + coalesce(bb_weight_ton, 0)), 0),
  'breakbulkCbm', coalesce(sum(bb_cbm), 0),
  -- Somar os dois componentes evita perder a cubagem de conteiner em B/L misto.
  'totalCbm', coalesce(sum(coalesce(total_cbm, 0) + coalesce(bb_cbm, 0)), 0)
)
FROM filtered;
$function$;

REVOKE ALL ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_list_bl_summary(text, bigint, text, text, text, text, text, text, text) TO authenticated, service_role;
