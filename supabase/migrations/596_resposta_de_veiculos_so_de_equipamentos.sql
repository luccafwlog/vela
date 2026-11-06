-- 596: só Equipamentos e o Administrativo respondem se a viagem terá veículos
-- (decisão do dono de 2026-11-06, na revisão da PR da 595; ADR 0126, item 9).
--
-- A 595 aceitava a resposta de qualquer usuário interno ativo: a Documentação
-- podia declarar "não terá veículos" e soltar sozinha a trava do CE Mercante.
-- `_declare_voyage_vehicle_presence` (por trás de `declare_voyage_with_vehicles`
-- e `declare_voyage_without_vehicles`) e `undo_voyage_vehicle_declaration`
-- passam a recusar, com 42501, quem não é de Equipamentos nem do
-- Administrativo (`_portal_actor_role`, a mesma régua de Responder Disputa,
-- migration 574; a conta Dev é do Administrativo). Importar, mover e excluir
-- veículos continuam de qualquer setor: o veículo importado é fato e solta a
-- trava como antes.
--
-- Plano de preservação: não reescreve nem apaga linha. Os UPDATE e DELETE
-- abaixo são os corpos da 595, dentro das RPCs, por ação do usuário e com o
-- valor anterior em `audit_logs` (`sem_veiculos`, `com_veiculos`). Conferir:
-- `SELECT count(*) FROM voyage_vehicle_declarations` igual antes e depois.
-- Desfazer: o rollback abaixo.
--
-- Rollback: reaplicar as duas funções pela 595.

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
  -- 596: quem responde é Equipamentos (e o Administrativo, como na Disputa);
  -- a Documentação só sente a trava do CE.
  IF COALESCE(public._portal_actor_role(), '') NOT IN ('equipamentos', 'administrativo') THEN
    RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo responde se a viagem terá veículos.' USING ERRCODE = '42501';
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
  IF COALESCE(public._portal_actor_role(), '') NOT IN ('equipamentos', 'administrativo') THEN
    RAISE EXCEPTION 'Apenas Equipamentos ou Administrativo desfaz a resposta de veículos da viagem.' USING ERRCODE = '42501';
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
