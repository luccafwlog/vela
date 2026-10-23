-- 416: a recusa de viagem duplicada (413) reconhece o navio pelo IMO
-- (achado da revisão da PR 1043).
--
-- Problema:
--   `guard_voyage_identity_unique` (413) só via o mesmo navio pelo
--   `vessel_id` ou pelo mesmo nome. Como `vessels` não é único por IMO, o
--   mesmo IMO cadastrado com outra grafia do nome passava com o mesmo número
--   de viagem, e a trava por nome não serializava esses dois cadastros.
--
-- Mudança:
--   A função passa a tratar como o mesmo navio o que tem o mesmo IMO (só
--   dígitos), como já faz Chegadas e Saídas ("o IMO exato prevalece sobre a
--   grafia", docs/modules/chegadas-saidas.md), e, quando o navio tem IMO, trava
--   também pelo IMO, depois da trava pelo nome. O resto é o da 413; o gatilho não muda.
--
-- Não reescreve nem apaga linhas existentes.
--
-- Rollback: reaplicar `guard_voyage_identity_unique()` da 413.

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
  -- 416: com IMO, trava também pelo IMO (grafias diferentes do mesmo navio esperam
  -- uma pela outra). Sempre depois da trava do nome, então não há espera em ciclo.
  IF v_imo IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('voyage_identity:imo:' || v_imo || ':' || v_number, 0));
  END IF;

  SELECT v.id, v.status, vs.name AS vessel_name, v.voyage_number INTO v_dup
  FROM public.voyages v
  JOIN public.vessels vs ON vs.id = v.vessel_id
  WHERE v.id IS DISTINCT FROM NEW.id
    AND upper(btrim(v.voyage_number)) = v_number
    AND (
      v.vessel_id = NEW.vessel_id
      -- 416: o IMO exato prevalece sobre a grafia do nome (regra de Chegadas e Saídas).
      OR (v_imo IS NOT NULL AND NULLIF(regexp_replace(COALESCE(vs.imo, ''), '\D', '', 'g'), '') = v_imo)
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
