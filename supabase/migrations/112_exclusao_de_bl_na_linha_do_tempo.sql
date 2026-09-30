-- Migration 112: excluir B/L passa a aparecer na linha do tempo da viagem.
--
-- delete_records gravava a exclusão só em audit_logs(entity_type 'bl'), que a
-- linha do tempo da viagem não lê; a única pista era a contagem de B/Ls
-- importados diminuir. Agora, além da auditoria do B/L, grava um evento
-- 'bl_deleted' escopado à viagem (entity_type 'voyages', entity_id = viagem),
-- com o número do B/L e o motivo informado. O corpo atual é lido do catálogo
-- e cada trecho é trocado com verificação: se o texto não for encontrado a
-- migration falha em vez de aplicar pela metade. Não reescreve nem apaga linhas.
DO $migration$
DECLARE
  v_def TEXT;
  v_pairs TEXT[][] := ARRAY[
    ARRAY[
$o$  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN$o$,
$n$  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_bl_voyage bigint;
BEGIN$n$
    ],
    ARRAY[
$o$      ELSIF p_kind = 'bl' THEN
$o$,
$n$      ELSIF p_kind = 'bl' THEN
        SELECT b.voyage_id INTO v_bl_voyage FROM public.bls AS b WHERE b.id = v_id;
$n$
    ],
    ARRAY[
$o$        VALUES (v_entity, v_id, 'deleted', v_id, NULL, auth.uid(), v_reason);$o$,
$n$        VALUES (v_entity, v_id, 'deleted', v_id, NULL, auth.uid(), v_reason);
        IF p_kind = 'bl' AND v_bl_voyage IS NOT NULL THEN
          INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
          VALUES ('voyages', v_bl_voyage::text, 'bl_deleted', v_id, 'excluído', auth.uid(), v_reason);
        END IF;$n$
    ]
  ];
  v_i INTEGER;
BEGIN
  v_def := replace(
    pg_get_functiondef('public.delete_records(text,text[],boolean,text)'::regprocedure),
    E'\r\n', E'\n'
  );

  FOR v_i IN 1 .. array_length(v_pairs, 1) LOOP
    IF position(v_pairs[v_i][1] IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 112: trecho % não encontrado em delete_records.', v_i;
    END IF;
    v_def := replace(v_def, v_pairs[v_i][1], v_pairs[v_i][2]);
  END LOOP;

  EXECUTE v_def;
END
$migration$;
