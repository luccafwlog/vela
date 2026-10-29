-- 502: a ficha do B/L grava a justificativa no Histórico e corrigir o POD tira
-- a exceção de terminal (conferência do Manual do Operador, capítulo 7;
-- decisão do dono de 2026-10-29: a justificativa vai ao Histórico, e Trocar
-- Cliente e Desvincular passam a pedir motivo).
--
-- Problemas:
--   1. A ficha do B/L (Editar), a Revisão, a correção na fila e Trocar/
--      Desvincular Cliente mandam a justificativa em `p_audit_rows`, mas
--      `save_bl_review` (177) repassa `'[]'` para `save_bl_review_legacy_070`:
--      as linhas do navegador são descartadas de propósito (o gatilho
--      `audit_bls` grava os valores reais). Com isso, o gatilho gravava cada
--      campo com a justificativa nula, e a situação da Revisão com o texto
--      fixo "Revisao manual". A tela pedia o motivo e ele se perdia.
--   2. Só `set_bl_cod`, a reimportação e o Manifesto de carga solta limpavam
--      `bls.terminal_id`/`pod_port_id` quando o POD mudava. Corrigir o POD pela
--      ficha deixava o B/L com o terminal de outro porto, e o terminal decide
--      em que ADR de Saída e em que Aviso de Atracação o B/L conta.
--
-- Mudança:
--   1. `save_bl_review` continua descartando o antes e o depois do navegador,
--      mas lê a primeira justificativa não vazia de `p_audit_rows` e a põe em
--      `vela.import_context` durante a gravação, como o ROE manual (435): é de
--      onde `audit_row_changes` tira a justificativa de cada campo. A mesma
--      justificativa vai à linha da situação da Revisão (a legada lê a
--      justificativa da primeira linha e não grava linha de `review_status`
--      vinda do navegador). O contexto anterior volta ao fim. Sem
--      justificativa, nada muda (justificativa nula, "Revisao manual").
--   2. Gatilho `trg_pod_change_clears_terminal_override` (BEFORE UPDATE OF pod
--      em `bls`): quando o POD passa a outro porto e a mesma instrução não
--      mexeu na exceção, limpa `terminal_id` e `pod_port_id`. Grava uma linha
--      semântica do terminal no Histórico ("Exceção de terminal removida: o POD
--      do B/L mudou de X para Y.") e pula as linhas do gatilho dos dois campos,
--      como `unlink_manifesto_on_route_change` faz com o Manifesto. O mesmo
--      porto escrito de outro jeito (caixa, espaço) mantém a exceção. COD,
--      reimportação e Manifesto de carga solta já limpam na própria instrução
--      e não são afetados. O nome ordena depois de
--      `trg_guard_cod_pod_on_reimport`, que pode desfazer a troca de POD, e a
--      guarda `trg_guard_bl_terminal_override` não dispara: ela só olha
--      instruções que listam `terminal_id`/`pod_port_id` no SET.
--
-- Só redefine função e cria gatilho; não reescreve nem apaga linhas
-- existentes (B/Ls que já ficaram com terminal de outro porto continuam como
-- estão; a Documentação remove a exceção pela ficha).
-- Rollback: reaplicar `save_bl_review` da 177 e
-- `DROP TRIGGER trg_pod_change_clears_terminal_override ON public.bls;
--  DROP FUNCTION public.clear_bl_terminal_override_on_pod_change();`.

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
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para revisar B/L.'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'updated_at obrigatorio; recarregue o B/L antes de salvar'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT updated_at INTO v_current_updated_at
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuario; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
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
    p_update_payload - 'bb_cbm' - 'ce_mercante',
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

CREATE OR REPLACE FUNCTION public.clear_bl_terminal_override_on_pod_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (OLD.terminal_id IS NULL AND OLD.pod_port_id IS NULL)
     OR NEW.terminal_id IS DISTINCT FROM OLD.terminal_id
     OR NEW.pod_port_id IS DISTINCT FROM OLD.pod_port_id
     OR public.normalize_port_code(NEW.pod) IS NOT DISTINCT FROM public.normalize_port_code(OLD.pod)
     OR EXISTS (
       SELECT 1 FROM public.ports AS p
       WHERE p.id = OLD.pod_port_id
         AND public.normalize_port_code(p.locode) = public.normalize_port_code(NEW.pod)
     ) THEN
    RETURN NEW;
  END IF;

  NEW.terminal_id := NULL;
  NEW.pod_port_id := NULL;
  IF OLD.terminal_id IS NOT NULL THEN
    PERFORM public._audit_skip_once('bls', OLD.id, 'terminal_id');
  END IF;
  IF OLD.pod_port_id IS NOT NULL THEN
    PERFORM public._audit_skip_once('bls', OLD.id, 'pod_port_id');
  END IF;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', OLD.id, 'terminal_id', OLD.terminal_id::text, NULL, auth.uid(),
    format('Exceção de terminal removida: o POD do B/L mudou de %s para %s.',
      COALESCE(public.normalize_port_code(OLD.pod), NULLIF(upper(btrim(OLD.pod)), ''), '?'),
      COALESCE(public.normalize_port_code(NEW.pod), NULLIF(upper(btrim(NEW.pod)), ''), '?')));
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_bl_terminal_override_on_pod_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pod_change_clears_terminal_override ON public.bls;
CREATE TRIGGER trg_pod_change_clears_terminal_override
  BEFORE UPDATE OF pod ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.clear_bl_terminal_override_on_pod_change();
