-- 512: as prévias que simulam a troca de POD tiram a exceção de terminal
-- inteira (terminal e porto), como a gravação. Achado da revisão da PR #1084.
--
-- Problema: `_apply_bl_charge_simulation_change` (prévia das taxas alteradas à
-- mão, `preview_bl_charge_adjustment_impact`, migration 495) e
-- `preview_breakbulk_billing_changes` (reimportação de carga solta de B/L
-- faturado, migration 381) limpam `bls.terminal_id` quando o POD muda, mas
-- deixam `bls.pod_port_id`. No B/L com exceção de terminal, a linha viola
-- `bls_terminal_override_pair_check` (os dois nulos ou os dois preenchidos):
--   - a prévia das taxas falha, a tela não vê o efeito e grava sem o diálogo
--     "Gravar mesmo assim" (só o alerta abre depois);
--   - a prévia da carga solta devolve a linha do B/L com o erro do banco.
-- A gravação de verdade limpa os dois campos: a reimportação, o COD e o
-- gatilho `trg_pod_change_clears_terminal_override` (502).
--
-- Mudança: nas duas funções, a mesma condição que limpa `terminal_id` limpa
-- também `pod_port_id`. Só essa linha muda, pelo remendo da 500 (definição
-- vigente, trecho conferido uma vez só); `CREATE OR REPLACE` preserva dono e
-- grants. As duas prévias rodam numa subtransação desfeita.
--
-- Só redefine funções; não reescreve nem apaga linhas.
-- Rollback: reaplicar as funções sem a linha de `pod_port_id` (495 e 509).

DO $patch$
DECLARE
  v_fn regprocedure;
  v_def text;
  v_old text;
  v_new text;
  v_patch record;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      ('public._apply_bl_charge_simulation_change(jsonb)',
       $s$terminal_id = CASE WHEN v_fields ? 'pod' AND NULLIF(btrim(v_fields->>'pod'), '') IS DISTINCT FROM b.pod THEN NULL ELSE b.terminal_id END,$s$,
       $s$pod_port_id = CASE WHEN v_fields ? 'pod' AND NULLIF(btrim(v_fields->>'pod'), '') IS DISTINCT FROM b.pod THEN NULL ELSE b.pod_port_id END,$s$),
      ('public.preview_breakbulk_billing_changes(bigint,jsonb)',
       $s$terminal_id = CASE WHEN NOT v_cod AND coalesce(nullif(btrim(v_row->>'pod'), ''), b.pod) IS DISTINCT FROM b.pod THEN NULL ELSE b.terminal_id END,$s$,
       $s$pod_port_id = CASE WHEN NOT v_cod AND coalesce(nullif(btrim(v_row->>'pod'), ''), b.pod) IS DISTINCT FROM b.pod THEN NULL ELSE b.pod_port_id END,$s$)
    ) AS p(fn, old_line, added_line)
  LOOP
    v_fn := v_patch.fn::regprocedure;
    v_def := pg_get_functiondef(v_fn);
    v_old := v_patch.old_line;
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION '512: trecho não encontrado em %', v_fn;
    END IF;
    IF position(v_old IN substr(v_def, position(v_old IN v_def) + 1)) > 0 THEN
      RAISE EXCEPTION '512: trecho repetido em %', v_fn;
    END IF;
    IF position(v_patch.added_line IN v_def) > 0 THEN
      RAISE EXCEPTION '512: % já limpa pod_port_id', v_fn;
    END IF;
    v_new := v_old || ' ' || v_patch.added_line;
    EXECUTE replace(v_def, v_old, v_new);
  END LOOP;
END;
$patch$;
