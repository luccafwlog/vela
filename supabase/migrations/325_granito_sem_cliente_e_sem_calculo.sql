-- 325: o Granito deixa de ter Cliente vinculado e cálculo de taxas (lote 5b
-- da identidade visual, frente Granito; regra decidida pelo responsável em
-- 2026-10-19 e registrada em docs/modules/granito.md).
--
-- Problema:
--   O Granito serve só para totalizar a carga movimentada no navio. Mesmo
--   assim, a importação COSCO procurava e sugeria Cliente pelo CNPJ, o B/L
--   sem Cliente caía na Revisão, abria o alerta "Revisão de Granito — cliente
--   não vinculado" (`review_granite_customer_unlinked`) e cada importação
--   enfileirava o efeito `granite_billing`, que calculava taxas a partir de
--   `granite_rates`. A planilha de CE Mercante também aceitava o alvo
--   `granite`. Os erros da importação chegavam crus e sem acento (achado G7).
--
-- Mudança:
--   1. `import_granite_manifest_transactional` (mesma assinatura e grants)
--      ignora `client_id` e `suggested_client_id` vindos do arquivo, não deixa
--      o efeito `granite_billing` na fila e devolve as recusas conhecidas em
--      português. O corpo da importação continua o da migration 206
--      (`import_granite_manifest_transactional_legacy_189`). O Cliente já
--      gravado num B/L antigo fica, sem uso.
--   2. O efeito `granite_billing` passa a não calcular nada (o que estiver na
--      fila termina sem efeito). `calculate_granite_bl_charges` perde o
--      EXECUTE de `authenticated`: a tela não chama mais o cálculo, e a função
--      sem grant falha fechada para um cliente antigo, em vez de seguir
--      gravando snapshot. `service_role` mantém o grant histórico.
--   3. `save_granite_bl_review` perde o EXECUTE de `authenticated`: o Granito
--      saiu da Revisão.
--   4. O alerta `review_granite_customer_unlinked` sai do catálogo
--      (`active = false`); o gatilho que o reconciliava a cada escrita em
--      `granite_bls` sai, o detector passa a não abrir nada e a reconciliação
--      só fecha.
--   5. `apply_ce_mercante_rows_atomic` recusa `p_target = 'granite'`.
--
--   As colunas `client_id`, `suggested_client_id`, `charge_status`, as
--   tarifas (`granite_rates`) e os snapshots (`granite_bl_charges`) ficam no
--   banco, sem uso, até uma limpeza à parte.
--
-- Reescreve linhas existentes: fecha os itens e alertas abertos de
-- `review_granite_customer_unlinked`, encerra (`superseded`) os efeitos
-- `granite_billing` ainda na fila ou bloqueados e fecha o alerta de bloqueio
-- deles. Depende da afirmação "Data status" do AGENTS.md (seção Gotchas): o
-- banco de produção só tem dados de teste.
--
-- Reversão: recriar o gatilho e as funções pelas definições das migrations
-- 002/031/206/324, devolver os grants e reativar o tipo no catálogo.

-- 1. Importação sem Cliente e sem efeito de cálculo -------------------------

CREATE OR REPLACE FUNCTION public.import_granite_manifest_transactional(
  p_voyage_id bigint,
  p_vessel_voyage text,
  p_loading_port text,
  p_discharge_port text,
  p_total_bls integer,
  p_total_weight_kg numeric,
  p_uploaded_by uuid,
  p_bls jsonb,
  p_remove_missing text[] DEFAULT NULL::text[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bls jsonb := p_bls;
  v_result jsonb;
BEGIN
  PERFORM public._set_import_context('Granito', p_voyage_id, NULL);

  -- O Granito não tem Cliente: o vínculo e a sugestão do arquivo não entram.
  IF jsonb_typeof(p_bls) = 'array' THEN
    SELECT COALESCE(jsonb_agg(item.value || '{"client_id": null, "suggested_client_id": null}'::jsonb ORDER BY item.ordinality), '[]'::jsonb)
    INTO v_bls
    FROM jsonb_array_elements(p_bls) WITH ORDINALITY AS item(value, ordinality);
  END IF;

  BEGIN
    v_result := public.import_granite_manifest_transactional_legacy_189(
      p_voyage_id, p_vessel_voyage, p_loading_port, p_discharge_port,
      p_total_bls, p_total_weight_kg, p_uploaded_by, v_bls, p_remove_missing
    );
  EXCEPTION
    -- Achado G7: as recusas do corpo legado vinham sem acento.
    WHEN insufficient_privilege THEN
      IF SQLERRM = 'Credenciais invalidas para importar manifesto Granito.' THEN
        RAISE EXCEPTION 'Sem permissão para importar o Granito: entre de novo com um usuário ativo.' USING ERRCODE = '42501';
      END IF;
      RAISE;
    WHEN no_data_found THEN
      IF SQLERRM = 'Viagem nao encontrada.' THEN
        RAISE EXCEPTION 'Viagem de destino não encontrada.' USING ERRCODE = 'P0002';
      END IF;
      RAISE;
    WHEN invalid_parameter_value THEN
      IF SQLERRM = 'Manifesto Granito invalido.' THEN
        RAISE EXCEPTION 'A planilha não tem B/L de Granito válido para gravar.' USING ERRCODE = '22023';
      END IF;
      RAISE;
  END;

  -- ponytail: o corpo legado ainda enfileira `granite_billing` por B/L novo ou
  -- alterado; aqui o efeito desta transação sai da fila antes do commit (o
  -- runner só vê a fila depois dele). Identifica-se pelo autor, pela Viagem e
  -- pelo instante da transação (`now()`). Caminho de evolução: reescrever o
  -- corpo sem o INSERT quando a limpeza das colunas sem uso acontecer.
  DELETE FROM public.import_pending_effects
  WHERE effect_kind = 'granite_billing'
    AND status = 'pending'
    AND created_by = p_uploaded_by
    AND created_at = now()
    AND source_snapshot->>'voyage_id' = p_voyage_id::text;

  RETURN v_result;
END $function$;

-- 2. Sem cálculo de taxas ---------------------------------------------------

CREATE OR REPLACE FUNCTION public._run_import_effect_granite_billing(p_entity_id text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- O Granito não calcula taxas desde a 325: o efeito termina sem agir.
  RETURN jsonb_build_object('entity_id', p_entity_id, 'skipped', 'granito_sem_calculo');
END;
$function$;

-- A 329 apaga a função; o teste reaplica esta migration depois dela.
DO $$
BEGIN
  IF to_regprocedure('public.calculate_granite_bl_charges(uuid,uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.calculate_granite_bl_charges(uuid, uuid) FROM authenticated;
  END IF;
END $$;

-- 3. Fora da Revisão --------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.save_granite_bl_review(uuid, bigint, uuid) FROM authenticated;

-- 4. Sem o alerta de Cliente não vinculado ----------------------------------

DROP TRIGGER IF EXISTS trg_reconcile_granite_bl_review_alerts ON public.granite_bls;
DROP FUNCTION IF EXISTS public.trg_reconcile_granite_bl_review_alerts();

CREATE OR REPLACE FUNCTION public.detect_granite_bl_review_pendencies()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- O Granito não tem Cliente (325): não há pendência a abrir.
  RETURN 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_granite_bl_review_alerts(p_granite_bl_id uuid, p_source text DEFAULT 'granite_review_gate'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Desde a 325 só fecha: o tipo saiu do catálogo.
  PERFORM public.resolve_alert_item(
    'review_granite_customer_unlinked', 'granite_bl', p_granite_bl_id::text,
    COALESCE(NULLIF(btrim(p_source), ''), 'granite_review_gate'), '{}'::jsonb
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_granite_bl_review_alerts(p_granite_bl_id bigint, p_source text DEFAULT 'granite_review_gate'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.resolve_alert_item(
    'review_granite_customer_unlinked', 'granite_bl', p_granite_bl_id::text,
    COALESCE(NULLIF(btrim(p_source), ''), 'granite_review_gate'), '{}'::jsonb
  );
END;
$function$;

UPDATE public.alert_type_catalog
SET active = false
WHERE type = 'review_granite_customer_unlinked';

-- Fecha os itens abertos (do alerta e do bloqueio dos efeitos encerrados
-- abaixo) com o mesmo registro de evento que `resolve_alert_item` grava, sem
-- depender de sessão autenticada.
DO $close$
DECLARE
  v_item record;
  v_effect_ids text[];
BEGIN
  UPDATE public.import_pending_effects
  SET status = 'superseded',
      lease_until = NULL,
      leased_by = NULL,
      result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('reason', 'granito_sem_calculo', 'migration', '325'),
      updated_at = now()
  WHERE effect_kind = 'granite_billing'
    AND status IN ('pending', 'retry_wait', 'blocked');

  SELECT COALESCE(array_agg(id::text), ARRAY[]::text[]) INTO v_effect_ids
  FROM public.import_pending_effects
  WHERE effect_kind = 'granite_billing' AND status = 'superseded';

  FOR v_item IN
    SELECT i.id, i.alert_id, i.occurrence_id, i.item_type
    FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.status = 'active'
      AND (i.item_type = 'review_granite_customer_unlinked'
        OR (i.item_type = 'import_effect_blocked' AND a.entity_type = 'import_effect' AND a.entity_id = ANY (v_effect_ids)))
    FOR UPDATE OF i
  LOOP
    UPDATE public.alert_items
    SET status = 'resolved', updated_at = now(), resolved_at = now()
    WHERE id = v_item.id;
    INSERT INTO public.alert_item_events(
      alert_item_id, occurrence_id, event_type, previous_status, new_status, actor_id, metadata
    ) VALUES (
      v_item.id, v_item.occurrence_id, 'resolved', 'active', 'resolved', NULL,
      jsonb_build_object('source', 'migration_325_granito_sem_cliente')
    );
    PERFORM public.refresh_alert_aggregate(v_item.alert_id);
  END LOOP;
END;
$close$;

-- Alerta antigo, sem item, do mesmo tipo.
UPDATE public.alerts
SET status = 'closed', closed_at = now()
WHERE type = 'review_granite_customer_unlinked'
  AND status <> 'closed';

-- 5. CE Mercante sem o alvo Granito -----------------------------------------

CREATE OR REPLACE FUNCTION public.apply_ce_mercante_rows_atomic(
  p_rows jsonb,
  p_changed_by uuid,
  p_target text DEFAULT 'bls'::text,
  p_manifesto_numero text DEFAULT NULL::text,
  p_voyage_id bigint DEFAULT NULL::bigint,
  p_confirm_changes boolean DEFAULT false,
  p_reason text DEFAULT NULL::text,
  p_defer_billing boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_target = 'granite' THEN
    RAISE EXCEPTION 'A planilha de CE Mercante não se aplica ao Granito: o Granito só totaliza a carga do navio.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public._set_import_context('CE Mercante', p_voyage_id, p_manifesto_numero);
  RETURN public.apply_ce_mercante_rows_atomic_legacy_189(p_rows, p_changed_by, p_target, p_manifesto_numero, p_voyage_id, p_confirm_changes, p_reason, p_defer_billing);
END $function$;

-- CREATE OR REPLACE mantém os grants; reafirma o que cada uma não expõe.
REVOKE ALL ON FUNCTION public.import_granite_manifest_transactional(bigint, text, text, text, integer, numeric, uuid, jsonb, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_ce_mercante_rows_atomic(jsonb, uuid, text, text, bigint, boolean, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._run_import_effect_granite_billing(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detect_granite_bl_review_pendencies() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_granite_bl_review_alerts(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_granite_bl_review_alerts(bigint, text) FROM PUBLIC, anon, authenticated;
