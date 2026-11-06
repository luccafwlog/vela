-- 596: CE Mercante travado até Equipamentos responder se a viagem terá
-- veículos (decisão do dono de 2026-11-05/06, com Documentação e Equipamentos;
-- ADR 0127).
--
-- Problema:
--   A 468 abriu em D-5 o alerta "Planilha de Veículos pendente", com a
--   declaração "Esta viagem não terá veículos". O alerta não basta: a
--   Documentação vincula o CE Mercante antes de Equipamentos importar a
--   planilha de Veículos, a fatura sai pelo CE e o B/L de veículo LCL, que
--   seria isento de Taxas Locais, é cobrado cheio.
--
-- Mudança:
--   1. A declaração ganha o lado "terá veículos": `voyage_vehicle_declarations`
--      recebe `has_vehicles` (falso nas linhas existentes, que são todas
--      "sem veículos"). `declare_voyage_with_vehicles` grava "terá";
--      `declare_voyage_without_vehicles` ganha `p_reason`. Trocar uma resposta
--      dada pela outra exige motivo; desfazer continua exigindo motivo. O
--      Histórico usa `sem_veiculos` (como na 468) e `com_veiculos`.
--   2. Alerta novo `voyage_vehicle_declaration_pending` ("Declaração de
--      veículos pendente", Normal, Equipamentos): abre em D-7 do primeiro ETA
--      brasileiro na viagem com B/L ativo de container ou misto num POD
--      elegível, sem veículo e sem resposta. Em D-5 sem resposta ele fecha e
--      quem cobra é o crítico `voyage_vehicle_sheet_pending`, que agora se
--      chama "Planilha de Veículos ausente": abre em D-5 sem veículo quando a
--      viagem não respondeu ou respondeu "terá veículos". "Não terá veículos"
--      ou um veículo importado fecham os dois. Mesma função de reconciliação
--      (`reconcile_voyage_vehicle_sheet_alerts`), já chamada pelo detector de
--      15 minutos, pelos gatilhos da escala, dos B/Ls e dos veículos.
--   3. Trava do CE Mercante (`voyage_ce_mercante_vehicle_lock`): na viagem
--      ativa, B/L de container ou misto não recebe o primeiro CE Mercante
--      enquanto a viagem não tiver veículo importado nem a resposta "não terá
--      veículos". Basta um veículo na viagem: o sistema não sabe quantos são.
--      Carga solta não trava; viagem concluída ou cancelada não trava; corrigir
--      ou remover um CE já vinculado não trava. A prévia da planilha de CE
--      Mercante (`_analyze_ce_mercante_rows`, corpo da 592) mostra a recusa, e o
--      gatilho `guard_bl_ce_mercante_vehicle_answer` em `bls` recusa qualquer
--      outro caminho.
--   4. O gatilho de `vehicles` (468) desfaz só a resposta "não terá veículos";
--      "terá veículos" continua valendo com o veículo que chega.
--   5. `reconcile_inactive_voyage_alerts` (corpo da 584) reavalia também o
--      alerta novo na viagem concluída.
--   6. Excluir viagem leva a resposta de veículos junto
--      (`voyage_delete_children_spec`, corpo da 394, item 19). Desde a 468, a
--      viagem declarada "sem veículos" não se excluía: o guarda da exclusão
--      achava a linha em `voyage_vehicle_declarations` e recusava.
--
-- Plano de preservação: esta migration não reescreve nem apaga linha
-- existente. A coluna `has_vehicles` nasce com o valor falso, que é o
-- significado de toda declaração gravada até aqui ("Esta viagem não terá
-- veículos", 468). Os comandos UPDATE e DELETE abaixo ficam dentro das RPCs
-- (trocar ou desfazer a resposta) e do gatilho de `vehicles`, só rodam por
-- ação do usuário e gravam o valor anterior em `audit_logs` (`sem_veiculos` ou
-- `com_veiculos`, com autor e motivo). Conferir: `SELECT count(*) FROM
-- voyage_vehicle_declarations WHERE has_vehicles` é zero logo depois da
-- migration. Desfazer: o rollback abaixo; as declarações "terá veículos"
-- gravadas depois ficam no Histórico e saem com a coluna.
--
-- Efeito no dia: toda viagem ativa com B/L de container sem CE e sem veículo
-- nem declaração fica travada para vincular CE até Equipamentos responder (o
-- dono aceitou; a resposta é um clique na tela Veículos).
--
-- Rollback: `DROP TRIGGER guard_bl_ce_mercante_vehicle_answer ON bls`; dropar
-- `guard_bl_ce_mercante_vehicle_answer`, `voyage_ce_mercante_vehicle_lock`,
-- `_ce_mercante_vehicle_lock_message`, `declare_voyage_with_vehicles` e
-- `declare_voyage_without_vehicles(bigint, text)`; reaplicar pela 468
-- `declare_voyage_without_vehicles(bigint)`, `voyage_vehicle_declaration`,
-- `undo_voyage_vehicle_declaration`, `reconcile_voyage_vehicle_sheet_alerts` e
-- `reconcile_vehicle_sheet_alerts_from_vehicles`; `_analyze_ce_mercante_rows`
-- pela 592, `reconcile_inactive_voyage_alerts` pela 584 e
-- `voyage_delete_children_spec` pela 394; apagar as linhas com
-- `has_vehicles` e dropar a coluna; `UPDATE alert_type_catalog SET active =
-- false WHERE type = 'voyage_vehicle_declaration_pending'`.

-- 1 -------------------------------------------------------------------------
ALTER TABLE public.voyage_vehicle_declarations
  ADD COLUMN has_vehicles boolean NOT NULL DEFAULT false;

COMMENT ON TABLE public.voyage_vehicle_declarations IS
  'Resposta de Equipamentos sobre veículos na viagem (468, 596): has_vehicles falso = "não terá veículos", verdadeiro = "terá veículos".';
COMMENT ON COLUMN public.voyage_vehicle_declarations.has_vehicles IS
  'Verdadeiro: a viagem terá veículos e o CE Mercante de container fica travado até o primeiro veículo importado (596).';

-- 2 -------------------------------------------------------------------------
INSERT INTO public.alert_type_catalog (type, severity, responsible_department, audience_departments, default_destination)
VALUES ('voyage_vehicle_declaration_pending', 'normal', 'equipamentos', ARRAY['equipamentos'], '/veiculos')
ON CONFLICT (type) DO NOTHING;

-- 3 -------------------------------------------------------------------------
-- NULL quando o CE Mercante de container está liberado; 'sem_resposta' ou
-- 'aguardando_planilha' quando travado.
CREATE OR REPLACE FUNCTION public.voyage_ce_mercante_vehicle_lock(p_voyage_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN v.id IS NULL OR v.status <> 'active' THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.vehicles x WHERE x.voyage_id = v.id) THEN NULL
    WHEN d.voyage_id IS NULL THEN 'sem_resposta'
    WHEN d.has_vehicles THEN 'aguardando_planilha'
    ELSE NULL
  END
  FROM (SELECT p_voyage_id AS id) AS one
  LEFT JOIN public.voyages v ON v.id = one.id
  LEFT JOIN public.voyage_vehicle_declarations d ON d.voyage_id = one.id;
$function$;

REVOKE ALL ON FUNCTION public.voyage_ce_mercante_vehicle_lock(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voyage_ce_mercante_vehicle_lock(bigint) TO service_role;

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
  END;
$function$;

REVOKE ALL ON FUNCTION public._ce_mercante_vehicle_lock_message(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ce_mercante_vehicle_lock_message(bigint, text) TO service_role;

-- Porta do banco: qualquer caminho que vincule o primeiro CE a B/L de
-- container passa por aqui. Manutenção (superusuário sem usuário na sessão)
-- passa, como no `guard_bl_ce_mercante_port` (195).
CREATE OR REPLACE FUNCTION public.guard_bl_ce_mercante_vehicle_answer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lock text;
BEGIN
  IF NULLIF(btrim(COALESCE(OLD.ce_mercante, '')), '') IS NULL
     AND NULLIF(btrim(COALESCE(NEW.ce_mercante, '')), '') IS NOT NULL
     AND NEW.cancelled_at IS NULL
     AND NEW.cargo_mode IN ('container', 'misto')
     AND NEW.voyage_id IS NOT NULL
     AND (auth.uid() IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = session_user AND rolsuper)) THEN
    v_lock := public.voyage_ce_mercante_vehicle_lock(NEW.voyage_id);
    IF v_lock IS NOT NULL THEN
      RAISE EXCEPTION '%', public._ce_mercante_vehicle_lock_message(NEW.voyage_id, v_lock) USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_bl_ce_mercante_vehicle_answer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_bl_ce_mercante_vehicle_answer ON public.bls;
CREATE TRIGGER guard_bl_ce_mercante_vehicle_answer
  BEFORE UPDATE OF ce_mercante ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_bl_ce_mercante_vehicle_answer();

-- 2 (reconciliação) ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_voyage_vehicle_sheet_alerts(p_voyage_id bigint, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_status text;
  v_first_eta date;
  v_container_bls integer := 0;
  v_has_vehicle boolean;
  v_answer boolean;  -- NULL sem resposta; true "terá"; false "não terá"
  v_answered boolean;
  v_decl_open boolean;
  v_sheet_open boolean;
  v_decl_due boolean := false;
  v_sheet_due boolean := false;
BEGIN
  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id;
  IF NOT FOUND OR v_status = 'cancelled' THEN
    PERFORM public.resolve_alert_item('voyage_vehicle_declaration_pending', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    PERFORM public.resolve_alert_item('voyage_vehicle_sheet_pending', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  SELECT
    bool_or(i.item_type = 'voyage_vehicle_declaration_pending'),
    bool_or(i.item_type = 'voyage_vehicle_sheet_pending')
  INTO v_decl_open, v_sheet_open
  FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
  WHERE i.item_type IN ('voyage_vehicle_declaration_pending', 'voyage_vehicle_sheet_pending')
    AND i.status = 'active' AND a.entity_type = 'voyage' AND a.entity_id = p_voyage_id::text;
  v_decl_open := COALESCE(v_decl_open, false);
  v_sheet_open := COALESCE(v_sheet_open, false);

  -- Viagem concluída não ganha tipo novo (346): só o aberto é reavaliado.
  IF v_status <> 'active' AND NOT v_decl_open AND NOT v_sheet_open THEN
    RETURN;
  END IF;

  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);

  -- A planilha de Veículos casa veículo com B/L e container: viagem só de carga
  -- solta não tem o que importar (468).
  SELECT count(*) INTO v_container_bls
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND b.cancelled_at IS NULL
    AND b.cargo_mode IN ('container', 'misto')
    AND COALESCE(public.normalize_port_code(b.pod), upper(btrim(b.pod))) IN (
      SELECT COALESCE(public.normalize_port_code(e.pod), e.pod) FROM public.get_voyage_eligible_pods(p_voyage_id) AS e);

  v_has_vehicle := EXISTS (SELECT 1 FROM public.vehicles v WHERE v.voyage_id = p_voyage_id);
  SELECT d.has_vehicles INTO v_answer FROM public.voyage_vehicle_declarations d WHERE d.voyage_id = p_voyage_id;
  v_answered := FOUND;

  IF v_first_eta IS NOT NULL AND v_container_bls > 0 AND NOT v_has_vehicle THEN
    -- D-7 até a véspera de D-5: falta a resposta.
    v_decl_due := NOT v_answered AND v_today >= (v_first_eta - 7) AND v_today < (v_first_eta - 5);
    -- D-5: sem resposta ou com "terá veículos", a planilha está ausente.
    v_sheet_due := v_today >= (v_first_eta - 5) AND (NOT v_answered OR v_answer);
  END IF;
  IF v_status <> 'active' THEN
    v_decl_due := v_decl_due AND v_decl_open;
    v_sheet_due := v_sheet_due AND v_sheet_open;
  END IF;

  IF v_decl_due THEN
    PERFORM public.upsert_alert_item(
      'voyage_vehicle_declaration_pending',
      'voyage',
      p_voyage_id::text,
      'Declare se a viagem terá veículos; ETA em ' || to_char(v_first_eta, 'DD/MM/YYYY')
        || '. Sem a resposta, o CE Mercante dos B/Ls de container fica travado e o alerta passa a crítico em D-5.',
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'container_bl_count', v_container_bls, 'first_eta', v_first_eta),
      '/veiculos?voyage=' || p_voyage_id
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_vehicle_declaration_pending', 'voyage', p_voyage_id::text, p_source,
      CASE WHEN v_sheet_due THEN jsonb_build_object('reason', 'd5_sem_resposta') ELSE '{}'::jsonb END);
  END IF;

  IF v_sheet_due THEN
    PERFORM public.upsert_alert_item(
      'voyage_vehicle_sheet_pending',
      'voyage',
      p_voyage_id::text,
      CASE WHEN v_answered
        THEN 'Planilha de Veículos ausente: a viagem foi declarada com veículos e nenhum veículo foi importado; ETA em '
          || to_char(v_first_eta, 'DD/MM/YYYY') || ', prazo D-5 atingido. O CE Mercante dos B/Ls de container está travado até a importação.'
        ELSE 'Declare se a viagem terá veículos ou importe a planilha de Veículos; ETA em '
          || to_char(v_first_eta, 'DD/MM/YYYY') || ', prazo D-5 atingido. O CE Mercante dos B/Ls de container está travado até a resposta.'
      END,
      p_source,
      jsonb_build_object('voyage_id', p_voyage_id, 'container_bl_count', v_container_bls, 'first_eta', v_first_eta,
        'declared_with_vehicles', v_answered),
      '/veiculos?voyage=' || p_voyage_id
    );
  ELSE
    PERFORM public.resolve_alert_item('voyage_vehicle_sheet_pending', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_voyage_vehicle_sheet_alerts(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_voyage_vehicle_sheet_alerts(bigint, text) TO service_role;

-- 1 (leitura e respostas) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.voyage_vehicle_declaration(p_voyage_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo consulta a declaração de veículos da viagem.' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'voyage_id', d.voyage_id,
    'has_vehicles', d.has_vehicles,
    'declared_at', d.declared_at,
    'declared_by', d.declared_by,
    'declared_by_name', NULLIF(btrim(p.full_name), ''))
  INTO v_result
  FROM public.voyage_vehicle_declarations d
  LEFT JOIN public.user_profiles p ON p.id = d.declared_by
  WHERE d.voyage_id = p_voyage_id;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.voyage_vehicle_declaration(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voyage_vehicle_declaration(bigint) TO authenticated, service_role;

-- Grava a resposta. Trocar uma resposta dada pela outra exige motivo; repetir a
-- mesma não repete o Histórico.
CREATE OR REPLACE FUNCTION public._declare_voyage_vehicle_presence(p_voyage_id bigint, p_has_vehicles boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_status text;
  v_vehicles integer;
  v_current boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo responde se a viagem terá veículos.' USING ERRCODE = '42501';
  END IF;

  -- Mesma trava do gatilho de `vehicles` (468): a importação em curso termina
  -- antes da contagem abaixo.
  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % não encontrada.', p_voyage_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Viagem cancelada não recebe a declaração de veículos.' USING ERRCODE = '22023';
  END IF;

  IF NOT p_has_vehicles THEN
    SELECT count(*) INTO v_vehicles FROM public.vehicles WHERE voyage_id = p_voyage_id;
    IF v_vehicles > 0 THEN
      RAISE EXCEPTION 'A viagem já tem % veículo(s) importado(s): ela não pode ser declarada sem veículos.', v_vehicles
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT has_vehicles INTO v_current FROM public.voyage_vehicle_declarations WHERE voyage_id = p_voyage_id;
  IF FOUND AND v_current = p_has_vehicles THEN
    RETURN public.voyage_vehicle_declaration(p_voyage_id);
  END IF;

  IF FOUND THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'A viagem já foi declarada %: para trocar a resposta, informe o motivo.',
        CASE WHEN v_current THEN 'com veículos' ELSE 'sem veículos' END USING ERRCODE = '22023';
    END IF;
    UPDATE public.voyage_vehicle_declarations
    SET has_vehicles = p_has_vehicles, declared_at = now(), declared_by = auth.uid()
    WHERE voyage_id = p_voyage_id;
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', p_voyage_id::text, CASE WHEN v_current THEN 'com_veiculos' ELSE 'sem_veiculos' END,
      'declarada', 'desfeita', auth.uid(), v_reason);
  ELSE
    INSERT INTO public.voyage_vehicle_declarations (voyage_id, declared_by, has_vehicles)
    VALUES (p_voyage_id, auth.uid(), p_has_vehicles);
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage', p_voyage_id::text, CASE WHEN p_has_vehicles THEN 'com_veiculos' ELSE 'sem_veiculos' END,
    NULL, 'declarada', auth.uid(), v_reason);

  PERFORM public.reconcile_voyage_vehicle_sheet_alerts(p_voyage_id, 'vehicle_declaration');
  RETURN public.voyage_vehicle_declaration(p_voyage_id);
END;
$function$;

REVOKE ALL ON FUNCTION public._declare_voyage_vehicle_presence(bigint, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._declare_voyage_vehicle_presence(bigint, boolean, text) TO service_role;

DROP FUNCTION IF EXISTS public.declare_voyage_without_vehicles(bigint);
CREATE FUNCTION public.declare_voyage_without_vehicles(p_voyage_id bigint, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public._declare_voyage_vehicle_presence(p_voyage_id, false, p_reason);
$function$;

REVOKE ALL ON FUNCTION public.declare_voyage_without_vehicles(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declare_voyage_without_vehicles(bigint, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declare_voyage_with_vehicles(p_voyage_id bigint, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public._declare_voyage_vehicle_presence(p_voyage_id, true, p_reason);
$function$;

REVOKE ALL ON FUNCTION public.declare_voyage_with_vehicles(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declare_voyage_with_vehicles(bigint, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.undo_voyage_vehicle_declaration(p_voyage_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_had boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo desfaz a declaração de veículos.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Desfazer a declaração exige motivo.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR NO KEY UPDATE;
  DELETE FROM public.voyage_vehicle_declarations WHERE voyage_id = p_voyage_id RETURNING has_vehicles INTO v_had;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A viagem % não tem declaração de veículos.', p_voyage_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage', p_voyage_id::text, CASE WHEN v_had THEN 'com_veiculos' ELSE 'sem_veiculos' END,
    'declarada', 'desfeita', auth.uid(), v_reason);

  PERFORM public.reconcile_voyage_vehicle_sheet_alerts(p_voyage_id, 'vehicle_declaration');
END;
$function$;

REVOKE ALL ON FUNCTION public.undo_voyage_vehicle_declaration(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_voyage_vehicle_declaration(bigint, text) TO authenticated, service_role;

-- 4 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_vehicle_sheet_alerts_from_vehicles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_arrived bigint[];
  v_touched bigint[];
  v_voyage bigint;
BEGIN
  -- Viagens que ganharam veículo (inserido ou movido para ela) e todas as tocadas.
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.voyage_id) INTO v_arrived FROM new_rows n;
    v_touched := v_arrived;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.voyage_id) INTO v_touched FROM old_rows o;
  ELSE
    SELECT array_agg(DISTINCT n.voyage_id) INTO v_arrived
    FROM new_rows n JOIN old_rows o ON o.id = n.id
    WHERE n.voyage_id IS DISTINCT FROM o.voyage_id;
    SELECT array_agg(DISTINCT x.voyage_id) INTO v_touched
    FROM (
      SELECT n.voyage_id FROM new_rows n JOIN old_rows o ON o.id = n.id WHERE n.voyage_id IS DISTINCT FROM o.voyage_id
      UNION
      SELECT o.voyage_id FROM new_rows n JOIN old_rows o ON o.id = n.id WHERE n.voyage_id IS DISTINCT FROM o.voyage_id
    ) x;
  END IF;

  -- O veículo que chega desfaz a declaração "não terá veículos": o fato vale
  -- mais. A resposta "terá veículos" continua (596).
  FOREACH v_voyage IN ARRAY COALESCE(v_arrived, ARRAY[]::bigint[]) LOOP
    PERFORM 1 FROM public.voyages WHERE id = v_voyage FOR NO KEY UPDATE;
    DELETE FROM public.voyage_vehicle_declarations WHERE voyage_id = v_voyage AND NOT has_vehicles;
    IF FOUND THEN
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('voyage', v_voyage::text, 'sem_veiculos', 'declarada', 'desfeita', auth.uid(), 'Veículos importados na viagem');
    END IF;
  END LOOP;

  -- Falha do alerta não desfaz a gravação dos veículos: vira WARNING, e o
  -- detector de 15 minutos refaz a conta.
  FOREACH v_voyage IN ARRAY COALESCE(v_touched, ARRAY[]::bigint[]) LOOP
    BEGIN
      PERFORM public.reconcile_voyage_vehicle_sheet_alerts(v_voyage, 'vehicle_change_trigger');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Reconciliação da planilha de Veículos ignorada para a viagem %: %', v_voyage, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_vehicle_sheet_alerts_from_vehicles() FROM PUBLIC, anon, authenticated;

-- 5 -------------------------------------------------------------------------
-- Corpo da 584 com o alerta novo na reavaliação da viagem concluída.
CREATE OR REPLACE FUNCTION public.reconcile_inactive_voyage_alerts(p_voyage_id bigint, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status TEXT;
  v_item RECORD;
BEGIN
  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id;
  IF NOT FOUND OR v_status = 'active' THEN
    RETURN;
  END IF;
  IF v_status = 'cancelled' THEN
    PERFORM public.reconcile_voyage_operation_alerts(p_voyage_id, p_source);
    RETURN;
  END IF;

  -- Viagem concluída: reavalia só os tipos que já estão abertos. O fato que
  -- chega depois (manifesto de exportação, CE, B/L) fecha o alerta; a viagem
  -- encerrada não ganha tipo novo pela varredura (346).
  FOR v_item IN
    SELECT DISTINCT i.item_type, a.entity_id
    FROM public.voyage_alert_scope(p_voyage_id) s
    JOIN public.alerts a ON a.id = s.alert_id
    JOIN public.alert_items i ON i.alert_id = a.id
    WHERE s.alert_id IS NOT NULL AND i.status = 'active'
  LOOP
    CASE v_item.item_type
      WHEN 'voyage_bl_expected' THEN
        PERFORM public.reconcile_voyage_bl_expected_alerts(p_voyage_id, p_source);
      WHEN 'voyage_baplie_missing' THEN
        PERFORM public.reconcile_voyage_baplie_missing_alerts(p_voyage_id, p_source);
      WHEN 'voyage_baplie_documentary_coverage' THEN
        PERFORM public.reconcile_voyage_baplie_coverage_alerts(p_voyage_id, p_source);
      WHEN 'voyage_ce_mercante_missing' THEN
        PERFORM public.reconcile_voyage_ce_mercante_missing_alerts(p_voyage_id, p_source);
      WHEN 'voyage_vehicle_sheet_pending', 'voyage_vehicle_declaration_pending' THEN
        PERFORM public.reconcile_voyage_vehicle_sheet_alerts(p_voyage_id, p_source);
      WHEN 'voyage_schedule_date_pending', 'voyage_terminal_date_pending' THEN
        PERFORM public.reconcile_voyage_schedule_date_alerts(p_voyage_id, split_part(v_item.entity_id, '::', 2), p_source);
      WHEN 'voyage_escala_terminal_missing' THEN
        PERFORM public.reconcile_voyage_escala_terminal_alerts(p_voyage_id, split_part(v_item.entity_id, '::', 2), p_source);
      WHEN 'voyage_export_after_atd' THEN
        PERFORM public.reconcile_voyage_export_after_atd_alerts(p_voyage_id, split_part(v_item.entity_id, '::', 2), p_source);
      ELSE
        -- Comunicados (NOA/NOR/NOB) têm detector próprio.
        NULL;
    END CASE;
  END LOOP;
END;
$function$;

-- 6 -------------------------------------------------------------------------
-- Corpo da 394 com a resposta de veículos entre os filhos da viagem excluída.
CREATE OR REPLACE FUNCTION public.voyage_delete_children_spec()
RETURNS TABLE(ord integer, table_name text, column_name text, action text, label text)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  VALUES
    (1, 'vehicles', 'voyage_id', 'delete', 'veículo(s)'),
    (2, 'bls', 'voyage_id', 'delete', 'B/L(s), com containers e taxas'),
    (3, 'import_batches', 'voyage_id', 'delete', 'importação(ões) de manifesto'),
    (4, 'manifestos_mercante', 'voyage_id', 'delete', 'Manifesto(s) Mercante'),
    (5, 'voyage_route_ce_master', 'voyage_id', 'delete', 'CE Master por rota'),
    (6, 'baplie_reconciliation_resolutions', 'voyage_id', 'delete', 'resolução(ões) de BAPLIE'),
    (7, 'baplie_containers', 'voyage_id', 'delete', 'container(es) do BAPLIE'),
    (8, 'agency_departure_reports', 'voyage_id', 'delete', 'ADR(s) de Saída em aberto'),
    (9, 'vazios_bookings', 'voyage_id', 'delete', 'unidade(s) de vazios'),
    (10, 'vazios_export_operations', 'voyage_id', 'delete', 'operação(ões) de embarque de vazios'),
    (11, 'voyage_omissions', 'voyage_id', 'delete', 'omissão(ões) de escala e transbordo'),
    (12, 'voyage_escala_terminal_state', 'voyage_id', 'delete', 'atracação(ões)'),
    (13, 'voyage_escala_operation_fronts', 'voyage_id', 'delete', 'frente(s) de operação'),
    (14, 'voyage_escala_revision_state', 'voyage_id', 'delete', 'revisão(ões) de escala'),
    (15, 'voyage_export_schedules', 'voyage_id', 'delete', 'escala(s) de exportação'),
    (16, 'granite_manifests', 'voyage_id', 'detach', 'manifesto(s) de Granito ficam sem viagem'),
    (17, 'vazios_manifests', 'voyage_id', 'delete', 'manifesto(s) de vazios'),
    (18, 'vazios_importacao_manifests', 'voyage_id', 'delete', 'manifesto(s) de vazios de importação'),
    (19, 'voyage_vehicle_declarations', 'voyage_id', 'delete', 'resposta de Equipamentos sobre veículos');
$function$;
REVOKE ALL ON FUNCTION public.voyage_delete_children_spec() FROM PUBLIC, anon, authenticated;

-- 3 (prévia da planilha de CE Mercante) -------------------------------------
-- Corpo da 592 com a trava de veículos antes do retorno.
CREATE OR REPLACE FUNCTION public._analyze_ce_mercante_rows(p_rows jsonb, p_manifesto_numero text, p_voyage_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_numero text := public.canonical_manifesto_numero(p_manifesto_numero);
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_item jsonb;
  v_bl public.bls%ROWTYPE;
  v_new_ce text;
  v_holders text;
  v_route record;
  v_routes integer;
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_has_manifesto boolean := false;
  v_active_ids text[] := ARRAY[]::text[];
  v_current_numero text;
  v_status text;
  v_changes integer := 0;
  v_moves integer := 0;
  v_route_voyage bigint;
  v_route_pol text;
  v_route_pod text;
  v_cargo_modes integer := 0;
  v_route_cargo text;
  v_lock record;
BEGIN
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')),
      'warnings', '[]'::jsonb, 'rows', '[]'::jsonb);
  END IF;
  IF v_numero IS NULL THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('message', 'Informe o número do Manifesto Mercante deste lote antes de importar.'));
  ELSIF v_numero !~ '^[A-Z0-9]{13}$' THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
      format('Nº de Manifesto Mercante inválido: "%s". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_manifesto_numero)));
  ELSE
    SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
    v_has_manifesto := FOUND;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_new_ce := NULLIF(regexp_replace(COALESCE(v_item->>'ce', ''), '\s', '', 'g'), '');
    SELECT * INTO v_bl FROM public.bls WHERE id = btrim(v_item->>'bl_id');
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_item->>'bl_id',
        'message', format('B/L %s não encontrado no sistema.', v_item->>'bl_id')));
      CONTINUE;
    END IF;
    IF v_bl.cancelled_at IS NOT NULL THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('B/L %s cancelado: a linha é ignorada.', v_bl.id)));
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id, 'status', 'cancelled'));
      CONTINUE;
    END IF;
    IF v_new_ce IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('Linha sem CE Mercante para o B/L %s.', v_bl.id)));
      CONTINUE;
    END IF;
    IF v_new_ce !~ '^[0-9]{15}$' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('CE Mercante inválido para o B/L %s: o CE tem 15 dígitos.', v_bl.id)));
      CONTINUE;
    END IF;
    -- Unicidade como no gatilho `guard_ce_mercante_unique`: B/Ls de carga não
    -- cancelados e B/Ls de Granito (ADR 0078, item 3; K7).
    SELECT string_agg(holder, ', ' ORDER BY holder) INTO v_holders FROM (
      SELECT other.id AS holder
      FROM public.bls AS other
      WHERE other.id <> v_bl.id AND other.cancelled_at IS NULL
        AND public.ce_mercante_key(other.ce_mercante) = public.ce_mercante_key(v_new_ce)
      UNION ALL
      SELECT 'B/L de Granito ' || g.bl_number
      FROM public.granite_bls AS g
      WHERE public.ce_mercante_key(g.ce_mercante) = public.ce_mercante_key(v_new_ce)
    ) AS holders;
    IF v_holders IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('O CE Mercante %s já está em outro B/L não cancelado (%s).', v_new_ce, v_holders)));
      CONTINUE;
    END IF;

    v_active_ids := array_append(v_active_ids, v_bl.id);
    SELECT numero INTO v_current_numero FROM public.manifestos_mercante WHERE id = v_bl.manifesto_mercante_id;
    v_status := CASE
      WHEN NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NULL THEN 'new'
      WHEN public.ce_mercante_key(v_bl.ce_mercante) = public.ce_mercante_key(v_new_ce) THEN 'same'
      ELSE 'change'
    END;
    IF v_status = 'change' THEN v_changes := v_changes + 1; END IF;
    IF v_current_numero IS NOT NULL AND v_numero IS NOT NULL AND v_current_numero IS DISTINCT FROM v_numero THEN
      v_moves := v_moves + 1;
    END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'row', v_item->'row',
      'bl_id', v_bl.id,
      'status', v_status,
      'current_ce', NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), ''),
      'new_ce', v_new_ce,
      'current_manifesto', v_current_numero,
      'target_manifesto', v_numero,
      'manifesto_change', v_current_numero IS NOT NULL AND v_current_numero IS DISTINCT FROM v_numero,
      'live_invoices', to_jsonb(public._bl_live_invoice_numbers(v_bl.id)),
      'portal_visible', v_bl.customer_id IS NOT NULL AND NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NOT NULL
        AND public.customer_portal_access_ready(v_bl.customer_id),
      'comunicado_sent', EXISTS (
        SELECT 1 FROM public.customer_communications AS c
        JOIN public.customer_communication_bls AS cb ON cb.communication_id = c.id
        WHERE cb.bl_id = v_bl.id AND c.kind = 'ce_mercante_taxas' AND c.status IN ('enviado', 'parcial', 'simulado')),
      'unlock_confirmed', public._bl_ce_unlock_conferred(v_bl.id, v_bl.ce_mercante)
    ));
  END LOOP;

  IF cardinality(v_active_ids) > 0 AND v_numero ~ '^[A-Z0-9]{13}$' THEN
    SELECT count(DISTINCT (b.voyage_id, public.normalize_port_code(b.pol), public.normalize_port_code(b.pod))) INTO v_routes
    FROM public.bls AS b WHERE b.id = ANY(v_active_ids);
    SELECT b.voyage_id, btrim(b.pol) AS pol, btrim(b.pod) AS pod INTO v_route FROM public.bls AS b WHERE b.id = ANY(v_active_ids) ORDER BY b.id LIMIT 1;
    v_route_voyage := v_route.voyage_id; v_route_pol := v_route.pol; v_route_pod := v_route.pod;
    -- 592: a natureza do Manifesto (contêiner ou carga solta) vem dos B/Ls.
    SELECT count(DISTINCT public.manifesto_cargo_mode_of_bl(b.cargo_mode)), min(public.manifesto_cargo_mode_of_bl(b.cargo_mode))
      INTO v_cargo_modes, v_route_cargo
    FROM public.bls AS b WHERE b.id = ANY(v_active_ids);
    IF v_routes > 1 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'Os B/Ls da planilha são de mais de uma viagem ou rota (POL → POD). Um manifesto tem uma única rota: separe a planilha por manifesto.'));
    ELSIF v_cargo_modes > 1 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'A planilha tem B/Ls de contêiner e de carga solta. Um Manifesto Mercante é só de contêiner ou só de carga solta (o B/L misto vai no de carga solta): separe a planilha por natureza.'));
    ELSIF NULLIF(v_route.pol, '') IS NULL OR NULLIF(v_route.pod, '') IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'Os B/Ls da planilha não têm POL e POD cadastrados; sem rota não há manifesto.'));
    ELSIF p_voyage_id IS NOT NULL AND v_route.voyage_id IS DISTINCT FROM p_voyage_id THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message', 'Os B/Ls da planilha não pertencem à viagem selecionada.'));
    ELSIF v_has_manifesto AND (
      v_manifesto.voyage_id IS DISTINCT FROM v_route.voyage_id
      OR COALESCE(public.normalize_port_code(v_manifesto.pol), upper(v_manifesto.pol)) IS DISTINCT FROM public.normalize_port_code(v_route.pol)
      OR COALESCE(public.normalize_port_code(v_manifesto.pod), upper(v_manifesto.pod)) IS DISTINCT FROM public.normalize_port_code(v_route.pod)
      OR v_manifesto.natureza <> 'carga'
    ) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        format('O Manifesto Mercante %s já está cadastrado para outra viagem, rota ou natureza.', v_numero)));
    ELSIF v_has_manifesto AND v_manifesto.cargo_mode IS DISTINCT FROM v_route_cargo THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        format('O Manifesto Mercante %s é de %s e os B/Ls da planilha são de %s. Um Manifesto é só de contêiner ou só de carga solta: use o número do Manifesto de %s da rota.',
          v_numero, public.manifesto_cargo_mode_label(v_manifesto.cargo_mode),
          public.manifesto_cargo_mode_label(v_route_cargo), public.manifesto_cargo_mode_label(v_route_cargo))));
    END IF;
  END IF;

  -- 596: o B/L de container ou misto só recebe o primeiro CE na viagem em que
  -- Equipamentos já respondeu "não terá veículos" ou importou um veículo.
  FOR v_lock IN
    SELECT b.voyage_id, public.voyage_ce_mercante_vehicle_lock(b.voyage_id) AS lock
    FROM jsonb_array_elements(v_rows) AS r
    JOIN public.bls AS b ON b.id = r.value->>'bl_id'
    WHERE r.value->>'status' = 'new' AND b.cargo_mode IN ('container', 'misto') AND b.voyage_id IS NOT NULL
    GROUP BY b.voyage_id
    ORDER BY b.voyage_id
  LOOP
    IF v_lock.lock IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        public._ce_mercante_vehicle_lock_message(v_lock.voyage_id, v_lock.lock)));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'errors', v_errors,
    'warnings', v_warnings,
    'rows', v_rows,
    'active_bl_ids', to_jsonb(v_active_ids),
    'manifesto', jsonb_build_object('numero', v_numero, 'exists', v_has_manifesto,
      'voyage_id', v_route_voyage, 'pol', v_route_pol, 'pod', v_route_pod, 'cargo_mode', v_route_cargo),
    'changes', v_changes,
    'moves', v_moves,
    'needs_confirmation', (v_changes + v_moves) > 0
  );
END;
$function$;
