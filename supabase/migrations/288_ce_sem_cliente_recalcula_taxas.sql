-- 288: cadastrar o CE recalcula as Taxas Locais também no B/L sem Cliente.
--
-- Problema (B/L CSC4541060950G, 2026-10-09): fora da planilha em lotes, o
-- gatilho do CE chama `auto_bill_bl_after_ce_mercante`, e `_auto_bill_bl_core`
-- devolve `customer_reconciliation_pending` antes de calcular quando o B/L não
-- tem Cliente conciliado. O B/L ficava com o cálculo provisório da importação,
-- inclusive um rateio de container compartilhado feito antes de o irmão
-- existir (container inteiro em vez de metade). A regra é que o CE confirma o
-- cálculo (ADR 0042; Taxas Locais, "Fato gerador e fases do cálculo").
--
-- A planilha da tela de B/Ls usa a emissão em lotes (`vela.ce_billing_deferred`),
-- que já recalcula; esta migration cobre os demais caminhos que gravam o
-- primeiro CE fora desse modo (planilha chamada sem `p_defer_billing`,
-- manutenção `apply_ce_mercante_update` e qualquer caminho futuro).
--
-- Mudança: quando o CE acaba de ser cadastrado e o faturamento automático
-- para por falta de Cliente, o gatilho recalcula as Taxas Locais, como já faz
-- no caminho da planilha em lotes. A emissão continua bloqueada até o Cliente;
-- vincular o Cliente depois recalcula de novo pelo caminho existente. Falha
-- no cálculo não desfaz o CE e fica em `audit_logs`
-- (`local_charges_auto_calc_error`); não há nova tentativa automática (o efeito
-- `local_billing` reaproveita o cálculo gravado) até o vínculo do Cliente.
--
-- Só redefine a função do gatilho; não reescreve nem apaga linhas.
-- Rollback: recriar `trg_auto_bill_bl_after_ce_mercante` como na migration 181.

CREATE OR REPLACE FUNCTION public.trg_auto_bill_bl_after_ce_mercante()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_previous_request_role text := current_setting('request.jwt.claim.role', true);
  v_role_impersonated boolean := false;
  v_result jsonb;
BEGIN
  -- Emissão em lotes (migration 181): a planilha grava o CE e o cálculo na
  -- transação e a tela emite logo depois por `emit_ce_mercante_billing`; o
  -- efeito local_billing registrado na gravação fica como rede.
  IF current_setting('vela.ce_billing_deferred', true) = 'on' THEN
    PERFORM public.calculate_bl_local_charges(NEW.id, v_actor, true);
    RETURN NEW;
  END IF;

  v_result := public.auto_bill_bl_after_ce_mercante(NEW.id, v_actor);

  -- 288: sem Cliente conciliado o faturamento para antes de calcular. O CE
  -- recém-cadastrado confirma o cálculo mesmo assim (rateio com os irmãos já
  -- gravados); a fatura espera o Cliente.
  IF v_result->>'reason' = 'customer_reconciliation_pending'
     AND NULLIF(BTRIM(OLD.ce_mercante), '') IS NULL THEN
    BEGIN
      PERFORM public.calculate_bl_local_charges(NEW.id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
      ) VALUES (
        'bl', NEW.id, 'local_charges_auto_calc_error', NULL, SQLERRM, v_actor, now(),
        'Falha no calculo de taxas locais ao cadastrar o CE Mercante de B/L sem Cliente'
      );
    END;
  END IF;

  -- `held` é a retenção do Portal: quem a desfaz é a ativação do Portal ou a
  -- Liberação, não uma nova tentativa da fila.
  IF v_result->>'status' NOT IN ('invoiced', 'already_invoiced', 'skipped', 'held')
     AND NOT EXISTS (
       SELECT 1
       FROM public.import_pending_effects AS e
       WHERE e.entity_id = NEW.id
         AND e.effect_kind = 'local_billing'
         AND e.status IN ('pending', 'running', 'retry_wait')
     ) THEN
    -- A trigger disparado por uma conexão sem JWT já passou pela autorização
    -- da operação que alterou o B/L. Para deixar a recuperação registrada sem
    -- inventar um usuário, chama a fila como service_role e restaura o claim
    -- imediatamente depois do insert.
    IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
      PERFORM set_config('request.jwt.claim.role', 'service_role', true);
      v_role_impersonated := true;
    END IF;

    PERFORM public.enqueue_import_effect(
      gen_random_uuid(),
      'local_billing',
      NEW.id,
      v_actor,
      1,
      NULL,
      jsonb_build_object(
        'source', 'ce_mercante_auto_billing',
        'ce_mercante', NEW.ce_mercante,
        'reason', v_result->>'reason',
        'message', v_result->>'message',
        'actor_source', CASE WHEN v_actor IS NULL THEN 'system' ELSE 'request' END
      )
    );

    IF v_role_impersonated THEN
      PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_request_role, ''), true);
      v_role_impersonated := false;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    IF v_role_impersonated THEN
      PERFORM set_config('request.jwt.claim.role', COALESCE(v_previous_request_role, ''), true);
    END IF;
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_auto_bill_bl_after_ce_mercante() FROM PUBLIC, anon, authenticated;
