-- 207 — Manifesto Mercante desvinculado também pela troca de POL, e correção
-- do CE pela ficha conferida contra o CE que estava na tela (achados da
-- revisão automática da PR 929 sobre a 181 e a 177).
--
-- 1. O Manifesto Mercante é de uma rota (Viagem, POL e POD). O gatilho da 181
--    só olhava POD e Viagem: o POL corrigido pela ficha ou pela reimportação
--    de carga solta deixava o B/L num Manifesto de outra rota. Agora o POL
--    também desvincula, com o mesmo registro no Histórico.
-- 2. `correct_bl_ce_mercante` recebia só o CE novo e o motivo. Com a ficha
--    aberta, outra sessão podia trocar ou remover o CE, e a correção gravava
--    por cima sem mostrar o valor novo; a leitura do CE atual nem travava a
--    linha. Agora o B/L é travado antes da conferência e, com
--    `p_expected_ce` (o CE exibido), CE diferente recusa pedindo para
--    recarregar a ficha. Sem `p_expected_ce` o comportamento é o anterior
--    (chamadas de serviço e scripts).
--
-- Só redefine funções e o gatilho; não reescreve nem apaga linhas. Rollback:
-- reaplicar as definições da 181 (gatilho) e da 177 (função de três
-- argumentos), removendo a de quatro.

CREATE OR REPLACE FUNCTION public.unlink_manifesto_on_route_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.manifesto_mercante_id IS NOT NULL
     AND NEW.manifesto_mercante_id IS NOT DISTINCT FROM OLD.manifesto_mercante_id
     AND (NEW.voyage_id IS DISTINCT FROM OLD.voyage_id
          OR public.normalize_port_code(NEW.pol) IS DISTINCT FROM public.normalize_port_code(OLD.pol)
          OR public.normalize_port_code(NEW.pod) IS DISTINCT FROM public.normalize_port_code(OLD.pod)) THEN
    NEW.manifesto_mercante_id := NULL;
    PERFORM public._audit_skip_once('bls', OLD.id, 'manifesto_mercante_id');
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', OLD.id, 'manifesto_mercante',
      (SELECT numero FROM public.manifestos_mercante WHERE id = OLD.manifesto_mercante_id), NULL, auth.uid(),
      'Desvínculo automático: o POL, o POD ou a Viagem do B/L mudou.');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_unlink_manifesto_on_route_change ON public.bls;
CREATE TRIGGER trg_unlink_manifesto_on_route_change
  BEFORE UPDATE OF pol, pod, voyage_id ON public.bls
  FOR EACH ROW EXECUTE FUNCTION public.unlink_manifesto_on_route_change();

DROP FUNCTION IF EXISTS public.correct_bl_ce_mercante(text, text, text);

CREATE FUNCTION public.correct_bl_ce_mercante(p_bl_id text, p_ce text, p_reason text, p_expected_ce text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old text;
  v_result text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da correcao do CE Mercante.' USING ERRCODE = '22023';
  END IF;
  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % nao encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_ce IS NOT NULL
     AND public.ce_mercante_key(v_old) IS DISTINCT FROM public.ce_mercante_key(p_expected_ce) THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % mudou depois que a ficha foi aberta (agora: %). Recarregue a ficha e confira antes de corrigir.',
      p_bl_id, COALESCE(NULLIF(btrim(COALESCE(v_old, '')), ''), 'sem CE')
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(v_old, '')), '') IS NULL THEN
    RAISE EXCEPTION 'O B/L % ainda nao tem CE Mercante: o CE entra pela planilha de CE Mercante, que tambem vincula o Manifesto Mercante.', p_bl_id
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_ce, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o CE Mercante correto (15 digitos). Para tirar o CE, use Remover CE Mercante.' USING ERRCODE = '22023';
  END IF;
  v_result := public._set_bl_ce_mercante(p_bl_id, p_ce, auth.uid(), 'Correcao do CE Mercante pela ficha: ' || v_reason, 'ce_mercante_ficha');
  RETURN jsonb_build_object('status', v_result, 'bl_id', p_bl_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_bl_ce_mercante(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_bl_ce_mercante(text, text, text, text) TO authenticated, service_role;
