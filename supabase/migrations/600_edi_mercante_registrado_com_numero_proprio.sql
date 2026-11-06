-- 600: EDI Mercante registrado no Histórico da Viagem, com número próprio
-- (decisão do dono de 2026-11-06, issue luccafwlog/vela#1238, item 4; ADR 0129).
--
-- Problema:
--   Gerar EDI Mercante (ADR 0116) só baixava o arquivo: nada ficava gravado e
--   o nome levava o instante da geração (FWL_MERCANTE_<AAAAMMDDHHMM>_<sigla>).
--   Não havia como saber quem gerou qual arquivo, nem quando.
--
-- Mudança:
--   1. Tabela `mercante_edi_files`: um registro por arquivo baixado, com o
--      número sequencial do Vela (`number`, identidade a partir de 1, sem
--      continuar a série do sistema externo), a Viagem, a rota, a natureza
--      (container, carga_solta ou vazio), o nome do arquivo, quantos B/Ls e
--      itens ele leva, quem gerou e quando. Leitura para o usuário interno
--      ativo, como o Histórico; escrita só pela RPC abaixo.
--   2. RPC `register_mercante_edi_file`: chamada por **Baixar arquivo** antes
--      do download. Confere a conta Dev (a funcionalidade é só dela, decisão
--      do dono de 2026-11-03; `is_dev_user`, ADR 0104), a Viagem existente e
--      não cancelada, a natureza e a sigla; grava a linha e devolve o número e
--      o nome `FWL_MERCANTE_<número com 6 dígitos>_<sigla>.TXT`. Sem a
--      gravação, o arquivo não é baixado.
--   O Histórico da Viagem lê a tabela (`fetchVoyageTimelineSources`).
--   3. Excluir viagem leva junto os registros do EDI Mercante
--      (`voyage_delete_children_spec`, corpo da 597, item 20): sem isso, o
--      guarda `guard_voyage_hard_delete` (573) achava a linha em
--      `mercante_edi_files` e recusava a exclusão que a prévia permitia.
--
-- Só cria objetos novos; não grava nem reescreve linhas existentes.
-- Rollback: voltar `voyage_delete_children_spec` ao corpo da 597;
-- DROP FUNCTION public.register_mercante_edi_file(bigint, text, text, text,
-- text, integer, integer); DROP TABLE public.mercante_edi_files.

CREATE TABLE public.mercante_edi_files (
  number bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voyage_id bigint NOT NULL REFERENCES public.voyages(id),
  pol text NOT NULL,
  pod text NOT NULL,
  cargo_mode text NOT NULL CHECK (cargo_mode IN ('container', 'carga_solta', 'vazio')),
  file_name text NOT NULL UNIQUE,
  bl_count integer NOT NULL CHECK (bl_count >= 0),
  item_count integer NOT NULL CHECK (item_count >= 0),
  generated_by uuid NOT NULL REFERENCES auth.users(id),
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mercante_edi_files_voyage ON public.mercante_edi_files (voyage_id, generated_at DESC);
CREATE INDEX mercante_edi_files_generated_by ON public.mercante_edi_files (generated_by);
COMMENT ON TABLE public.mercante_edi_files IS
  'EDI Mercante baixado em Rotas e Manifestos: número sequencial do Vela, rota, natureza, quem e quando (migration 600, ADR 0129). Escrita só por register_mercante_edi_file.';

ALTER TABLE public.mercante_edi_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mercante_edi_files FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mercante_edi_files TO authenticated;
GRANT ALL ON public.mercante_edi_files TO service_role;
CREATE POLICY mercante_edi_files_select_active ON public.mercante_edi_files
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_read_user()));

CREATE FUNCTION public.register_mercante_edi_file(
  p_voyage_id bigint,
  p_pol text,
  p_pod text,
  p_cargo_mode text,
  p_tag text,
  p_bl_count integer,
  p_item_count integer
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_pol text := upper(btrim(COALESCE(p_pol, '')));
  v_pod text := upper(btrim(COALESCE(p_pod, '')));
  v_tag text := upper(btrim(COALESCE(p_tag, '')));
  v_number bigint;
  v_file_name text;
  v_generated_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_dev_user() THEN
    RAISE EXCEPTION 'Gerar EDI Mercante é só da conta Dev.' USING ERRCODE = '42501';
  END IF;
  IF p_cargo_mode IS NULL OR p_cargo_mode NOT IN ('container', 'carga_solta', 'vazio') THEN
    RAISE EXCEPTION 'Natureza do EDI Mercante inválida: use contêiner, carga solta ou vazio.' USING ERRCODE = '22023';
  END IF;
  IF v_pol !~ '^[A-Z]{5}$' OR v_pod !~ '^[A-Z]{5}$' THEN
    RAISE EXCEPTION 'Rota do EDI Mercante inválida: POL e POD com 5 letras.' USING ERRCODE = '22023';
  END IF;
  IF v_tag !~ '^[A-Z0-9]{1,20}$' THEN
    RAISE EXCEPTION 'Sigla do navio e da viagem inválida para o nome do arquivo.' USING ERRCODE = '22023';
  END IF;
  IF p_bl_count IS NULL OR p_bl_count < 0 OR p_item_count IS NULL OR p_item_count < 0 THEN
    RAISE EXCEPTION 'Quantidades do EDI Mercante inválidas.' USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_status FROM public.voyages WHERE id = p_voyage_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % não encontrada.', p_voyage_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Viagem cancelada não gera EDI Mercante.' USING ERRCODE = '22023';
  END IF;

  -- O número vem da identidade; o nome depende dele, então a linha nasce com
  -- um nome provisório único e recebe o definitivo na mesma transação.
  INSERT INTO public.mercante_edi_files (voyage_id, pol, pod, cargo_mode, file_name, bl_count, item_count, generated_by)
  VALUES (p_voyage_id, v_pol, v_pod, p_cargo_mode, gen_random_uuid()::text, p_bl_count, p_item_count, auth.uid())
  RETURNING number, generated_at INTO v_number, v_generated_at;

  v_file_name := format('FWL_MERCANTE_%s_%s.TXT', lpad(v_number::text, 6, '0'), v_tag);
  UPDATE public.mercante_edi_files SET file_name = v_file_name WHERE number = v_number;

  RETURN jsonb_build_object('number', v_number, 'file_name', v_file_name, 'generated_at', v_generated_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.register_mercante_edi_file(bigint, text, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_mercante_edi_file(bigint, text, text, text, text, integer, integer) TO authenticated;

-- 3 -------------------------------------------------------------------------
-- Corpo da 597 com os registros do EDI Mercante entre os filhos da viagem excluída.
CREATE OR REPLACE FUNCTION public.voyage_delete_children_spec()
RETURNS TABLE(ord integer, table_name text, column_name text, action text, label text)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  VALUES
    (1, 'vehicles', 'voyage_id', 'delete', 'veículo(s)'),
    (2, 'bls', 'voyage_id', 'delete', 'B/L(s), com containers e taxas'),
    (3, 'import_batches', 'voyage_id', 'delete', 'importação(ões) de manifesto'),
    (4, 'manifestos_mercante', 'voyage_id', 'delete', 'Manifesto(s) Mercante'),
    (5, 'voyage_route_ce_master', 'voyage_id', 'delete', 'CE Master por rota'),
    (6, 'baplie_reconciliation_resolutions', 'voyage_id', 'delete', 'resolução(ões) de BAPLIE'),
    (7, 'baplie_containers', 'voyage_id', 'delete', 'container(es) do BAPLIE'),
    (8, 'agency_departure_reports', 'voyage_id', 'delete', 'ADR(s) de Saída em aberto'),
    (9, 'vazios_bookings', 'voyage_id', 'delete', 'unidade(s) de vazios'),
    (10, 'vazios_export_operations', 'voyage_id', 'delete', 'operação(ões) de embarque de vazios'),
    (11, 'voyage_omissions', 'voyage_id', 'delete', 'omissão(ões) de escala e transbordo'),
    (12, 'voyage_escala_terminal_state', 'voyage_id', 'delete', 'atracação(ões)'),
    (13, 'voyage_escala_operation_fronts', 'voyage_id', 'delete', 'frente(s) de operação'),
    (14, 'voyage_escala_revision_state', 'voyage_id', 'delete', 'revisão(ões) de escala'),
    (15, 'voyage_export_schedules', 'voyage_id', 'delete', 'escala(s) de exportação'),
    (16, 'granite_manifests', 'voyage_id', 'detach', 'manifesto(s) de Granito ficam sem viagem'),
    (17, 'vazios_manifests', 'voyage_id', 'delete', 'manifesto(s) de vazios'),
    (18, 'vazios_importacao_manifests', 'voyage_id', 'delete', 'manifesto(s) de vazios de importação'),
    (19, 'voyage_vehicle_declarations', 'voyage_id', 'delete', 'resposta de Equipamentos sobre veículos'),
    (20, 'mercante_edi_files', 'voyage_id', 'delete', 'registro(s) de EDI Mercante gerado');
$function$;
REVOKE ALL ON FUNCTION public.voyage_delete_children_spec() FROM PUBLIC, anon, authenticated;
