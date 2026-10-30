-- 549: as âncoras do "Não escala" passam a ter um dono só, no banco, lido pelo
-- gatilho e pela tela de Chegadas e Saídas. Revisão da release #1117 (achado do
-- Codex na PR #1116 e lacuna da 513 com a 541).
--
-- Problema:
--   1. A tela (`podHasOperationalAnchor`, voyageFromSchedule.ts) procurava o
--      B/L da escala por igualdade exata (`pod.eq.BRVIX`). O B/L com o porto
--      gravado por apelido (`VITORIA`, `BRVIT`) não ancorava na tela, e ela
--      mandava a marca de retirada (`deleted = true`); o gatilho da 513, que
--      normaliza o porto, achava o B/L e recusava a gravação inteira, também as
--      datas dos outros portos. O Administrativo não chegava ao "só a data
--      sai" que a confirmação promete.
--   2. A 541 acrescentou ao Excluir escala a recusa da escala com Embarque de
--      vazios; o gatilho do "Não escala" (513), que segue a régua do Excluir
--      escala (decisão D2 do dono), não ganhou o mesmo item. O embarque anterior
--      à 541, sem terminal (sem "terminais salvos"), saía da Viagem pelo "Não
--      escala".
--
-- Mudança:
--   1. `escala_removal_anchor_reasons(viagem, porto)` devolve as âncoras da
--      escala, na ordem da mensagem: B/L com o porto como POD ou POL (contando
--      cancelado, porto pela `normalize_port_code`), ATA, ATD, Vinculada,
--      terminais salvos e Embarque de vazios. Só leitura; usuário interno ativo.
--   2. `guard_pod_schedule_removal_mark` usa essa função no lugar do bloco da
--      513; o resto do corpo (perfil, desvio do Excluir escala, Trava de
--      exclusão primeiro) não muda.
--   A tela passa a chamar a mesma função antes de montar a gravação.
--
-- Só cria e redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar `guard_pod_schedule_removal_mark` da 513 e
-- DROP FUNCTION `escala_removal_anchor_reasons(bigint, text)`.

CREATE OR REPLACE FUNCTION public.escala_removal_anchor_reasons(p_voyage_id bigint, p_port text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := upper(btrim(COALESCE(p_port, '')));
  v_code text;
  v_entity text;
  v_anchor text[] := '{}';
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF p_voyage_id IS NULL OR v_port = '' THEN
    RETURN v_anchor;
  END IF;
  v_code := COALESCE(public.normalize_port_code(v_port), v_port);
  v_entity := p_voyage_id::text || '::' || v_port;

  IF EXISTS (
    SELECT 1 FROM public.bls AS b
    WHERE b.voyage_id = p_voyage_id
      AND (COALESCE(public.normalize_port_code(b.pod), upper(btrim(b.pod))) = v_code
        OR COALESCE(public.normalize_port_code(b.pol), upper(btrim(b.pol))) = v_code)
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
    WHERE rs.voyage_id = p_voyage_id AND rs.port = v_port AND rs.revision > 0
  ) THEN
    v_anchor := array_append(v_anchor, 'terminais salvos');
  END IF;

  -- A régua do Excluir escala desde a 541 (ADR 0113).
  IF EXISTS (
    SELECT 1 FROM public.vazios_export_operations AS o
    WHERE o.voyage_id = p_voyage_id
      AND COALESCE(public.normalize_port_code(o.embark_port), upper(btrim(o.embark_port))) = v_code
  ) THEN
    v_anchor := array_append(v_anchor, 'Embarque de vazios na escala');
  END IF;

  RETURN v_anchor;
END;
$function$;

REVOKE ALL ON FUNCTION public.escala_removal_anchor_reasons(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escala_removal_anchor_reasons(bigint, text) TO authenticated;

COMMENT ON FUNCTION public.escala_removal_anchor_reasons(bigint, text) IS
  'Âncoras que impedem o "Não escala" de tirar a escala da Viagem (549): B/L com o porto como POD ou POL, ATA, ATD, Vinculada, terminais salvos e Embarque de vazios. Lida pelo gatilho guard_pod_schedule_removal_mark e por Chegadas e Saídas.';

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

  -- 513/549: âncoras do "Não escala" (Chegadas e Saídas), pelo mesmo dono que
  -- a tela lê. O Excluir escala tem a régua dele e marca a própria gravação.
  IF current_setting('vela.escala_delete', true) IS DISTINCT FROM 'on' THEN
    v_anchor := public.escala_removal_anchor_reasons(v_voyage_id, v_port);
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
