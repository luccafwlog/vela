-- 540: o ADR legado por porto também é recusado quando a frente da escala vem
-- de carga em transbordo ou do Granito importado no porto.
--
-- Problema: a 273 fez `ensure_agency_departure_report` recusar o ADR legado
-- (viagem, porto) quando a escala tem frente de operação, gravada ou derivada
-- dos dados, espelhando as fontes da aba ADR em `_escala_has_operation_fronts`.
-- Nesta mudança a aba passou a derivar frentes de mais duas fontes
-- (`fetchEscalaTerminalState`, `src/services/escalaTerminalAllocation.ts`):
--   1. B/L em transbordo de escala omitida que descarrega no porto (omissão
--      não revertida; o B/L mantém o POD do porto omitido, migration 539);
--   2. Granito importado no porto, pelo porto de carregamento do B/L ou do
--      manifesto na falta dele, mesmo sem a declaração de exportação (538).
-- Numa escala cuja carga vinha só dessas fontes, a aba mostrava "Nenhum
-- terminal atribuído às frentes desta escala (TBC)", mas assinar uma seção
-- pela API ainda criava o ADR legado sem terminal, fora da trava das frentes.
--
-- Mudança: `_escala_has_operation_fronts` passa a contar as duas fontes. O ADR
-- legado que já existe continua operável, como na 273.
--
-- ponytail: o marcador "tem importação" da escala (projeção de `audit_logs`)
-- continua fora, como a 273 registrou.
--
-- Só redefine uma função; não reescreve nem apaga linhas.
-- Rollback: reaplicar `_escala_has_operation_fronts` da 273.

CREATE OR REPLACE FUNCTION public._escala_has_operation_fronts(p_voyage_id bigint, p_port text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
      SELECT 1 FROM public.voyage_escala_operation_fronts AS f
      WHERE f.voyage_id = p_voyage_id AND upper(btrim(f.port)) = upper(btrim(p_port))
    ) OR EXISTS (
      SELECT 1 FROM public.bls AS b
      WHERE b.voyage_id = p_voyage_id
        AND public.normalize_port_code(b.pod) = public.normalize_port_code(p_port)
    ) OR EXISTS (
      SELECT 1
      FROM public.bl_transshipments AS bt
      JOIN public.voyage_omissions AS o ON o.id = bt.omission_id
      WHERE o.voyage_id = p_voyage_id
        AND public.normalize_port_code(o.discharge_pod) = public.normalize_port_code(p_port)
        AND o.reverted_at IS NULL
        AND bt.disposition = 'transshipment'
    ) OR EXISTS (
      SELECT 1
      FROM public.vazios_importacao_containers AS c
      JOIN public.vazios_importacao_manifests AS m ON m.id = c.manifest_id
      WHERE m.voyage_id = p_voyage_id
        AND public.normalize_port_code(c.pod) = public.normalize_port_code(p_port)
    ) OR EXISTS (
      SELECT 1
      FROM public.granite_bls AS gb
      JOIN public.granite_manifests AS gm ON gm.id = gb.manifest_id
      WHERE gm.voyage_id = p_voyage_id
        AND public.normalize_port_code(COALESCE(gb.loading_port, gm.loading_port)) = public.normalize_port_code(p_port)
    ) OR EXISTS (
      SELECT 1 FROM public.voyage_export_schedules AS e
      WHERE e.voyage_id = p_voyage_id
        AND public.normalize_port_code(e.pol) = public.normalize_port_code(p_port)
        AND e.tem_exportacao
        AND (e.has_granite OR e.has_empty)
    );
$function$;
