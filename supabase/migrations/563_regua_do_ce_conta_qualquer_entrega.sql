-- 563: a régua do CE e Taxas conta a entrega de qualquer tentativa.
--
-- Revisão da release 2026-11-01 (PR #1142); decisão do dono de 2026-11-01.
-- `customer_communication_target_pending_recipients` (318) considerava o CE e
-- Taxas de um Cliente × Viagem entregue só pela tentativa da régua
-- (discriminador 0). Se a tentativa 0 falhava ou era adiada e o operador
-- enviava o CE pelo Disparo (desde a #1143) ou pelo reenvio do Histórico
-- (tentativa N), a régua ainda via o alvo pendente e mandava o CE de novo na
-- rodada seguinte: o Cliente recebia duas vezes. NOA, NOR e NOB já contavam
-- qualquer tentativa do mesmo alvo; o CE e Taxas passa a contar igual.
--
-- Efeitos: a régua (`customer_communication_automation_targets`, 458) e o
-- fechamento do alerta de CE não enviado (353), que chamam esta função, veem
-- o alvo feito quando qualquer envio do CE ao Cliente × Viagem foi entregue.
-- A 1ª tentativa do alvo (contatos obrigatórios) passa a ser o 1º CE do
-- Cliente × Viagem, manual ou automático, como nos outros tipos.
--
-- Só redefine a função (mesma assinatura; CREATE OR REPLACE mantém os grants
-- da 318); não grava nem reescreve linhas.
--
-- Rollback: recriar a função como na 318 (com `AND c.attempt_discriminator = 0`
-- no ramo `ce_mercante_taxas`).

CREATE OR REPLACE FUNCTION public.customer_communication_target_pending_recipients(
  p_kind text,
  p_customer_id bigint,
  p_voyage_id bigint,
  p_port text,
  p_atracacao_id uuid,
  p_emails text[]
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH target_communications AS (
    SELECT c.id, c.created_at
    FROM public.customer_communications c
    WHERE c.customer_id = p_customer_id
      AND c.kind = p_kind
      AND CASE
        WHEN p_kind = 'aviso_atracacao_nob' THEN c.nature = 'avisos_operacionais' AND c.anchor_atracacao_id = p_atracacao_id
        -- CE e Taxas: Cliente × Viagem, qualquer tentativa (563: o envio
        -- manual entregue, pelo Disparo ou pelo reenvio do Histórico, também
        -- conta, como já contava no NOA, NOR e NOB), com qualquer porto
        -- gravado antes da migration 315.
        WHEN p_kind = 'ce_mercante_taxas' THEN c.nature = 'documentacao' AND c.anchor_voyage_id = p_voyage_id
        ELSE c.nature = 'avisos_operacionais' AND c.anchor_voyage_id = p_voyage_id
          AND public.normalize_port_code(c.anchor_port) = p_port
      END
  ), first_try AS (
    -- O alvo foi tentado pela 1ª vez quando nasceu o 1º Comunicado dele.
    SELECT min(tc.created_at) AS at FROM target_communications tc
  ), target_attempts AS (
    SELECT a.recipient_key,
      (a.dispatch_mode = 'real' AND (a.status = 'entregue' OR (a.status = 'aceito' AND a.provider_message_id IS NOT NULL)))
        OR (a.dispatch_mode = 'simulado' AND a.status IN ('aceito', 'entregue')) AS delivered,
      a.status IN ('bounce', 'complaint') AS refused_by_address
    FROM target_communications tc
    JOIN public.customer_communication_attempts a ON a.communication_id = tc.id
    WHERE a.recipient_key IS NOT NULL
  ), settled AS (
    SELECT t.recipient_key, bool_or(t.delivered) AS delivered
    FROM target_attempts t
    WHERE t.delivered OR t.refused_by_address
    GROUP BY t.recipient_key
  ), current_recipients AS (
    SELECT e.email, e.ord
    FROM unnest(COALESCE(p_emails, '{}'::text[])) WITH ORDINALITY AS e(email, ord)
  ), required AS (
    -- Destinatários que o alvo precisa cobrir: os atuais que já eram contato
    -- elegível na 1ª tentativa. Contato cadastrado (ou ligado à caixa) depois
    -- não torna o alvo devido de novo; sem Comunicado ainda, todos contam.
    SELECT r.email, r.ord
    FROM current_recipients r
    CROSS JOIN first_try f
    WHERE f.at IS NULL
       OR EXISTS (
        SELECT 1
        FROM public.customer_contacts cc
        JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id
        WHERE cc.customer_id = p_customer_id
          AND lower(btrim(cc.email)) = lower(btrim(r.email))
          AND ccb.box_code = ANY(CASE WHEN p_kind = 'ce_mercante_taxas'
            THEN ARRAY['documentacao_operacao', 'financeiro'] ELSE ARRAY['documentacao_operacao'] END)
          AND GREATEST(cc.created_at, ccb.created_at) <= f.at)
  ), pool AS (
    -- Sem obrigatório (nenhum contato, ou só contatos novos), o alvo vale
    -- para os atuais — se ninguém recebeu (ver o SELECT final).
    SELECT r.email, r.ord FROM required r
    UNION ALL
    SELECT c.email, c.ord FROM current_recipients c WHERE NOT EXISTS (SELECT 1 FROM required)
  ), pending AS (
    SELECT p.email, p.ord
    FROM pool p
    WHERE NOT EXISTS (
      SELECT 1 FROM settled s WHERE s.recipient_key = public.customer_communication_recipient_key(p.email))
  )
  SELECT CASE
    -- Com obrigatório: faltam os que não têm tentativa resolvida; nenhum
    -- (array_agg de zero linhas é NULL) é alvo feito.
    WHEN EXISTS (SELECT 1 FROM required) THEN (SELECT array_agg(p.email ORDER BY p.ord) FROM pending p)
    -- Sem obrigatório: feito se alguém já recebeu; senão o alvo segue devido
    -- para os atuais (vazio abre "Comunicado sem destinatário").
    WHEN EXISTS (SELECT 1 FROM settled s WHERE s.delivered) THEN NULL
    ELSE COALESCE((SELECT array_agg(p.email ORDER BY p.ord) FROM pending p), '{}'::text[])
  END;
$function$;
