-- 601: dados do manifesto (EDI Mercante) corrigidos na ficha do B/L, sem a
-- reimportação apagar a correção (decisão do dono de 2026-11-06, issue
-- luccafwlog/vela#1238, item 1; ADR 0129).
--
-- Problema:
--   O EDI Mercante (ADR 0116) leva ao C5 os blocos completos de consignatário,
--   embarcador e notify, o CNPJ/CPF do consignatário e o total de volumes.
--   A ficha do B/L não editava esses campos: a única saída era reimportar o
--   arquivo, o que não resolve quando o próprio arquivo vem errado.
--
-- Mudança:
--   1. `bl_manifest_corrections`: uma linha por campo corrigido na ficha
--      (B/L, campo, valor, quem e quando). Leitura do usuário interno ativo;
--      escrita só pelas funções abaixo.
--   2. `save_bl_review` (corpo da 574) aceita `consignee_block`,
--      `shipper_block`, `notify_block`, `manifest_customer_cnpj_cpf`,
--      `total_packages` e `packages_unit`. Exige a justificativa; o CNPJ/CPF
--      precisa ter 14 dígitos válidos ou 11, e, com Cliente no B/L, ser o CNPJ
--      do Cliente (outro consignatário passa pela troca do Cliente). Grava sob
--      o mesmo lock com `vela.bl_manifest_correction = on` e registra cada
--      campo em `bl_manifest_corrections`. O antes e o depois vão ao
--      Histórico do B/L pelo gatilho `audit_bls`, com a justificativa.
--   3. Gatilho `zz_keep_bl_manifest_corrections` (BEFORE UPDATE em `bls`):
--      fora da ficha (reimportação de B/L, Manifesto BB, qualquer gravação
--      automática), o campo corrigido mantém o valor e o Histórico do B/L
--      ganha a linha "Correção da ficha mantida", com o valor que chegou.
--      Exceção: o B/L que perde o Cliente ou passa a outro Cliente cujo CNPJ
--      não é o corrigido (Troca de Consignatário aceita, também para quem
--      ainda não é Cliente; vínculo pela Revisão) perde as
--      correções do consignatário (bloco e CNPJ), também com linha no
--      Histórico, para o B/L não ficar com um Cliente e o manifesto com outro.
--      ponytail: a regra compara só o CNPJ do Cliente novo com o corrigido;
--      Cliente sem CNPJ cadastrado conta como diferente.
--
-- Só cria objetos e redefine `save_bl_review`; não grava nem reescreve linhas
-- existentes.
-- Rollback: DROP TRIGGER zz_keep_bl_manifest_corrections ON public.bls;
-- DROP FUNCTION public.keep_bl_manifest_corrections(); reaplicar
-- save_bl_review da 574; DROP TABLE public.bl_manifest_corrections.

CREATE TABLE public.bl_manifest_corrections (
  bl_id text NOT NULL REFERENCES public.bls(id) ON DELETE CASCADE,
  field_name text NOT NULL CHECK (field_name IN ('consignee_block', 'shipper_block', 'notify_block',
                                                 'manifest_customer_cnpj_cpf', 'total_packages', 'packages_unit')),
  value text,
  corrected_by uuid REFERENCES auth.users(id),
  corrected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bl_id, field_name)
);
CREATE INDEX bl_manifest_corrections_corrected_by ON public.bl_manifest_corrections (corrected_by);
COMMENT ON TABLE public.bl_manifest_corrections IS
  'Campos do manifesto (EDI Mercante) corrigidos na ficha do B/L; a reimportação não os sobrescreve (migration 601, ADR 0129). Escrita só por save_bl_review e pelo gatilho zz_keep_bl_manifest_corrections.';

ALTER TABLE public.bl_manifest_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bl_manifest_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bl_manifest_corrections TO authenticated;
GRANT ALL ON public.bl_manifest_corrections TO service_role;
CREATE POLICY bl_manifest_corrections_select_active ON public.bl_manifest_corrections
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_read_user()));

CREATE FUNCTION public.keep_bl_manifest_corrections()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb;
  v_correction record;
  v_doc text;
  v_customer_doc text;
  v_context text := NULLIF(btrim(current_setting('vela.import_context', true)), '');
  v_origin text;
BEGIN
  IF current_setting('vela.bl_manifest_correction', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bl_manifest_corrections WHERE bl_id = OLD.id) THEN
    RETURN NEW;
  END IF;
  v_origin := COALESCE(v_context, 'gravação automática');

  -- O B/L que perde o Cliente (Troca de Consignatário aceita para quem ainda
  -- não é Cliente) ou passa a outro Cliente com outro CNPJ: as correções do
  -- consignatário deixam de valer. Achado da revisão da PR #1240.
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     AND (NEW.customer_id IS NOT NULL OR OLD.customer_id IS NOT NULL) THEN
    SELECT COALESCE(
      (SELECT mc.value FROM public.bl_manifest_corrections AS mc
       WHERE mc.bl_id = OLD.id AND mc.field_name = 'manifest_customer_cnpj_cpf'),
      OLD.manifest_customer_cnpj_cpf)
      INTO v_doc;
    -- Sem Cliente novo, v_customer_doc fica nulo e as correções saem.
    SELECT public.normalize_document_text(c.cnpj_cpf) INTO v_customer_doc
    FROM public.customers AS c WHERE c.id = NEW.customer_id;
    IF v_customer_doc IS NULL OR v_customer_doc IS DISTINCT FROM public.normalize_document_text(v_doc) THEN
      WITH dropped AS (
        DELETE FROM public.bl_manifest_corrections
        WHERE bl_id = OLD.id AND field_name IN ('consignee_block', 'manifest_customer_cnpj_cpf')
        RETURNING field_name, value
      )
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      SELECT 'bl', OLD.id, d.field_name, d.value, NULL, auth.uid(),
             CASE WHEN NEW.customer_id IS NULL
                  THEN 'Correção da ficha substituída: o B/L ficou sem Cliente (' || v_origin || ').'
                  ELSE 'Correção da ficha substituída: o B/L passou a outro Cliente (' || v_origin || ').' END
      FROM dropped AS d;
    END IF;
  END IF;

  v_new := to_jsonb(NEW);
  FOR v_correction IN
    SELECT mc.field_name FROM public.bl_manifest_corrections AS mc WHERE mc.bl_id = OLD.id
  LOOP
    IF v_new ->> v_correction.field_name IS DISTINCT FROM v_old ->> v_correction.field_name THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(v_correction.field_name, v_old -> v_correction.field_name));
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bl', OLD.id, v_correction.field_name, NULL, v_old ->> v_correction.field_name, auth.uid(),
              'Correção da ficha mantida: ' || v_origin || ' trazia "'
              || COALESCE(left(v_new ->> v_correction.field_name, 160), '(vazio)') || '".');
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.keep_bl_manifest_corrections() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER zz_keep_bl_manifest_corrections
  BEFORE UPDATE OF consignee_block, shipper_block, notify_block, manifest_customer_cnpj_cpf,
                   total_packages, packages_unit, customer_id
  ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.keep_bl_manifest_corrections();

CREATE OR REPLACE FUNCTION public.save_bl_review(p_bl_id text, p_expected_updated_at timestamp with time zone, p_update_payload jsonb, p_audit_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_updated_at timestamptz;
  v_result jsonb;
  v_reason text;
  v_previous_context text := current_setting('vela.import_context', true);
  v_financial_status text;
  v_hold_reason text;
  -- 601: dados do manifesto (EDI Mercante) corrigidos na ficha.
  v_manifest_keys text[] := ARRAY['consignee_block', 'shipper_block', 'notify_block',
                                  'manifest_customer_cnpj_cpf', 'total_packages', 'packages_unit'];
  v_manifest jsonb;
  v_doc text;
  v_customer_id bigint;
  v_customer_doc text;
  v_customer_name text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para revisar B/L.'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'updated_at obrigatorio; recarregue o B/L antes de salvar'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT updated_at, financial_status, billing_hold_reason
    INTO v_current_updated_at, v_financial_status, v_hold_reason
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuário; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  -- 574 (a): B/L faturado ou pago que voltou à Revisão porque a carga mudou
  -- depois da fatura só sai dela com a fatura corrigida (decisão do dono de
  -- 2026-11-03). Salvar sem mudar nenhum dado era só "tirar da fila": é
  -- recusado. Salvar com dado mudado é correção do B/L (ADR 0077, item 2) e
  -- passa, mas a legada mantém o B/L Pendente enquanto a retenção existir.
  -- ponytail: reconhece a retenção pelo texto, como _clear_post_billing_hold.
  IF v_financial_status IN ('invoiced', 'paid')
     AND v_hold_reason LIKE 'Carga % após faturamento;%'
     AND COALESCE(p_update_payload, '{}'::jsonb) - 'ce_mercante' = '{}'::jsonb THEN
    RAISE EXCEPTION 'B/L % faturado com a carga alterada depois da fatura: a revisão só termina com a fatura corrigida, e então o B/L sai da Revisão sozinho. Se a correção automática não saiu, abra a fatura pelo alerta Fatura desatualizada e use Tentar aplicar correção ou, com a diferença cobrada por fatura avulsa, Resolver com justificativa.', p_bl_id
      USING ERRCODE = 'P0003';
  END IF;

  -- 502: das linhas do navegador vale só a justificativa; o antes e o depois
  -- vêm dos gatilhos, que leem o motivo de `vela.import_context`.
  IF jsonb_typeof(p_audit_rows) = 'array' THEN
    SELECT NULLIF(btrim(a->>'justification'), '')
      INTO v_reason
    FROM jsonb_array_elements(p_audit_rows) AS a
    WHERE NULLIF(btrim(a->>'justification'), '') IS NOT NULL
    LIMIT 1;
  END IF;
  IF v_reason IS NOT NULL THEN
    PERFORM set_config('vela.import_context', v_reason, true);
  END IF;

  -- 601: blocos de consignatário, embarcador e notify, CNPJ/CPF do
  -- consignatário e total de volumes, que vão ao EDI Mercante, corrigidos na
  -- ficha (decisão do dono de 2026-11-06, issue #1238). Gravados aqui, sob o
  -- mesmo lock, com a marca `vela.bl_manifest_correction` que o gatilho
  -- `zz_keep_bl_manifest_corrections` reconhece; cada campo vira uma linha de
  -- `bl_manifest_corrections`, que a reimportação não sobrescreve.
  SELECT COALESCE(jsonb_object_agg(k, p_update_payload -> k), '{}'::jsonb)
    INTO v_manifest
  FROM unnest(v_manifest_keys) AS k
  WHERE COALESCE(p_update_payload, '{}'::jsonb) ? k;

  IF v_manifest <> '{}'::jsonb THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Informe a justificativa da correção dos dados do manifesto.' USING ERRCODE = '22023';
    END IF;
    IF v_manifest ? 'manifest_customer_cnpj_cpf' THEN
      v_doc := public.normalize_document_text(v_manifest ->> 'manifest_customer_cnpj_cpf');
      IF v_doc IS NULL OR NOT (v_doc ~ '^[0-9]{11}$' OR public.is_valid_cnpj(v_doc)) THEN
        RAISE EXCEPTION 'CNPJ/CPF do consignatário inválido: informe o CNPJ com 14 dígitos válidos ou o CPF com 11.' USING ERRCODE = '22023';
      END IF;
      -- O CNPJ do manifesto é o do Cliente do B/L: corrigir para outro CNPJ
      -- deixaria o B/L com um Cliente e o manifesto com outro consignatário.
      SELECT b.customer_id, public.normalize_document_text(c.cnpj_cpf), c.name
        INTO v_customer_id, v_customer_doc, v_customer_name
      FROM public.bls AS b
      LEFT JOIN public.customers AS c ON c.id = b.customer_id
      WHERE b.id = p_bl_id;
      IF v_customer_id IS NOT NULL AND v_customer_doc IS DISTINCT FROM v_doc THEN
        RAISE EXCEPTION 'O CNPJ/CPF % não é o do Cliente do B/L (%). Para outro consignatário, troque o Cliente do B/L antes.', v_doc, v_customer_name
          USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_manifest ? 'total_packages'
       AND NULLIF(btrim(v_manifest ->> 'total_packages'), '') IS NOT NULL
       AND btrim(v_manifest ->> 'total_packages') !~ '^[0-9]{1,9}$' THEN
      RAISE EXCEPTION 'Total de volumes inválido: informe um número inteiro.' USING ERRCODE = '22023';
    END IF;

    PERFORM set_config('vela.bl_manifest_correction', 'on', true);
    UPDATE public.bls AS b
    SET
      consignee_block = CASE WHEN v_manifest ? 'consignee_block' THEN NULLIF(btrim(v_manifest ->> 'consignee_block'), '') ELSE b.consignee_block END,
      shipper_block = CASE WHEN v_manifest ? 'shipper_block' THEN NULLIF(btrim(v_manifest ->> 'shipper_block'), '') ELSE b.shipper_block END,
      notify_block = CASE WHEN v_manifest ? 'notify_block' THEN NULLIF(btrim(v_manifest ->> 'notify_block'), '') ELSE b.notify_block END,
      manifest_customer_cnpj_cpf = CASE WHEN v_manifest ? 'manifest_customer_cnpj_cpf' THEN v_doc ELSE b.manifest_customer_cnpj_cpf END,
      total_packages = CASE WHEN v_manifest ? 'total_packages' THEN NULLIF(btrim(v_manifest ->> 'total_packages'), '')::integer ELSE b.total_packages END,
      packages_unit = CASE WHEN v_manifest ? 'packages_unit' THEN NULLIF(upper(btrim(v_manifest ->> 'packages_unit')), '') ELSE b.packages_unit END
    WHERE b.id = p_bl_id
    RETURNING b.updated_at INTO v_current_updated_at;
    PERFORM set_config('vela.bl_manifest_correction', 'off', true);

    INSERT INTO public.bl_manifest_corrections AS mc (bl_id, field_name, value, corrected_by, corrected_at)
    SELECT p_bl_id, k, to_jsonb(b) ->> k, auth.uid(), now()
    FROM public.bls AS b
    CROSS JOIN jsonb_object_keys(v_manifest) AS k
    WHERE b.id = p_bl_id
    ON CONFLICT (bl_id, field_name) DO UPDATE
      SET value = EXCLUDED.value, corrected_by = EXCLUDED.corrected_by, corrected_at = EXCLUDED.corrected_at;
  END IF;

  -- A cubagem breakbulk faltava na funcao legada. Persistimos primeiro sob o
  -- mesmo lock e repassamos a nova versao.
  IF p_update_payload ? 'bb_cbm' THEN
    UPDATE public.bls
    SET bb_cbm = NULLIF(p_update_payload->>'bb_cbm', '')::numeric
    WHERE id = p_bl_id
    RETURNING updated_at INTO v_current_updated_at;
  END IF;

  SELECT public.save_bl_review_legacy_070(
    p_bl_id,
    v_current_updated_at,
    -- O CE Mercante não muda pela edição da ficha: só por Corrigir/Remover
    -- CE Mercante (migration 177; ADR 0078, itens 1, 2 e 5).
    p_update_payload - 'bb_cbm' - 'ce_mercante' - v_manifest_keys,
    -- A legada grava as linhas recebidas, menos as de `review_status`, e usa
    -- a justificativa da primeira na linha da situação da Revisão. Uma linha
    -- de `review_status` leva o motivo sem gravar nada vindo do navegador.
    CASE WHEN v_reason IS NULL THEN '[]'::jsonb
         ELSE jsonb_build_array(jsonb_build_object('field_name', 'review_status', 'justification', v_reason))
    END,
    p_changed_by
  ) INTO v_result;

  IF v_reason IS NOT NULL THEN
    PERFORM set_config('vela.import_context', COALESCE(v_previous_context, ''), true);
  END IF;
  RETURN v_result;
END;
$function$;
