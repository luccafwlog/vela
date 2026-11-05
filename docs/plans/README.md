# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, encerrado ou superado por decisão
registrada, ele é movido para [`../archive/plans/`](../archive/plans/README.md)
com nota de estado e motivo; o arquivo continua sendo histórico, não fonte de
verdade sobre o estado atual.

## Planos ativos


- [2026-10-23 — Reforços adiados da auditoria de segurança run-3](2026-10-23-reforcos-adiados-da-auditoria-run-3.md) — rodada própria decidida pelo dono em 2026-10-22: dependências das Edge Functions fixadas pelo import map e pelo `deno.lock` (com o `deno check` do CI em todas as funções) e CSP sem o host compartilhado do PostHog em `script-src`. A publicação já confere o lock e nada vem mais do esm.sh (2026-11-03); a revisão de 2026-11-05 manteve como pertinentes o import map (para o Dependabot atualizar as dependências), o `deno check` das 9 funções fora do CI, a CSP sem o `eu-assets` (com uma opção do `posthog-js`) e, de ganho baixo, o `style-src` sem `unsafe-inline`.


Planos concluídos, encerrados ou superados ficam no [índice dos planos arquivados](../archive/plans/README.md). As notas de estado que este índice acumulou até 2026-10-13 estão no [registro histórico](../archive/reports/2026-10-14-estado-planos-vivos-ate-2026-10-13.md); as anteriores, no [registro de 2026-09-18](../archive/reports/2026-09-18-notas-historicas-indice-planos.md).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da lista acima e acrescentar o plano, com estado e motivo, ao [índice dos planos arquivados](../archive/plans/README.md).
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
