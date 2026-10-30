-- 520: o Embarque de vazios opera num terminal (decisão do dono de
-- 2026-10-30; ADR 0113).
--
-- Problema: o Embarque de vazios (`vazios_export_operations`, um por Viagem e
-- porto) nascia sem terminal e sem laço com a frente de operação Vazios EXP da
-- escala, dona do terminal (ADR 0109). Dava para ter embarque com unidades e
-- custos num porto sem essa frente: a seção Embarque de vazios não caía no ADR
-- de terminal nenhum, e a trava do ADR de Saída fechado
-- (`_vazios_export_locked_by_adr`) não pegava o embarque quando só os ADRs por
-- terminal fechavam. A tela não mostrava terminal nenhum.
--
-- Mudança:
--   1. `create_vazios_export_operation(viagem, porto, terminal)` cria ou abre o
--      embarque da escala com o terminal onde ele opera. Sem terminal na frente
--      Vazios EXP, grava o terminal escolhido pela gravação da escala
--      (`save_voyage_escala_terminal_state_v2`): ela cria a frente, a Atracação
--      e o ADR do terminal, com as travas de ADR fechado, de ATA e a revisão da
--      escala. Com terminal na frente, o embarque usa esse e recusa outro (a
--      troca é na escala). O terminal continua sendo da frente; o embarque não
--      ganha coluna própria (ADR 0082, dono único).
--   2. O banco recusa criar embarque (ou trocar a Viagem ou o porto dele) sem a
--      frente Vazios EXP com terminal na escala (gatilho
--      `require_vazios_export_front_terminal`). A reimportação, que toca o
--      embarque existente por ON CONFLICT, não é criação e passa.
--   3. Com embarque na escala, a frente Vazios EXP não volta para TBC nem sai
--      (gatilho `guard_vazios_export_front_with_embarque`); `delete_escala`
--      recusa a escala com embarque, na prévia e na execução.
--
-- Embarques que já existem sem terminal continuam: a tela pede o terminal e o
-- grava pela mesma RPC. Só cria e redefine funções e gatilhos; não reescreve nem
-- apaga linhas.
--
-- Rollback: DROP FUNCTION `create_vazios_export_operation` e
-- `_vazios_export_front_terminal`; DROP TRIGGER `require_vazios_export_front_terminal`
-- e `guard_vazios_export_front_with_embarque` e suas funções; reaplicar
-- `delete_escala` sem o bloco "Embarque de vazios na escala".

-- Terminal da frente Vazios EXP da escala (NULL: sem frente ou em TBC). Porto
-- comparado pela régua de porto, como a trava do ADR (400).
CREATE OR REPLACE FUNCTION public._vazios_export_front_terminal(p_voyage_id bigint, p_port text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT f.terminal_id
  FROM public.voyage_escala_operation_fronts AS f
  WHERE f.voyage_id = p_voyage_id
    AND COALESCE(public.normalize_port_code(f.port), upper(btrim(f.port)))
      = COALESCE(public.normalize_port_code(p_port), upper(btrim(p_port)))
    AND f.sentido = 'exportacao' AND f.modalidade = 'vazio'
  ORDER BY f.terminal_id NULLS LAST
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public._vazios_export_front_terminal(bigint, text) FROM PUBLIC, anon, authenticated;

-- 1. Criar ou abrir o embarque com o terminal.
CREATE OR REPLACE FUNCTION public.create_vazios_export_operation(p_voyage_id bigint, p_port text, p_terminal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_port text := COALESCE(public.normalize_port_code(p_port), upper(btrim(COALESCE(p_port, ''))));
  v_operation_id uuid;
  v_front_terminal uuid;
  v_front_exists boolean;
  v_terminal_code text;
  v_revision integer;
  v_fronts jsonb;
  v_terminals jsonb;
  v_expectation jsonb;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para criar o embarque de vazios.' USING ERRCODE = '42501';
  END IF;
  IF v_port !~ '^BR[A-Z0-9]{3}$' THEN
    RAISE EXCEPTION 'Escolha o porto de embarque: uma escala brasileira da viagem.' USING ERRCODE = '22023';
  END IF;
  -- O mesmo lock da gravação da escala: dois "Criar embarque" da mesma escala
  -- não gravam a frente nem o embarque duas vezes.
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT o.id INTO v_operation_id
  FROM public.vazios_export_operations AS o
  WHERE o.voyage_id = p_voyage_id
    AND COALESCE(public.normalize_port_code(o.embark_port), upper(btrim(o.embark_port))) = v_port
  ORDER BY o.created_at, o.id
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port
      AND f.sentido = 'exportacao' AND f.modalidade = 'vazio'
  ) INTO v_front_exists;
  v_front_terminal := public._vazios_export_front_terminal(p_voyage_id, v_port);

  IF v_front_terminal IS NOT NULL THEN
    IF p_terminal_id IS NOT NULL AND p_terminal_id <> v_front_terminal THEN
      SELECT d.code INTO v_terminal_code FROM public.depots AS d WHERE d.id = v_front_terminal;
      RAISE EXCEPTION 'A frente Vazios EXP de % já opera no terminal %: o embarque usa esse terminal. Para trocar, edite a escala.',
        v_port, COALESCE(v_terminal_code, v_front_terminal::text) USING ERRCODE = '23514';
    END IF;
  ELSE
    IF p_terminal_id IS NULL THEN
      RAISE EXCEPTION 'Escolha o terminal onde o embarque de vazios de % opera.', v_port USING ERRCODE = '22023';
    END IF;
    SELECT d.code INTO v_terminal_code FROM public.depots AS d WHERE d.id = p_terminal_id;

    -- Payload completo da escala, como o editor manda: as frentes gravadas com
    -- a Vazios EXP no terminal escolhido e as Atracações com as datas como estão
    -- (a gravação apaga a Atracação que fica de fora). Sem granito e vazios na
    -- expectativa de exportação, a gravação os deriva das frentes e mantém
    -- quantidades e CE.
    SELECT COALESCE(rs.revision, 0) INTO v_revision
    FROM public.voyage_escala_revision_state AS rs
    WHERE rs.voyage_id = p_voyage_id AND rs.port = v_port;
    v_revision := COALESCE(v_revision, 0);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'sentido', f.sentido,
      'modalidade', f.modalidade,
      'terminal_id', CASE WHEN f.sentido = 'exportacao' AND f.modalidade = 'vazio' THEN p_terminal_id ELSE f.terminal_id END,
      'source', f.source
    ) ORDER BY f.sentido, f.modalidade), '[]'::jsonb)
    INTO v_fronts
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port;
    IF NOT v_front_exists THEN
      v_fronts := v_fronts || jsonb_build_array(jsonb_build_object(
        'sentido', 'exportacao', 'modalidade', 'vazio',
        'terminal_id', p_terminal_id, 'source', 'export_declaration'
      ));
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'terminal_id', s.terminal_id,
      'terminal_etb', s.terminal_etb,
      'terminal_atb', s.terminal_atb,
      'terminal_etd', s.terminal_etd,
      'terminal_atd', s.terminal_atd,
      'terminal_rtw', s.terminal_rtw
    )), '[]'::jsonb)
    INTO v_terminals
    FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id IS NOT NULL;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_terminals) AS t(item)
      WHERE (t.item->>'terminal_id')::uuid = p_terminal_id
    ) THEN
      v_terminals := v_terminals || jsonb_build_array(jsonb_build_object('terminal_id', p_terminal_id));
    END IF;

    -- Vinculada e portos de descarga como estão; sem declaração de exportação,
    -- os padrões do editor (as colunas não aceitam nulo).
    SELECT jsonb_build_object(
      'linked', COALESCE(ves.linked, false),
      'discharge_ports', to_jsonb(COALESCE(ves.discharge_ports, '{}'::text[]))
    ) INTO v_expectation
    FROM public.voyage_export_schedules AS ves
    WHERE ves.voyage_id = p_voyage_id AND ves.pol = v_port;
    v_expectation := COALESCE(v_expectation, '{"linked": false, "discharge_ports": []}'::jsonb);

    v_result := public.save_voyage_escala_terminal_state_v2(
      p_voyage_id, v_port, v_revision, v_fronts, v_terminals, v_expectation,
      format('Embarque de vazios: frente Vazios EXP no terminal %s.', COALESCE(v_terminal_code, p_terminal_id::text))
    );
    IF COALESCE((v_result->>'blocked')::boolean, false) THEN
      RAISE EXCEPTION 'ADR de Saída de % fechado: a escala não muda. Reabra o ADR de Saída para escolher o terminal do embarque de vazios.',
        COALESCE((
          SELECT string_agg(DISTINCT b.item->>'terminal_code', ', ')
          FROM jsonb_array_elements(COALESCE(v_result->'closed_blockers', '[]'::jsonb)) AS b(item)
        ), v_port)
        USING ERRCODE = '42501';
    END IF;
    v_front_terminal := p_terminal_id;
  END IF;

  IF v_operation_id IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_operation_id, 'created', false, 'terminal_id', v_front_terminal);
  END IF;

  INSERT INTO public.vazios_export_operations (voyage_id, embark_port, updated_at)
  VALUES (p_voyage_id, v_port, now())
  RETURNING id INTO v_operation_id;
  RETURN jsonb_build_object('id', v_operation_id, 'created', true, 'terminal_id', v_front_terminal);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_vazios_export_operation(bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_vazios_export_operation(bigint, text, uuid) TO authenticated;

-- 2. Embarque novo exige a frente Vazios EXP com terminal.
CREATE OR REPLACE FUNCTION public.require_vazios_export_front_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.voyage_id = OLD.voyage_id AND NEW.embark_port = OLD.embark_port THEN
    RETURN NEW;
  END IF;
  -- O ON CONFLICT da reimportação dispara o BEFORE INSERT mesmo quando só toca
  -- o embarque que já existe: isso não é criação.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.vazios_export_operations AS o
    WHERE o.voyage_id = NEW.voyage_id AND o.embark_port = NEW.embark_port
  ) THEN
    RETURN NEW;
  END IF;
  IF public._vazios_export_front_terminal(NEW.voyage_id, NEW.embark_port) IS NULL THEN
    RAISE EXCEPTION 'O Embarque de vazios de % precisa do terminal onde opera: escolha o terminal ao criar o embarque (ele vai para a frente Vazios EXP da escala).',
      upper(btrim(NEW.embark_port)) USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.require_vazios_export_front_terminal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS require_vazios_export_front_terminal ON public.vazios_export_operations;
CREATE TRIGGER require_vazios_export_front_terminal
  BEFORE INSERT OR UPDATE OF voyage_id, embark_port ON public.vazios_export_operations
  FOR EACH ROW EXECUTE FUNCTION public.require_vazios_export_front_terminal();

-- 3. Com embarque na escala, a frente Vazios EXP não volta para TBC nem sai.
CREATE OR REPLACE FUNCTION public.guard_vazios_export_front_with_embarque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.sentido <> 'exportacao' OR OLD.modalidade <> 'vazio' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.terminal_id IS NOT NULL OR OLD.terminal_id IS NULL) THEN
    RETURN NEW;
  END IF;
  -- A exclusão da Viagem apaga os embarques antes das frentes; na cascata a
  -- Viagem já saiu.
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = OLD.voyage_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.vazios_export_operations AS o
    WHERE o.voyage_id = OLD.voyage_id
      AND COALESCE(public.normalize_port_code(o.embark_port), upper(btrim(o.embark_port)))
        = COALESCE(public.normalize_port_code(OLD.port), upper(btrim(OLD.port)))
  ) THEN
    RAISE EXCEPTION 'A escala % tem Embarque de vazios: a frente Vazios EXP não volta para TBC nem sai enquanto o embarque existir. Para trocar, escolha outro terminal.',
      OLD.port USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_vazios_export_front_with_embarque() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_vazios_export_front_with_embarque ON public.voyage_escala_operation_fronts;
CREATE TRIGGER guard_vazios_export_front_with_embarque
  BEFORE UPDATE OF terminal_id OR DELETE ON public.voyage_escala_operation_fronts
  FOR EACH ROW EXECUTE FUNCTION public.guard_vazios_export_front_with_embarque();

-- `delete_escala` recusa a escala com embarque, na prévia e na execução. O
-- resto do corpo é o vigente (513).
DO $patch$
DECLARE
  v_def text;
  v_old text := $s$    v_lock := array_prepend('B/L vinculado à escala', v_lock);
  END IF;
$s$;
  v_new text := $s$    v_lock := array_prepend('B/L vinculado à escala', v_lock);
  END IF;
  -- 520 (ADR 0113): o embarque opera na frente Vazios EXP da escala.
  IF EXISTS (
    SELECT 1 FROM public.vazios_export_operations AS o
    WHERE o.voyage_id = p_voyage_id
      AND COALESCE(public.normalize_port_code(o.embark_port), upper(btrim(o.embark_port))) = COALESCE(public.normalize_port_code(v_port), v_port)
  ) THEN
    v_lock := array_append(v_lock, 'Embarque de vazios na escala');
  END IF;
$s$;
BEGIN
  v_def := pg_get_functiondef('public.delete_escala(bigint,text,boolean,text)'::regprocedure);
  IF position('520 (ADR 0113)' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION '520: trecho não encontrado em delete_escala';
  END IF;
  IF position(v_old IN substr(v_def, position(v_old IN v_def) + 1)) > 0 THEN
    RAISE EXCEPTION '520: trecho repetido em delete_escala';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;
