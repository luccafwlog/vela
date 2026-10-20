-- Reparo de supabase_migrations.schema_migrations: versões 007 e 135.
--
-- Problema: no projeto de produção (fgmkhbzhaeebrsizwccx) essas duas linhas
-- guardam em `statements` só um comentário (1 elemento), não o SQL aplicado.
-- Uma branch nova do Supabase repete o histórico a partir dessas linhas: a 007
-- vira no-op, o schema `ops` não nasce e a 165 falha com
-- "schema ops does not exist" (MIGRATIONS_FAILED).
--
-- O que faz: copia as duas linhas atuais para uma tabela de backup e grava em
-- `statements` o SQL dos arquivos do repositório, no formato do Supabase CLI
-- (pkg/parser.SplitAndTrim: um elemento por statement, sem o ';' final,
-- comentários iniciais junto da statement seguinte).
-- Só altera a linha que ainda tem o array de 1 elemento só com comentário;
-- reexecutar depois do reparo não muda nada. Não executa SQL de migration:
-- nenhum objeto de schema, job, segredo ou dado de negócio é tocado.
-- Gerado de supabase/migrations/007_cron_secrets_no_vault.sql (12 statements)
-- e supabase/migrations/135_correcao_guarda_ces_exportacao_e_payload_taxas.sql (3 statements).
-- Rollback: reparo_schema_migrations_007_135_rollback.sql.
--
-- Antes de executar, confira o estado atual (somente leitura):
--   SELECT version, name, cardinality(statements) AS n, statements
--     FROM supabase_migrations.schema_migrations
--    WHERE version IN ('007', '135');
-- Esperado: n = 1 e o único elemento só com linhas '--'. Outro estado faz o
-- script abortar sem gravar nada.

BEGIN;

-- 1. Backup das linhas antes da troca (sobrevive ao COMMIT; o rollback lê dele).
--    IF NOT EXISTS: uma reexecução preserva o backup original.
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations_bkp_007_135 AS
  SELECT sm.*, clock_timestamp() AS backed_up_at
    FROM supabase_migrations.schema_migrations sm
   WHERE sm.version IN ('007', '135')
     AND cardinality(sm.statements) = 1
       AND NOT EXISTS (
         SELECT 1 FROM regexp_split_to_table(sm.statements[1], E'\n') AS l
          WHERE l !~ '^\s*(--.*)?$'
       );

-- 2. Troca condicionada ao comentário atual (array de 1 elemento só com '--').
UPDATE supabase_migrations.schema_migrations sm
   SET statements = v.statements
  FROM (VALUES
    ('007', ARRAY[
$m007_00$-- 007: a configuracao dos jobs pg_cron sai de `app.settings.*` e passa ao Vault.
--
-- Contexto (pendencia pos-merge da PR 651): a 005 previa alimentar os jobs HTTP
-- por GUCs `app.settings.*`. A role `postgres` do Supabase nao e superuser e nao
-- pode criar GUC de classe customizada: `ALTER DATABASE|ROLE ... SET
-- app.settings.supabase_url` falha com `permission denied to set parameter`.
-- Nao existe caminho para esse mecanismo sem privilegio de plataforma, entao a
-- convergencia de producao deixou os quatro jobs ativos com URL e segredo
-- LITERAIS dentro de `cron.job.command` — texto em claro, legivel por qualquer
-- conexao `postgres`/dashboard e presente em qualquer dump daquela tabela.
--
-- Decisao (ADR 0063): o mecanismo de configuracao passa a ser o Supabase Vault
-- (extensao `supabase_vault`, ja instalada), lido por uma funcao em schema
-- proprio, fora do PostgREST. O comando do job passa a citar apenas NOMES.
--
-- Propriedades:
--   - `vault.secrets` e `vault.decrypted_secrets` nao tem grant para anon nem
--     authenticated (ACL da plataforma: supabase_admin, postgres, service_role);
--   - `ops` nao concede USAGE a PUBLIC/anon/authenticated e nao esta na lista de
--     schemas expostos pela Data API, entao a funcao nao vira endpoint REST;
--   - a funcao e SECURITY INVOKER de proposito: quem nao alcanca o Vault por
--     privilegio proprio nao passa a alcancar por causa dela. O cron roda como
--     `postgres`, que ja tem o SELECT;
--   - rotacao passa a ser `vault.update_secret(...)`, sem tocar em cron.job.
--
-- Idempotente: reexecutar nao duplica segredo, job nem schema.
--
-- Rollback (reintroduz segredo literal no comando; so em emergencia):
--   SELECT cron.schedule('portal-daily-digest', '0 11 * * *', $$SELECT net.http_post(url := '<BASE>/functions/v1/portal-daily-digest', headers := jsonb_build_object('Authorization', 'Bearer ' || '<SEGREDO>'));$$);
--   -- idem para alerts-foundation-detectors, demurrage-dunning e
--   -- customer-communication-auto-runner; depois:
--   DROP FUNCTION IF EXISTS ops.dispatch_edge_job(text, text, text, text);
--   DROP SCHEMA IF EXISTS ops;
--   -- os segredos permanecem no Vault; remova-os so apos confirmar o rollback.

-- ===========================================================================
-- 1. Pre-requisitos
-- ===========================================================================

DO $prereq_007$
BEGIN
  IF to_regclass('vault.secrets') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION '007: extensao supabase_vault ausente; a configuracao dos jobs nao tem onde morar.';
  END IF;
  IF to_regproc('net.http_post') IS NULL THEN
    RAISE EXCEPTION '007: pg_net/net.http_post ausente; jobs HTTP nao podem operar.';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION '007: pg_cron/cron.job ausente; jobs nao podem operar.';
  END IF;
END;
$prereq_007$$m007_00$,
$m007_01$-- ===========================================================================
-- 2. Schema `ops`: superficie operacional fora do alcance do cliente
-- ===========================================================================

CREATE SCHEMA IF NOT EXISTS ops$m007_01$,
$m007_02$COMMENT ON SCHEMA ops IS
  'Superficie operacional server-side (cron/pg_net). Nao exposta pela Data API; sem USAGE para anon/authenticated. Ver ADR 0063.'$m007_02$,
$m007_03$-- Explicito porque a 007 pode encontrar um schema `ops` pre-existente: um
-- CREATE SCHEMA novo ja nasce sem grant para PUBLIC, mas nao se ele ja existia.
REVOKE ALL ON SCHEMA ops FROM PUBLIC$m007_03$,
$m007_04$REVOKE ALL ON SCHEMA ops FROM anon, authenticated$m007_04$,
$m007_05$-- ===========================================================================
-- 3. Dispatcher unico dos jobs HTTP
-- ===========================================================================
-- ponytail: uma funcao para os quatro jobs, e o segredo e lido a cada disparo.
-- Teto: quatro leituras por hora no pior caso, custo irrelevante diante de
-- decifrar uma vez e cachear. Se um dia houver dezenas de jobs de alta
-- frequencia, o caminho de upgrade e um cache por transacao — nunca
-- reintroduzir literal no comando do job.

CREATE OR REPLACE FUNCTION ops.dispatch_edge_job(
  p_function      text,
  p_secret_name   text,
  p_header_name   text DEFAULT 'Authorization',
  p_header_prefix text DEFAULT 'Bearer '
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $dispatch_edge_job$
DECLARE
  v_base   text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_base
    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = p_secret_name;

  -- Banco novo / branch de Preview nasce com o Vault vazio. Avisar e nao
  -- disparar e melhor do que um POST para host invalido a cada 15 minutos.
  IF NULLIF(v_base, '') IS NULL OR NULLIF(v_secret, '') IS NULL THEN
    RAISE WARNING 'ops.dispatch_edge_job: Vault sem SUPABASE_URL e/ou %; job % nao disparado.',
      p_secret_name, p_function;
    RETURN NULL;
  END IF;

  RETURN net.http_post(
    url     := v_base || '/functions/v1/' || p_function,
    headers := jsonb_build_object(
                 p_header_name, p_header_prefix || v_secret,
                 'Content-Type', 'application/json'
               ),
    body    := '{}'::jsonb
  );
END;
$dispatch_edge_job$$m007_05$,
$m007_06$COMMENT ON FUNCTION ops.dispatch_edge_job(text, text, text, text) IS
  'Dispara uma Edge Function pelo pg_net lendo base e segredo do Vault. Chamada pelos jobs pg_cron, que rodam como postgres. SECURITY INVOKER: nao concede alcance ao Vault a quem nao tem.'$m007_06$,
$m007_07$REVOKE ALL ON FUNCTION ops.dispatch_edge_job(text, text, text, text) FROM PUBLIC$m007_07$,
$m007_08$REVOKE ALL ON FUNCTION ops.dispatch_edge_job(text, text, text, text) FROM anon, authenticated$m007_08$,
$m007_09$-- ===========================================================================
-- 4. Semeadura do Vault a partir dos comandos legados
-- ===========================================================================
-- Roda uma unica vez, no banco que carrega os literais (producao). Nao gera
-- segredo novo e nao imprime valor: move o que ja existe para o cofre, para que
-- os consumidores (Edge Function Secrets de mesmo nome) sigam sincronizados.
-- Em banco novo nao ha o que extrair: avisa e segue.

DO $seed_vault_007$
DECLARE
  r        RECORD;
  v_cmd    text;
  v_value  text;
  v_frag   text;
  v_pos    integer;
  v_next   text;
BEGIN
  -- 4.1 Base da API. Nao e segredo; mora no mesmo lugar para que exista um
  -- unico caminho de leitura e uma unica rotacao.
  -- Ignora os placeholders `*.invalid` das 003/005: em banco novo eles sao os
  -- unicos comandos com net.http_post, e semear um deles como SUPABASE_URL
  -- quebraria o contrato de "cofre vazio nao dispara" (o dispatcher passaria
  -- a fazer POST contra host invalido em vez de avisar e nao disparar).
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'SUPABASE_URL') THEN
    SELECT substring(command from $re$url := '(https://[^']+)/functions/v1/$re$)
      INTO v_value
      FROM cron.job
     WHERE command ~ 'net\.http_post'
       AND command NOT LIKE '%invalid%'
     ORDER BY jobname
     LIMIT 1;
    IF v_value IS NULL OR v_value LIKE '%invalid%' THEN
      RAISE WARNING '007: nenhum job legado para derivar SUPABASE_URL; cadastre no Vault (docs/operations/segredos-cron.md).';
    ELSE
      PERFORM vault.create_secret(
        v_value, 'SUPABASE_URL',
        'Base da API do projeto (https://<ref>.supabase.co). Configuracao, nao segredo; vive no Vault para ter caminho unico de leitura e rotacao.');
    END IF;
  END IF;

  -- 4.2 Segredos dos quatro jobs.
  FOR r IN
    SELECT * FROM (VALUES
      ('portal-daily-digest',
       'PORTAL_DIGEST_SECRET',
       $re$Bearer ' \|\| '([^']+)'$re$,
       $fr$Bearer ' || '%s'$fr$),
      ('alerts-foundation-detectors',
       'ALERTS_DETECTOR_SECRET',
       $re$Bearer ' \|\| '([^']+)'$re$,
       $fr$Bearer ' || '%s'$fr$),
      ('demurrage-dunning',
       'DEMURRAGE_DUNNING_SECRET',
       $re$Bearer ' \|\| '([^']+)'$re$,
       $fr$Bearer ' || '%s'$fr$),
      ('customer-communication-auto-runner',
       'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET',
       $re$'X-Communication-Automation-Secret', '([^']+)'$re$,
       $fr$'X-Communication-Automation-Secret', '%s'$fr$)
    ) AS t(jobname, secret_name, extract_re, frag_template)
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM vault.secrets WHERE name = r.secret_name);

    SELECT command INTO v_cmd FROM cron.job WHERE jobname = r.jobname;
    v_value := CASE WHEN v_cmd IS NULL THEN NULL ELSE substring(v_cmd from r.extract_re) END;

    -- Banco novo: o comando usa current_setting/COALESCE, nao literal.
    IF v_value IS NULL OR v_value = '' OR v_value LIKE 'missing-%' THEN
      RAISE WARNING '007: sem segredo literal recuperavel em %; cadastre % no Vault (docs/operations/segredos-cron.md).',
        r.jobname, r.secret_name;
      CONTINUE;
    END IF;

    -- O literal extraido precisa ser o literal INTEIRO. Se o segredo contiver
    -- aspas simples (escapadas como duas), `[^']+` truncaria e o cofre nasceria
    -- com valor errado: abortar e mais seguro do que quebrar o job em silencio.
    v_frag := format(r.frag_template, v_value);
    v_pos  := strpos(v_cmd, v_frag);
    v_next := substr(v_cmd, v_pos + length(v_frag), 1);
    IF v_pos = 0 OR v_next NOT IN (',', ')') THEN
      RAISE EXCEPTION '007: nao foi possivel extrair com seguranca o segredo de % (literal truncado ou formato inesperado); cadastre % no Vault manualmente antes de reaplicar.',
        r.jobname, r.secret_name;
    END IF;

    PERFORM vault.create_secret(
      v_value, r.secret_name,
      format('Segredo do job pg_cron %s. Espelha o Edge Function Secret de mesmo nome: rotacionar os dois juntos.', r.jobname));
  END LOOP;
END;
$seed_vault_007$$m007_09$,
$m007_10$-- ===========================================================================
-- 5. Reagendamento: o comando cita nomes, nunca valores
-- ===========================================================================
-- unschedule + schedule e a mesma forma idempotente usada pela 003/005: o
-- jobid muda, o nome (que e o contrato operacional) permanece.

DO $reschedule_007$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('portal-daily-digest', '0 11 * * *',
       $cmd$SELECT ops.dispatch_edge_job('portal-daily-digest', 'PORTAL_DIGEST_SECRET');$cmd$),
      ('alerts-foundation-detectors', '*/15 * * * *',
       $cmd$SELECT ops.dispatch_edge_job('alerts-detector', 'ALERTS_DETECTOR_SECRET');$cmd$),
      ('demurrage-dunning', '0 * * * *',
       $cmd$SELECT ops.dispatch_edge_job('demurrage-dunning', 'DEMURRAGE_DUNNING_SECRET');$cmd$),
      ('customer-communication-auto-runner', '*/15 * * * *',
       $cmd$SELECT ops.dispatch_edge_job('customer-communication-auto-runner', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET', 'X-Communication-Automation-Secret', '');$cmd$)
    ) AS t(jobname, schedule, command)
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = r.jobname) THEN
      PERFORM cron.unschedule(r.jobname);
    END IF;
    PERFORM cron.schedule(r.jobname, r.schedule, r.command);
  END LOOP;
END;
$reschedule_007$$m007_10$,
$m007_11$-- ===========================================================================
-- 6. Verificacao executavel
-- ===========================================================================

DO $verify_007$
DECLARE
  v_vazando  text;
  v_faltando text;
BEGIN
  SELECT string_agg(jobname, ', ' ORDER BY jobname) INTO v_vazando
    FROM cron.job
   WHERE command ~ $re$Bearer ' \|\| '[^']$re$
      OR command ~ $re$'X-Communication-Automation-Secret',\s*'[^']$re$;
  IF v_vazando IS NOT NULL THEN
    RAISE EXCEPTION '007: jobs ainda expoem segredo literal no comando: %', v_vazando;
  END IF;

  SELECT string_agg(esperado, ', ' ORDER BY esperado) INTO v_faltando
    FROM unnest(ARRAY[
      'portal-daily-digest',
      'alerts-foundation-detectors',
      'demurrage-dunning',
      'customer-communication-auto-runner'
    ]) AS esperado
   WHERE NOT EXISTS (
     SELECT 1 FROM cron.job j
      WHERE j.jobname = esperado
        AND j.active
        AND j.command LIKE 'SELECT ops.dispatch_edge_job(%'
   );
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION '007: jobs HTTP ausentes, inativos ou fora do dispatcher: %', v_faltando;
  END IF;
END;
$verify_007$$m007_11$
]::text[]),
    ('135', ARRAY[
$m135_00$-- 135: duas correções observadas em produção em 2026-10-05.
--
-- 1. Salvar escala falhava com "Informe a justificativa para alterar BLs e
--    CEs." sem nenhuma alteração de BLs e CEs. O editor terminalizado sempre
--    faz upsert de voyage_export_schedules (INSERT ... ON CONFLICT), mesmo em
--    escala só de importação. A guarda da 134 julgava esse INSERT contra
--    'waiting': NULL (linha nova sem ce_status) ou o valor já gravado
--    (linha existente, caminho ON CONFLICT) contavam como alteração manual.
--    Agora NULL equivale a Aguardando e, quando a linha já existe, o INSERT
--    não é julgado: o BEFORE UPDATE do ON CONFLICT compara com OLD.
-- 2. customer_local_charges_communication_payload falhava com
--    "column reference bl_id is ambiguous" (ORDER BY sem qualificar), então o
--    runner automático de comunicados de taxas locais nunca montava o payload.
--
-- Não reescreve nem apaga linhas existentes.

CREATE OR REPLACE FUNCTION public.guard_manual_documental_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_reason text; v_current text;
BEGIN
  IF TG_TABLE_NAME = 'audit_logs' THEN
    IF NEW.entity_type <> 'voyage_pod_schedule' OR NEW.field_name <> 'ces' THEN RETURN NEW; END IF;
    IF coalesce(NEW.new_value, 'waiting') NOT IN ('waiting', 'received', 'launching', 'approving', 'approved', 'missing', 'partial') THEN
      RAISE EXCEPTION 'Status de BLs e CEs inválido.' USING ERRCODE = '22023';
    END IF;
    SELECT new_value INTO v_current FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule' AND entity_id = NEW.entity_id AND field_name = 'ces'
    ORDER BY changed_at DESC, id DESC LIMIT 1;
    -- Mesma normalização do editor para estados legados: abrir/salvar não é override.
    v_current := CASE v_current WHEN 'partial' THEN 'launching' WHEN 'missing' THEN 'waiting' ELSE v_current END;
    IF coalesce(v_current, 'waiting') IS DISTINCT FROM coalesce(NEW.new_value, 'waiting')
      AND nullif(btrim(NEW.justification), '') IS NULL THEN
      RAISE EXCEPTION 'Informe a justificativa para alterar BLs e CEs.' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT ... ON CONFLICT sobre linha existente: quem julga é o BEFORE UPDATE
  -- disparado pelo DO UPDATE, que enxerga o valor anterior real.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.voyage_export_schedules
    WHERE voyage_id = NEW.voyage_id AND pol = NEW.pol
  ) THEN
    RETURN NEW;
  END IF;

  IF coalesce(CASE WHEN TG_OP = 'INSERT' THEN 'waiting' ELSE OLD.ce_status END, 'waiting')
     IS DISTINCT FROM coalesce(NEW.ce_status, 'waiting') THEN
    v_reason := nullif(btrim(current_setting('vela.documental_justification', true)), '');
    IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe a justificativa para alterar BLs e CEs.' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
    VALUES ('voyage_pod_schedule', NEW.voyage_id::text || '::' || public.normalize_port_code(NEW.pol), 'export_ces', CASE WHEN TG_OP = 'INSERT' THEN 'waiting' ELSE OLD.ce_status END, NEW.ce_status, auth.uid(), clock_timestamp(), v_reason);
  END IF;
  RETURN NEW;
END;
$$$m135_00$,
$m135_01$REVOKE ALL ON FUNCTION public.guard_manual_documental_status() FROM PUBLIC, anon, authenticated$m135_01$,
$m135_02$CREATE OR REPLACE FUNCTION public.customer_local_charges_communication_payload(p_voyage_id bigint, p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH base_bls AS (
      SELECT b.id AS bl_id, b.ce_mercante, b.pod, c.name AS customer_name,
             v.eta, v.voyage_number, vs.name AS vessel_name
      FROM public.bls b
      JOIN public.customers c ON c.id = b.customer_id
      JOIN public.voyages v ON v.id = b.voyage_id
      LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
      WHERE b.voyage_id = p_voyage_id
        AND b.customer_id = p_customer_id
        AND COALESCE(b.financial_status, 'pending') <> 'cancelled'
    ), direct_totals AS (
      SELECT ib.bl_id, sum(COALESCE(ib.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_bls ib
      JOIN base_bls b ON b.bl_id = ib.bl_id
      JOIN public.invoices i ON i.id = ib.invoice_id
      WHERE i.status IN ('issued', 'partially_paid', 'paid', 'covered')
      GROUP BY ib.bl_id
    ), ledger_totals AS (
      SELECT rl.bl_id, sum(COALESCE(rl.subtotal_brl, 0)) AS total_brl
      FROM public.invoice_receivable_links rl
      JOIN base_bls b ON b.bl_id = rl.bl_id
      JOIN public.invoices i ON i.id = rl.invoice_id
      WHERE COALESCE(rl.status, '') <> 'obsolete'
        AND i.status IN ('issued', 'partially_paid', 'paid', 'covered')
        AND NOT EXISTS (SELECT 1 FROM direct_totals d WHERE d.bl_id = rl.bl_id)
      GROUP BY rl.bl_id
    )
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
      'customer_id', p_customer_id,
      'customer_name', max(base_bls.customer_name),
      'vessel_name', max(base_bls.vessel_name),
      'voyage_number', max(base_bls.voyage_number),
      'port', (array_agg(COALESCE(base_bls.pod, '—') ORDER BY base_bls.bl_id))[1],
      'milestone_at', max(COALESCE(base_bls.eta::TEXT, '')),
      'bls', jsonb_agg(jsonb_build_object(
        'bl_id', base_bls.bl_id,
        'ce_mercante', NULLIF(btrim(base_bls.ce_mercante), ''),
        'total_brl', COALESCE(direct_totals.total_brl, ledger_totals.total_brl, 0)
      ) ORDER BY base_bls.bl_id)
    ) END
    FROM base_bls
    LEFT JOIN direct_totals ON direct_totals.bl_id = base_bls.bl_id
    LEFT JOIN ledger_totals ON ledger_totals.bl_id = base_bls.bl_id
  );
END;
$function$$m135_02$
]::text[])
  ) AS v(version, statements)
 WHERE sm.version = v.version
   AND cardinality(sm.statements) = 1
       AND NOT EXISTS (
         SELECT 1 FROM regexp_split_to_table(sm.statements[1], E'\n') AS l
          WHERE l !~ '^\s*(--.*)?$'
       );

-- 3. Verificação: as duas linhas precisam terminar com o SQL do repositório,
--    e o backup precisa ter as duas linhas originais. Qualquer divergência
--    aborta a transação e o COMMIT abaixo vira ROLLBACK.
DO $verifica_reparo$
DECLARE
  v_divergente text;
  v_backup     integer;
BEGIN
  SELECT string_agg(e.version || ' (' || coalesce(cardinality(sm.statements)::text, 'ausente') || ' elementos)', ', ')
    INTO v_divergente
    FROM (VALUES
    ('007', 12, '9311905842f9cf4669a11c78b5568db4'),
    ('135', 3, '11632c4741f85a0324739d5a114e9210')
    ) AS e(version, n, md5)
    LEFT JOIN supabase_migrations.schema_migrations sm ON sm.version = e.version
   WHERE sm.version IS NULL
      OR cardinality(sm.statements) IS DISTINCT FROM e.n
      OR md5(array_to_string(sm.statements, chr(31))) IS DISTINCT FROM e.md5;
  IF v_divergente IS NOT NULL THEN
    RAISE EXCEPTION 'reparo 007/135: linhas fora do esperado depois do UPDATE: %', v_divergente;
  END IF;

  SELECT count(*) INTO v_backup
    FROM supabase_migrations.schema_migrations_bkp_007_135
   WHERE version IN ('007', '135');
  IF v_backup <> 2 THEN
    RAISE EXCEPTION 'reparo 007/135: backup com % linhas (esperado 2); nada foi gravado.', v_backup;
  END IF;

  RAISE NOTICE 'reparo 007/135: statements conferidos (007=12, 135=3).';
END;
$verifica_reparo$;

COMMIT;
