-- 049: o RPC terminalizado precisa persistir também a linha física da escala.
--
-- O editor de escala envia frentes, Atracações e os campos POD no mesmo
-- payload. A versão anterior delegava a chamada à função terminalizada
-- histórica; em bancos que ainda tinham o corpo anterior ao snapshot POD, a
-- transação terminava com sucesso mas descartava ETA/ATA e os demais campos
-- da escala. O wrapper preserva o comportamento anterior e garante a parte
-- que faltava na mesma transação.

DO $$
BEGIN
  IF to_regprocedure('public.save_voyage_escala_terminal_state_v2_legacy_049(bigint,text,integer,jsonb,jsonb,jsonb,text)') IS NULL THEN
    IF to_regprocedure('public.save_voyage_escala_terminal_state_v2(bigint,text,integer,jsonb,jsonb,jsonb,text)') IS NULL THEN
      RAISE EXCEPTION 'Migration 049 requer a função pública de persistência da escala.';
    END IF;

    ALTER FUNCTION public.save_voyage_escala_terminal_state_v2(
      BIGINT, TEXT, INTEGER, JSONB, JSONB, JSONB, TEXT
    ) RENAME TO save_voyage_escala_terminal_state_v2_legacy_049;
  END IF;

  IF to_regprocedure('public.save_voyage_escala_terminal_state_v2_legacy_049(bigint,text,integer,jsonb,jsonb,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'Migration 049 não conseguiu preservar o corpo legado da persistência da escala.';
  END IF;

  EXECUTE 'REVOKE ALL ON FUNCTION public.save_voyage_escala_terminal_state_v2_legacy_049(bigint,text,integer,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated';
END
$$;

-- O corpo preservado só é chamado pelo wrapper abaixo; não deve continuar
-- sendo uma segunda superfície pública de escrita.
CREATE OR REPLACE FUNCTION public.save_voyage_escala_terminal_state_v2(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_expected_revision INTEGER,
  p_fronts JSONB,
  p_terminals JSONB,
  p_export_expectation JSONB,
  p_justification TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result JSONB;
  v_schedule JSONB;
  v_schedule_entity_id TEXT;
  v_schedule_field TEXT;
  v_schedule_old_value TEXT;
  v_schedule_new_value TEXT;
  v_role TEXT;
  v_department TEXT;
BEGIN
  -- A guarda permanece na fronteira pública mesmo quando o corpo histórico
  -- for substituído. Não ler payload nem delegar antes da autorização.
  SELECT up.role INTO v_role
  FROM public.user_profiles AS up
  WHERE up.id = auth.uid() AND up.active = TRUE;

  IF auth.uid() IS NULL OR v_role IS NULL
     OR v_role NOT IN (
       'admin', 'administrativo', 'operacoes', 'operator',
       'documentacao', 'equipamentos', 'financeiro'
     ) THEN
    RAISE EXCEPTION 'Usuario ativo sem permissao para editar a escala.'
      USING ERRCODE = '42501';
  END IF;

  IF p_export_expectation IS NULL
     OR jsonb_typeof(p_export_expectation) <> 'object'
     OR (p_export_expectation ? 'schedule'
         AND jsonb_typeof(p_export_expectation->'schedule') <> 'object') THEN
    RAISE EXCEPTION 'Payload de escala invalido.' USING ERRCODE = '22023';
  END IF;

  v_department := CASE
    WHEN v_role IN ('admin', 'administrativo') THEN 'administrativo'
    WHEN v_role = 'documentacao' THEN 'documentacao'
    WHEN v_role = 'equipamentos' THEN 'equipamentos'
    ELSE 'operacoes'
  END;

  -- O corpo anterior continua dono de revisão, lock, frentes, terminais,
  -- exportação, ADR e status. Como função e wrapper rodam na mesma transação,
  -- as auditorias abaixo ficam sob o mesmo lock da escala.
  v_result := public.save_voyage_escala_terminal_state_v2_legacy_049(
    p_voyage_id,
    p_port,
    p_expected_revision,
    p_fronts,
    p_terminals,
    p_export_expectation,
    p_justification
  );

  -- ADR fechado significa no-op completo. Não completar o payload físico
  -- depois que o corpo anterior devolveu um bloqueio.
  IF COALESCE((v_result->>'blocked')::BOOLEAN, FALSE) THEN
    RETURN v_result;
  END IF;

  v_schedule := p_export_expectation->'schedule';
  IF v_schedule IS NOT NULL THEN
    v_schedule_entity_id := p_voyage_id::TEXT || '::' || upper(btrim(COALESCE(p_port, '')));

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
          WHEN v_schedule->v_schedule_field IS NULL
               OR v_schedule->v_schedule_field = 'null'::JSONB THEN NULL
          ELSE v_schedule->>v_schedule_field
        END;

        -- O editor sempre envia deleted=false para retirar um soft-delete,
        -- mas isso não deve gerar auditoria a cada salvamento.
        IF v_schedule_field = 'deleted'
           AND v_schedule_new_value = 'false'
           AND v_schedule_old_value IS DISTINCT FROM 'true' THEN
          CONTINUE;
        END IF;
        -- Aguardando é o estado inicial do editor, não uma alteração humana.
        IF v_schedule_field = 'ces'
           AND v_schedule_old_value IS NULL
           AND v_schedule_new_value IN ('waiting', 'missing') THEN
          CONTINUE;
        END IF;

        -- A função histórica pode já ter gravado o snapshot. Comparar com o
        -- último valor torna o reparo idempotente e evita auditorias duplicadas.
        IF v_schedule_old_value IS DISTINCT FROM v_schedule_new_value THEN
          INSERT INTO public.audit_logs (
            entity_type,
            entity_id,
            field_name,
            old_value,
            new_value,
            changed_by,
            changed_at,
            justification,
            actor_role,
            actor_department
          )
          VALUES (
            'voyage_pod_schedule',
            v_schedule_entity_id,
            v_schedule_field,
            v_schedule_old_value,
            v_schedule_new_value,
            auth.uid(),
            clock_timestamp(),
            p_justification,
            v_role,
            v_department
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_voyage_escala_terminal_state_v2(
  BIGINT, TEXT, INTEGER, JSONB, JSONB, JSONB, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_voyage_escala_terminal_state_v2(
  BIGINT, TEXT, INTEGER, JSONB, JSONB, JSONB, TEXT
) TO authenticated;
