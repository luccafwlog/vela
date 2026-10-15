-- Item 34 (B12) do plano 2026-10-14: a linha de armazenagem do Embarque de
-- Vazios aceita o serviço de armazenagem sem condição, que o valor sugerido
-- já trata como genérico (ADR 0033). A linha segue exigindo a sua condição.
-- Só redefine a função; não reescreve nem apaga linhas.

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
  v_local_tipo TEXT;
BEGIN
  SELECT natureza, depot_id, route_destino_id, condition
    INTO v_natureza, v_service_local, v_service_destino, v_service_condition
  FROM public.depot_services WHERE id = NEW.service_id;
  SELECT tipo INTO v_local_tipo FROM public.depots WHERE id = NEW.local_id;

  IF v_natureza IS NULL OR v_service_local IS DISTINCT FROM NEW.local_id THEN
    RAISE EXCEPTION 'Servico deve pertencer ao local informado.' USING ERRCODE = '23514';
  END IF;
  IF v_natureza = 'armazenagem' THEN
    IF v_local_tipo <> 'depot' OR NEW.condition IS NULL
       -- B12 (ADR 0033): serviço sem condição é genérico e vale para as duas.
       OR (v_service_condition IS NOT NULL AND v_service_condition <> NEW.condition)
       OR NEW.container_type IS NOT NULL OR NEW.destino_id IS NOT NULL
       OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Armazenagem exige depot e a condicao da linha (a do servico, quando ele tem uma), sem tipo, rota ou percentual.' USING ERRCODE = '23514';
    END IF;
  ELSIF v_natureza = 'transporte' THEN
    IF v_service_destino IS NULL OR NEW.destino_id IS DISTINCT FROM v_service_destino
       OR NEW.condition IS NOT NULL OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Transporte exige o destino vinculado ao servico, sem condicao ou percentual.' USING ERRCODE = '23514';
    END IF;
  ELSIF v_natureza = 'geral' THEN
    IF NEW.destino_id IS NOT NULL OR NEW.condition IS NOT NULL OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Servico geral nao aceita rota, condicao ou percentual.' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Natureza de servico invalida.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
