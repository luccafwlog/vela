-- 182 — COD na reimportação e documento da fatura (ADR 0078, itens 13 e 15;
-- Etapa 10 do plano 2026-10-09-correcao-importacoes-ce-mercante).
--
-- Data status: o backfill de `invoice_document_snapshots` congela, para as
-- faturas já emitidas, o documento lido dos dados atuais — não o da emissão.
-- Isso só é aceitável porque o AGENTS.md ("Data status — asserted 2026-09-18")
-- declara que a base de produção não tem dados reais de negócio.
--
-- 1. Reimportação de B/L de container não muda o POD de B/L em COD vivo
--    (a carga solta já mantinha, migration 173). A guarda vale só dentro da
--    reimportação (`vela.invoice_basis_source = 'bl_reimport_correction'`):
--    mudar o POD pela ficha continua sendo correção, nunca COD.
-- 2. B/L criado depois da omissão com POD no porto omitido entra como afetado,
--    disposição Transbordo, herdando o registro global, com Histórico.
-- 3. O documento da fatura congela Cliente (razão social, CNPJ, endereço),
--    Viagem, navio, POL e POD na emissão; o detalhe do Vela e do Portal
--    (impressão incluída) lê a cópia.

-- 1 ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._guard_cod_pod_on_reimport()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.pod IS DISTINCT FROM OLD.pod
     AND current_setting('vela.invoice_basis_source', true) = 'bl_reimport_correction'
     AND EXISTS (
       SELECT 1 FROM public.bl_transshipments AS t
       JOIN public.voyage_omissions AS o ON o.id = t.omission_id
       WHERE t.bl_id = OLD.id AND t.disposition = 'cod' AND o.reverted_at IS NULL
     ) THEN
    NEW.pod := OLD.pod;
    NEW.pod_port_id := OLD.pod_port_id;
    NEW.terminal_id := OLD.terminal_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._guard_cod_pod_on_reimport() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_cod_pod_on_reimport ON public.bls;
CREATE TRIGGER trg_guard_cod_pod_on_reimport
  BEFORE UPDATE OF pod ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public._guard_cod_pod_on_reimport();

-- 2 ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._attach_new_bl_to_voyage_omission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o record;
BEGIN
  FOR o IN
    SELECT id, omitted_pod, discharge_pod FROM public.voyage_omissions
    WHERE voyage_id = NEW.voyage_id AND reverted_at IS NULL
      AND omitted_pod = upper(btrim(COALESCE(NEW.pod, '')))
  LOOP
    INSERT INTO public.bl_transshipments(bl_id, omission_id, disposition, created_by)
    VALUES (NEW.id, o.id, 'transshipment', auth.uid())
    ON CONFLICT (bl_id, omission_id) DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bls', NEW.id, 'transbordo', NULL, o.discharge_pod, auth.uid(),
        'B/L importado depois da omissão de ' || o.omitted_pod || ': afetado, disposição Transbordo');
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._attach_new_bl_to_voyage_omission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_attach_new_bl_to_voyage_omission ON public.bls;
CREATE TRIGGER trg_attach_new_bl_to_voyage_omission
  AFTER INSERT ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public._attach_new_bl_to_voyage_omission();

-- 3 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.invoice_document_snapshots (
  invoice_id bigint PRIMARY KEY REFERENCES public.invoices(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invoice_document_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_document_snapshots_read ON public.invoice_document_snapshots
  FOR SELECT TO authenticated USING (public.is_active_read_user());
REVOKE ALL ON public.invoice_document_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.invoice_document_snapshots TO authenticated;

CREATE OR REPLACE FUNCTION public._build_invoice_document_snapshot(p_invoice_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH inv AS (SELECT * FROM public.invoices WHERE id = p_invoice_id),
  bl_ids AS (
    SELECT bl_id FROM public.invoice_bls WHERE invoice_id = p_invoice_id
    UNION SELECT bl_id FROM public.invoice_receivable_links WHERE invoice_id = p_invoice_id
    UNION SELECT bl_id FROM inv WHERE bl_id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf,
    'customer_address', NULLIF(concat_ws(' — ', NULLIF(btrim(c.address), ''),
      NULLIF(concat_ws('/', NULLIF(btrim(c.city), ''), NULLIF(btrim(c.state), '')), '')), ''),
    'voyage_number', v.voyage_number,
    'vessel_name', vs.name,
    'bls', COALESCE((
      SELECT jsonb_object_agg(b.id, jsonb_build_object(
        'pol', b.pol, 'pod', b.pod,
        'voyage_number', bv.voyage_number, 'vessel_name', bvs.name))
      FROM bl_ids JOIN public.bls AS b ON b.id = bl_ids.bl_id
      LEFT JOIN public.voyages AS bv ON bv.id = b.voyage_id
      LEFT JOIN public.vessels AS bvs ON bvs.id = bv.vessel_id
    ), '{}'::jsonb))
  FROM inv
  LEFT JOIN public.customers AS c ON c.id = inv.customer_id
  LEFT JOIN public.voyages AS v ON v.id = inv.voyage_id
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id;
$$;
REVOKE ALL ON FUNCTION public._build_invoice_document_snapshot(bigint) FROM PUBLIC, anon, authenticated;

-- Capturado no fim da transação da emissão: os vínculos de B/L já existem.
CREATE OR REPLACE FUNCTION public._capture_invoice_document_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'draft' AND EXISTS (SELECT 1 FROM public.invoices WHERE id = NEW.id) THEN
    INSERT INTO public.invoice_document_snapshots(invoice_id, snapshot)
    VALUES (NEW.id, public._build_invoice_document_snapshot(NEW.id))
    ON CONFLICT (invoice_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._capture_invoice_document_snapshot() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER trg_capture_invoice_document_snapshot
  AFTER INSERT OR UPDATE OF status ON public.invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._capture_invoice_document_snapshot();

INSERT INTO public.invoice_document_snapshots(invoice_id, snapshot)
SELECT id, public._build_invoice_document_snapshot(id) FROM public.invoices WHERE status <> 'draft'
ON CONFLICT (invoice_id) DO NOTHING;

-- Sobrepõe a cópia ao resultado {invoice, bls[]} das RPCs de detalhe.
CREATE OR REPLACE FUNCTION public._apply_invoice_document_snapshot(p_result jsonb, p_invoice_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s jsonb; v_bls jsonb;
BEGIN
  SELECT snapshot INTO s FROM public.invoice_document_snapshots WHERE invoice_id = p_invoice_id;
  IF s IS NULL OR p_result IS NULL OR jsonb_typeof(p_result->'invoice') IS DISTINCT FROM 'object' THEN
    RETURN p_result;
  END IF;
  p_result := jsonb_set(p_result, '{invoice}', (p_result->'invoice') || jsonb_strip_nulls(jsonb_build_object(
    'customer_name', s->'customer_name', 'customer_cnpj_cpf', s->'customer_cnpj_cpf',
    'customer_address', s->'customer_address',
    'voyage_number', s->'voyage_number', 'vessel_name', s->'vessel_name'))
    || jsonb_build_object('document_frozen_at', (SELECT captured_at FROM public.invoice_document_snapshots WHERE invoice_id = p_invoice_id)));
  IF jsonb_typeof(p_result->'bls') = 'array' THEN
    SELECT COALESCE(jsonb_agg(CASE WHEN s->'bls' ? (row->>'bl_id') THEN row || (s->'bls'->(row->>'bl_id')) ELSE row END ORDER BY ord), '[]'::jsonb)
      INTO v_bls FROM jsonb_array_elements(p_result->'bls') WITH ORDINALITY AS e(row, ord);
    p_result := jsonb_set(p_result, '{bls}', v_bls);
  END IF;
  RETURN p_result;
END $$;
REVOKE ALL ON FUNCTION public._apply_invoice_document_snapshot(jsonb, bigint) FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.list_invoice_details(bigint) RENAME TO _list_invoice_details_legacy_182;
REVOKE ALL ON FUNCTION public._list_invoice_details_legacy_182(bigint) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.list_invoice_details(p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public._apply_invoice_document_snapshot(public._list_invoice_details_legacy_182(p_invoice_id), p_invoice_id);
END $$;
REVOKE ALL ON FUNCTION public.list_invoice_details(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_invoice_details(bigint) TO authenticated;

ALTER FUNCTION public._portal_invoice_details_core(bigint, bigint) RENAME TO _portal_invoice_details_legacy_182;
REVOKE ALL ON FUNCTION public._portal_invoice_details_legacy_182(bigint, bigint) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public._portal_invoice_details_core(p_customer_id bigint, p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public._apply_invoice_document_snapshot(public._portal_invoice_details_legacy_182(p_customer_id, p_invoice_id), p_invoice_id);
END $$;
REVOKE ALL ON FUNCTION public._portal_invoice_details_core(bigint, bigint) FROM PUBLIC, anon, authenticated;
