-- 175: container compartilhado fatura cada B/L com o rateio atual
-- (M03 e M24 da revisão de 2026-10-09; ADR 0078, item 11).
--
-- 1. `bl_container_share_signature(bl)`: o rateio atual dos containers do B/L —
--    para cada container, quantos B/Ls ativos (container/misto) da mesma Viagem
--    o dividem. É a mesma conta do motor de taxas
--    (`resolve_bl_local_charge_items`, `share_count`).
-- 2. `invoice_bls.container_shares`: o rateio com que o B/L entrou na fatura,
--    gravado ao vincular o B/L (individual ou consolidada).
-- 3. `guard_shared_container_invoice` deixa de recusar todo irmão faturado em
--    outra fatura: recusa só quando o irmão foi faturado com um rateio que não
--    é mais o atual (a proteção contra cobrar 150% do container fica), com
--    SQLSTATE P0007 e mensagem que nomeia o B/L irmão. A fatura do irmão segue
--    a ADR 0077 pela mudança de base (`bl_invoice_basis_snapshot` já inclui os
--    B/Ls que dividem cada container): sem pagamento, é reemitida com o rateio
--    novo; depois disso, este B/L fatura.
-- 4. A guarda de mutação (`guard_shared_container_mutation`) sai: o irmão que
--    chega ou é excluído depois do faturamento é aceito, e a fatura do B/L já
--    faturado segue a ADR 0077 (`capture_invoice_basis` já captura os B/Ls que
--    dividem o container), com a reemissão no resultado e no alerta.
-- 5. Container FCL em B/Ls de Clientes diferentes é recusado pela importação de
--    B/L (`assert_no_fcl_shared_between_customers`, SQLSTATE P0008). Container
--    de B/L LCL ou com veículos continua aceito.
--
-- Depende da afirmação "Data status" do AGENTS.md: preenche
-- `invoice_bls.container_shares` dos vínculos já existentes com o rateio atual
-- (produção só com dados de teste).
--
-- ponytail: a guarda olha o rateio do irmão, não o do próprio B/L; o cálculo do
-- B/L que fatura é refeito pelo CE (`_auto_bill_bl_core(..., false)`) e pela
-- Liberação. Teto: B/L calculado antes de um irmão chegar e faturado sem novo
-- cálculo. Upgrade: gravar o rateio também em `charge_calculations`.
--
-- Rollback: recriar o gatilho `trg_guard_shared_container_mutation` com a
-- função da migration 174; reaplicar `guard_shared_container_invoice` da 066,
-- `import_bl_freight_transactional` da 123, remover as funções novas e a
-- coluna `invoice_bls.container_shares`.

CREATE OR REPLACE FUNCTION public.bl_container_share_signature(p_bl_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_array(shares.container_number, shares.share_count) ORDER BY shares.container_number), '[]'::jsonb)
  FROM (
    SELECT DISTINCT upper(btrim(c.container_number)) AS container_number,
      (
        SELECT count(DISTINCT b2.id)
        FROM public.bl_containers AS c2
        JOIN public.bls AS b2 ON b2.id = c2.bl_id
        WHERE b2.voyage_id = b.voyage_id
          AND b2.cancelled_at IS NULL
          AND COALESCE(b2.cargo_mode, 'container') IN ('container', 'misto')
          AND upper(btrim(c2.container_number)) = upper(btrim(c.container_number))
      ) AS share_count
    FROM public.bls AS b
    JOIN public.bl_containers AS c ON c.bl_id = b.id
    WHERE b.id = p_bl_id
      AND NULLIF(btrim(c.container_number), '') IS NOT NULL
  ) AS shares;
$function$;

REVOKE ALL ON FUNCTION public.bl_container_share_signature(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bl_container_share_signature(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.bl_container_share_signature(text) IS
  'Rateio atual dos containers do B/L: [container, B/Ls ativos da Viagem que o dividem]. Mesma conta do motor de taxas (ADR 0078, item 11).';

ALTER TABLE public.invoice_bls ADD COLUMN IF NOT EXISTS container_shares jsonb;
COMMENT ON COLUMN public.invoice_bls.container_shares IS
  'Rateio dos containers compartilhados com que o B/L entrou nesta fatura (bl_container_share_signature no vínculo).';

-- Data status (AGENTS.md): vínculos existentes recebem o rateio atual.
UPDATE public.invoice_bls SET container_shares = public.bl_container_share_signature(bl_id)
WHERE container_shares IS NULL;

CREATE OR REPLACE FUNCTION public.guard_shared_container_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sibling record;
BEGIN
  -- O rateio com que o B/L entra nesta fatura.
  NEW.container_shares := public.bl_container_share_signature(NEW.bl_id);

  -- Irmão faturado em outra fatura com rateio que não é mais o atual: a
  -- fatura dele precisa ser reemitida antes (ADR 0077); faturar este B/L agora
  -- cobraria o container mais de uma vez.
  FOR v_sibling IN
    SELECT DISTINCT ON (sibling.id) sibling.id, upper(btrim(sibling_container.container_number)) AS container_number,
      link.container_shares AS billed_shares
    FROM public.bl_containers AS own_container
    JOIN public.bls AS root ON root.id = own_container.bl_id
    JOIN public.bl_containers AS sibling_container
      ON upper(btrim(sibling_container.container_number)) = upper(btrim(own_container.container_number))
    JOIN public.bls AS sibling ON sibling.id = sibling_container.bl_id
    JOIN public.invoice_bls AS link ON link.bl_id = sibling.id
    JOIN public.invoices AS invoice ON invoice.id = link.invoice_id
    WHERE own_container.bl_id = NEW.bl_id
      AND sibling.id <> NEW.bl_id
      AND sibling.voyage_id = root.voyage_id
      AND sibling.cancelled_at IS NULL
      AND sibling.financial_status IN ('invoiced', 'paid')
      AND link.invoice_id <> NEW.invoice_id
      AND COALESCE(invoice.status, 'issued') NOT IN ('cancelled', 'obsolete', 'draft')
    ORDER BY sibling.id, link.id DESC
  LOOP
    IF v_sibling.billed_shares IS NOT NULL
       AND v_sibling.billed_shares IS DISTINCT FROM public.bl_container_share_signature(v_sibling.id) THEN
      RAISE EXCEPTION
        'O B/L irmao % (container compartilhado %) foi faturado com outro rateio do container; a fatura dele precisa ser reemitida com o rateio atual antes de faturar o B/L %.',
        v_sibling.id, v_sibling.container_number, NEW.bl_id
        USING ERRCODE = 'P0007';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- Container FCL em B/Ls de Clientes diferentes (ADR 0078, item 11).
CREATE OR REPLACE FUNCTION public.assert_no_fcl_shared_between_customers(p_bl_ids text[])
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conflict record;
BEGIN
  SELECT upper(btrim(c.container_number)) AS container_number, b.id AS bl_id, other.id AS other_bl_id,
    customer.name AS customer_name, other_customer.name AS other_customer_name
  INTO v_conflict
  FROM public.bls AS b
  JOIN public.bl_containers AS c ON c.bl_id = b.id
  JOIN public.bl_containers AS oc ON upper(btrim(oc.container_number)) = upper(btrim(c.container_number))
  JOIN public.bls AS other ON other.id = oc.bl_id
  LEFT JOIN public.customers AS customer ON customer.id = b.customer_id
  LEFT JOIN public.customers AS other_customer ON other_customer.id = other.customer_id
  WHERE b.id = ANY(p_bl_ids)
    AND other.id <> b.id
    AND other.voyage_id = b.voyage_id
    AND b.cancelled_at IS NULL AND other.cancelled_at IS NULL
    AND b.customer_id IS NOT NULL AND other.customer_id IS NOT NULL
    AND b.customer_id <> other.customer_id
    AND COALESCE(b.container_load_type, 'FCL') <> 'LCL'
    AND COALESCE(other.container_load_type, 'FCL') <> 'LCL'
    AND NOT EXISTS (SELECT 1 FROM public.vehicles AS v WHERE v.container_id IN (c.id, oc.id))
  ORDER BY b.id, upper(btrim(c.container_number))
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'O container % esta no B/L % (%) e no B/L % (%): container FCL nao e dividido entre Clientes diferentes. Corrija o Cliente ou o container do arquivo.',
      v_conflict.container_number, v_conflict.bl_id, COALESCE(v_conflict.customer_name, 'Cliente'),
      v_conflict.other_bl_id, COALESCE(v_conflict.other_customer_name, 'outro Cliente')
      USING ERRCODE = 'P0008';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_no_fcl_shared_between_customers(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_no_fcl_shared_between_customers(text[]) TO service_role;

-- Ponto de entrada da importação de B/L: a recusa de FCL entre Clientes
-- diferentes vale depois de gravar (vínculo de Cliente e containers finais).
CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional(p_bls jsonb, p_changed_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_reissues jsonb;
  v_previous text := current_setting('vela.invoice_basis_source', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_bls) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Payload de B/L invalido.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('vela.invoice_basis_source', 'bl_reimport_correction', true);
  v_result := public._import_bl_freight_before_invoice_alert_123(p_bls, p_changed_by);
  PERFORM public.assert_no_fcl_shared_between_customers(
    ARRAY(SELECT item->>'id' FROM jsonb_array_elements(p_bls) AS item WHERE NULLIF(item->>'id', '') IS NOT NULL)
  );
  v_reissues := public.process_invoice_basis_changes();
  PERFORM set_config('vela.invoice_basis_source', coalesce(v_previous, ''), true);
  IF jsonb_typeof(v_result) = 'object' THEN
    RETURN v_result || jsonb_build_object('invoice_reissues', v_reissues);
  END IF;
  RETURN v_result;
END;
$function$;

-- Conjunto que muda depois do faturamento segue a ADR 0077 (item 4 do cabeçalho).
DROP TRIGGER IF EXISTS trg_guard_shared_container_mutation ON public.bl_containers;
DROP FUNCTION IF EXISTS public.guard_shared_container_mutation();
