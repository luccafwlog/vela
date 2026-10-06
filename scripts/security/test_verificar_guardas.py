import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('guardas', Path(__file__).with_name('verificar_guardas.py'))
guardas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guardas)


class QualifiedTableReplayTest(unittest.TestCase):
    def replay(self, ddl):
        with tempfile.TemporaryDirectory() as directory:
            migration = Path(directory, '001_test.sql')
            migration.write_text(ddl)
            with patch.object(guardas, 'MIGRATIONS', directory):
                tables, rls, *_ = guardas.estado_final()
            guardas._CONTEUDO.clear()
            return tables, rls

    def test_same_table_name_in_different_schemas_keeps_missing_rls_visible(self):
        tables, rls = self.replay('''
            CREATE TABLE public.receipts(id int);
            ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
            CREATE TABLE ce_unlock_private.receipts(id int);
        ''')
        self.assertEqual(set(tables) - rls, {'ce_unlock_private.receipts'})

    def test_qualified_and_quoted_names_and_drop(self):
        tables, rls = self.replay('''
            CREATE TABLE "ce_unlock_private"."receipts"(id int);
            ALTER TABLE "ce_unlock_private"."receipts" ENABLE ROW LEVEL SECURITY;
            CREATE TABLE public.temporary_table(id int);
            DROP TABLE public.temporary_table;
            CREATE TABLE unqualified_table(id int);
            ALTER TABLE public.unqualified_table ENABLE ROW LEVEL SECURITY;
        ''')
        self.assertEqual(set(tables), {'ce_unlock_private.receipts', 'public.unqualified_table'})
        self.assertEqual(set(tables) - rls, set())


if __name__ == '__main__':
    unittest.main()
