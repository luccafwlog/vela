-- 122: fatura emitida não muda de valor (ADR 0077; plano
-- 2026-10-01-correcao-de-bl-apos-faturamento, Fases 1 e 3).
--
-- 1. As RPCs de "Outras cobranças (manuais)" deixam de ser chamáveis pela
--    API. Elas alteravam total e saldo de fatura emitida sem pagamento; nenhum
--    fluxo cria fatura `draft` (a emissão individual e a consolidada nascem
--    `issued`), então não há estado em que a edição ainda caiba.
-- 2. Cancelar e reemitir: fatura de Taxas Locais (individual ou consolidada)
--    sem pagamento é cancelada pelo `cancel_invoice` e marcada para reemissão.
--    A próxima emissão que cobrir o mesmo B/L (individual) ou o mesmo
--    recebível (consolidada) passa a apontar para ela em
--    `invoices.replaces_invoice_id`. Enquanto não houver sucessora, a fatura
--    aparece em `list_pending_reissues` ("Reemissão pendente").
--
-- Colunas novas são nullable; não reescreve nem apaga linhas existentes.

-- ---------------------------------------------------------------------------
-- 1. Edição de fatura emitida sai da API
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.add_manual_invoice_charge(bigint, text, numeric, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_manual_invoice_charge(bigint, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Vínculo entre fatura cancelada e a reemissão
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS replaces_invoice_id bigint REFERENCES public.invoices(id),
  ADD COLUMN IF NOT EXISTS reissue_requested_at timestamptz;

COMMENT ON COLUMN public.invoices.replaces_invoice_id IS
  'Fatura cancelada por Cancelar e reemitir que esta emissão substitui.';
COMMENT ON COLUMN public.invoices.reissue_requested_at IS
  'Preenchido quando a fatura foi cancelada por Cancelar e reemitir.';

CREATE UNIQUE INDEX IF NOT EXISTS invoices_replaces_invoice_id_key
  ON public.invoices (replaces_invoice_id)
  WHERE replaces_invoice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. cancel_invoice_for_reissue
-- ---------------------------------------------------------------------------
-- Consolidada: p_correct_bl_ids indica os B/Ls que serão corrigidos. A fatura
-- individual aberta de cada um também é cancelada para reemissão, porque o
-- recálculo do B/L só é aceito com o B/L de volta a `pending`.
CREATE OR REPLACE FUNCTION public.cancel_invoice_for_reissue(
  p_invoice_id bigint,
  p_reason text,
  p_correct_bl_ids text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice record;
  v_reason text := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  v_bl_ids text[];
  v_correct text[];
  v_individual record;
  v_cancelled bigint[] := ARRAY[]::bigint[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Credenciais invalidas ou sem permissao de faturamento.' USING ERRCODE = '42501';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo para cancelar e reemitir a fatura.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.invoice_type, 'individual') NOT IN ('individual', 'consolidated') THEN
    RAISE EXCEPTION 'Cancelar e reemitir vale apenas para fatura de Taxas Locais.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('draft', 'issued', 'overdue') THEN
    RAISE EXCEPTION 'Somente fatura emitida e sem pagamento pode ser cancelada e reemitida.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Fatura com pagamento nao pode ser cancelada e reemitida; use fatura avulsa ou restituicao por correcao.' USING ERRCODE = '22023';
  END IF;

  IF v_invoice.invoice_type = 'consolidated' THEN
    SELECT COALESCE(ARRAY_AGG(DISTINCT l.bl_id ORDER BY l.bl_id), ARRAY[]::text[])
    INTO v_bl_ids
    FROM public.invoice_receivable_links l
    WHERE l.invoice_id = p_invoice_id;
  ELSE
    SELECT COALESCE(ARRAY_AGG(DISTINCT ib.bl_id ORDER BY ib.bl_id), ARRAY[]::text[])
    INTO v_bl_ids
    FROM public.invoice_bls ib
    WHERE ib.invoice_id = p_invoice_id;
  END IF;

  PERFORM public.cancel_invoice(p_invoice_id, v_reason, auth.uid());
  UPDATE public.invoices SET reissue_requested_at = now() WHERE id = p_invoice_id;
  v_cancelled := v_cancelled || p_invoice_id;

  IF v_invoice.invoice_type = 'consolidated' AND COALESCE(ARRAY_LENGTH(p_correct_bl_ids, 1), 0) > 0 THEN
    SELECT ARRAY_AGG(DISTINCT UPPER(TRIM(x))) INTO v_correct
    FROM UNNEST(p_correct_bl_ids) AS x
    WHERE TRIM(COALESCE(x, '')) <> '';

    IF EXISTS (SELECT 1 FROM UNNEST(v_correct) AS c(bl_id) WHERE c.bl_id <> ALL(v_bl_ids)) THEN
      RAISE EXCEPTION 'B/L informado nao pertence a esta consolidada.' USING ERRCODE = '22023';
    END IF;

    FOR v_individual IN
      SELECT DISTINCT inv.id
      FROM public.invoice_bls ib
      JOIN public.invoices inv ON inv.id = ib.invoice_id
      WHERE ib.bl_id = ANY(v_correct)
        AND inv.invoice_type = 'individual'
        AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
      ORDER BY inv.id
    LOOP
      IF EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_individual.id) THEN
        RAISE EXCEPTION 'A fatura individual % tem pagamento; corrija esse B/L por fatura avulsa ou restituicao.', v_individual.id USING ERRCODE = '22023';
      END IF;
      PERFORM public.cancel_invoice(v_individual.id, v_reason, auth.uid());
      UPDATE public.invoices SET reissue_requested_at = now() WHERE id = v_individual.id;
      v_cancelled := v_cancelled || v_individual.id;
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  ) VALUES (
    'invoice', p_invoice_id::text, 'cancel_invoice_for_reissue',
    COALESCE(v_invoice.status, 'issued'), 'cancelled', auth.uid(), now(), v_reason
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_type', v_invoice.invoice_type,
    'customer_id', v_invoice.customer_id,
    'bl_ids', to_jsonb(v_bl_ids),
    'cancelled_invoice_ids', to_jsonb(v_cancelled)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_invoice_for_reissue(bigint, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_invoice_for_reissue(bigint, text, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. A reemissão aponta para a fatura que substitui
-- ---------------------------------------------------------------------------
-- ponytail: a sucessora é a primeira emissão viva do mesmo tipo que cobre um
-- B/L (individual) ou recebível (consolidada) da cancelada. Se a reemissão
-- juntar B/Ls de duas canceladas, só a mais recente recebe o vínculo; a outra
-- continua em Reemissão pendente até a próxima emissão que a cubra.
CREATE OR REPLACE FUNCTION public.link_reissued_invoice() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_new record;
  v_previous bigint;
BEGIN
  SELECT id, invoice_type, status, replaces_invoice_id INTO v_new
  FROM public.invoices WHERE id = NEW.invoice_id;

  IF NOT FOUND OR v_new.replaces_invoice_id IS NOT NULL
     OR COALESCE(v_new.status, 'issued') = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'invoice_bls' THEN
    IF COALESCE(v_new.invoice_type, 'individual') <> 'individual' THEN
      RETURN NEW;
    END IF;
    SELECT inv.id INTO v_previous
    FROM public.invoice_bls ib
    JOIN public.invoices inv ON inv.id = ib.invoice_id
    WHERE ib.bl_id = NEW.bl_id
      AND inv.id <> NEW.invoice_id
      AND inv.invoice_type = 'individual'
      AND inv.status = 'cancelled'
      AND inv.reissue_requested_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = inv.id)
    ORDER BY inv.reissue_requested_at DESC, inv.id DESC
    LIMIT 1;
  ELSE
    IF v_new.invoice_type IS DISTINCT FROM 'consolidated' THEN
      RETURN NEW;
    END IF;
    SELECT inv.id INTO v_previous
    FROM public.invoice_receivable_links l
    JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE l.receivable_id = NEW.receivable_id
      AND inv.id <> NEW.invoice_id
      AND inv.invoice_type = 'consolidated'
      AND inv.status = 'cancelled'
      AND inv.reissue_requested_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = inv.id)
    ORDER BY inv.reissue_requested_at DESC, inv.id DESC
    LIMIT 1;
  END IF;

  IF v_previous IS NOT NULL THEN
    UPDATE public.invoices SET replaces_invoice_id = v_previous WHERE id = NEW.invoice_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.link_reissued_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS link_reissued_invoice_on_bl ON public.invoice_bls;
CREATE TRIGGER link_reissued_invoice_on_bl
  AFTER INSERT ON public.invoice_bls
  FOR EACH ROW EXECUTE FUNCTION public.link_reissued_invoice();

DROP TRIGGER IF EXISTS link_reissued_invoice_on_receivable ON public.invoice_receivable_links;
CREATE TRIGGER link_reissued_invoice_on_receivable
  AFTER INSERT ON public.invoice_receivable_links
  FOR EACH ROW EXECUTE FUNCTION public.link_reissued_invoice();

-- ---------------------------------------------------------------------------
-- 5. Leituras: Reemissão pendente e vínculo no detalhe
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_pending_reissues()
RETURNS TABLE(
  invoice_id bigint,
  invoice_number text,
  invoice_type text,
  customer_id bigint,
  customer_name text,
  cancelled_at timestamptz,
  cancel_reason text,
  bl_ids text[],
  receivable_ids bigint[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    inv.id,
    inv.invoice_number,
    inv.invoice_type,
    inv.customer_id,
    c.name,
    inv.cancelled_at,
    inv.cancel_reason,
    CASE WHEN inv.invoice_type = 'consolidated'
      THEN (SELECT COALESCE(ARRAY_AGG(DISTINCT l.bl_id ORDER BY l.bl_id), ARRAY[]::text[]) FROM public.invoice_receivable_links l WHERE l.invoice_id = inv.id)
      ELSE (SELECT COALESCE(ARRAY_AGG(DISTINCT ib.bl_id ORDER BY ib.bl_id), ARRAY[]::text[]) FROM public.invoice_bls ib WHERE ib.invoice_id = inv.id)
    END,
    (SELECT COALESCE(ARRAY_AGG(DISTINCT l.receivable_id ORDER BY l.receivable_id), ARRAY[]::bigint[]) FROM public.invoice_receivable_links l WHERE l.invoice_id = inv.id)
  FROM public.invoices inv
  LEFT JOIN public.customers c ON c.id = inv.customer_id
  WHERE inv.status = 'cancelled'
    AND inv.reissue_requested_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = inv.id)
  ORDER BY inv.cancelled_at DESC NULLS LAST, inv.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_pending_reissues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_reissues() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_invoice_reissue_links(p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invoice record;
  v_replaces jsonb;
  v_replaced_by jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT id, status, replaces_invoice_id, reissue_requested_at INTO v_invoice
  FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % nao encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_build_object('id', p.id, 'invoice_number', p.invoice_number) INTO v_replaces
  FROM public.invoices p WHERE p.id = v_invoice.replaces_invoice_id;

  SELECT jsonb_build_object('id', s.id, 'invoice_number', s.invoice_number) INTO v_replaced_by
  FROM public.invoices s WHERE s.replaces_invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'replaces', v_replaces,
    'replaced_by', v_replaced_by,
    'reissue_pending', v_invoice.reissue_requested_at IS NOT NULL AND v_replaced_by IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_invoice_reissue_links(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_reissue_links(bigint) TO authenticated;
