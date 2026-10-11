-- 195: correções do CE Mercante depois da revisão da PR das importações
-- (ADR 0078, itens 2, 3, 4, 5, 6 e 9; achados K1 a K12 da revisão da PR 929).
--
-- 1. Emissão pelo CE (K1): B/L que só espera (Cliente não conciliado, Revisão
--    pendente) não abre mais "Falha de emissão automática" com "motivo não
--    informado"; `emit_ce_mercante_billing` devolve a frase de negócio
--    ("Aguardando conciliação do Cliente", "Aguardando Revisão do B/L") com
--    `waiting = true`. O alerta fica para a falha técnica real e fecha quando
--    a fatura do B/L sai: no próprio lote (`invoiced`/`already_invoiced`) e,
--    por qualquer outro caminho (gatilho do CE, fila de efeitos, Portal,
--    Emitir fatura), pelo gatilho `resolve_auto_issue_alert_on_invoiced`.
-- 2. Desbloqueio de CE conferido (K2): a troca ou a remoção do CE pela ficha
--    também abre `ce_trocado_com_desbloqueio`. A checagem sai do lote da
--    planilha e vai para a porta única `_set_bl_ce_mercante` (um alerta por
--    troca, qualquer que seja a porta).
-- 3. `apply_ce_mercante_update` (K3) perde EXECUTE de `authenticated`: não tem
--    chamador na tela e trocava CE pela API sem confirmação nem motivo. Fica
--    para `service_role` (manutenção e fixtures).
-- 4. Fatura viva (K4): Remover CE e a prévia da planilha passam a enxergar a
--    fatura consolidada, que liga o B/L por `invoice_receivable_links`
--    (`_live_local_invoice_ids_for_bl`), além de `invoices.bl_id` e
--    `invoice_bls` (`_bl_live_invoice_numbers`).
-- 5. Alerta "CE Mercante pendente" da Viagem (K6): porto comparado na forma
--    normalizada dos dois lados (`normalize_port_code`); B/L e rota de vazios
--    com sinônimo (BRVIT, VITORIA, NAVEGANTES) não acendem o alerta à toa nem
--    ficam fora da contagem.
-- 6. Prévia da planilha (K7): o CE que já está num B/L de Granito é erro na
--    prévia, como na gravação (antes a prévia passava e a gravação recusava).
-- 7. Rastro (K8): o Histórico do CE, do Manifesto criado e do vínculo leva o
--    contexto da importação (tipo, Viagem, Manifesto e rota) e o motivo.
-- 8. Mesmo CE em outro formato (K10): CE legado com máscara ou sem zero à
--    esquerda e a mesma chave (`ce_mercante_key`) é normalização, não troca:
--    grava a forma canônica, registra no Histórico e não abre reenvio nem
--    alerta de Desbloqueio.
-- 9. B/L novo com CE (K12): `guard_bl_ce_mercante_port` passa a cobrir INSERT;
--    pela API o B/L nasce sem CE e o CE entra pela planilha.
--
-- Não reescreve linhas existentes: alertas `billing_auto_issue_failed` já
-- abertos para B/L faturado fecham na próxima emissão do lote ou à mão.
--
-- Rollback: reaplicar `_set_bl_ce_mercante`, `_analyze_ce_mercante_rows`,
-- `apply_ce_mercante_rows_atomic_legacy_189` (corpo da 181, renomeado na 189),
-- `emit_ce_mercante_billing` e `remove_bl_ce_mercante` das migrations 181 e
-- 177; `reconcile_voyage_ce_mercante_missing_alerts` da 179;
-- `guard_bl_ce_mercante_port` e o gatilho `BEFORE UPDATE OF ce_mercante` da
-- 177; `GRANT EXECUTE ON FUNCTION apply_ce_mercante_update TO authenticated`
-- (016); DROP do gatilho e da função `resolve_auto_issue_alert_on_invoiced` e
-- da função `_bl_live_invoice_numbers`.

-- 4. Fatura viva do B/L: individual, `invoice_bls` e consolidada pelo vínculo
-- de recebível (dono: `_live_local_invoice_ids_for_bl`, migration 136).
CREATE OR REPLACE FUNCTION public._bl_live_invoice_numbers(p_bl_id text)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT i.invoice_number ORDER BY i.invoice_number), ARRAY[]::text[])
  FROM public.invoices AS i
  WHERE COALESCE(i.status, 'issued') NOT IN ('draft', 'cancelled', 'obsolete')
    AND i.id IN (
      SELECT inv.id FROM public.invoices AS inv WHERE inv.bl_id = p_bl_id
      UNION
      SELECT ib.invoice_id FROM public.invoice_bls AS ib WHERE ib.bl_id = p_bl_id
      UNION
      SELECT unnest(public._live_local_invoice_ids_for_bl(p_bl_id))
    );
$function$;

REVOKE ALL ON FUNCTION public._bl_live_invoice_numbers(text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._bl_live_invoice_numbers(text) IS
  'Números das faturas vivas (não rascunho, cancelada nem obsoleta) que cobram o B/L: individual, invoice_bls e consolidada por invoice_receivable_links (migration 195).';

-- 2, 8. Porta única do CE: normalização sem troca e alerta de Desbloqueio.
CREATE OR REPLACE FUNCTION public._set_bl_ce_mercante(p_bl_id text, p_ce text, p_actor uuid, p_reason text, p_source text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ce text := NULLIF(regexp_replace(COALESCE(p_ce, ''), '\s', '', 'g'), '');
  v_old text;
  v_old_ce text;
  v_previous text := current_setting('vela.ce_mercante_port', true);
  v_result text;
BEGIN
  IF v_ce IS NOT NULL AND v_ce !~ '^[0-9]{15}$' THEN
    RAISE EXCEPTION 'CE Mercante invalido para o B/L %: o CE tem 15 digitos (recebido "%").', p_bl_id, p_ce
      USING ERRCODE = '22023';
  END IF;

  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  v_old_ce := NULLIF(btrim(COALESCE(v_old, '')), '');
  IF v_old_ce IS NOT DISTINCT FROM v_ce THEN
    RETURN 'unchanged';
  END IF;

  -- Mesmo CE em outro formato (máscara, zero à esquerda): a prévia mostra "Sem
  -- mudança"; grava a forma canônica sem reenvio nem alerta (K10).
  IF v_old_ce IS NOT NULL AND v_ce IS NOT NULL
     AND public.ce_mercante_key(v_old_ce) = public.ce_mercante_key(v_ce) THEN
    PERFORM set_config('vela.ce_mercante_port', 'on', true);
    PERFORM public._audit_skip_once('bls', p_bl_id, 'ce_mercante');
    UPDATE public.bls SET ce_mercante = v_ce WHERE id = p_bl_id;
    PERFORM set_config('vela.ce_mercante_port', COALESCE(v_previous, 'off'), true);
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', p_bl_id, 'ce_mercante', v_old, v_ce, p_actor,
      concat_ws(' · ', 'Formato do CE Mercante normalizado (mesmo número)', NULLIF(btrim(COALESCE(p_reason, '')), '')));
    RETURN 'unchanged';
  END IF;

  PERFORM set_config('vela.ce_mercante_port', 'on', true);
  -- O fato vai no Histórico abaixo, com motivo; o gatilho genérico não repete.
  PERFORM public._audit_skip_once('bls', p_bl_id, 'ce_mercante');
  UPDATE public.bls SET ce_mercante = v_ce WHERE id = p_bl_id;
  PERFORM set_config('vela.ce_mercante_port', COALESCE(v_previous, 'off'), true);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'ce_mercante', COALESCE(v_old, ''), COALESCE(v_ce, ''), p_actor, p_reason);

  v_result := CASE
    WHEN v_ce IS NULL THEN 'removed'
    WHEN v_old_ce IS NULL THEN 'inserted'
    ELSE 'overwritten'
  END;

  -- Comunicado de CE e Taxas já enviado com o CE anterior: o Cliente precisa
  -- recebê-lo de novo (ADR 0078, itens 4 e 5).
  IF v_result <> 'inserted' AND EXISTS (
    SELECT 1 FROM public.customer_communications AS c
    JOIN public.customer_communication_bls AS cb ON cb.communication_id = c.id
    WHERE cb.bl_id = p_bl_id AND c.kind = 'ce_mercante_taxas' AND c.status IN ('enviado', 'parcial')
  ) THEN
    BEGIN
      PERFORM public.upsert_alert_item(
        'comunicado_ce_reenvio_pendente', 'bl', p_bl_id,
        format('O CE Mercante do B/L %s mudou (%s -> %s) depois do Comunicado de CE e Taxas: reenvie o Comunicado ao Cliente.',
          p_bl_id, COALESCE(v_old, 'sem CE'), COALESCE(v_ce, 'removido')),
        p_source,
        jsonb_build_object('bl_id', p_bl_id, 'old_ce', v_old, 'new_ce', v_ce, 'reason', p_reason),
        '/bls/' || p_bl_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Nao foi possivel abrir a pendencia de reenvio do B/L %: %', p_bl_id, SQLERRM;
    END;
  END IF;

  -- Troca ou remoção depois do Desbloqueio de CE conferido, por qualquer porta
  -- (planilha ou ficha): abre o alerta (ADR 0078, itens 2 e 4; K2).
  IF v_result <> 'inserted' AND EXISTS (
    SELECT 1 FROM public.ce_unlock_request_bls AS u
    WHERE u.bl_id = p_bl_id AND u.active AND u.confirmed_at IS NOT NULL
  ) THEN
    PERFORM public.upsert_alert_item(
      'ce_trocado_com_desbloqueio', 'bl', p_bl_id,
      CASE WHEN v_ce IS NULL
        THEN format('O CE Mercante do B/L %s foi removido (era %s) depois do Desbloqueio de CE conferido.', p_bl_id, v_old_ce)
        ELSE format('O CE Mercante do B/L %s mudou (%s -> %s) depois do Desbloqueio de CE conferido.', p_bl_id, v_old_ce, v_ce)
      END,
      p_source,
      jsonb_build_object('bl_id', p_bl_id, 'old_ce', v_old_ce, 'new_ce', v_ce, 'reason', p_reason),
      '/bls/' || p_bl_id);
  END IF;

  RETURN v_result;
END;
$function$;

-- 4. Remover CE: a fatura consolidada também trava.
CREATE OR REPLACE FUNCTION public.remove_bl_ce_mercante(p_bl_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_invoices text;
  v_result text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da remocao do CE Mercante.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  v_invoices := NULLIF(array_to_string(public._bl_live_invoice_numbers(p_bl_id), ', '), '');
  IF v_invoices IS NOT NULL THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % nao pode ser removido: ha fatura emitida (%). O Administrativo precisa cancelar a fatura antes.', p_bl_id, v_invoices
      USING ERRCODE = 'P0011';
  END IF;
  v_result := public._set_bl_ce_mercante(p_bl_id, NULL, auth.uid(), 'Remocao do CE Mercante pela ficha: ' || v_reason, 'ce_mercante_ficha');
  RETURN jsonb_build_object('status', v_result, 'bl_id', p_bl_id);
END;
$function$;

-- 4, 7. Prévia: consolidada em `live_invoices`; CE em B/L de Granito é erro.
CREATE OR REPLACE FUNCTION public._analyze_ce_mercante_rows(p_rows jsonb, p_manifesto_numero text, p_voyage_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_numero text := public.canonical_manifesto_numero(p_manifesto_numero);
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_item jsonb;
  v_bl public.bls%ROWTYPE;
  v_new_ce text;
  v_holders text;
  v_route record;
  v_routes integer;
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_has_manifesto boolean := false;
  v_active_ids text[] := ARRAY[]::text[];
  v_current_numero text;
  v_status text;
  v_changes integer := 0;
  v_moves integer := 0;
  v_route_voyage bigint;
  v_route_pol text;
  v_route_pod text;
BEGIN
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')),
      'warnings', '[]'::jsonb, 'rows', '[]'::jsonb);
  END IF;
  IF v_numero IS NULL THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('message', 'Informe o número do Manifesto Mercante deste lote antes de importar.'));
  ELSIF v_numero !~ '^[A-Z0-9]{13}$' THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
      format('Nº de Manifesto Mercante inválido: "%s". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_manifesto_numero)));
  ELSE
    SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
    v_has_manifesto := FOUND;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_new_ce := NULLIF(regexp_replace(COALESCE(v_item->>'ce', ''), '\s', '', 'g'), '');
    SELECT * INTO v_bl FROM public.bls WHERE id = btrim(v_item->>'bl_id');
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_item->>'bl_id',
        'message', format('B/L %s não encontrado no sistema.', v_item->>'bl_id')));
      CONTINUE;
    END IF;
    IF v_bl.cancelled_at IS NOT NULL THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('B/L %s cancelado: a linha é ignorada.', v_bl.id)));
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id, 'status', 'cancelled'));
      CONTINUE;
    END IF;
    IF v_new_ce IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('Linha sem CE Mercante para o B/L %s.', v_bl.id)));
      CONTINUE;
    END IF;
    IF v_new_ce !~ '^[0-9]{15}$' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('CE Mercante inválido para o B/L %s: o CE tem 15 dígitos.', v_bl.id)));
      CONTINUE;
    END IF;
    -- Unicidade como no gatilho `guard_ce_mercante_unique`: B/Ls de carga não
    -- cancelados e B/Ls de Granito (ADR 0078, item 3; K7).
    SELECT string_agg(holder, ', ' ORDER BY holder) INTO v_holders FROM (
      SELECT other.id AS holder
      FROM public.bls AS other
      WHERE other.id <> v_bl.id AND other.cancelled_at IS NULL
        AND public.ce_mercante_key(other.ce_mercante) = public.ce_mercante_key(v_new_ce)
      UNION ALL
      SELECT 'B/L de Granito ' || g.bl_number
      FROM public.granite_bls AS g
      WHERE public.ce_mercante_key(g.ce_mercante) = public.ce_mercante_key(v_new_ce)
    ) AS holders;
    IF v_holders IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_item->'row', 'bl_id', v_bl.id,
        'message', format('O CE Mercante %s já está em outro B/L não cancelado (%s).', v_new_ce, v_holders)));
      CONTINUE;
    END IF;

    v_active_ids := array_append(v_active_ids, v_bl.id);
    SELECT numero INTO v_current_numero FROM public.manifestos_mercante WHERE id = v_bl.manifesto_mercante_id;
    v_status := CASE
      WHEN NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NULL THEN 'new'
      WHEN public.ce_mercante_key(v_bl.ce_mercante) = public.ce_mercante_key(v_new_ce) THEN 'same'
      ELSE 'change'
    END;
    IF v_status = 'change' THEN v_changes := v_changes + 1; END IF;
    IF v_current_numero IS NOT NULL AND v_numero IS NOT NULL AND v_current_numero IS DISTINCT FROM v_numero THEN
      v_moves := v_moves + 1;
    END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'row', v_item->'row',
      'bl_id', v_bl.id,
      'status', v_status,
      'current_ce', NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), ''),
      'new_ce', v_new_ce,
      'current_manifesto', v_current_numero,
      'target_manifesto', v_numero,
      'manifesto_change', v_current_numero IS NOT NULL AND v_current_numero IS DISTINCT FROM v_numero,
      'live_invoices', to_jsonb(public._bl_live_invoice_numbers(v_bl.id)),
      'portal_visible', v_bl.customer_id IS NOT NULL AND NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NOT NULL
        AND public.customer_portal_access_ready(v_bl.customer_id),
      'comunicado_sent', EXISTS (
        SELECT 1 FROM public.customer_communications AS c
        JOIN public.customer_communication_bls AS cb ON cb.communication_id = c.id
        WHERE cb.bl_id = v_bl.id AND c.kind = 'ce_mercante_taxas' AND c.status IN ('enviado', 'parcial')),
      'unlock_confirmed', EXISTS (
        SELECT 1 FROM public.ce_unlock_request_bls AS u WHERE u.bl_id = v_bl.id AND u.active AND u.confirmed_at IS NOT NULL)
    ));
  END LOOP;

  IF cardinality(v_active_ids) > 0 AND v_numero ~ '^[A-Z0-9]{13}$' THEN
    SELECT count(DISTINCT (b.voyage_id, public.normalize_port_code(b.pol), public.normalize_port_code(b.pod))) INTO v_routes
    FROM public.bls AS b WHERE b.id = ANY(v_active_ids);
    SELECT b.voyage_id, btrim(b.pol) AS pol, btrim(b.pod) AS pod INTO v_route FROM public.bls AS b WHERE b.id = ANY(v_active_ids) ORDER BY b.id LIMIT 1;
    v_route_voyage := v_route.voyage_id; v_route_pol := v_route.pol; v_route_pod := v_route.pod;
    IF v_routes > 1 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'Os B/Ls da planilha são de mais de uma viagem ou rota (POL → POD). Um manifesto tem uma única rota: separe a planilha por manifesto.'));
    ELSIF NULLIF(v_route.pol, '') IS NULL OR NULLIF(v_route.pod, '') IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        'Os B/Ls da planilha não têm POL e POD cadastrados; sem rota não há manifesto.'));
    ELSIF p_voyage_id IS NOT NULL AND v_route.voyage_id IS DISTINCT FROM p_voyage_id THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message', 'Os B/Ls da planilha não pertencem à viagem selecionada.'));
    ELSIF v_has_manifesto AND (
      v_manifesto.voyage_id IS DISTINCT FROM v_route.voyage_id
      OR COALESCE(public.normalize_port_code(v_manifesto.pol), upper(v_manifesto.pol)) IS DISTINCT FROM public.normalize_port_code(v_route.pol)
      OR COALESCE(public.normalize_port_code(v_manifesto.pod), upper(v_manifesto.pod)) IS DISTINCT FROM public.normalize_port_code(v_route.pod)
      OR v_manifesto.natureza <> 'carga'
    ) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('message',
        format('O Manifesto Mercante %s já está cadastrado para outra viagem, rota ou natureza.', v_numero)));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'errors', v_errors,
    'warnings', v_warnings,
    'rows', v_rows,
    'active_bl_ids', to_jsonb(v_active_ids),
    'manifesto', jsonb_build_object('numero', v_numero, 'exists', v_has_manifesto,
      'voyage_id', v_route_voyage, 'pol', v_route_pol, 'pod', v_route_pod),
    'changes', v_changes,
    'moves', v_moves,
    'needs_confirmation', (v_changes + v_moves) > 0
  );
END;
$function$;

-- 2, 7. Planilha de CE: o alerta de Desbloqueio vem da porta única (sem
-- duplicar); a justificativa leva tipo, Viagem, Manifesto, rota e motivo.
CREATE OR REPLACE FUNCTION public.apply_ce_mercante_rows_atomic_legacy_189(p_rows jsonb, p_changed_by uuid, p_target text DEFAULT 'bls'::text, p_manifesto_numero text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_confirm_changes boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_defer_billing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_row jsonb;
  v_result text;
  v_errors jsonb := '[]'::jsonb;
  v_analysis jsonb;
  v_inserted integer := 0;
  v_overwritten integer := 0;
  v_unchanged integer := 0;
  v_numero text := public.canonical_manifesto_numero(p_manifesto_numero);
  v_bl_ids text[];
  v_active text[];
  v_voyage bigint;
  v_manifesto public.manifestos_mercante%ROWTYPE;
  v_created boolean := false;
  v_pending text[] := ARRAY[]::text[];
  v_previous_deferred text := current_setting('vela.ce_billing_deferred', true);
  v_message text;
  v_state text;
  v_justification text;
  v_route_pol text;
  v_route_pod text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_target NOT IN ('bls', 'granite') THEN
    RAISE EXCEPTION 'Destino de CE Mercante inválido: %', p_target USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('message', 'Nenhuma linha para importar.')));
  END IF;

  IF p_target = 'granite' THEN
    BEGIN
      FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
        BEGIN
          v_result := public.apply_granite_ce_mercante_update((v_row->>'bl_id')::uuid, v_row->>'ce', p_changed_by);
          CASE v_result
            WHEN 'overwritten' THEN v_overwritten := v_overwritten + 1;
            WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
            ELSE v_inserted := v_inserted + 1;
          END CASE;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row->'row', 'bl_id', v_row->>'bl_id',
            'message', public._ce_row_error_message(v_state, v_message)));
        END;
      END LOOP;
      IF jsonb_array_length(v_errors) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ce_rows_rollback';
      END IF;
    EXCEPTION WHEN SQLSTATE 'P0099' THEN
      RETURN jsonb_build_object('ok', false, 'errors', v_errors);
    END;
    RETURN jsonb_build_object('ok', true, 'processed', jsonb_array_length(p_rows),
      'inserted', v_inserted, 'overwritten', v_overwritten, 'unchanged', v_unchanged);
  END IF;

  -- Trava a Viagem antes dos B/Ls: duas planilhas da mesma Viagem não se
  -- cruzam travando os B/Ls em ordens diferentes (deadlock, ADR 0078 item 9).
  SELECT array_agg(DISTINCT btrim(value->>'bl_id')) INTO v_bl_ids FROM jsonb_array_elements(p_rows);
  SELECT COALESCE(p_voyage_id, (SELECT b.voyage_id FROM public.bls AS b WHERE b.id = ANY(v_bl_ids) ORDER BY b.id LIMIT 1)) INTO v_voyage;
  IF v_voyage IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ce_mercante_voyage:' || v_voyage, 180));
  END IF;
  PERFORM 1 FROM public.bls WHERE id = ANY(v_bl_ids) ORDER BY id FOR UPDATE;

  v_analysis := public._analyze_ce_mercante_rows(p_rows, p_manifesto_numero, p_voyage_id);
  IF jsonb_array_length(v_analysis->'errors') > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_analysis->'errors', 'warnings', v_analysis->'warnings');
  END IF;
  IF (v_analysis->>'needs_confirmation')::boolean AND (NOT p_confirm_changes OR v_reason IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'needs_confirmation', true, 'warnings', v_analysis->'warnings',
      'errors', jsonb_build_array(jsonb_build_object('message', format(
        'A planilha troca o CE de %s B/L(s) e muda o Manifesto de %s B/L(s): confirme na prévia, com motivo.',
        v_analysis->>'changes', v_analysis->>'moves'))));
  END IF;
  v_active := ARRAY(SELECT jsonb_array_elements_text(v_analysis->'active_bl_ids'));

  -- Rastro (ADR 0078, item 9; K8): o invólucro da 189 define o contexto com a
  -- Viagem informada; sem Viagem na tela, vale a dos B/Ls. O Histórico do CE,
  -- do Manifesto criado e do vínculo leva o contexto, a rota e o motivo. A
  -- planilha de CE refina o contexto que o próprio invólucro gravou (a 190 faz
  -- o primeiro contexto da transação valer até o fim; aqui ele é o mesmo, só
  -- mais completo).
  PERFORM set_config('vela.import_context', '', true);
  PERFORM public._set_import_context('CE Mercante',
    COALESCE((v_analysis->'manifesto'->>'voyage_id')::bigint, v_voyage), COALESCE(v_numero, p_manifesto_numero));
  v_route_pol := NULLIF(v_analysis->'manifesto'->>'pol', '');
  v_route_pod := NULLIF(v_analysis->'manifesto'->>'pod', '');
  v_justification := concat_ws(' · ',
    COALESCE(NULLIF(btrim(current_setting('vela.import_context', true)), ''), 'Importação de CE Mercante'),
    CASE WHEN v_route_pol IS NOT NULL AND v_route_pod IS NOT NULL THEN
      'Rota ' || COALESCE(public.normalize_port_code(v_route_pol), upper(v_route_pol))
        || ' → ' || COALESCE(public.normalize_port_code(v_route_pod), upper(v_route_pod)) END,
    CASE WHEN v_reason IS NOT NULL THEN 'Motivo: ' || v_reason END);

  IF cardinality(v_active) > 0 THEN
    SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
    v_created := NOT FOUND;
  END IF;

  IF p_defer_billing THEN
    PERFORM set_config('vela.ce_billing_deferred', 'on', true);
  END IF;

  BEGIN
    FOR v_row IN
      SELECT value FROM jsonb_array_elements(v_analysis->'rows')
      WHERE value->>'status' IN ('new', 'same', 'change')
    LOOP
      BEGIN
        -- A troca com Desbloqueio conferido abre o alerta na porta única
        -- (`_set_bl_ce_mercante`, migration 195).
        v_result := public._set_bl_ce_mercante(v_row->>'bl_id', v_row->>'new_ce', v_actor, v_justification, 'ce_mercante_planilha');
        CASE v_result
          WHEN 'overwritten' THEN v_overwritten := v_overwritten + 1;
          WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
          ELSE v_inserted := v_inserted + 1;
        END CASE;
        IF v_result <> 'unchanged' THEN
          -- Rede da emissão: o efeito revalida e não refatura (migration 178).
          INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
          VALUES (gen_random_uuid(), 'local_billing', v_row->>'bl_id', v_actor)
          ON CONFLICT (source_action_id, effect_kind, entity_id) DO NOTHING;
          v_pending := array_append(v_pending, v_row->>'bl_id');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_row->'row', 'bl_id', v_row->>'bl_id',
          'message', public._ce_row_error_message(v_state, v_message)));
      END;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ce_rows_rollback';
    END IF;

    IF cardinality(v_active) > 0 THEN
      PERFORM public._upsert_route_manifesto((v_analysis->'manifesto'->>'voyage_id')::bigint,
        v_analysis->'manifesto'->>'pol', v_analysis->'manifesto'->>'pod', 'carga', v_numero);
      SELECT * INTO v_manifesto FROM public.manifestos_mercante WHERE numero = v_numero;
      IF v_created THEN
        INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
        VALUES ('voyage', v_manifesto.voyage_id::text, 'manifesto_mercante_created', NULL, v_numero, v_actor, v_justification);
      END IF;
      PERFORM public._link_bls_to_manifesto(v_active, v_manifesto.id, v_actor, v_justification);
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    PERFORM set_config('vela.ce_billing_deferred', COALESCE(v_previous_deferred, ''), true);
    RETURN jsonb_build_object('ok', false, 'errors', v_errors, 'warnings', v_analysis->'warnings');
  END;
  PERFORM set_config('vela.ce_billing_deferred', COALESCE(v_previous_deferred, ''), true);

  RETURN jsonb_build_object(
    'ok', true,
    'processed', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'overwritten', v_overwritten,
    'unchanged', v_unchanged,
    'ignored', (SELECT count(*) FROM jsonb_array_elements(v_analysis->'rows') WHERE value->>'status' = 'cancelled'),
    'warnings', v_analysis->'warnings',
    'manifesto_mercante_id', v_manifesto.id,
    'manifesto_created', v_created,
    'billing_pending_bl_ids', CASE WHEN p_defer_billing THEN to_jsonb(v_pending) ELSE '[]'::jsonb END
  );
END;
$function$;

-- 1. Emissão em lotes: espera de negócio com frase, sem alerta crítico; o
-- alerta de falha técnica fecha quando a fatura sai.
CREATE OR REPLACE FUNCTION public.emit_ce_mercante_billing(p_bl_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_bl_id text;
  v_bl public.bls%ROWTYPE;
  v_one jsonb;
  v_wait jsonb;
  v_gate_refusal boolean;
  v_results jsonb := '[]'::jsonb;
  v_status text;
  v_state text;
  v_message text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(COALESCE(p_bl_ids, ARRAY[]::text[])) > 50 THEN
    RAISE EXCEPTION 'No máximo 50 B/Ls por lote de emissão.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_bl_id IN ARRAY COALESCE(p_bl_ids, ARRAY[]::text[]) LOOP
    BEGIN
      PERFORM 1 FROM public.bls WHERE id = v_bl_id FOR UPDATE;
      IF NOT FOUND THEN
        v_one := jsonb_build_object('status', 'blocked', 'reason', 'not_found', 'message', 'B/L não encontrado.');
      ELSIF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND (cancelled_at IS NOT NULL OR NULLIF(btrim(COALESCE(ce_mercante, '')), '') IS NULL)) THEN
        v_one := jsonb_build_object('status', 'skipped', 'reason', 'no_ce_or_cancelled');
      ELSIF EXISTS (SELECT 1 FROM public.bls WHERE id = v_bl_id AND COALESCE(financial_status, 'pending') <> 'pending')
            OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0 THEN
        v_one := jsonb_build_object('status', 'already_invoiced');
      ELSE
        v_one := public._auto_bill_bl_core(v_bl_id, v_actor, true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_one := jsonb_build_object('status', 'blocked', 'reason', 'auto_billing_failed',
        'message', public._ce_row_error_message(v_state, v_message), 'sqlstate', v_state);
    END;

    -- Esperas de negócio (K1): Cliente não conciliado e Revisão pendente não
    -- são falha. A recusa das travas de faturamento chega como 22023/P0003
    -- (`mark_bl_ready_for_billing`, `prevent_pending_review_invoice`); o
    -- estado do B/L diz qual espera é.
    v_wait := NULL;
    IF v_one->>'status' = 'blocked' THEN
      SELECT * INTO v_bl FROM public.bls WHERE id = v_bl_id;
      IF FOUND THEN
        v_gate_refusal := v_one->>'reason' = 'auto_billing_failed'
          AND COALESCE(v_one->>'sqlstate', '') IN ('22023', 'P0003');
        IF v_one->>'reason' = 'customer_reconciliation_pending'
           OR (v_gate_refusal AND (v_bl.customer_id IS NULL
             OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled'))) THEN
          v_wait := jsonb_build_object('reason', 'customer_reconciliation_pending', 'waiting', true,
            'message', 'Aguardando conciliação do Cliente: a fatura sai quando o Cliente do B/L for conciliado.');
        ELSIF v_gate_refusal AND (
          v_bl.review_status = 'pending_review'
          OR v_bl.charge_status = 'review_required'
          OR EXISTS (SELECT 1 FROM public.charge_calculations AS c WHERE c.bl_id = v_bl_id AND c.status = 'review_required')
          OR COALESCE(cardinality(public.compute_bl_review_pendencies(v_bl_id)), 0) > 0
          OR COALESCE(cardinality(public.check_bl_terminal_pendencies(v_bl_id)), 0) > 0
          OR COALESCE(v_one->>'message', '') ~* '(revis|terminal)'
        ) THEN
          v_wait := jsonb_build_object('reason', 'review_pending', 'waiting', true,
            'message', 'Aguardando Revisão do B/L: a fatura sai quando a Revisão terminar.');
        END IF;
      END IF;
      IF v_wait IS NOT NULL THEN
        v_one := v_one || v_wait;
      END IF;
    END IF;

    v_status := CASE
      WHEN v_one->>'status' IN ('invoiced', 'already_invoiced') THEN 'invoiced'
      WHEN v_one->>'status' = 'held' THEN 'held'
      WHEN v_one->>'status' = 'skipped' THEN 'skipped'
      ELSE 'blocked'
    END;
    IF v_status = 'blocked' AND v_wait IS NULL THEN
      -- Alerta por B/L (ADR 0041): a falha técnica não fica escondida no lote.
      BEGIN
        PERFORM public.upsert_billing_alert('billing_auto_issue_failed', v_bl_id,
          format('A emissão automática do B/L %s pelo CE Mercante falhou: %s', v_bl_id,
            COALESCE(NULLIF(btrim(v_one->>'message'), ''), 'erro sem mensagem (' || COALESCE(v_one->>'reason', 'desconhecido') || ')')),
          jsonb_build_object('bl_id', v_bl_id, 'reason', v_one->>'reason', 'sqlstate', v_one->>'sqlstate', 'source', 'ce_mercante_planilha'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta de emissão do B/L % não registrado: %', v_bl_id, SQLERRM;
      END;
    ELSIF v_status = 'invoiced' THEN
      -- A fatura saiu: a falha anterior deixa de valer.
      BEGIN
        PERFORM public.resolve_alert_item('billing_auto_issue_failed', 'bl', v_bl_id, 'ce_mercante_planilha',
          jsonb_build_object('resolution', 'invoiced'));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta de emissão do B/L % não resolvido: %', v_bl_id, SQLERRM;
      END;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'bl_id', v_bl_id,
      'status', v_status,
      'reason', COALESCE(v_one->>'reason', v_one->>'status'),
      'message', v_one->>'message',
      'waiting', v_wait IS NOT NULL,
      'invoice_number', (SELECT i.invoice_number FROM public.invoices AS i
        WHERE i.id = ANY(public._live_local_invoice_ids_for_bl(v_bl_id)) ORDER BY i.id DESC LIMIT 1)
    ));
  END LOOP;

  RETURN jsonb_build_object('results', v_results);
END;
$function$;

-- 1. A fatura do B/L saiu por qualquer caminho (gatilho do CE, fila de
-- efeitos, Portal, Emitir fatura): fecha a falha de emissão automática.
CREATE OR REPLACE FUNCTION public.resolve_auto_issue_alert_on_invoiced()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.alert_items AS i
    JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'billing_auto_issue_failed' AND i.status = 'active'
      AND a.entity_type = 'bl' AND a.entity_id = NEW.id
  ) AND public.alert_actor_is_authorized() THEN
    PERFORM public.resolve_alert_item('billing_auto_issue_failed', 'bl', NEW.id, 'bl_invoiced',
      jsonb_build_object('resolution', 'invoiced', 'financial_status', NEW.financial_status));
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_auto_issue_alert_on_invoiced() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_auto_issue_alert_on_invoiced ON public.bls;
CREATE TRIGGER resolve_auto_issue_alert_on_invoiced
  AFTER UPDATE OF financial_status ON public.bls
  FOR EACH ROW
  WHEN (COALESCE(OLD.financial_status, 'pending') = 'pending'
        AND NEW.financial_status IN ('invoiced', 'partially_paid', 'paid'))
  EXECUTE FUNCTION public.resolve_auto_issue_alert_on_invoiced();

-- 5. Alerta "CE Mercante pendente" da Viagem: porto normalizado dos dois lados.
CREATE OR REPLACE FUNCTION public.reconcile_voyage_ce_mercante_missing_alerts(p_voyage_id bigint, p_source text DEFAULT 'voyage_operation_detector'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_first_eta DATE;
  v_total_bls INTEGER := 0;
  v_missing_ce_count INTEGER := 0;
  v_missing_vazios_count INTEGER := 0;
  v_parts text[] := ARRAY[]::text[];
BEGIN
  v_first_eta := public.get_voyage_first_brazilian_eta(p_voyage_id);

  IF v_first_eta IS NULL OR v_today < (v_first_eta - 5) THEN
    PERFORM public.resolve_alert_item('voyage_ce_mercante_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  -- B/L, escala, rota de vazios e Manifesto podem guardar o mesmo porto com
  -- nomes diferentes (BRVIT/VITORIA → BRVIX); a 181 grava o Manifesto
  -- normalizado. A comparação usa a forma normalizada dos dois lados.
  SELECT
    count(*),
    count(*) FILTER (WHERE ce_mercante IS NULL OR btrim(ce_mercante) = '')
  INTO v_total_bls, v_missing_ce_count
  FROM public.bls
  WHERE voyage_id = p_voyage_id
    AND cancelled_at IS NULL
    AND COALESCE(public.normalize_port_code(pod), upper(btrim(pod))) IN (
      SELECT COALESCE(public.normalize_port_code(e.pod), e.pod) FROM public.get_voyage_eligible_pods(p_voyage_id) AS e);

  IF v_total_bls = 0 THEN
    v_missing_ce_count := 0;
  END IF;

  SELECT count(*)
  INTO v_missing_vazios_count
  FROM (
    SELECT DISTINCT
      COALESCE(public.normalize_port_code(c.pol), upper(btrim(c.pol))) AS pol,
      COALESCE(public.normalize_port_code(c.pod), upper(btrim(c.pod))) AS pod
    FROM public.vazios_importacao_containers c
    JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
    WHERE m.voyage_id = p_voyage_id
      AND NULLIF(btrim(c.pol), '') IS NOT NULL
      AND NULLIF(btrim(c.pod), '') IS NOT NULL
      AND COALESCE(public.normalize_port_code(c.pod), upper(btrim(c.pod))) IN (
        SELECT COALESCE(public.normalize_port_code(e.pod), e.pod) FROM public.get_voyage_eligible_pods(p_voyage_id) AS e)
  ) rota
  WHERE NOT EXISTS (
      SELECT 1 FROM public.manifestos_mercante mm
      WHERE mm.voyage_id = p_voyage_id
        AND mm.natureza = 'vazio'
        AND COALESCE(public.normalize_port_code(mm.pol), upper(btrim(mm.pol))) = rota.pol
        AND COALESCE(public.normalize_port_code(mm.pod), upper(btrim(mm.pod))) = rota.pod
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.voyage_route_ce_master ce
      WHERE ce.voyage_id = p_voyage_id
        AND lower(ce.cargo_mode) = 'vazios'
        AND NULLIF(btrim(ce.ce_master), '') IS NOT NULL
        AND COALESCE(public.normalize_port_code(ce.pol), upper(btrim(ce.pol))) = rota.pol
        AND COALESCE(public.normalize_port_code(ce.pod), upper(btrim(ce.pod))) = rota.pod
    );

  IF v_missing_ce_count = 0 AND v_missing_vazios_count = 0 THEN
    PERFORM public.resolve_alert_item('voyage_ce_mercante_missing', 'voyage', p_voyage_id::text, p_source, '{}'::jsonb);
    RETURN;
  END IF;

  IF v_missing_ce_count > 0 THEN
    v_parts := v_parts || (v_missing_ce_count || ' B/L(s)');
  END IF;
  IF v_missing_vazios_count > 0 THEN
    v_parts := v_parts || (v_missing_vazios_count || ' rota(s) de vazios sem Nº de manifesto Mercante');
  END IF;

  PERFORM public.upsert_alert_item(
    'voyage_ce_mercante_missing',
    'voyage',
    p_voyage_id::text,
    'CE Mercante pendente para ' || array_to_string(v_parts, ' e ') || ' da viagem ' || p_voyage_id || ' (D-5 atingido)',
    p_source,
    jsonb_build_object(
      'voyage_id', p_voyage_id,
      'missing_ce_count', v_missing_ce_count,
      'missing_vazios_manifest_count', v_missing_vazios_count
    ),
    '/viagens/' || p_voyage_id
  );
END;
$function$;

-- 9. B/L novo com CE fora da porta é recusado (o INSERT pela API passava).
CREATE OR REPLACE FUNCTION public.guard_bl_ce_mercante_port()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (CASE WHEN TG_OP = 'INSERT'
        THEN NULLIF(btrim(COALESCE(NEW.ce_mercante, '')), '') IS NOT NULL
        ELSE NEW.ce_mercante IS DISTINCT FROM OLD.ce_mercante END)
     AND current_setting('vela.ce_mercante_port', true) IS DISTINCT FROM 'on'
     -- Manutenção (migration, script de superusuário sem papel de usuário) passa;
     -- sessão de usuário (`authenticated`/`anon`) nunca passa.
     AND (COALESCE(current_setting('request.jwt.claim.role', true), '') IN ('authenticated', 'anon')
          OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = session_user AND rolsuper)) THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'O B/L % nao pode ser cadastrado ja com CE Mercante: o CE entra pela planilha de CE Mercante depois do cadastro.', NEW.id
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'O CE Mercante do B/L % muda so pela planilha de CE Mercante ou pela ficha do B/L (Corrigir ou Remover CE Mercante).', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_bl_ce_mercante_port ON public.bls;
CREATE TRIGGER guard_bl_ce_mercante_port
  BEFORE INSERT OR UPDATE OF ce_mercante ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.guard_bl_ce_mercante_port();

-- 3. Gravação de CE sem confirmação nem motivo sai da API.
REVOKE EXECUTE ON FUNCTION public.apply_ce_mercante_update(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ce_mercante_update(text, text, uuid) TO service_role;
