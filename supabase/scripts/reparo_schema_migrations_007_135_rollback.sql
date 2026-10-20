-- Rollback de reparo_schema_migrations_007_135.sql.
--
-- Devolve às linhas 007 e 135 de supabase_migrations.schema_migrations o
-- `statements` guardado no backup (o comentário de 1 elemento). Só altera a
-- linha que ainda tem exatamente o SQL gravado pelo reparo; se alguém mudou a
-- linha depois, aborta sem tocar em nada. Não desfaz nenhum objeto de schema:
-- o reparo não executou SQL de migration.
-- A tabela de backup só é apagada no passo 4, depois da verificação.

BEGIN;

-- 1. Pré-condição: backup completo e linhas ainda no estado do reparo.
DO $pre_rollback$
DECLARE
  v_problema text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations_bkp_007_135') IS NULL THEN
    RAISE EXCEPTION 'rollback 007/135: backup ausente; nada a restaurar.';
  END IF;
  SELECT string_agg(e.version, ', ')
    INTO v_problema
    FROM (VALUES
    ('007', 12, '9311905842f9cf4669a11c78b5568db4'),
    ('135', 3, '11632c4741f85a0324739d5a114e9210')
    ) AS e(version, n, md5)
    LEFT JOIN supabase_migrations.schema_migrations sm ON sm.version = e.version
    LEFT JOIN supabase_migrations.schema_migrations_bkp_007_135 b ON b.version = e.version
   WHERE b.version IS NULL
      OR sm.version IS NULL
      OR cardinality(sm.statements) IS DISTINCT FROM e.n
      OR md5(array_to_string(sm.statements, chr(31))) IS DISTINCT FROM e.md5;
  IF v_problema IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 007/135: sem backup ou linha alterada depois do reparo: %', v_problema;
  END IF;
END;
$pre_rollback$;

-- 2. Restauração.
UPDATE supabase_migrations.schema_migrations sm
   SET statements = b.statements
  FROM supabase_migrations.schema_migrations_bkp_007_135 b
 WHERE sm.version = b.version
   AND sm.version IN ('007', '135');

-- 3. Verificação: as duas linhas voltaram ao valor do backup.
DO $verifica_rollback$
DECLARE
  v_divergente text;
BEGIN
  SELECT string_agg(b.version, ', ') INTO v_divergente
    FROM supabase_migrations.schema_migrations_bkp_007_135 b
    LEFT JOIN supabase_migrations.schema_migrations sm ON sm.version = b.version
   WHERE sm.statements IS DISTINCT FROM b.statements;
  IF v_divergente IS NOT NULL OR (SELECT count(*) FROM supabase_migrations.schema_migrations_bkp_007_135) <> 2 THEN
    RAISE EXCEPTION 'rollback 007/135: restauração divergente: %', coalesce(v_divergente, 'contagem do backup');
  END IF;
  RAISE NOTICE 'rollback 007/135: statements restaurados do backup.';
END;
$verifica_rollback$;

-- 4. Limpeza do backup (opcional; comente para guardá-lo).
DROP TABLE supabase_migrations.schema_migrations_bkp_007_135;

COMMIT;
