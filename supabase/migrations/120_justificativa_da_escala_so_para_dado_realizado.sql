-- 120: a justificativa da edição da escala deixa de ser exigida quando muda
-- apenas o status documental (BLs e CEs e Vinculada). Decisão do dono em
-- 2026-10-01: ETA, ETB, ETD e a seção BLs e CEs mudam no dia a dia e não pedem
-- justificativa; continuam exigindo terminal, ATB/ATD/Restow e a declaração de
-- exportação já registrados. ETB/ETD já não exigiam no banco (só o modal).
--
-- ce_status e linked viajam na expectativa de exportação; a comparação que
-- decide a justificativa passa a ignorá-los. A checagem de ADR fechado e a
-- auditoria da exportação seguem comparando o objeto inteiro, como antes.
--
-- Corpo idêntico ao da baseline (002), salvo os dois pontos marcados
-- "migration 120". Mesma assinatura: CREATE OR REPLACE mantém os grants.
-- Não reescreve nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.save_voyage_escala_terminal_state(p_voyage_id bigint, p_port text, p_expected_revision integer, p_fronts jsonb, p_terminals jsonb, p_export_expectation jsonb, p_justification text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_role TEXT;
  v_department TEXT;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
  v_port_id BIGINT;
  v_current_revision INTEGER := 0;
  v_next_revision INTEGER;
  v_entity_id TEXT;
  v_front RECORD;
  v_old_front RECORD;
  v_new_front RECORD;
  v_terminal RECORD;
  v_old_terminal RECORD;
  v_depot RECORD;
  v_report RECORD;
  v_old_export_exists BOOLEAN := FALSE;
  v_old_export_declared BOOLEAN := FALSE;
  v_old_export_granite BOOLEAN := FALSE;
  v_old_export_empty BOOLEAN := FALSE;
  v_old_export_containers_qty INTEGER;
  v_old_export_movements_qty INTEGER;
  v_old_export_discharge_ports TEXT[] := '{}'::TEXT[];
  v_old_export_ce_status TEXT;
  v_old_export_linked BOOLEAN := FALSE;
  v_export_existing_id UUID;
  v_export_existing_id_found BOOLEAN := FALSE;
  v_export_canonical_id UUID;
  v_export_granite BOOLEAN := FALSE;
  v_export_empty BOOLEAN := FALSE;
  v_export_declared BOOLEAN := FALSE;
  v_export_containers_qty INTEGER;
  v_export_movements_qty INTEGER;
  v_export_discharge_ports TEXT[] := '{}'::TEXT[];
  v_export_ce_status TEXT;
  v_export_linked BOOLEAN := FALSE;
  v_export_old JSONB;
  v_export_new JSONB;
  v_current_terminal_assignment BOOLEAN;
  v_existing_terminal_state BOOLEAN;
  v_existing_front BOOLEAN;
  v_front_changed BOOLEAN;
  v_state_changed BOOLEAN;
  v_requires_justification BOOLEAN := FALSE;
  v_closed_blockers JSONB := '[]'::JSONB;
  v_report_id UUID;
  v_report_status TEXT;
  v_terminal_code TEXT;
  v_blocked_report_id UUID;
  v_schedule JSONB;
  v_schedule_entity_id TEXT;
  v_schedule_field TEXT;
  v_schedule_old_value TEXT;
  v_schedule_new_value TEXT;
  v_new_voyage_status TEXT;
  v_active_pods INTEGER;
  v_pending_pods INTEGER;
BEGIN
  SELECT up.role INTO v_role
  FROM public.user_profiles AS up
  WHERE up.id = auth.uid() AND up.active = TRUE;

  IF auth.uid() IS NULL OR v_role IS NULL
     OR v_role NOT IN ('admin', 'administrativo', 'operacoes', 'operator', 'documentacao', 'equipamentos', 'financeiro') THEN
    RAISE EXCEPTION 'Usuario ativo sem permissao para editar a escala.'
      USING ERRCODE = '42501';
  END IF;
  v_department := CASE
    WHEN v_role IN ('admin', 'administrativo') THEN 'administrativo'
    WHEN v_role = 'documentacao' THEN 'documentacao'
    WHEN v_role = 'equipamentos' THEN 'equipamentos'
    ELSE 'operacoes'
  END;
  v_entity_id := p_voyage_id::TEXT || '::' || v_port;

  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'Revision esperada obrigatoria.' USING ERRCODE = '22023';
  END IF;
  IF p_fronts IS NULL OR jsonb_typeof(p_fronts) <> 'array'
     OR p_terminals IS NULL OR jsonb_typeof(p_terminals) <> 'array'
     OR p_export_expectation IS NULL OR jsonb_typeof(p_export_expectation) <> 'object'
     OR (p_export_expectation ? 'discharge_ports'
         AND jsonb_typeof(p_export_expectation->'discharge_ports') <> 'array')
     OR (p_export_expectation ? 'schedule'
         AND jsonb_typeof(p_export_expectation->'schedule') <> 'object') THEN
    RAISE EXCEPTION 'Payload de escala invalido.' USING ERRCODE = '22023';
  END IF;

  -- A escala física é a linha da viagem; o lock serializa todas as escritas
  -- terminais da mesma escala, mesmo quando ela ainda não tem state próprio.
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_port !~ '^BR[A-Z0-9]{3}$' THEN
    RAISE EXCEPTION 'LOCODE brasileiro invalido: %.', v_port USING ERRCODE = '22023';
  END IF;

  -- ports é a referência FK usada pela escala, não uma lista fechada de lanes.
  -- O seed 307 dá nomes aos portos conhecidos; um LOCODE brasileiro válido
  -- informado pela operação também precisa poder criar a primeira escala.
  -- O lock por código evita duas primeiras escritas criarem linhas duplicadas.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_port, 0));
  SELECT p.id INTO v_port_id
  FROM public.ports AS p
  WHERE upper(btrim(p.locode)) = v_port
    AND upper(btrim(p.locode)) LIKE 'BR%'
  ORDER BY p.id
  LIMIT 1;
  IF v_port_id IS NULL THEN
    INSERT INTO public.ports (name, locode, country)
    VALUES (v_port, v_port, 'Brasil')
    RETURNING id INTO v_port_id;
  END IF;

  SELECT rs.revision
  INTO v_current_revision
  FROM public.voyage_escala_revision_state AS rs
  WHERE rs.voyage_id = p_voyage_id AND rs.port = v_port
  FOR UPDATE;
  IF NOT FOUND THEN
    v_current_revision := 0;
  END IF;
  IF p_expected_revision <> v_current_revision THEN
    RAISE EXCEPTION 'REVISAO_OBSOLETA: esperada %, atual %.', p_expected_revision, v_current_revision
      USING ERRCODE = 'P0001';
  END IF;
  v_next_revision := v_current_revision + 1;

  -- A declaração de exportação usa esta RPC para manter a mesma proteção de
  -- revisão, mas perfis operacionais já existentes não podem ganhar poder de
  -- trocar terminal/data só por passarem pelo caminho transacional. Eles
  -- podem alterar a expectativa exportadora; qualquer mudança de state físico
  -- continua exclusiva de Operações/Admin.
  IF v_role NOT IN ('admin', 'administrativo', 'operacoes') AND (
    EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      LEFT JOIN public.voyage_escala_operation_fronts AS old_f
        ON old_f.voyage_id = p_voyage_id AND old_f.port = v_port
       AND old_f.sentido = lower(btrim(f.sentido))
       AND old_f.modalidade = lower(btrim(f.modalidade))
      WHERE f.terminal_id IS DISTINCT FROM old_f.terminal_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.voyage_escala_operation_fronts AS old_f
      WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
        AND old_f.terminal_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
          WHERE lower(btrim(f.sentido)) = old_f.sentido
            AND lower(btrim(f.modalidade)) = old_f.modalidade
        )
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_terminals) AS t(terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER)
      LEFT JOIN public.voyage_escala_terminal_state AS old_t
        ON old_t.voyage_id = p_voyage_id AND old_t.port = v_port AND old_t.terminal_id = t.terminal_id
      WHERE old_t.terminal_id IS NULL
         OR old_t.terminal_atb IS DISTINCT FROM t.terminal_atb
         OR old_t.terminal_atd IS DISTINCT FROM t.terminal_atd
         OR old_t.terminal_rtw IS DISTINCT FROM t.terminal_rtw
    )
    OR EXISTS (
      SELECT 1
      FROM public.voyage_escala_terminal_state AS old_t
      WHERE old_t.voyage_id = p_voyage_id AND old_t.port = v_port
        AND old_t.terminal_id IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(p_terminals) AS t(terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER)
          WHERE t.terminal_id = old_t.terminal_id
        )
    )
  ) THEN
    RAISE EXCEPTION 'Somente Operações/Admin podem editar terminais da escala.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    GROUP BY lower(btrim(sentido)), lower(btrim(modalidade))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Frente duplicada na escala.' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_terminals) AS t(terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER)
    GROUP BY terminal_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Terminal duplicado no estado da escala.' USING ERRCODE = '23505';
  END IF;

  FOR v_front IN
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
  LOOP
    IF NOT (
      (v_front.sentido = 'importacao' AND v_front.modalidade IN ('carga_cheia', 'carga_solta', 'vazio', 'veiculo'))
      OR (v_front.sentido = 'exportacao' AND v_front.modalidade IN ('granito', 'vazio'))
    ) THEN
      RAISE EXCEPTION 'Frente %/% invalida.', v_front.sentido, v_front.modalidade USING ERRCODE = '23514';
    END IF;
    IF (v_front.sentido = 'importacao' AND v_front.source <> 'operational_data')
       OR (v_front.sentido = 'exportacao' AND v_front.source <> 'export_declaration') THEN
      RAISE EXCEPTION 'Fonte invalida para a frente %/%.', v_front.sentido, v_front.modalidade USING ERRCODE = '23514';
    END IF;

    IF v_front.terminal_id IS NOT NULL THEN
      SELECT d.id, d.code, d.name, d.active, d.tipo, d.port_id
      INTO v_depot
      FROM public.depots AS d
      WHERE d.id = v_front.terminal_id AND d.port_id = v_port_id
        AND d.tipo = 'terminal_portuario';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Terminal nao pertence ao porto % ou nao e terminal portuario.', v_port
          USING ERRCODE = '23514';
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.voyage_escala_terminal_state AS s
        WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_front.terminal_id
      ) INTO v_existing_terminal_state;
      SELECT EXISTS (
        SELECT 1 FROM public.voyage_escala_operation_fronts AS old_f
        WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
          AND old_f.sentido = v_front.sentido
          AND old_f.modalidade = v_front.modalidade
          AND old_f.terminal_id = v_front.terminal_id
      ) INTO v_current_terminal_assignment;
      -- Histórico pode continuar apontando para terminal inativo; uma nova
      -- atribuição só aceita cadastro ativo.
      IF NOT v_current_terminal_assignment AND NOT v_depot.active THEN
        RAISE EXCEPTION 'Terminal inativo % nao pode receber nova atribuicao.', v_depot.code
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_fronts) AS f(
      sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT
    )
    WHERE f.terminal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_terminals) AS t(
          terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER
        )
        WHERE t.terminal_id = f.terminal_id
      )
  ) THEN
    RAISE EXCEPTION 'Frente atribuida exige terminal no estado da escala.'
      USING ERRCODE = '23514';
  END IF;

  FOR v_terminal IN
    SELECT t.terminal_id, t.terminal_atb, t.terminal_atd, t.terminal_rtw
    FROM jsonb_to_recordset(p_terminals) AS t(
      terminal_id UUID,
      terminal_atb TIMESTAMPTZ,
      terminal_atd TIMESTAMPTZ,
      terminal_rtw INTEGER
    )
  LOOP
    SELECT d.id, d.code, d.name, d.active, d.tipo, d.port_id
    INTO v_depot
    FROM public.depots AS d
    WHERE d.id = v_terminal.terminal_id AND d.port_id = v_port_id
      AND d.tipo = 'terminal_portuario';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Terminal de estado nao pertence ao porto %.', v_port USING ERRCODE = '23514';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.voyage_escala_terminal_state AS s
      WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_terminal.terminal_id
    ) INTO v_existing_terminal_state;
    IF NOT v_existing_terminal_state AND NOT v_depot.active THEN
      RAISE EXCEPTION 'Terminal inativo % nao pode receber novo estado.', v_depot.code
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      WHERE f.terminal_id = v_terminal.terminal_id
    ) AND NOT v_existing_terminal_state THEN
      RAISE EXCEPTION 'Estado informado para terminal sem frente atribuida.' USING ERRCODE = '23514';
    END IF;
    IF v_terminal.terminal_atd IS NOT NULL
       AND (v_terminal.terminal_atb IS NULL OR v_terminal.terminal_atd < v_terminal.terminal_atb) THEN
      RAISE EXCEPTION 'terminal_atd < terminal_atb para o terminal %.', v_depot.code
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF COALESCE(p_export_expectation->>'existing_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    v_export_existing_id := (p_export_expectation->>'existing_id')::UUID;
  END IF;
  SELECT COALESCE(ves.tem_exportacao, FALSE), COALESCE(ves.has_granite, FALSE), COALESCE(ves.has_empty, FALSE),
         ves.containers_qty, ves.movements_qty, COALESCE(ves.discharge_ports, '{}'::TEXT[]),
         ves.ce_status, COALESCE(ves.linked, FALSE)
  INTO v_old_export_declared, v_old_export_granite, v_old_export_empty,
       v_old_export_containers_qty, v_old_export_movements_qty, v_old_export_discharge_ports,
       v_old_export_ce_status, v_old_export_linked
  FROM public.voyage_export_schedules AS ves
  WHERE ves.id = v_export_existing_id AND ves.voyage_id = p_voyage_id
  FOR UPDATE;
  v_export_existing_id_found := FOUND;
  IF NOT v_export_existing_id_found THEN
    SELECT COALESCE(ves.tem_exportacao, FALSE), COALESCE(ves.has_granite, FALSE), COALESCE(ves.has_empty, FALSE),
           ves.containers_qty, ves.movements_qty, COALESCE(ves.discharge_ports, '{}'::TEXT[]),
           ves.ce_status, COALESCE(ves.linked, FALSE)
    INTO v_old_export_declared, v_old_export_granite, v_old_export_empty,
         v_old_export_containers_qty, v_old_export_movements_qty, v_old_export_discharge_ports,
         v_old_export_ce_status, v_old_export_linked
    FROM public.voyage_export_schedules AS ves
    WHERE ves.voyage_id = p_voyage_id AND ves.pol = v_port
    FOR UPDATE;
  END IF;
  v_old_export_exists := FOUND;
  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'granito' THEN
    v_export_granite := COALESCE((p_export_expectation->>'granito')::BOOLEAN, FALSE);
  ELSE
    v_export_granite := EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'granito'
    );
  END IF;
  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'has_empty' THEN
    v_export_empty := COALESCE((p_export_expectation->>'has_empty')::BOOLEAN, FALSE);
  ELSIF COALESCE(p_export_expectation, '{}'::JSONB) ? 'vazios' THEN
    v_export_empty := COALESCE((p_export_expectation->>'vazios')::BOOLEAN, FALSE);
  ELSE
    v_export_empty := EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'vazio'
    );
  END IF;
  IF (COALESCE(p_export_expectation, '{}'::JSONB) ? 'has_empty')
     AND (COALESCE(p_export_expectation, '{}'::JSONB) ? 'vazios')
     AND COALESCE((p_export_expectation->>'has_empty')::BOOLEAN, FALSE)
         IS DISTINCT FROM COALESCE((p_export_expectation->>'vazios')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Expectativas de vazios divergentes.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'tem_exportacao' THEN
    v_export_declared := COALESCE((p_export_expectation->>'tem_exportacao')::BOOLEAN, FALSE);
    IF NOT v_export_declared AND (v_export_granite OR v_export_empty) THEN
      RAISE EXCEPTION 'Expectativa de exportacao desligada com frente declarada.' USING ERRCODE = '23514';
    END IF;
    IF v_export_declared AND NOT (v_export_granite OR v_export_empty)
       AND NOT (v_old_export_exists AND v_old_export_declared
                AND NOT v_old_export_granite AND NOT v_old_export_empty) THEN
      RAISE EXCEPTION 'Nova expectativa de exportacao exige granito ou vazios.' USING ERRCODE = '23514';
    END IF;
  ELSE
    v_export_declared := v_export_granite OR v_export_empty;
  END IF;

  v_export_containers_qty := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'containers_qty'
      THEN (p_export_expectation->>'containers_qty')::INTEGER
    ELSE v_old_export_containers_qty
  END;
  v_export_movements_qty := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'movements_qty'
      THEN (p_export_expectation->>'movements_qty')::INTEGER
    ELSE v_old_export_movements_qty
  END;
  v_export_discharge_ports := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'discharge_ports'
      THEN COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(p_export_expectation->'discharge_ports')),
        '{}'::TEXT[]
      )
    ELSE v_old_export_discharge_ports
  END;
  v_export_ce_status := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'ce_status'
      THEN p_export_expectation->>'ce_status'
    ELSE v_old_export_ce_status
  END;
  v_export_linked := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'linked'
      THEN COALESCE((p_export_expectation->>'linked')::BOOLEAN, FALSE)
    ELSE v_old_export_linked
  END;
  IF v_export_granite AND NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'granito'
  ) THEN
    RAISE EXCEPTION 'Expectativa de granito exige a frente exportacao/granito.' USING ERRCODE = '23514';
  END IF;
  IF v_export_empty AND NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'vazio'
  ) THEN
    RAISE EXCEPTION 'Expectativa de vazios exige a frente exportacao/vazio.' USING ERRCODE = '23514';
  END IF;

  v_export_old := jsonb_build_object(
    'tem_exportacao', v_old_export_declared,
    'granito', v_old_export_granite,
    'vazios', v_old_export_empty,
    'has_empty', v_old_export_empty,
    'containers_qty', v_old_export_containers_qty,
    'movements_qty', v_old_export_movements_qty,
    'discharge_ports', v_old_export_discharge_ports,
    'ce_status', v_old_export_ce_status,
    'linked', v_old_export_linked
  );
  v_export_new := jsonb_build_object(
    'tem_exportacao', v_export_declared,
    'granito', v_export_granite,
    'vazios', v_export_empty,
    'has_empty', v_export_empty,
    'containers_qty', v_export_containers_qty,
    'movements_qty', v_export_movements_qty,
    'discharge_ports', v_export_discharge_ports,
    'ce_status', v_export_ce_status,
    'linked', v_export_linked
  );
  -- migration 120: status documental (ce_status, linked) não exige justificativa.
  IF (v_export_old - 'ce_status' - 'linked') IS DISTINCT FROM (v_export_new - 'ce_status' - 'linked') THEN
    v_requires_justification := v_current_revision > 0;
  END IF;

  -- Primeiro compara tudo. Nenhuma escrita, nem de uma frente, acontece
  -- antes de terminar a checagem de ADR fechado.
  FOR v_old_front IN
    SELECT old_f.sentido, old_f.modalidade, old_f.terminal_id, old_f.source
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
  LOOP
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    INTO v_new_front
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    WHERE lower(btrim(f.sentido)) = v_old_front.sentido
      AND lower(btrim(f.modalidade)) = v_old_front.modalidade;
    v_existing_front := FOUND;
    IF NOT v_existing_front THEN
      v_front_changed := TRUE;
    ELSE
      v_front_changed := v_old_front.terminal_id IS DISTINCT FROM v_new_front.terminal_id
        OR v_old_front.source IS DISTINCT FROM v_new_front.source;
    END IF;
    IF v_front_changed THEN
      v_requires_justification := v_current_revision > 0;
      IF v_old_front.terminal_id IS NOT NULL THEN
        SELECT d.code, r.id
        INTO v_terminal_code, v_blocked_report_id
        FROM public.agency_departure_reports AS r
        JOIN public.depots AS d ON d.id = r.terminal_id
        WHERE r.voyage_id = p_voyage_id AND r.port = v_port
          AND r.terminal_id = v_old_front.terminal_id AND r.status = 'closed'
        LIMIT 1;
        IF FOUND THEN
          v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
            'terminal_code', v_terminal_code, 'report_id', v_blocked_report_id,
            'reason', 'front_change'
          ));
        END IF;
      END IF;
    END IF;
  END LOOP;

  FOR v_front IN
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
  LOOP
    SELECT old_f.terminal_id, old_f.source
    INTO v_old_front
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
      AND old_f.sentido = v_front.sentido AND old_f.modalidade = v_front.modalidade;
    v_existing_front := FOUND;
    IF NOT v_existing_front THEN
      v_front_changed := TRUE;
    ELSE
      v_front_changed := v_old_front.terminal_id IS DISTINCT FROM v_front.terminal_id
        OR v_old_front.source IS DISTINCT FROM v_front.source;
    END IF;
    IF v_front_changed AND v_front.terminal_id IS NOT NULL THEN
      SELECT d.code, r.id
      INTO v_terminal_code, v_blocked_report_id
      FROM public.agency_departure_reports AS r
      JOIN public.depots AS d ON d.id = r.terminal_id
      WHERE r.voyage_id = p_voyage_id AND r.port = v_port
        AND r.terminal_id = v_front.terminal_id AND r.status = 'closed'
      LIMIT 1;
      IF FOUND THEN
        v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
          'terminal_code', v_terminal_code, 'report_id', v_blocked_report_id,
          'reason', 'front_change'
        ));
      END IF;
    END IF;
  END LOOP;

  FOR v_terminal IN
    SELECT t.terminal_id, t.terminal_atb, t.terminal_atd, t.terminal_rtw
    FROM jsonb_to_recordset(p_terminals) AS t(
      terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER
    )
  LOOP
    SELECT s.terminal_atb, s.terminal_atd, s.terminal_rtw
    INTO v_old_terminal
    FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_terminal.terminal_id;
    v_existing_terminal_state := FOUND;
    IF NOT v_existing_terminal_state THEN
      v_state_changed := TRUE;
    ELSE
      v_state_changed := v_old_terminal.terminal_atb IS DISTINCT FROM v_terminal.terminal_atb
        OR v_old_terminal.terminal_atd IS DISTINCT FROM v_terminal.terminal_atd
        OR v_old_terminal.terminal_rtw IS DISTINCT FROM v_terminal.terminal_rtw;
    END IF;
    IF v_state_changed THEN
      v_requires_justification := v_current_revision > 0;
      SELECT d.code, r.id
      INTO v_terminal_code, v_blocked_report_id
      FROM public.agency_departure_reports AS r
      JOIN public.depots AS d ON d.id = r.terminal_id
      WHERE r.voyage_id = p_voyage_id AND r.port = v_port
        AND r.terminal_id = v_terminal.terminal_id AND r.status = 'closed'
      LIMIT 1;
      IF FOUND THEN
        v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
          'terminal_code', v_terminal_code, 'report_id', v_blocked_report_id,
          'reason', 'terminal_dates'
        ));
      END IF;
    END IF;
  END LOOP;

  IF v_export_old IS DISTINCT FROM v_export_new AND v_current_revision > 0 THEN
    -- migration 120: ADR fechado continua bloqueando; justificativa só fora do status documental.
    IF (v_export_old - 'ce_status' - 'linked') IS DISTINCT FROM (v_export_new - 'ce_status' - 'linked') THEN
      v_requires_justification := TRUE;
    END IF;
    FOR v_report IN
      SELECT DISTINCT r.id, r.terminal_id, d.code
      FROM public.agency_departure_reports AS r
      JOIN public.depots AS d ON d.id = r.terminal_id
      WHERE r.voyage_id = p_voyage_id AND r.port = v_port AND r.status = 'closed'
        AND r.terminal_id IN (
          SELECT f.terminal_id
          FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
          WHERE f.terminal_id IS NOT NULL
          UNION
          SELECT old_f.terminal_id
          FROM public.voyage_escala_operation_fronts AS old_f
          WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port AND old_f.terminal_id IS NOT NULL
        )
    LOOP
      v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
        'terminal_code', v_report.code, 'report_id', v_report.id,
        'reason', 'export_expectation'
      ));
    END LOOP;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      blocker
      ORDER BY blocker->>'terminal_code', blocker->>'reason', blocker->>'report_id'
    ),
    '[]'::JSONB
  )
  INTO v_closed_blockers
  FROM jsonb_array_elements(v_closed_blockers) AS blockers(blocker);

  IF jsonb_array_length(v_closed_blockers) > 0 THEN
    -- A tentativa bloqueada não escreve nada: a UI recebe o contrato estável
    -- e pode traduzir terminal_code/report_id sem parsear DETAIL.
    RETURN jsonb_build_object(
      'revision', v_current_revision,
      'fronts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'sentido', f.sentido, 'modalidade', f.modalidade,
          'terminal_id', f.terminal_id, 'source', f.source,
          'last_changed_at', f.last_changed_at, 'last_changed_by', f.last_changed_by,
          'revision', f.revision
        ) ORDER BY f.sentido, f.modalidade)
        FROM public.voyage_escala_operation_fronts AS f
        WHERE f.voyage_id = p_voyage_id AND f.port = v_port
      ), '[]'::JSONB),
      'terminals', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'terminal_id', s.terminal_id, 'code', d.code, 'name', d.name,
          'active', d.active, 'port_id', s.port_id,
          'terminal_atb', s.terminal_atb, 'terminal_atd', s.terminal_atd,
          'terminal_rtw', s.terminal_rtw, 'revision', s.revision,
          'report_id', r.id
        ) ORDER BY s.terminal_atb NULLS LAST, d.code)
        FROM public.voyage_escala_terminal_state AS s
        JOIN public.depots AS d ON d.id = s.terminal_id
        LEFT JOIN public.agency_departure_reports AS r
          ON r.voyage_id = s.voyage_id AND r.port = s.port AND r.terminal_id = s.terminal_id
        WHERE s.voyage_id = p_voyage_id AND s.port = v_port
      ), '[]'::JSONB),
      'closed_blockers', v_closed_blockers,
      'blocked', TRUE
    );
  END IF;
  IF v_requires_justification AND NULLIF(btrim(COALESCE(p_justification, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para alterar estado terminalizado existente.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.voyage_escala_revision_state (voyage_id, port, port_id, revision)
  VALUES (p_voyage_id, v_port, v_port_id, 0)
  ON CONFLICT (voyage_id, port) DO NOTHING;

  -- O conjunto recebido representa todos os terminais ainda atribuídos a
  -- frentes. Remover os ausentes evita que ATB/ATD órfãos continuem visíveis
  -- no Line-Up e que a FK contra depots impeça a limpeza do terminal.
  FOR v_old_terminal IN
    SELECT s.*
    FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port
      AND s.terminal_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_terminals) AS t(terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER)
        WHERE t.terminal_id = s.terminal_id
      )
  LOOP
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification, actor_role, actor_department
    )
    VALUES (
      'voyage_pod_schedule', v_entity_id, 'terminal_state_removed',
      jsonb_build_object(
        'terminal_id', v_old_terminal.terminal_id,
        'terminal_atb', v_old_terminal.terminal_atb,
        'terminal_atd', v_old_terminal.terminal_atd,
        'terminal_rtw', v_old_terminal.terminal_rtw
      )::TEXT,
      NULL, auth.uid(), clock_timestamp(), p_justification, v_role, v_department
    );
    DELETE FROM public.voyage_escala_terminal_state
    WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id = v_old_terminal.terminal_id;
  END LOOP;

  UPDATE public.voyage_escala_revision_state
  SET revision = v_next_revision, updated_at = now()
  WHERE voyage_id = p_voyage_id AND port = v_port;

  UPDATE public.voyage_escala_terminal_state
  SET revision = v_next_revision, updated_at = now()
  WHERE voyage_id = p_voyage_id AND port = v_port;

  FOR v_terminal IN
    SELECT t.terminal_id, t.terminal_atb, t.terminal_atd, t.terminal_rtw
    FROM jsonb_to_recordset(p_terminals) AS t(
      terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER
    )
  LOOP
    SELECT s.terminal_atb, s.terminal_atd, s.terminal_rtw
    INTO v_old_terminal
    FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_terminal.terminal_id;
    v_existing_terminal_state := FOUND;
    INSERT INTO public.voyage_escala_terminal_state (
      voyage_id, port, port_id, terminal_id, terminal_atb, terminal_atd, terminal_rtw, revision
    )
    VALUES (
      p_voyage_id, v_port, v_port_id, v_terminal.terminal_id,
      v_terminal.terminal_atb, v_terminal.terminal_atd, v_terminal.terminal_rtw, v_next_revision
    )
    ON CONFLICT (voyage_id, port, terminal_id) DO UPDATE SET
      port_id = EXCLUDED.port_id,
      terminal_atb = EXCLUDED.terminal_atb,
      terminal_atd = EXCLUDED.terminal_atd,
      terminal_rtw = EXCLUDED.terminal_rtw,
      revision = EXCLUDED.revision,
      updated_at = now();

    IF NOT v_existing_terminal_state THEN
      v_state_changed := TRUE;
    ELSE
      v_state_changed := v_old_terminal.terminal_atb IS DISTINCT FROM v_terminal.terminal_atb
        OR v_old_terminal.terminal_atd IS DISTINCT FROM v_terminal.terminal_atd
        OR v_old_terminal.terminal_rtw IS DISTINCT FROM v_terminal.terminal_rtw;
    END IF;

    IF v_state_changed THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'terminal_dates',
        CASE WHEN v_existing_terminal_state THEN jsonb_build_object(
          'terminal_id', v_terminal.terminal_id,
          'terminal_atb', v_old_terminal.terminal_atb,
          'terminal_atd', v_old_terminal.terminal_atd,
          'terminal_rtw', v_old_terminal.terminal_rtw
        )::TEXT ELSE NULL END,
        jsonb_build_object(
          'terminal_id', v_terminal.terminal_id,
          'terminal_atb', v_terminal.terminal_atb,
          'terminal_atd', v_terminal.terminal_atd,
          'terminal_rtw', v_terminal.terminal_rtw
        )::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    END IF;
  END LOOP;

  FOR v_old_front IN
    SELECT old_f.*
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
        WHERE lower(btrim(f.sentido)) = old_f.sentido
          AND lower(btrim(f.modalidade)) = old_f.modalidade
      )
  LOOP
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification, actor_role, actor_department
    )
    VALUES (
      'voyage_pod_schedule', v_entity_id, 'front_removed', to_jsonb(v_old_front)::TEXT, NULL,
      auth.uid(), clock_timestamp(), p_justification, v_role, v_department
    );
    DELETE FROM public.voyage_escala_operation_fronts WHERE id = v_old_front.id;
  END LOOP;

  FOR v_front IN
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
  LOOP
    SELECT old_f.*
    INTO v_old_front
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
      AND old_f.sentido = v_front.sentido AND old_f.modalidade = v_front.modalidade;
    v_existing_front := FOUND;

    INSERT INTO public.voyage_escala_operation_fronts (
      voyage_id, port, port_id, sentido, modalidade, terminal_id, source,
      revision, last_changed_at, last_changed_by
    )
    VALUES (
      p_voyage_id, v_port, v_port_id, v_front.sentido, v_front.modalidade,
      v_front.terminal_id, v_front.source, v_next_revision, clock_timestamp(), auth.uid()
    )
    ON CONFLICT (voyage_id, port, sentido, modalidade) DO UPDATE SET
      port_id = EXCLUDED.port_id,
      terminal_id = EXCLUDED.terminal_id,
      source = EXCLUDED.source,
      revision = EXCLUDED.revision,
      last_changed_at = EXCLUDED.last_changed_at,
      last_changed_by = EXCLUDED.last_changed_by,
      updated_at = now();

    IF NOT v_existing_front THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'front_created', NULL,
        jsonb_build_object('sentido', v_front.sentido, 'modalidade', v_front.modalidade,
                           'terminal_id', v_front.terminal_id, 'source', v_front.source)::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    ELSE
      IF v_old_front.terminal_id IS DISTINCT FROM v_front.terminal_id THEN
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'terminal_assignment',
          jsonb_build_object(
            'terminal_id', v_old_front.terminal_id,
            'terminal_code', (SELECT d.code FROM public.depots AS d WHERE d.id = v_old_front.terminal_id)
          )::TEXT,
          jsonb_build_object(
            'terminal_id', v_front.terminal_id,
            'terminal_code', (SELECT d.code FROM public.depots AS d WHERE d.id = v_front.terminal_id)
          )::TEXT,
          auth.uid(), clock_timestamp(), p_justification, v_role, v_department
        );
      END IF;
      IF v_old_front.source IS DISTINCT FROM v_front.source THEN
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'front_source',
          v_old_front.source, v_front.source,
          auth.uid(), clock_timestamp(), p_justification, v_role, v_department
        );
      END IF;
    END IF;
  END LOOP;

  IF p_export_expectation IS NOT NULL OR v_old_export_exists OR v_export_declared THEN
    IF (p_export_expectation IS NOT NULL OR v_export_declared)
       AND (NOT v_old_export_exists OR v_export_old IS DISTINCT FROM v_export_new) THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'export_expectation',
        CASE WHEN v_old_export_exists THEN v_export_old::TEXT ELSE NULL END,
        v_export_new::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    END IF;
    IF v_export_existing_id_found THEN
      SELECT ves.id
      INTO v_export_canonical_id
      FROM public.voyage_export_schedules AS ves
      WHERE ves.voyage_id = p_voyage_id
        AND ves.pol = v_port
        AND ves.id <> v_export_existing_id
      FOR UPDATE;
      IF FOUND THEN
        UPDATE public.voyage_export_schedules
        SET tem_exportacao = v_export_declared,
            has_granite = v_export_granite,
            has_empty = v_export_empty,
            containers_qty = v_export_containers_qty,
            movements_qty = v_export_movements_qty,
            discharge_ports = v_export_discharge_ports,
            ce_status = v_export_ce_status,
            linked = v_export_linked,
            updated_at = now()
        WHERE id = v_export_canonical_id AND voyage_id = p_voyage_id;
        DELETE FROM public.voyage_export_schedules
        WHERE id = v_export_existing_id AND voyage_id = p_voyage_id;
      ELSE
        UPDATE public.voyage_export_schedules
        SET pol = v_port,
            tem_exportacao = v_export_declared,
            has_granite = v_export_granite,
            has_empty = v_export_empty,
            containers_qty = v_export_containers_qty,
            movements_qty = v_export_movements_qty,
            discharge_ports = v_export_discharge_ports,
            ce_status = v_export_ce_status,
            linked = v_export_linked,
            updated_at = now()
        WHERE id = v_export_existing_id AND voyage_id = p_voyage_id;
      END IF;
    ELSE
      INSERT INTO public.voyage_export_schedules (
        voyage_id, pol, tem_exportacao, has_granite, has_empty,
        containers_qty, movements_qty, discharge_ports, ce_status, linked, updated_at
      )
      VALUES (
        p_voyage_id, v_port, v_export_declared, v_export_granite, v_export_empty,
        v_export_containers_qty, v_export_movements_qty, v_export_discharge_ports,
        v_export_ce_status, v_export_linked, now()
      )
      ON CONFLICT (voyage_id, pol) DO UPDATE SET
        tem_exportacao = EXCLUDED.tem_exportacao,
        has_granite = EXCLUDED.has_granite,
        has_empty = EXCLUDED.has_empty,
        containers_qty = EXCLUDED.containers_qty,
        movements_qty = EXCLUDED.movements_qty,
        discharge_ports = EXCLUDED.discharge_ports,
        ce_status = EXCLUDED.ce_status,
        linked = EXCLUDED.linked,
        updated_at = now();
    END IF;
  END IF;

  -- O editor terminalizado envia também o snapshot dos campos do POD. Como
  -- esta função já segura o lock da escala, os audit rows são gravados na
  -- mesma transação das frentes, evitando o estado parcial antigo (frentes
  -- salvas, datas do POD falhando em uma segunda chamada).
  v_schedule := p_export_expectation->'schedule';
  IF v_schedule IS NOT NULL THEN
    v_schedule_entity_id := p_voyage_id::TEXT || '::' || v_port;
    FOREACH v_schedule_field IN ARRAY ARRAY[
      'eta', 'etb', 'ata', 'atb', 'etd', 'atd', 'rtw', 'ces',
      'linked', 'escala_number', 'tem_importacao', 'deleted'
    ] LOOP
      IF v_schedule ? v_schedule_field THEN
        SELECT al.new_value
        INTO v_schedule_old_value
        FROM public.audit_logs AS al
        WHERE al.entity_type = 'voyage_pod_schedule'
          AND al.entity_id = v_schedule_entity_id
          AND al.field_name = v_schedule_field
        ORDER BY al.changed_at DESC, al.id DESC
        LIMIT 1;
        v_schedule_new_value := CASE
          WHEN v_schedule->v_schedule_field IS NULL OR v_schedule->v_schedule_field = 'null'::JSONB THEN NULL
          ELSE v_schedule->>v_schedule_field
        END;
        -- O editor sempre envia deleted=false para retirar um soft-delete,
        -- mas isso não deve gerar uma linha de auditoria em cada salvamento.
        IF v_schedule_field = 'deleted'
           AND v_schedule_new_value = 'false'
           AND v_schedule_old_value IS DISTINCT FROM 'true' THEN
          CONTINUE;
        END IF;
        IF v_schedule_field = 'ces'
           AND v_schedule_old_value IS NULL
           AND v_schedule_new_value IN ('waiting', 'missing') THEN
          CONTINUE;
        END IF;
        IF v_schedule_old_value IS DISTINCT FROM v_schedule_new_value THEN
          INSERT INTO public.audit_logs (
            entity_type, entity_id, field_name, old_value, new_value,
            changed_by, changed_at, justification, actor_role, actor_department
          )
          VALUES (
            'voyage_pod_schedule', v_schedule_entity_id, v_schedule_field,
            v_schedule_old_value, v_schedule_new_value,
            auth.uid(), clock_timestamp(), p_justification, v_role, v_department
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- O caminho terminalizado já gravou o ATD na mesma transação. Recalcula o
  -- status da viagem aqui para manter o contrato do save legado sem uma
  -- segunda chamada sujeita a observar um snapshot parcial.
  IF v_schedule ? 'atd' THEN
    WITH pod_entities AS (
      SELECT DISTINCT al.entity_id
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
    ), latest_atd AS (
      SELECT DISTINCT ON (al.entity_id) al.entity_id, NULLIF(btrim(al.new_value), '') AS atd
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND al.field_name = 'atd'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
      ORDER BY al.entity_id, al.changed_at DESC, al.id DESC
    ), latest_omitted AS (
      SELECT DISTINCT ON (al.entity_id) al.entity_id, al.new_value
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND al.field_name = 'omitted'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
      ORDER BY al.entity_id, al.changed_at DESC, al.id DESC
    ), latest_deleted AS (
      SELECT DISTINCT ON (al.entity_id) al.entity_id, al.new_value
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND al.field_name = 'deleted'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
      ORDER BY al.entity_id, al.changed_at DESC, al.id DESC
    ), active AS (
      SELECT e.entity_id, a.atd
      FROM pod_entities AS e
      LEFT JOIN latest_atd AS a ON a.entity_id = e.entity_id
      LEFT JOIN latest_omitted AS o ON o.entity_id = e.entity_id
      LEFT JOIN latest_deleted AS d ON d.entity_id = e.entity_id
      WHERE COALESCE(o.new_value, 'false') <> 'true'
        AND COALESCE(d.new_value, 'false') <> 'true'
    )
    SELECT COUNT(*)::INTEGER, COUNT(*) FILTER (WHERE NULLIF(btrim(atd), '') IS NULL)::INTEGER
    INTO v_active_pods, v_pending_pods
    FROM active;

    IF v_active_pods > 0 THEN
      v_new_voyage_status := CASE WHEN v_pending_pods = 0 THEN 'completed' ELSE 'active' END;
      UPDATE public.voyages
      SET status = v_new_voyage_status
      WHERE id = p_voyage_id
        AND status <> 'cancelled'
        AND status IS DISTINCT FROM v_new_voyage_status;
    END IF;
  END IF;

  -- A primeira frente cria/reutiliza o ADR do terminal. Um ADR aberto sem
  -- frentes é o único que pode ser removido; ADR fechado fica preservado.
  FOR v_depot IN
    SELECT DISTINCT f.terminal_id, d.code, d.name, d.port_id
    FROM public.voyage_escala_operation_fronts AS f
    JOIN public.depots AS d ON d.id = f.terminal_id
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port AND f.terminal_id IS NOT NULL
  LOOP
    SELECT r.id, r.status INTO v_report_id, v_report_status
    FROM public.agency_departure_reports AS r
    WHERE r.voyage_id = p_voyage_id AND r.port = v_port AND r.terminal_id = v_depot.terminal_id
    FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.agency_departure_reports (
        voyage_id, port, terminal, terminal_id, terminal_port_id
      )
      VALUES (p_voyage_id, v_port, v_depot.code, v_depot.terminal_id, v_depot.port_id)
      ON CONFLICT (voyage_id, port, terminal_id) WHERE terminal_id IS NOT NULL
      DO UPDATE SET terminal = EXCLUDED.terminal
      RETURNING id INTO v_report_id;
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'adr_created', NULL,
        jsonb_build_object('terminal_code', v_depot.code, 'report_id', v_report_id)::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    END IF;
  END LOOP;

  FOR v_report IN
    SELECT r.id, r.terminal_id, r.status, d.code
    FROM public.agency_departure_reports AS r
    JOIN public.depots AS d ON d.id = r.terminal_id
    WHERE r.voyage_id = p_voyage_id AND r.port = v_port
      AND r.terminal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.voyage_escala_operation_fronts AS f
        WHERE f.voyage_id = p_voyage_id AND f.port = v_port
          AND f.terminal_id = r.terminal_id
      )
    FOR UPDATE OF r
  LOOP
    IF v_report.status = 'open' THEN
      -- Um ADR aberto só pode ser removido quando não há filhos, histórico ou
      -- alertas associados. Qualquer alerta do ADR, em qualquer status, preserva
      -- o registro para não perder o histórico operacional.
      IF NOT EXISTS (
        SELECT 1
        FROM public.agency_departure_report_signoffs
        WHERE report_id = v_report.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.agency_departure_report_department_signoffs
        WHERE report_id = v_report.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.agency_departure_report_occurrences
        WHERE report_id = v_report.id
      )
       AND NOT EXISTS (
         SELECT 1
         FROM public.audit_logs AS al
         -- Eventos do ciclo do ADR usam o próprio report_id como entity_id.
         -- O índice idx_audit_logs_entity_id torna esta guarda pontual; não
         -- faça ILIKE sobre old_value/new_value dentro do lock da escala.
         WHERE al.entity_id = v_report.id::TEXT
       )
      AND NOT EXISTS (
        SELECT 1
        FROM public.alerts AS a
        WHERE a.entity_type = 'agency_departure_report'
          AND a.entity_id LIKE public.agency_report_alert_entity_prefix(p_voyage_id, v_port, v_report.code) || '%'
      ) THEN
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'adr_removed',
          jsonb_build_object('terminal_code', v_report.code, 'report_id', v_report.id)::TEXT,
          NULL, auth.uid(), clock_timestamp(), p_justification, v_role, v_department
        );
        DELETE FROM public.agency_departure_reports
        WHERE id = v_report.id AND status = 'open';
      ELSE
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'adr_preserved',
          jsonb_build_object('terminal_code', v_report.code, 'report_id', v_report.id)::TEXT,
          'dependentes ou historico preservados', auth.uid(), clock_timestamp(),
          p_justification, v_role, v_department
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'revision', v_next_revision,
    'fronts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sentido', f.sentido, 'modalidade', f.modalidade,
        'terminal_id', f.terminal_id, 'source', f.source,
        'last_changed_at', f.last_changed_at, 'last_changed_by', f.last_changed_by,
        'revision', f.revision
      ) ORDER BY f.sentido, f.modalidade)
      FROM public.voyage_escala_operation_fronts AS f
      WHERE f.voyage_id = p_voyage_id AND f.port = v_port
    ), '[]'::JSONB),
    'terminals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'terminal_id', s.terminal_id, 'code', d.code, 'name', d.name,
        'active', d.active, 'port_id', s.port_id,
        'terminal_atb', s.terminal_atb, 'terminal_atd', s.terminal_atd,
        'terminal_rtw', s.terminal_rtw, 'revision', s.revision,
        'report_id', r.id
      ) ORDER BY s.terminal_atb NULLS LAST, d.code)
      FROM public.voyage_escala_terminal_state AS s
      JOIN public.depots AS d ON d.id = s.terminal_id
      LEFT JOIN public.agency_departure_reports AS r
        ON r.voyage_id = s.voyage_id AND r.port = s.port AND r.terminal_id = s.terminal_id
      WHERE s.voyage_id = p_voyage_id AND s.port = v_port
    ), '[]'::JSONB),
    'closed_blockers', '[]'::JSONB,
    'blocked', FALSE
  );
END;
$_$;
