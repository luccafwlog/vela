-- 336 — Baplie sem vazios tira da Viagem os vazios que vieram do Baplie
-- anterior (decisão do responsável em 2026-10-20: um Baplie sempre traz os
-- vazios; sem vazios no arquivo, não há vazios a manter).
--
-- Antes, ao substituir um Baplie que tinha vazios por um sem nenhum, o
-- recadastro (`replace_vazios_from_baplie_transactional`) recusava com
-- "Nenhum container vazio encontrado no Baplie desta viagem": o Baplie novo
-- ficava gravado, a Viagem continuava com os vazios do Baplie anterior e
-- "Atualizar vazios do Baplie" falhava do mesmo jeito para sempre.
--
-- Agora, no recadastro (`p_replace_existing = true`) com zero vazios no
-- Baplie, o manifesto de vazios de origem `baplie` sai (os containers vão em
-- cascata) e `_vazios_importacao_prune` (migration 187) tira o Nº do manifesto
-- Mercante `vazio` das rotas que ficaram sem container; os vazios importados
-- por planilha não são tocados. A natureza (cama/cover plate) digitada nesses
-- containers sai com eles; o diálogo "Substituir o Baplie da viagem" avisa
-- antes de confirmar. No primeiro cadastro (`p_replace_existing = false`),
-- Baplie sem vazios continua recusado: não há o que cadastrar.
--
-- Só redefine a função: não reescreve nem apaga linhas existentes na
-- aplicação da migration. Rollback: reaplicar a definição da migration 187.

CREATE OR REPLACE FUNCTION public.replace_vazios_from_baplie_transactional(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_replace_existing boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_manifest_id UUID;
  v_total INTEGER;
  v_pruned INTEGER;
  v_removed INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar vazios Baplie.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  SELECT count(*)::INTEGER
  INTO v_total
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id AND status = 'empty';

  IF v_total = 0 THEN
    IF NOT p_replace_existing THEN
      RAISE EXCEPTION 'Nenhum container vazio encontrado no Baplie desta viagem.'
        USING ERRCODE = 'P0002';
    END IF;
    -- Baplie novo sem vazios: os vazios do Baplie anterior saem da Viagem.
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    v_pruned := public._vazios_importacao_prune(p_voyage_id);
    RETURN jsonb_build_object('manifest_id', NULL, 'total', 0, 'pruned', v_pruned, 'removed', v_removed > 0);
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
  FROM public.baplie_containers b
  LEFT JOIN pg_temp.vazios_natureza n ON n.container_number = upper(btrim(b.container_number))
  WHERE b.voyage_id = p_voyage_id AND b.status = 'empty';

  v_pruned := public._vazios_importacao_prune(p_voyage_id);

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total, 'pruned', v_pruned, 'removed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.replace_vazios_from_baplie_transactional(bigint, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_vazios_from_baplie_transactional(bigint, text, uuid, boolean) TO authenticated;
