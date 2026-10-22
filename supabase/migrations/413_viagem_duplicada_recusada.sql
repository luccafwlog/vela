-- 413: navio e número de viagem já cadastrados são recusados (revisão manual
-- de 2026-10-22, item A1).
--
-- Problema:
--   `voyages` não tem unicidade por navio e número (só a PK; `vessels` também
--   não é único por nome nem IMO, migration 217). O botão "Nova Viagem"
--   (`createVoyage`, várias chamadas do cliente) cadastrava uma segunda
--   GREEN ITAJAI / 11 sem aviso; Chegadas e Saídas e a planilha procuram a
--   existente antes, mas nada no banco impedia.
--
-- Mudança:
--   Gatilho `guard_voyage_identity_unique` (BEFORE INSERT OR UPDATE OF
--   vessel_id, voyage_number) recusa, com SQLSTATE 23505 e a mensagem "Já
--   existe a viagem <navio> / <número>…", a Viagem cujo número (sem espaços nas
--   pontas, maiúsculo) já existe em outra Viagem do mesmo navio: o mesmo
--   `vessel_id`, ou navio com o mesmo nome (maiúsculo, espaços normalizados)
--   quando os dois IMOs não se contradizem (IMO distinto é outro navio, regra
--   de Chegadas e Saídas). A Viagem Cancelada conta: é retida e se reativa
--   (a planilha de Chegadas e Saídas também a trata como a mesma Viagem). Uma
--   trava por nome e número serializa dois cadastros simultâneos.
--   Não é índice único: as duplicatas que já existirem continuam (a migration
--   não falha por elas), e só uma Viagem nova, ou a troca de navio ou número,
--   é conferida. A tela confere antes com os apelidos de navio
--   (`findDuplicateVoyage`, src/services/voyages.ts); o banco é a garantia.
--
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: DROP TRIGGER guard_voyage_identity_unique ON public.voyages;
-- DROP FUNCTION public.guard_voyage_identity_unique().

CREATE OR REPLACE FUNCTION public.guard_voyage_identity_unique()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_number text := upper(btrim(COALESCE(NEW.voyage_number, '')));
  v_name text;
  v_imo text;
  v_dup record;
BEGIN
  IF v_number = '' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.vessel_id IS NOT DISTINCT FROM OLD.vessel_id
     AND upper(btrim(COALESCE(OLD.voyage_number, ''))) = v_number THEN
    RETURN NEW;
  END IF;

  SELECT upper(regexp_replace(btrim(COALESCE(name, '')), '\s+', ' ', 'g')),
         NULLIF(regexp_replace(COALESCE(imo, ''), '\D', '', 'g'), '')
    INTO v_name, v_imo
  FROM public.vessels WHERE id = NEW.vessel_id;

  -- Dois cadastros simultâneos do mesmo navio e número esperam um pelo outro.
  PERFORM pg_advisory_xact_lock(hashtextextended('voyage_identity:' || COALESCE(v_name, NEW.vessel_id::text) || ':' || v_number, 0));

  SELECT v.id, v.status, vs.name AS vessel_name, v.voyage_number INTO v_dup
  FROM public.voyages v
  JOIN public.vessels vs ON vs.id = v.vessel_id
  WHERE v.id IS DISTINCT FROM NEW.id
    AND upper(btrim(v.voyage_number)) = v_number
    AND (
      v.vessel_id = NEW.vessel_id
      OR (
        COALESCE(v_name, '') <> ''
        AND upper(regexp_replace(btrim(COALESCE(vs.name, '')), '\s+', ' ', 'g')) = v_name
        AND (v_imo IS NULL
          OR NULLIF(regexp_replace(COALESCE(vs.imo, ''), '\D', '', 'g'), '') IS NULL
          OR NULLIF(regexp_replace(COALESCE(vs.imo, ''), '\D', '', 'g'), '') = v_imo)
      )
    )
  ORDER BY v.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION '%', CASE WHEN v_dup.status = 'cancelled'
        THEN format('Já existe a viagem %s / %s, cancelada. Reative-a em Viagens em vez de cadastrar outra.', v_dup.vessel_name, v_dup.voyage_number)
        ELSE format('Já existe a viagem %s / %s. Abra a viagem existente em vez de cadastrar outra.', v_dup.vessel_name, v_dup.voyage_number)
      END
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_voyage_identity_unique() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_voyage_identity_unique ON public.voyages;
CREATE TRIGGER guard_voyage_identity_unique
  BEFORE INSERT OR UPDATE OF vessel_id, voyage_number ON public.voyages
  FOR EACH ROW EXECUTE FUNCTION public.guard_voyage_identity_unique();
