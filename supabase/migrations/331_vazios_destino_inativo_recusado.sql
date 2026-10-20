-- 331: o destino inativo do transporte também não entra em lançamento novo do
-- Embarque de vazios (decisão do responsável de 2026-10-20, na revisão do
-- lote 5b).
--
-- Problema:
--   A `326` recusa local e serviço inativos num lançamento novo, mas não
--   olhava o local de destino do serviço de transporte
--   (`depot_services.route_destino_id`, gravado na linha como `destino_id`).
--   Um serviço ativo "Transporte para o Depot X" seguia aceito depois de o
--   Depot X ser desativado.
--
-- Mudança:
--   `validate_vazios_export_service_line` recusa o destino inativo na
--   inclusão e quando a alteração troca o serviço, o local ou o destino. A
--   linha já lançada continua editável (observação) sem trocar nada disso,
--   como na `326`. O corpo é o da `326` mais essa checagem; grants iguais.
--
-- Não reescreve nem apaga linha existente.
-- Reversão: recriar a função com o corpo da migration `326`.

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
  v_destino_active BOOLEAN;
  v_new_launch BOOLEAN;
BEGIN
  SELECT natureza, depot_id, route_destino_id, condition, active
    INTO v_natureza, v_service_local, v_service_destino, v_service_condition, v_service_active
  FROM public.depot_services WHERE id = NEW.service_id;
  SELECT tipo, active INTO v_local_tipo, v_local_active FROM public.depots WHERE id = NEW.local_id;

  IF v_natureza IS NULL OR v_service_local IS DISTINCT FROM NEW.local_id THEN
    RAISE EXCEPTION 'O serviço deve pertencer ao local informado.' USING ERRCODE = '23514';
  END IF;
  -- V1: local, serviço e destino inativos não entram em lançamento novo; a
  -- linha já lançada pode mudar (observação) sem trocar nenhum deles.
  v_new_launch := TG_OP = 'INSERT'
    OR NEW.service_id IS DISTINCT FROM OLD.service_id
    OR NEW.local_id IS DISTINCT FROM OLD.local_id
    OR NEW.destino_id IS DISTINCT FROM OLD.destino_id;
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
    SELECT active INTO v_destino_active FROM public.depots WHERE id = NEW.destino_id;
    IF v_new_launch AND v_destino_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Destino inativo: escolha um transporte para local ativo ou reative o destino no cadastro.' USING ERRCODE = '23514';
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

REVOKE ALL ON FUNCTION public.validate_vazios_export_service_line() FROM PUBLIC, anon, authenticated;
