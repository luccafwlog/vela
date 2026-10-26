-- 463: NOA/NOR/NOB e a Régua de Cobrança saem com o lote inteiro (decisões do
-- dono de 2026-10-26 na revisão da PR de release luccafwlog/vela#1061,
-- migrations 458 e 459, ADR 0103).
--
-- Problema:
--   1. NOA/NOR/NOB. A 458 chamava `customer-communication-auto-runner` quando o
--      B/L ganhava Cliente, Viagem, porto ou terminal. O vínculo feito B/L a B/L
--      (Revisão, ficha do B/L) roda uma transação por B/L: o primeiro disparava
--      a rodada na hora e o aviso saía só com ele; os vinculados nos segundos
--      seguintes ficavam fora, porque o aviso fecha por Cliente × escala (ou
--      Atracação). Exemplo: a ACME tem 3 B/Ls na escala de Santos, que chegou
--      ontem; o NOR saía às 10:00:00 com o B/L 1, e os B/Ls 2 e 3, vinculados às
--      10:00:20 e 10:00:40, nunca entravam em NOR nenhum.
--   2. Régua de Cobrança. A 459 deixou a Régua só com o job de 5 minutos para "as
--      Invoices do lote saírem juntas", mas a fila de efeitos da importação
--      (`demurrage_billing`, `import-effects-runner`) emite as Invoices de uma
--      planilha de devoluções uma a uma, por vários minutos. A rodada que caía no
--      meio cobrava só as já emitidas, e o Cliente recebia o lote em dois e-mails.
--
-- Mudança:
--   1. `trg_kick_customer_communications_on_bl_update` deixa de olhar Cliente,
--      Viagem, porto e terminal do B/L, que decidem quem entra no NOA/NOR/NOB:
--      essas mudanças saem na rodada seguinte do job de 2 minutos, com todos os
--      B/Ls vinculados até lá (decisão do dono: "Esperar a rotina"). Continuam
--      disparando na hora o B/L inserido com Cliente (a importação é uma
--      transação por arquivo), o faturamento, o cancelamento, o CE, a revisão, o
--      peso, o cálculo das taxas, a Escala (ETA/ATA) e a Atracação (ATB).
--   2. `claim_demurrage_dunning_candidates`: a primeira cobrança de uma Invoice
--      espera enquanto o Cliente tiver faturamento de Demurrage na fila de
--      efeitos (`pending`, `running` ou `retry_wait`, criado nas últimas 2 horas;
--      `blocked` espera uma pessoa e não segura a Régua). O lote sai inteiro na
--      rodada seguinte a ele terminar (decisão do dono: "Esperar a fila"). As
--      cobranças seguintes não mudam.
--
-- ponytail: a divisão do NOA/NOR/NOB ainda acontece quando os vínculos de um
-- mesmo Cliente × escala caem em lados opostos de uma rodada de 2 minutos, como
-- antes da 458 com o job de 15. Upgrade: janela de quietude por Cliente × escala
-- na produtora. E a espera da Régua tem teto de 2 horas por efeito: um efeito
-- parado em `retry_wait` por mais tempo deixa de segurar o Cliente.
--
-- Só redefine função e recria um gatilho; não reescreve nem apaga linhas.
-- Rollback: recriar o gatilho com a lista de colunas da 458 e reaplicar
-- `claim_demurrage_dunning_candidates` como estava depois da 462 (o
-- `pg_get_functiondef` dela antes desta migration).

-- 1 -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_kick_customer_communications_on_bl_update ON public.bls;
CREATE TRIGGER trg_kick_customer_communications_on_bl_update
  AFTER UPDATE OF financial_status, cancelled_at, ce_mercante,
    review_status, cargo_mode, bb_weight_ton, charges_calculated_at ON public.bls
  FOR EACH ROW
  WHEN (NEW.customer_id IS NOT NULL AND (
    OLD.financial_status IS DISTINCT FROM NEW.financial_status
    OR OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at
    OR OLD.ce_mercante IS DISTINCT FROM NEW.ce_mercante
    OR OLD.review_status IS DISTINCT FROM NEW.review_status
    OR OLD.cargo_mode IS DISTINCT FROM NEW.cargo_mode
    OR OLD.bb_weight_ton IS DISTINCT FROM NEW.bb_weight_ton
    OR OLD.charges_calculated_at IS DISTINCT FROM NEW.charges_calculated_at))
  EXECUTE FUNCTION public._kick_edge_job_trigger('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET', 'X-Communication-Automation-Secret', '', '90 seconds');

-- 2 -------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def text;
  v_old text := $s$      AND public._demurrage_dunning_invoice_billable(di.id)
$s$;
  v_new text := $s$      AND public._demurrage_dunning_invoice_billable(di.id)
      -- 463: a 1ª cobrança espera a fila de efeitos terminar de emitir as
      -- Invoices de Demurrage do Cliente, para o lote sair num e-mail só.
      AND (COALESCE(claims.attempt_count, 0) > 0 OR NOT EXISTS (
        SELECT 1
        FROM public.import_pending_effects AS effect
        JOIN public.bls AS anchor ON anchor.id = effect.entity_id
        WHERE effect.effect_kind = 'demurrage_billing'
          AND effect.status IN ('pending', 'running', 'retry_wait')
          AND effect.created_at > v_as_of - interval '2 hours'
          AND anchor.customer_id = di.customer_id))
$s$;
BEGIN
  v_def := pg_get_functiondef('public.claim_demurrage_dunning_candidates(timestamptz,integer)'::regprocedure);
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION '463: trecho não encontrado em claim_demurrage_dunning_candidates';
  END IF;
  IF position(v_old IN substr(v_def, position(v_old IN v_def) + 1)) > 0 THEN
    RAISE EXCEPTION '463: trecho repetido em claim_demurrage_dunning_candidates';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;
