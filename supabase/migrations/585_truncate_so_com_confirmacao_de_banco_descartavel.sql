-- 585: TRUNCATE em tabela de public só com a confirmação de banco descartável.
--
-- Em 2026-11-03 um bloco "LIMPA TUDO" nos Reports do Project Overview do
-- dashboard tentou, a cada abertura da página, esvaziar cerca de 150 tabelas
-- de produção com TRUNCATE ... RESTART IDENTITY CASCADE. Só não apagou nada
-- porque o dashboard roda os blocos de Reports com o papel somente leitura
-- (relatório: docs/archive/reports/2026-11-04-tentativas-de-truncate-em-producao.md).
-- Rodado como postgres no SQL Editor, o mesmo texto seria barrado apenas pelo
-- gatilho de app_settings (migration 156), e só porque app_settings estava na
-- lista dele.
--
-- A partir daqui todo TRUNCATE em tabela de public é recusado, inclusive em
-- cascata, salvo na sessão que confirmou estar num banco descartável com
-- SET vela.limpeza_banco_descartavel = 'confirmo' -- a mesma confirmação que
-- supabase/scripts/limpar_dados_teste.sql já exige. app_settings fica de fora
-- deste gatilho porque o da 156 é mais estrito: recusa mesmo com a confirmação.
--
-- ponytail: a confirmação é um passo deliberado, não autenticação; quem tem o
-- papel postgres pode digitar o SET ou desabilitar o gatilho. O objetivo é
-- que nenhum TRUNCATE aconteça por engano ou por automação esquecida. DELETE
-- sem WHERE continua possível e fica para as políticas e grants. Tabela criada
-- depois desta migration precisa do gatilho na própria migration que a cria;
-- o teste local-pg truncateConfirmacao falha enquanto faltar. O passo
-- seguinte, se a lista manual pesar, é um event trigger de CREATE TABLE.
--
-- Aditiva: cria uma função e um gatilho por tabela; não lê nem altera linhas.
BEGIN;

CREATE FUNCTION public.truncate_requires_disposable_confirmation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('vela.limpeza_banco_descartavel', true) IS DISTINCT FROM 'confirmo' THEN
    RAISE EXCEPTION 'TRUNCATE recusado em %.%: produção tem dados reais.', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = '55000',
            HINT = 'Só em banco descartável, rode antes na mesma sessão: SET vela.limpeza_banco_descartavel = ''confirmo''; Procedimento: docs/operations/reset-ambiente.md.';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.truncate_requires_disposable_confirmation() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_table text;
BEGIN
  FOR v_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition -- a partição herda o gatilho da tabela-mãe
      AND c.relname <> 'app_settings'
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'CREATE TRIGGER truncate_requires_confirmation BEFORE TRUNCATE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.truncate_requires_disposable_confirmation()',
      v_table
    );
  END LOOP;
END $$;

COMMIT;
