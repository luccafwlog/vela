-- 603: Embarque de vazios com porto de descarga, preço por tamanho e free time
-- congelado (decisões do dono de 2026-11-06, ADR 0130; revisão em
-- docs/archive/audits/2026-11-06-revisao-embarque-de-vazios.md).
--
-- 1. Porto de descarga (POD) obrigatório na Unidade embarcada. O POL é o porto
--    do embarque, gravado pelo banco; o POD vem da planilha ou da janela, na
--    régua de `normalize_port_code`, em LOCODE e diferente do porto do
--    embarque. As colunas `vazios_bookings.pol/pod` existem desde a 053 e
--    nunca foram gravadas. `create_manual_vazios_booking` e
--    `update_manual_vazios_booking` ganham `p_pod` (assinatura nova; a antiga
--    sai), e `import_vazios_bookings_transactional_legacy_189` lê `pod` de
--    cada unidade.
-- 2. Terminal portuário do porto do embarque: a unidade de Embarque direto só
--    aceita terminal cujo porto (`depots.port_id`) é o do embarque.
-- 3. Nº do Manifesto Mercante da rota de exportação (porto do embarque → POD):
--    os vazios já embarcam manifestados, e o Vela só registra o número, pela
--    mesma gravação de Rotas e Manifestos (`set_voyage_route_ce_master`,
--    natureza vazios). A limpeza `_vazios_importacao_prune` passa a manter o
--    Nº de vazios cuja rota tem unidade embarcada na Viagem (antes ela o
--    apagaria na próxima importação de Vazios de importação) e roda também
--    quando as unidades do Embarque mudam.
-- 4. Preço por tamanho: `depot_services.container_type` e
--    `vazios_export_service_lines.container_type` guardam o tamanho, '20' ou
--    '40' (nulo = qualquer tamanho). A linha recebe o tamanho do serviço. A
--    armazenagem passa a ser única por (embarque, depot, condição, tamanho),
--    no lugar de (embarque, depot, condição).
-- 5. Free time congelado: `vazios_export_service_lines.free_time_days` guarda
--    o free time do depot para a condição no lançamento da linha de
--    armazenagem (ou na troca de serviço, local ou condição); depois, mudar o
--    cadastro não muda a linha. Linha anterior a esta migration fica com nulo
--    e segue o cadastro, como antes.
--
-- Plano de preservação: a migration não reescreve nem apaga linha existente.
-- Ela acrescenta a coluna `free_time_days` (nula nas linhas que já existem),
-- duas checagens NOT VALID (só valem para linhas novas ou alteradas), troca o
-- índice único da armazenagem por um mais largo (toda combinação aceita antes
-- continua aceita) e redefine funções. Unidades já gravadas sem POD continuam
-- como estão; o POD passa a ser pedido na próxima edição delas. Em 2026-11-06
-- a produção não tinha nenhum Embarque de vazios, unidade nem linha (consulta
-- da revisão). Conferir: `SELECT count(*) FILTER (WHERE pod IS NULL),
-- count(*) FROM public.vazios_bookings;` e `SELECT count(*) FROM
-- public.vazios_export_service_lines WHERE free_time_days IS NOT NULL;`.
-- Desfazer: largar o índice `uq_vazios_storage_line_operation_local_condition_size`
-- e recriar `uq_vazios_storage_line_operation_local_condition` (operation_id,
-- local_id, condition) WHERE condition IS NOT NULL; largar as checagens
-- `depot_services_container_size_check` e
-- `vazios_export_service_lines_container_size_check` e a coluna
-- `free_time_days` (só depois de copiar os valores, se já houver linha
-- lançada); reaplicar as funções pela 326, 331, 398, 573 e 192.
-- ponytail: o tamanho é '20' ou '40' (primeiro caractere do tipo ISO: 2 ou 4);
-- 45 pés e tipos sem tamanho caem no serviço sem tamanho. Upgrade: uma terceira
-- faixa se algum depot cobrar 45 pés à parte.

-- 1. Colunas, checagens e índice ---------------------------------------------

ALTER TABLE public.vazios_export_service_lines
  ADD COLUMN IF NOT EXISTS free_time_days integer;
ALTER TABLE public.vazios_export_service_lines
  ADD CONSTRAINT vazios_export_service_lines_free_time_days_check
  CHECK (free_time_days IS NULL OR free_time_days >= 0);
COMMENT ON COLUMN public.vazios_export_service_lines.free_time_days IS
  'Free time do depot para a condição, congelado no lançamento da linha de armazenagem (603). Nulo: linha anterior à 603, segue o cadastro.';

ALTER TABLE public.depot_services
  ADD CONSTRAINT depot_services_container_size_check
  CHECK (container_type IS NULL OR container_type IN ('20', '40')) NOT VALID;
ALTER TABLE public.vazios_export_service_lines
  ADD CONSTRAINT vazios_export_service_lines_container_size_check
  CHECK (container_type IS NULL OR container_type IN ('20', '40')) NOT VALID;
COMMENT ON COLUMN public.depot_services.container_type IS
  'Tamanho do container que o serviço cobra: 20 ou 40 (603). Nulo: qualquer tamanho.';
COMMENT ON COLUMN public.vazios_export_service_lines.container_type IS
  'Tamanho do serviço lançado, copiado do catálogo (603): 20, 40 ou nulo.';

DROP INDEX IF EXISTS public.uq_vazios_storage_line_operation_local_condition;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vazios_storage_line_operation_local_condition_size
  ON public.vazios_export_service_lines (operation_id, local_id, condition, COALESCE(container_type, ''))
  WHERE condition IS NOT NULL;

-- 2. Unidade: POL do embarque, POD obrigatório, terminal do porto -----------

CREATE OR REPLACE FUNCTION public.validate_vazios_booking_operation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_operation_voyage_id BIGINT;
  v_embark_port TEXT;
  v_local_tipo TEXT;
  v_local_active BOOLEAN;
  v_local_code TEXT;
  v_local_port TEXT;
  v_raw_pod TEXT := NULLIF(btrim(COALESCE(NEW.pod, '')), '');
  v_unit_changed BOOLEAN;
BEGIN
  SELECT op.voyage_id, COALESCE(public.normalize_port_code(op.embark_port), upper(btrim(op.embark_port)))
    INTO v_operation_voyage_id, v_embark_port
  FROM public.vazios_export_operations AS op WHERE op.id = NEW.operation_id;
  SELECT d.tipo, d.active, d.code, public.normalize_port_code(p.locode)
    INTO v_local_tipo, v_local_active, v_local_code, v_local_port
  FROM public.depots AS d
  LEFT JOIN public.ports AS p ON p.id = d.port_id
  WHERE d.id = NEW.local_id;
  IF v_operation_voyage_id IS NULL OR v_operation_voyage_id <> NEW.voyage_id THEN
    RAISE EXCEPTION 'A unidade deve pertencer a um embarque da mesma viagem.' USING ERRCODE = '22023';
  END IF;
  IF v_local_tipo IS NULL THEN RAISE EXCEPTION 'Local inválido.' USING ERRCODE = '22023'; END IF;
  -- V1: local inativo não entra em lançamento novo; a unidade que já está nele
  -- pode ser editada sem trocar de local.
  IF NOT v_local_active AND (TG_OP = 'INSERT' OR NEW.local_id IS DISTINCT FROM OLD.local_id) THEN
    RAISE EXCEPTION 'Local inativo: escolha um local ativo ou reative o local no cadastro.' USING ERRCODE = '22023';
  END IF;
  IF v_local_tipo = 'depot' AND (NEW.hand_in_date IS NULL OR NEW.hand_out_date IS NULL OR NEW.hand_out_date < NEW.hand_in_date) THEN
    RAISE EXCEPTION 'Depot exige entrada e saída válidas.' USING ERRCODE = '22023';
  END IF;
  IF v_local_tipo = 'terminal_portuario' AND (NEW.hand_in_date IS NOT NULL OR NEW.hand_out_date IS NOT NULL) THEN
    RAISE EXCEPTION 'Terminal portuário não aceita entrada ou saída.' USING ERRCODE = '22023';
  END IF;
  -- 603: o Embarque direto sai de um terminal do porto do embarque.
  IF v_local_tipo = 'terminal_portuario' AND (TG_OP = 'INSERT' OR NEW.local_id IS DISTINCT FROM OLD.local_id)
     AND v_local_port IS DISTINCT FROM v_embark_port THEN
    RAISE EXCEPTION 'O terminal portuário % fica em %, e o embarque é em %: use um terminal de % ou um depot.',
      v_local_code, COALESCE(v_local_port, 'porto não cadastrado'), v_embark_port, v_embark_port
      USING ERRCODE = '22023';
  END IF;

  -- 603: POL é o porto do embarque; POD é obrigatório, em LOCODE, e não é o
  -- porto do embarque. A unidade gravada antes da 603 sem POD continua até a
  -- próxima mudança dela.
  NEW.pol := v_embark_port;
  NEW.pod := CASE WHEN v_raw_pod IS NULL THEN NULL ELSE public.normalize_port_code(v_raw_pod) END;
  v_unit_changed := TG_OP = 'INSERT'
    OR NEW.pod IS DISTINCT FROM OLD.pod
    OR NEW.container_number IS DISTINCT FROM OLD.container_number
    OR NEW.container_type IS DISTINCT FROM OLD.container_type
    OR NEW.local_id IS DISTINCT FROM OLD.local_id
    OR NEW.condition IS DISTINCT FROM OLD.condition
    OR NEW.hand_in_date IS DISTINCT FROM OLD.hand_in_date
    OR NEW.hand_out_date IS DISTINCT FROM OLD.hand_out_date
    OR NEW.movement_date IS DISTINCT FROM OLD.movement_date;
  IF v_unit_changed AND NEW.pod IS NULL THEN
    RAISE EXCEPTION 'Porto de descarga obrigatório no container %: informe o LOCODE do porto onde o vazio descarrega (ex.: CNSHA).',
      NEW.container_number USING ERRCODE = '22023';
  END IF;
  IF NEW.pod IS NOT NULL AND NEW.pod !~ '^[A-Z]{2}[A-Z0-9]{3}$' THEN
    RAISE EXCEPTION 'Porto de descarga inválido no container %: "%". Use o LOCODE de 5 caracteres (ex.: CNSHA).',
      NEW.container_number, v_raw_pod USING ERRCODE = '22023';
  END IF;
  IF NEW.pod IS NOT NULL AND NEW.pod = v_embark_port THEN
    RAISE EXCEPTION 'O porto de descarga do container % não pode ser o porto do embarque (%).',
      NEW.container_number, v_embark_port USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Limpeza do Nº de vazios: rota viva de importação ou de exportação -------

CREATE OR REPLACE FUNCTION public._vazios_importacao_prune(p_voyage_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_count integer := 0; v_more integer;
BEGIN
  DELETE FROM public.vazios_importacao_manifests m
  WHERE m.voyage_id = p_voyage_id
    AND NOT EXISTS (SELECT 1 FROM public.vazios_importacao_containers c WHERE c.manifest_id = m.id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  WITH gone AS (
    DELETE FROM public.manifestos_mercante mm
    WHERE mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio'
      AND NOT EXISTS (SELECT 1 FROM public.bls b WHERE b.manifesto_mercante_id = mm.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.vazios_importacao_containers c
        JOIN public.vazios_importacao_manifests m ON m.id = c.manifest_id
        WHERE m.voyage_id = p_voyage_id
          AND public.normalize_port_code(c.pol) = public.normalize_port_code(mm.pol)
          AND public.normalize_port_code(c.pod) = public.normalize_port_code(mm.pod)
      )
      -- 603: a rota de exportação do Embarque de vazios (porto do embarque →
      -- POD da unidade) também é rota viva.
      AND NOT EXISTS (
        SELECT 1 FROM public.vazios_bookings b
        WHERE b.voyage_id = p_voyage_id
          AND public.normalize_port_code(b.pol) = public.normalize_port_code(mm.pol)
          AND public.normalize_port_code(b.pod) = public.normalize_port_code(mm.pod)
      )
    RETURNING mm.voyage_id, mm.numero
  ), mirror AS (
    DELETE FROM public.voyage_route_ce_master cm
    USING gone
    WHERE cm.voyage_id = gone.voyage_id AND cm.cargo_mode = 'vazios' AND cm.ce_master = gone.numero
    RETURNING cm.id
  )
  SELECT count(*) INTO v_more FROM gone;
  UPDATE public.vazios_importacao_manifests m
  SET total_containers = (SELECT count(*) FROM public.vazios_importacao_containers c WHERE c.manifest_id = m.id)
  WHERE m.voyage_id = p_voyage_id;
  RETURN v_count + v_more;
END $function$;
REVOKE ALL ON FUNCTION public._vazios_importacao_prune(bigint) FROM PUBLIC, anon, authenticated;

-- 4. Importação da planilha: POD por unidade ---------------------------------

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional_legacy_189(p_voyage_id bigint, p_port text, p_uploaded_by uuid, p_bookings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id UUID;
  v_operation_id UUID;
  v_total INTEGER := jsonb_array_length(COALESCE(p_bookings, '[]'::JSONB));
  v_updated INTEGER := 0;
  v_inserted INTEGER := 0;
  v_removed INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para importar unidades.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_port), '') IS NULL THEN
    RAISE EXCEPTION 'Porto de embarque obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(container_number TEXT)
    GROUP BY upper(btrim(container_number))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Planilha inválida: Container duplicado na planilha.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vazios_export_operations (voyage_id, embark_port, updated_at)
  VALUES (p_voyage_id, upper(btrim(p_port)), now())
  ON CONFLICT (voyage_id, embark_port) DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_operation_id;

  -- ponytail: validacao no RPC e tudo-ou-nada para nao subestimar pagamento por erro de uma linha.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS r(
      container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
      hand_in_date DATE, hand_out_date DATE, movement_date DATE, pod TEXT
    )
    LEFT JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code))
    WHERE NULLIF(btrim(r.container_number), '') IS NULL
       OR r.container_number !~ '^[A-Za-z]{4}[0-9]{7}$'
       OR NULLIF(btrim(r.local_code), '') IS NULL
       OR d.id IS NULL
       OR (d.id IS NOT NULL AND NOT d.active)
       OR (COALESCE(d.tipo, 'depot') = 'depot' AND (r.hand_in_date IS NULL OR r.hand_out_date IS NULL))
       OR (COALESCE(d.tipo, 'depot') = 'depot' AND r.hand_out_date < r.hand_in_date)
       OR (d.id IS NOT NULL AND d.tipo = 'terminal_portuario' AND (r.hand_in_date IS NOT NULL OR r.hand_out_date IS NOT NULL))
       OR r.condition IS NULL OR r.condition NOT IN ('vazio', 'material')
       -- 603: POD obrigatório, em LOCODE (o gatilho da unidade dá o motivo).
       OR NULLIF(btrim(COALESCE(r.pod, '')), '') IS NULL
       OR COALESCE(public.normalize_port_code(r.pod), '') !~ '^[A-Z]{2}[A-Z0-9]{3}$'
  ) THEN
    RAISE EXCEPTION 'Planilha inválida: corrija todas as linhas e importe novamente.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_bookings_in (
    container_number text, container_type text, local_id uuid, condition text,
    hand_in_date date, hand_out_date date, movement_date date, pod text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_bookings_in;
  INSERT INTO pg_temp.vazios_bookings_in (container_number, container_type, local_id, condition, hand_in_date, hand_out_date, movement_date, pod)
  SELECT upper(btrim(r.container_number)), r.container_type, d.id, r.condition, r.hand_in_date, r.hand_out_date, r.movement_date,
         public.normalize_port_code(r.pod)
  FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS r(
    container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
    hand_in_date DATE, hand_out_date DATE, movement_date DATE, pod TEXT
  )
  JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code)) AND d.active;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_port, v_total, p_uploaded_by) RETURNING id INTO v_manifest_id;

  -- Atualiza por container (o mesmo id), inclusive a unidade incluída à mão.
  UPDATE public.vazios_bookings b
  SET container_type = i.container_type, local_id = i.local_id, condition = i.condition,
      hand_in_date = i.hand_in_date, hand_out_date = i.hand_out_date, movement_date = i.movement_date,
      pod = i.pod
  FROM pg_temp.vazios_bookings_in i
  WHERE b.operation_id = v_operation_id AND upper(btrim(b.container_number)) = i.container_number;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO public.vazios_bookings (
    voyage_id, operation_id, manifest_id, container_number, container_type,
    local_id, condition, hand_in_date, hand_out_date, movement_date, pod
  )
  SELECT p_voyage_id, v_operation_id, v_manifest_id, i.container_number, i.container_type, i.local_id,
         i.condition, i.hand_in_date, i.hand_out_date, i.movement_date, i.pod
  FROM pg_temp.vazios_bookings_in i
  WHERE NOT EXISTS (SELECT 1 FROM public.vazios_bookings b
                    WHERE b.operation_id = v_operation_id AND upper(btrim(b.container_number)) = i.container_number);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Unidade de planilha anterior que o arquivo novo não traz sai; a incluída à
  -- mão (manifesto de inclusão manual) fica.
  -- ponytail: a unidade manual é reconhecida pela descrição do manifesto que
  -- `create_manual_vazios_booking` grava; uma coluna de origem seria o upgrade.
  DELETE FROM public.vazios_bookings b
  USING public.vazios_manifests vm
  WHERE vm.id = b.manifest_id AND b.operation_id = v_operation_id
    AND vm.description IS DISTINCT FROM 'Inclusao manual no Embarque de Vazios'
    AND NOT EXISTS (SELECT 1 FROM pg_temp.vazios_bookings_in i WHERE i.container_number = upper(btrim(b.container_number)));
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Manifestos sem unidade não ficam órfãos.
  DELETE FROM public.vazios_manifests vm
  WHERE vm.voyage_id = p_voyage_id
    AND NOT EXISTS (SELECT 1 FROM public.vazios_bookings b WHERE b.manifest_id = vm.id);
  -- Os totais lidos pelos cards contam as unidades que ficaram em cada manifesto.
  UPDATE public.vazios_manifests vm
  SET total_bookings = (SELECT count(*) FROM public.vazios_bookings b WHERE b.manifest_id = vm.id)
  WHERE vm.voyage_id = p_voyage_id;
  -- 603: o Nº de rota de exportação que ficou sem unidade sai, como na importação.
  PERFORM public._vazios_importacao_prune(p_voyage_id);

  RETURN jsonb_build_object(
    'manifest_id', CASE WHEN EXISTS (SELECT 1 FROM public.vazios_manifests WHERE id = v_manifest_id) THEN v_manifest_id END,
    'operation_id', v_operation_id,
    'total', v_total,
    'updated', v_updated,
    'inserted', v_inserted,
    'removed', v_removed,
    'replaced', FALSE
  );
END;
$function$;

-- 5. Inclusão, edição e exclusão manual com POD ------------------------------

DROP FUNCTION IF EXISTS public.create_manual_vazios_booking(uuid, bigint, uuid, text, text, uuid, text, date, date, date);
CREATE FUNCTION public.create_manual_vazios_booking(p_operation_id uuid, p_voyage_id bigint, p_uploaded_by uuid, p_container_number text, p_container_type text, p_local_id uuid, p_condition text, p_hand_in_date date, p_hand_out_date date, p_movement_date date, p_pod text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  -- O gatilho `validate_vazios_booking_operation` grava o POL e confere o POD.
  INSERT INTO public.vazios_bookings (
    voyage_id, operation_id, manifest_id, container_number, container_type,
    local_id, condition, hand_in_date, hand_out_date, movement_date, pod
  ) VALUES (
    p_voyage_id, p_operation_id, v_manifest_id, upper(btrim(p_container_number)), p_container_type,
    p_local_id, p_condition, p_hand_in_date, p_hand_out_date, p_movement_date, p_pod
  ) RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_manual_vazios_booking(uuid, bigint, uuid, text, text, uuid, text, date, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_vazios_booking(uuid, bigint, uuid, text, text, uuid, text, date, date, date, text) TO authenticated;

DROP FUNCTION IF EXISTS public.update_manual_vazios_booking(uuid, text, text, uuid, text, date, date, date);
CREATE FUNCTION public.update_manual_vazios_booking(p_booking_id uuid, p_container_number text, p_container_type text, p_local_id uuid, p_condition text, p_hand_in_date date, p_hand_out_date date, p_movement_date date, p_pod text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
      movement_date = p_movement_date,
      pod = p_pod
  WHERE id = p_booking_id;
  -- 603: trocar o POD pode deixar a rota antiga sem unidade.
  PERFORM public._vazios_importacao_prune(v_booking.voyage_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.update_manual_vazios_booking(uuid, text, text, uuid, text, date, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_manual_vazios_booking(uuid, text, text, uuid, text, date, date, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_manual_vazios_booking(p_booking_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking RECORD;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para excluir unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.' USING ERRCODE = '22023';
  END IF;

  SELECT b.id, b.manifest_id, b.voyage_id, COALESCE(op.embark_port, b.pol) AS port
    INTO v_booking
  FROM public.vazios_bookings AS b
  LEFT JOIN public.vazios_export_operations AS op ON op.id = b.operation_id
  WHERE b.id = p_booking_id;
  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Unidade embarcada não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF public._vazios_export_locked_by_adr(v_booking.voyage_id, v_booking.port) THEN
    RAISE EXCEPTION 'ADR de Saída fechado: reabra o ADR para excluir a unidade.' USING ERRCODE = '23514';
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
  -- 603: a última unidade de uma rota leva o Nº da rota de exportação junto.
  PERFORM public._vazios_importacao_prune(v_booking.voyage_id);
END;
$function$;

-- 6. Linha de serviço: tamanho do serviço e free time congelado -------------

CREATE OR REPLACE FUNCTION public.validate_vazios_export_service_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_natureza TEXT;
  v_service_local UUID;
  v_service_destino UUID;
  v_service_condition TEXT;
  v_service_size TEXT;
  v_service_active BOOLEAN;
  v_local_tipo TEXT;
  v_local_active BOOLEAN;
  v_free_time_vazio INTEGER;
  v_free_time_material INTEGER;
  v_destino_active BOOLEAN;
  v_new_launch BOOLEAN;
BEGIN
  SELECT natureza, depot_id, route_destino_id, condition, container_type, active
    INTO v_natureza, v_service_local, v_service_destino, v_service_condition, v_service_size, v_service_active
  FROM public.depot_services WHERE id = NEW.service_id;
  SELECT tipo, active, free_time_vazio_days, free_time_material_days
    INTO v_local_tipo, v_local_active, v_free_time_vazio, v_free_time_material
  FROM public.depots WHERE id = NEW.local_id;

  IF v_natureza IS NULL OR v_service_local IS DISTINCT FROM NEW.local_id THEN
    RAISE EXCEPTION 'O serviço deve pertencer ao local informado.' USING ERRCODE = '23514';
  END IF;
  -- V1: local, serviço e destino inativos não entram em lançamento novo; a
  -- linha já lançada pode mudar (observação) sem trocar nenhum deles.
  v_new_launch := TG_OP = 'INSERT'
    OR NEW.service_id IS DISTINCT FROM OLD.service_id
    OR NEW.local_id IS DISTINCT FROM OLD.local_id
    OR NEW.destino_id IS DISTINCT FROM OLD.destino_id;
  IF v_new_launch AND NOT v_local_active THEN
    RAISE EXCEPTION 'Local inativo: escolha um local ativo ou reative o local no cadastro.' USING ERRCODE = '23514';
  END IF;
  IF v_new_launch AND NOT v_service_active THEN
    RAISE EXCEPTION 'Serviço inativo: escolha um serviço ativo ou reative o serviço no cadastro do local.' USING ERRCODE = '23514';
  END IF;
  -- 603: o tamanho da linha é o do serviço no lançamento; depois não muda por
  -- escrita direta.
  IF v_new_launch THEN
    NEW.container_type := v_service_size;
  ELSE
    NEW.container_type := OLD.container_type;
  END IF;
  IF v_natureza = 'armazenagem' THEN
    IF v_local_tipo <> 'depot' OR NEW.condition IS NULL
       -- B12 (ADR 0033): serviço sem condição é genérico e vale para as duas.
       OR (v_service_condition IS NOT NULL AND v_service_condition <> NEW.condition)
       OR NEW.destino_id IS NOT NULL
       OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Armazenagem exige depot e a condição da linha (a do serviço, quando ele tem uma), sem rota ou percentual.' USING ERRCODE = '23514';
    END IF;
    -- 603: free time do depot para a condição, congelado no lançamento.
    IF v_new_launch OR NEW.condition IS DISTINCT FROM OLD.condition THEN
      NEW.free_time_days := CASE WHEN NEW.condition = 'material' THEN v_free_time_material ELSE v_free_time_vazio END;
    ELSE
      NEW.free_time_days := OLD.free_time_days;
    END IF;
  ELSIF v_natureza = 'transporte' THEN
    IF v_service_destino IS NULL OR NEW.destino_id IS DISTINCT FROM v_service_destino
       OR NEW.condition IS NOT NULL OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Transporte exige o destino vinculado ao serviço, sem condição ou percentual.' USING ERRCODE = '23514';
    END IF;
    SELECT active INTO v_destino_active FROM public.depots WHERE id = NEW.destino_id;
    IF v_new_launch AND v_destino_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Destino inativo: escolha um transporte para local ativo ou reative o destino no cadastro.' USING ERRCODE = '23514';
    END IF;
    NEW.free_time_days := NULL;
  ELSIF v_natureza = 'geral' THEN
    IF NEW.destino_id IS NOT NULL OR NEW.condition IS NOT NULL OR NEW.percentual IS NOT NULL THEN
      RAISE EXCEPTION 'Serviço geral não aceita rota, condição ou percentual.' USING ERRCODE = '23514';
    END IF;
    NEW.free_time_days := NULL;
  ELSE
    RAISE EXCEPTION 'Natureza de serviço inválida.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
