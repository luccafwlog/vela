-- 513: o "Não escala" do Administrativo em Chegadas e Saídas só tira da Viagem
-- a escala sem âncora, também no banco. Decisão D2 do dono na revisão da PR
-- #1084 (relatório em docs/archive/audits/revisao-pr-1084-2026-10-29.md).
--
-- Problema: a regra da tela (docs/modules/chegadas-saidas.md) é que a escala só
-- sai da Viagem e do Line-Up quando não tem B/L, ATA, ATD, Vinculada nem
-- edição de terminais salva; com âncora, só a data prevista sai. A conferência
-- era só da tela (`podHasOperationalAnchor`), e o gatilho
-- `guard_pod_schedule_removal_mark` (429) conferia só o perfil e a Trava de
-- exclusão. Chamando `record_audit_entries` direto, o Administrativo retirava
-- escala com ATA e Vinculada; e a tela não via o B/L que tem o porto como POL.
--
-- Mudança:
--   1. O gatilho recusa a marca de retirada (`deleted = true`) da escala com
--      âncora, na mesma mensagem da Trava ("Escala X travada: …"): B/L da
--      Viagem com o porto como POD ou POL (a régua de `delete_escala`, com
--      `normalize_port_code`, contando B/L cancelado), ATA, ATD, Vinculada e
--      terminais salvos (`voyage_escala_revision_state.revision > 0`).
--   2. `delete_escala` (Excluir escala) tem régua própria: apaga a escala com
--      ATA, Vinculada e terminais (e os terminais junto) e recusa B/L. Ele
--      marca a própria gravação (`vela.escala_delete`, só na transação) para o
--      gatilho não aplicar as âncoras do "Não escala"; o resto do corpo é o
--      vigente, pelo remendo da 500.
--   A gravação do sistema (sem `auth.uid()`) continua fora do gatilho.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `guard_pod_schedule_removal_mark` da 429 e
-- `delete_escala` sem as duas linhas de `vela.escala_delete`.

CREATE OR REPLACE FUNCTION public.guard_pod_schedule_removal_mark()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_voyage_id bigint;
  v_port text;
  v_entity text;
  v_lock text[];
  v_anchor text[] := '{}';
BEGIN
  -- A marca de retirada só aceita true/false: um 'sim' ou '1' era lido como
  -- retirada pelos Comunicados (customer_communication_flag) e não pela tela.
  IF NEW.entity_type = 'voyage_pod_schedule' AND NEW.field_name = 'deleted'
     AND lower(btrim(COALESCE(NEW.new_value, ''))) NOT IN ('true', 'false', '') THEN
    RAISE EXCEPTION 'Marca de retirada da escala inválida: use true ou false.' USING ERRCODE = '22023';
  END IF;
  IF NEW.entity_type IS DISTINCT FROM 'voyage_pod_schedule'
     OR NEW.field_name IS DISTINCT FROM 'deleted'
     -- A tela lê a marca normalizada (trim + minúsculas): 'TRUE' também retira.
     OR lower(btrim(COALESCE(NEW.new_value, ''))) <> 'true'
     OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o Administrativo retira escala da viagem.' USING ERRCODE = '42501';
  END IF;

  v_entity := btrim(NEW.entity_id);
  v_voyage_id := NULLIF(split_part(v_entity, '::', 1), '')::bigint;
  v_port := NULLIF(split_part(v_entity, '::', 2), '');

  -- 513: âncoras do "Não escala" (Chegadas e Saídas). O Excluir escala tem a
  -- régua dele e marca a própria gravação.
  IF current_setting('vela.escala_delete', true) IS DISTINCT FROM 'on' THEN
    IF EXISTS (
      SELECT 1 FROM public.bls AS b
      WHERE b.voyage_id = v_voyage_id
        AND (COALESCE(public.normalize_port_code(b.pod), upper(btrim(b.pod))) = COALESCE(public.normalize_port_code(v_port), upper(v_port))
          OR COALESCE(public.normalize_port_code(b.pol), upper(btrim(b.pol))) = COALESCE(public.normalize_port_code(v_port), upper(v_port)))
    ) THEN
      v_anchor := array_append(v_anchor, 'B/L vinculado à escala');
    END IF;
    SELECT v_anchor
      || CASE WHEN NULLIF(btrim(COALESCE(s.ata, '')), '') IS NOT NULL THEN ARRAY['ATA registrado'] ELSE '{}'::text[] END
      || CASE WHEN NULLIF(btrim(COALESCE(s.atd, '')), '') IS NOT NULL THEN ARRAY['ATD registrado'] ELSE '{}'::text[] END
      || CASE WHEN lower(btrim(COALESCE(s.linked, ''))) = 'true' THEN ARRAY['escala Vinculada'] ELSE '{}'::text[] END
      INTO v_anchor
    FROM (
      SELECT
        (SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = v_entity AND a.field_name = 'ata' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1) AS ata,
        (SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = v_entity AND a.field_name = 'atd' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1) AS atd,
        (SELECT a.new_value FROM public.audit_logs a WHERE a.entity_type = 'voyage_pod_schedule' AND a.entity_id = v_entity AND a.field_name = 'linked' ORDER BY a.changed_at DESC, a.id DESC LIMIT 1) AS linked
    ) AS s;
    IF EXISTS (
      SELECT 1 FROM public.voyage_escala_revision_state AS rs
      WHERE rs.voyage_id = v_voyage_id AND rs.port = upper(btrim(v_port)) AND rs.revision > 0
    ) THEN
      v_anchor := array_append(v_anchor, 'terminais salvos');
    END IF;
  END IF;

  -- A Trava de exclusão vem primeiro, como antes da 513; as âncoras, depois.
  v_lock := public.delete_lock_reasons(v_voyage_id, v_port) || v_anchor;
  IF cardinality(v_lock) > 0 THEN
    RAISE EXCEPTION 'Escala % travada: %.', v_port, array_to_string(v_lock, ', ') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_pod_schedule_removal_mark() FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE
  v_def text;
  v_old text := $s$  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage_pod_schedule', p_voyage_id::text || '::' || v_port, 'deleted', 'false', 'true', auth.uid(), v_reason);
$s$;
  v_new text := $s$  -- 513: a régua do Excluir escala é a de cima; o gatilho da marca de
  -- retirada não aplica as âncoras do "Não escala" a esta gravação.
  PERFORM set_config('vela.escala_delete', 'on', true);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage_pod_schedule', p_voyage_id::text || '::' || v_port, 'deleted', 'false', 'true', auth.uid(), v_reason);
  PERFORM set_config('vela.escala_delete', '', true);
$s$;
BEGIN
  v_def := pg_get_functiondef('public.delete_escala(bigint,text,boolean,text)'::regprocedure);
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION '513: trecho não encontrado em delete_escala';
  END IF;
  IF position(v_old IN substr(v_def, position(v_old IN v_def) + 1)) > 0 THEN
    RAISE EXCEPTION '513: trecho repetido em delete_escala';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;
