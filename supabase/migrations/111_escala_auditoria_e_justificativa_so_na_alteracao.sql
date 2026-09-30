-- Migration 111: a escala só audita e só exige justificativa quando um dado
-- já informado muda.
--
-- Antes, salvar a escala pela primeira vez gravava na linha do tempo
-- "Datas do terminal alteradas" (terminal sem nenhuma data) e "registrada"
-- para frentes derivadas dos BLs sem terminal, e a primeira atribuição de
-- terminal ou de data exigia justificativa. Agora:
--   * terminal_dates só é auditado se há alguma data antes ou depois;
--   * front_created só é auditado quando a frente já nasce com terminal
--     (e registra o código do terminal);
--   * a justificativa só é exigida ao trocar/remover terminal já atribuído,
--     alterar/limpar data já preenchida ou mudar exportação já declarada.
-- Preencher campo vazio pela primeira vez não exige justificativa.
--
-- O corpo mora em save_voyage_escala_terminal_state (chamada pelo v2 e pelo
-- wrapper da 049). Em vez de copiar ~700 linhas, o corpo atual é lido do
-- catálogo e cada trecho é trocado com verificação: se o texto não for
-- encontrado a migration falha, nunca aplica pela metade. Não reescreve nem
-- apaga linhas de dados.
DO $migration$
DECLARE
  v_def TEXT;
  v_old TEXT;
  v_new TEXT;
  v_pairs TEXT[][] := ARRAY[
    -- 1. terminal com estado anterior: só exige justificativa se havia data.
    ARRAY[
$o$    IF v_state_changed THEN
      v_requires_justification := v_current_revision > 0;$o$,
$n$    IF v_state_changed THEN
      v_requires_justification := v_requires_justification OR (
        v_current_revision > 0 AND v_existing_terminal_state AND (
          v_old_terminal.terminal_atb IS NOT NULL
          OR v_old_terminal.terminal_atd IS NOT NULL
          OR v_old_terminal.terminal_rtw IS NOT NULL
        )
      );$n$
    ],
    -- 2. frente existente: só exige justificativa se já tinha terminal.
    ARRAY[
$o$      v_requires_justification := v_current_revision > 0;
      IF v_old_front.terminal_id IS NOT NULL THEN$o$,
$n$      v_requires_justification := v_requires_justification
        OR (v_current_revision > 0 AND v_old_front.terminal_id IS NOT NULL);
      IF v_old_front.terminal_id IS NOT NULL THEN$n$
    ],
    -- 3. exportação: só exige justificativa se já estava declarada.
    ARRAY[
$o$  IF v_export_old IS DISTINCT FROM v_export_new THEN
    v_requires_justification := v_current_revision > 0;$o$,
$n$  IF v_export_old IS DISTINCT FROM v_export_new THEN
    v_requires_justification := v_requires_justification
      OR (v_current_revision > 0 AND v_old_export_declared);$n$
    ],
    ARRAY[
$o$    v_requires_justification := TRUE;
    FOR v_report IN$o$,
$n$    v_requires_justification := v_requires_justification OR v_old_export_declared;
    FOR v_report IN$n$
    ],
    -- 4. terminal_dates: sem nenhuma data antes nem depois não há o que auditar.
    ARRAY[
$o$    IF v_state_changed THEN
      INSERT INTO public.audit_logs ($o$,
$n$    IF v_state_changed AND (
      v_terminal.terminal_atb IS NOT NULL OR v_terminal.terminal_atd IS NOT NULL
      OR v_terminal.terminal_rtw IS NOT NULL
      OR v_old_terminal.terminal_atb IS NOT NULL OR v_old_terminal.terminal_atd IS NOT NULL
      OR v_old_terminal.terminal_rtw IS NOT NULL
    ) THEN
      INSERT INTO public.audit_logs ($n$
    ],
    -- 5. front_created: só quando a frente já nasce com terminal.
    ARRAY[
$o$    IF NOT v_existing_front THEN
      INSERT INTO public.audit_logs ($o$,
$n$    IF NOT v_existing_front THEN
      IF v_front.terminal_id IS NOT NULL THEN
      INSERT INTO public.audit_logs ($n$
    ],
    ARRAY[
$o$                           'terminal_id', v_front.terminal_id, 'source', v_front.source)::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    ELSE$o$,
$n$                           'terminal_id', v_front.terminal_id, 'source', v_front.source,
                           'terminal_code', (SELECT d.code FROM public.depots AS d WHERE d.id = v_front.terminal_id))::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
      END IF;
    ELSE$n$
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
      RAISE EXCEPTION 'Migration 111: trecho % não encontrado no corpo da escala.', v_i;
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END LOOP;

  EXECUTE v_def;
END
$migration$;
