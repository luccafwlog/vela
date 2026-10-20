-- 326: local e serviço inativos não entram em lançamento novo do Embarque de
-- vazios, e as mensagens do banco dessas funções com acento (lote 5b da
-- identidade visual, achados V1 e V6, aprovados pelo responsável em
-- 2026-10-19).
--
-- Problema:
--   V1. A regra do módulo (docs/modules/manifesto-edi.md, "Local inativo não
--       entra em lançamento novo") só valia na importação da planilha de
--       unidades (`import_vazios_bookings_transactional` junta só depots
--       ativos). A unidade incluída à mão (`create_manual_vazios_booking`,
--       `update_manual_vazios_booking`) e a linha de serviço (insert direto em
--       `vazios_export_service_lines`) aceitavam local e serviço desativados,
--       e os seletores da tela os ofereciam.
--   V6. As mensagens destas funções chegavam à tela sem acento: "Terminal
--       portuario nao aceita entrada ou saida.", "Depot exige entrada e saida
--       validas.", "Servico deve pertencer ao local informado." etc.
--
-- Mudança:
--   Os gatilhos `validate_vazios_booking_operation` (vazios_bookings) e
--   `validate_vazios_export_service_line` (vazios_export_service_lines)
--   recusam local inativo e serviço inativo na inclusão e quando a alteração
--   troca o local ou o serviço. Alteração que mantém o local ou o serviço
--   (datas da unidade, observação da linha) continua aceita mesmo que eles
--   tenham sido desativados depois: o que já foi lançado não muda. Valer no
--   gatilho cobre a RPC manual, a importação e a gravação direta da tela.
--   As mensagens das quatro funções ganham acento. Os corpos são os vigentes
--   (lidos do banco recriado com todas as migrations); assinatura, grants e
--   a descrição 'Inclusao manual no Embarque de Vazios' (marca da unidade
--   manual lida por `import_vazios_bookings_transactional_legacy_189`) ficam
--   como estão.
--
-- Não reescreve nem apaga linha existente.
-- Reversão: recriar as quatro funções com os corpos das migrations 245/260
-- (as definições anteriores), sem as duas checagens de ativo.

CREATE OR REPLACE FUNCTION public.create_manual_vazios_booking(p_operation_id uuid, p_voyage_id bigint, p_uploaded_by uuid, p_container_number text, p_container_type text, p_local_id uuid, p_condition text, p_hand_in_date date, p_hand_out_date date, p_movement_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id UUID;
  v_booking_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para incluir unidade.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vazios_export_operations
    WHERE id = p_operation_id AND voyage_id = p_voyage_id
  ) THEN
    RAISE EXCEPTION 'A unidade deve pertencer a um embarque da mesma viagem.' USING ERRCODE = '22023';
  END IF;
  IF upper(btrim(COALESCE(p_container_number, ''))) !~ '^[A-Z]{4}[0-9]{7}$' THEN
    RAISE EXCEPTION 'Container inválido.' USING ERRCODE = '22023';
  END IF;

  -- A descrição sem acento é a marca da unidade manual (ver cabeçalho).
  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, 'Inclusao manual no Embarque de Vazios', 1, p_uploaded_by)
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_bookings (
    voyage_id, operation_id, manifest_id, container_number, container_type,
    local_id, condition, hand_in_date, hand_out_date, movement_date
  ) VALUES (
    p_voyage_id, p_operation_id, v_manifest_id, upper(btrim(p_container_number)), p_container_type,
    p_local_id, p_condition, p_hand_in_date, p_hand_out_date, p_movement_date
  ) RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_manual_vazios_booking(p_booking_id uuid, p_container_number text, p_container_type text, p_local_id uuid, p_condition text, p_hand_in_date date, p_hand_out_date date, p_movement_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para editar unidade.' USING ERRCODE = '42501';
  END IF;
  IF upper(btrim(COALESCE(p_container_number, ''))) !~ '^[A-Z]{4}[0-9]{7}$' THEN
    RAISE EXCEPTION 'Container inválido.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.vazios_bookings
  SET container_number = upper(btrim(p_container_number)),
      container_type = p_container_type,
      local_id = p_local_id,
      condition = p_condition,
      hand_in_date = p_hand_in_date,
      hand_out_date = p_hand_out_date,
      movement_date = p_movement_date
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unidade embarcada não encontrada.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_vazios_booking_operation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_operation_voyage_id BIGINT;
  v_local_tipo TEXT;
  v_local_active BOOLEAN;
BEGIN
  SELECT voyage_id INTO v_operation_voyage_id FROM public.vazios_export_operations WHERE id = NEW.operation_id;
  SELECT tipo, active INTO v_local_tipo, v_local_active FROM public.depots WHERE id = NEW.local_id;
  IF v_operation_voyage_id IS NULL OR v_operation_voyage_id <> NEW.voyage_id THEN
    RAISE EXCEPTION 'A unidade deve pertencer a um embarque da mesma viagem.' USING ERRCODE = '22023';
  END IF;
  IF v_local_tipo IS NULL THEN RAISE EXCEPTION 'Local inválido.' USING ERRCODE = '22023'; END IF;
  -- V1: local inativo não entra em lançamento novo; a unidade que já está nele
  -- pode ser editada sem trocar de local.
  IF NOT v_local_active AND (TG_OP = 'INSERT' OR NEW.local_id IS DISTINCT FROM OLD.local_id) THEN
    RAISE EXCEPTION 'Local inativo: escolha um local ativo ou reative o local no cadastro.' USING ERRCODE = '22023';
  END IF;
  IF v_local_tipo = 'depot' AND (NEW.hand_in_date IS NULL OR NEW.hand_out_date IS NULL OR NEW.hand_out_date < NEW.hand_in_date) THEN
    RAISE EXCEPTION 'Depot exige entrada e saída válidas.' USING ERRCODE = '22023';
  END IF;
  IF v_local_tipo = 'terminal_portuario' AND (NEW.hand_in_date IS NOT NULL OR NEW.hand_out_date IS NOT NULL) THEN
    RAISE EXCEPTION 'Terminal portuário não aceita entrada ou saída.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_vazios_export_service_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_natureza TEXT;
  v_service_local UUID;
  v_service_destino UUID;
  v_service_condition TEXT;
  v_service_active BOOLEAN;
  v_local_tipo TEXT;
  v_local_active BOOLEAN;
  v_new_launch BOOLEAN;
BEGIN
  SELECT natureza, depot_id, route_destino_id, condition, active
    INTO v_natureza, v_service_local, v_service_destino, v_service_condition, v_service_active
  FROM public.depot_services WHERE id = NEW.service_id;
  SELECT tipo, active INTO v_local_tipo, v_local_active FROM public.depots WHERE id = NEW.local_id;

  IF v_natureza IS NULL OR v_service_local IS DISTINCT FROM NEW.local_id THEN
    RAISE EXCEPTION 'O serviço deve pertencer ao local informado.' USING ERRCODE = '23514';
  END IF;
  -- V1: local e serviço inativos não entram em lançamento novo; a linha já
  -- lançada pode mudar (observação) sem trocar de serviço ou local.
  v_new_launch := TG_OP = 'INSERT'
    OR NEW.service_id IS DISTINCT FROM OLD.service_id
    OR NEW.local_id IS DISTINCT FROM OLD.local_id;
  IF v_new_launch AND NOT v_local_active THEN
    RAISE EXCEPTION 'Local inativo: escolha um local ativo ou reative o local no cadastro.' USING ERRCODE = '23514';
  END IF;
  IF v_new_launch AND NOT v_service_active THEN
    RAISE EXCEPTION 'Serviço inativo: escolha um serviço ativo ou reative o serviço no cadastro do local.' USING ERRCODE = '23514';
  END IF;
  IF v_natureza = 'armazenagem' THEN
    IF v_local_tipo <> 'depot' OR NEW.condition IS NULL
       -- B12 (ADR 0033): serviço sem condição é genérico e vale para as duas.
       OR (v_service_condition IS NOT NULL AND v_service_condition <> NEW.condition)
       OR NEW.container_type IS NOT NULL OR NEW.destino_id IS NOT NULL
       OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Armazenagem exige depot e a condição da linha (a do serviço, quando ele tem uma), sem tipo, rota ou percentual.' USING ERRCODE = '23514';
    END IF;
  ELSIF v_natureza = 'transporte' THEN
    IF v_service_destino IS NULL OR NEW.destino_id IS DISTINCT FROM v_service_destino
       OR NEW.condition IS NOT NULL OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Transporte exige o destino vinculado ao serviço, sem condição ou percentual.' USING ERRCODE = '23514';
    END IF;
  ELSIF v_natureza = 'geral' THEN
    IF NEW.destino_id IS NOT NULL OR NEW.condition IS NOT NULL OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Serviço geral não aceita rota, condição ou percentual.' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Natureza de serviço inválida.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

-- Grants como estavam: as RPCs para `authenticated`; os gatilhos sem EXECUTE público.
REVOKE ALL ON FUNCTION public.create_manual_vazios_booking(uuid, bigint, uuid, text, text, uuid, text, date, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_manual_vazios_booking(uuid, text, text, uuid, text, date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_vazios_booking(uuid, bigint, uuid, text, text, uuid, text, date, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_manual_vazios_booking(uuid, text, text, uuid, text, date, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.validate_vazios_booking_operation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_vazios_export_service_line() FROM PUBLIC, anon, authenticated;
