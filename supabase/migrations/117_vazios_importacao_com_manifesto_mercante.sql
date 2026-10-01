-- 117: A importação de Vazios de Importação por planilha passa a gravar o Nº do
-- manifesto Mercante (natureza 'vazio') na MESMA transação dos containers.
-- Antes o cliente fazia duas gravações; se a segunda falhasse, o manifesto
-- ficava órfão e só um admin podia apagá-lo (manifestos_mercante_delete_policy),
-- travando a nova tentativa com o mesmo número.
-- Regra (decisão de 2026-10-01): um Nº de manifesto Mercante para cada porto de
-- origem dos vazios. Como cada manifesto pertence a uma rota POL/POD
-- (manifestos_mercante.numero é UNIQUE), p_manifestos traz um número por rota
-- da planilha: [{"pol","pod","numero"}]. Todos os containers precisam de POL e
-- POD, toda rota da planilha precisa de número e nenhum número pode repetir
-- (nem na planilha nem um já cadastrado). Reimportar a mesma rota com outro
-- número é permitido; só o número igual bloqueia.
-- p_manifestos tem DEFAULT NULL só para que uma aba antiga (cliente anterior a
-- esta migration) receba a mensagem de obrigatoriedade em vez de "função não
-- encontrada". Não reescreve nem apaga linhas existentes.

DROP FUNCTION IF EXISTS public.import_vazios_importacao_transactional(bigint, text, uuid, jsonb);

CREATE FUNCTION public.import_vazios_importacao_transactional(
  p_voyage_id bigint,
  p_description text,
  p_uploaded_by uuid,
  p_containers jsonb,
  p_manifestos jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id uuid;
  v_containers jsonb := COALESCE(p_containers, '[]'::jsonb);
  v_manifestos jsonb := COALESCE(p_manifestos, '[]'::jsonb);
  v_total integer;
  v_sem_rota integer;
  v_rotas_sem_numero text;
  v_numero_repetido text;
  v_numero_cadastrado text;
  v_mercante_ids jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(v_manifestos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Número do manifesto Mercante é obrigatório.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE NULLIF(btrim(item.pol), '') IS NULL OR NULLIF(btrim(item.pod), '') IS NULL)
    INTO v_total, v_sem_rota
    FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text);

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhum container na planilha.' USING ERRCODE = '22023';
  END IF;
  IF v_sem_rota > 0 THEN
    RAISE EXCEPTION 'POL e POD são obrigatórios em todas as linhas: o Nº de manifesto Mercante pertence ao porto de origem.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_import_manifestos (pol text, pod text, numero text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_import_manifestos;
  INSERT INTO pg_temp.vazios_import_manifestos
  SELECT upper(btrim(m.pol)), upper(btrim(m.pod)), NULLIF(btrim(m.numero), '')
  FROM jsonb_to_recordset(v_manifestos) AS m(pol text, pod text, numero text);

  -- Toda rota da planilha precisa de exatamente um número.
  SELECT string_agg(r.pol || ' → ' || r.pod, ', ' ORDER BY r.pol, r.pod)
    INTO v_rotas_sem_numero
    FROM (
      SELECT DISTINCT upper(btrim(item.pol)) AS pol, upper(btrim(item.pod)) AS pod
      FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text)
    ) r
    WHERE (SELECT count(*) FROM pg_temp.vazios_import_manifestos m
           WHERE m.pol = r.pol AND m.pod = r.pod AND m.numero IS NOT NULL) <> 1;
  IF v_rotas_sem_numero IS NOT NULL THEN
    RAISE EXCEPTION 'Informe um Nº de manifesto Mercante para cada porto de origem: falta em %.', v_rotas_sem_numero USING ERRCODE = '22023';
  END IF;
  -- Número sem container na planilha também é recusado (não cria manifesto vazio de conteúdo).
  IF EXISTS (
    SELECT 1 FROM pg_temp.vazios_import_manifestos m
    WHERE m.numero IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text)
      WHERE upper(btrim(item.pol)) = m.pol AND upper(btrim(item.pod)) = m.pod
    )
  ) THEN
    RAISE EXCEPTION 'Há Nº de manifesto Mercante para uma rota que não está na planilha.' USING ERRCODE = '22023';
  END IF;

  SELECT min(numero) INTO v_numero_repetido
    FROM (SELECT numero FROM pg_temp.vazios_import_manifestos GROUP BY numero HAVING count(*) > 1) d;
  IF v_numero_repetido IS NOT NULL THEN
    RAISE EXCEPTION 'O número de manifesto Mercante "%" foi informado para mais de um porto de origem.', v_numero_repetido USING ERRCODE = '22023';
  END IF;

  SELECT min(m.numero) INTO v_numero_cadastrado
    FROM pg_temp.vazios_import_manifestos m
    JOIN public.manifestos_mercante mm ON mm.numero = m.numero;
  IF v_numero_cadastrado IS NOT NULL THEN
    RAISE EXCEPTION 'O número de manifesto Mercante "%" já foi cadastrado no sistema.', v_numero_cadastrado USING ERRCODE = '23505';
  END IF;

  WITH inserted AS (
    INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza)
    SELECT p_voyage_id, m.pol, m.pod, m.numero, 'vazio'
    FROM pg_temp.vazios_import_manifestos m
    RETURNING id, numero
  )
  SELECT jsonb_agg(id ORDER BY numero) INTO v_mercante_ids FROM inserted;

  INSERT INTO public.vazios_importacao_manifests (
    voyage_id, description, total_containers, imported_by, source
  )
  VALUES (p_voyage_id, p_description, v_total, p_uploaded_by, 'manual')
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_importacao_containers (
    manifest_id, container_number, container_type, tare_kg, pol, pod
  )
  SELECT v_manifest_id, item.container_number, item.container_type, item.tare_kg, item.pol, item.pod
  FROM jsonb_to_recordset(v_containers) AS item(
    container_number text,
    container_type text,
    tare_kg numeric,
    pol text,
    pod text
  );

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'mercante_manifest_ids', v_mercante_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_vazios_importacao_transactional(bigint, text, uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_vazios_importacao_transactional(bigint, text, uuid, jsonb, jsonb) TO authenticated;
