-- 448: o disparo pelo evento que não sai não segura a trava da rotina.
--
-- Revisão da migration 447 antes do merge: `ops.kick_edge_job` travava a
-- linha da rotina em `ops.edge_job_kicks` (FOR UPDATE SKIP LOCKED) antes de
-- conferir o intervalo mínimo. Dentro do intervalo devolvia `false`, mas o
-- bloco terminava sem erro e a trava ficava com a transação até o COMMIT.
-- Toda outra transação elegível nesse meio-tempo via a linha travada e pulava
-- o disparo, como se alguém estivesse disparando. Exemplo: disparo às 10:00;
-- uma importação de 3 min começa às 10:00:30 (dentro dos 90 s), não dispara e
-- segura a linha até ~10:03:30; o faturamento das 10:02 pula. Ninguém
-- dispara, e os dois esperam o cron (até 2 min nos Comunicados, até 5 min na
-- Régua). Reproduzido no Postgres 16 local com duas sessões.
--
-- Correção: dentro do intervalo, sai antes de travar (leitura sem trava). Se
-- outra transação disparou entre a leitura e a trava, desfaz a subtransação
-- (SQLSTATE VK447) e solta a trava. O resto da 447 não muda.
--
-- Só redefine a função; não reescreve nem apaga linhas.
-- Rollback: reaplicar `ops.kick_edge_job` da 447.

CREATE OR REPLACE FUNCTION ops.kick_edge_job(
  p_function     text,
  p_secret_name  text,
  p_header       text DEFAULT 'Authorization',
  p_prefix       text DEFAULT 'Bearer ',
  p_min_interval interval DEFAULT interval '0'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $kick_edge_job$
DECLARE
  v_guard   text;
  v_now     timestamptz := clock_timestamp();
  v_last    timestamptz;
  v_locked  boolean;
  v_request bigint;
BEGIN
  -- O nome vai para a URL e para o nome da trava da transação.
  IF p_function IS NULL OR p_function !~ '^[a-z0-9][a-z0-9-]{0,62}$' THEN
    RAISE EXCEPTION 'Função inválida para o disparo: %.', p_function USING ERRCODE = '22023';
  END IF;

  -- Uma tentativa por transação e rotina, antes do bloco de exceção: uma
  -- importação de centenas de B/Ls não abre uma subtransação por linha.
  v_guard := 'vela.kick_' || translate(p_function, '-', '_');
  IF current_setting(v_guard, true) = 'on' THEN
    RETURN false;
  END IF;
  PERFORM set_config(v_guard, 'on', true);

  BEGIN
    -- Sem o par no Vault (banco novo, Preview, staging sem provisionar): pula
    -- em silêncio. O cron, que passa pelo dispatcher, é quem avisa.
    IF (SELECT count(*) FROM vault.decrypted_secrets
         WHERE name IN ('SUPABASE_URL', p_secret_name)
           AND NULLIF(decrypted_secret, '') IS NOT NULL) < 2 THEN
      RETURN false;
    END IF;

    -- 448: dentro do intervalo sai sem travar a linha. Quem não vai disparar
    -- não pode fazer outra transação, já fora do intervalo, pular o disparo.
    IF COALESCE(p_min_interval, interval '0') > interval '0' THEN
      SELECT k.last_kicked_at INTO v_last FROM ops.edge_job_kicks k WHERE k.function = p_function;
      IF v_last > v_now - p_min_interval THEN
        RETURN false;
      END IF;
    END IF;

    -- SKIP LOCKED: a linha travada é de outra transação que está disparando
    -- esta rotina; esperar por ela seguraria a gravação de quem usa a tela.
    SELECT k.last_kicked_at INTO v_last
      FROM ops.edge_job_kicks k WHERE k.function = p_function
       FOR UPDATE SKIP LOCKED;
    v_locked := FOUND;
    IF NOT v_locked AND NOT EXISTS (SELECT 1 FROM ops.edge_job_kicks k WHERE k.function = p_function) THEN
      INSERT INTO ops.edge_job_kicks (function) VALUES (p_function) ON CONFLICT (function) DO NOTHING;
      SELECT k.last_kicked_at INTO v_last
        FROM ops.edge_job_kicks k WHERE k.function = p_function
         FOR UPDATE SKIP LOCKED;
      v_locked := FOUND;
    END IF;

    IF COALESCE(p_min_interval, interval '0') > interval '0' THEN
      -- Outra transação disparando agora: o disparo dela (depois do COMMIT)
      -- ou o cron cobre este evento.
      IF NOT v_locked THEN
        RETURN false;
      END IF;
      -- 448: outra transação disparou entre a leitura e a trava. VK447 desfaz
      -- a subtransação e solta a trava, em vez de segurá-la até o COMMIT.
      IF v_last > v_now - p_min_interval THEN
        RAISE EXCEPTION 'dentro do intervalo' USING ERRCODE = 'VK447';
      END IF;
    END IF;

    v_request := ops.dispatch_edge_job(p_function, p_secret_name, p_header, p_prefix,
                                       '{"source":"trigger"}'::jsonb);
    -- Sem intervalo e com a linha de outra transação, dispara sem registrar.
    IF v_locked THEN
      UPDATE ops.edge_job_kicks
         SET last_kicked_at = v_now, last_request_id = v_request
       WHERE function = p_function;
    END IF;
    RETURN v_request IS NOT NULL;
  EXCEPTION
    WHEN SQLSTATE 'VK447' THEN
      RETURN false;
    WHEN OTHERS THEN
      RAISE WARNING 'ops.kick_edge_job(%): disparo falhou (%); o cron processa.', p_function, SQLERRM;
      RETURN false;
  END;
END;
$kick_edge_job$;

COMMENT ON FUNCTION ops.kick_edge_job(text, text, text, text, interval) IS
  'Dispara a Edge Function com {"source":"trigger"} uma vez por transação e no máximo uma vez por intervalo (ops.edge_job_kicks); pg_net envia após o COMMIT. Sem o par no Vault, pula; falha vira WARNING. Dentro do intervalo, não trava a linha. Migrations 447 e 448.';

REVOKE ALL ON FUNCTION ops.kick_edge_job(text, text, text, text, interval) FROM PUBLIC, anon, authenticated;
