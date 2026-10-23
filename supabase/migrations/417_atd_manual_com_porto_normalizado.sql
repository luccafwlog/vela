-- 417: a correção manual do ATD do POL vence também quando a marca está
-- gravada com o apelido do porto (achado da revisão da PR 1043 sobre a 415).
--
-- Problema:
--   A 410 converte `voyage_pol_atd_manual.pol` de BRSEP para BRIGI num
--   comando só; se a Viagem já tem as duas marcas (chave repetida), o comando
--   cai no tratamento de erro e todas as marcas BRSEP ficam como estão. A 415
--   normaliza o POL do recálculo para BRIGI, mas compara a marca com igualdade
--   exata: a marca BRSEP não era achada e a importação, o cancelamento ou a
--   reativação de um B/L sobrescrevia o ATD corrigido à mão.
--
-- Mudança:
--   `_recompute_voyage_pol_atd` compara a marca manual pelo código
--   normalizado. O resto é o da 415. As marcas antigas não são reescritas.
--
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: reaplicar `_recompute_voyage_pol_atd` da 415.

CREATE OR REPLACE FUNCTION public._recompute_voyage_pol_atd(
  p_voyage_id bigint,
  p_pol text,
  p_actor uuid,
  p_justification text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pol text := COALESCE(public.normalize_port_code(p_pol), '');
  v_entity text;
  v_canonical date;
  v_current text;
  v_previous_flag text;
  v_confirmed date;
  v_justification text := p_justification;
BEGIN
  IF p_voyage_id IS NULL OR v_pol = '' THEN
    RETURN;
  END IF;
  -- Viagem cancelada: a escala é somente leitura (gatilho de audit_logs).
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id AND status IS DISTINCT FROM 'cancelled') THEN
    RETURN;
  END IF;
  -- Correção manual vence (ADR 0095, decisão 23).
  -- 417: a marca gravada com o apelido (BRSEP que a 410 não converteu) também vence.
  IF EXISTS (SELECT 1 FROM public.voyage_pol_atd_manual WHERE voyage_id = p_voyage_id AND public.normalize_port_code(pol) = v_pol) THEN
    RETURN;
  END IF;

  v_entity := p_voyage_id::text || '::' || v_pol;

  SELECT min(b.laden_on_board) INTO v_canonical
  FROM public.bls AS b
  WHERE b.voyage_id = p_voyage_id
    AND public.normalize_port_code(b.pol) = v_pol
    AND b.cancelled_at IS NULL;

  -- 414 (ADR 0097): saída confirmada em Chegadas e Saídas é provisória.
  SELECT atd INTO v_confirmed FROM public.voyage_pol_atd_confirmed
  WHERE voyage_id = p_voyage_id AND pol = v_pol;
  IF FOUND THEN
    -- Sem Laden on Board nos B/Ls ativos, a confirmada fica.
    IF v_canonical IS NULL THEN
      RETURN;
    END IF;
    DELETE FROM public.voyage_pol_atd_confirmed WHERE voyage_id = p_voyage_id AND pol = v_pol;
    IF v_canonical <> v_confirmed THEN
      v_justification := format(
        'Data do B/L (Laden on Board %s) substitui a saída confirmada em %s em Chegadas e Saídas (ADR 0097)',
        to_char(v_canonical, 'DD/MM/YYYY'), to_char(v_confirmed, 'DD/MM/YYYY'));
    END IF;
  END IF;

  SELECT al.new_value INTO v_current
  FROM public.audit_logs AS al
  WHERE al.entity_type = 'voyage_pol_schedule'
    AND al.entity_id = v_entity
    AND al.field_name = 'atd'
  ORDER BY al.changed_at DESC, al.id DESC
  LIMIT 1;

  IF v_current IS NOT DISTINCT FROM v_canonical::text THEN
    RETURN;
  END IF;

  v_previous_flag := current_setting('vela.atd_from_bls', true);
  PERFORM set_config('vela.atd_from_bls', 'on', true);
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage_pol_schedule', v_entity, 'atd', v_current, v_canonical::text, p_actor, v_justification);
  PERFORM set_config('vela.atd_from_bls', COALESCE(v_previous_flag, 'off'), true);
END;
$function$;

REVOKE ALL ON FUNCTION public._recompute_voyage_pol_atd(bigint, text, uuid, text) FROM PUBLIC, anon, authenticated;
