-- 398: Vazios — o vazio de importação existe uma vez por Viagem e o ADR de
-- Saída fechado trava o Embarque de vazios (lote 6 do plano
-- docs/plans/2026-10-21-frente-das-importacoes.md; ADR 0095, decisões 21 e
-- 22; achado F-32 da revisão de 2026-10-21).
--
-- Decisão 21 (F-32). Antes, a planilha de Vazios de importação e o Baplie não
-- conferiam se o container já estava em outra rota ou em outra fonte da
-- Viagem: o mesmo vazio entrava duas vezes, o Line Up e o ADR contavam as
-- duas linhas e "Confirmar vazios do Baplie" (/baplie) só olhava os vazios
-- vindos do Baplie.
--   1. `vazios_importacao_containers` ganha `voyage_id` (copiado do manifesto
--      por gatilho, e acompanhando a troca de Viagem do manifesto) e
--      `container_key` (o número sem espaço nem pontuação, em maiúsculas,
--      coluna gerada); o índice único `(voyage_id, container_key)` garante um
--      vazio por Viagem, qualquer que seja a rota ou a fonte.
--   2. A planilha vale sobre o Baplie: `import_vazios_importacao_transactional`
--      tira do Baplie os containers que ela traz (em qualquer rota) e recusa,
--      com o container e a rota, o container repetido no arquivo e o que já
--      está em outra rota da Viagem vindo de outra planilha (a planilha só
--      substitui as rotas que traz).
--   3. O Baplie não sobrescreve a planilha: `replace_vazios_from_baplie_transactional`
--      cadastra só os vazios que nenhuma planilha trouxe e devolve quantos
--      ficaram com a planilha (`planilha`). Sem nenhum vazio a cadastrar, não
--      cria manifesto (`manifest_id` nulo, `total` 0) e não recusa.
--   4. Acerto dos dados: os containers repetidos na mesma Viagem ficam numa
--      linha só (a da planilha sobre a do Baplie; entre iguais, a do manifesto
--      mais recente). Esta limpeza apaga linhas existentes e depende da
--      afirmação "Data status" do AGENTS.md (seção Gotchas): os dados de
--      produção são de teste. Os manifestos das Viagens não canceladas são
--      recontados (`_vazios_importacao_prune`); Viagem cancelada é somente
--      leitura e fica com o total antigo (contado num NOTICE).
--
-- Decisão 22. A 262 travou Excluir unidade e a linha de serviço e a 274 a
-- reimportação; incluir e editar unidade e a escrita direta permitida por
-- coluna em `vazios_export_service_lines` e `vazios_export_operations`
-- seguiam mudando o Embarque com o ADR de Saída fechado.
--   5. `create_manual_vazios_booking` e `update_manual_vazios_booking`
--      recusam com o ADR de Saída fechado, com mensagem que manda reabrir.
--   6. Gatilho `guard_vazios_export_adr_lock` (BEFORE) em `vazios_bookings`,
--      `vazios_export_service_lines` e `vazios_export_operations` recusa
--      incluir, mudar ou apagar com o ADR fechado do porto de embarque (o de
--      antes e o de depois). A exclusão da Viagem ou do B/L
--      (`vela.deleting_records`) passa.
--   7. `vazios_export_adr_locked(voyage, porto)`: leitura para a tela
--      desabilitar as ações (usuário ativo de leitura).
--
-- Rollback: DROP dos gatilhos `guard_vazios_export_adr_lock` e
-- `vazios_importacao_container_voyage`/`vazios_importacao_manifest_voyage`, das
-- funções novas, do índice `vazios_importacao_containers_voyage_container_key`
-- e das colunas `voyage_id` e `container_key`; reaplicar a
-- `import_vazios_importacao_transactional` da 387, a
-- `replace_vazios_from_baplie_transactional` da 387 e as
-- `create_manual_vazios_booking`/`update_manual_vazios_booking` da 326/331.
-- As linhas apagadas no acerto (item 4) não voltam; o Histórico
-- (`audit_logs`, entidade `vazios_importacao_containers`) guarda cada uma.

-- 1. Viagem e chave do container na linha.
ALTER TABLE public.vazios_importacao_containers
  ADD COLUMN IF NOT EXISTS voyage_id bigint,
  ADD COLUMN IF NOT EXISTS container_key text
    GENERATED ALWAYS AS (upper(regexp_replace(container_number, '[^A-Za-z0-9]', '', 'g'))) STORED;

COMMENT ON COLUMN public.vazios_importacao_containers.voyage_id IS
  'Viagem do manifesto (copiada por gatilho); com container_key, um vazio de importação por Viagem (ADR 0095, decisão 21).';
COMMENT ON COLUMN public.vazios_importacao_containers.container_key IS
  'Número do container sem espaço nem pontuação, em maiúsculas: a chave da unicidade por Viagem.';

CREATE OR REPLACE FUNCTION public._vazios_importacao_container_voyage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  SELECT m.voyage_id INTO NEW.voyage_id
  FROM public.vazios_importacao_manifests AS m WHERE m.id = NEW.manifest_id;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public._vazios_importacao_container_voyage() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vazios_importacao_container_voyage ON public.vazios_importacao_containers;
CREATE TRIGGER vazios_importacao_container_voyage
  BEFORE INSERT OR UPDATE OF manifest_id, voyage_id ON public.vazios_importacao_containers
  FOR EACH ROW EXECUTE FUNCTION public._vazios_importacao_container_voyage();

CREATE OR REPLACE FUNCTION public._vazios_importacao_manifest_voyage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.vazios_importacao_containers AS c
  SET voyage_id = NEW.voyage_id
  WHERE c.manifest_id = NEW.id AND c.voyage_id IS DISTINCT FROM NEW.voyage_id;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public._vazios_importacao_manifest_voyage() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vazios_importacao_manifest_voyage ON public.vazios_importacao_manifests;
CREATE TRIGGER vazios_importacao_manifest_voyage
  AFTER UPDATE OF voyage_id ON public.vazios_importacao_manifests
  FOR EACH ROW WHEN (OLD.voyage_id IS DISTINCT FROM NEW.voyage_id)
  EXECUTE FUNCTION public._vazios_importacao_manifest_voyage();

UPDATE public.vazios_importacao_containers AS c
SET voyage_id = m.voyage_id
FROM public.vazios_importacao_manifests AS m
WHERE m.id = c.manifest_id AND c.voyage_id IS DISTINCT FROM m.voyage_id;

-- 4. Acerto: um vazio por Viagem (Data status do AGENTS.md; ver cabeçalho).
DO $acerto$
DECLARE
  v_removed integer;
  v_voyage bigint;
  v_cancelled integer := 0;
BEGIN
  CREATE TEMP TABLE vazios_398_duplicados ON COMMIT DROP AS
  SELECT ranked.id, ranked.voyage_id
  FROM (
    SELECT c.id, c.voyage_id,
           row_number() OVER (
             PARTITION BY c.voyage_id, c.container_key
             ORDER BY (m.source = 'baplie'), m.imported_at DESC NULLS LAST, c.created_at DESC NULLS LAST, c.id
           ) AS position
    FROM public.vazios_importacao_containers AS c
    JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
    WHERE c.voyage_id IS NOT NULL
  ) AS ranked
  WHERE ranked.position > 1;

  DELETE FROM public.vazios_importacao_containers AS c
  USING vazios_398_duplicados AS d WHERE d.id = c.id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  FOR v_voyage IN SELECT DISTINCT d.voyage_id FROM vazios_398_duplicados AS d LOOP
    IF EXISTS (SELECT 1 FROM public.voyages WHERE id = v_voyage AND status = 'cancelled') THEN
      v_cancelled := v_cancelled + 1;
    ELSE
      PERFORM public._vazios_importacao_prune(v_voyage);
    END IF;
  END LOOP;
  RAISE NOTICE '398: % vazio(s) de importação repetido(s) na mesma Viagem removido(s); % Viagem(ns) cancelada(s) ficaram com o total antigo.', v_removed, v_cancelled;
END $acerto$;

CREATE UNIQUE INDEX IF NOT EXISTS vazios_importacao_containers_voyage_container_key
  ON public.vazios_importacao_containers (voyage_id, container_key)
  WHERE voyage_id IS NOT NULL;

-- 2. Planilha: vale sobre o Baplie; recusa o repetido e o de outra planilha.
CREATE OR REPLACE FUNCTION public.import_vazios_importacao_transactional(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_containers jsonb, p_manifestos jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_conflict record;
  v_from_baplie integer := 0;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Vazios de Importação', p_voyage_id, (SELECT string_agg(m->>'numero', ', ') FROM jsonb_array_elements(COALESCE(p_manifestos, '[]'::jsonb)) AS m));
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_398_planilha (container_key text, container_number text, pol text, pod text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_398_planilha;
  IF jsonb_typeof(p_containers) = 'array' THEN
    INSERT INTO pg_temp.vazios_398_planilha
    SELECT upper(regexp_replace(COALESCE(item.container_number, ''), '[^A-Za-z0-9]', '', 'g')),
           upper(btrim(item.container_number)),
           public.normalize_port_code(item.pol), public.normalize_port_code(item.pod)
    FROM jsonb_to_recordset(p_containers) AS item(container_number text, pol text, pod text);
  END IF;

  -- O mesmo container duas vezes no arquivo.
  SELECT p.container_number,
         string_agg(COALESCE(p.pol, '?') || ' → ' || COALESCE(p.pod, '?'), ' e ' ORDER BY p.pol, p.pod) AS rotas
    INTO v_conflict
  FROM pg_temp.vazios_398_planilha AS p
  WHERE p.container_key <> ''
  GROUP BY p.container_key, p.container_number
  HAVING count(*) > 1
  ORDER BY p.container_number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'O container % aparece mais de uma vez na planilha (%): um vazio de importação existe uma vez por Viagem. Deixe uma linha só e escolha o arquivo de novo. Nada foi gravado.',
      v_conflict.container_number, v_conflict.rotas USING ERRCODE = '23505';
  END IF;

  -- Já está na Viagem, vindo de outra planilha, numa rota que esta planilha
  -- não traz (a planilha só substitui as rotas que traz).
  SELECT c.container_number, c.pol, c.pod INTO v_conflict
  FROM public.vazios_importacao_containers AS c
  JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
  JOIN pg_temp.vazios_398_planilha AS p ON p.container_key = c.container_key
  WHERE c.voyage_id = p_voyage_id AND m.source <> 'baplie'
    AND NOT EXISTS (
      SELECT 1 FROM pg_temp.vazios_398_planilha AS r
      WHERE r.pol = public.normalize_port_code(c.pol) AND r.pod = public.normalize_port_code(c.pod)
    )
  ORDER BY c.container_number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'O container % já está nos Vazios de importação desta Viagem na rota % → %, de outra planilha: um vazio de importação existe uma vez por Viagem. Tire o container desta planilha ou traga nela a rota % → % inteira, que a planilha substitui. Nada foi gravado.',
      v_conflict.container_number, COALESCE(v_conflict.pol, '?'), COALESCE(v_conflict.pod, '?'),
      COALESCE(v_conflict.pol, '?'), COALESCE(v_conflict.pod, '?') USING ERRCODE = '23505';
  END IF;

  -- A planilha vale sobre o Baplie: o container que ela traz sai do Baplie,
  -- em qualquer rota.
  DELETE FROM public.vazios_importacao_containers AS c
  USING public.vazios_importacao_manifests AS m
  WHERE m.id = c.manifest_id AND m.source = 'baplie' AND c.voyage_id = p_voyage_id
    AND EXISTS (SELECT 1 FROM pg_temp.vazios_398_planilha AS p WHERE p.container_key = c.container_key);
  GET DIAGNOSTICS v_from_baplie = ROW_COUNT;

  v_result := public.import_vazios_importacao_transactional_legacy_189(p_voyage_id, p_description, p_uploaded_by, p_containers, p_manifestos);
  RETURN v_result || jsonb_build_object('replaced_from_baplie', v_from_baplie);
END $function$;

-- 3. Baplie: não sobrescreve a planilha; cadastra só o que nenhuma planilha
--    trouxe. O resto é a função da 387.
CREATE OR REPLACE FUNCTION public.replace_vazios_from_baplie_transactional(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_replace_existing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id uuid;
  v_empty integer;
  v_total integer;
  v_planilha integer;
  v_pruned integer;
  v_removed integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios Baplie.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Vazios pelo Baplie', p_voyage_id, NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  SELECT count(*)::integer INTO v_empty
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id AND status = 'empty';

  IF v_empty = 0 THEN
    IF NOT p_replace_existing THEN
      RAISE EXCEPTION 'Nenhum container vazio encontrado no Baplie desta viagem.'
        USING ERRCODE = 'P0002';
    END IF;
    -- Baplie novo sem vazios: os vazios do Baplie anterior saem da Viagem.
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    v_pruned := public._vazios_importacao_prune(p_voyage_id);
    RETURN jsonb_build_object('manifest_id', NULL, 'total', 0, 'planilha', 0, 'pruned', v_pruned, 'removed', v_removed > 0);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_natureza (container_number text, natureza text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_natureza;
  INSERT INTO pg_temp.vazios_natureza SELECT * FROM public._vazios_importacao_natureza_map(p_voyage_id);

  IF p_replace_existing THEN
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
  ELSIF EXISTS (
    SELECT 1 FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie'
  ) THEN
    RAISE EXCEPTION 'Ja existe manifesto Baplie para esta viagem.'
      USING ERRCODE = '23505';
  END IF;

  -- Os vazios do Baplie que nenhuma planilha trouxe (decisão 21).
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_398_baplie (container_number text, size_type text, weight_kg numeric, pol text, pod text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_398_baplie;
  INSERT INTO pg_temp.vazios_398_baplie
  SELECT DISTINCT ON (upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g')))
         b.container_number, b.size_type, b.weight_kg, b.pol, b.pod
  FROM public.baplie_containers AS b
  WHERE b.voyage_id = p_voyage_id AND b.status = 'empty'
    AND NOT EXISTS (
      SELECT 1 FROM public.vazios_importacao_containers AS c
      WHERE c.voyage_id = p_voyage_id
        AND c.container_key = upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g'))
    )
  ORDER BY upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g')), b.id;
  SELECT count(*)::integer INTO v_total FROM pg_temp.vazios_398_baplie;
  v_planilha := v_empty - v_total;

  IF v_total > 0 THEN
    INSERT INTO public.vazios_importacao_manifests (
      voyage_id, description, total_containers, imported_by, source
    )
    VALUES (
      p_voyage_id, COALESCE(p_description, 'Importado via Baplie EDI'),
      v_total, p_uploaded_by, 'baplie'
    )
    RETURNING id INTO v_manifest_id;

    INSERT INTO public.vazios_importacao_containers (
      manifest_id, container_number, container_type, tare_kg, pol, pod, natureza
    )
    SELECT v_manifest_id, b.container_number, b.size_type, b.weight_kg, b.pol, b.pod, n.natureza
    FROM pg_temp.vazios_398_baplie AS b
    LEFT JOIN pg_temp.vazios_natureza n ON n.container_number = upper(btrim(b.container_number));
  END IF;

  v_pruned := public._vazios_importacao_prune(p_voyage_id);

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total, 'planilha', v_planilha,
    'pruned', v_pruned, 'removed', false);
END $function$;

-- 5 a 7. ADR de Saída fechado trava o Embarque de vazios (decisão 22).
CREATE OR REPLACE FUNCTION public._vazios_export_adr_lock_message(p_port text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT format('ADR de Saída de %s fechado: o Embarque de vazios não muda (incluir, editar ou excluir unidade, linha de serviço ou importação). Reabra o ADR de Saída para mudar.',
    COALESCE(NULLIF(upper(btrim(p_port)), ''), 'o porto'));
$function$;
REVOKE ALL ON FUNCTION public._vazios_export_adr_lock_message(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.vazios_export_adr_locked(p_voyage_id bigint, p_port text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  RETURN public._vazios_export_locked_by_adr(p_voyage_id, p_port);
END $function$;
REVOKE ALL ON FUNCTION public.vazios_export_adr_locked(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vazios_export_adr_locked(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_vazios_export_adr_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_scales jsonb := '[]'::jsonb;
  v_scale jsonb;
BEGIN
  -- Exclusão da Viagem ou do B/L pela RPC de exclusão.
  IF TG_OP = 'DELETE' AND current_setting('vela.deleting_records', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'vazios_export_operations' THEN
    -- Só a troca de Viagem ou de porto e a exclusão mexem no Embarque.
    IF TG_OP = 'UPDATE' AND OLD.voyage_id IS NOT DISTINCT FROM NEW.voyage_id
       AND upper(btrim(OLD.embark_port)) IS NOT DISTINCT FROM upper(btrim(NEW.embark_port)) THEN
      RETURN NEW;
    END IF;
    v_scales := jsonb_build_array(jsonb_build_object('voyage_id', OLD.voyage_id, 'port', OLD.embark_port));
    IF TG_OP = 'UPDATE' THEN
      v_scales := v_scales || jsonb_build_object('voyage_id', NEW.voyage_id, 'port', NEW.embark_port);
    END IF;
  ELSIF TG_TABLE_NAME = 'vazios_bookings' THEN
    IF TG_OP <> 'INSERT' THEN
      v_scales := v_scales || jsonb_build_object('voyage_id', OLD.voyage_id, 'port', COALESCE(
        (SELECT op.embark_port FROM public.vazios_export_operations AS op WHERE op.id = OLD.operation_id), OLD.pol));
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_scales := v_scales || jsonb_build_object('voyage_id', NEW.voyage_id, 'port', COALESCE(
        (SELECT op.embark_port FROM public.vazios_export_operations AS op WHERE op.id = NEW.operation_id), NEW.pol));
    END IF;
  ELSE -- vazios_export_service_lines
    IF TG_OP <> 'INSERT' THEN
      v_scales := v_scales || COALESCE((
        SELECT jsonb_agg(jsonb_build_object('voyage_id', op.voyage_id, 'port', op.embark_port))
        FROM public.vazios_export_operations AS op WHERE op.id = OLD.operation_id), '[]'::jsonb);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_scales := v_scales || COALESCE((
        SELECT jsonb_agg(jsonb_build_object('voyage_id', op.voyage_id, 'port', op.embark_port))
        FROM public.vazios_export_operations AS op WHERE op.id = NEW.operation_id), '[]'::jsonb);
    END IF;
  END IF;

  FOR v_scale IN SELECT value FROM jsonb_array_elements(v_scales) LOOP
    IF (v_scale->>'voyage_id') IS NOT NULL
       AND public._vazios_export_locked_by_adr((v_scale->>'voyage_id')::bigint, v_scale->>'port') THEN
      RAISE EXCEPTION '%', public._vazios_export_adr_lock_message(v_scale->>'port') USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.guard_vazios_export_adr_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_vazios_export_adr_lock ON public.vazios_bookings;
CREATE TRIGGER guard_vazios_export_adr_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.vazios_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_vazios_export_adr_lock();
DROP TRIGGER IF EXISTS guard_vazios_export_adr_lock ON public.vazios_export_service_lines;
CREATE TRIGGER guard_vazios_export_adr_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.vazios_export_service_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_vazios_export_adr_lock();
DROP TRIGGER IF EXISTS guard_vazios_export_adr_lock ON public.vazios_export_operations;
CREATE TRIGGER guard_vazios_export_adr_lock
  BEFORE UPDATE OR DELETE ON public.vazios_export_operations
  FOR EACH ROW EXECUTE FUNCTION public.guard_vazios_export_adr_lock();

-- 5. Incluir e editar unidade: a mesma recusa, antes de tocar na unidade. O
--    resto é a função da 326.
CREATE OR REPLACE FUNCTION public.create_manual_vazios_booking(p_operation_id uuid, p_voyage_id bigint, p_uploaded_by uuid, p_container_number text, p_container_type text, p_local_id uuid, p_condition text, p_hand_in_date date, p_hand_out_date date, p_movement_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id uuid;
  v_booking_id uuid;
  v_port text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para incluir unidade.' USING ERRCODE = '42501';
  END IF;
  SELECT op.embark_port INTO v_port
  FROM public.vazios_export_operations AS op
  WHERE op.id = p_operation_id AND op.voyage_id = p_voyage_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A unidade deve pertencer a um embarque da mesma viagem.' USING ERRCODE = '22023';
  END IF;
  IF public._vazios_export_locked_by_adr(p_voyage_id, v_port) THEN
    RAISE EXCEPTION '%', public._vazios_export_adr_lock_message(v_port) USING ERRCODE = '23514';
  END IF;
  IF upper(btrim(COALESCE(p_container_number, ''))) !~ '^[A-Z]{4}[0-9]{7}$' THEN
    RAISE EXCEPTION 'Container inválido.' USING ERRCODE = '22023';
  END IF;

  -- A descrição sem acento é a marca da unidade manual.
  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, 'Inclusao manual no Embarque de Vazios', 1, p_uploaded_by)
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_bookings (
    voyage_id, operation_id, manifest_id, container_number, container_type,
    local_id, condition, hand_in_date, hand_out_date, movement_date
  ) VALUES (
    p_voyage_id, p_operation_id, v_manifest_id, upper(btrim(p_container_number)), p_container_type,
    p_local_id, p_condition, p_hand_in_date, p_hand_out_date, p_movement_date
  ) RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_manual_vazios_booking(p_booking_id uuid, p_container_number text, p_container_type text, p_local_id uuid, p_condition text, p_hand_in_date date, p_hand_out_date date, p_movement_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_booking record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para editar unidade.' USING ERRCODE = '42501';
  END IF;
  SELECT b.id, b.voyage_id, COALESCE(op.embark_port, b.pol) AS port INTO v_booking
  FROM public.vazios_bookings AS b
  LEFT JOIN public.vazios_export_operations AS op ON op.id = b.operation_id
  WHERE b.id = p_booking_id;
  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Unidade embarcada não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF public._vazios_export_locked_by_adr(v_booking.voyage_id, v_booking.port) THEN
    RAISE EXCEPTION '%', public._vazios_export_adr_lock_message(v_booking.port) USING ERRCODE = '23514';
  END IF;
  IF upper(btrim(COALESCE(p_container_number, ''))) !~ '^[A-Z]{4}[0-9]{7}$' THEN
    RAISE EXCEPTION 'Container inválido.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.vazios_bookings
  SET container_number = upper(btrim(p_container_number)),
      container_type = p_container_type,
      local_id = p_local_id,
      condition = p_condition,
      hand_in_date = p_hand_in_date,
      hand_out_date = p_hand_out_date,
      movement_date = p_movement_date
  WHERE id = p_booking_id;
END;
$function$;
