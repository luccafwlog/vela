-- 421: um local de desova por container físico (Lote 10 do plano
-- docs/plans/2026-10-21-frente-das-importacoes.md; ADR 0095, decisão 26;
-- achado F-50 da revisão docs/archive/audits/2026-10-21-revisao-importacoes.md).
--
-- Depende da afirmação "Data status" do AGENTS.md (o banco de produção não
-- tem dados de negócio): o item 3 abaixo preenche `unpacking_location` vazio
-- de linhas existentes de `bl_containers`.
--
-- Problema (F-50): o local de desova é coluna de `bl_containers`, uma linha
-- por B/L. Container compartilhado por dois B/Ls da mesma Viagem é a mesma
-- caixa física, mas gravar o local (tela Veículos ou planilha de Veículos)
-- mudava só a linha daquele B/L; o outro B/L ficava sem local ou com outro.
--
-- Mudança:
--   1. Gatilho `unpacking_location_follows_container` (AFTER INSERT OR UPDATE
--      OF unpacking_location ON bl_containers): o valor gravado numa linha
--      passa às outras linhas do mesmo container (mesmo número, sem
--      diferenciar maiúsculas e espaços) nos B/Ls ativos da mesma Viagem,
--      inclusive apagar. Cada linha mudada grava o próprio Histórico
--      (`audit_bl_containers`). B/L cancelado é somente leitura e fica como
--      está. SECURITY DEFINER: quem pode gravar o local de uma linha
--      (`GRANT UPDATE (unpacking_location)` para authenticated) grava o do
--      container físico inteiro.
--   2. Gatilho `unpacking_location_inherits_container` (BEFORE INSERT): linha
--      nova sem local herda o local do mesmo container na Viagem (B/L novo
--      que compartilha o container).
--   3. Linhas já gravadas: container com um único local nas linhas ativas da
--      Viagem (não cancelada) preenche as linhas sem local. Container com dois
--      locais diferentes fica como está (não há como saber qual vale); a
--      próxima gravação do local, com a confirmação da tela, os unifica.
--
-- A confirmação de troca de um local já gravado é da tela (Veículos e
-- planilha de Veículos); a RPC `import_vehicle_rows_transactional` já só
-- troca o gravado com `unpacking_confirmed`.
--
-- Rollback: DROP dos dois gatilhos e das funções; o item 3 não se desfaz.

CREATE OR REPLACE FUNCTION public.unpacking_location_follows_container()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_voyage_id bigint;
BEGIN
  -- A propagação é uma escrita só: a linha irmã que ela muda não propaga de novo.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.unpacking_location IS NOT DISTINCT FROM OLD.unpacking_location THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.unpacking_location IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT b.voyage_id INTO v_voyage_id FROM public.bls b WHERE b.id = NEW.bl_id;
  IF v_voyage_id IS NULL OR NULLIF(btrim(COALESCE(NEW.container_number, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.bl_containers AS sibling
  SET unpacking_location = NEW.unpacking_location
  FROM public.bls b
  WHERE b.id = sibling.bl_id
    AND b.voyage_id = v_voyage_id
    AND b.cancelled_at IS NULL
    AND sibling.id <> NEW.id
    AND upper(btrim(sibling.container_number)) = upper(btrim(NEW.container_number))
    AND sibling.unpacking_location IS DISTINCT FROM NEW.unpacking_location;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.unpacking_location_follows_container() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS unpacking_location_follows_container ON public.bl_containers;
CREATE TRIGGER unpacking_location_follows_container
  AFTER INSERT OR UPDATE OF unpacking_location ON public.bl_containers
  FOR EACH ROW EXECUTE FUNCTION public.unpacking_location_follows_container();

CREATE OR REPLACE FUNCTION public.unpacking_location_inherits_container()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(NEW.unpacking_location, '')), '') IS NOT NULL
     OR NULLIF(btrim(COALESCE(NEW.container_number, '')), '') IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT sibling.unpacking_location INTO NEW.unpacking_location
  FROM public.bl_containers sibling
  JOIN public.bls sb ON sb.id = sibling.bl_id AND sb.cancelled_at IS NULL
  JOIN public.bls nb ON nb.id = NEW.bl_id AND nb.voyage_id = sb.voyage_id
  WHERE upper(btrim(sibling.container_number)) = upper(btrim(NEW.container_number))
    AND NULLIF(btrim(COALESCE(sibling.unpacking_location, '')), '') IS NOT NULL
  ORDER BY sibling.id
  LIMIT 1;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.unpacking_location_inherits_container() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS unpacking_location_inherits_container ON public.bl_containers;
CREATE TRIGGER unpacking_location_inherits_container
  BEFORE INSERT ON public.bl_containers
  FOR EACH ROW EXECUTE FUNCTION public.unpacking_location_inherits_container();

-- 3. Linhas já gravadas: um só local no container preenche as vazias.
WITH located AS (
  SELECT b.voyage_id, upper(btrim(c.container_number)) AS container_key,
         min(c.unpacking_location) AS location
  FROM public.bl_containers c
  JOIN public.bls b ON b.id = c.bl_id AND b.cancelled_at IS NULL
  JOIN public.voyages v ON v.id = b.voyage_id AND v.status IS DISTINCT FROM 'cancelled'
  WHERE NULLIF(btrim(COALESCE(c.unpacking_location, '')), '') IS NOT NULL
  GROUP BY 1, 2
  HAVING count(DISTINCT c.unpacking_location) = 1
)
UPDATE public.bl_containers AS c
SET unpacking_location = l.location
FROM public.bls b, located l
WHERE b.id = c.bl_id
  AND b.cancelled_at IS NULL
  AND l.voyage_id = b.voyage_id
  AND l.container_key = upper(btrim(c.container_number))
  AND NULLIF(btrim(COALESCE(c.unpacking_location, '')), '') IS NULL;
