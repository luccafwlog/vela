-- 619: CE Mercante travado sem o Baplie (decisão D4 do dono de 2026-11-06; ADR
-- 0133, lote 7 do plano 2026-11-06-decisoes-da-revisao-dos-alertas). Estende a
-- trava dos veículos da 597 (ADR 0128).
--
-- Problema (brechas B16 e B17): sem o Baplie, o CE entra e a fatura sai sem as
-- marcas OOG e SOC/COC; quando o Baplie chega, a fatura é refeita ou vira
-- Fatura Avulsa. E a prévia do CE não mostra a divergência aberta entre o
-- Baplie e os B/Ls da viagem.
--
-- Mudança:
--   1. Declaração "Viagem sem Baplie" (`voyage_baplie_declarations`), com
--      motivo obrigatório, por `declare_voyage_without_baplie`; desfazer pede
--      motivo (`undo_voyage_baplie_declaration`). Documentação ou
--      Administrativo. Viagem com Baplie importado não se declara. O
--      Histórico da viagem guarda `sem_baplie` com autor e motivo. A
--      declaração também fecha o alerta "Baplie ausente".
--   2. A trava do CE (`voyage_ce_mercante_vehicle_lock`, mesma função, para a
--      prévia e o gatilho `guard_bl_ce_mercante_vehicle_answer` seguirem
--      valendo) devolve 'sem_baplie' na viagem ativa sem linha em
--      `baplie_containers` e sem a declaração. Os veículos vêm primeiro: a
--      mensagem é uma por vez.
--   3. A prévia do CE (`_analyze_ce_mercante_rows`) mostra como aviso a
--      divergência aberta entre o Baplie e os B/Ls da viagem (o alerta
--      "Cobertura Baplie / B/L" ativo) e pede confirmação com motivo
--      (`needs_confirmation`, o mesmo das trocas de CE; campo novo
--      `baplie_divergence` com o texto).
--
-- Plano de preservação: a migration não reescreve nem apaga linha existente:
-- cria uma tabela vazia, redefine funções e acrescenta RPCs. UPDATE e DELETE
-- só rodam dentro das RPCs, por ação do usuário, com o valor anterior em
-- `audit_logs`. CE já vinculado não muda. Conferir: `SELECT count(*) FROM
-- voyage_baplie_declarations` = 0 logo depois. Efeito no dia: viagem ativa
-- sem Baplie fica travada para vincular CE de container até importar o Baplie
-- ou declarar "Viagem sem Baplie". Desfazer: o rollback abaixo.
--
-- Rollback: reaplicar `voyage_ce_mercante_vehicle_lock`,
-- `_ce_mercante_vehicle_lock_message` e `_analyze_ce_mercante_rows` pela 597,
-- `reconcile_voyage_baplie_missing_alerts` pelo corpo anterior; dropar
-- `declare_voyage_without_baplie`, `undo_voyage_baplie_declaration`,
-- `voyage_baplie_declaration` e a tabela `voyage_baplie_declarations`;
-- tirar a linha 21 de `voyage_delete_children_spec`.

BEGIN;

-- 1 --- Declaração "Viagem sem Baplie" --------------------------------------
CREATE TABLE IF NOT EXISTS public.voyage_baplie_declarations (
  voyage_id bigint PRIMARY KEY REFERENCES public.voyages(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  declared_by uuid,
  declared_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.voyage_baplie_declarations IS
  'Declaração "Viagem sem Baplie" (619, ADR 0133 D4): libera o CE Mercante de container sem Baplie importado.';
ALTER TABLE public.voyage_baplie_declarations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voyage_baplie_declarations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.voyage_baplie_declarations TO authenticated;
GRANT ALL ON public.voyage_baplie_declarations TO service_role;
DROP POLICY IF EXISTS voyage_baplie_declarations_read ON public.voyage_baplie_declarations;
CREATE POLICY voyage_baplie_declarations_read ON public.voyage_baplie_declarations
  FOR SELECT TO authenticated USING ((SELECT public.is_active_user()));
-- Mesma trava de TRUNCATE das demais tabelas de public (585).
DROP TRIGGER IF EXISTS truncate_requires_confirmation ON public.voyage_baplie_declarations;
CREATE TRIGGER truncate_requires_confirmation BEFORE TRUNCATE ON public.voyage_baplie_declarations
  FOR EACH STATEMENT EXECUTE FUNCTION public.truncate_requires_disposable_confirmation();

CREATE OR REPLACE FUNCTION public.voyage_baplie_declaration(p_voyage_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'voyage_id', p_voyage_id,
    'has_baplie', EXISTS (SELECT 1 FROM public.baplie_containers c WHERE c.voyage_id = p_voyage_id),
    'declared', d.voyage_id IS NOT NULL,
    'reason', d.reason,
    'declared_at', d.declared_at,
    'declared_by_name', (SELECT up.full_name FROM public.user_profiles up WHERE up.id = d.declared_by))
  FROM (SELECT p_voyage_id AS id) one
  LEFT JOIN public.voyage_baplie_declarations d ON d.voyage_id = one.id
  WHERE public.is_active_user();
$function$;
REVOKE ALL ON FUNCTION public.voyage_baplie_declaration(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voyage_baplie_declaration(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._assert_baplie_declarer()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Predicado padrão de usuário ativo primeiro: a checagem estática de guardas
  -- (scripts/security/verificar_guardas.py) reconhece a guarda antes da trava.
  IF NOT public.is_active_user() OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.active AND up.role IN ('documentacao', 'operator', 'administrativo')
  ) THEN
    RAISE EXCEPTION 'Somente a Documentação ou o Administrativo declara a viagem sem Baplie.' USING ERRCODE = '42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._assert_baplie_declarer() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declare_voyage_without_baplie(p_voyage_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_status text;
BEGIN
  PERFORM public._assert_baplie_declarer();
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da viagem sem Baplie.' USING ERRCODE = '22023';
  END IF;
  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Viagem % não encontrada.', p_voyage_id USING ERRCODE = 'P0002'; END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Viagem cancelada não recebe a declaração de Baplie.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.baplie_containers c WHERE c.voyage_id = p_voyage_id) THEN
    RAISE EXCEPTION 'A viagem já tem Baplie importado: ela não pode ser declarada sem Baplie.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.voyage_baplie_declarations d WHERE d.voyage_id = p_voyage_id) THEN
    RETURN public.voyage_baplie_declaration(p_voyage_id);
  END IF;

  INSERT INTO public.voyage_baplie_declarations (voyage_id, reason, declared_by) VALUES (p_voyage_id, v_reason, auth.uid());
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage', p_voyage_id::text, 'sem_baplie', NULL, 'declarada', auth.uid(), v_reason);
  PERFORM public.reconcile_voyage_baplie_missing_alerts(p_voyage_id, 'baplie_declaration');
  RETURN public.voyage_baplie_declaration(p_voyage_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.declare_voyage_without_baplie(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declare_voyage_without_baplie(bigint, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.undo_voyage_baplie_declaration(p_voyage_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old public.voyage_baplie_declarations;
BEGIN
  PERFORM public._assert_baplie_declarer();
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo para desfazer a declaração.' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.voyage_baplie_declarations WHERE voyage_id = p_voyage_id RETURNING * INTO v_old;
  IF FOUND THEN
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', p_voyage_id::text, 'sem_baplie', v_old.reason, 'desfeita', auth.uid(), v_reason);
    PERFORM public.reconcile_voyage_baplie_missing_alerts(p_voyage_id, 'baplie_declaration');
  END IF;
  RETURN public.voyage_baplie_declaration(p_voyage_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.undo_voyage_baplie_declaration(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_voyage_baplie_declaration(bigint, text) TO authenticated, service_role;

-- Excluir a viagem leva a declaração junto, listada na prévia da exclusão.
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.voyage_delete_children_spec()'::regprocedure);
  v_old text := $old$    (20, 'mercante_edi_files', 'voyage_id', 'delete', 'registro(s) de EDI Mercante gerado');$old$;
  v_new text := $new$    (20, 'mercante_edi_files', 'voyage_id', 'delete', 'registro(s) de EDI Mercante gerado'),
    (21, 'voyage_baplie_declarations', 'voyage_id', 'delete', 'declaração de viagem sem Baplie');$new$;
BEGIN
  IF position(v_new in v_def) > 0 THEN RETURN; END IF;  -- já aplicado
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION '619: trecho não encontrado uma única vez em voyage_delete_children_spec';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;

-- 2 --- Trava do CE ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voyage_ce_mercante_vehicle_lock(p_voyage_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- 597: veículos; 619: Baplie importado ou a declaração "Viagem sem Baplie".
  -- ponytail: uma trava por vez (veículos primeiro); a segunda aparece depois
  -- que a primeira sai.
  SELECT CASE
    WHEN v.id IS NULL OR v.status <> 'active' THEN NULL
    WHEN NOT EXISTS (SELECT 1 FROM public.vehicles x WHERE x.voyage_id = v.id) AND d.voyage_id IS NULL THEN 'sem_resposta'
    WHEN NOT EXISTS (SELECT 1 FROM public.vehicles x WHERE x.voyage_id = v.id) AND d.has_vehicles THEN 'aguardando_planilha'
    WHEN NOT EXISTS (SELECT 1 FROM public.baplie_containers c WHERE c.voyage_id = v.id)
         AND NOT EXISTS (SELECT 1 FROM public.voyage_baplie_declarations bd WHERE bd.voyage_id = v.id) THEN 'sem_baplie'
    ELSE NULL
  END
  FROM (SELECT p_voyage_id AS id) AS one
  LEFT JOIN public.voyages v ON v.id = one.id
  LEFT JOIN public.voyage_vehicle_declarations d ON d.voyage_id = one.id;
$function$;

CREATE OR REPLACE FUNCTION public._ce_mercante_vehicle_lock_message(p_voyage_id bigint, p_lock text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_lock
    WHEN 'sem_resposta' THEN format(
      'CE Mercante travado na viagem %s: Equipamentos ainda não respondeu se a viagem terá veículos. O CE de B/L de container só é vinculado depois da resposta na tela Veículos.',
      public._voyage_label(p_voyage_id))
    WHEN 'aguardando_planilha' THEN format(
      'CE Mercante travado na viagem %s: Equipamentos declarou que a viagem terá veículos e a planilha de Veículos ainda não foi importada. O CE de B/L de container só é vinculado depois da importação.',
      public._voyage_label(p_voyage_id))
    WHEN 'sem_baplie' THEN format(
      'CE Mercante travado na viagem %s: o Baplie ainda não foi importado. O CE de B/L de container só é vinculado depois do Baplie, ou da declaração "Viagem sem Baplie" com motivo, na tela Baplie.',
      public._voyage_label(p_voyage_id))
  END;
$function$;

-- 3 --- "Baplie ausente" fecha com a declaração -----------------------------
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.reconcile_voyage_baplie_missing_alerts(bigint,text)'::regprocedure);
  v_old text := $old$    SELECT 1 FROM public.baplie_containers WHERE voyage_id = p_voyage_id
  ) INTO v_has_baplie;$old$;
  v_new text := $new$    SELECT 1 FROM public.baplie_containers WHERE voyage_id = p_voyage_id
  ) OR EXISTS (
    -- 619: a declaração "Viagem sem Baplie" fecha o alerta.
    SELECT 1 FROM public.voyage_baplie_declarations WHERE voyage_id = p_voyage_id
  ) INTO v_has_baplie;$new$;
BEGIN
  IF position(v_new in v_def) > 0 THEN RETURN; END IF;  -- já aplicado
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION '619: trecho não encontrado uma única vez em reconcile_voyage_baplie_missing_alerts';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;

-- 4 --- Prévia do CE: divergência Baplie × B/L pede confirmação --------------
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public._analyze_ce_mercante_rows(jsonb,text,bigint)'::regprocedure);
  v_patch record;
BEGIN
  IF position('v_divergence text;' in v_def) > 0 THEN RETURN; END IF;  -- já aplicado
  FOR v_patch IN
    SELECT * FROM (VALUES
      ($old$  v_lock record;
BEGIN$old$,
       $new$  v_lock record;
  v_divergence text;
BEGIN$new$),
      ($old$  RETURN jsonb_build_object(
    'errors', v_errors,$old$,
       $new$  -- 619 (ADR 0133, D4): a divergência aberta entre o Baplie e os B/Ls
  -- da viagem (alerta "Cobertura Baplie / B/L") aparece na prévia e pede
  -- confirmação com motivo antes de vincular CE novo.
  -- ponytail: lê o alerta ativo, que os gatilhos do Baplie e dos containers
  -- mantêm; não recalcula a cobertura aqui.
  SELECT string_agg(i.message, ' ' ORDER BY a.entity_id) INTO v_divergence
  FROM public.alert_items i
  JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.item_type = 'voyage_baplie_documentary_coverage' AND i.status = 'active'
    AND a.entity_id IN (
      SELECT DISTINCT b.voyage_id::text
      FROM jsonb_array_elements(v_rows) AS r
      JOIN public.bls AS b ON b.id = r.value->>'bl_id'
      WHERE r.value->>'status' = 'new' AND b.voyage_id IS NOT NULL);
  IF v_divergence IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('message',
      'Divergência entre o Baplie e os B/Ls da viagem: ' || v_divergence
        || ' Confira em Baplie antes de vincular; para seguir, confirme e informe o motivo.'));
  END IF;

  RETURN jsonb_build_object(
    'errors', v_errors,$new$),
      ($old$    'needs_confirmation', (v_changes + v_moves) > 0$old$,
       $new$    'baplie_divergence', v_divergence,
    'needs_confirmation', (v_changes + v_moves) > 0 OR v_divergence IS NOT NULL$new$)
    ) AS p(old_text, new_text)
  LOOP
    IF (length(v_def) - length(replace(v_def, v_patch.old_text, ''))) / length(v_patch.old_text) <> 1 THEN
      RAISE EXCEPTION '619: trecho não encontrado uma única vez em _analyze_ce_mercante_rows: %', left(v_patch.old_text, 40);
    END IF;
    v_def := replace(v_def, v_patch.old_text, v_patch.new_text);
  END LOOP;
  EXECUTE v_def;
END;
$patch$;

COMMIT;
