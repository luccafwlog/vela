-- Migration 220: comandos do Desbloqueio de CE travam o Cliente sem bloquear
-- as checagens de chave estrangeira que apontam para ele.
--
-- Problema (teste "envio do pedido aguarda cancelamento concorrente da baixa…" em
-- src/integration/ceUnlock.local-pg.test.ts, Postgres local, 2026-10-13):
-- `ce_unlock_private.command` (161) faz `SELECT … FROM customers … FOR UPDATE`
-- antes de travar os recebíveis do B/L. O cancelamento de baixa
-- (`reverse_invoice_payment`) trava o recebível e, no COMMIT, o gatilho adiado
-- `trg_notify_invoice_issued` (179) insere em `portal_notifications`, cuja FK
-- pede `FOR KEY SHARE` no mesmo Cliente. `FOR UPDATE` conflita com
-- `FOR KEY SHARE`: envio e cancelamento de baixa simultâneos terminam em
-- `deadlock detected` e um dos dois é desfeito (às vezes o cancelamento do
-- Financeiro). O dinheiro não fica errado, mas a operação falha sem motivo de
-- negócio.
--
-- Mudança: a trava do Cliente em `ce_unlock_private.command` e em
-- `public.ce_unlock_prepare_upload` (173) passa a `FOR NO KEY UPDATE`. Ela
-- continua serializando comandos e uploads CE do mesmo Cliente (NO KEY UPDATE
-- conflita consigo mesma) e continua impedindo UPDATE/DELETE do Cliente durante
-- o comando, mas não conflita com `FOR KEY SHARE` das FKs. Com isso o envio
-- espera o cancelamento terminar e recusa o B/L que perdeu a liquidação.
-- Nenhuma linha de dados é alterada; assinaturas, grants e SECURITY DEFINER
-- são preservados (CREATE OR REPLACE da própria definição).
--
-- Rollback: reaplicar as definições de 161 (`ce_unlock_private.command`) e 173
-- (`public.ce_unlock_prepare_upload`).

DO $migration$
DECLARE
  v_old constant text := 'FROM public.customers WHERE id=cid FOR UPDATE';
  v_new constant text := 'FROM public.customers WHERE id=cid FOR NO KEY UPDATE';
  v_fn regprocedure;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'ce_unlock_private.command(text,jsonb,boolean)'::regprocedure,
    'public.ce_unlock_prepare_upload(jsonb)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_fn);
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 220: trava do Cliente não encontrada em %', v_fn;
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END LOOP;
END;
$migration$;
