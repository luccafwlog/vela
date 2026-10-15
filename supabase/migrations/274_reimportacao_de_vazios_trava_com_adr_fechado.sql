-- 274: a planilha de Unidades Embarcadas não muda o Embarque de Vazios com o
-- ADR de Saída fechado (revisão da PR 954; item B14, migration 262; ADR 0071,
-- item 4).
--
-- Problema: a 262 travou pelo ADR fechado o **Excluir unidade** e a linha de
-- serviço, mas a reimportação da planilha
-- (`import_vazios_bookings_transactional`, migration 187) seguia atualizando,
-- incluindo e apagando unidades. Exemplo: o ADR BRVIX/TVV foi fechado com 40
-- vazios embarcados; a reimportação de uma planilha com 35 apagava 5 unidades
-- e o Embarque divergia do snapshot fechado.
--
-- Mudança: o envelope recusa a reimportação quando
-- `_vazios_export_locked_by_adr` (262) diz que o ADR de Saída do porto de
-- embarque está fechado, depois da conferência de usuário e antes de tocar nas
-- unidades. Reabrir o ADR (com justificativa) destrava. O resto é o envelope
-- da migration 189.
--
-- Só redefine uma função; não reescreve nem apaga linhas.
-- Rollback: reaplicar o envelope da migration 189 (`_set_import_context` e
-- `RETURN public.import_vazios_bookings_transactional_legacy_189(...)`).

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(p_voyage_id bigint, p_port text, p_uploaded_by uuid, p_bookings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar unidades.' USING ERRCODE = '42501';
  END IF;
  IF public._vazios_export_locked_by_adr(p_voyage_id, p_port) THEN
    RAISE EXCEPTION 'O ADR de Saída deste porto está fechado: reabra o ADR para mudar as unidades embarcadas.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM public._set_import_context('Embarque de Vazios', p_voyage_id, NULL);
  RETURN public.import_vazios_bookings_transactional_legacy_189(p_voyage_id, p_port, p_uploaded_by, p_bookings);
END $function$;
