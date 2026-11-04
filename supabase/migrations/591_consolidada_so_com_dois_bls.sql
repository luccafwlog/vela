-- 591: fatura consolidada só com dois B/Ls ou mais (decisão do dono de
-- 2026-11-04). Um Cliente gerou no Portal uma consolidada com um B/L só; daqui
-- para frente, a criação pede pelo menos dois B/Ls distintos. Com um B/L só,
-- vale a fatura individual dele.
--
-- 1. `public.portal_create_consolidation(bigint[])` (redefinida da 428):
--    depois das guardas de dono e de elegibilidade, recusa a seleção com menos
--    de dois B/Ls distintos (um B/L pode ter mais de um recebível).
-- 2. `public.create_local_consolidated_invoice(bigint,bigint[],text,uuid)`
--    (redefinida da 509), a emissão manual no Vela: a mesma recusa, depois da
--    guarda de permissão.
-- Recusa: "A fatura consolidada precisa de pelo menos dois B/Ls. Para um B/L
-- só, use a fatura individual dele." (22023, que a tela mostra inteira).
--
-- O núcleo `create_local_consolidated_invoice_core` fica como está: a
-- reemissão automática de uma consolidada que já existia (correção do B/L,
-- migration 128/574, e a substituta sem o B/L pago na individual, migration
-- 356/574) continua saindo mesmo que reste um B/L só, porque o B/L que entrou
-- sem individual tem a consolidada como única cobrança.
-- ponytail: a regra vale nas duas portas de criação manual, não no núcleo.
-- Upgrade: se o dono quiser que a substituta de um B/L só não saia, decidir
-- antes como esse B/L volta a ter uma individual.
--
-- Plano de preservação: a migration não grava, não reescreve nem apaga linha
-- existente; só redefine duas funções. As consolidadas de um B/L só já
-- emitidas, inclusive a do Cliente que motivou a regra, ficam como estão (o
-- dono pediu para não mexer nelas). Conferir: as duas funções recusam a
-- seleção de um B/L. Desfazer: reaplicar as duas funções pela 428 e pela 509.

CREATE OR REPLACE FUNCTION public.portal_create_consolidation(p_receivable_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id BIGINT := public.current_portal_customer_id();
  v_ids BIGINT[];
  v_result JSONB;
BEGIN
  PERFORM public.check_portal_rate_limit('create_consolidation', 3, 10);
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id) INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id) WHERE id IS NOT NULL;
  IF EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = ANY(v_ids) AND br.customer_id <> v_customer_id) THEN
    -- Mesma recusa de id inexistente: o Portal não distingue recebível alheio.
    RAISE EXCEPTION 'Seleção contém B/L que não pode entrar na consolidada. Atualize a lista.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = ANY(v_ids) AND NOT public.bl_has_portal_release(br.bl_id)) THEN
    RAISE EXCEPTION 'Seleção contém B/L que não pode entrar na consolidada. Atualize a lista.' USING ERRCODE = '42501';
  END IF;
  -- 298: o Portal só consolida o que a janela lista como elegível: recebível
  -- com fatura emitida e visível, saldo em aberto e sem consolidada aberta.
  IF EXISTS (
    SELECT 1 FROM UNNEST(COALESCE(v_ids, ARRAY[]::BIGINT[])) AS u(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public._portal_list_consolidatable_receivables_core(v_customer_id) AS c
      WHERE c.receivable_id = u.id AND c.eligibility_status = 'eligible'
    )
  ) THEN
    RAISE EXCEPTION 'Seleção contém B/L que não pode entrar na consolidada. Atualize a lista.' USING ERRCODE = '42501';
  END IF;
  -- 591: consolidada só com dois B/Ls ou mais (decisão do dono de 2026-11-04).
  IF (SELECT count(DISTINCT br.bl_id) FROM public.bl_receivables br WHERE br.id = ANY(v_ids)) < 2 THEN
    RAISE EXCEPTION 'A fatura consolidada precisa de pelo menos dois B/Ls. Para um B/L só, use a fatura individual dele.' USING ERRCODE = '22023';
  END IF;
  v_result := public.create_local_consolidated_invoice_core(v_customer_id, p_receivable_ids, auth.uid(), 'portal');
  INSERT INTO public.portal_notifications (customer_id, type, title, message, link)
  VALUES (v_customer_id, 'system', 'Fatura consolidada criada',
    'Sua fatura consolidada foi gerada com ' || COALESCE(array_length(v_ids, 1), 0) || ' B/L(s).', '/portal/billing');
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice(p_customer_id bigint, p_receivable_ids bigint[], p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  -- 591: consolidada só com dois B/Ls ou mais (decisão do dono de 2026-11-04).
  -- Seleção vazia segue para a recusa do núcleo ("Nenhum receivable informado").
  IF COALESCE(cardinality(p_receivable_ids), 0) > 0
     AND (SELECT count(DISTINCT br.bl_id) FROM public.bl_receivables br WHERE br.id = ANY(p_receivable_ids)) < 2 THEN
    RAISE EXCEPTION 'A fatura consolidada precisa de pelo menos dois B/Ls. Para um B/L só, use a fatura individual dele.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  RETURN public.create_local_consolidated_invoice_core(
    p_customer_id,
    p_receivable_ids,
    v_actor,
    'internal'
  );
END;
$function$;
