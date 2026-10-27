-- 482: TBC não é terminal (revisão da PR #1070, decisões do dono de
-- 2026-10-27; ADR 0109).
--
-- Problema e mudança, por seção:
--   1. A 477 passou a apagar a Atracação TBC quando a frente ganha terminal,
--      mas a guarda de remoção conferia a trava de documento (CE, fatura, ADR
--      fechado) do porto inteiro, porque a TBC não tem terminal. Num porto com
--      B/L com CE, escolher o terminal era recusado ("Atracação travada") e,
--      com o ATA registrado, manter TBC também: a escala ficava impossível de
--      salvar. A Atracação TBC não tem documento próprio: sai sem a trava.
--   2. Decisão do dono: TBC não é terminal, é só "terminal a confirmar". O
--      banco recusa ATB, ATD e Restow em Atracação TBC sempre (não só depois
--      do ATA); ETB e ETD estimadas continuam. As TBC com esses campos
--      gravados perdem os campos, e as que ficam sem frente em TBC saem.
--   3. A regra do ATA (toda frente com terminal) e a saída da Atracação TBC
--      existiam só na gravação v2; a v1 (`save_voyage_escala_terminal_state`,
--      usada pela declaração de exportação) as contornava. A v1 vira invólucro
--      com as duas regras sobre o corpo anterior.
--
-- Data status: a seção 2 apaga ATB, ATD e Restow de Atracações TBC e apaga
-- Atracações TBC sem frente em TBC. Depende da afirmação "Data status" do
-- AGENTS.md (2026-09-18): a produção não tem dados reais de negócio.
--
-- Rollback: reaplicar `guard_terminal_state_removal` da `477`; DROP TRIGGER
-- trg_tbc_sem_datas_realizadas e DROP FUNCTION
-- public.guard_tbc_sem_datas_realizadas(); DROP FUNCTION
-- public.save_voyage_escala_terminal_state(...) (o invólucro), renomear
-- `save_voyage_escala_terminal_state_legacy_482` de volta e devolver o EXECUTE
-- a `authenticated`; DROP FUNCTION public._escala_ata_registrada(bigint, text, jsonb).

-- 1. A Atracação TBC sai sem a trava de documento ------------------------------

CREATE OR REPLACE FUNCTION public.guard_terminal_state_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lock text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;
  -- 482: a Atracação TBC (sem terminal) não tem documento próprio; sai pela
  -- gravação da escala sem a trava do porto.
  IF OLD.terminal_id IS NULL THEN
    RETURN OLD;
  END IF;
  -- 477 (02-viagens-adr:2): Operações também troca o terminal de uma frente.
  IF NOT (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.active AND up.role = 'operacoes')
  ) THEN
    RAISE EXCEPTION 'Somente Operações e o Administrativo removem atracação.' USING ERRCODE = '42501';
  END IF;
  v_lock := public.delete_lock_reasons(OLD.voyage_id, OLD.port, OLD.terminal_id);
  IF cardinality(v_lock) > 0 THEN
    RAISE EXCEPTION 'Atracação travada: %.', array_to_string(v_lock, ', ') USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_terminal_state_removal() FROM PUBLIC, anon, authenticated;

-- 2. Atracação TBC sem ATB, ATD e Restow ---------------------------------------

-- TBC com datas realizadas (Data status no cabeçalho). Viagem cancelada fica
-- como está: está selada (guard_voyage_cancelled_mutation).
UPDATE public.voyage_escala_terminal_state AS s
SET terminal_atb = NULL, terminal_atd = NULL, terminal_rtw = NULL
WHERE s.terminal_id IS NULL
  AND (s.terminal_atb IS NOT NULL OR s.terminal_atd IS NOT NULL OR s.terminal_rtw IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.voyages v WHERE v.id = s.voyage_id AND v.status = 'cancelled');

DO $$
DECLARE
  v_voyage bigint;
BEGIN
  FOR v_voyage IN
    WITH removed AS (
      DELETE FROM public.voyage_escala_terminal_state AS s
      WHERE s.terminal_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.voyage_escala_operation_fronts AS f
          WHERE f.voyage_id = s.voyage_id AND f.port = s.port AND f.terminal_id IS NULL
        )
        AND NOT EXISTS (SELECT 1 FROM public.voyages v WHERE v.id = s.voyage_id AND v.status = 'cancelled')
      RETURNING s.voyage_id
    )
    SELECT DISTINCT voyage_id FROM removed
  LOOP
    PERFORM public.refresh_voyage_status_from_terminal_scales(v_voyage);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_tbc_sem_datas_realizadas()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.terminal_id IS NULL
     AND (NEW.terminal_atb IS NOT NULL OR NEW.terminal_atd IS NOT NULL OR NEW.terminal_rtw IS NOT NULL) THEN
    RAISE EXCEPTION 'TBC não é terminal: ATB, ATD e Restow só na atracação de um terminal. Escolha o terminal antes de informar as datas.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_tbc_sem_datas_realizadas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tbc_sem_datas_realizadas ON public.voyage_escala_terminal_state;
CREATE TRIGGER trg_tbc_sem_datas_realizadas
  BEFORE INSERT OR UPDATE OF terminal_id, terminal_atb, terminal_atd, terminal_rtw
  ON public.voyage_escala_terminal_state
  FOR EACH ROW EXECUTE FUNCTION public.guard_tbc_sem_datas_realizadas();

-- 3. A gravação v1 segue a regra do ATA e tira a TBC ---------------------------

-- ATA da escala: o do payload, quando vem; senão o último gravado no
-- Histórico da escala (mesma leitura da v2 na 477).
CREATE OR REPLACE FUNCTION public._escala_ata_registrada(p_voyage_id bigint, p_port text, p_export_expectation jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := upper(btrim(COALESCE(p_port, '')));
  v_ata text;
BEGIN
  IF jsonb_typeof(p_export_expectation) = 'object'
     AND jsonb_typeof(p_export_expectation->'schedule') = 'object'
     AND p_export_expectation->'schedule' ? 'ata' THEN
    v_ata := NULLIF(btrim(COALESCE(p_export_expectation->'schedule'->>'ata', '')), '');
  ELSE
    SELECT NULLIF(btrim(COALESCE(al.new_value, '')), '') INTO v_ata
    FROM public.audit_logs AS al
    WHERE al.entity_type = 'voyage_pod_schedule'
      AND al.entity_id = p_voyage_id::text || '::' || v_port
      AND al.field_name = 'ata'
    ORDER BY al.changed_at DESC, al.id DESC
    LIMIT 1;
  END IF;
  RETURN v_ata IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._escala_ata_registrada(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.save_voyage_escala_terminal_state(bigint, text, integer, jsonb, jsonb, jsonb, text)
  RENAME TO save_voyage_escala_terminal_state_legacy_482;
REVOKE ALL ON FUNCTION public.save_voyage_escala_terminal_state_legacy_482(bigint, text, integer, jsonb, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.save_voyage_escala_terminal_state(p_voyage_id bigint, p_port text, p_expected_revision integer, p_fronts jsonb, p_terminals jsonb, p_export_expectation jsonb, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := upper(btrim(COALESCE(p_port, '')));
  v_result jsonb;
BEGIN
  -- O corpo anterior confere o usuário antes de ler o payload; a regra do
  -- ATA só lê o payload depois de um usuário ativo existir.
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario ativo sem permissao para editar a escala.' USING ERRCODE = '42501';
  END IF;

  -- 482 (ADR 0109): com o ATA da escala registrado, toda frente precisa de
  -- terminal; TBC não é terminal.
  IF jsonb_typeof(p_fronts) = 'array'
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_fronts) AS f(item)
       WHERE NULLIF(btrim(COALESCE(f.item->>'terminal_id', '')), '') IS NULL
     )
     AND public._escala_ata_registrada(p_voyage_id, p_port, p_export_expectation) THEN
    RAISE EXCEPTION 'Com o ATA registrado, toda frente de operação precisa de terminal: TBC não é terminal. Escolha o terminal de cada frente.'
      USING ERRCODE = '22023';
  END IF;

  v_result := public.save_voyage_escala_terminal_state_legacy_482(
    p_voyage_id, p_port, p_expected_revision, p_fronts, p_terminals, p_export_expectation, p_justification
  );
  IF COALESCE((v_result->>'blocked')::boolean, false) THEN
    RETURN v_result;
  END IF;

  -- A Atracação TBC só existe enquanto alguma frente está em TBC.
  IF NOT EXISTS (
    SELECT 1 FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port AND f.terminal_id IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id IS NULL
  ) THEN
    DELETE FROM public.voyage_escala_terminal_state
    WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id IS NULL;
    IF jsonb_typeof(v_result->'terminals') = 'array' THEN
      v_result := jsonb_set(v_result, '{terminals}', COALESCE((
        SELECT jsonb_agg(item) FROM jsonb_array_elements(v_result->'terminals') AS t(item)
        WHERE NULLIF(t.item->>'terminal_id', '') IS NOT NULL
      ), '[]'::jsonb), true);
    END IF;
    PERFORM public.refresh_voyage_status_from_terminal_scales(p_voyage_id);
  END IF;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_voyage_escala_terminal_state(bigint, text, integer, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_voyage_escala_terminal_state(bigint, text, integer, jsonb, jsonb, jsonb, text) TO authenticated;
