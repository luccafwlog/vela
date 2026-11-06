-- 604: o Histórico de ações deixa de gravar as colunas técnicas.
--
-- Decisão do dono de 2026-11-06 (docs/archive/plans/2026-11-06-administracao-revisada.md,
-- etapa 3; diagnóstico em docs/archive/audits/administracao-2026-11-06.md): 4.496
-- das 21.000 linhas de `audit_logs` eram colunas que ninguém lê no histórico e que a
-- tela mostrava como "B/L alterado".
--
-- Mudança: `audit_row_changes` (corpo da 559) não grava, na edição, as colunas
-- `updated_at`, `updated_by`, `charges_calculated_at`, `batch_id`,
-- `ownership_source`, `profile_source`, `pix_payload` e `email_normalized`, em
-- toda tabela menos `voyages`. Nenhum leitor usa essas linhas: o Histórico do B/L
-- (`bl_timeline`) lê uma lista fechada de campos de `bls`, e a ficha do Cliente não
-- lê essas colunas. Criação e exclusão continuam gravando o registro inteiro em JSON.
--
-- `voyages` fica de fora de propósito: os gatilhos de `audit_logs`
-- `reconcile_voyage_operation_alerts_on_audit` reconciliam os alertas da Viagem a
-- cada linha dela, e a troca do retrato das escalas (`pol_schedule_snapshot`,
-- `pod_schedule_snapshot`), que só muda pelo gatilho da escala, é o sinal que fecha
-- "B/Ls esperados" quando o ETD sai do planejamento (`alertasFechamNaHora`).
-- ponytail: o histórico serve também de fila de eventos para esses alertas; tirar
-- o retrato da Viagem do histórico pede antes um sinal próprio para a reconciliação.
--
-- Só daqui para a frente: não grava, não reescreve nem apaga linhas existentes (as
-- antigas continuam no Histórico, com nome desde a etapa 1). A linha do gatilho que
-- repete a linha gravada pela função sai na leitura (603), como no Histórico do B/L.
--
-- Rollback: reaplicar `audit_row_changes` da 559.

CREATE OR REPLACE FUNCTION public.audit_row_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_new JSONB := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  v_key_parts TEXT[] := string_to_array(COALESCE(TG_ARGV[0], 'id'), ',');
  v_entity_id TEXT;
  v_field RECORD;
  v_skip text[] := string_to_array(NULLIF(current_setting('vela.audit_skip', true), ''), ',');
  v_token text;
  v_context text := NULLIF(btrim(current_setting('vela.import_context', true)), '');
  -- 404: o B/L da linha, para o Histórico do B/L ler o rastro de containers e
  -- veículos mesmo depois da remoção.
  v_bl_id text := CASE WHEN TG_TABLE_NAME IN ('bl_containers', 'vehicles')
                       THEN COALESCE(v_new ->> 'bl_id', v_old ->> 'bl_id') END;
  -- 559: o motivo escrito numa coluna da própria linha (liberação de
  -- faturamento, revogação, Pix tratado) vale como justificativa quando a
  -- função não passou contexto. Só a coluna gravada nesta operação conta, para
  -- uma edição posterior não herdar um motivo antigo.
  v_row_reason text;
  v_reason_key text;
  -- 604: colunas técnicas, que ninguém lê no histórico e viravam "B/L alterado".
  -- A Viagem fica de fora: as linhas dela disparam a reconciliação dos alertas.
  v_technical text[] := CASE WHEN TG_TABLE_NAME = 'voyages' THEN ARRAY[]::text[]
                             ELSE ARRAY['updated_at', 'updated_by', 'charges_calculated_at', 'batch_id', 'ownership_source',
                                        'profile_source', 'pix_payload', 'email_normalized'] END;
BEGIN
  IF v_context IS NULL AND TG_OP IN ('INSERT', 'UPDATE') THEN
    -- No Pix recebido, `reason` é o motivo de quem cancelou a baixa e o
    -- devolveu à análise (reverse_*_payment); nas outras tabelas `reason` é
    -- classificação do sistema e não entra.
    FOREACH v_reason_key IN ARRAY ARRAY['justification', 'revoke_reason', 'cancel_reason', 'deactivation_reason',
                                         'handled_note', 'revert_justification', 'discount_justification']
                                  || CASE WHEN TG_TABLE_NAME = 'itau_pix_receipts' THEN ARRAY['reason'] ELSE ARRAY[]::text[] END LOOP
      IF NULLIF(btrim(v_new ->> v_reason_key), '') IS NOT NULL
         AND (TG_OP = 'INSERT' OR v_old ->> v_reason_key IS DISTINCT FROM v_new ->> v_reason_key) THEN
        v_row_reason := btrim(v_new ->> v_reason_key);
        EXIT;
      END IF;
    END LOOP;
    v_context := v_row_reason;
  END IF;
  SELECT string_agg(COALESCE(v_new ->> k, v_old ->> k), '/')
    INTO v_entity_id
    FROM unnest(v_key_parts) AS k;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification, bl_id)
    VALUES (TG_TABLE_NAME, v_entity_id, 'criado', v_new::TEXT, auth.uid(), v_context, v_bl_id);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, changed_by, justification, bl_id)
    VALUES (TG_TABLE_NAME, v_entity_id, 'excluido', v_old::TEXT, auth.uid(),
            COALESCE(NULLIF(btrim(current_setting('vela.delete_reason', true)), ''), v_context), v_bl_id);
  ELSE
    FOR v_field IN
      SELECT key, value AS old_value, v_new ->> key AS new_value
      FROM jsonb_each_text(v_old)
      WHERE v_old ->> key IS DISTINCT FROM v_new ->> key
        AND NOT (key = ANY (v_technical))
    LOOP
      v_token := TG_TABLE_NAME || '/' || v_entity_id || '/' || v_field.key;
      IF v_skip IS NOT NULL AND v_token = ANY(v_skip) THEN
        v_skip := array_remove(v_skip, v_token);
        PERFORM set_config('vela.audit_skip', COALESCE(array_to_string(v_skip, ','), ''), true);
        CONTINUE;
      END IF;
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, bl_id)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.old_value, v_field.new_value, auth.uid(), v_context, v_bl_id);
    END LOOP;
    FOR v_field IN
      SELECT key, value AS new_value
      FROM jsonb_each_text(v_new)
      WHERE NOT (v_old ? key)
        AND NOT (key = ANY (v_technical))
    LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification, bl_id)
      VALUES (TG_TABLE_NAME, v_entity_id, v_field.key, v_field.new_value, auth.uid(), v_context, v_bl_id);
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;
