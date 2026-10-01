-- 117: A importação de Vazios de Importação passa a gravar o Nº do manifesto
-- Mercante (natureza 'vazio') na MESMA transação dos containers. Antes o
-- cliente fazia duas gravações; se a segunda falhasse, o manifesto ficava
-- órfão e só um admin podia apagá-lo (manifestos_mercante_delete_policy),
-- travando a nova tentativa com o mesmo número.
-- A rota (POL/POD) vem dos containers: todos precisam ter POL e POD e a
-- planilha precisa ter uma única rota, porque o número pertence à rota.
-- p_manifest_numero tem DEFAULT NULL só para que uma aba antiga (cliente
-- anterior a esta migration) receba a mensagem de obrigatoriedade em vez de
-- "função não encontrada". Não reescreve nem apaga linhas existentes.

DROP FUNCTION IF EXISTS public.import_vazios_importacao_transactional(bigint, text, uuid, jsonb);

CREATE FUNCTION public.import_vazios_importacao_transactional(
  p_voyage_id bigint,
  p_description text,
  p_uploaded_by uuid,
  p_containers jsonb,
  p_manifest_numero text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id uuid;
  v_mercante_id uuid;
  v_numero text := NULLIF(btrim(COALESCE(p_manifest_numero, '')), '');
  v_containers jsonb := COALESCE(p_containers, '[]'::jsonb);
  v_total integer;
  v_sem_rota integer;
  v_rotas integer;
  v_pol text;
  v_pod text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_numero IS NULL THEN
    RAISE EXCEPTION 'Número do manifesto Mercante é obrigatório.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE NULLIF(btrim(item.pol), '') IS NULL OR NULLIF(btrim(item.pod), '') IS NULL),
         count(DISTINCT (btrim(item.pol), btrim(item.pod))),
         min(btrim(item.pol)),
         min(btrim(item.pod))
    INTO v_total, v_sem_rota, v_rotas, v_pol, v_pod
    FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text);

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhum container na planilha.' USING ERRCODE = '22023';
  END IF;
  IF v_sem_rota > 0 THEN
    RAISE EXCEPTION 'POL e POD são obrigatórios em todas as linhas: o Nº de manifesto Mercante pertence à rota.' USING ERRCODE = '22023';
  END IF;
  IF v_rotas > 1 THEN
    RAISE EXCEPTION 'A planilha tem % rotas. Importe uma planilha por rota, cada uma com o seu manifesto.', v_rotas USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.manifestos_mercante WHERE numero = v_numero) THEN
    RAISE EXCEPTION 'O número de manifesto Mercante "%" já foi cadastrado no sistema.', v_numero USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza)
  VALUES (p_voyage_id, v_pol, v_pod, v_numero, 'vazio')
  RETURNING id INTO v_mercante_id;

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

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'mercante_manifest_id', v_mercante_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_vazios_importacao_transactional(bigint, text, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_vazios_importacao_transactional(bigint, text, uuid, jsonb, text) TO authenticated;
