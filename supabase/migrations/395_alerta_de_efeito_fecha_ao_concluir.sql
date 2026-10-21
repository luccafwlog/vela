-- 395: o alerta "Efeito de importação bloqueado" fecha só quando o efeito
-- conclui (decisão do dono do produto no Lote 4 do plano
-- docs/plans/2026-10-21-frente-das-importacoes.md; muda a regra da 348).
--
-- Problema: o gatilho da 348 fechava o item `import_effect_blocked` sempre que
-- o efeito saía de `blocked`, inclusive quando o operador só clicava em
-- Reprocessar (`retry_import_effect`, 252). Um Alerta crítico sumia antes de o
-- problema estar resolvido, e uma nova falha abria outra ocorrência (com nova
-- Notificação Interna), como se fosse outro problema.
--
-- Mudança: a mesma função/gatilho da 348 passa a distinguir o destino.
--   * `succeeded`, ou `superseded` (substituído, ou descartado pela exclusão do
--     B/L ou da Viagem, ADR 0095 decisão 7; não é falha): resolve o item.
--   * qualquer outro status (`retry_wait`, `pending`, `running`): o item
--     continua aberto, com `metadata.reprocessing = true`; a /alertas mostra
--     "Reprocessando…" e desativa o Reprocessar.
--   Se o efeito bloquear de novo, `_record_import_effect_blocked_alert` (394)
--   atualiza o MESMO item ainda ativo (mesma ocorrência, sem nova
--   notificação): a metadata nova não tem `reprocessing`, e o item volta ao
--   estado bloqueado com o novo motivo. O gatilho também passa a disparar
--   quando o efeito sai de um status não-bloqueado para concluído, porque o
--   item pode estar aberto em reprocessamento.
--   Falha ao mexer no Alerta não desfaz a mudança do efeito: vira WARNING.
--
-- Correções do acerto da 394 (revisão do PR #1026; a 394 não é editada):
--   A. O acerto da 394 não descartava efeitos `running` de B/L ou Viagem que
--      já não existem; a recuperação da lease os levava depois a
--      `blocked/effect_domain_missing` com Alerta crítico. Aqui eles saem como
--      `superseded` ("descartado: registro excluído", lease limpa), igual ao
--      caminho da exclusão (`_discard_import_effects_of_deleted`).
--   B. O acerto da 394 moveu para a espera de negócio QUALQUER bloqueado de
--      Taxas Locais/CE cujo B/L estivesse hoje em Revisão ou sem tabela, mesmo
--      quando o bloqueio fora falha técnica (`effect_failed`, `lease_expired`,
--      `retry_exhausted`, `dependency_blocked`...). Antes da 394 a espera de
--      negócio só chegava ao efeito pelos gates de `mark_bl_ready_for_billing`
--      (355): `invalid_effect_payload` (22023: reconciliação, gate de revisão,
--      linhas a revisar) ou `effect_domain_refused` (P0003 sem Cliente, P0004
--      tabela de cobrança incompleta), reconhecíveis pela mensagem. O código
--      sobrescrito pela 394 continua no histórico (`import_effect_attempts`,
--      último `blocked` antes da linha `migration-394`): o efeito que a 394
--      moveu e cuja causa anterior não era uma dessas volta a `blocked` com o
--      código e a mensagem originais, e o Alerta crítico reabre. Sem histórico
--      a recuperar, o efeito fica como a 394 deixou; isso, e o próprio acerto
--      da 394 sobre falhas técnicas (substituído por este), só é aceitável
--      porque o banco de produção tem apenas dados de teste.
--
-- Reescreve linhas existentes (acertos A e B).
-- Depende da afirmação "Data status" do AGENTS.md (seção Gotchas): o banco de
-- produção só tem dados de teste.
-- Rollback: reaplicar a função e o gatilho da 348. Os acertos não têm volta
-- automática; as linhas `migration-395` de `import_effect_attempts` dizem o
-- que foi mudado.

CREATE OR REPLACE FUNCTION public.resolve_import_effect_blocked_alert_on_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  BEGIN
    IF NEW.status IN ('succeeded', 'superseded') THEN
      PERFORM public.resolve_alert_item(
        'import_effect_blocked', 'import_effect', NEW.id::text,
        'import_effect_' || NEW.status,
        jsonb_build_object('effect_id', NEW.id, 'effect_kind', NEW.effect_kind, 'status', NEW.status)
      );
    ELSIF OLD.status = 'blocked' THEN
      -- ponytail: atualização direta da metadata, sem evento `updated` no
      -- histórico do item; o evento de reabertura do efeito fica no audit
      -- de `retry_import_effect`.
      PERFORM set_config('alerts.foundation_internal', 'on', true);
      UPDATE public.alert_items AS i
         SET metadata = i.metadata || jsonb_build_object('reprocessing', true, 'reprocessing_status', NEW.status),
             updated_at = now()
        FROM public.alerts AS a
       WHERE a.id = i.alert_id
         AND a.entity_type = 'import_effect'
         AND a.entity_id = NEW.id::text
         AND i.item_type = 'import_effect_blocked'
         AND i.status = 'active';
      PERFORM set_config('alerts.foundation_internal', 'off', true);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Não foi possível atualizar o alerta do efeito %: %', NEW.id, SQLERRM;
  END;
  PERFORM set_config('alerts.foundation_trigger', 'off', true);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_import_effect_blocked_alert_on_exit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_import_effect_blocked_alert_on_exit ON public.import_pending_effects;
CREATE TRIGGER resolve_import_effect_blocked_alert_on_exit
  AFTER UPDATE OF status ON public.import_pending_effects
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        AND (OLD.status = 'blocked' OR NEW.status IN ('succeeded', 'superseded')))
  EXECUTE FUNCTION public.resolve_import_effect_blocked_alert_on_exit();

-- Acertos A e B (dependem do "Data status").
CREATE OR REPLACE FUNCTION public._import_effect_was_business_wait(p_code text, p_message text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(p_code, '') IN ('invalid_effect_payload', 'effect_domain_refused')
     AND COALESCE(p_message, '') ~* '(gate de revisao|pendencia de revisao|reconciliacao manual|cliente vinculado|Tabela de cobranca incompleta)';
$function$;
REVOKE ALL ON FUNCTION public._import_effect_was_business_wait(text, text) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_row record;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- A. `running` de registro excluído.
  FOR v_row IN
    SELECT e.id, e.attempts
    FROM public.import_pending_effects AS e
    WHERE e.status = 'running'
      AND e.effect_kind IN ('provisional_charges', 'local_billing', 'demurrage_billing', 'vehicle_followup', 'physical_flags')
      AND NOT EXISTS (SELECT 1 FROM public.bls AS b WHERE b.id = e.entity_id)
      AND NOT (e.entity_id ~ '^[0-9]{1,18}$' AND EXISTS (SELECT 1 FROM public.voyages AS v WHERE v.id = e.entity_id::bigint))
  LOOP
    UPDATE public.import_pending_effects
       SET status = 'superseded', lease_until = NULL, leased_by = NULL,
           result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('reason', 'descartado: registro excluído',
             'deleted_kind', 'migration_395', 'previous_status', 'running'),
           last_error_code = 'record_deleted', last_error_message = 'descartado: registro excluído', updated_at = now()
     WHERE id = v_row.id;
    INSERT INTO public.import_effect_attempts(effect_id, attempt_no, event_kind, worker_id, status, error_code, error_message)
    VALUES (v_row.id, GREATEST(v_row.attempts, 1), 'completed', 'migration-395', 'superseded', 'record_deleted', 'descartado: registro excluído');
  END LOOP;

  -- B. Falha técnica que a 394 levou para a espera volta a bloqueada.
  FOR v_row IN
    SELECT e.id, e.attempts, e.effect_kind, e.entity_id, prior.error_code, prior.error_message
    FROM public.import_pending_effects AS e
    JOIN LATERAL (
      SELECT m.id FROM public.import_effect_attempts AS m
      WHERE m.effect_id = e.id AND m.worker_id = 'migration-394' AND m.status = 'retry_wait'
      ORDER BY m.id DESC LIMIT 1
    ) AS moved ON true
    JOIN LATERAL (
      SELECT a.error_code, a.error_message FROM public.import_effect_attempts AS a
      WHERE a.effect_id = e.id AND a.id < moved.id AND a.status = 'blocked'
      ORDER BY a.id DESC LIMIT 1
    ) AS prior ON true
    WHERE e.status = 'retry_wait'
      AND e.last_error_code IN ('awaiting_review', 'awaiting_charge_table')
      AND NOT EXISTS (SELECT 1 FROM public.import_effect_attempts AS later
                      WHERE later.effect_id = e.id AND later.id > moved.id)
      AND NOT public._import_effect_was_business_wait(prior.error_code, prior.error_message)
  LOOP
    UPDATE public.import_pending_effects
       SET status = 'blocked', lease_until = NULL, leased_by = NULL,
           last_error_code = v_row.error_code, last_error_message = v_row.error_message, updated_at = now()
     WHERE id = v_row.id;
    INSERT INTO public.import_effect_attempts(effect_id, attempt_no, event_kind, worker_id, status, error_code, error_message)
    VALUES (v_row.id, GREATEST(v_row.attempts, 1), 'completed', 'migration-395', 'blocked', v_row.error_code, v_row.error_message);
    PERFORM public._record_import_effect_blocked_alert(v_row.id, v_row.effect_kind, v_row.entity_id, v_row.error_code, v_row.error_message);
  END LOOP;

  PERFORM set_config('request.jwt.claim.role', '', true);
END
$$;
