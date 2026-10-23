-- 412: a justificativa automática do status "BLs e CEs" diz o fato e o que o
-- disparou (revisão manual de 2026-10-22, item F4).
--
-- Investigação:
--   Ao importar os B/Ls da GREEN ITAJAI / 11, a linha do tempo mostrou "CE
--   atualizado · BRVIX — Aguardando → Recebido", com a justificativa genérica
--   "Atualização automática de BLs e CEs pela conciliação documental". A
--   mudança é legítima: pela regra da migration 134 (Viagens § BLs e CEs da
--   Escala), a escala passa a Recebido quando todos os containers cheios do
--   Baplie no porto estão cobertos por B/Ls ativos da mesma Viagem e rota, e os
--   B/Ls importados completaram essa cobertura. Faltava dizer isso.
--
-- Mudança:
--   `sync_voyage_documental_status` (134) grava a justificativa como
--   "Atualização automática de BLs e CEs pela conciliação documental: <fato>
--   (<importação>)", por exemplo "os 672 container(s) cheio(s) do Baplie em
--   BRVIX têm B/L ativo; falta CE Mercante em 40 de 40 B/L(s) (Importação de
--   B/L · Viagem GREEN ITAJAI 11)". O fato vem das mesmas contagens que decidem
--   o status (a regra não muda); a importação vem de `vela.import_context`
--   (`_set_import_context`, migration 190), vazia numa edição manual. O
--   prefixo fica igual: a tela o reconhece como automático e mostra o resto.
--
-- Só redefine a função (CREATE OR REPLACE mantém os grants); não reescreve nem
-- apaga linhas existentes (as justificativas antigas ficam como estão).
--
-- Rollback: reaplicar `sync_voyage_documental_status` da 134.

CREATE OR REPLACE FUNCTION public.sync_voyage_documental_status(p_voyage_id bigint, p_backfill boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  v_status text;
  v_previous text;
  v_current text;
  v_received boolean;
  v_total integer;
  v_missing integer;
  v_reason text;
  v_fact text;
  v_full integer;
  v_uncovered integer;
  v_has_container_bl boolean;
  -- 412: o que disparou (importação e Viagem, de `_set_import_context`); vazio
  -- numa edição manual da ficha, que o próprio fato já explica.
  v_context text := NULLIF(btrim(current_setting('vela.import_context', true)), '');
  v_saved_reason text := current_setting('vela.documental_justification', true);
BEGIN
  -- Serializa escritores da mesma viagem; a avaliação diferida vê o lote completo.
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  FOR r IN
    SELECT DISTINCT public.normalize_port_code(pod) AS port, 'import'::text AS direction
    FROM public.bls WHERE voyage_id = p_voyage_id
    UNION
    SELECT DISTINCT public.normalize_port_code(pod), 'import' FROM public.baplie_containers WHERE voyage_id = p_voyage_id
    UNION
    SELECT port, direction FROM public.voyage_documental_state WHERE voyage_id = p_voyage_id
    UNION
    SELECT public.normalize_port_code(pol), 'export' FROM public.voyage_export_schedules WHERE voyage_id = p_voyage_id
  LOOP
    IF r.port IS NULL OR r.port !~ '^BR[A-Z0-9]{3}$' THEN CONTINUE; END IF;
    IF r.direction = 'import' THEN
      SELECT count(*), count(*) FILTER (WHERE nullif(btrim(ce_mercante), '') IS NULL)
      INTO v_total, v_missing FROM public.bls
      WHERE voyage_id = p_voyage_id AND public.normalize_port_code(pod) = r.port
        AND cancelled_at IS NULL AND financial_status IS DISTINCT FROM 'cancelled';

      -- Carga solta não depende do EDI. Na escala mista, ambas as frentes precisam estar recebidas.
      -- 412: mesma regra da 134, com as contagens que a justificativa mostra.
      v_has_container_bl := EXISTS (SELECT 1 FROM public.bls WHERE voyage_id = p_voyage_id
        AND public.normalize_port_code(pod) = r.port AND cargo_mode = 'container'
        AND cancelled_at IS NULL AND financial_status IS DISTINCT FROM 'cancelled');
      SELECT count(*),
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM public.bl_containers c JOIN public.bls b ON b.id = c.bl_id
               WHERE b.voyage_id = p_voyage_id AND public.normalize_port_code(b.pod) = r.port
                 AND public.normalize_port_code(b.pol) = public.normalize_port_code(e.pol)
                 AND b.cargo_mode = 'container' AND b.cancelled_at IS NULL AND b.financial_status IS DISTINCT FROM 'cancelled'
                 AND upper(regexp_replace(c.container_number, '\s', '', 'g'))
                   = upper(regexp_replace(e.container_number, '\s', '', 'g'))))
        INTO v_full, v_uncovered
      FROM public.baplie_containers e
      WHERE e.voyage_id = p_voyage_id AND public.normalize_port_code(e.pod) = r.port AND e.status = 'full';
      v_received := v_total > 0 AND ((NOT v_has_container_bl AND v_full = 0) OR (v_full > 0 AND v_uncovered = 0));
      v_status := CASE WHEN v_received AND v_missing = 0 THEN 'approved'
                       WHEN v_received THEN 'received' ELSE 'waiting' END;
      v_fact := CASE
        WHEN v_status = 'approved' THEN
          format('%s B/L(s) ativo(s) de %s com CE Mercante', v_total, r.port)
        WHEN v_status = 'received' AND v_full > 0 THEN
          format('os %s container(s) cheio(s) do Baplie em %s têm B/L ativo; falta CE Mercante em %s de %s B/L(s)', v_full, r.port, v_missing, v_total)
        WHEN v_status = 'received' THEN
          format('%s B/L(s) de carga solta ativo(s) em %s; falta CE Mercante em %s', v_total, r.port, v_missing)
        WHEN v_total = 0 THEN
          format('nenhum B/L ativo em %s', r.port)
        WHEN v_full > 0 THEN
          format('%s de %s container(s) cheio(s) do Baplie em %s sem B/L ativo', v_uncovered, v_full, r.port)
        ELSE
          format('B/L de container em %s ainda sem Baplie', r.port)
      END;
      SELECT new_value INTO v_current FROM public.audit_logs
      WHERE entity_type = 'voyage_pod_schedule' AND entity_id = p_voyage_id::text || '::' || r.port AND field_name = 'ces'
      ORDER BY changed_at DESC, id DESC LIMIT 1;
    ELSE
      -- Vazios EXP isolados não têm B/L/CE individual no modelo: continuam manuais.
      -- Granito só automatiza Aprovado, nunca Recebido.
      SELECT count(*), count(*) FILTER (WHERE nullif(btrim(b.ce_mercante), '') IS NULL)
      INTO v_total, v_missing FROM public.granite_bls b JOIN public.granite_manifests m ON m.id = b.manifest_id
      WHERE m.voyage_id = p_voyage_id AND public.normalize_port_code(coalesce(nullif(b.loading_port, ''), m.loading_port)) = r.port;
      v_status := CASE WHEN v_total > 0 AND v_missing = 0 THEN 'approved' ELSE 'waiting' END;
      v_fact := CASE
        WHEN v_status = 'approved' THEN format('%s B/L(s) de Granito de %s com CE Mercante', v_total, r.port)
        WHEN v_total = 0 THEN format('nenhum B/L de Granito em %s', r.port)
        ELSE format('falta CE Mercante em %s de %s B/L(s) de Granito de %s', v_missing, v_total, r.port)
      END;
      SELECT ce_status INTO v_current FROM public.voyage_export_schedules
      WHERE voyage_id = p_voyage_id AND public.normalize_port_code(pol) = r.port AND has_granite AND tem_exportacao;
      IF NOT FOUND THEN CONTINUE; END IF;
    END IF;

    SELECT status INTO v_previous FROM public.voyage_documental_state
    WHERE voyage_id = p_voyage_id AND port = r.port AND direction = r.direction;
    IF v_previous IS NOT DISTINCT FROM v_status THEN CONTINUE; END IF;
    INSERT INTO public.voyage_documental_state VALUES (p_voyage_id, r.port, r.direction, v_status)
    ON CONFLICT (voyage_id, port, direction) DO UPDATE SET status = EXCLUDED.status;
    IF p_backfill AND v_current IS NOT NULL THEN CONTINUE; END IF;
    -- Estabelecer a primeira base Aguardando não é um novo fato documental:
    -- não desfaz Recebido manual na criação da exportação de Granito.
    IF v_previous IS NULL AND v_status = 'waiting' THEN CONTINUE; END IF;
    IF coalesce(v_current, 'waiting') = v_status THEN CONTINUE; END IF;

    -- 412: o prefixo fica (é o que a tela reconhece como automático); depois
    -- dele, o fato que mudou o status e, entre parênteses, a importação.
    v_reason := 'Atualização automática de BLs e CEs pela conciliação documental: ' || v_fact
      || COALESCE(' (' || v_context || ')', '');

    IF r.direction = 'import' THEN
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('voyage_pod_schedule', p_voyage_id::text || '::' || r.port, 'ces', coalesce(v_current, 'waiting'), v_status, auth.uid(), clock_timestamp(), v_reason);
    ELSE
      PERFORM set_config('vela.documental_justification', v_reason, true);
      UPDATE public.voyage_export_schedules SET ce_status = v_status
      WHERE voyage_id = p_voyage_id AND public.normalize_port_code(pol) = r.port;
      PERFORM set_config('vela.documental_justification', coalesce(v_saved_reason, ''), true);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_voyage_documental_status(bigint, boolean) FROM PUBLIC, anon, authenticated;
