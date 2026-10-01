-- 120: a justificativa da edição da escala deixa de ser exigida quando muda
-- apenas o status documental (BLs e CEs e Vinculada). Decisão do dono em
-- 2026-10-01: ETA, ETB, ETD e a seção BLs e CEs mudam no dia a dia e não pedem
-- justificativa; continuam exigindo terminal, ATB/ATD/Restow e a declaração de
-- exportação já registrados. ETB/ETD já não exigiam no banco (só o modal).
--
-- ce_status e linked viajam na expectativa de exportação; a comparação que
-- decide a justificativa passa a ignorá-los. A checagem de ADR fechado e a
-- auditoria da exportação seguem comparando o objeto inteiro, como antes.
--
-- Mesmo método da 111: o corpo atual (002 + 111) é lido do catálogo e cada
-- trecho é trocado com verificação; se o texto não for encontrado a migration
-- falha, nunca aplica pela metade. Copiar o corpo da 002 desfaria a 111.
-- Não reescreve nem apaga linhas existentes.
DO $migration$
DECLARE
  v_def TEXT;
  v_old TEXT;
  v_new TEXT;
  v_pairs TEXT[][] := ARRAY[
    -- 1. exportação já declarada: justificativa só fora do status documental.
    ARRAY[
$o$  IF v_export_old IS DISTINCT FROM v_export_new THEN
    v_requires_justification := v_requires_justification
      OR (v_current_revision > 0 AND v_old_export_declared);$o$,
$n$  IF (v_export_old - 'ce_status' - 'linked') IS DISTINCT FROM (v_export_new - 'ce_status' - 'linked') THEN
    v_requires_justification := v_requires_justification
      OR (v_current_revision > 0 AND v_old_export_declared);$n$
    ],
    -- 2. bloco de ADR fechado: continua comparando tudo; a justificativa não.
    ARRAY[
$o$    v_requires_justification := v_requires_justification OR v_old_export_declared;
    FOR v_report IN$o$,
$n$    v_requires_justification := v_requires_justification OR (
      v_old_export_declared
      AND (v_export_old - 'ce_status' - 'linked') IS DISTINCT FROM (v_export_new - 'ce_status' - 'linked')
    );
    FOR v_report IN$n$
    ]
  ];
  v_i INTEGER;
BEGIN
  v_def := pg_get_functiondef(
    'public.save_voyage_escala_terminal_state(bigint,text,integer,jsonb,jsonb,jsonb,text)'::regprocedure
  );
  v_def := replace(v_def, E'\r\n', E'\n');

  FOR v_i IN 1 .. array_length(v_pairs, 1) LOOP
    v_old := v_pairs[v_i][1];
    v_new := v_pairs[v_i][2];
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 120: trecho % não encontrado no corpo da escala.', v_i;
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END LOOP;

  EXECUTE v_def;
END
$migration$;
