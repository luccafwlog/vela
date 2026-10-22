-- 405: hash do arquivo importado — nome, hash, quem e quando no lote de toda
-- importação por arquivo; reenvio só avisa (Lote 10 do plano
-- docs/plans/2026-10-21-frente-das-importacoes.md; ADR 0095, decisão 3, que
-- muda em parte o item 9 da ADR 0078: nenhum arquivo é guardado, só o hash).
--
-- Problemas:
--   1. Só `import_batches` tinha `file_hash`, e nenhuma importação da tela o
--      preenchia (o Manifesto BB mandava NULL; o arquivo de B/L não mandava).
--      Granito, Vazios de exportação e Vazios de importação não guardavam nome
--      nem hash do arquivo.
--   2. O índice único `uq_import_batches_voyage_hash` (Viagem + modalidade +
--      hash) recusaria o reenvio do mesmo arquivo com 23505; a decisão 3 manda
--      só avisar.
--
-- Mudança:
--   1. `filename` e `file_hash` em `granite_manifests`, `vazios_manifests` e
--      `vazios_importacao_manifests` (quem e quando já existem:
--      `imported_by`/`imported_at`; em `import_batches`,
--      `uploaded_by`/`uploaded_at`). Hash: SHA-256 em 64 hexadecimais
--      minúsculos, conferido por CHECK nas quatro tabelas (NOT VALID em
--      `import_batches`, que pode ter hash antigo em outro formato; linha
--      nova é conferida).
--   2. O índice único vira índice comum: o mesmo arquivo pode ser gravado de
--      novo; a prévia avisa.
--   3. Gatilho `import_file_receipt_fill` (BEFORE INSERT nas quatro tabelas):
--      preenche nome e hash vazios com o que a RPC de importação declarou na
--      transação (`vela.import_file_name`, `vela.import_file_hash`).
--   4. As cinco RPCs de importação por arquivo que gravam lote ganham um
--      envelope com o mesmo nome (o corpo de antes fica com sufixo `_core_405`,
--      sem EXECUTE para a API): confere o formato do hash, declara nome e hash
--      na transação, chama o corpo e limpa a declaração.
--        - `import_bl_freight_file_atomic`: `p_batch.file_hash` (mesma
--          assinatura).
--        - `import_breakbulk_manifest_transactional`: `p_file_hash`.
--        - `import_granite_manifest_transactional`, `import_vazios_bookings_transactional`,
--          `import_vazios_importacao_transactional`: `p_filename`, `p_file_hash`.
--      Os parâmetros novos têm DEFAULT NULL: chamada antiga continua valendo
--      e grava o lote sem hash.
--   5. `import_file_previous_upload(tipo, Viagem, hash)`: a última gravação do
--      mesmo arquivo para a mesma Viagem e o mesmo tipo de importação, com
--      quando e quem, para o aviso da prévia.
--
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: renomear cada `_core_405` de volta ao nome original depois de
-- dropar o envelope; recriar `uq_import_batches_voyage_hash` como UNIQUE;
-- dropar o gatilho, a função de consulta e as colunas novas.

-- 1. Colunas e formato -------------------------------------------------------
ALTER TABLE public.granite_manifests
  ADD COLUMN IF NOT EXISTS filename text,
  ADD COLUMN IF NOT EXISTS file_hash text;
ALTER TABLE public.vazios_manifests
  ADD COLUMN IF NOT EXISTS filename text,
  ADD COLUMN IF NOT EXISTS file_hash text;
ALTER TABLE public.vazios_importacao_manifests
  ADD COLUMN IF NOT EXISTS filename text,
  ADD COLUMN IF NOT EXISTS file_hash text;

ALTER TABLE public.import_batches
  ADD CONSTRAINT import_batches_file_hash_sha256
  CHECK (file_hash IS NULL OR file_hash ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE public.granite_manifests
  ADD CONSTRAINT granite_manifests_file_hash_sha256
  CHECK (file_hash IS NULL OR file_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.vazios_manifests
  ADD CONSTRAINT vazios_manifests_file_hash_sha256
  CHECK (file_hash IS NULL OR file_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.vazios_importacao_manifests
  ADD CONSTRAINT vazios_importacao_manifests_file_hash_sha256
  CHECK (file_hash IS NULL OR file_hash ~ '^[0-9a-f]{64}$');

-- 2. Reenvio só avisa ----------------------------------------------------------
DROP INDEX IF EXISTS public.uq_import_batches_voyage_hash;
CREATE INDEX IF NOT EXISTS idx_import_batches_voyage_hash
  ON public.import_batches (voyage_id, cargo_mode, file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_granite_manifests_voyage_hash
  ON public.granite_manifests (voyage_id, file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vazios_manifests_voyage_hash
  ON public.vazios_manifests (voyage_id, file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vazios_importacao_manifests_voyage_hash
  ON public.vazios_importacao_manifests (voyage_id, file_hash) WHERE file_hash IS NOT NULL;

-- 3. Declaração da transação e gatilho ----------------------------------------
CREATE OR REPLACE FUNCTION public._declare_import_file(p_filename text, p_file_hash text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hash text := NULLIF(lower(btrim(COALESCE(p_file_hash, ''))), '');
BEGIN
  IF v_hash IS NOT NULL AND v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Assinatura do arquivo inválida: escolha o arquivo de novo.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('vela.import_file_hash', COALESCE(v_hash, ''), true);
  PERFORM set_config('vela.import_file_name', COALESCE(NULLIF(btrim(COALESCE(p_filename, '')), ''), ''), true);
END;
$$;
REVOKE ALL ON FUNCTION public._declare_import_file(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._declare_import_file(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.import_file_receipt_fill()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.file_hash IS NULL THEN
    NEW.file_hash := NULLIF(current_setting('vela.import_file_hash', true), '');
  END IF;
  IF NEW.filename IS NULL THEN
    NEW.filename := NULLIF(current_setting('vela.import_file_name', true), '');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.import_file_receipt_fill() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS import_file_receipt_fill ON public.import_batches;
CREATE TRIGGER import_file_receipt_fill BEFORE INSERT ON public.import_batches
  FOR EACH ROW EXECUTE FUNCTION public.import_file_receipt_fill();
DROP TRIGGER IF EXISTS import_file_receipt_fill ON public.granite_manifests;
CREATE TRIGGER import_file_receipt_fill BEFORE INSERT ON public.granite_manifests
  FOR EACH ROW EXECUTE FUNCTION public.import_file_receipt_fill();
DROP TRIGGER IF EXISTS import_file_receipt_fill ON public.vazios_manifests;
CREATE TRIGGER import_file_receipt_fill BEFORE INSERT ON public.vazios_manifests
  FOR EACH ROW EXECUTE FUNCTION public.import_file_receipt_fill();
DROP TRIGGER IF EXISTS import_file_receipt_fill ON public.vazios_importacao_manifests;
CREATE TRIGGER import_file_receipt_fill BEFORE INSERT ON public.vazios_importacao_manifests
  FOR EACH ROW EXECUTE FUNCTION public.import_file_receipt_fill();

-- 4. Envelopes das RPCs --------------------------------------------------------
ALTER FUNCTION public.import_bl_freight_file_atomic(jsonb, uuid, jsonb)
  RENAME TO import_bl_freight_file_atomic_core_405;
REVOKE ALL ON FUNCTION public.import_bl_freight_file_atomic_core_405(jsonb, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_file_atomic_core_405(jsonb, uuid, jsonb) TO service_role;

CREATE FUNCTION public.import_bl_freight_file_atomic(p_bls jsonb, p_changed_by uuid, p_batch jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public._declare_import_file(p_batch->>'filename', p_batch->>'file_hash');
  v_result := public.import_bl_freight_file_atomic_core_405(p_bls, p_changed_by, p_batch);
  PERFORM public._declare_import_file(NULL, NULL);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.import_bl_freight_file_atomic(jsonb, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bl_freight_file_atomic(jsonb, uuid, jsonb) TO authenticated, service_role;

ALTER FUNCTION public.import_breakbulk_manifest_transactional(text, bigint, uuid, integer, jsonb, jsonb, jsonb)
  RENAME TO import_breakbulk_manifest_transactional_core_405;
REVOKE ALL ON FUNCTION public.import_breakbulk_manifest_transactional_core_405(text, bigint, uuid, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_breakbulk_manifest_transactional_core_405(text, bigint, uuid, integer, jsonb, jsonb, jsonb) TO service_role;

CREATE FUNCTION public.import_breakbulk_manifest_transactional(
  p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_total_bls integer,
  p_bls jsonb, p_items jsonb, p_errors jsonb, p_file_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public._declare_import_file(p_filename, p_file_hash);
  v_result := public.import_breakbulk_manifest_transactional_core_405(
    p_filename, p_voyage_id, p_uploaded_by, p_total_bls, p_bls, p_items, p_errors);
  PERFORM public._declare_import_file(NULL, NULL);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.import_breakbulk_manifest_transactional(text, bigint, uuid, integer, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_breakbulk_manifest_transactional(text, bigint, uuid, integer, jsonb, jsonb, jsonb, text) TO authenticated, service_role;

ALTER FUNCTION public.import_granite_manifest_transactional(bigint, text, text, text, integer, numeric, uuid, jsonb, text[])
  RENAME TO import_granite_manifest_transactional_core_405;
REVOKE ALL ON FUNCTION public.import_granite_manifest_transactional_core_405(bigint, text, text, text, integer, numeric, uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_granite_manifest_transactional_core_405(bigint, text, text, text, integer, numeric, uuid, jsonb, text[]) TO service_role;

CREATE FUNCTION public.import_granite_manifest_transactional(
  p_voyage_id bigint, p_vessel_voyage text, p_loading_port text, p_discharge_port text,
  p_total_bls integer, p_total_weight_kg numeric, p_uploaded_by uuid, p_bls jsonb,
  p_remove_missing text[] DEFAULT NULL, p_filename text DEFAULT NULL, p_file_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public._declare_import_file(p_filename, p_file_hash);
  v_result := public.import_granite_manifest_transactional_core_405(
    p_voyage_id, p_vessel_voyage, p_loading_port, p_discharge_port,
    p_total_bls, p_total_weight_kg, p_uploaded_by, p_bls, p_remove_missing);
  -- A reimportação atualiza o manifesto existente em vez de inserir (206): o
  -- recibo desta gravação substitui o anterior, para o aviso de reenvio
  -- apontar a última importação.
  IF NULLIF(current_setting('vela.import_file_hash', true), '') IS NOT NULL THEN
    UPDATE public.granite_manifests
    SET filename = NULLIF(current_setting('vela.import_file_name', true), ''),
        file_hash = current_setting('vela.import_file_hash', true),
        imported_by = p_uploaded_by,
        imported_at = now()
    WHERE id = (v_result->>'manifest_id')::uuid;
  END IF;
  PERFORM public._declare_import_file(NULL, NULL);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.import_granite_manifest_transactional(bigint, text, text, text, integer, numeric, uuid, jsonb, text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_granite_manifest_transactional(bigint, text, text, text, integer, numeric, uuid, jsonb, text[], text, text) TO authenticated, service_role;

ALTER FUNCTION public.import_vazios_bookings_transactional(bigint, text, uuid, jsonb)
  RENAME TO import_vazios_bookings_transactional_core_405;
REVOKE ALL ON FUNCTION public.import_vazios_bookings_transactional_core_405(bigint, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_vazios_bookings_transactional_core_405(bigint, text, uuid, jsonb) TO service_role;

CREATE FUNCTION public.import_vazios_bookings_transactional(
  p_voyage_id bigint, p_port text, p_uploaded_by uuid, p_bookings jsonb,
  p_filename text DEFAULT NULL, p_file_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public._declare_import_file(p_filename, p_file_hash);
  v_result := public.import_vazios_bookings_transactional_core_405(p_voyage_id, p_port, p_uploaded_by, p_bookings);
  PERFORM public._declare_import_file(NULL, NULL);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.import_vazios_bookings_transactional(bigint, text, uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vazios_bookings_transactional(bigint, text, uuid, jsonb, text, text) TO authenticated, service_role;

ALTER FUNCTION public.import_vazios_importacao_transactional(bigint, text, uuid, jsonb, jsonb)
  RENAME TO import_vazios_importacao_transactional_core_405;
REVOKE ALL ON FUNCTION public.import_vazios_importacao_transactional_core_405(bigint, text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_vazios_importacao_transactional_core_405(bigint, text, uuid, jsonb, jsonb) TO service_role;

CREATE FUNCTION public.import_vazios_importacao_transactional(
  p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_containers jsonb,
  p_manifestos jsonb DEFAULT NULL, p_filename text DEFAULT NULL, p_file_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public._declare_import_file(p_filename, p_file_hash);
  v_result := public.import_vazios_importacao_transactional_core_405(
    p_voyage_id, p_description, p_uploaded_by, p_containers, p_manifestos);
  PERFORM public._declare_import_file(NULL, NULL);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.import_vazios_importacao_transactional(bigint, text, uuid, jsonb, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_vazios_importacao_transactional(bigint, text, uuid, jsonb, jsonb, text, text) TO authenticated, service_role;

-- 5. Consulta do aviso de reenvio ---------------------------------------------
CREATE OR REPLACE FUNCTION public.import_file_previous_upload(p_kind text, p_voyage_id bigint, p_file_hash text)
RETURNS TABLE (uploaded_at timestamptz, uploaded_by_name text, filename text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hash text := lower(btrim(COALESCE(p_file_hash, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Assinatura do arquivo inválida: escolha o arquivo de novo.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH previous AS (
    SELECT b.uploaded_at AS at, b.uploaded_by AS who, b.filename AS name
    FROM public.import_batches b
    WHERE p_kind IN ('arquivo_bl', 'manifesto_bb')
      AND b.voyage_id = p_voyage_id AND b.file_hash = v_hash
      AND b.cargo_mode = CASE p_kind WHEN 'manifesto_bb' THEN 'carga_solta' ELSE 'container' END
    UNION ALL
    SELECT g.imported_at, g.imported_by, g.filename
    FROM public.granite_manifests g
    WHERE p_kind = 'granito' AND g.voyage_id = p_voyage_id AND g.file_hash = v_hash
    UNION ALL
    SELECT m.imported_at, m.imported_by, m.filename
    FROM public.vazios_manifests m
    WHERE p_kind = 'vazios_exportacao' AND m.voyage_id = p_voyage_id AND m.file_hash = v_hash
    UNION ALL
    SELECT m.imported_at, m.imported_by, m.filename
    FROM public.vazios_importacao_manifests m
    WHERE p_kind = 'vazios_importacao' AND m.voyage_id = p_voyage_id AND m.file_hash = v_hash
  )
  SELECT p.at, COALESCE(NULLIF(btrim(u.full_name), ''), 'usuário sem nome'), p.name
  FROM previous p
  LEFT JOIN public.user_profiles u ON u.id = p.who
  ORDER BY p.at DESC NULLS LAST
  LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.import_file_previous_upload(text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_file_previous_upload(text, bigint, text) TO authenticated, service_role;
