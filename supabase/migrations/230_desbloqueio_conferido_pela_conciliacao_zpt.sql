-- 230: troca de CE com Desbloqueio conferido pela conciliação ZPT (B1).
--
-- Problema (plano de correções de 2026-10-14, item B1; ADR 0078, item 4):
-- a porta única `_set_bl_ce_mercante` e a prévia da planilha
-- (`_analyze_ce_mercante_rows`, migration 195) só reconheciam o Desbloqueio
-- conferido pela confirmação manual `ce_unlock_request_bls.confirmed_at`, que
-- o fluxo vigente deixou de gravar na migration 160. O B/L conciliado como
-- desbloqueado (`ce_unlock_zpt_status.status = 'unlocked'`) tinha o CE trocado
-- sem alerta e sem aviso na prévia, e a coluna ZPT sumia da linha.
--
-- Mudança: `_bl_ce_unlock_conferred(bl, ce)` diz se o CE do B/L tem
-- Desbloqueio conferido: conciliação ZPT `unlocked` do mesmo CE (pela chave
-- `ce_mercante_key`) ou a confirmação manual legada. A porta única abre
-- `ce_trocado_com_desbloqueio` e a prévia marca `unlock_confirmed` por ela.
-- O restante das duas funções é o da migration 195.
--
-- Só cria e redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `_set_bl_ce_mercante` e `_analyze_ce_mercante_rows` da
-- migration 195 e `DROP FUNCTION public._bl_ce_unlock_conferred(text, text)`.

CREATE OR REPLACE FUNCTION public._bl_ce_unlock_conferred(p_bl_id text, p_ce text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NULLIF(btrim(COALESCE(p_ce, '')), '') IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.ce_unlock_zpt_status AS z
      WHERE z.bl_id = p_bl_id AND z.status = 'unlocked'
        AND public.ce_mercante_key(z.ce_mercante) = public.ce_mercante_key(p_ce))
    OR EXISTS (
      SELECT 1 FROM public.ce_unlock_request_bls AS u
      WHERE u.bl_id = p_bl_id AND u.active AND u.confirmed_at IS NOT NULL)
  );
$function$;

REVOKE ALL ON FUNCTION public._bl_ce_unlock_conferred(text, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._bl_ce_unlock_conferred(text, text) IS
  'Desbloqueio de CE conferido para o CE do B/L: conciliação ZPT unlocked do mesmo CE ou confirmação manual legada (migration 230).';

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
  -- (planilha ou ficha): abre o alerta (ADR 0078, itens 2 e 4; K2). Conferido
  -- é a conciliação ZPT do CE anterior (migration 230, B1).
  IF v_result <> 'inserted' AND public._bl_ce_unlock_conferred(p_bl_id, v_old_ce) THEN
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
      'unlock_confirmed', public._bl_ce_unlock_conferred(v_bl.id, v_bl.ce_mercante)
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

