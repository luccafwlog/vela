-- Migration 233: lote da exportação ZPT com hash e conteúdo imutável.
--
-- O lote (`ce_unlock_exports`) guarda as linhas e o snapshot de cada envio à
-- ZPT, e a planilha é gerada de novo a partir dele quando o download falha ou é
-- repetido. A coluna `hash` existia desde a `139`, mas nunca foi preenchida
-- (limitação registrada no relatório de 2026-10-04), e nada impedia reescrever
-- as linhas de um lote já enviado.
--
-- Mudança:
-- - BEFORE INSERT calcula `hash` = SHA-256 (hex) de `layout_version` + `rows`.
-- - BEFORE UPDATE recusa mudar `rows`, `snapshot`, `layout_version`, `hash`,
--   `created_by`, `created_at` e `reexport_of`; só `sent_at` e `reference`
--   (registro do envio) continuam editáveis, como faz o comando `export`.
-- - Backfill do `hash` dos lotes existentes. Reescreve linhas existentes e se
--   apoia no "Data status" do AGENTS.md (produção sem dado real de negócio);
--   o valor é derivado das próprias linhas, então o backfill é determinístico.
--
-- Rollback: DROP TRIGGER ce_unlock_exports_hash e ce_unlock_exports_immutable
-- e DROP FUNCTION ce_unlock_private.export_hash() e
-- ce_unlock_private.export_immutable(); o hash preenchido pode ficar.

CREATE OR REPLACE FUNCTION ce_unlock_private.export_hash()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 NEW.hash := encode(sha256(convert_to(NEW.layout_version || E'\n' || NEW.rows::text, 'UTF8')), 'hex');
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION ce_unlock_private.export_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF NEW.rows IS DISTINCT FROM OLD.rows OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
 OR NEW.layout_version IS DISTINCT FROM OLD.layout_version OR NEW.hash IS DISTINCT FROM OLD.hash
 OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.reexport_of IS DISTINCT FROM OLD.reexport_of THEN
 RAISE EXCEPTION 'Lote de exportação ZPT é imutável; gere uma reexportação' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $function$;

UPDATE public.ce_unlock_exports
SET hash = encode(sha256(convert_to(layout_version || E'\n' || rows::text, 'UTF8')), 'hex')
WHERE hash IS NULL;

DROP TRIGGER IF EXISTS ce_unlock_exports_hash ON public.ce_unlock_exports;
CREATE TRIGGER ce_unlock_exports_hash BEFORE INSERT ON public.ce_unlock_exports
 FOR EACH ROW EXECUTE FUNCTION ce_unlock_private.export_hash();

DROP TRIGGER IF EXISTS ce_unlock_exports_immutable ON public.ce_unlock_exports;
CREATE TRIGGER ce_unlock_exports_immutable BEFORE UPDATE ON public.ce_unlock_exports
 FOR EACH ROW EXECUTE FUNCTION ce_unlock_private.export_immutable();
