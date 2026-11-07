-- 627: a trava de veículos vale também na Viagem concluída, e a recusa do CE
-- avisa Equipamentos na hora (decisão 11 do dono de 2026-11-07; ADR 0134,
-- lote F do plano 2026-11-07-brechas-restantes-da-revisao-dos-alertas;
-- estende a ADR 0128).
--
-- O CE de container nasce travado e só destrava com "não terá veículos" ou com
-- a planilha de Veículos. Até aqui (597):
--   - a Viagem concluída ficava fora da trava, e o CE tardio entrava sem a
--     resposta de Equipamentos;
--   - a Documentação podia ser recusada antes do D-7 (Viagem sem ETA, porto
--     fora da lista) sem Equipamentos ter recebido aviso nenhum (brecha B18).
-- Mudança:
--   1. `voyage_ce_mercante_vehicle_lock`: a parte dos veículos vale na Viagem
--      ativa e na concluída; só a cancelada fica fora. A trava do Baplie (619)
--      continua só na ativa.
--   2. A prévia do CE (`_analyze_ce_mercante_rows`) devolve
--      `vehicle_answer_voyages`: as Viagens recusadas por falta de resposta.
--      A tela chama `request_voyage_vehicle_answer` para cada uma (a prévia
--      roda em transação só de leitura e não grava alerta).
--   3. `request_voyage_vehicle_answer(viagem)`: usuário interno ativo; com a
--      trava 'sem_resposta', abre na hora a **Declaração de veículos
--      pendente** (Normal, Equipamentos), com o marco `ce_recusado`, mesmo
--      antes do D-7.
--   4. `reconcile_voyage_vehicle_sheet_alerts` mantém aberta a Declaração com
--      esse marco enquanto não há resposta nem veículo (antes, a conferência
--      fora do D-7 a fechava); em D-5 ela dá lugar à Planilha ausente, como
--      sempre.
--
-- Plano de preservação: a migration só redefine funções e acrescenta uma
-- RPC; não reescreve nem apaga linha existente. Efeito no dia: na Viagem
-- concluída sem resposta de veículos, o primeiro CE de container passa a ser
-- recusado (decisão do dono). Conferir: `SELECT
-- voyage_ce_mercante_vehicle_lock(id) FROM voyages WHERE status =
-- 'completed' LIMIT 20`. Desfazer: o rollback abaixo.
--
-- Rollback: reaplicar `voyage_ce_mercante_vehicle_lock` pela 619,
-- `_analyze_ce_mercante_rows` e `reconcile_voyage_vehicle_sheet_alerts` pelo
-- corpo anterior (patches desta migration), e dropar
-- `request_voyage_vehicle_answer`.

BEGIN;

-- 1 --- Trava ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voyage_ce_mercante_vehicle_lock(p_voyage_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- 597: veículos; 619: Baplie importado ou a declaração "Viagem sem Baplie".
  -- 627: os veículos valem também na Viagem concluída; o Baplie, só na ativa.
  -- ponytail: uma trava por vez (veículos primeiro); a segunda aparece depois
  -- que a primeira sai.
  SELECT CASE
    WHEN v.id IS NULL OR v.status NOT IN ('active', 'completed') THEN NULL
    WHEN NOT EXISTS (SELECT 1 FROM public.vehicles x WHERE x.voyage_id = v.id) AND d.voyage_id IS NULL THEN 'sem_resposta'
    WHEN NOT EXISTS (SELECT 1 FROM public.vehicles x WHERE x.voyage_id = v.id) AND d.has_vehicles THEN 'aguardando_planilha'
    WHEN v.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM public.baplie_containers c WHERE c.voyage_id = v.id)
         AND NOT EXISTS (SELECT 1 FROM public.voyage_baplie_declarations bd WHERE bd.voyage_id = v.id) THEN 'sem_baplie'
    ELSE NULL
  END
  FROM (SELECT p_voyage_id AS id) AS one
  LEFT JOIN public.voyages v ON v.id = one.id
  LEFT JOIN public.voyage_vehicle_declarations d ON d.voyage_id = one.id;
$function$;

-- 2 --- Prévia: Viagens que esperam a resposta de Equipamentos ----------------
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public._analyze_ce_mercante_rows(jsonb,text,bigint)'::regprocedure);
  v_patch record;
BEGIN
  IF position('v_vehicle_wait bigint[]' in v_def) > 0 THEN RETURN; END IF;  -- já aplicado
  FOR v_patch IN
    SELECT * FROM (VALUES
      ($old$  v_divergence text;
BEGIN$old$,
       $new$  v_divergence text;
  v_vehicle_wait bigint[] := ARRAY[]::bigint[];
BEGIN$new$),
      ($old$    IF v_lock.lock IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        public._ce_mercante_vehicle_lock_message(v_lock.voyage_id, v_lock.lock)));$old$,
       $new$    IF v_lock.lock IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        public._ce_mercante_vehicle_lock_message(v_lock.voyage_id, v_lock.lock)));
      -- 627: a tela pede a resposta a Equipamentos (request_voyage_vehicle_answer).
      IF v_lock.lock = 'sem_resposta' THEN v_vehicle_wait := v_vehicle_wait || v_lock.voyage_id; END IF;$new$),
      ($old$    'baplie_divergence', v_divergence,$old$,
       $new$    'baplie_divergence', v_divergence,
    'vehicle_answer_voyages', to_jsonb(v_vehicle_wait),$new$)
    ) AS p(old_text, new_text)
  LOOP
    IF (length(v_def) - length(replace(v_def, v_patch.old_text, ''))) / length(v_patch.old_text) <> 1 THEN
      RAISE EXCEPTION '627: trecho não encontrado uma única vez em _analyze_ce_mercante_rows: %', left(v_patch.old_text, 40);
    END IF;
    v_def := replace(v_def, v_patch.old_text, v_patch.new_text);
  END LOOP;
  EXECUTE v_def;
END;
$patch$;

-- 3 --- Pedido de resposta na recusa -----------------------------------------
CREATE OR REPLACE FUNCTION public.request_voyage_vehicle_answer(p_voyage_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo pede a resposta de veículos.' USING ERRCODE = '42501';
  END IF;
  IF public.voyage_ce_mercante_vehicle_lock(p_voyage_id) IS DISTINCT FROM 'sem_resposta' THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type IN ('voyage_vehicle_declaration_pending', 'voyage_vehicle_sheet_pending') AND i.status = 'active'
      AND a.entity_type = 'voyage' AND a.entity_id = p_voyage_id::text) THEN
    RETURN false;  -- Equipamentos já está avisado.
  END IF;
  PERFORM public.upsert_alert_item(
    'voyage_vehicle_declaration_pending', 'voyage', p_voyage_id::text,
    format('A Documentação tentou vincular o CE Mercante na viagem %s e foi recusada: declare se a viagem terá veículos ou importe a planilha de Veículos. Sem a resposta, o CE dos B/Ls de container fica travado.',
      public._voyage_label(p_voyage_id)),
    'ce_lock_refusal',
    jsonb_build_object('voyage_id', p_voyage_id, 'reason_code', 'ce_recusado', 'milestone', 'ce_recusado'),
    '/veiculos?voyage=' || p_voyage_id);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.request_voyage_vehicle_answer(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_voyage_vehicle_answer(bigint) TO authenticated, service_role;

-- 4 --- A conferência mantém a Declaração aberta pela recusa ------------------
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.reconcile_voyage_vehicle_sheet_alerts(bigint,text)'::regprocedure);
  v_old text := $old$  ELSE
    PERFORM public.resolve_alert_item('voyage_vehicle_declaration_pending', 'voyage', p_voyage_id::text, p_source,
      CASE WHEN v_sheet_due THEN jsonb_build_object('reason', 'd5_sem_resposta') ELSE '{}'::jsonb END);$old$;
  v_new text := $new$  ELSIF NOT v_sheet_due AND NOT v_answered AND NOT v_has_vehicle AND v_decl_open
        AND public.voyage_ce_mercante_vehicle_lock(p_voyage_id) = 'sem_resposta'
        AND EXISTS (
          SELECT 1 FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
          WHERE i.item_type = 'voyage_vehicle_declaration_pending' AND i.status = 'active'
            AND a.entity_type = 'voyage' AND a.entity_id = p_voyage_id::text
            AND i.metadata->>'reason_code' = 'ce_recusado') THEN
    -- 627: aberta pela recusa do CE antes do D-7: fica até a resposta.
    NULL;
  ELSE
    PERFORM public.resolve_alert_item('voyage_vehicle_declaration_pending', 'voyage', p_voyage_id::text, p_source,
      CASE WHEN v_sheet_due THEN jsonb_build_object('reason', 'd5_sem_resposta') ELSE '{}'::jsonb END);$new$;
BEGIN
  IF position('aberta pela recusa do CE' in v_def) > 0 THEN RETURN; END IF;  -- já aplicado
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION '627: trecho não encontrado uma única vez em reconcile_voyage_vehicle_sheet_alerts';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;

COMMIT;
