-- 345: leitura do que a próxima rodada automática vai enviar, sem efeito
-- colateral (sessão de testes de 2026-10-20, melhoria 10).
--
-- Problema: o cron `customer-communication-auto-runner` roda em
-- `4-59/15 * * * *` e chama `evaluate_and_dispatch_automatic_communications`
-- (migration 314), que lê os alvos em `customer_communication_automation_targets`
-- e grava o claim de cada um antes de enviar. Até a rodada, nada indica na
-- tela que o Comunicado elegível vai sair: o Lucca via "nada enviado" por até
-- 15 minutos.
--
-- Mudança: `customer_communication_queue_preview(viagens)` devolve, para as
-- viagens pedidas, os mesmos alvos que a rodada avaliaria agora (reusa
-- `customer_communication_automation_targets`, sem duplicar a elegibilidade
-- nem a prontidão) e a situação do claim de cada um, calculada pela mesma
-- condição do `ON CONFLICT` da rodada:
--   - `na_fila`: a próxima rodada pega o alvo;
--   - `em_envio`: claim tomado há menos de 30 minutos e não liberado;
--   - `recusado`: recusa nas últimas 24 horas;
--   - `nova_tentativa`: recusa não definitiva com `next_attempt_at` futuro;
--   - `sem_destinatario`: alvo sem contato ativo na caixa (a rodada abre o
--     alerta `nob_sem_destinatario` em vez de enviar).
-- Só lê: não grava claim, não cria `customer_communications` e não envia.
-- Devolve a quantidade de destinatários, não os endereços.
--
-- ponytail: a leitura avalia os alvos de todas as viagens e filtra as
-- pedidas, como a rodada; com muitas viagens ativas o custo cresce com elas.
-- O upgrade é um parâmetro de viagem em `customer_communication_automation_targets`.
--
-- Só cria função; não reescreve nem apaga linhas.
-- Rollback: DROP FUNCTION public.customer_communication_queue_preview(bigint[]).

CREATE OR REPLACE FUNCTION public.customer_communication_queue_preview(p_voyage_ids bigint[])
RETURNS TABLE(
  kind text,
  customer_id bigint,
  voyage_id bigint,
  port text,
  anchor_atracacao_id uuid,
  bl_ids text[],
  recipient_count integer,
  claim_state text,
  next_attempt_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário interno ativo é obrigatório.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_voyage_ids), 0) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.kind, t.customer_id, t.voyage_id, t.port, t.anchor_atracacao_id, t.bl_ids,
    COALESCE(cardinality(t.emails), 0)::integer,
    CASE
      WHEN COALESCE(cardinality(t.emails), 0) = 0 THEN 'sem_destinatario'
      WHEN c.claim_key IS NULL THEN 'na_fila'
      WHEN c.rejected_at IS NOT NULL AND c.rejected_at >= v_now - interval '24 hours' THEN 'recusado'
      WHEN c.next_attempt_at IS NOT NULL AND c.next_attempt_at > v_now THEN 'nova_tentativa'
      WHEN c.released_at IS NULL AND c.claimed_at >= v_now - interval '30 minutes' THEN 'em_envio'
      ELSE 'na_fila'
    END,
    c.next_attempt_at
  FROM public.customer_communication_automation_targets(v_now) t
  LEFT JOIN public.customer_communication_automation_claims c ON c.claim_key = t.claim_key
  WHERE t.voyage_id = ANY(p_voyage_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_communication_queue_preview(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_communication_queue_preview(bigint[]) TO authenticated;
