-- Limpeza dos dados de teste do Vela.
--
-- Esvazia todas as tabelas de public, menos o cadastro base e a configuração do
-- sistema listados abaixo, com RESTART IDENTITY CASCADE num único comando: se
-- qualquer tabela recusar, nada é apagado.
--
-- Só execute enquanto a afirmação "Data status" do AGENTS.md estiver vigente
-- (produção sem dados reais). Procedimento: docs/operations/reset-ambiente.md.
--
-- Ao criar uma tabela de configuração ou de cadastro base, inclua-a em
-- v_preservar. A migration 156 faz o banco recusar o TRUNCATE de app_settings:
-- sem ela na lista, a limpeza falha inteira, de propósito.
DO $$
DECLARE
  v_preservar text[] := ARRAY[
    -- Usuários
    'user_profiles',
    -- Configuração do sistema (singletons e calendário)
    'app_settings',
    'exchange_rate_reference',
    'business_holidays',
    -- Catálogo base de tipos de alerta
    'alert_type_catalog',
    -- Taxas locais gerais
    'charge_tables',
    'charge_table_items',
    -- Taxas de demurrage
    'demurrage_rates',
    -- Terminais portuários e depots
    'depots',
    'depot_services',
    -- Armadores e portos
    'carriers',
    'ports'
  ];
  v_ausentes text[];
  v_cascata text[];
  v_tables text;
BEGIN
  -- Nome digitado errado na lista protegeria nada: avisa em vez de seguir calado.
  SELECT array_agg(t) INTO v_ausentes
  FROM unnest(v_preservar) AS t
  WHERE NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t);
  IF v_ausentes IS NOT NULL THEN
    RAISE EXCEPTION 'Tabelas a preservar inexistentes em public: %', v_ausentes;
  END IF;

  -- CASCADE esvaziaria também uma tabela preservada que referencia uma tabela
  -- esvaziada. Para antes, em vez de apagar o que a lista deveria proteger.
  SELECT array_agg(DISTINCT c.conrelid::regclass::text || ' -> ' || c.confrelid::regclass::text) INTO v_cascata
  FROM pg_constraint c
  JOIN pg_class s ON s.oid = c.conrelid
  JOIN pg_class d ON d.oid = c.confrelid
  JOIN pg_namespace n ON n.oid = d.relnamespace
  WHERE c.contype = 'f' AND n.nspname = 'public'
    AND s.relname = ANY (v_preservar) AND d.relname <> ALL (v_preservar);
  IF v_cascata IS NOT NULL THEN
    RAISE EXCEPTION 'Tabela preservada referencia tabela que seria esvaziada (CASCADE a apagaria): %', v_cascata;
  END IF;

  SELECT string_agg(quote_ident(schemaname) || '.' || quote_ident(tablename), ', ' ORDER BY tablename)
  INTO v_tables
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename <> ALL (v_preservar);

  IF v_tables IS NULL THEN
    RAISE NOTICE 'Nenhuma tabela operacional encontrada para limpeza.';
    RETURN;
  END IF;

  EXECUTE 'TRUNCATE TABLE ' || v_tables || ' RESTART IDENTITY CASCADE';
  RAISE NOTICE 'Limpeza concluída. Preservadas: %', v_preservar;
END $$;
