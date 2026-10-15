-- 290: ETB/ATB/ETD/ATD da atracação passam a chegar com o fuso de Brasília.
--
-- Até aqui a janela de escala enviava "2026-10-16T18:40:00" sem fuso e o cast
-- ::TIMESTAMPTZ do save_voyage_escala_terminal_state_v2 o lia como UTC: a hora
-- digitada ficava 3 horas adiantada, e com ela o prazo de 72 horas do ADR e o
-- disparo de NOA/NOR. A tela agora envia "-03:00"; esta migration corrige os
-- valores já gravados somando as 3 horas perdidas.
--
-- Reescreve linhas existentes: depende da afirmação "Data status" da seção
-- Gotchas do AGENTS.md (o banco de produção só tem dados de teste). Sem ela,
-- não haveria como distinguir valores digitados antes e depois da correção.

UPDATE public.voyage_escala_terminal_state
SET terminal_etb = terminal_etb + interval '3 hours',
    terminal_atb = terminal_atb + interval '3 hours',
    terminal_etd = terminal_etd + interval '3 hours',
    terminal_atd = terminal_atd + interval '3 hours'
WHERE terminal_etb IS NOT NULL OR terminal_atb IS NOT NULL
   OR terminal_etd IS NOT NULL OR terminal_atd IS NOT NULL;
