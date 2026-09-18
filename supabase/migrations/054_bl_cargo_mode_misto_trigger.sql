-- 054: Admissao de cargo_mode = 'misto' e trigger de derivacao automatica
--
-- Conforme spec docs/spec/2026-09-16-unificacao-bls-carga-mista-design.md:
--   1. bls.cargo_mode passa a admitir 'container', 'carga_solta' e 'misto'.
--   2. validate_bl_breakbulk_item_parent passa a aceitar pai 'container' ou 'misto'.
--   3. recalculate_bl_cargo_mode deriva a modalidade automaticamente a partir do conteudo observado.
--   4. Triggers em bl_containers, bl_breakbulk_items e bls sincronizam a modalidade.
--   5. ensure_container_bl_charge_status_default trata 'misto' para efeito do default de charge_status.

-- 1. Constraint em bls.cargo_mode
ALTER TABLE public.bls DROP CONSTRAINT IF EXISTS bls_cargo_mode_check;
ALTER TABLE public.bls ADD CONSTRAINT bls_cargo_mode_check 
  CHECK (cargo_mode IN ('container', 'carga_solta', 'misto'));

-- 2. Atualizacao de validate_bl_breakbulk_item_parent
CREATE OR REPLACE FUNCTION public.validate_bl_breakbulk_item_parent() 
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  parent_mode TEXT;
BEGIN
  SELECT cargo_mode
    INTO parent_mode
  FROM public.bls
  WHERE id = NEW.bl_id;

  IF parent_mode IS NULL THEN
    RAISE EXCEPTION 'BL nao encontrado para item de carga solta';
  END IF;

  IF parent_mode NOT IN ('container', 'carga_solta', 'misto') THEN
    RAISE EXCEPTION 'Modalidade de carga invalida para item de carga solta: %', parent_mode;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. ensure_container_bl_charge_status_default abrangendo 'misto'
CREATE OR REPLACE FUNCTION public.ensure_container_bl_charge_status_default() 
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF COALESCE(NEW.cargo_mode, 'container') IN ('container', 'misto') AND NEW.charge_status IS NULL THEN
    NEW.charge_status := 'not_calculated';
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Funcao de recalculacao automatica da modalidade de carga
CREATE OR REPLACE FUNCTION public.recalculate_bl_cargo_mode(p_bl_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_has_cntr boolean;
  v_has_bb boolean;
  v_new_mode text;
  v_curr_mode text;
  v_charge_status text;
BEGIN
  IF p_bl_id IS NULL THEN
    RETURN;
  END IF;

  SELECT (COUNT(*) > 0) INTO v_has_cntr 
  FROM public.bl_containers 
  WHERE bl_id = p_bl_id;
  
  SELECT (
    COUNT(*) > 0 
    OR EXISTS (
      SELECT 1 FROM public.bls 
      WHERE id = p_bl_id 
        AND (COALESCE(bb_weight_ton, 0) > 0 OR COALESCE(bb_packages_qty, 0) > 0)
    )
  ) INTO v_has_bb 
  FROM public.bl_breakbulk_items 
  WHERE bl_id = p_bl_id;

  IF v_has_cntr AND v_has_bb THEN
    v_new_mode := 'misto';
  ELSIF v_has_bb THEN
    v_new_mode := 'carga_solta';
  ELSE
    v_new_mode := 'container';
  END IF;

  SELECT cargo_mode, charge_status 
  INTO v_curr_mode, v_charge_status 
  FROM public.bls 
  WHERE id = p_bl_id;

  IF v_curr_mode IS DISTINCT FROM v_new_mode THEN
    UPDATE public.bls 
    SET cargo_mode = v_new_mode,
        charge_status = CASE 
          WHEN charge_status = 'billed' THEN 'billed'
          ELSE 'not_calculated' 
        END,
        updated_at = now()
    WHERE id = p_bl_id;

    -- Limpa calculos automaticos obsoletos ao mudar de modalidade
    IF v_charge_status <> 'billed' THEN
      DELETE FROM public.charge_calculations 
      WHERE bl_id = p_bl_id AND source = 'auto';
    END IF;
  END IF;
END;
$$;

-- 5. Triggers de sincronizacao
CREATE OR REPLACE FUNCTION public.trg_sync_bl_cargo_mode()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_bl_cargo_mode(OLD.bl_id);
  ELSE
    PERFORM public.recalculate_bl_cargo_mode(NEW.bl_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_bl_containers_cargo_mode ON public.bl_containers;
CREATE TRIGGER trg_bl_containers_cargo_mode
AFTER INSERT OR UPDATE OR DELETE ON public.bl_containers
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_bl_cargo_mode();

DROP TRIGGER IF EXISTS trg_bl_breakbulk_cargo_mode ON public.bl_breakbulk_items;
CREATE TRIGGER trg_bl_breakbulk_cargo_mode
AFTER INSERT OR UPDATE OR DELETE ON public.bl_breakbulk_items
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_bl_cargo_mode();

CREATE OR REPLACE FUNCTION public.trg_sync_bl_weight_cargo_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_has_cntr boolean;
  v_has_bb boolean;
  v_new_mode text;
BEGIN
  SELECT (COUNT(*) > 0) INTO v_has_cntr 
  FROM public.bl_containers 
  WHERE bl_id = NEW.id;

  SELECT (
    COUNT(*) > 0 
    OR (COALESCE(NEW.bb_weight_ton, 0) > 0 OR COALESCE(NEW.bb_packages_qty, 0) > 0)
  ) INTO v_has_bb
  FROM public.bl_breakbulk_items 
  WHERE bl_id = NEW.id;

  IF v_has_cntr AND v_has_bb THEN
    v_new_mode := 'misto';
  ELSIF v_has_bb THEN
    v_new_mode := 'carga_solta';
  ELSE
    v_new_mode := 'container';
  END IF;

  IF NEW.cargo_mode IS DISTINCT FROM v_new_mode THEN
    NEW.cargo_mode := v_new_mode;
    IF NEW.charge_status <> 'billed' THEN
      NEW.charge_status := 'not_calculated';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bl_weight_cargo_mode ON public.bls;
CREATE TRIGGER trg_bl_weight_cargo_mode
BEFORE UPDATE OF bb_weight_ton, bb_packages_qty ON public.bls
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_bl_weight_cargo_mode();
