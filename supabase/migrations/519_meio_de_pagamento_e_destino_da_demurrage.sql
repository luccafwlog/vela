-- 519: abas Pagas e Canceladas da Demurrage (lote 4 do plano da repaginação da
-- Demurrage; ADR 0112, D9 e D10).
--
-- 1. `demurrage_invoices.payment_method`: o meio da baixa, gravado na hora em
--    que a Invoice vira paga, por um gatilho que vale para todo caminho de
--    baixa (D9):
--    - `pix_itau`: Pix cobrado ou recebido pelo Itaú (o TXID ou o end-to-end
--      está em `itau_pix_charges` ou `itau_pix_receipts`), pela baixa
--      automática ou pela baixa manual do Pix recebido;
--    - `extrato`: conciliação pelo extrato (`confirm_demurrage_pix_matches`
--      avisa o gatilho por `vela.demurrage_payment_method`), ou TXID que o
--      Itaú não conhece;
--    - `isencao`: desconto integral (`apply_demurrage_discount`, BRL zero);
--    - `manual`: baixa registrada à mão, sem TXID.
--    Estorno da baixa (a Invoice sai de paga) apaga o meio.
-- 2. Preenche as Invoices já pagas pela origem conhecida, na mesma ordem: Pix
--    do Itaú, isenção registrada em `audit_logs` (`discount_exemption`),
--    `conciliated_by_extract`, e o resto como manual. Sem gatilho de auditoria
--    nem de `updated_at` nessa carga: não é uma mudança feita por alguém.
-- 3. `list_demurrage_invoice_details(ids)`: para as abas Pagas e Canceladas,
--    o ROE da foto de pagamento, o motivo, o autor e a hora do cancelamento
--    (de `audit_logs`, que o cancelamento à mão, a reemissão por datas e a
--    troca de CNPJ gravam igual) e o destino de cada caixa da Invoice
--    cancelada (D10): reemitida na Invoice que substitui, cobrada noutra
--    Invoice viva do mesmo Cliente na Viagem, dispensada, ou aguardando nova
--    Invoice. Leitura de usuário interno ativo.
--
-- Dados: depende da linha "Data status" do AGENTS.md (2026-09-18), porque o
-- item 2 reescreve linhas existentes de `demurrage_invoices`.
--
-- Rollback: `DROP FUNCTION public.list_demurrage_invoice_details(bigint[])` e
-- `public._demurrage_box_destination_rank(text)`;
-- `DROP TRIGGER trg_demurrage_invoice_payment_method ON
-- public.demurrage_invoices`; `DROP FUNCTION
-- public._demurrage_invoice_payment_method()`; recriar
-- `confirm_demurrage_pix_matches` como na 509; `ALTER TABLE
-- public.demurrage_invoices DROP COLUMN payment_method`.

ALTER TABLE public.demurrage_invoices
  ADD COLUMN IF NOT EXISTS payment_method text
  CONSTRAINT demurrage_invoices_payment_method_chk
  CHECK (payment_method IN ('pix_itau', 'extrato', 'manual', 'isencao'));

COMMENT ON COLUMN public.demurrage_invoices.payment_method IS
  'Meio da baixa (migration 519, ADR 0112 D9): pix_itau, extrato, manual ou isencao. Nulo fora de paga.';

-- O meio vem do contexto da baixa; sem ele, do TXID e do valor.
CREATE OR REPLACE FUNCTION public._demurrage_invoice_payment_method()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_txid text := NULLIF(btrim(NEW.pix_txid), '');
  v_hint text := NULLIF(current_setting('vela.demurrage_payment_method', true), '');
BEGIN
  IF NEW.status IS DISTINCT FROM 'paid' THEN
    NEW.payment_method := NULL;
    RETURN NEW;
  END IF;
  IF OLD.status = 'paid' AND NEW.payment_method IS NOT NULL THEN
    RETURN NEW;
  END IF;
  NEW.payment_method := CASE
    WHEN v_hint IN ('pix_itau', 'extrato', 'manual', 'isencao') THEN v_hint
    WHEN v_txid IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.itau_pix_charges AS c WHERE c.txid = v_txid)
      OR EXISTS (SELECT 1 FROM public.itau_pix_receipts AS r WHERE r.end_to_end_id = v_txid OR r.txid = v_txid)
    ) THEN 'pix_itau'
    WHEN v_txid IS NOT NULL THEN 'extrato'
    WHEN COALESCE(NEW.current_total_brl, 0) = 0 AND COALESCE(NEW.discount_value, 0) > 0 THEN 'isencao'
    ELSE 'manual'
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._demurrage_invoice_payment_method() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_demurrage_invoice_payment_method ON public.demurrage_invoices;
CREATE TRIGGER trg_demurrage_invoice_payment_method
  BEFORE UPDATE OF status, paid_at, pix_txid, current_total_brl ON public.demurrage_invoices
  FOR EACH ROW EXECUTE FUNCTION public._demurrage_invoice_payment_method();

-- A conciliação pelo extrato diz ao gatilho que a baixa veio do extrato, mesmo
-- quando o TXID é de uma cobrança do Itaú. Corpo da 509 mais o aviso.
CREATE OR REPLACE FUNCTION public.confirm_demurrage_pix_matches(p_matches jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para conciliar Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array' THEN
    RAISE EXCEPTION 'Lista de conciliacao invalida.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('vela.demurrage_payment_method', 'extrato', true);
  FOR r IN SELECT * FROM jsonb_to_recordset(p_matches) AS x(invoice_id bigint, paid_at date, pix_txid text, total_brl numeric, ptax_used numeric)
  LOOP
    PERFORM public.register_demurrage_payment(gen_random_uuid(), r.invoice_id, r.paid_at, r.pix_txid, r.total_brl, r.ptax_used);
    v_count := v_count + 1;
  END LOOP;
  PERFORM set_config('vela.demurrage_payment_method', '', true);
  RETURN v_count;
END;
$function$;

-- Carga das Invoices já pagas (item 2).
ALTER TABLE public.demurrage_invoices DISABLE TRIGGER audit_demurrage_invoices;
ALTER TABLE public.demurrage_invoices DISABLE TRIGGER trg_demurrage_invoice_updated_at;
UPDATE public.demurrage_invoices AS d
   SET payment_method = CASE
     WHEN NULLIF(btrim(d.pix_txid), '') IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.itau_pix_charges AS c WHERE c.txid = btrim(d.pix_txid))
       OR EXISTS (SELECT 1 FROM public.itau_pix_receipts AS r WHERE r.end_to_end_id = btrim(d.pix_txid) OR r.txid = btrim(d.pix_txid))
     ) THEN 'pix_itau'
     WHEN EXISTS (
       SELECT 1 FROM public.audit_logs AS a
        WHERE a.entity_type = 'demurrage_invoice' AND a.entity_id = d.id::text AND a.field_name = 'discount_exemption'
     ) THEN 'isencao'
     WHEN d.conciliated_by_extract OR NULLIF(btrim(d.pix_txid), '') IS NOT NULL THEN 'extrato'
     ELSE 'manual'
   END
 WHERE d.status = 'paid' AND d.payment_method IS NULL;
ALTER TABLE public.demurrage_invoices ENABLE TRIGGER trg_demurrage_invoice_updated_at;
ALTER TABLE public.demurrage_invoices ENABLE TRIGGER audit_demurrage_invoices;

-- Ordem do destino da caixa: a Invoice que substitui, outra Invoice viva, a
-- dispensa e, sem nada disso, aguardando.
CREATE OR REPLACE FUNCTION public._demurrage_box_destination_rank(p_kind text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_kind WHEN 'reemitida' THEN 1 WHEN 'cobrada' THEN 2 WHEN 'dispensada' THEN 3 ELSE 4 END;
$function$;

-- Item 3. A caixa é a chave normalizada (`upper(btrim(número))`), como na
-- cobrança por caixa (214).
CREATE OR REPLACE FUNCTION public.list_demurrage_invoice_details(p_invoice_ids bigint[])
 RETURNS TABLE(
   invoice_id bigint,
   payment_roe numeric,
   cancel_reason text,
   cancelled_by uuid,
   cancelled_at timestamptz,
   box_destinations jsonb
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para ler as Invoices de Demurrage.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH inv AS (
    SELECT d.id, d.status, d.customer_id, b.voyage_id
      FROM public.demurrage_invoices AS d
      LEFT JOIN public.bls AS b ON b.id = d.bl_id
     WHERE d.id = ANY(COALESCE(p_invoice_ids, ARRAY[]::bigint[]))
  ),
  boxes AS (
    SELECT DISTINCT inv.id AS invoice_id, inv.customer_id, inv.voyage_id,
           upper(btrim(item.container_number)) AS box
      FROM inv
      JOIN public.demurrage_invoice_items AS item ON item.invoice_id = inv.id
     WHERE inv.status = 'cancelled' AND NULLIF(btrim(item.container_number), '') IS NOT NULL
  ),
  box_dest AS (
    SELECT bx.invoice_id, bx.box, dest.kind, dest.target_id, dest.target_doc
      FROM boxes AS bx
      CROSS JOIN LATERAL (
        SELECT opt.kind, opt.target_id, opt.target_doc
          FROM (
            SELECT CASE WHEN live.replaces_invoice_id = bx.invoice_id THEN 'reemitida' ELSE 'cobrada' END AS kind,
                   live.id AS target_id, live.doc_number AS target_doc
              FROM public.demurrage_invoices AS live
              JOIN public.demurrage_invoice_items AS li ON li.invoice_id = live.id
              LEFT JOIN public.bls AS lb ON lb.id = live.bl_id
             WHERE live.status IN ('issued', 'overdue', 'paid')
               AND upper(btrim(li.container_number)) = bx.box
               AND (live.replaces_invoice_id = bx.invoice_id
                    OR (live.customer_id = bx.customer_id AND lb.voyage_id = bx.voyage_id))
            UNION ALL
            SELECT 'dispensada', NULL::bigint, NULL::text
              FROM public.demurrage_box_waivers AS w
             WHERE w.voyage_id = bx.voyage_id AND w.customer_id = bx.customer_id
               AND w.container_key = bx.box AND w.revoked_at IS NULL
            UNION ALL
            SELECT 'aguardando', NULL::bigint, NULL::text
          ) AS opt
         ORDER BY public._demurrage_box_destination_rank(opt.kind), opt.target_id DESC NULLS LAST
         LIMIT 1
      ) AS dest
  ),
  dest_by_invoice AS (
    SELECT g.invoice_id,
           jsonb_agg(jsonb_build_object('kind', g.kind, 'invoice_id', g.target_id, 'doc_number', g.target_doc, 'containers', g.containers)
                     ORDER BY public._demurrage_box_destination_rank(g.kind), g.target_doc) AS destinations
      FROM (
        SELECT invoice_id, kind, target_id, target_doc, array_agg(box ORDER BY box) AS containers
          FROM box_dest
         GROUP BY invoice_id, kind, target_id, target_doc
      ) AS g
     GROUP BY g.invoice_id
  )
  SELECT inv.id,
         (SELECT h.roe_used FROM public.demurrage_invoice_history AS h
           WHERE h.invoice_id = inv.id AND h.source = 'payment'
           ORDER BY h.event_date DESC, h.id DESC LIMIT 1),
         cancel_log.justification,
         cancel_log.changed_by,
         cancel_log.changed_at,
         COALESCE(dbi.destinations, '[]'::jsonb)
    FROM inv
    LEFT JOIN LATERAL (
      SELECT a.justification, a.changed_by, a.changed_at
        FROM public.audit_logs AS a
       WHERE inv.status = 'cancelled'
         AND a.entity_type = 'demurrage_invoice' AND a.entity_id = inv.id::text
         AND a.field_name = 'status' AND a.new_value = 'cancelled'
       ORDER BY a.changed_at DESC, a.id DESC
       LIMIT 1
    ) AS cancel_log ON true
    LEFT JOIN dest_by_invoice AS dbi ON dbi.invoice_id = inv.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_demurrage_invoice_details(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_demurrage_invoice_details(bigint[]) TO authenticated;
