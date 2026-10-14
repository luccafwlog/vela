-- Item 35 (B14) do plano 2026-10-14: os vazios, que não têm CE, travam com o
-- ADR de Saída fechado da escala (ADR 0071, item 4). O banco passa a recusar
-- excluir unidade manual e linha de serviço do Embarque de Vazios com o ADR
-- fechado, e Excluir unidade pede motivo, gravado no rastro. Reabrir o ADR
-- solta a trava. Só cria e redefine funções; não reescreve nem apaga linhas.

-- O Embarque de vazios é do ADR do terminal que tem a frente de exportação de
-- vazio; o ADR legado por porto (sem terminal) também trava a escala inteira.
CREATE OR REPLACE FUNCTION public._vazios_export_locked_by_adr(p_voyage_id bigint, p_port text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.agency_departure_reports AS r
    WHERE r.voyage_id = p_voyage_id
      AND upper(btrim(r.port)) = upper(btrim(COALESCE(p_port, '')))
      AND r.status = 'closed'
      AND (
        r.terminal_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.voyage_escala_operation_fronts AS f
          WHERE f.voyage_id = r.voyage_id AND f.port = upper(btrim(r.port))
            AND f.sentido = 'exportacao' AND f.modalidade = 'vazio'
            AND f.terminal_id = r.terminal_id
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public._vazios_export_locked_by_adr(bigint, text) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.delete_manual_vazios_booking(uuid);

CREATE OR REPLACE FUNCTION public.delete_manual_vazios_booking(p_booking_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_booking RECORD;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para excluir unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusao.' USING ERRCODE = '22023';
  END IF;

  SELECT b.id, b.manifest_id, b.voyage_id, COALESCE(op.embark_port, b.pol) AS port
    INTO v_booking
  FROM public.vazios_bookings AS b
  LEFT JOIN public.vazios_export_operations AS op ON op.id = b.operation_id
  WHERE b.id = p_booking_id;
  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Unidade embarcada nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF public._vazios_export_locked_by_adr(v_booking.voyage_id, v_booking.port) THEN
    RAISE EXCEPTION 'ADR de Saida fechado: reabra o ADR para excluir a unidade.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('vela.delete_reason', v_reason, true);
  DELETE FROM public.vazios_bookings WHERE id = p_booking_id;
  PERFORM set_config('vela.delete_reason', '', true);

  DELETE FROM public.vazios_manifests manifest
  WHERE manifest.id = v_booking.manifest_id
    AND manifest.description = 'Inclusao manual no Embarque de Vazios'
    AND NOT EXISTS (
      SELECT 1 FROM public.vazios_bookings booking
      WHERE booking.manifest_id = manifest.id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_manual_vazios_booking(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_manual_vazios_booking(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_catalog_row(p_table text, p_id text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;
  -- Linha de serviço de vazios é custo interno: qualquer usuário ativo exclui
  -- (ADR 0071, política da migration 087). O resto é do Administrativo.
  IF p_table <> 'vazios_export_service_lines' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo pode excluir.' USING ERRCODE = '42501';
  END IF;
  IF p_table NOT IN (
    'granite_rates', 'depots', 'depot_services', 'vazios_export_service_lines',
    'demurrage_rates', 'customer_demurrage_agreements', 'customer_rate_overrides',
    'charge_table_items'
  ) THEN
    RAISE EXCEPTION 'Tabela fora da exclusão de cadastro: %.', p_table USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.' USING ERRCODE = '22023';
  END IF;

  -- B14 (ADR 0071, item 4): linha de serviço de vazios trava com o ADR de
  -- Saída fechado da escala; reabrir o ADR solta a trava.
  IF p_table = 'vazios_export_service_lines' AND EXISTS (
    SELECT 1 FROM public.vazios_export_service_lines AS line
    JOIN public.vazios_export_operations AS op ON op.id = line.operation_id
    WHERE line.id::text = p_id AND public._vazios_export_locked_by_adr(op.voyage_id, op.embark_port)
  ) THEN
    RAISE EXCEPTION 'ADR de Saida fechado: reabra o ADR para excluir a linha de servico de vazios.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('vela.delete_reason', btrim(p_reason), true);
  -- ponytail: id::text evita um ramo por tipo de chave (uuid/bigint); perde o
  -- índice, aceitável em cadastros pequenos. Se uma tabela crescer, comparar
  -- no tipo da coluna.
  EXECUTE format('DELETE FROM public.%I WHERE id::text = $1', p_table) USING p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('vela.delete_reason', '', true);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nada foi excluído: o registro já não existe.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;
