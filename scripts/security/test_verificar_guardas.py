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


def replay_funcoes(ddl):
    with tempfile.TemporaryDirectory() as directory:
        Path(directory, '001_test.sql').write_text(ddl)
        with patch.object(guardas, 'MIGRATIONS', directory):
            *_, fns, grants = guardas.estado_final()
        guardas._CONTEUDO.clear()
        return fns, grants


GUARDA_DE_PERFIL = '''
CREATE OR REPLACE FUNCTION public.is_active_user() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
'''


def funcao(nome, corpo, args='p_id bigint'):
    return f'''
CREATE OR REPLACE FUNCTION public.{nome}({args}) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $function$
BEGIN
{corpo}
END $function$;
GRANT EXECUTE ON FUNCTION public.{nome}(bigint) TO authenticated;
'''


class AliasDeTipoTest(unittest.TestCase):
    def test_grant_com_timestamptz_alcanca_funcao_recriada_por_extenso(self):
        fns, grants = replay_funcoes('''
            CREATE FUNCTION public.f(p_id bigint, p_at timestamptz) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
            GRANT EXECUTE ON FUNCTION public.f(bigint, timestamptz) TO authenticated;
            CREATE OR REPLACE FUNCTION public.f(p_id bigint, p_at timestamp with time zone) RETURNS void
              LANGUAGE sql AS $$ SELECT 2 $$;
        ''')
        self.assertEqual(list(fns), ['f(int8,timestamptz)'])
        self.assertIn('authenticated', grants['f(int8,timestamptz)'])

    def test_normaliza_aliases_e_arrays(self):
        self.assertEqual(guardas.normalizar_tipo('INTEGER[]'), 'int4[]')
        self.assertEqual(guardas.normalizar_tipo('character  varying'), 'varchar')
        self.assertEqual(guardas.normalizar_tipo('public.my_type'), 'my_type')


class TravaAntesDaGuardaTest(unittest.TestCase):
    def trava(self, ddl, sig='alvo(int8)'):
        fns, _ = replay_funcoes(GUARDA_DE_PERFIL + ddl)
        return guardas.trava_antes_da_guarda(sig, fns)

    def test_trava_antes_do_predicado_de_perfil_e_apontada(self):
        self.assertEqual(self.trava(funcao('alvo', '''
            PERFORM pg_advisory_xact_lock(p_id);
            IF NOT public.is_active_user() THEN RAISE EXCEPTION 'x' USING ERRCODE = '42501'; END IF;
        ''')), 'pg_advisory_xact_lock(')

    def test_guarda_antes_da_trava_passa(self):
        self.assertIsNone(self.trava(funcao('alvo', '''
            IF NOT public.is_active_user() THEN RAISE EXCEPTION 'x' USING ERRCODE = '42501'; END IF;
            PERFORM 1 FROM public.voyages WHERE id = p_id FOR UPDATE;
        ''')))

    def test_guarda_inline_por_perfil_conta(self):
        self.assertIsNone(self.trava(funcao('alvo', '''
            SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid();
            IF v_role IS NULL THEN RAISE EXCEPTION 'x' USING ERRCODE = '42501'; END IF;
            PERFORM 1 FROM public.voyages WHERE id = p_id FOR UPDATE;
        ''')))

    def test_codigo_42501_sem_perfil_nao_e_guarda(self):
        # Como _assert_actor_is_caller: confere o autor, não o perfil.
        self.assertEqual(self.trava(funcao('alvo', '''
            IF p_id IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'x' USING ERRCODE = '42501'; END IF;
            PERFORM pg_advisory_xact_lock(p_id);
            PERFORM public.is_active_user();
        ''')), 'pg_advisory_xact_lock(')

    def test_delegacao_so_conta_se_a_chamada_vem_antes_da_trava(self):
        ddl = funcao('guardada', "IF NOT public.is_active_user() THEN RAISE EXCEPTION 'x' USING ERRCODE = '42501'; END IF;")
        self.assertIsNone(self.trava(ddl + funcao('alvo', '''
            PERFORM public.guardada(p_id);
            PERFORM pg_advisory_xact_lock(p_id);
        ''')))
        self.assertEqual(self.trava(ddl + funcao('alvo', '''
            PERFORM pg_advisory_xact_lock(p_id);
            PERFORM public.guardada(p_id);
        ''')), 'pg_advisory_xact_lock(')

    def test_helper_de_trava_que_confere_quem_chama_nao_conta(self):
        helper_guardado = funcao('_lock_import_voyages', '''
            IF NOT public.is_active_user() THEN RAISE EXCEPTION 'x' USING ERRCODE = '42501'; END IF;
            PERFORM pg_advisory_xact_lock(p_id);
        ''')
        helper_aberto = funcao('_lock_import_voyages', 'PERFORM pg_advisory_xact_lock(p_id);')
        chamador = funcao('alvo', '''
            PERFORM public._lock_import_voyages(p_id);
            IF NOT public.is_active_user() THEN RAISE EXCEPTION 'x' USING ERRCODE = '42501'; END IF;
        ''')
        self.assertIsNone(self.trava(helper_guardado + chamador))
        self.assertEqual(self.trava(helper_aberto + chamador), '_lock_import_voyages(')

    def test_arvore_atual_passa_sem_trava_antes_da_guarda(self):
        guardas._CONTEUDO.clear()
        *_, fns, grants = guardas.estado_final()
        # A 416 pôs a guarda de Financeiro antes da trava na baixa de 8 argumentos.
        sig = 'register_ledger_invoice_payment(int8,numeric,text,timestamptz,text,text,text,uuid)'
        self.assertIsNone(guardas.trava_antes_da_guarda(sig, fns))
        expostas = [
            s for s, v in fns.items()
            if {'authenticated', 'public'} & grants.get(s, set()) and v['nome'] not in guardas.EXCECOES
            and guardas.trava_antes_da_guarda(s, fns) and s not in guardas.TRAVA_ANTES_DA_GUARDA_ACEITA
        ]
        self.assertEqual(expostas, [])


if __name__ == '__main__':
    unittest.main()
