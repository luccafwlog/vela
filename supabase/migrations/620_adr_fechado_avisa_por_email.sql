-- 620: o ADR fechado avisa a equipe por e-mail (decisão D6 do dono de
-- 2026-11-06; ADR 0133, lote 8 do plano 2026-11-06-decisoes-da-revisao-dos-alertas).
--
-- O fechamento do ADR não tinha dono nem aviso (brecha B09). Agora a tela
-- fecha o ADR sozinha quando a terceira equipe assina (o retrato congelado é o
-- que a tela mostra, como no Fechar ADR) e cada fechamento manda um e-mail a
-- todos os usuários internos ativos com o resumo e o link do ADR.
--
-- Mudança no banco:
--   1. Fila `adr_closed_email_outbox`: uma linha por fechamento (relatório e
--      instante do fechamento), gravada pelo gatilho
--      `trg_adr_closed_email_enqueue` quando `agency_departure_reports.status`
--      passa a 'closed'. Reabrir e fechar de novo gera outra linha.
--   2. `adr_closed_email_pending` reserva as linhas (10 min, até 5 tentativas)
--      e devolve o resumo (navio e viagem, porto, terminal, datas, quem
--      assinou e quando, quem fechou) e os destinatários: o e-mail de cada
--      usuário interno ativo (`user_profiles.active`, sem a conta de
--      integração). `adr_closed_email_finish` fecha a linha.
--   3. Tipo de e-mail `adr_fechado` em `portal_email_attempts` (cada envio
--      fica registrado como os demais e-mails do Vela).
--   4. Disparo pelo evento (`ops.kick_edge_job`, 458) da Edge Function
--      `adr-closed-email`, com o segredo `ADR_CLOSED_EMAIL_SECRET`. Sem o
--      segredo no Vault, o disparo não acontece e a linha espera a rotina
--      manual de 5 minutos (ver servicos-externos.md).
--
-- Plano de preservação: a migration não reescreve nem apaga linha existente:
-- cria a fila vazia, troca a restrição `portal_email_attempts_kind_check` por
-- uma que aceita os mesmos tipos (com o `teste_envio` da migration `605`) e mais `adr_fechado` (as linhas existentes
-- continuam válidas e são revalidadas pela restrição nova) e acrescenta
-- funções e gatilhos. ADRs fechados antes dela não entram na fila. Conferir:
-- `SELECT count(*) FROM adr_closed_email_outbox` = 0 logo depois. Desfazer: o
-- rollback abaixo.
--
-- Rollback: remover os gatilhos `trg_adr_closed_email_enqueue` e
-- `trg_kick_adr_closed_email`, as funções `_adr_closed_email_enqueue`,
-- `adr_closed_email_pending` e `adr_closed_email_finish`, a tabela
-- `adr_closed_email_outbox` e a linha 'adr-closed-email' de
-- `ops.edge_job_kicks`; recriar `portal_email_attempts_kind_check` sem
-- `adr_fechado` (só depois de apagar ou migrar as tentativas desse tipo).

BEGIN;

-- 3 --- Tipo de e-mail ------------------------------------------------------
ALTER TABLE public.portal_email_attempts DROP CONSTRAINT IF EXISTS portal_email_attempts_kind_check;
ALTER TABLE public.portal_email_attempts ADD CONSTRAINT portal_email_attempts_kind_check
  CHECK (kind = ANY (ARRAY['convite', 'reenvio', 'recuperacao', 'alteracao_email', 'alerta_critico', 'resumo_diario',
    'contato_bounced_notificacao', 'ce_unlock_notificacao', 'senha_alterada', 'teste_envio', 'adr_fechado']));

-- 1 --- Fila ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adr_closed_email_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.agency_departure_reports(id) ON DELETE CASCADE,
  closed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  claimed_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (report_id, closed_at)
);
COMMENT ON TABLE public.adr_closed_email_outbox IS
  'E-mail "ADR fechado" a todos os usuários internos ativos (620, ADR 0133 D6): uma linha por fechamento.';
ALTER TABLE public.adr_closed_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.adr_closed_email_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.adr_closed_email_outbox TO service_role;
DROP TRIGGER IF EXISTS truncate_requires_confirmation ON public.adr_closed_email_outbox;
CREATE TRIGGER truncate_requires_confirmation BEFORE TRUNCATE ON public.adr_closed_email_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION public.truncate_requires_disposable_confirmation();

CREATE OR REPLACE FUNCTION public._adr_closed_email_enqueue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    INSERT INTO public.adr_closed_email_outbox (report_id, closed_at)
    VALUES (NEW.id, COALESCE(NEW.closed_at, now()))
    ON CONFLICT (report_id, closed_at) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._adr_closed_email_enqueue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_adr_closed_email_enqueue ON public.agency_departure_reports;
CREATE TRIGGER trg_adr_closed_email_enqueue
AFTER UPDATE OF status ON public.agency_departure_reports
FOR EACH ROW EXECUTE FUNCTION public._adr_closed_email_enqueue();

-- 2 --- Leitura e fechamento da fila ----------------------------------------
-- ponytail: reserva fixa de 10 min, como a fila do Desbloqueio (458); a rodada
-- que morre segura as linhas até o prazo vencer.
CREATE OR REPLACE FUNCTION public.adr_closed_email_pending(p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows jsonb;
  v_recipients jsonb;
BEGIN
  WITH claimed AS (
    UPDATE public.adr_closed_email_outbox o
    SET claimed_until = now() + interval '10 minutes', attempts = o.attempts + 1
    WHERE o.id IN (
      SELECT q.id FROM public.adr_closed_email_outbox q
      WHERE q.status = 'pending' AND q.attempts < 5 AND (q.claimed_until IS NULL OR q.claimed_until < now())
      ORDER BY q.id
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
      FOR UPDATE SKIP LOCKED)
    RETURNING o.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'report_id', r.id,
    'voyage_id', r.voyage_id,
    'voyage_label', public._voyage_label(r.voyage_id),
    'port', upper(btrim(r.port)),
    'terminal_code', CASE WHEN r.terminal_id IS NULL THEN NULL ELSE public.voyage_terminal_code(r.terminal_id) END,
    'terminal_name', COALESCE(r.closed_snapshot->'header'->>'terminal', r.terminal),
    'closed_at', c.closed_at,
    'closed_by_name', (SELECT up.full_name FROM public.user_profiles up WHERE up.id = r.closed_by),
    'schedule', COALESCE(r.closed_snapshot->'header'->'schedule', '{}'::jsonb),
    'deadline_at', r.closed_snapshot->'header'->>'deadlineAt',
    'signoffs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('department', d.department, 'signed_at', d.signed_at,
        'signed_by_name', (SELECT up.full_name FROM public.user_profiles up WHERE up.id = d.signed_by))
        ORDER BY d.department)
      FROM public.agency_departure_report_department_signoffs d
      WHERE d.report_id = r.id AND d.signed_at IS NOT NULL), '[]'::jsonb),
    'sections', COALESCE((
      SELECT jsonb_object_agg(s.section, s.state)
      FROM public.agency_departure_report_signoffs s WHERE s.report_id = r.id), '{}'::jsonb)
  ) ORDER BY c.id), '[]'::jsonb)
  INTO v_rows
  FROM claimed c
  JOIN public.agency_departure_reports r ON r.id = c.report_id;

  -- Destinatários: todo usuário interno ativo com e-mail (decisão D6: "todos
  -- os e-mails de todas as equipes"); a conta de integração (440) fica fora.
  SELECT COALESCE(jsonb_agg(DISTINCT lower(btrim(u.email))), '[]'::jsonb) INTO v_recipients
  FROM public.user_profiles up
  JOIN auth.users u ON u.id = up.id
  WHERE up.active
    AND COALESCE(up.account_kind, 'pessoa') <> 'integracao'
    AND NULLIF(btrim(COALESCE(u.email, '')), '') IS NOT NULL;

  RETURN jsonb_build_object('rows', v_rows, 'recipients', v_recipients);
END;
$function$;
REVOKE ALL ON FUNCTION public.adr_closed_email_pending(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adr_closed_email_pending(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.adr_closed_email_finish(p_id bigint, p_status text, p_error text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_status NOT IN ('sent', 'retry', 'failed') THEN
    RAISE EXCEPTION 'Situação inválida do e-mail do ADR: %.', p_status USING ERRCODE = '22023';
  END IF;
  UPDATE public.adr_closed_email_outbox
  SET status = CASE
        WHEN p_status = 'sent' THEN 'sent'
        WHEN p_status = 'failed' OR attempts >= 5 THEN 'failed'
        ELSE 'pending' END,
      claimed_until = NULL,
      last_error = left(p_error, 500),
      finished_at = CASE WHEN p_status = 'sent' OR p_status = 'failed' OR attempts >= 5 THEN now() END
  WHERE id = p_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.adr_closed_email_finish(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adr_closed_email_finish(bigint, text, text) TO service_role;

-- 4 --- Disparo pelo evento -------------------------------------------------
INSERT INTO ops.edge_job_kicks (function) VALUES ('adr-closed-email') ON CONFLICT (function) DO NOTHING;
DROP TRIGGER IF EXISTS trg_kick_adr_closed_email ON public.adr_closed_email_outbox;
CREATE TRIGGER trg_kick_adr_closed_email
  AFTER INSERT ON public.adr_closed_email_outbox
  FOR EACH STATEMENT
  EXECUTE FUNCTION public._kick_edge_job_trigger('adr-closed-email', 'ADR_CLOSED_EMAIL_SECRET', 'Authorization', 'Bearer ', '0');

COMMIT;
